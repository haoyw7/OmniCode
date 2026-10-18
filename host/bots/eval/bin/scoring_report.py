#!/usr/bin/env python3
"""Derive per-case scores from immutable local evidence; never calls a model.

Run: python3 host/bots/eval/bin/scoring_report.py --out /tmp/assistant-scores
Only raw runs explicitly labelled pi are agent attempts. The latest current
dataset attempt wins even if it failed. Replays, references and judge-only
extensions never create extra agent samples. Output paths must be new.
"""
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import html
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin"))
from eval_data import archive_root, cache_root, data_path, dataset_lock, ensure_data, require_external_output
SOURCES = ("bfcl", "longmemeval", "tau_bench", "api_bank", "hotpotqa", "bipia")
GATED = "reports/calibration-gated-final-2026-10-09"
CAMPAIGN = "reports/pi-breadth-2026-10-09"
LABELS = dict(zip(
    "intent planning retrieval files documents spreadsheets scheduling email memory recovery delegation reliability permissions security structured degradation".split(),
    "意图理解 规划与工具选择 检索与引用 文件操作 文档操作 表格操作 日程 邮件 记忆 中断恢复 并行委派 可靠性 权限与副作用 安全与隐私 结构化输出 工具降级".split(),
))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def evidence_path(relative, root=ROOT):
    """Archive remapping must preserve the existing evidence containment boundary."""
    path = data_path(relative, root=root)
    parts = Path(relative).parts
    if not parts:
        raise ValueError("Evidence path must identify a file")
    boundary = Path(root)
    if parts[0] == "reports" and (boundary / 'data/datasets.lock.json').exists():
        boundary = archive_root(root)
    else:
        for source, entry in dataset_lock(Path(root)).get('sources', {}).items():
            if Path(relative).as_posix() in entry['files']:
                boundary = cache_root(root) / source
                break
    if not path.resolve().is_relative_to(Path(boundary).resolve()):
        raise ValueError("Calibration evidence path escapes its source tree")
    return path


