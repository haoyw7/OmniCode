#!/usr/bin/env python3
"""Check local public-suite provenance, deduplication and locked artifact hashes."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from eval_data import cache_root, dataset_lock, ensure_data

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "public/integrity.json"
SOURCES = ("bfcl", "longmemeval", "tau_bench", "api_bank", "hotpotqa", "bipia")
COUNTS = {"bfcl": 30, "longmemeval": 18, "tau_bench": 24, "api_bank": 32, "hotpotqa": 48, "bipia": 48}
FIELDS = ("official_url", "license_url", "revision", "sha256", "upstream_id", "split", "variant", "transformation", "seed", "env_requirement")


def files(sources=SOURCES):
    roots = [ROOT / "public", ROOT / "data/upstream/bfcl-v4-sample", ROOT / "data/upstream/longmemeval-oracle-sample"]
    paths = [path for root in roots for path in root.rglob("*") if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc" and path != LOCK]
    result = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}
    for source in sources:
        base = cache_root() / source
        if base.is_symlink():
            raise ValueError(f"Dataset cache symlink rejected: {base}")
        for path in sorted(base.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Dataset cache symlink rejected: {path}")
            if path.is_file():
                name = path.relative_to(base).as_posix()
                if name in result:
                    raise ValueError(f"Dataset payload must not be stored in the checkout: {name}")
                result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-lock", action="store_true", help="Maintainer action after source review; rewrites the integrity lock")
    parser.add_argument("--sources", default=",".join(SOURCES), help="Comma-separated public sources to prepare and verify")
    args = parser.parse_args()
    sources = tuple(dict.fromkeys(args.sources.split(",")))
    if not sources or any(source not in SOURCES for source in sources):
        parser.error("Unknown public dataset")
    if args.write_lock and set(sources) != set(SOURCES):
        parser.error("--write-lock requires all sources")
    ensure_data(sources)
    spec = importlib.util.spec_from_file_location("public_bridge_verify", ROOT / "public/bridge.py")
    bridge = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = bridge
    spec.loader.exec_module(bridge)
    inventory, ids = {}, set()
    for source in sources:
        rows = bridge.load_adapter(source).load_cases()
        assert len(rows) == COUNTS[source], (source, len(rows))
        originals = set()
        for row in rows:
            assert row["id"] not in ids, row["id"]
            ids.add(row["id"])
            assert row["source"] == source
            assert all(key in row["provenance"] for key in FIELDS), (source, row["id"], "missing provenance")
            assert row["provenance"]["upstream_id"] == row["upstream_id"]
            sha = row["provenance"]["sha256"]
            assert isinstance(sha, str) and len(sha) == 64 and all(c in "0123456789abcdef" for c in sha)
            originals.add(row["upstream_id"])
        inventory[source] = {"variants": len(rows), "distinct_originals": len(originals), "categories": dict(Counter(row["category"] for row in rows))}
    current = files(sources)
    if args.write_lock:
        LOCK.write_text(json.dumps({"version": 1, "files": current, "inventory": inventory}, ensure_ascii=False, indent=2) + "\n")
    saved = json.loads(LOCK.read_text())
    datasets = dataset_lock()["sources"]
    external = {name for entry in datasets.values() for name in entry["files"]}
    expected = {name: digest for name, digest in saved["files"].items() if name not in external}
    for source in sources:
        expected.update(datasets[source]["files"])
    assert expected == current, "Public artifact hash drift; investigate before deliberately regenerating lock"
    assert {source: saved["inventory"][source] for source in sources} == inventory
    print(json.dumps({"status": "passed", "files": len(current), "executable_variants": len(ids), "distinct_originals": sum(v["distinct_originals"] for v in inventory.values()), "inventory": inventory}, ensure_ascii=False))


if __name__ == "__main__":
    main()
