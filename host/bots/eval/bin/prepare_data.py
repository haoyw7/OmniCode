#!/usr/bin/env python3
"""Prepare checksum-locked evaluation datasets in the user's external cache.

Only explicitly selected sources are fetched. Original MonoCode fixtures come
from an external input directory or HTTPS base URL; public sources use immutable
upstream revisions. Downloads
and rebuilt datasets are verified before an atomic, per-source publication.
No dependency installation, model calls, or project-directory data writes occur.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import urllib.parse
import urllib.request

EVAL_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = EVAL_ROOT.parents[2]
LOCK_PATH = EVAL_ROOT / "data/datasets.lock.json"
MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_lock():
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    if lock.get("version") != 1:
        raise ValueError("Unsupported eval dataset lock version")
    for source, entry in lock["sources"].items():
        if not source or Path(source).name != source:
            raise ValueError("Invalid source in eval dataset lock")
        for name, digest in entry["files"].items():
            path = Path(name)
            if path.is_absolute() or ".." in path.parts or len(digest) != 64:
                raise ValueError(f"Invalid file in eval dataset lock: {name}")
    return lock


def cache_root():
    override = os.environ.get("MONOCODE_EVAL_DATA_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    base = os.environ.get("MONOCODE_EVAL_CACHE")
    if base:
        cache = Path(base).expanduser()
    else:
        cache = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "monocode/eval"
    return (cache / sha256(LOCK_PATH)[:16]).resolve()


def normalize_sources(sources, lock):
    if sources is None or sources == "all":
        return list(lock["sources"])
    if isinstance(sources, str):
        sources = sources.split(",")
    selected = list(dict.fromkeys(source.strip() for source in sources if source.strip()))
    unknown = set(selected) - set(lock["sources"])
    if unknown or not selected:
        raise ValueError("Unknown or empty eval sources: " + ", ".join(sorted(unknown)))
    return selected


def valid_dataset(directory, files):
    """Reject corruption and incomplete/extra files, including symlink payloads."""
    if not directory.is_dir() or directory.is_symlink():
        return False
    try:
        actual = set()
        for path in directory.rglob("*"):
            if path.is_symlink():
                return False
            if path.is_file():
                actual.add(path.relative_to(directory).as_posix())
        return actual == set(files) and all(sha256(directory / name) == digest for name, digest in files.items())
    except OSError:
        return False


@contextmanager
def source_lock(path):
    """OS locks release on process exit, including a killed preparation process."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        if os.name == "nt":
            import msvcrt
            if stream.tell() == 0:
                stream.write(b"\0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)


def download(url, digest, downloads):
    """Cache raw bytes by SHA; never trust an existing download without checking."""
    downloads.mkdir(parents=True, exist_ok=True)
    target = downloads / digest
    if target.is_file() and not target.is_symlink() and sha256(target) == digest:
        return target
    if not url.startswith("https://"):
        raise ValueError("Eval downloads require HTTPS")
    print(f"Fetching {url}", file=sys.stderr)
    request = urllib.request.Request(url, headers={"User-Agent": "monocode-eval-data/1"})
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=downloads, prefix=".download-", delete=False) as output:
            temporary = Path(output.name)
            with urllib.request.urlopen(request, timeout=90) as response:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_DOWNLOAD_BYTES:
                        raise ValueError(f"Eval download exceeds {MAX_DOWNLOAD_BYTES} bytes: {url}")
                    output.write(chunk)
        actual = sha256(temporary)
        if actual != digest:
            raise ValueError(f"SHA256 mismatch for {url}: expected {digest}, got {actual}")
        os.replace(temporary, target)
        return target
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def copy_download(url, digest, destination, downloads):
    downloaded = download(url, digest, downloads)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(downloaded, destination)


def _module(path):
    name = "_eval_builder_" + hashlib.sha256(str(path).encode()).hexdigest()[:12]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.pop(0)
    return module


def _require(module, source, requirement=None):
    if importlib.util.find_spec(module) is None:
        raise RuntimeError(f"Preparing {source} requires {requirement or module} in {sys.executable}. "
                           "Install it in your chosen Python environment and retry; eval does not install packages.")


