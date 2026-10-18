"""Build executable variants from the immutable 30-record imported sample."""
import hashlib
import json
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[1] / "data" / "upstream" / "bfcl-v4-sample"
VARIANT = "local_strict_call_set_v1"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    upstream = json.loads((SOURCE / "manifest.json").read_text())
    cases, seen_ids, seen_hashes = [], set(), set()
    for category, metadata in upstream["categories"].items():
        source = SOURCE / f"BFCL_v4_{category}.jsonl"
        assert sha(source.read_bytes()) == metadata["subsetSha256"]
        answer_path = SOURCE / "possible_answer" / source.name
        answers = {}
        if answer_path.exists():
            assert sha(answer_path.read_bytes()) == metadata["answersSubsetSha256"]
            answers = {row["id"]: row["ground_truth"] for row in map(json.loads, answer_path.read_text().splitlines())}
        for raw in source.read_bytes().splitlines():
            record = json.loads(raw)
            digest = sha(raw)
            assert record["id"] not in seen_ids and digest not in seen_hashes
            seen_ids.add(record["id"])
            seen_hashes.add(digest)
            cases.append({
                "id": f"bfcl/{record['id']}/{VARIANT}", "source": "bfcl", "upstream_id": record["id"],
                "category": category, "variant": VARIANT,
                "provenance": {
                    "official_url": metadata["sourceUrl"], "license_url": upstream["dataLicenseUrl"],
                    "revision": upstream["revision"], "sha256": digest,
                    "sha256_scope": "original record line excluding LF", "source_file_sha256": metadata["sourceSha256"],
                    "upstream_id": record["id"], "split": "BFCL_v4_single_turn", "variant": VARIANT,
                    "transformation": "source question/functions retained; dict/float translated to object/number; closed JSON schemas; simulated call receipts; local strict candidate multiset grader",
                    "seed": 17, "env_requirement": "Python 3 stdlib; no network, inference, or real function execution",
                },
                "data": {"original_record": record, "ground_truth": answers.get(record["id"], [])},
            })
    output = "".join(json.dumps(case, ensure_ascii=False) + "\n" for case in cases)
    (ROOT / "cases.jsonl").write_text(output)
    manifest = {
        "source": "bfcl", "version": 1, "variant": VARIANT, "status": "executable_offline_local_adapter",
        "revision": upstream["revision"], "license": "Apache-2.0", "license_url": upstream["licenseUrl"],
        "data_license_url": upstream["dataLicenseUrl"], "license_sha256": upstream["licenseSha256"],
        "imported_original_records": 30, "unique_original_records": len(seen_ids), "executable_variants": len(cases),
        "categories": dict(Counter(case["category"] for case in cases)), "cases_sha256": sha(output.encode()),
        "source_manifest_sha256": sha((SOURCE / "manifest.json").read_bytes()),
        "source_originals": "../../data/upstream/bfcl-v4-sample", "source_checksums": upstream["categories"],
        "selection": upstream["sampling"], "deduplication": "upstream ID and original line SHA256 checked before adapter generation",
        "seed": 17, "sampling_seed_used": False, "excluded_records": [],
        "scorer": "local strict schema/candidate checker with unordered bipartite call-set matching",
        "official_bfcl_score": False, "function_execution": "simulated_receipts_only",
        "limitations": ["No official AST checker or upstream function implementations are executed.",
                        "String alternatives are exact; lists are ordered unless source lists another ordering.",
                        "Empty-string candidate means omission, not literal empty argument.",
                        "Final answer semantics are not graded; six irrelevance cases test zero calls."],
        "runtime_dependencies": ["Python 3 standard library"],
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    shutil.copyfile(SOURCE / "LICENSE", ROOT / "LICENSE")
    print(json.dumps({"source": "bfcl", "originals": len(seen_ids), "executable": len(cases)}))


if __name__ == "__main__":
    main()