def load_catalog(root):
    ensure_data(("original", *SOURCES), root=root)
    catalog = {}
    for source, relative in [("original", "data/cases.jsonl")] + [
        (source, f"public/{source}/cases.jsonl") for source in SOURCES
    ]:
        path = data_path(relative, root=root)
        for line, case in enumerate(read_rows(path), 1):
            if case["id"] in catalog:
                raise ValueError(f"Duplicate catalog ID: {case['id']}")
            catalog[case["id"]] = {
                "id": case["id"], "dataset": source, "category": case["category"],
                "dimension": LABELS.get(case["category"], case["category"]),
                "origin": "original" if source == "original" else "public-adaptation",
                "upstream_id": case.get("upstream_id", case["id"]),
                "variant": case.get("variant", "original"),
                "support": case.get("support", "isolated-public-adaptation"),
                "scope": case.get("evaluation_scope", "local_hard_assertions"),
                "answer_semantics": case.get("answerSemantics"),
                "source": case.get("provenance", {}),
                "catalog_case_hash": hashlib.sha256(json.dumps(case, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest() if source != "original" else None,
                "catalog_evidence": f"{relative}:L{line}",
            }
    return catalog


def judge_record(raw, gated=None):
    judge = gated if gated is not None else raw
    if not judge:
        return {"status": "not_run", "formal_eligible": False, "formal_scores": None,
                "raw_reviews": [], "reason": "NO_JUDGE_RECORD"}
    status = judge.get("status", "unavailable")
    # A saved raw opinion is not calibration. Only the explicit trust-gated
    # artifact can authorize a score; never infer a pass from missing metadata.
    eligible = gated is not None and status == "scored" and judge.get("formalEligible") is True
    if status == "scored" and not eligible:
        status = "untrusted"
    reviews = judge.get("reviews", judge.get("rawResult", {}).get("reviews", []))
    return {"status": status, "formal_eligible": eligible,
            "formal_scores": [x.get("scores", {}) for x in reviews] if eligible else None,
            "raw_reviews": reviews,
            "reason": judge.get("reason", "NO_VERIFIED_CALIBRATION" if status == "untrusted" else None)}


def flatten_metrics(value, prefix=""):
    for name, item in value.items():
        key = f"{prefix}.{name}" if prefix else name
        if isinstance(item, dict):
            yield from flatten_metrics(item, key)
        elif isinstance(item, (bool, int, float)):
            yield key, item


def summarize(rows):
    tested = [row for row in rows if row["status"] in ("passed", "failed") and row["real_model_executed"]]
    passed = sum(row["status"] == "passed" for row in tested)
    return {"catalog_variants": len(rows),
            "catalog_originals": len({row["upstream_id"] for row in rows}),
            "executed_variants": sum(row["real_model_executed"] for row in rows),
            "executed_originals": len({row["upstream_id"] for row in rows if row["real_model_executed"]}),
            "passed": passed, "failed": len(tested) - passed, "denominator": len(tested),
            "pass_rate": passed / len(tested) if tested else None,
            "not_run": sum(row["status"] == "not_run" for row in rows),
            "excluded_statuses": dict(Counter(row["status"] for row in rows if row["status"] not in ("passed", "failed", "not_run")))}


def metric_summary(rows, key, predicate=lambda row: True):
    values = [dict(flatten_metrics(row["metrics"])).get(key) for row in rows
              if row["real_model_executed"] and predicate(row)]
    present = [value for value in values if value is not None]
    return {"sum": sum(present), "denominator": len(present),
            "mean": sum(present) / len(present) if present else None,
            "missing": len(values) - len(present)}


def build(root):
    reports = data_path("reports", root=root)
    if not reports.is_dir():
        raise FileNotFoundError("Historical reports are unavailable; set MONOCODE_EVAL_ARCHIVE_ROOT to the archive containing reports/")
    catalog = load_catalog(root)
    evidence = {}

    def logical(path):
        try:
            return str(Path("reports") / path.relative_to(reports))
        except ValueError:
            return str(path.relative_to(root))

    def remember(path):
        evidence[logical(path)] = sha(path)

    for relative in ["data/cases.jsonl", "data/judge-calibration.json"] + [
        f"public/{source}/cases.jsonl" for source in SOURCES
    ]:
        evidence[relative] = sha(data_path(relative, root=root))
    gated_path = evidence_path(f"{GATED}/results.jsonl", root)
    gated_summary = evidence_path(f"{GATED}/summary.json", root)
    gated = {}
    if gated_path.exists():
        # Refuse a stale trust snapshot. Re-run the existing offline replay first
        # after changing the registry; this report does not implement a second judge.
        summary = json.loads(gated_summary.read_text())
        registry = json.loads((root / "data/judge-calibration.json").read_text())
        if summary["calibrationRegistry"] != registry:
            raise ValueError("Trust snapshot differs from current calibration registry; refresh the offline replay")
        for record in registry["records"]:
            for item in record.get("evidence", []):
                p = evidence_path(item["path"], root)
                if sha(p) != item["sha256"]:
                    raise ValueError("Calibration evidence hash mismatch")
                remember(p)
        gated = {(f"{CAMPAIGN}/{row['sourceRun']}", row["id"]): row for row in read_rows(gated_path)}
        remember(gated_path); remember(gated_summary)

    attempts, runs, framework = [], [], []
    dataset_hash = sha(data_path("data/cases.jsonl", root=root))
    for summary_path in sorted(reports.rglob("summary.json")):
        evidence_path(logical(summary_path), root)
        summary = json.loads(summary_path.read_text())
        result_path = evidence_path(logical(summary_path.with_name("results.jsonl")), root)
        manifest_path = evidence_path(logical(summary_path.with_name("manifest.json")), root)
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        mode = manifest.get("mode", summary.get("mode"))
        if mode == "reference":
            framework.append({"run_id": logical(summary_path.parent),
                              "kind": "reference_only", "evidence": logical(summary_path),
                              "sha256": sha(summary_path), "cases": summary.get("cases", summary.get("total")),
                              "statuses": summary.get("statuses", summary.get("sources")),
                              "real_model_executed": False})
            continue
        if mode != "pi" or not result_path.exists():
            continue
        remember(summary_path); remember(result_path)
        if manifest_path.exists():
            remember(manifest_path)
        run_id = logical(result_path.parent)
        config = {"mode": mode, "seed": manifest.get("seed", summary.get("seed")),
                  "model": manifest.get("model"), "dataset_sha256": summary.get("datasetSha256"),
                  "max_steps": manifest.get("maxSteps"), "timeout_ms": manifest.get("timeoutMs"),
                  "budget": manifest.get("budget", summary.get("budget")),
                  "implementation_files": manifest.get("implementationFiles"),
                  "source_files": manifest.get("sourceFiles")}
        when = manifest.get("createdAt", summary.get("startedAt"))
        if not when:
            raise ValueError(f"Run has no timestamp: {run_id}")
        seen = set()
        for line, result in enumerate(read_rows(result_path), 1):
            case_id = result["id"]
            if case_id not in catalog or case_id in seen:
                raise ValueError(f"Unknown or duplicate run case: {run_id}: {case_id}")
            seen.add(case_id)
            case = catalog[case_id]
            usage = result.get("agentUsage", result.get("usage", {}))
            real = result.get("mode", "").startswith("real-") and usage.get("requests", 0) > 0
            grade = result.get("grade", {})
            checks = result.get("checks", grade.get("checks", []))
            current = (result.get("caseHash") == case["catalog_case_hash"] if case["dataset"] != "original"
                       else summary.get("datasetSha256") == dataset_hash)
            trusted = gated.get((run_id, case_id))
            if trusted is not None and (trusted.get("caseHash") != result.get("caseHash") or trusted["status"] != result["status"] or trusted.get("checks") != checks):
                raise ValueError(f"Gated replay no longer matches raw run: {case_id}")
            judge = judge_record(result.get("judge"), trusted.get("judge") if trusted else None)
            failed = [check for check in checks if check.get("passed") is False]
            reasons = ([result["error"]] if result.get("error") else []) + [
                check.get("name") or json.dumps(check.get("assertion", {}), ensure_ascii=False, sort_keys=True)
                for check in failed]
            attempts.append({**case, "run_id": run_id, "timestamp": when,
                "config": {**config, "model": config["model"] or (usage.get("models") or [None])[0]},
                "case_hash": result.get("caseHash"), "matches_current_dataset": current,
                "real_model_executed": real, "status": result["status"],
                "score": int(result["status"] == "passed") if real and result["status"] in ("passed", "failed") else None,
                "denominator": int(real and result["status"] in ("passed", "failed")),
                "checks": checks, "metrics": grade.get("metrics", {}), "judge": judge,
                "failure_reason": "; ".join(reasons) or (None if result["status"] == "passed" else "No recorded fine-grained reason"),
                "evidence": f"{logical(result_path)}:L{line}",
                "judge_evidence": logical(gated_path) if trusted and trusted.get("judge") else None,
                "usage": result.get("usage", {}), "agent_usage": result.get("agentUsage"),
                "transport": result.get("transport"), "selected": False})
        runs.append({"run_id": run_id, "timestamp": when, "config": config,
                     "attempts": len(seen), "usage": summary.get("usage"),
                     "evidence": logical(summary_path)})

    latest = {}
    for attempt in sorted(attempts, key=lambda item: (item["timestamp"], item["run_id"])):
        if attempt["matches_current_dataset"]:
            latest[attempt["id"]] = attempt
    cases = []
    for case in catalog.values():
        attempt = latest.get(case["id"])
        if attempt is None:
            cases.append({**case, "run_id": None, "timestamp": None, "config": None,
                          "real_model_executed": False, "status": "not_run", "score": None,
                          "denominator": 0, "checks": [], "metrics": {}, "judge": judge_record(None),
                          "failure_reason": "N/A: no current-dataset real run", "evidence": None,
                          "judge_evidence": None, "usage": None, "agent_usage": None, "selected": False})
        else:
            attempt["selected"] = True
            cases.append(attempt)
    datasets = {source: summarize([row for row in cases if row["dataset"] == source]) for source in ("original", *SOURCES)}
    dimensions = {f"{source}/{category}": summarize([row for row in cases if row["dataset"] == source and row["category"] == category])
                  for source, category in sorted({(row["dataset"], row["category"]) for row in cases})}
    public_rows = [row for row in cases if row["dataset"] != "original"]
    bipia = [row for row in cases if row["dataset"] == "bipia"]
    hotpot = [row for row in cases if row["dataset"] == "hotpotqa"]
    memory = [row for row in cases if row["dataset"] == "longmemeval"]
    special = {
        "bipia_answer_clean": metric_summary(bipia, "answer_correct", lambda row: row["variant"] == "clean"),
        "bipia_answer_attacked": metric_summary(bipia, "answer_correct", lambda row: row["variant"] == "attacked"),
        "bipia_attack_success_lower_is_better": metric_summary(bipia, "attack_success", lambda row: row["metrics"].get("attack_metric_applicable") is True),
        "hotpot_recorded_official_formula_metrics": {key: metric_summary(hotpot, f"official.{key}") for key in ("em", "f1", "sp_em", "sp_f1", "joint_em", "joint_f1")},
        "hotpot_local_output_gate": {"passed": sum(any(check.get("name") == "local_output_format" and check.get("passed") for check in row["checks"]) for row in hotpot if row["real_model_executed"]),
                                      "denominator": sum(any(check.get("name") == "local_output_format" for check in row["checks"]) for row in hotpot if row["real_model_executed"])},
        "longmemeval_evidence_retrieval": metric_summary(memory, "oracle_evidence_retrieval_accuracy"),
        "longmemeval_strict_answer": metric_summary(memory, "local_oracle_strict_answer_accuracy"),
        "longmemeval_retrieval_only": summarize([row for row in memory if row["category"] == "single-session-preference"]),
    }
    judges = Counter(row["judge"]["status"] for row in cases if row["dataset"] == "original" and row["real_model_executed"])
    summary = {"schema_version": 1, "additional_model_requests": 0,
               "selection": "Latest timestamp then run ID per stable ID among current-dataset raw pi attempts, regardless of outcome; all attempts retained separately.",
               "scope": "Real Pi inference with product prompt and isolated tools; not live Host/UI E2E; no official leaderboard claim or combined original/public score.",
               "datasets": datasets, "dimensions": dimensions,
               "public_adaptations_only": {**summarize(public_rows),
                    "catalog_originals": len({(row['dataset'], row['upstream_id']) for row in public_rows}),
                    "executed_originals": len({(row['dataset'], row['upstream_id']) for row in public_rows if row['real_model_executed']})},
               "special_metrics": special, "judge_statuses_original": dict(judges),
               "formal_judge_denominator": sum(row["judge"]["formal_eligible"] for row in cases),
               "formal_judge_score": None, "raw_agent_attempt_rows": len(attempts),
               "reference_runs": framework, "agent_runs": runs, "input_sha256": evidence}
    return cases, attempts, summary


def csv_value(value):
    if value is None:
        return "N/A"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    text = str(value)
    return "'" + text if text.startswith(("=", "+", "-", "@", "\t", "\r")) else text


def write_csv(path, rows, fields):
    with path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: csv_value(row.get(key)) for key in fields} for row in rows)


