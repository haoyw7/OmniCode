"""Resolve locked evaluation payloads outside the checkout; never fetch on reads."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from functools import lru_cache

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=None)
def dataset_lock(root=ROOT):
    path = Path(root) / "data/datasets.lock.json"
    if not path.exists():
        return {"version": 1, "sources": {}}
    return json.loads(path.read_text())


def cache_root(root=ROOT):
    if os.environ.get("MONOCODE_EVAL_DATA_ROOT"):
        return Path(os.environ["MONOCODE_EVAL_DATA_ROOT"]).expanduser().resolve()
    base = Path(os.environ.get("MONOCODE_EVAL_CACHE") or
                str(Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "monocode/eval"))
    digest = hashlib.sha256((Path(root) / "data/datasets.lock.json").read_bytes()).hexdigest()[:16]
    return base.expanduser().resolve() / digest


def archive_root(root=ROOT):
    """Location of optional historical evidence, separate from dataset caches."""
    if os.environ.get("MONOCODE_EVAL_ARCHIVE_ROOT"):
        return Path(os.environ["MONOCODE_EVAL_ARCHIVE_ROOT"]).expanduser().resolve()
    base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
    return base.expanduser().resolve() / "monocode/eval-archive"


def data_path(relative, root=ROOT):
    """Resolve payload caches and optional reports; custom fixture roots stay local."""
    relative = Path(relative)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Evaluation data paths must be relative to the eval root")
    # Only the preparation subprocess sets this; it builds in an isolated tree.
    build_root = os.environ.get("MONOCODE_EVAL_BUILD_ROOT")
    if build_root:
        return Path(build_root) / relative
    if relative.parts and relative.parts[0] == "reports" and (Path(root) / "data/datasets.lock.json").exists():
        return archive_root(root) / relative
    key = relative.as_posix()
    for source, entry in dataset_lock(Path(root)).get("sources", {}).items():
        if key in entry["files"] or any(name.startswith(key + "/") for name in entry["files"]):
            return cache_root(root) / source / relative
    return Path(root) / relative


def resolve_data_file(path, root=ROOT):
    """Keep explicit custom import paths, resolving only paths in this checkout."""
    path = Path(path).resolve()
    try:
        relative = path.relative_to(Path(root).resolve())
    except ValueError:
        return path
    return data_path(relative, root)


def require_external_output(path, root=ROOT):
    """Managed eval outputs must remain outside the checkout, including symlinks."""
    output = Path(path).resolve()
    root = Path(root).resolve()
    if (root / "data/datasets.lock.json").is_file():
        project = root.parents[2]
        if output.is_relative_to(project):
            raise ValueError("Evaluation output must be outside the project checkout")
    return output


def ensure_data(sources, root=ROOT):
    from prepare_data import ensure_data as prepare
    if Path(root).resolve() != ROOT:
        # Test fixtures/custom catalogs own their data and must remain offline.
        return Path(root)
    result = prepare(sources)
    os.environ["MONOCODE_EVAL_DATA_ROOT"] = str(result)
    return result
