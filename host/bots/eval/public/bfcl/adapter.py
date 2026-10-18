"""Local strict BFCL call-set evaluation. This is NOT the official BFCL scorer."""
from __future__ import annotations

import copy
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(ROOT.parents[1] / "bin"))
from eval_data import data_path


def load_cases():
    return [json.loads(line) for line in data_path("public/bfcl/cases.jsonl").read_text().splitlines() if line]


def json_schema(schema):
    """Translate only BFCL Python type spelling; preserve source constraints."""
    result = copy.deepcopy(schema)
    result["type"] = {"dict": "object", "float": "number"}.get(result.get("type"), result.get("type"))
    if result.get("type") == "object":
        result["additionalProperties"] = False
        result["properties"] = {k: json_schema(v) for k, v in result.get("properties", {}).items()}
    if "items" in result:
        result["items"] = json_schema(result["items"])
    return result


def _equal(actual, expected):
    # bool must not equal an integer. Numeric int/float equality is permitted only
    # after the declared tool schema has checked integer versus number types.
    if type(actual) is bool or type(expected) is bool:
        return type(actual) is type(expected) and actual == expected
    if type(actual) in (int, float) and type(expected) in (int, float):
        return actual == expected
    return type(actual) is type(expected) and actual == expected


def validate(value, schema):
    kind = schema.get("type")
    expected = {"object": dict, "array": list, "string": str, "integer": int, "boolean": bool}
    if kind in expected and type(value) is not expected[kind]:
        raise ValueError("expected " + kind)
    if kind == "number" and (type(value) not in (int, float) or not math.isfinite(value)):
        raise ValueError("expected finite number")
    if "enum" in schema and not any(_equal(value, item) for item in schema["enum"]):
        raise ValueError("value outside enum")
    if kind == "object":
        properties = schema.get("properties", {})
        if set(value) - set(properties):
            raise ValueError("unknown arguments")
        if set(schema.get("required", [])) - set(value):
            raise ValueError("missing required arguments")
        for key, item in value.items():
            validate(item, properties[key])
    elif kind == "array":
        for item in value:
            validate(item, schema.get("items", {}))


def _candidate_matches(actual, candidate):
    """Inside an expected dict, each property's list is its alternative set.

    Lists inside an alternative are actual arrays, whose order is significant.
    Optional empty-string sentinels are handled by _arguments_match only; an
    actual empty string is never silently removed or treated as omission.
    """
    if isinstance(candidate, dict):
        return isinstance(actual, dict) and _arguments_match(actual, candidate)
    if isinstance(candidate, list):
        return isinstance(actual, list) and len(actual) == len(candidate) and all(
            _candidate_matches(a, c) for a, c in zip(actual, candidate)
        )
    return _equal(actual, candidate)


def _arguments_match(actual, candidates):
    if set(actual) - set(candidates):
        return False
    for key, options in candidates.items():
        if key not in actual:
            if "" not in options:
                return False
        elif not any(option != "" and _candidate_matches(actual[key], option) for option in options):
            return False
    return True


def _call_matches(call, expected):
    name, candidates = next(iter(expected.items()))
    return call["action"] == name and _arguments_match(call["input"], candidates)


def call_set_matches(calls, expected):
    """Unordered multiset equality through maximum bipartite matching.

    Greedy matching is unsound when two reference calls have overlapping
    alternatives. Each actual and expected call must be used exactly once.
    """
    if len(calls) != len(expected):
        return False
    owners = {}

    def augment(index, visited):
        for target, gold in enumerate(expected):
            if target in visited or not _call_matches(calls[index], gold):
                continue
            visited.add(target)
            if target not in owners or augment(owners[target], visited):
                owners[target] = index
                return True
        return False

    return all(augment(index, set()) for index in range(len(calls)))


def _choose_candidate(candidate):
    if isinstance(candidate, dict):
        return _choose_arguments(candidate)
    if isinstance(candidate, list):
        return [_choose_candidate(item) for item in candidate]
    return copy.deepcopy(candidate)


def _choose_arguments(candidates):
    # Prefer a real value. A sentinel-only field is omitted. All selected
    # reference values are subsequently schema validated by Episode.call.
    return {key: _choose_candidate(next(item for item in options if item != ""))
            for key, options in candidates.items() if any(item != "" for item in options)}


class Episode:
    def __init__(self, case, seed=17):
        self.case = copy.deepcopy(case)
        self.record = self.case["data"]["original_record"]
        self.seed = seed
        self.schemas = {item["name"]: json_schema(item["parameters"]) for item in self.record["function"]}
        self.calls = []
        self.errors = []

    def start(self):
        return {
            "prompt": (
                "LOCAL BFCL ADAPTATION: submit the function calls needed for the user request. "
                "Tools only record simulated call receipts; no function implementation runs "
                "and no actual function result is available. Do not invent results. "
                "If no offered function applies, make no calls. Finish with a short explanation. "
                "The question and function descriptions below are upstream source material.\n\n"
                + "SOURCE QUESTION:\n" + json.dumps(self.record["question"], ensure_ascii=False)
            ),
            "tools": [{"name": item["name"], "description": item["description"],
                       "parameters": copy.deepcopy(self.schemas[item["name"]])}
                      for item in self.record["function"]],
        }

    def call(self, action, arguments):
        if not isinstance(action, str) or action not in self.schemas:
            self.errors.append("unknown_action")
            return {"ok": False, "error": {"code": "unknown_action", "message": "Unknown function"}}
        try:
            validate(arguments, self.schemas[action])
        except (ValueError, TypeError, OverflowError) as exc:
            self.errors.append("invalid_arguments")
            return {"ok": False, "error": {"code": "invalid_arguments", "message": str(exc)}}
        self.calls.append({"action": action, "input": copy.deepcopy(arguments)})
        return {"ok": True, "simulated": True, "receipt": {
            "sequence": len(self.calls), "function": action, "arguments": copy.deepcopy(arguments),
            "status": "recorded_only", "function_executed": False,
        }}

    def grade(self, final, trace):
        # Actual calls are authoritative; a forged transport trace cannot pass.
        expected = self.case["data"]["ground_truth"]
        match = call_set_matches(self.calls, expected)
        checks = [
            {"name": "all_attempted_calls_schema_valid", "passed": not self.errors},
            {"name": "local_strict_unordered_candidate_call_set", "passed": match,
             "evidence": {"expected_calls": len(expected), "recorded_calls": len(self.calls)}},
            {"name": "nonempty_final", "passed": isinstance(final, str) and bool(final.strip())},
        ]
        passed = all(check["passed"] for check in checks)
        return {"passed": passed, "checks": checks, "metrics": {
            "local_strict_call_set_accuracy": float(passed), "official_bfcl_score": False,
            "function_execution": "simulated_receipts_only", "answerSemantics": "not_graded",
        }}

    def reference(self):
        calls = []
        for index, item in enumerate(self.case["data"]["ground_truth"]):
            action, candidates = next(iter(item.items()))
            calls.append({"action": action, "input": _choose_arguments(candidates),
                          "requestId": f"bfcl-reference-{index}"})
        final = {"calls": [], "final": (
            "The required function calls were recorded; execution results are unavailable."
            if calls else "None of the offered functions applies to this request."
        )}
        # The shared DecisionSchema rejects a no-op with neither calls nor a
        # final. Irrelevance references therefore finish in one legal step.
        return [{"calls": calls}, final] if calls else [final]
