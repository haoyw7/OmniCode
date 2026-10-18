import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

SPEC = importlib.util.spec_from_file_location("public_bridge", Path(__file__).parents[1] / "public/bridge.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class Counter:
    def __init__(self, case, seed=17):
        self.value = 0
    def start(self):
        return {"prompt": "Add one", "tools": [{"name": "add", "description": "Add", "parameters": {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"], "additionalProperties": False}}]}
    def call(self, action, arguments):
        self.value += arguments["n"]
        return {"value": self.value}
    def grade(self, final, trace):
        return {"passed": self.value == 1, "checks": [{"name": "value", "passed": self.value == 1}], "metrics": {"local_strict_call_set_accuracy": float(self.value == 1)}}
    def reference(self):
        return [{"calls": [{"action": "add", "requestId": "a", "input": {"n": 1}}]}, {"calls": [], "final": "done"}]


class BridgeTest(unittest.TestCase):
    def setUp(self):
        module = SimpleNamespace(load_cases=lambda: [{"id": "fake/1", "source": "fake", "category": "counter", "variant": "original", "upstream_id": "1", "provenance": {"revision": "test"}, "data": {"gold": "never expose"}}], Episode=Counter)
        self.session = bridge.Session(loader=lambda _: module)
        self.session.handle({"op": "init", "source": "fake", "id": "fake/1"})
    def test_no_private_data_and_reset(self):
        public = self.session.handle({"op": "list", "source": "fake"})
        self.assertNotIn("data", public[0])
        self.assertNotIn("gold", str(public))
        self.session.handle({"op": "call", "action": "add", "requestId": "a", "input": {"n": 1}})
        self.session.handle({"op": "init", "source": "fake", "id": "fake/1"})
        self.assertFalse(self.session.handle({"op": "grade", "final": "done"})["passed"])
        self.assertEqual(self.session.handle({"op": "grade", "final": "done"})["metrics"]["local_strict_call_set_accuracy"], 0)
    def test_idempotency_and_conflicting_keys(self):
        call = {"op": "call", "action": "add", "requestId": "a", "input": {"n": 1}}
        self.assertEqual(self.session.handle(call), self.session.handle(call))
        self.assertTrue(self.session.handle({"op": "grade", "final": "done"})["passed"])
        result = self.session.handle({**call, "input": {"n": 2}})
        self.assertEqual(result["error"]["code"], "IDEMPOTENCY_CONFLICT")
        self.assertFalse(self.session.handle({"op": "grade", "final": "done"})["passed"])
        self.assertEqual(self.session.handle({"op": "grade", "final": "done"})["metrics"]["local_strict_call_set_accuracy"], 0)
    def test_unknown_and_bad_arguments_cannot_mutate(self):
        for action, args in [("shell", {}), ("add", {"n": True}), ("add", {"n": 1, "extra": "x"})]:
            value = self.session.handle({"op": "call", "action": action, "requestId": str(args), "input": args})
            self.assertIn("error", value)
        self.assertEqual(self.session.episode.value, 0)
    def test_atomic_validation_has_no_effects_and_checks_full_batch(self):
        good = {"action": "add", "requestId": "a", "input": {"n": 1}}
        bad = {"action": "add", "requestId": "b", "input": {"n": True}}
        result = self.session.handle({"op": "validate_calls", "calls": [good, bad]})
        self.assertFalse(result["valid"])
        self.assertEqual(result["rejected"][0]["error"]["code"], "INVALID_ARGUMENTS")
        self.assertEqual(self.session.episode.value, 0)
        self.assertEqual(self.session.trace, [])
        self.assertEqual(self.session.cache, {})
        self.assertTrue(self.session.handle({"op": "validate_calls", "calls": [good]})["valid"])

    def test_atomic_validation_rejects_unknown_and_conflicting_batch_ids(self):
        good = {"action": "add", "requestId": "a", "input": {"n": 1}}
        for bad, code in [({**good, "action": "shell"}, "UNKNOWN_ACTION"), ({**good, "input": {"n": 2}}, "IDEMPOTENCY_CONFLICT")]:
            result = self.session.handle({"op": "validate_calls", "calls": [good, bad]})
            self.assertFalse(result["valid"])
            self.assertEqual(result["rejected"][0]["error"]["code"], code)
            self.assertEqual(self.session.episode.value, 0)

    def test_reference_never_in_start(self):
        start = self.session.handle({"op": "init", "source": "fake", "id": "fake/1"})
        self.assertNotIn("reference", start)
        self.assertNotIn("never expose", str(start))


if __name__ == "__main__":
    unittest.main()
