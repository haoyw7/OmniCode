"""Offline tau-bench state-transition subset (explicit local user-protocol adaptation)."""
from __future__ import annotations

import ast
import copy
import hashlib
import json
import math
import operator
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(ROOT.parents[1] / "bin"))
from eval_data import data_path
VENDOR = ROOT / "private" / "upstream"
REVISION = "59a200c6d575d595120f1cb70fea53cef0632f6b"
VARIANT = "fully_disclosed_state_transition"


def load_cases():
    return [json.loads(line) for line in data_path("public/tau_bench/cases.jsonl").read_text().splitlines() if line]


def _hashable(item):
    # Equivalent to upstream envs/base.py:to_hashable (including list order).
    if isinstance(item, dict):
        return tuple((key, _hashable(value)) for key, value in sorted(item.items()))
    if isinstance(item, list):
        return tuple(_hashable(element) for element in item)
    if isinstance(item, set):
        return tuple(sorted(_hashable(element) for element in item))
    return item


def state_hash(data):
    return hashlib.sha256(str(_hashable(data)).encode("utf-8")).hexdigest()


@lru_cache(maxsize=2)
def _initial_data(domain):
    if domain not in {"retail", "airline"}:
        raise ValueError("unsupported domain")
    path = data_path(f"public/tau_bench/private/upstream/tau_bench/envs/{domain}/data")
    return {f.stem: json.loads(f.read_text()) for f in sorted(path.glob("*.json"))}


class _Tool:
    """Import shim for the upstream abstract Tool; has no execution behavior."""


@lru_cache(maxsize=2)
def _tools(domain):
    """Load only audited vendored tool classes; never import upstream providers."""
    if domain not in {"retail", "airline"}:
        raise ValueError("unsupported domain")
    result = {}
    directory = VENDOR / "tau_bench" / "envs" / domain / "tools"
    for path in sorted(directory.glob("*.py")):
        if path.name == "__init__.py":
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        nodes = []
        for node in tree.body:
            if isinstance(node, ast.ImportFrom) and node.module == "tau_bench.envs.tool":
                continue
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module]
                if any(name not in {"typing", "json", "copy"} for name in names):
                    raise RuntimeError("unaudited import in vendored tool")
            # The native calculate.invoke contains eval; do not compile it at all.
            if path.stem == "calculate" and isinstance(node, ast.ClassDef):
                node.body = [n for n in node.body if not isinstance(n, ast.FunctionDef) or n.name != "invoke"]
            nodes.append(node)
        tree.body = nodes
        namespace = {"Tool": _Tool, "__name__": f"_tau_offline_{domain}_{path.stem}"}
        exec(compile(tree, str(path), "exec"), namespace)
        classes = [v for v in namespace.values() if isinstance(v, type) and v is not _Tool and issubclass(v, _Tool)]
        if len(classes) != 1:
            raise RuntimeError("unexpected vendored tool class")
        cls = classes[0]
        result[cls.get_info()["function"]["name"]] = cls
    return result


def _bounded_calculate(expression):
    if len(expression) > 256 or not all(c in "0123456789+-*/(). " for c in expression):
        raise ValueError("invalid or overlong arithmetic expression")
    tree = ast.parse(expression, mode="eval")
    if sum(1 for _ in ast.walk(tree)) > 64:
        raise ValueError("expression exceeds 64 AST nodes")
    operations = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
                  ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv}

    def visit(node):
        if isinstance(node, ast.Expression):
            value = visit(node.body)
        elif isinstance(node, ast.Constant) and type(node.value) in {int, float}:
            value = float(node.value)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = visit(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        elif isinstance(node, ast.BinOp) and type(node.op) in operations:
            value = operations[type(node.op)](visit(node.left), visit(node.right))
        else:
            raise ValueError("only bounded numeric + - * / // operations are supported")
        if not math.isfinite(value) or abs(value) > 1e12:
            raise ValueError("arithmetic magnitude exceeds 1e12")
        return value

    return str(round(visit(tree), 2))


def _validate(value, schema, path="arguments", depth=0):
    """Defense in depth for direct adapter callers; runner also validates schemas."""
    if depth > 8:
        raise ValueError(f"{path}: nesting limit")
    kind = schema.get("type")
    expected = {"object": dict, "array": list, "string": str, "integer": int}
    if kind in expected and type(value) is not expected[kind]:
        raise ValueError(f"{path}: expected {kind}")
    if kind == "number" and (type(value) not in {int, float} or not math.isfinite(value)):
        raise ValueError(f"{path}: expected finite number")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path}: not an allowed value")
    if type(value) in {int, float} and abs(value) > 1e12:
        raise ValueError(f"{path}: magnitude limit")
    if isinstance(value, str) and len(value) > 8192:
        raise ValueError(f"{path}: string limit")
    if kind == "object":
        properties = schema.get("properties", {})
        if set(value) - set(properties):
            raise ValueError(f"{path}: unknown arguments")
        if set(schema.get("required", [])) - set(value):
            raise ValueError(f"{path}: missing required arguments")
        for key, item in value.items():
            _validate(item, properties[key], f"{path}.{key}", depth + 1)
    if kind == "array":
        if len(value) > 100:
            raise ValueError(f"{path}: array limit")
        for item in value:
            _validate(item, schema.get("items", {}), path + "[]", depth + 1)


def _error(code, message):
    return {"ok": False, "error": {"code": code, "message": str(message)}}


