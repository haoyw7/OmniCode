"""Regression tests for the executable, offline tau-bench adaptation."""
import ast
import copy
import hashlib
import importlib.util
import json
import sys
import socket
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))
from eval_data import data_path

DIRECTORY = Path(__file__).resolve().parents[1] / "public" / "tau_bench"
SPEC = importlib.util.spec_from_file_location("public_tau_adapter_test", DIRECTORY / "adapter.py")
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)
if not data_path('public/tau_bench/cases.jsonl').is_file():
    raise unittest.SkipTest('Prepare the tau-bench cache before running dataset regressions')
CASES = adapter.load_cases()


def replay(episode):
    trace = []
    final = ""
    for decision in episode.reference():
        for call in decision["calls"]:
            result = episode.call(call["action"], call["input"])
            if not result["ok"]:
                raise AssertionError((episode.case["id"], call, result))
            trace.append({**call, "result": result})
        final = decision.get("final", final)
    return final, trace


def native_reward(episode, final):
    """Execute unchanged upstream calculate_reward AST without user/provider imports."""
    source = (adapter.VENDOR / "tau_bench" / "envs" / "base.py").read_text()
    tree = ast.parse(source)
    helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Env")
    reward = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == "calculate_reward")
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)] + helpers + [reward], type_ignores=[])
    ast.fix_missing_locations(module)
    namespace = {"sha256": hashlib.sha256, "RESPOND_ACTION_NAME": "respond",
                 "RewardActionInfo": SimpleNamespace, "RewardOutputInfo": SimpleNamespace,
                 "RewardResult": SimpleNamespace}
    exec(compile(module, "pinned_native_reward", "exec"), namespace)
    obj = SimpleNamespace()
    obj.data = copy.deepcopy(episode.state)
    obj.data_load_func = lambda: copy.deepcopy(adapter._initial_data(episode.domain))
    obj.actions = [SimpleNamespace(name="respond", kwargs={"content": final})]
    obj.task = SimpleNamespace(actions=[SimpleNamespace(**action) for action in episode.task["actions"]], outputs=episode.task["outputs"])
    obj.terminate_tools = ["transfer_to_human_agents"]
    obj.get_data_hash = lambda: namespace["consistent_hash"](namespace["to_hashable"](obj.data))
    def step(action):
        obj.actions.append(action)
        if action.name == "respond":
            return
        if action.name == "calculate":
            adapter._bounded_calculate(action.kwargs["expression"])
        else:
            episode._tools[action.name].invoke(data=obj.data, **copy.deepcopy(action.kwargs))
    obj.step = step
    return namespace["calculate_reward"](obj).reward


class TauBenchPublicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.references = {}
        # All 24 scripts run with network operations explicitly blocked.
        with patch.object(socket, "socket", side_effect=AssertionError("network forbidden")), \
             patch.object(socket, "create_connection", side_effect=AssertionError("network forbidden")):
            for case in CASES:
                episode = adapter.Episode(case)
                final, trace = replay(episode)
                cls.references[case["id"]] = (episode, final, trace, episode.grade(final, trace))

    def test_all_24_reference_episodes_pass(self):
        self.assertEqual(len(CASES), 24)
        for case in CASES:
            with self.subTest(case=case["id"]):
                episode, final, trace, report = self.references[case["id"]]
                self.assertTrue(report["passed"], report)
                self.assertFalse(report["metrics"]["official_tau_score"])
                json.dumps({"start": episode.start(), "reference": episode.reference(), "trace": trace, "grade": report}, allow_nan=False)

    def test_unchanged_native_reward_matches_all_selected_references(self):
        for case in CASES:
            with self.subTest(case=case["id"]):
                episode, final, _, report = self.references[case["id"]]
                self.assertEqual(native_reward(episode, final), float(report["passed"]))

    def test_all_24_noop_wrong_answers_fail(self):
        for case in CASES:
            with self.subTest(case=case["id"]):
                episode = adapter.Episode(case)
                self.assertFalse(episode.grade("Done.", [])["passed"])
                result = episode.call("invented_tool", {"arbitrary": True})
                self.assertFalse(result["ok"])
                self.assertFalse(episode.grade("All completed.", [{"action": "fake", "result": {"passed": True}}])["passed"])

    def test_outputs_and_empty_final_are_checked(self):
        tested = 0
        for case in CASES:
            if case["data"]["original_record"]["outputs"]:
                episode, final, trace, _ = self.references[case["id"]]
                self.assertFalse(episode.grade("Completed requested changes.", trace)["passed"])
                tested += 1
        self.assertGreaterEqual(tested, 2)
        episode, _, trace, _ = next(iter(self.references.values()))
        self.assertFalse(episode.grade("", trace)["passed"])

    def test_start_never_discloses_private_labels_or_actions(self):
        for case in CASES:
            original = adapter.Episode(case).start()
            tampered = copy.deepcopy(case)
            task = tampered["data"]["original_record"]
            task["outputs"] = ["HIDDEN_GOLD_SENTINEL"]
            task["actions"] = [{"name": "HIDDEN_ACTION_SENTINEL", "kwargs": {"secret": "HIDDEN_ARGUMENT_SENTINEL"}}]
            task["user_id"] = "HIDDEN_USER_SENTINEL"
            after = adapter.Episode(tampered).start()
            self.assertEqual(original, after)
            self.assertNotIn("HIDDEN_", json.dumps(after))
            self.assertEqual(set(after), {"prompt", "tools"})
            self.assertIn("LOCAL ADAPTATION", after["prompt"])

    def test_bad_arguments_do_not_run_or_mutate(self):
        for domain in ("retail", "airline"):
            case = next(c for c in CASES if c["data"]["domain"] == domain)
            episode = adapter.Episode(case)
            before = adapter.state_hash(episode.state)
            for args in ({}, {"user_id": 123}, {"user_id": "x", "unexpected": True}, [], None):
                with self.subTest(domain=domain, args=args):
                    self.assertEqual(episode.call("get_user_details", args)["error"]["code"], "invalid_arguments")
            self.assertEqual(episode.call("get_user_details", {"user_id": "missing-user"})["error"]["code"], "upstream_error")
            self.assertEqual(adapter.state_hash(episode.state), before)
            self.assertEqual(episode._calls, [])

    def test_nested_arguments_and_bool_integer_are_rejected(self):
        case = next(c for c in CASES if c["data"]["domain"] == "airline" and any(a["name"] == "book_reservation" for a in c["data"]["original_record"]["actions"]))
        episode = adapter.Episode(case)
        args = copy.deepcopy(next(a["kwargs"] for a in episode.task["actions"] if a["name"] == "book_reservation"))
        args["passengers"][0]["hidden"] = "reject"
        self.assertFalse(episode.call("book_reservation", args)["ok"])
        del args["passengers"][0]["hidden"]
        args["total_baggages"] = True
        self.assertFalse(episode.call("book_reservation", args)["ok"])

    def test_bounded_calculator_and_no_native_eval_compilation(self):
        episode = adapter.Episode(CASES[0])
        self.assertEqual(episode.call("calculate", {"expression": "(12.5 + 7.5) / 2"}), {"ok": True, "result": 10.0})
        for expression in ("__import__('os').system('id')", "9**9**9", "1/0", "1e999", "9" * 257, "1" + "+1" * 40):
            self.assertFalse(episode.call("calculate", {"expression": expression})["ok"])
        self.assertFalse(hasattr(episode._tools["calculate"], "invoke"))

    def test_reset_and_caller_argument_isolation(self):
        for domain in ("retail", "airline"):
            case = next(c for c in CASES if c["data"]["domain"] == domain)
            first = adapter.Episode(case)
            second = adapter.Episode(case)
            initial = adapter.state_hash(second.state)
            replay(first)
            self.assertNotEqual(adapter.state_hash(first.state), initial)
            self.assertEqual(adapter.state_hash(second.state), initial)
            self.assertEqual(adapter.state_hash(adapter.Episode(case).state), initial)
            third = adapter.Episode(case)
            third.state["users"][case["data"]["original_record"]["user_id"]]["isolation_marker"] = True
            self.assertNotEqual(adapter.state_hash(third.state), adapter.state_hash(second.state))

    def test_wrong_mutation_after_success_fails_and_grade_does_not_reset(self):
        case = next(c for c in CASES if c["data"]["domain"] == "retail")
        episode = adapter.Episode(case)
        final, trace = replay(episode)
        before = adapter.state_hash(episode.state)
        self.assertTrue(episode.grade(final, trace)["passed"])
        self.assertEqual(adapter.state_hash(episode.state), before)
        uid = episode.task["user_id"]
        args = dict(episode.state["users"][uid]["address"])
        args.update(user_id=uid, address1="WRONG MUTATION")
        self.assertTrue(episode.call("modify_user_address", args)["ok"])
        self.assertFalse(episode.grade(final, trace)["passed"])
        self.assertEqual(native_reward(episode, final), 0.0)

    def test_partial_exception_rolls_back_scratch_state(self):
        episode = adapter.Episode(CASES[0])
        class FailingTool:
            @staticmethod
            def get_info():
                return {"function": {"parameters": {"type": "object", "properties": {}}}}
            @staticmethod
            def invoke(data):
                data["users"]["should_not_commit"] = {"mutated": True}
                raise RuntimeError("simulated partial failure")
        episode._tools = {**episode._tools, "failing_test_tool": FailingTool}
        before = adapter.state_hash(episode.state)
        self.assertFalse(episode.call("failing_test_tool", {})["ok"])
        self.assertEqual(adapter.state_hash(episode.state), before)

    def test_transfer_is_only_simulated_and_terminates(self):
        episode = adapter.Episode(CASES[0])
        before = adapter.state_hash(episode.state)
        self.assertEqual(episode.call("transfer_to_human_agents", {"summary": "local simulation"})["result"], "Transfer successful")
        self.assertEqual(adapter.state_hash(episode.state), before)
        self.assertEqual(episode.call("get_user_details", {"user_id": "x"})["error"]["code"], "episode_terminated")

    def test_inventory_provenance_and_deduplication(self):
        manifest = json.loads((DIRECTORY / "manifest.json").read_text())
        self.assertEqual(manifest["imported_original_records"], 165)
        self.assertEqual(manifest["selected_counts_by_domain"], {"retail": 12, "airline": 12})
        self.assertEqual(manifest["selected_distinct_original_records"] + len(manifest["exclusions"]), 165)
        self.assertEqual(len({c["id"] for c in CASES}), 24)
        self.assertEqual(len({c["provenance"]["sha256"] for c in CASES}), 24)
        self.assertEqual(hashlib.sha256(data_path("public/tau_bench/cases.jsonl").read_bytes()).hexdigest(), manifest["cases_sha256"])
        self.assertEqual(hashlib.sha256(data_path("public/tau_bench/private/original_records.jsonl").read_bytes()).hexdigest(), manifest["original_records_sha256"])
        for item in manifest["files"]:
            self.assertEqual(hashlib.sha256(data_path("public/tau_bench/private/upstream/" + item["path"]).read_bytes()).hexdigest(), item["sha256"], item["path"])
        for case in CASES:
            expected = hashlib.sha256(json.dumps(case["data"]["original_record"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            self.assertEqual(case["provenance"]["sha256"], expected)
            self.assertEqual(case["provenance"]["revision"], adapter.REVISION)


if __name__ == "__main__":
    unittest.main()