def _prepare_bfcl(stage, downloads):
    source = stage / "data/upstream/bfcl-v4-sample"
    manifest = json.loads((source / "manifest.json").read_text())
    for category, metadata in manifest["categories"].items():
        url = metadata["sourceUrl"].replace("https://github.com/", "https://raw.githubusercontent.com/").replace("/blob/", "/")
        raw = download(url, metadata["sourceSha256"], downloads).read_text(encoding="utf-8")
        lines = [line for line in raw.splitlines() if line.strip()]
        selected = [lines[index - 1] for index in metadata["sourceLineNumbers"]]
        target = source / f"BFCL_v4_{category}.jsonl"
        target.write_text("\n".join(selected) + "\n", encoding="utf-8", newline="\n")
        if "answersSourceSha256" in metadata:
            answer_url = url.rsplit("/", 1)[0] + "/possible_answer/" + url.rsplit("/", 1)[1]
            raw_answers = download(answer_url, metadata["answersSourceSha256"], downloads).read_text(encoding="utf-8")
            answers = {json.loads(line)["id"]: line for line in raw_answers.splitlines() if line.strip()}
            output = source / "possible_answer" / target.name
            output.parent.mkdir(exist_ok=True)
            output.write_text("\n".join(answers[identity] for identity in metadata["ids"]) + "\n", encoding="utf-8", newline="\n")
    _module(stage / "public/bfcl/build_subset.py").main()


def _prepare_longmemeval(stage, downloads):
    source = stage / "data/upstream/longmemeval-oracle-sample"
    manifest = json.loads((source / "manifest.json").read_text())
    url = f'{manifest["official_url"]}/resolve/{manifest["revision"]}/{manifest["sourceFile"]}'
    rows = json.loads(download(url, manifest["sha256"], downloads).read_text(encoding="utf-8"))
    by_id = {row["question_id"]: row for row in rows}
    selected = [by_id[identity] for identity in manifest["upstreamIds"]]
    (source / "records.json").write_text(json.dumps(selected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    _module(stage / "public/longmemeval/build_subset.py").main()


def _prepare_tau_bench(stage, downloads):
    directory = stage / "public/tau_bench"
    manifest = json.loads((directory / "manifest.json").read_text())
    snapshot = stage / ".tau-upstream"
    shutil.copytree(directory / "private/upstream", snapshot)
    for entry in manifest["files"]:
        path = snapshot / entry["path"]
        if not path.is_file() or sha256(path) != entry["sha256"]:
            url = f'https://raw.githubusercontent.com/sierra-research/tau-bench/{manifest["revision"]}/{entry["path"]}'
            copy_download(url, entry["sha256"], path, downloads)
    builder = _module(directory / "build_subset.py")
    # The builder normally checks an audited Git checkout's HEAD. Every file in
    # this minimal snapshot was instead verified against the pinned manifest.
    # Replace only that module's subprocess binding, not subprocess globally.
    def checked_revision(command, **kwargs):
        if command != ["git", "-C", str(snapshot), "rev-parse", "HEAD"]:
            raise ValueError("Unexpected command in tau-bench builder")
        return manifest["revision"] + "\n"
    builder.subprocess = types.SimpleNamespace(check_output=checked_revision)
    builder.main(snapshot)


def _prepare_api_bank(stage, downloads):
    directory = stage / "public/api_bank"
    manifest = json.loads((directory / "manifest.json").read_text())
    files = load_lock()["sources"]["api_bank"]["files"]
    code_base = f'https://raw.githubusercontent.com/AlibabaResearch/DAMO-ConvAI/{manifest["code"]["revision"]}/api-bank/'
    jobs = []
    for relative, digest in files.items():
        path = Path(relative)
        if "/fixtures/" in relative:
            url = code_base + "init_database/" + path.name
        elif "/raw/dialogues/" in relative:
            url = code_base + "lv1-lv2-samples/level-1-given-desc/" + path.name
        elif path.name in {"level-1-api.json", "level-2-api.json"}:
            url = f'{manifest["data"]["url"]}/resolve/{manifest["data"]["revision"]}/test-data/{path.name}'
        else:
            continue
        jobs.append((url, digest, stage / path, downloads))
    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(lambda args: copy_download(*args), jobs))
    _module(directory / "import_cases.py").main()


def _prepare_hotpotqa(stage, downloads):
    _require("pyarrow", "hotpotqa", "pyarrow (validated importer version: 23.0.1)")
    directory = stage / "public/hotpotqa"
    manifest = json.loads((directory / "manifest.json").read_text())
    data = manifest["source_data"]
    parquet = download(data["download_url"], data["sha256"], downloads)
    _module(directory / "import_subset.py").build(parquet)


def _prepare_bipia(stage, downloads):
    _require("nltk", "bipia", "nltk==3.9.2")
    _require("pandas", "bipia")
    directory = stage / "public/bipia"
    manifest = json.loads((directory / "manifest.json").read_text())
    for relative, digest in load_lock()["sources"]["bipia"]["files"].items():
        marker = "public/bipia/upstream/"
        if relative.startswith(marker):
            path = relative.removeprefix(marker)
            url = f'https://raw.githubusercontent.com/microsoft/BIPIA/{manifest["revision"]}/{path}'
            copy_download(url, digest, stage / relative, downloads)
    _module(directory / "build_subset.py").build()


def _prepare_original(stage, downloads):
    """Read original cases from external input; never reconstruct them in code."""
    configured = os.environ.get("MONOCODE_EVAL_ORIGINAL_SOURCE", "").strip()
    source = configured or str(Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "monocode/eval-inputs/original")
    is_url = "://" in source
    if is_url:
        parsed = urllib.parse.urlsplit(source)
        if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
            raise ValueError("MONOCODE_EVAL_ORIGINAL_SOURCE must be an external directory or an HTTPS base URL without query/fragment")
    else:
        directory = Path(source).expanduser().resolve()
        if directory == PROJECT_ROOT or PROJECT_ROOT in directory.parents:
            raise ValueError("MONOCODE_EVAL_ORIGINAL_SOURCE must be outside the project directory")
    for relative, digest in load_lock()["sources"]["original"]["files"].items():
        destination = stage / relative
        if is_url:
            url = source.rstrip("/") + "/" + urllib.parse.quote(relative, safe="/")
            copy_download(url, digest, destination, downloads)
        else:
            original = (directory / relative).resolve()
            if original == PROJECT_ROOT or PROJECT_ROOT in original.parents:
                raise ValueError("Original eval inputs must be outside the project directory")
            if not original.is_file():
                raise FileNotFoundError(
                    f"Original eval dataset input missing: {original}. "
                    "Set MONOCODE_EVAL_ORIGINAL_SOURCE to an external directory or HTTPS base URL "
                    "containing the data/... paths listed in data/datasets.lock.json."
                )
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, destination)
        if sha256(destination) != digest:
            raise ValueError(f"Original eval dataset input does not match locked SHA256: {relative}")


