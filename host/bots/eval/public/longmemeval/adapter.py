"""Oracle evidence retrieval + strict answers; not official long-memory evaluation."""
from __future__ import annotations

import copy
import json
import math
import re
import unicodedata
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(ROOT.parents[1] / "bin"))
from eval_data import data_path


def load_cases():
    return [json.loads(line) for line in data_path("public/longmemeval/cases.jsonl").read_text().splitlines() if line]


def normalize_answer(value):
    """Limited exact normalization, never semantic entailment or substring matching."""
    if type(value) not in (str, int, float):
        return None
    if type(value) is float and not math.isfinite(value):
        return None
    text = unicodedata.normalize("NFKC", str(value)).casefold().strip()
    text = re.sub(r"\s+", " ", text).rstrip(".!?")
    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text):
        return str(Decimal(text).normalize())
    return text


class Episode:
    def __init__(self, case, seed=17):
        self.case = copy.deepcopy(case)
        self.record = self.case["data"]["original_record"]
        self.seed = seed
        self.ids = {source_id: f"session_{index + 1:03d}"
                    for index, source_id in enumerate(self.record["haystack_session_ids"])}
        self.sessions = {}
        for source_id, date, messages in zip(self.record["haystack_session_ids"],
                                             self.record["haystack_dates"],
                                             self.record["haystack_sessions"]):
            self.sessions[self.ids[source_id]] = {
                "session_id": self.ids[source_id], "date": date,
                # Upstream has_answer and identifying gold labels are private.
                "messages": [{"role": message["role"], "content": message["content"]}
                             for message in messages],
            }
        self.read_ids = set()
        self.errors = []

    def start(self):
        return {"prompt": (
            "Answer the question using stored conversation sessions. This local oracle variant "
            "provides a small preselected evidence pool; it does not measure long-context "
            "memory ingestion. Use list_sessions and read_session to inspect evidence. "
            "Return ONLY one JSON object with exactly these fields: answer (a short string "
            "or number; null when abstaining), evidence_session_ids (unique IDs of sessions "
            "you read and used), abstain (boolean). Use the shortest complete factual answer "
            "without added explanation. If evidence cannot answer the question, set abstain "
            "to true, answer to null, and cite the sessions inspected.\n"
            "QUESTION DATE: " + self.record["question_date"] + "\n"
            "QUESTION: " + self.record["question"]
        ), "tools": [
            {"name": "list_sessions", "description": "List available stored session IDs and dates.",
             "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
            {"name": "read_session", "description": "Read a stored conversation session in full.",
             "parameters": {"type": "object", "properties": {"session_id": {"type": "string"}},
                            "required": ["session_id"], "additionalProperties": False}},
        ]}

    def _error(self, code, message):
        self.errors.append(code)
        return {"ok": False, "error": {"code": code, "message": message}}

    def call(self, action, arguments):
        if not isinstance(action, str) or action not in {"list_sessions", "read_session"}:
            return self._error("unknown_action", "Unknown tool")
        if type(arguments) is not dict:
            return self._error("invalid_arguments", "Arguments must be an object")
        if action == "list_sessions":
            if arguments:
                return self._error("invalid_arguments", "list_sessions takes no arguments")
            return {"ok": True, "sessions": [{"session_id": value["session_id"], "date": value["date"]}
                                              for value in self.sessions.values()]}
        if set(arguments) != {"session_id"} or type(arguments["session_id"]) is not str:
            return self._error("invalid_arguments", "One string session_id is required")
        session_id = arguments["session_id"]
        if session_id not in self.sessions:
            return self._error("unknown_session", "Session does not exist")
        self.read_ids.add(session_id)
        return {"ok": True, "session": copy.deepcopy(self.sessions[session_id])}

    def grade(self, final, trace):
        try:
            value = json.loads(final)
        except (TypeError, ValueError):
            value = None
        valid = (type(value) is dict and set(value) == {"answer", "evidence_session_ids", "abstain"}
                 and type(value["abstain"]) is bool
                 and type(value["evidence_session_ids"]) is list
                 and all(type(item) is str for item in value["evidence_session_ids"])
                 and (value["answer"] is None or type(value["answer"]) in (str, int, float)))
        value = value if valid else {"answer": None, "evidence_session_ids": [], "abstain": None}
        submitted = value["evidence_session_ids"]
        gold = {self.ids[item] for item in self.record["answer_session_ids"]}
        evidence_ok = len(submitted) == len(set(submitted)) and set(submitted) == gold
        reads_ok = gold.issubset(self.read_ids)
        expected_abstention = self.record["question_id"].endswith("_abs")
        abstention_ok = valid and value["abstain"] is expected_abstention
        preference = self.record["question_type"] == "single-session-preference"
        if expected_abstention:
            answer_ok = value["answer"] is None
        elif preference:
            answer_ok = type(value["answer"]) is str and bool(value["answer"].strip())
        else:
            answer_ok = normalize_answer(value["answer"]) == normalize_answer(self.record["answer"])
        checks = [
            {"name": "strict_final_json_shape", "passed": valid},
            {"name": "all_tool_calls_valid", "passed": not self.errors},
            {"name": "gold_evidence_session_set", "passed": evidence_ok},
            {"name": "gold_sessions_actually_read", "passed": reads_ok},
            {"name": "abstention_flag", "passed": abstention_ok},
            {"name": "ungraded_preference_answer_shape" if preference else
                     ("null_answer_on_abstention" if expected_abstention else "strict_normalized_answer"),
             "passed": answer_ok},
        ]
        passed = all(check["passed"] for check in checks)
        metrics = {
            "official_longmemeval_score": False,
            "evaluation_scope": "evidence_retrieval_only" if preference else "oracle_strict_answer_and_evidence",
            "answerSemantics": "not_graded" if preference else "strict_normalized_match_or_abstention_only",
            "oracle_evidence_retrieval_accuracy": float(valid and evidence_ok and reads_ok and not self.errors),
            "abstention_accuracy": float(abstention_ok),
        }
        if not preference:
            metrics["local_oracle_strict_answer_accuracy"] = float(passed)
        return {"passed": passed, "checks": checks, "metrics": metrics}

    def reference(self):
        ids = [self.ids[item] for item in self.record["answer_session_ids"]]
        decisions = [{"calls": [{"action": "list_sessions", "input": {}, "requestId": "memory-list"}]}]
        for index, session_id in enumerate(ids):
            decisions.append({"calls": [{"action": "read_session", "input": {"session_id": session_id},
                                          "requestId": f"memory-read-{index}"}]})
        abstain = self.record["question_id"].endswith("_abs")
        answer = None if abstain else self.record["answer"]
        if self.record["question_type"] == "single-session-preference":
            answer = "Relevant preference evidence retrieved; recommendation semantics are not graded."
        decisions.append({"calls": [], "final": json.dumps({"answer": answer,
            "evidence_session_ids": ids, "abstain": abstain}, ensure_ascii=False)})
        return decisions
