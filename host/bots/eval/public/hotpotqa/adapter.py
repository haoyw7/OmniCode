"""Offline HotpotQA distractor episodes; runtime is Python standard library only.

The pinned official evaluator is only changed from ujson to stdlib json in the
vendor copy imported below. Local format, citation and read checks are separate
from the upstream answer/supporting-fact/joint metrics.
"""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(ROOT.parents[1] / "bin"))
from eval_data import data_path
_SPEC = importlib.util.spec_from_file_location(
    "hotpotqa_official_stdlib", ROOT / "vendor" / "hotpot_evaluate_v1_stdlib.py"
)
_OFFICIAL = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_OFFICIAL)
METRIC_NAMES = (
    "em", "f1", "prec", "recall", "sp_em", "sp_f1", "sp_prec", "sp_recall",
    "joint_em", "joint_f1", "joint_prec", "joint_recall",
)


def load_cases():
    """Load private grader records; only Episode.start() may enter model input."""
    return [json.loads(line) for line in data_path("public/hotpotqa/cases.jsonl").read_text().splitlines() if line.strip()]


def official_metrics(answer, supporting_facts, record):
    """Use upstream update functions and the exact upstream joint calculation."""
    metrics = dict.fromkeys(METRIC_NAMES, 0.0)
    em, prec, recall = _OFFICIAL.update_answer(metrics, answer, record["answer"])
    sp_em, sp_prec, sp_recall = _OFFICIAL.update_sp(metrics, supporting_facts, record["supporting_facts"])
    joint_prec = prec * sp_prec
    joint_recall = recall * sp_recall
    if joint_prec + joint_recall > 0:
        joint_f1 = 2 * joint_prec * joint_recall / (joint_prec + joint_recall)
    else:
        joint_f1 = 0.
    metrics.update(joint_em=float(em * sp_em), joint_f1=joint_f1,
                   joint_prec=joint_prec, joint_recall=joint_recall)
    return metrics


def _read_result(title, sentences):
    return {"title": title, "sentences": [{"index": index, "text": text} for index, text in enumerate(sentences)]}