class Episode:
    def __init__(self, case, seed=17):
        self.case = copy.deepcopy(case)
        self.domain = case["data"]["domain"]
        self.task = self.case["data"]["original_record"]
        self.seed = seed  # No runtime randomness in these native tools.
        self.state = copy.deepcopy(_initial_data(self.domain))
        self._tools = _tools(self.domain)
        self._calls = []
        self._terminated = False

    def start(self):
        path = VENDOR / "tau_bench" / "envs" / self.domain
        wiki = (path / "wiki.md").read_text()
        rules_tree = ast.parse((path / "rules.py").read_text())
        rules = next(ast.literal_eval(n.value) for n in rules_tree.body if isinstance(n, ast.Assign))
        prompt = (
            "You are a customer-service assistant in a fully offline simulated environment.\n"
            "LOCAL ADAPTATION: the complete user-simulator scenario is disclosed below. "
            "It describes the customer's preferences, including conditional preferences. "
            "Preferences that would be revealed after a question or confirmation are already "
            "disclosed; use the later stated preference when the customer changes their mind. "
            "There is no live user simulator or follow-up turn. For this local variant, treat "
            "policy-compliant changes requested in this brief as pre-authorized by the customer's "
            "explicit yes; the original interactive confirmation requirement is waived. "
            "Resolve identifiers and factual details through tools. Perform the requested operations "
            "and finish with a concise user-facing summary including any requested amounts. "
            "Tools and payments affect simulated in-memory records only.\n\n"
            + "UPSTREAM POLICY (retained verbatim):\n" + wiki
            + "\nUPSTREAM RULES:\n" + "\n".join(rules)
            + "\n\nCOMPLETE CUSTOMER SCENARIO (verbatim upstream user instruction):\n"
            + self.task["instruction"]
        )
        schemas = []
        for cls in self._tools.values():
            info = copy.deepcopy(cls.get_info()["function"])
            # Tighten upstream's implicit open object schemas for safe direct calls.
            def close(schema):
                if schema.get("type") == "object":
                    schema["additionalProperties"] = False
                    for child in schema.get("properties", {}).values():
                        close(child)
                if "items" in schema:
                    close(schema["items"])
            close(info["parameters"])
            if info["name"] == "calculate":
                info["description"] += " Local bounded parser: max 256 characters, no exponentiation."
            schemas.append(info)
        return {"prompt": prompt, "tools": schemas}

    def call(self, action, arguments):
        if not isinstance(action, str) or action not in self._tools:
            return _error("unknown_action", "Unknown tool")
        if self._terminated:
            return _error("episode_terminated", "Human transfer already ended this episode")
        cls = self._tools[action]
        try:
            _validate(arguments, cls.get_info()["function"]["parameters"])
        except (ValueError, TypeError, OverflowError) as exc:
            return _error("invalid_arguments", exc)
        candidate = copy.deepcopy(self.state)
        try:
            if action == "calculate":
                raw = _bounded_calculate(arguments["expression"])
            else:
                raw = cls.invoke(data=candidate, **copy.deepcopy(arguments))
            if isinstance(raw, str) and raw.startswith("Error:"):
                return _error("upstream_error", raw)
            try:
                result = json.loads(raw) if isinstance(raw, str) else raw
            except (json.JSONDecodeError, TypeError):
                result = raw
            json.dumps(result, allow_nan=False)
        except Exception as exc:
            return _error("tool_error", f"{type(exc).__name__}: {exc}")
        self.state = candidate
        self._calls.append({"action": action, "input": copy.deepcopy(arguments)})
        if action == "transfer_to_human_agents":
            self._terminated = True
        return {"ok": True, "result": result}

    def _expected_state(self):
        state = copy.deepcopy(_initial_data(self.domain))
        for action in self.task["actions"]:
            # Native reward skips the domain's terminate tool.
            if action["name"] in {"respond", "transfer_to_human_agents"}:
                continue
            raw = (_bounded_calculate(action["kwargs"]["expression"]) if action["name"] == "calculate"
                   else self._tools[action["name"]].invoke(data=state, **copy.deepcopy(action["kwargs"])))
            if isinstance(raw, str) and raw.startswith("Error:"):
                raise RuntimeError("selected reference action failed")
        return state

    def grade(self, final, trace):
        # The caller's trace is untrusted; actual Episode state is authoritative.
        expected = self._expected_state()
        state_ok = state_hash(self.state) == state_hash(expected)
        output_flags = {output: isinstance(final, str) and output.lower() in final.lower().replace(",", "")
                        for output in self.task["outputs"]}
        outputs_ok = all(output_flags.values())
        nonempty = isinstance(final, str) and bool(final.strip())
        checks = [
            {"name": "native_full_database_hash_match", "passed": state_ok},
            {"name": "native_required_output_substrings", "passed": outputs_ok,
             "evidence": {"required_count": len(output_flags), "matched_count": sum(output_flags.values())}},
            {"name": "local_nonempty_final", "passed": nonempty},
        ]
        return {"passed": all(check["passed"] for check in checks), "checks": checks,
                "metrics": {"local_state_transition_accuracy": float(state_ok and outputs_ok and nonempty),
                            "native_state_match": state_ok, "native_outputs_match": outputs_ok,
                            "official_tau_score": False, "variant": VARIANT}}

    def reference(self):
        decisions = []
        for index, action in enumerate(self.task["actions"]):
            if action["name"] == "respond":
                continue
            decisions.append({"calls": [{"action": action["name"],
                                          "requestId": f"tau-reference-{index}",
                                          "input": copy.deepcopy(action["kwargs"])}]})
        final = "The requested updates are complete."
        if self.task["outputs"]:
            final += " Requested result: " + "; ".join(self.task["outputs"]) + "."
        decisions.append({"calls": [], "final": final})
        return decisions
