"""Build 18 local oracle variants without altering imported source records."""
import hashlib
import json
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[1] / "data" / "upstream" / "longmemeval-oracle-sample"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    upstream = json.loads((SOURCE / "manifest.json").read_text())
    source = SOURCE / "records.json"
    assert sha(source.read_bytes()) == upstream["subsetSha256"]
    records = json.loads(source.read_text())
    cases, seen_ids, seen_hashes = [], set(), set()
    for record in records:
        source_id = record["question_id"]
        digest = sha(json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode())
        assert source_id not in seen_ids and digest not in seen_hashes
        seen_ids.add(source_id)
        seen_hashes.add(digest)
        preference = record["question_type"] == "single-session-preference"
        variant = "oracle_evidence_retrieval_only_v1" if preference else "oracle_strict_answer_and_evidence_v1"
        provenance = {key: upstream[key] for key in ("official_url", "license_url", "revision", "split", "seed")}
        provenance.update({"sha256": digest, "sha256_scope": "canonical JSON original record; sorted keys, UTF-8, compact separators",
            "source_file_sha256": upstream["sha256"], "upstream_id": source_id, "variant": variant,
            "transformation": "full original retained privately; neutral session IDs; role/content only removes has_answer flags; tools expose oracle pool; strict final JSON",
            "env_requirement": "Python 3 stdlib; no network/inference; oracle retrieval only, not long-memory ingestion"})
        cases.append({"id": f"longmemeval/{source_id}/{variant}", "source": "longmemeval", "upstream_id": source_id,
                      "category": record["question_type"], "variant": variant, "provenance": provenance,
                      "evaluation_scope": "evidence_retrieval_only" if preference else "oracle_strict_answer_and_evidence",
                      "answerSemantics": "not_graded" if preference else "strict_normalized_match_or_abstention_only",
                      "data": {"original_record": record}})
    output = "".join(json.dumps(case, ensure_ascii=False) + "\n" for case in cases)
    (ROOT / "cases.jsonl").write_text(output)
    manifest = {
        "source": "longmemeval", "version": 1, "status": "executable_offline_oracle_adapter",
        "revision": upstream["revision"], "license": upstream["data_license"], "license_url": upstream["license_url"],
        "official_url": upstream["official_url"], "upstream_source_sha256": upstream["sha256"],
        "source_subset_sha256": upstream["subsetSha256"], "source_manifest_sha256": sha((SOURCE / "manifest.json").read_bytes()),
        "dataset_card_sha256": sha((SOURCE / "DATASET_CARD.md").read_bytes()),
        "source_originals": "../../data/upstream/longmemeval-oracle-sample",
        "imported_original_records": len(records), "unique_original_records": len(seen_ids), "executable_variants": len(cases),
        "objective_answer_cases": 15, "abstention_cases": 4, "evidence_retrieval_only_cases": 3,
        "categories": dict(Counter(case["category"] for case in cases)), "cases_sha256": sha(output.encode()),
        "selection": upstream["sampling"], "deduplication": "upstream ID and canonical record SHA256 checked before adapter generation",
        "seed": 17, "excluded_records": [], "official_longmemeval_score": False,
        "runtime_dependencies": ["Python 3 standard library"],
        "limitations": ["Oracle sessions are a gold-selected small pool, not the official S/M memory setting.",
                        "All source answer sessions happen to be in this oracle pool; citation-set matching has limited discrimination.",
                        "15 cases use strict normalized answers/abstention plus actual reads and evidence sets; this is not semantic grading.",
                        "Three preference paragraphs are unsuitable for deterministic answer grading; answerSemantics:not_graded and retrieval-only metrics.",
                        "Upstream original IDs and has_answer fields are hidden from prompts/tools; neutral session handles are local."],
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    shutil.copyfile(SOURCE / "DATASET_CARD.md", ROOT / "DATASET_CARD.md")
    shutil.copyfile(SOURCE / "UPSTREAM_CODE_LICENSE", ROOT / "UPSTREAM_CODE_LICENSE")
    print(json.dumps({"source": "longmemeval", "originals": len(records), "executable": len(cases), "objective": 15, "retrieval_only": 3}))


if __name__ == "__main__":
    main()
