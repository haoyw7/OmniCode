"""Contract and adversarial checks for the offline HotpotQA distractor adapter."""
import copy
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import sys
from pathlib import Path
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))
from eval_data import data_path

ROOT = Path(__file__).resolve().parents[1] / "public" / "hotpotqa"


def load_adapter():
    path = ROOT / "adapter.py"
    if not path.is_file():
        raise AssertionError("HotpotQA Episode adapter has not been implemented")
    spec = importlib.util.spec_from_file_location("public_hotpotqa_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def execute_reference(episode):
    trace, final = [], ""
    for decision in episode.reference():
        for call in decision.get("calls", []):
            trace.append({**call, "result": episode.call(call["action"], call["input"])})
        final = decision.get("final", final)
    return final, trace


@unittest.skipUnless(data_path('public/hotpotqa/cases.jsonl').is_file(), 'Prepare the HotpotQA cache before running dataset regressions')
class HotpotQATests(unittest.TestCase):
    def test_all_48_original_records_reference_pass(self):
        adapter = load_adapter()
        cases = adapter.load_cases()
        self.assertEqual(len(cases), 48)
        self.assertEqual(len({c["upstream_id"] for c in cases}), 48)
        self.assertEqual({c["data"]["type"] for c in cases}, {"bridge", "comparison"})
        for case in cases:
            with self.subTest(case=case["id"]):
                episode = adapter.Episode(case)
                episode.start()
                final, trace = execute_reference(episode)
                grade = episode.grade(final, trace)
                self.assertTrue(grade["passed"], grade)
                self.assertTrue(all(v == 1 for v in grade["metrics"]["official"].values()))

    def test_original_records_and_hashes_preserved(self):
        adapter = load_adapter()
        cases = adapter.load_cases()
        raw = json.loads(data_path("public/hotpotqa/original/records.json").read_text())
        self.assertEqual([c["data"] for c in cases], raw)
        manifest = json.loads((ROOT / "manifest.json").read_text())
        self.assertEqual(manifest["imported_original_records"], 48)
        self.assertEqual(manifest["executable_variants"], 48)
        for relative, expected in manifest["files"].items():
            self.assertEqual(hashlib.sha256(data_path(f"public/hotpotqa/{relative}").read_bytes()).hexdigest(), expected)
        for case in cases:
            for key in ("official_url", "license_url", "revision", "sha256", "upstream_id", "split", "variant", "transformation", "seed", "env_requirement"):
                self.assertIn(key, case["provenance"])
            self.assertEqual(case["provenance"]["seed"], 17)
            self.assertEqual(case["data"]["_id"], case["upstream_id"])
            self.assertEqual(len(case["data"]["context"]), 10)

    def test_mirror_conversion_and_seeded_selection_are_lossless_and_deterministic(self):
        path = ROOT / "import_subset.py"
        self.assertTrue(path.is_file(), "Pinned mirror importer has not been implemented")
        spec = importlib.util.spec_from_file_location("hotpot_import_test", path)
        importer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(importer)
        hf = json.loads(data_path("public/hotpotqa/original/hf_records.json").read_text())
        reconstructed = json.loads(data_path("public/hotpotqa/original/records.json").read_text())
        self.assertEqual([importer.to_original(row) for row in hf], reconstructed)
        selected_a, _ = importer.select_records(hf, per_category=3)
        selected_b, _ = importer.select_records(list(reversed(hf)), per_category=3)
        self.assertEqual(selected_a, selected_b)
        self.assertEqual(len(selected_a), 6)
        selected_c, audit = importer.select_records(hf + [hf[0]], per_category=3)
        self.assertEqual(selected_a, selected_c)
        self.assertEqual(audit["duplicate_rows_removed"], 1)

    def test_official_metrics_match_complete_vendored_evaluator(self):
        adapter = load_adapter()
        original = (ROOT / "vendor" / "hotpot_evaluate_v1.py").read_text()
        stdlib = (ROOT / "vendor" / "hotpot_evaluate_v1_stdlib.py").read_text()
        self.assertEqual(original.replace("import ujson as json", "import json"), stdlib)
        record = adapter.load_cases()[0]["data"]
        for answer, facts in ((record["answer"], record["supporting_facts"]),
                              ("wrong", record["supporting_facts"][:1]),
                              (record["answer"] + " extra token", [["unknown title", 0]]),
                              ("yes", [])):
            with tempfile.TemporaryDirectory() as directory:
                gold, prediction = Path(directory) / "gold.json", Path(directory) / "prediction.json"
                gold.write_text(json.dumps([record]))
                prediction.write_text(json.dumps({"answer": {record["_id"]: answer}, "sp": {record["_id"]: facts}}))
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    adapter._OFFICIAL.eval(prediction, gold)
                expected = ast.literal_eval(output.getvalue())
            self.assertEqual(adapter.official_metrics(answer, facts, record), expected)

    def test_start_does_not_expose_private_labels(self):
        adapter = load_adapter()
        case = copy.deepcopy(adapter.load_cases()[0])
        case["data"]["answer"] = "PRIVATE_ANSWER_SENTINEL"
        case["data"]["supporting_facts"] = [["PRIVATE_SUPPORT_SENTINEL", 999]]
        serialized = json.dumps(adapter.Episode(case).start())
        self.assertNotIn("PRIVATE_ANSWER_SENTINEL", serialized)
        self.assertNotIn("PRIVATE_SUPPORT_SENTINEL", serialized)
        self.assertNotIn('"data"', serialized)
        self.assertNotIn('"provenance"', serialized)

    def test_read_is_complete_unlabelled_and_search_is_local(self):
        adapter = load_adapter()
        case = adapter.load_cases()[0]
        episode = adapter.Episode(case)
        title, sentences = case["data"]["context"][0]
        result = episode.call("read_passage", {"title": title})
        self.assertEqual(result["sentences"], [{"index": i, "text": s} for i, s in enumerate(sentences)])
        self.assertNotIn("supporting_facts", json.dumps(result))
        search = episode.call("search_passages", {"query": title, "limit": 10})
        self.assertIn(title, [item["title"] for item in search["results"]])
        self.assertTrue(all(item["title"] in dict(case["data"]["context"]) for item in search["results"]))

    def test_wrong_answer_rejected(self):
        adapter = load_adapter()
        episode = adapter.Episode(adapter.load_cases()[0])
        final, trace = execute_reference(episode)
        prediction = json.loads(final)
        prediction["answer"] = "nonsense_answer_does_not_match"
        result = episode.grade(json.dumps(prediction), trace)
        self.assertFalse(result["passed"])
        self.assertEqual(result["metrics"]["official"]["em"], 0)

    def test_forged_missing_negative_boolean_and_out_of_range_citations_rejected(self):
        adapter = load_adapter()
        for bad in (["unknown title", 0], ["", 0], [None, 0], ["any", -1], ["any", True], ["any", 999999]):
            episode = adapter.Episode(adapter.load_cases()[0])
            final, trace = execute_reference(episode)
            prediction = json.loads(final)
            title = prediction["supporting_facts"][0][0]
            candidate = [title if bad[0] == "any" else bad[0], bad[1]]
            prediction["supporting_facts"].append(candidate)
            with self.subTest(citation=candidate):
                self.assertFalse(episode.grade(json.dumps(prediction), trace)["passed"])

    def test_unread_and_forged_trace_citations_rejected(self):
        adapter = load_adapter()
        episode = adapter.Episode(adapter.load_cases()[0])
        final = episode.reference()[-1]["final"]
        reference_episode = adapter.Episode(adapter.load_cases()[0])
        _, forged_trace = execute_reference(reference_episode)
        for trace in ([], forged_trace):
            result = episode.grade(final, trace)
            self.assertFalse(result["passed"])
            self.assertEqual(result["metrics"]["official"]["joint_em"], 1)

    def test_reference_reads_and_results_do_not_leak_between_episodes(self):
        adapter = load_adapter()
        case = adapter.load_cases()[0]
        episode = adapter.Episode(case)
        final, trace = execute_reference(episode)
        self.assertTrue(episode.grade(final, trace)["passed"])
        self.assertFalse(adapter.Episode(case).grade(final, trace)["passed"])
        episode.start()
        self.assertFalse(episode.grade(final, trace)["passed"])
        title, sentences = case["data"]["context"][0]
        observed = episode.call("read_passage", {"title": title})
        observed["sentences"][0]["text"] = "modified by caller"
        self.assertEqual(episode.call("read_passage", {"title": title})["sentences"][0]["text"], sentences[0])

    def test_malformed_predictions_and_actions_fail_closed(self):
        adapter = load_adapter()
        episode = adapter.Episode(adapter.load_cases()[0])
        for final in ("", "not json", "[]", "null", '{"answer":3,"supporting_facts":[]}', '{"answer":"x","supporting_facts":[],"unexpected":1}'):
            self.assertFalse(episode.grade(final, [])["passed"])
        for action, args in (("web_search", {}), ("read_passage", {"title": "x", "extra": 1}), ("read_passage", {"title": 2}), ("read_passage", {"title": "missing"}), ("search_passages", {"query": "x", "limit": True}), ("search_passages", {"query": "x", "limit": 11}), ("search_passages", {"query": ""}), ("search_passages", [])):
            self.assertIn("error", episode.call(action, args))

    def test_partial_support_retains_official_partial_metrics_but_fails_local_gate(self):
        adapter = load_adapter()
        episode = adapter.Episode(adapter.load_cases()[0])
        final, trace = execute_reference(episode)
        prediction = json.loads(final)
        prediction["supporting_facts"] = prediction["supporting_facts"][:1]
        grade = episode.grade(json.dumps(prediction), trace)
        self.assertFalse(grade["passed"])
        self.assertGreater(grade["metrics"]["official"]["sp_f1"], 0)
        self.assertLess(grade["metrics"]["official"]["sp_f1"], 1)


if __name__ == "__main__":
    unittest.main()