def _build_source(source, stage, downloads):
    globals()["_prepare_" + source](stage, downloads)


def _copy_sources(stage, source, lock):
    payloads = {name for entry in lock["sources"].values() for name in entry["files"]}
    roots = [EVAL_ROOT / "bin", EVAL_ROOT / "data"]
    if source != "original":
        roots.append(EVAL_ROOT / "public" / source)
    for root in roots:
        for path in root.rglob("*"):
            relative = path.relative_to(EVAL_ROOT)
            if not path.is_file() or path.is_symlink() or "__pycache__" in relative.parts or path.suffix == ".pyc":
                continue
            if relative.as_posix() in payloads:
                continue
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)


def ensure_data(sources=None):
    lock = load_lock()
    selected = normalize_sources(sources, lock)
    root = cache_root()
    # A custom cache must still be outside the project: builds cannot turn into
    # source-tree datasets merely through an accidental relative environment.
    if root == PROJECT_ROOT or PROJECT_ROOT in root.parents:
        raise ValueError("MONOCODE_EVAL_CACHE/MONOCODE_EVAL_DATA_ROOT must be outside the project directory")
    root.mkdir(parents=True, exist_ok=True)
    for source in selected:
        files = lock["sources"][source]["files"]
        target = root / source
        with source_lock(root.parent / ".locks" / f"{root.name}-{source}.lock"):
            if valid_dataset(target, files):
                continue
            print(f"Preparing eval dataset: {source}", file=sys.stderr)
            with tempfile.TemporaryDirectory(dir=root.parent, prefix=f".prepare-{source}-") as temporary:
                work = Path(temporary) / "work"
                if source == "original":
                    _prepare_original(work, root.parent / "downloads")
                else:
                    _copy_sources(work, source, lock)
                    environment = dict(os.environ, MONOCODE_EVAL_BUILD_ROOT=str(work), PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1")
                    subprocess.run([sys.executable, str(Path(__file__).resolve()), "--_build", source,
                                    "--_stage", str(work), "--_downloads", str(root.parent / "downloads")],
                                   env=environment, stdout=sys.stderr, check=True)
                prepared = Path(temporary) / "ready"
                for name, digest in files.items():
                    source_file = work / name
                    if not source_file.is_file() or sha256(source_file) != digest:
                        raise ValueError(f"Rebuilt {source} dataset does not match locked SHA256: {name}")
                    destination = prepared / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source_file, destination)
                if target.exists() or target.is_symlink():
                    # Keep the old directory until a complete replacement is
                    # ready; never expose partially downloaded/rebuilt data.
                    target.rename(Path(temporary) / "invalid")
                prepared.rename(target)
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", default="all", help="Comma-separated source IDs; default: all")
    parser.add_argument("--_build", help=argparse.SUPPRESS)
    parser.add_argument("--_stage", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--_downloads", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args._build:
            _build_source(args._build, args._stage, args._downloads)
        else:
            print(json.dumps({"root": str(ensure_data(args.sources))}))
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Eval data preparation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
