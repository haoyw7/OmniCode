import copy
import hashlib
import importlib.util
import json
import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))
from eval_data import data_path

ROOT = Path(__file__).resolve().parents[1]


def load_adapter(slug):
    spec = importlib.util.spec_from_file_location("test_public_" + slug, ROOT / "public" / slug / "adapter.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BFCL = load_adapter("bfcl")
MEMORY = load_adapter("longmemeval")


def execute(episode, decisions=None):
    trace, final = [], ""
    for decision in decisions if decisions is not None else episode.reference():
        for call in decision["calls"]:
            result = episode.call(call["action"], call["input"])
            trace.append({**call, "result": result})
        if "final" in decision:
            final = decision["final"]
    return final, trace


@unittest.skipUnless(all(data_path(f'public/{source}/cases.jsonl').is_file() for source in ('bfcl', 'longmemeval')), 'Prepare BFCL and LongMemEval caches before running dataset regressions')
class BFCLTests(unittest.TestCase):
    def test_counts_originals_and_checksums(self):
        cases = BFCL.load_cases()
        self.assertEqual(len(cases), 30)
        self.assertEqual(len({case["upstream_id"] for case in cases}), 30)
        self.assertEqual(sorted(Counter(case["category"] for case in cases).values()), [6] * 5)
        originals = {}
        for category in ("simple_python", "multiple", "parallel", "parallel_multiple", "irrelevance"):
            file = data_path(f"data/upstream/bfcl-v4-sample/BFCL_v4_{category}.jsonl")
            for line in file.read_bytes().splitlines():
                record = json.loads(line)
                originals[record["id"]] = (record, hashlib.sha256(line).hexdigest())
        for case in cases:
            self.assertEqual(case["data"]["original_record"], originals[case["upstream_id"]][0])
            self.assertEqual(case["provenance"]["sha256"], originals[case["upstream_id"]][1])
        manifest = json.loads((BFCL.ROOT / "manifest.json").read_text())
        self.assertEqual(manifest["cases_sha256"], hashlib.sha256(data_path("public/bfcl/cases.jsonl").read_bytes()).hexdigest())

    def test_all_30_fresh_references(self):
        for case in BFCL.load_cases():
            with self.subTest(case=case["upstream_id"]):
                episode = BFCL.Episode(case)
                final, trace = execute(episode)
                self.assertTrue(all(item["result"]["ok"] for item in trace), trace)
                result = episode.grade(final, trace)
                self.assertTrue(result["passed"], result)
                self.assertFalse(result["metrics"]["official_bfcl_score"])
                for item in trace:
                    self.assertFalse(item["result"]["receipt"]["function_executed"])
                    self.assertNotIn("result", item["result"])

    def test_every_reference_decision_obeys_transport_protocol(self):
        # Match the transport shape in src/schema.ts:DecisionSchema, including
        # the no-empty-noop rule that direct Episode tests do not enforce.
        for adapter in (BFCL, MEMORY):
            for case in adapter.load_cases():
                with self.subTest(case=case["upstream_id"]):
                    decisions = adapter.Episode(case).reference()
                    self.assertTrue(decisions)
                    for decision in decisions:
                        self.assertFalse(set(decision) - {"calls", "final"})
                        self.assertIsInstance(decision["calls"], list)
                        self.assertLessEqual(len(decision["calls"]), 8)
                        self.assertTrue(decision["calls"] or "final" in decision,
                                        "Transport rejects empty calls without final")
                        if "final" in decision:
                            self.assertIsInstance(decision["final"], str)
                            self.assertLessEqual(len(decision["final"]), 20000)
                        for call in decision["calls"]:
                            self.assertEqual(set(call), {"action", "requestId", "input"})
                            self.assertIsInstance(call["action"], str)
                            self.assertTrue(call["action"])
                            self.assertIsInstance(call["requestId"], str)
                            self.assertTrue(0 < len(call["requestId"]) <= 128)
                            self.assertIsInstance(call["input"], dict)
                    if case["source"] == "bfcl" and case["category"] == "irrelevance":
                        self.assertEqual(len(decisions), 1)
                        self.assertEqual(decisions[0]["calls"], [])
                        self.assertIn("final", decisions[0])

    def test_wrong_value_missing_duplicate_and_unknown_calls(self):
        for case in BFCL.load_cases():
            if case["category"] == "irrelevance":
                episode = BFCL.Episode(case)
                self.assertFalse(episode.call("not_a_function", {})["ok"])
                self.assertFalse(episode.grade("No applicable function", [])["passed"])
                continue
            decisions = BFCL.Episode(case).reference()
            calls = decisions[0]["calls"]
            episode = BFCL.Episode(case)
            final, trace = execute(episode, [{"calls": calls[:-1]}, decisions[-1]])
            self.assertFalse(episode.grade(final, trace)["passed"])
            episode = BFCL.Episode(case)
            final, trace = execute(episode, [{"calls": calls + [calls[0]]}, decisions[-1]])
            self.assertFalse(episode.grade(final, trace)["passed"])
        case = BFCL.load_cases()[0]
        episode = BFCL.Episode(case)
        calls = episode.reference()[0]["calls"]
        calls[0]["input"]["base"] = 999
        final, trace = execute(episode, [{"calls": calls}, {"calls": [], "final": "done"}])
        self.assertFalse(episode.grade(final, trace)["passed"])

    def test_type_optional_nested_and_unknown_arguments(self):
        case = next(case for case in BFCL.load_cases() if case["upstream_id"] == "simple_python_0")
        for value in (True, 10.0, "10"):
            episode = BFCL.Episode(case)
            self.assertFalse(episode.call("calculate_triangle_area", {"base": value, "height": 5})["ok"])
        episode = BFCL.Episode(case)
        self.assertTrue(episode.call("calculate_triangle_area", {"base": 10, "height": 5})["ok"])
        self.assertTrue(episode.grade("recorded", [])["passed"])
        episode = BFCL.Episode(case)
        self.assertFalse(episode.call("calculate_triangle_area", {"base": 10, "height": 5, "extra": 0})["ok"])
        episode = BFCL.Episode(case)
        self.assertTrue(episode.call("calculate_triangle_area", {"base": 10, "height": 5, "unit": ""})["ok"])
        self.assertFalse(episode.grade("recorded", [])["passed"])
        nested = next(case for case in BFCL.load_cases() if case["upstream_id"] == "multiple_119")
        episode = BFCL.Episode(nested)
        calls = episode.reference()[0]["calls"]
        self.assertEqual(calls[0]["input"]["conditions"][0]["value"], "25")
        calls[0]["input"]["conditions"][0]["value"] = 25
        final, trace = execute(episode, [{"calls": calls}, {"calls": [], "final": "done"}])
        self.assertFalse(episode.grade(final, trace)["passed"])

    def test_unordered_bipartite_matching_and_array_order(self):
        calls = [{"action": "f", "input": {"x": "a"}}, {"action": "f", "input": {"x": "b"}}]
        # A greedy first-fit matcher would fail this valid full matching.
        gold = [{"f": {"x": ["a", "b"]}}, {"f": {"x": ["a"]}}]
        self.assertTrue(BFCL.call_set_matches(calls, gold))
        self.assertFalse(BFCL.call_set_matches([calls[1], calls[1]], gold))
        self.assertFalse(BFCL.call_set_matches([{"action": "f", "input": {"x": [2, 1]}}],
                                             [{"f": {"x": [[1, 2]]}}]))
        for case in BFCL.load_cases():
            episode = BFCL.Episode(case)
            script = episode.reference()
            script[0]["calls"].reverse()
            final, trace = execute(episode, script)
            self.assertTrue(episode.grade(final, trace)["passed"])

    def test_prompt_separation_spoofed_trace_and_reset(self):
        for case in BFCL.load_cases():
            episode = BFCL.Episode(case)
            public = json.dumps(episode.start())
            self.assertNotIn("ground_truth", public)
            self.assertNotIn("local_strict_call_set_accuracy", public)
            final, trace = execute(episode)
            fresh = BFCL.Episode(case)
            if case["category"] != "irrelevance":
                self.assertFalse(fresh.grade(final, trace)["passed"])
            self.assertFalse(fresh.grade("", [])["passed"])
            self.assertEqual(fresh.calls, [])
            self.assertEqual(fresh.errors, [])


@unittest.skipUnless(data_path('public/longmemeval/cases.jsonl').is_file(), 'Prepare the LongMemEval cache before running dataset regressions')
class MemoryTests(unittest.TestCase):
    def test_counts_originals_and_scope(self):
        cases = MEMORY.load_cases()
        self.assertEqual(len(cases), 18)
        self.assertEqual(len({case["upstream_id"] for case in cases}), 18)
        self.assertEqual(sorted(Counter(case["category"] for case in cases).values()), [3] * 6)
        self.assertEqual(sum(case["upstream_id"].endswith("_abs") for case in cases), 4)
        self.assertEqual(sum(case["answerSemantics"] == "not_graded" for case in cases), 3)
        originals = {row["question_id"]: row for row in json.loads(data_path("data/upstream/longmemeval-oracle-sample/records.json").read_text())}
        for case in cases:
            self.assertEqual(case["data"]["original_record"], originals[case["upstream_id"]])
        self.assertTrue(any(type(case["data"]["original_record"]["answer"]) is int for case in cases))
        manifest = json.loads((MEMORY.ROOT / "manifest.json").read_text())
        self.assertEqual(manifest["cases_sha256"], hashlib.sha256(data_path("public/longmemeval/cases.jsonl").read_bytes()).hexdigest())

    def test_all_18_fresh_references(self):
        for case in MEMORY.load_cases():
            with self.subTest(case=case["upstream_id"]):
                episode = MEMORY.Episode(case)
                final, trace = execute(episode)
                self.assertTrue(all(item["result"]["ok"] for item in trace))
                result = episode.grade(final, trace)
                self.assertTrue(result["passed"], result)
                self.assertFalse(result["metrics"]["official_longmemeval_score"])
                if case["category"] == "single-session-preference":
                    self.assertEqual(result["metrics"]["answerSemantics"], "not_graded")
                    self.assertNotIn("local_oracle_strict_answer_accuracy", result["metrics"])

    def test_wrong_answers_abstention_and_malformed_final(self):
        for case in MEMORY.load_cases():
            episode = MEMORY.Episode(case)
            final, trace = execute(episode)
            value = json.loads(final)
            if case["category"] != "single-session-preference":
                value["answer"] = "DELIBERATELY INCORRECT"
                self.assertFalse(episode.grade(json.dumps(value), trace)["passed"])
            value = json.loads(final)
            value["abstain"] = not value["abstain"]
            self.assertFalse(episode.grade(json.dumps(value), trace)["passed"])
            for invalid in ("not json", "[]", "{}", "null"):
                self.assertFalse(episode.grade(invalid, trace)["passed"])

    def test_evidence_must_be_read_and_exact(self):
        for case in MEMORY.load_cases():
            episode = MEMORY.Episode(case)
            final, trace = execute(episode)
            fresh = MEMORY.Episode(case)
            self.assertFalse(fresh.grade(final, trace)["passed"])
            self.assertEqual(fresh.read_ids, set())
            value = json.loads(final)
            for wrong_ids in ([], ["unknown"], value["evidence_session_ids"] * 2):
                value["evidence_session_ids"] = wrong_ids
                self.assertFalse(episode.grade(json.dumps(value), trace)["passed"])

    def test_unknown_tools_and_arguments_are_non_mutating(self):
        case = MEMORY.load_cases()[0]
        for action, arguments in (("delete_all", {}), ("list_sessions", {"gold": True}),
                                  ("read_session", {"session_id": "missing"}),
                                  ("read_session", {"session_id": 1}), ("read_session", [])):
            episode = MEMORY.Episode(case)
            self.assertFalse(episode.call(action, arguments)["ok"])
            self.assertEqual(episode.read_ids, set())
            final, trace = execute(episode)
            self.assertFalse(episode.grade(final, trace)["passed"])

    def test_no_gold_flags_or_source_session_ids_in_model_context(self):
        for case in MEMORY.load_cases():
            episode = MEMORY.Episode(case)
            public = [episode.start(), episode.call("list_sessions", {})]
            for handle in episode.sessions:
                result = episode.call("read_session", {"session_id": handle})
                public.append(result)
                for message in result["session"]["messages"]:
                    self.assertEqual(set(message), {"role", "content"})
            serialized = json.dumps(public)
            for private_id in case["data"]["original_record"]["haystack_session_ids"]:
                self.assertNotIn(private_id, serialized)
            self.assertNotIn('"has_answer"', serialized)
            self.assertNotIn('"answer_session_ids"', serialized)
            self.assertNotIn(case["upstream_id"], serialized)

    def test_preference_is_explicitly_retrieval_only(self):
        for case in MEMORY.load_cases():
            if case["category"] != "single-session-preference":
                continue
            episode = MEMORY.Episode(case)
            final, trace = execute(episode)
            value = json.loads(final)
            value["answer"] = "This arbitrary text is intentionally not semantically evaluated."
            result = episode.grade(json.dumps(value), trace)
            self.assertTrue(result["passed"])
            self.assertEqual(result["metrics"]["evaluation_scope"], "evidence_retrieval_only")
            self.assertEqual(result["metrics"]["answerSemantics"], "not_graded")

    def test_normalization_is_not_substring_or_bool_matching(self):
        self.assertEqual(MEMORY.normalize_answer(1300), MEMORY.normalize_answer("1300.0"))
        self.assertEqual(MEMORY.normalize_answer(" Dr.  Arati Prabhakar. "), MEMORY.normalize_answer("dr. arati prabhakar"))
        self.assertNotEqual(MEMORY.normalize_answer("30"), MEMORY.normalize_answer("30 minutes"))
        self.assertIsNone(MEMORY.normalize_answer(True))
        self.assertIsNone(MEMORY.normalize_answer(float("nan")))


if __name__ == "__main__":
    unittest.main()