class Episode:
    def __init__(self, case, seed=17):
        self._record = copy.deepcopy(case["data"])
        self._passages = dict(self._record["context"])
        self._read_titles = set()
        self.seed = seed

    def start(self):
        """Reset only episode state and reveal the question and unlabelled titles."""
        self._read_titles.clear()
        tools = [
            {"name": "search_passages",
             "description": "Search only the ten local passages for this question. Results are unlabelled previews. Read passages before citing them.",
             "parameters": {"type": "object", "properties": {
                 "query": {"type": "string", "minLength": 1, "maxLength": 1000},
                 "limit": {"type": "integer", "minimum": 1, "maximum": 10}},
                 "required": ["query"], "additionalProperties": False}},
            {"name": "read_passage", "description": "Read one complete local passage by exact title, with its original zero-based sentence indices.",
             "parameters": {"type": "object", "properties": {"title": {"type": "string"}},
                            "required": ["title"], "additionalProperties": False}},
        ]
        prompt = (
            "Answer the following question using the supplied local HotpotQA distractor passages. "
            "This is an offline snapshot. Search and read tools access only these ten passages.\n\n"
            + self._record["question"]
            + "\n\nAvailable passage titles (unlabelled):\n"
            + json.dumps(list(self._passages), ensure_ascii=False)
            + '\n\nReturn exactly one JSON object: {"answer":"a concise answer",'
              '"supporting_facts":[["Exact passage title",0]]}. '
              "Use each original zero-based sentence index and include all sentences needed to support the answer. "
              "Every cited passage must first be read using read_passage during this episode. "
              "Do not add Markdown fences or other fields."
        )
        return {"prompt": prompt, "tools": tools}

    def call(self, action, arguments):
        """Whitelist local reads and deterministic lexical search; no external I/O."""
        if not isinstance(arguments, dict):
            return {"error": "invalid_arguments", "message": "Arguments must be an object."}
        if action == "read_passage":
            if set(arguments) != {"title"} or not isinstance(arguments["title"], str):
                return {"error": "invalid_arguments", "message": "Supply only a string title."}
            title = arguments["title"]
            if title not in self._passages:
                return {"error": "unknown_title", "message": "The title is not in this episode's passages."}
            self._read_titles.add(title)
            return _read_result(title, self._passages[title])
        if action == "search_passages":
            query, limit = arguments.get("query"), arguments.get("limit", 5)
            if (not {"query"} <= set(arguments) <= {"query", "limit"}
                    or not isinstance(query, str) or not query.strip() or len(query) > 1000
                    or type(limit) is not int or not 1 <= limit <= 10):
                return {"error": "invalid_arguments", "message": "Supply a nonempty query of at most 1000 characters and an optional integer limit from 1 to 10."}
            terms = set(re.findall(r"\w+", query.casefold()))
            ranked = []
            for order, (title, sentences) in enumerate(self._record["context"]):
                title_terms = set(re.findall(r"\w+", title.casefold()))
                text_terms = set(re.findall(r"\w+", " ".join(sentences).casefold()))
                score = 3 * len(terms & title_terms) + len(terms & text_terms)
                if score:
                    ranked.append((score, order, {"title": title, "score": score,
                                                  "preview": sentences[0] if sentences else ""}))
            ranked.sort(key=lambda item: (-item[0], item[1]))
            return {"results": [item[2] for item in ranked[:limit]], "scope": "local_distractor_passages"}
        return {"error": "unknown_action", "message": "Only search_passages and read_passage are available."}

    def grade(self, final, trace):
        metrics = dict.fromkeys(METRIC_NAMES, 0.0)
        try:
            prediction = json.loads(final) if isinstance(final, str) else None
        except (ValueError, TypeError):
            prediction = None
        valid_format = (
            isinstance(prediction, dict) and set(prediction) == {"answer", "supporting_facts"}
            and isinstance(prediction["answer"], str) and bool(prediction["answer"].strip())
            and isinstance(prediction["supporting_facts"], list)
            and bool(prediction["supporting_facts"])
            and all(isinstance(pair, list) and len(pair) == 2 and isinstance(pair[0], str)
                    and type(pair[1]) is int for pair in prediction["supporting_facts"])
        )
        checks = [{"name": "local_output_format", "passed": bool(valid_format)}]
        if not valid_format:
            return {"passed": False, "checks": checks, "metrics": {"official": metrics}}

        facts = prediction["supporting_facts"]
        metrics = official_metrics(prediction["answer"], facts, self._record)
        valid_citations = all(title in self._passages and 0 <= index < len(self._passages[title])
                              for title, index in facts)
        unique_citations = len(set(map(tuple, facts))) == len(facts)
        trace_reads = set()
        if isinstance(trace, list):
            for event in trace:
                if not isinstance(event, dict) or event.get("action") != "read_passage":
                    continue
                arguments = event.get("input")
                if not isinstance(arguments, dict) or set(arguments) != {"title"}:
                    continue
                title = arguments["title"]
                if (isinstance(title, str) and title in self._read_titles
                        and event.get("result") == _read_result(title, self._passages[title])):
                    trace_reads.add(title)
        all_read = all(title in trace_reads for title, _ in facts)
        checks.extend([
            {"name": "local_citations_exist", "passed": valid_citations},
            {"name": "local_citations_unique", "passed": unique_citations},
            {"name": "local_cited_passages_read", "passed": all_read},
            {"name": "official_answer_em", "passed": metrics["em"] == 1},
            {"name": "official_support_em", "passed": metrics["sp_em"] == 1},
            {"name": "official_joint_em", "passed": metrics["joint_em"] == 1},
        ])
        return {"passed": all(check["passed"] for check in checks), "checks": checks,
                "metrics": {"official": metrics, "local": {
                    "citations_exist": valid_citations, "citations_unique": unique_citations,
                    "cited_passages_read": all_read}}}

    def reference(self):
        """Private oracle protocol script for harness validation, never agent input."""
        titles = list(dict.fromkeys(title for title, _ in self._record["supporting_facts"]))
        calls = [{"action": "read_passage", "requestId": f"hotpot-read-{index}",
                  "input": {"title": title}} for index, title in enumerate(titles)]
        final = json.dumps({"answer": self._record["answer"],
                            "supporting_facts": self._record["supporting_facts"]}, ensure_ascii=False)
        return [{"calls": calls}, {"calls": [], "final": final}]


def validate_reference():
    results = []
    for case in load_cases():
        episode = Episode(case)
        episode.start()
        trace, final = [], ""
        for decision in episode.reference():
            for call in decision.get("calls", []):
                trace.append({**call, "result": episode.call(call["action"], call["input"])})
            final = decision.get("final", final)
        results.append({"id": case["id"], **episode.grade(final, trace)})
    return {"mode": "reference_harness_only", "source": "hotpotqa", "total": len(results),
            "passed": sum(result["passed"] for result in results), "failed": sum(not result["passed"] for result in results),
            "model_requests": 0, "results": results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["reference"])
    parser.add_argument("--out", type=Path, help="Write a new JSON report; existing files are not overwritten.")
    args = parser.parse_args()
    report = validate_reference()
    if args.out:
        with args.out.open("x") as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
            output.write("\n")
    print(json.dumps({key: value for key, value in report.items() if key != "results"}))
    raise SystemExit(0 if report["failed"] == 0 and report["total"] == 48 else 1)
