"""Rebuild the fixed 48-record subset from a checksum-locked public parquet file.

Only this opt-in import command needs pyarrow (tested with 23.0.1). The adapter,
reference mode and tests require no third-party package or network access.
"""
import argparse
from collections import Counter, defaultdict
import copy
import hashlib
import json
from pathlib import Path
import random


ROOT = Path(__file__).resolve().parent
SEED = 17
REVISION = "1908d6afbbead072334abe2965f91bd2709910ab"
SOURCE_SHA256 = "c20b638ca82b21d04fe12e14ff417ad05153d4d215a65de54497fca4e972f7c6"
OFFICIAL_URL = "http://curtis.ml.cmu.edu/datasets/hotpot/hotpot_dev_distractor_v1.json"
MIRROR_URL = f"https://huggingface.co/datasets/hotpotqa/hotpot_qa/resolve/{REVISION}/distractor/validation-00000-of-00001.parquet"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
CODE_REVISION = "3635853403a8735609ee997664e1528f4480762a"
VARIANT = "offline_distractor_tools_v1"
ENV_REQUIREMENT = "Python 3.10+ standard library; no network, model, credentials, external tools or persistent mutation at runtime"
TRANSFORMATION = (
    "HF parquet row preserved in original/hf_records.json; lossless field reconstruction: id -> _id, "
    "supporting_facts.title/sent_id -> ordered pairs, context.title/sentences -> ordered pairs. "
    "Question, answer, type, level and all original sentence strings retained without rewriting. "
    "Episode prompt adds local tool/output-format instructions and unlabelled titles; complete context is exposed by read_passage. "
    "Gold answer and support labels are private. Local final JSON uses answer/supporting_facts; "
    "valid existing, unique and actually-read citations are additional local hard checks. "
    "CMU JSON byte identity was not verified; this is a pinned HF mirror reconstruction."
)


def canonical_sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def to_original(row):
    context, support = row["context"], row["supporting_facts"]
    if len(context["title"]) != len(context["sentences"]) or len(support["title"]) != len(support["sent_id"]):
        raise ValueError("Unaligned nested mirror fields")
    return {"_id": row["id"], "question": row["question"], "answer": row["answer"],
            "type": row["type"], "level": row["level"],
            "supporting_facts": [list(pair) for pair in zip(support["title"], support["sent_id"])],
            "context": [[title, copy.deepcopy(sentences)] for title, sentences in zip(context["title"], context["sentences"])]}


