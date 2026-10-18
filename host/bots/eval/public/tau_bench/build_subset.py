"""Rebuild from an existing, locally audited checkout; never downloads or calls models."""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import json
import random
import shutil
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REVISION = "59a200c6d575d595120f1cb70fea53cef0632f6b"
URL = "https://github.com/sierra-research/tau-bench"
SEMANTIC_EXCLUSIONS = {
    "airline/test/16": "Reference issues delay compensation without the policy-required reservation change/cancellation; instruction requests compensation but no change/cancellation.",
    "airline/test/45": "Reference issues delay compensation without explicit compensation request or policy-required reservation change/cancellation; conversational correction timing is also absent locally.",
    "airline/test/46": "Reference issues delay compensation without explicit compensation request or policy-required reservation change/cancellation; mid-booking topic-switch behavior needs native interactive user simulator.",
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def decode(node):
    # Parse declarative Task/Action constructors without importing upstream Python.
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"Task", "Action"}:
        if node.args or any(k.arg is None for k in node.keywords):
            raise ValueError("unexpected positional/expanded source task")
        return {k.arg: decode(k.value) for k in node.keywords}
    if isinstance(node, (ast.List, ast.Tuple)):
        return [decode(value) for value in node.elts]
    if isinstance(node, ast.Dict):
        return {decode(k): decode(v) for k, v in zip(node.keys, node.values)}
    return ast.literal_eval(node)