def rate(item):
    return f"{item['passed']}/{item['denominator']}" if item["denominator"] else "N/A (0)"


def write_report(root, out):
    root, out = root.resolve(), out.resolve()
    require_external_output(out, root)
    if out.exists():
        raise ValueError("Output must be a new directory; historical reports are immutable")
    if out == root or out in root.parents or any(out == root / name or root / name in out.parents for name in ("public", "data", "src", "tests", "bin")):
        raise ValueError("Output must not be inside source/data trees")
    cases, attempts, summary = build(root)
    out.mkdir(parents=True)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    for name, rows in (("cases", cases), ("attempts", attempts)):
        (out / f"{name}.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
        fields = ["id", "dataset", "origin", "dimension", "category", "upstream_id", "variant", "support", "scope", "answer_semantics",
                  "status", "score", "denominator", "real_model_executed", "run_id", "timestamp", "selected", "matches_current_dataset",
                  "config", "failure_reason", "checks", "metrics", "judge", "usage", "agent_usage", "evidence", "judge_evidence", "catalog_evidence", "source"]
        write_csv(out / f"{name}.csv", rows, fields)
    checks = []
    for row in attempts:
        for index, check in enumerate(row["checks"]):
            checks.append({"id": row["id"], "dataset": row["dataset"], "run_id": row["run_id"], "selected": row["selected"],
                           "index": index, "name": check.get("name", check.get("assertion")), "passed": check.get("passed"),
                           "denominator": 1 if isinstance(check.get("passed"), bool) else 0,
                           "evidence": check.get("evidence"), "record": row["evidence"]})
    write_csv(out / "checks.csv", checks, ["id", "dataset", "run_id", "selected", "index", "name", "passed", "denominator", "evidence", "record"])
    lines = ["# 助理 Eval 逐项评分 / Per-case scores", "",
             "此报告仅重读已有真实运行，新增模型请求为 0。原创与公开改编分开；没有合成总分或百分制权重。", "",
             "真实执行范围是 Pi + 产品 brain prompt + 隔离工具，并非完整 Host/UI 端到端。每个 stable ID 选当前数据版本中时间最新的一次，无论通过或失败；旧版本与重复运行保留在 attempts.csv，不增加样本分母。", "",
             "judge 校准失败：原始分数仅供诊断，标记 untrusted，有效 judge/复合评分 N/A。N/A 表示未运行/无该指标，不是 0 分。", "",
             "## 数据集", "", "| 数据集 | 通过/有效分母 | 实测变体/目录 | 实测原题/原题 | 未运行 |", "|---|---:|---:|---:|---:|"]
    for source, item in summary["datasets"].items():
        lines.append(f"| {source} | {rate(item)} | {item['executed_variants']}/{item['catalog_variants']} | {item['executed_originals']}/{item['catalog_originals']} | {item['not_run']} |")
    lines += ["", "## 能力维度（按数据集分开）", "", "| 数据集/维度 | 通过/分母 | 未运行 |", "|---|---:|---:|"]
    for key, item in summary["dimensions"].items():
        lines.append(f"| {key} | {rate(item)} | {item['not_run']} |")
    lines += ["", "## 指标边界", "",
        "BIPIA：答案正确率和攻击成功率分开；ASR 分母仅限 attacked。clean/attack 是同一原题的配对变体。", "",
        "HotpotQA：保留原记录 official 字段（官方公式指标），另列本地输出协议门槛；本批格式错误时适配器按约定写 0，因此这些 0 不能证明语义推理为 0，也不是官方榜单成绩。", "",
        "LongMemEval：oracle 证据检索和严格答案指标分别统计；3 条 preference 仅检索、答案语义未判，本次均未真实运行。", "", "```json", json.dumps(summary["special_metrics"], ensure_ascii=False, indent=2), "```", "",
        "## 每个用例", "", "未运行的用例保留目录证据；已运行用例的全部硬断言、原始指标、judge 诊断和配置见 CSV / JSONL 与 HTML 展开项。", "",
        "| stable ID | 数据集/维度 | 评分/分母 | 真实执行 | run ID | 失败原因 | 证据 |", "|---|---|---|---|---|---|---|"]
    def md(value):
        return str(value or "N/A").replace("|", "\\|").replace("\n", " ")
    for row in cases:
        score = f"{row['score']}/{row['denominator']} ({row['status']})" if row["denominator"] else "N/A"
        lines.append("| " + " | ".join(map(md, [row["id"], f"{row['dataset']}/{row['category']}", score, row["real_model_executed"], row["run_id"], row["failure_reason"], row["evidence"] or row["catalog_evidence"]])) + " |")
    lines += ["", "## 框架验证，非助理得分", "", f"保留 {len(summary['reference_runs'])} 个历史 reference 运行索引，详见 summary.json.reference_runs。单元测试与迁移回放结果见 ../migration-2026-10-09/verification.json；绝不进入上述能力分母。", "",
        "## 刷新", "", "仓库根目录：", "```bash", "python3 host/bots/eval/bin/scoring_report.py --out /tmp/assistant-scores-NEW", "```", "",
        "或进入 host/bots/eval 后运行 `python3 bin/scoring_report.py --out /tmp/assistant-scores-NEW`。输出必须是源码目录外的新目录。reports/ 证据路径以 MONOCODE_EVAL_ARCHIVE_ROOT 归档为基准；:L 后为 JSONL 行号。", "",
        "历史原记录/报告字节不变，输入 SHA-256 列于 summary.json。旧报告内 eval/ 的绝对路径按 docs/MIGRATION.md 映射到新位置。"]
    (out / "scores.md").write_text("\n".join(lines) + "\n")
    h = html.escape
    parts = ['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>助理 Eval 逐项评分</title>',
             '<style>body{font:16px/1.6 system-ui,sans-serif;max-width:1120px;margin:auto;padding:20px;color:#172438;background:#f5f7fa;overflow-wrap:anywhere}h1{font-size:26px}table{border-collapse:collapse;table-layout:fixed;width:100%;background:white}th,td{border:1px solid #ccd5df;padding:7px;text-align:left;overflow-wrap:anywhere}details{background:white;border:1px solid #d4dce5;border-radius:8px;margin:8px 0;padding:12px}summary{cursor:pointer;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}small{color:#52647a}.pass{color:#136b3b}.fail{color:#af2634}a{color:#155fa4}</style>',
             '<h1>助理 Eval 逐项评分</h1><p>已有真实运行证据 · 新增模型请求 0 · 每个 stable ID 一项</p>',
             '<p>Pi + 产品 prompt + 隔离工具；非 Host/UI 端到端。原创与公开改编分别统计。judge 未通过校准，正式分数 N/A；未运行不记 0 分。历史复跑不增加样本量。</p>',
             '<h2>数据集</h2><table><tr><th>来源</th><th>通过/分母</th><th>实测/全部变体</th><th>实测/全部原题</th></tr>']
    for source, item in summary["datasets"].items():
        parts.append(f"<tr><td>{source}</td><td>{rate(item)}</td><td>{item['executed_variants']}/{item['catalog_variants']}</td><td>{item['executed_originals']}/{item['catalog_originals']}</td></tr>")
    parts += ['</table><h2>能力维度</h2><table><tr><th>数据集/维度</th><th>通过/分母</th><th>未运行</th></tr>']
    for key, item in summary["dimensions"].items():
        parts.append(f"<tr><td>{h(key)}</td><td>{rate(item)}</td><td>{item['not_run']}</td></tr>")
    parts += ['</table><h2>指标边界</h2><p>BIPIA 答案与攻击成功率分开，ASR 仅 attacked；Hotpot official 字段的格式失败归零与本地协议门槛分列；LongMemEval preference 仅检索，答案 N/A。</p>',
              '<details><summary>查看特殊指标及分母</summary><pre>' + h(json.dumps(summary["special_metrics"], ensure_ascii=False, indent=2)) + '</pre></details>',
              '<h2>逐项结果</h2><p>展开可查看所有程序性检查、原始 judge 诊断、run 配置及证据。相同用例的历次运行列在同一项内。</p>']
    by_case = defaultdict(list)
    for attempt in attempts:
        by_case[attempt["id"]].append(attempt)
    for row in cases:
        score = f"{row['score']}/{row['denominator']}" if row["denominator"] else "N/A"
        color = 'pass' if row["status"] == "passed" else 'fail' if row["status"] == "failed" else ''
        details = {"selected": row, "all_attempts": by_case[row["id"]]}
        parts.append(f'<details><summary><b class="{color}">{score} {h(row["status"])}</b> · {h(row["id"])}<br><small>{h(row["dataset"]+" / "+row["dimension"])}</small></summary><pre>{h(json.dumps(details,ensure_ascii=False,indent=2))}</pre></details>')
    parts.append('<h2>框架验证</h2><p>Reference 回放和单元测试仅验证框架，不进入助理评分。原始输入哈希、运行清单及完整数据随 CSV/JSON 文件交付；此 HTML 不依赖网络或脚本。</p></html>')
    (out / "scores.html").write_text("\n".join(parts))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    summary = write_report(ROOT, args.out)
    print(json.dumps({"output": str(args.out.resolve()), "datasets": summary["datasets"],
                      "attempts": summary["raw_agent_attempt_rows"], "additional_model_requests": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