def select_records(rows, per_category=24):
    """Deduplicate before filtering/sampling; stable against input file row order."""
    groups = defaultdict(list)
    seen_ids, seen_hashes, seen_content = set(), set(), set()
    exclusions, duplicates = [], 0
    raw_distribution = Counter()
    for row in sorted(rows, key=lambda item: (item["id"], canonical_sha256(item))):
        raw_distribution[f'{row["type"]}/{row["level"]}'] += 1
        digest = canonical_sha256(row)
        content_digest = canonical_sha256({key: value for key, value in row.items() if key != "id"})
        if row["id"] in seen_ids or digest in seen_hashes or content_digest in seen_content:
            duplicates += 1
            continue
        seen_ids.add(row["id"])
        seen_hashes.add(digest)
        seen_content.add(content_digest)
        original = to_original(row)
        passages = dict(original["context"])
        reasons = []
        if len(original["context"]) != 10 or len(passages) != 10:
            reasons.append("requires_exactly_10_distinct_passages")
        if (not original["supporting_facts"] or any(
                title not in passages or type(index) is not int or not 0 <= index < len(passages[title])
                for title, index in original["supporting_facts"])):
            reasons.append("invalid_gold_support_index_or_title")
        if reasons:
            exclusions.append({"upstream_id": row["id"], "reasons": reasons})
            continue
        groups[f'{row["type"]}/{row["level"]}'].append(row)
    rng = random.Random(SEED)
    selected = []
    for category in sorted(groups):
        if len(groups[category]) < per_category:
            raise ValueError(f"Insufficient records in {category}")
        selected.extend(sorted(rng.sample(groups[category], per_category), key=lambda item: item["id"]))
    return selected, {
        "input_records": len(rows), "input_distribution": dict(sorted(raw_distribution.items())),
        "duplicate_rows_removed": duplicates, "excluded_records": len(exclusions),
        "exclusions": exclusions, "eligible_distribution": {key: len(value) for key, value in sorted(groups.items())},
        "selected_distribution": dict(sorted(Counter(f'{row["type"]}/{row["level"]}' for row in selected).items())),
        "seed": SEED, "per_category": per_category,
        "algorithm": "Sort by (upstream ID, canonical SHA256), remove duplicate IDs/canonical row SHA256/content SHA256 excluding ID, filter invalid gold references or non-10-distinct context, then Python Random(17).sample 24 per sorted type/level category; sort selected rows by ID within category.",
        "difficulty_limit": "All 7405 official dev/distractor mirror rows have level=hard. No easy or medium records exist in this split; no difficulty labels are invented.",
    }


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build(parquet_path):
    raw = parquet_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError("Source parquet SHA256 mismatch; refusing to import changed data")
    import pyarrow.parquet as pq
    rows = pq.read_table(parquet_path).to_pylist()
    selected, audit = select_records(rows)
    if len(selected) != 48:
        raise ValueError("Expected exactly 48 selected original records")
    originals = [to_original(row) for row in selected]
    (ROOT / "original").mkdir(exist_ok=True)
    write_json(ROOT / "original" / "hf_records.json", selected)
    write_json(ROOT / "original" / "records.json", originals)
    cases = []
    for row, original in zip(selected, originals):
        provenance = {
            "official_url": OFFICIAL_URL, "license": "CC-BY-SA-4.0", "license_url": LICENSE_URL,
            "revision": f"hf:hotpotqa/hotpot_qa@{REVISION}", "sha256": SOURCE_SHA256,
            "download_url": MIRROR_URL, "upstream_id": original["_id"], "split": "dev (HF validation)",
            "variant": VARIANT, "transformation": TRANSFORMATION, "seed": SEED,
            "env_requirement": ENV_REQUIREMENT, "source_record_sha256": canonical_sha256(row),
            "reconstructed_record_sha256": canonical_sha256(original),
            "official_json_byte_identity_verified": False,
        }
        cases.append({"id": f'hotpotqa/{original["_id"]}/{VARIANT}', "source": "hotpotqa",
                      "upstream_id": original["_id"], "category": f'{original["type"]}/{original["level"]}',
                      "variant": VARIANT, "provenance": provenance, "data": original})
    (ROOT / "cases.jsonl").write_text("".join(json.dumps(case, ensure_ascii=False) + "\n" for case in cases), encoding="utf-8")
    files = ["cases.jsonl", "original/hf_records.json", "original/records.json", "original/HF_DATASET_CARD.md",
             "original/HF_FILES.json", "LICENSE-CC-BY-SA-4.0.txt", "vendor/hotpot_evaluate_v1.py",
             "vendor/hotpot_evaluate_v1_stdlib.py", "vendor/LICENSE.txt", "adapter.py", "import_subset.py"]
    manifest = {
        "source": "hotpotqa", "status": "executable_offline_adapter", "variant": VARIANT,
        "upstream_records_seen": len(rows), "imported_original_records": len(cases),
        "executable_variants": len(cases), "distinct_upstream_ids": len({case["upstream_id"] for case in cases}),
        "source_data": {"official_url": OFFICIAL_URL, "official_https_url": OFFICIAL_URL.replace("http:", "https:"),
                        "official_homepage": "https://hotpotqa.github.io/", "download_url": MIRROR_URL,
                        "revision": REVISION, "sha256": SOURCE_SHA256, "bytes": len(raw),
                        "split": "dev", "mirror_split": "validation", "setting": "distractor",
                        "license": "CC-BY-SA-4.0", "license_url": LICENSE_URL,
                        "retrieved_utc_date": "2026-10-09", "official_json_byte_identity_verified": False,
                        "fallback_reason": "Official CMU HTTPS failed TLS unexpected EOF; HTTP requests timed out after 12 and 20 seconds. Used pinned public hotpotqa/hotpot_qa parquet mirror with SHA256 matching HF LFS metadata."},
        "official_grader": {"repository": "https://github.com/hotpotqa/hotpot", "revision": CODE_REVISION,
                            "file": "hotpot_evaluate_v1.py", "license": "Apache-2.0",
                            "copyright": "Copyright 2018 Zhilin Yang, Peng Qi, Saizheng Zhang",
                            "sha256": hashlib.sha256((ROOT / "vendor/hotpot_evaluate_v1.py").read_bytes()).hexdigest(),
                            "local_patch": "Only replace import ujson as json with import json; all metric functions and original CLI preserved.",
                            "audit": "Reviewed complete 130-line evaluator: normalization, answer/support set metrics, scalar joint calculation, file reads confined to opt-in CLI. No network, models, subprocesses or mutations. Imported module does not run CLI."},
        "selection": audit, "transformation": TRANSFORMATION,
        "env_requirement": ENV_REQUIREMENT,
        "rebuild_requirement": "pyarrow==23.0.1 only for opt-in parquet import; isolated /tmp installation used, no model framework installed",
        "scoring": {"official": list(("em", "f1", "prec", "recall", "sp_em", "sp_f1", "sp_prec", "sp_recall", "joint_em", "joint_f1", "joint_prec", "joint_recall")),
                    "local": ["JSON format", "existing citation title and sentence", "unique citations", "cited passages actually read in this Episode and matching trace"],
                    "passed": "All local hard checks and official joint_em == 1; report official metrics separately, unmodified by local read failures.",
                    "llm_judge": "not used", "reference": "Gold oracle scripts validate harness only; not an agent benchmark result."},
        "limits": ["48-record balanced subset, not full official benchmark", "Only upstream hard difficulty available in dev",
                   "Offline distractor grounding; no fullwiki retrieval or real-time web research", "HF mirror reconstructed fields; CMU original byte identity unverified",
                   "Human answer/support annotations may contain ambiguity; exact match is intentionally strict"],
        "files": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files},
    }
    write_json(ROOT / "manifest.json", manifest)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parquet", type=Path, required=True)
    result = build(parser.parse_args().parquet)
    print(json.dumps({"imported_original_records": result["imported_original_records"],
                      "executable_variants": result["executable_variants"], "selection": result["selection"]}, ensure_ascii=False))