def main(source):
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise ValueError("source revision mismatch")
    vendor = ROOT / "private" / "upstream"
    paths = [Path(p) for p in ["LICENSE", "README.md", "setup.py", "tau_bench/types.py",
                               "tau_bench/envs/base.py", "tau_bench/envs/tool.py"]]
    for domain in ("retail", "airline"):
        base = Path("tau_bench/envs") / domain
        paths.extend(base / filename for filename in ("tasks_test.py", "rules.py", "wiki.md", "env.py"))
        paths.extend(f.relative_to(source) for f in (source / base / "tools").glob("*.py"))
        paths.extend(f.relative_to(source) for f in (source / base / "data").glob("*.*"))
    inventory = []
    for path in sorted(paths):
        target = vendor / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / path, target)
        inventory.append({"path": str(path), "sha256": digest(target.read_bytes()), "bytes": target.stat().st_size})
    shutil.copyfile(source / "LICENSE", ROOT / "LICENSE")

    spec = importlib.util.spec_from_file_location("tau_subset_builder_adapter", ROOT / "adapter.py")
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    records = []
    candidates = {}
    exclusions = []
    before_counts = {}
    seen_hashes = set()
    seen_ids = set()
    for domain in ("retail", "airline"):
        path = vendor / "tau_bench/envs" / domain / "tasks_test.py"
        module = ast.parse(path.read_text())
        assignment = next(n for n in module.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id.startswith("TASKS") for t in n.targets))
        tasks = decode(assignment.value)
        before_counts[domain] = len(tasks)
        candidates[domain] = []
        for index, task in enumerate(tasks):
            upstream_id = f"{domain}/test/{index}"
            raw = json.dumps(task, sort_keys=True, separators=(",", ":")).encode()
            sha = digest(raw)
            original = {"upstream_id": upstream_id, "sha256": sha, "record": task}
            records.append(original)
            reason = None
            if upstream_id in seen_ids or sha in seen_hashes:
                reason = "duplicate_id_or_record_sha256"
            seen_ids.add(upstream_id)
            seen_hashes.add(sha)
            if reason is None and upstream_id in SEMANTIC_EXCLUSIONS:
                reason = "semantic_or_interactive_protocol_mismatch"
            case = {
                "id": f"tau_bench/{upstream_id}/{adapter.VARIANT}",
                "source": "tau_bench", "upstream_id": upstream_id,
                "category": f"customer_service/{domain}", "variant": adapter.VARIANT,
                "provenance": {
                    "official_url": URL, "license_url": f"{URL}/blob/{REVISION}/LICENSE",
                    "revision": REVISION, "sha256": sha, "source_file_sha256": digest(path.read_bytes()),
                    "upstream_id": upstream_id, "split": "test", "variant": adapter.VARIANT,
                    "transformation": "Verbatim user-simulator instruction disclosed as a complete brief; local advance authorization replaces interactive confirmation. Native database/tools and full-state reward semantics retained; bounded calculator and nonempty-final check added.",
                    "seed": 17, "env_requirement": "Python 3.10+ stdlib only; bundled complete mock databases; no network, credentials, model, simulator, or provider dependencies",
                },
                "data": {"domain": domain, "original_record": task},
            }
            if reason is None:
                episode = adapter.Episode(case)
                initial_hash = adapter.state_hash(episode.state)
                results = []
                for action in task["actions"]:
                    if action["name"] in {"respond", "transfer_to_human_agents"}:
                        continue
                    result = episode.call(action["name"], action["kwargs"])
                    if not result["ok"]:
                        results.append({"action": action["name"], "error": result["error"]})
                if results:
                    reason = "upstream_reference_error"
                elif adapter.state_hash(episode.state) == initial_hash:
                    reason = "no_database_change_excluded_from_state_transition_subset"
            if reason:
                exclusion = {"upstream_id": upstream_id, "reason": reason}
                if reason == "upstream_reference_error":
                    exclusion["evidence"] = results
                elif reason == "semantic_or_interactive_protocol_mismatch":
                    exclusion["evidence"] = SEMANTIC_EXCLUSIONS[upstream_id]
                exclusions.append(exclusion)
            else:
                candidates[domain].append(case)

    selected = []
    eligible_counts = {domain: len(cases) for domain, cases in candidates.items()}
    for domain in ("retail", "airline"):
        rng = random.Random(17)
        pool = list(candidates[domain])
        rng.shuffle(pool)
        covered_actions = set()
        covered_signatures = set()
        output_seen = False
        for _ in range(min(12, len(pool))):
            def value(case):
                task = case["data"]["original_record"]
                names = tuple(action["name"] for action in task["actions"])
                return (10 * len(set(names) - covered_actions)
                        + 4 * (names not in covered_signatures)
                        + 6 * (bool(task["outputs"]) and not output_seen)
                        + min(len(names), 4))
            chosen = max(pool, key=value)
            pool.remove(chosen)
            selected.append(chosen)
            task = chosen["data"]["original_record"]
            names = tuple(action["name"] for action in task["actions"])
            covered_actions.update(names)
            covered_signatures.add(names)
            output_seen = output_seen or bool(task["outputs"])
        exclusions.extend({"upstream_id": case["upstream_id"], "reason": "not_selected_by_seed17_action_coverage_quota"} for case in pool)
    selected.sort(key=lambda case: (case["data"]["domain"], int(case["upstream_id"].split("/")[-1])))
    (ROOT / "cases.jsonl").write_text("".join(json.dumps(case, ensure_ascii=False) + "\n" for case in selected))
    (ROOT / "private" / "original_records.jsonl").write_text("".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records))
    manifest = {
        "source": "tau_bench", "official_url": URL, "revision": REVISION,
        "upstream_version": "0.1.0", "license": "MIT", "license_url": f"{URL}/blob/{REVISION}/LICENSE",
        "license_evidence": "Repository LICENSE applies to source and bundled mock data; no separate data license or data restriction found. Retail data/readme.md explicitly permits reuse. Copyright 2024 Sierra retained.",
        "imported_original_records": len(records), "original_counts_by_domain": before_counts,
        "selected_distinct_original_records": len(selected), "executable_variants": len(selected),
        "variant_counts": {adapter.VARIANT: len(selected)},
        "selected_counts_by_domain": dict(Counter(case["data"]["domain"] for case in selected)),
        "eligible_counts_by_domain": eligible_counts, "seed": 17, "split": "test",
        "selection": "AST-extract all pinned test records, deduplicate by ID and canonical record SHA256 before selection; exclude three documented compensation/protocol mismatches; replay references on full databases; exclude reference errors and unchanged database. Per domain shuffle seed17 then greedy cover action names (weight10), action-sequence signatures (weight4), output-bearing record (weight6), capped sequence length (weight1,max4); select12. Fixed sorted source order breaks equal scores via seeded shuffle.",
        "exclusions": exclusions, "exclusion_counts": dict(Counter(e["reason"] for e in exclusions)),
        "files": inventory, "cases_sha256": digest((ROOT / "cases.jsonl").read_bytes()),
        "original_records_sha256": digest((ROOT / "private" / "original_records.jsonl").read_bytes()),
        "execution_status": "offline_executable_local_adaptation",
        "native_scope": "All native domain tools and full original mock databases; calculate replaced. Native to_hashable/consistent_hash equality of final entire database after reference action replay, and required output substring rule.",
        "local_metric": "local_state_transition_accuracy = native_state_match AND native_outputs_match AND nonempty_final; final is the sole assistant response considered for required outputs",
        "official_tau_score": False,
        "limitations": [
            "Pinned upstream README says these tasks are outdated and points to tau2-bench/tau3; this is versioned legacy tau-bench, not current tau3.",
            "Fully disclosed simulator instructions and pre-authorization remove interactive elicitation and confirmation evaluation; not comparable with published tau scores/pass^k.",
            "Native mock API bugs are preserved (for example flight update does not set cabin, and flight seat database updates are omitted upstream). State equality measures the pinned implementation rather than all policy semantics.",
            "Selection favors executable mutation/action coverage; no representativeness or complete policy-compliance claim. No-op, transfer-only, and pure informational tasks are excluded.",
            "No model calls or live user simulator; reference scripts validate harness only. No LLM judge is used or trusted.",
            "Local defenses reject unknown fields and resource-heavy arithmetic, wrap results in JSON, and roll back tool failures. These boundary behaviors differ from native Env.step.",
        ],
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({key: manifest[key] for key in ("imported_original_records", "selected_distinct_original_records", "selected_counts_by_domain", "eligible_counts_by_domain", "exclusion_counts")}, indent=2))
    for case in selected:
        print(case["upstream_id"], [a["name"] for a in case["data"]["original_record"]["actions"]], "outputs=", case["data"]["original_record"]["outputs"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    main(parser.parse_args().source)
