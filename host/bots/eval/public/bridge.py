#!/usr/bin/env python3
"""Bounded JSONL transport for audited, local-only benchmark episodes.

No agent, credentials, network, subprocess, or filesystem writes in this process.
The Python audit hook is defense in depth, not a security boundary for arbitrary
untrusted Python code. Only the six reviewed adapters are loadable.
"""
import contextlib
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "bin"))
from eval_data import cache_root, dataset_lock
SOURCES = ("bfcl", "longmemeval", "tau_bench", "api_bank", "hotpotqa", "bipia")
LIMIT = 2_000_000


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def load_adapter(source):
    if source not in SOURCES:
        raise ValueError("Unknown source")
    path = ROOT / source / "adapter.py"
    spec = importlib.util.spec_from_file_location("public_" + source, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    with contextlib.redirect_stdout(sys.stderr):
        spec.loader.exec_module(module)
    return module


def metadata(case):
    return {**{k: case[k] for k in ("id", "source", "upstream_id", "category", "variant", "provenance")}, "caseHash": digest(case)}


class Session:
    def __init__(self, loader=load_adapter):
        self.loader = loader
        self.episode = None
        self.modules = {}
        self.trace = []
        self.cache = {}
        self.protocol_errors = []

    def handle(self, command):
        if not isinstance(command, dict):
            raise ValueError("Command must be an object")
        op = command.get("op")
        if op in ("list", "init"):
            source = command["source"]
            if source not in self.modules:
                self.modules[source] = self.loader(source)
            module = self.modules[source]
            cases = module.load_cases()
            ids = [case["id"] for case in cases]
            if len(set(ids)) != len(ids):
                raise ValueError("Duplicate case IDs")
            if op == "list":
                return [metadata(case) for case in cases]
            case = next((x for x in cases if x["id"] == command["id"]), None)
            if case is None:
                raise ValueError("Unknown case ID")
            self.episode = module.Episode(case, seed=command.get("seed", 17))
            self.trace, self.cache, self.protocol_errors = [], {}, []
            start = self.episode.start()
            self.tools = {tool["name"]: tool for tool in start["tools"]}
            if len(self.tools) != len(start["tools"]):
                raise ValueError("Duplicate tool names")
            for tool in start["tools"]:
                jsonschema.Draft7Validator.check_schema(tool["parameters"])
            return {**start, "case": metadata(case)}
        if self.episode is None:
            raise ValueError("Initialize an episode first")
        if op == "validate_calls":
            return self.validate_calls(command.get("calls"))
        if op == "call":
            return self.call(command)
        if op == "trace":
            return self.trace
        if op == "reference":
            return self.episode.reference()
        if op == "grade":
            grade = self.episode.grade(command.get("final", ""), [entry for entry in self.trace if not entry.get("cached")])
            if not isinstance(grade.get("passed"), bool) or not isinstance(grade.get("checks"), list):
                raise ValueError("Invalid grade shape")
            grade["checks"].append({"name": "bridge_protocol_valid", "passed": not self.protocol_errors, "evidence": self.protocol_errors})
            grade["passed"] = grade["passed"] and not self.protocol_errors
            if self.protocol_errors:
                # These local aggregate metrics include safe, schema-valid calls.
                # Keep official answer/support scores and BIPIA attack/answer
                # metrics independent of the extra local execution gate.
                for key in ("local_strict_call_set_accuracy", "local_oracle_strict_answer_accuracy", "local_state_transition_accuracy"):
                    if key in grade.get("metrics", {}):
                        grade["metrics"][key] = 0.0
            return grade
        raise ValueError("Unknown operation")

    def validate_calls(self, calls):
        if not isinstance(calls, list) or not 1 <= len(calls) <= 8:
            raise ValueError("Expected one to eight calls")
        rejected, signatures = [], {}
        for call in calls:
            error = None
            if not isinstance(call, dict) or set(call) != {"action", "requestId", "input"}:
                error = "INVALID_CALL"
            else:
                action, key, args = call["action"], call["requestId"], call["input"]
                signature = digest({"action": action, "input": args})
                if not isinstance(key, str) or not 1 <= len(key) <= 128:
                    error = "INVALID_REQUEST_ID"
                elif not isinstance(action, str) or action not in self.tools:
                    error = "UNKNOWN_ACTION"
                elif key in signatures and signatures[key] != signature:
                    error = "IDEMPOTENCY_CONFLICT"
                elif key in self.cache and self.cache[key][0] != signature:
                    error = "IDEMPOTENCY_CONFLICT"
                else:
                    try:
                        jsonschema.Draft7Validator(self.tools[action]["parameters"]).validate(args)
                    except jsonschema.ValidationError:
                        error = "INVALID_ARGUMENTS"
                signatures[key] = signature
            if error:
                rejected.append({"call": call, "error": {"code": error}})
        return {"valid": not rejected, "rejected": rejected}

    def call(self, command):
        action, args, key = command.get("action"), command.get("input"), command.get("requestId")
        signature = digest({"action": action, "input": args})
        error = None
        if not isinstance(key, str) or not 1 <= len(key) <= 128:
            error = "INVALID_REQUEST_ID"
        elif key in self.cache:
            old_signature, result = self.cache[key]
            if old_signature == signature:
                self.trace.append({"action": action, "input": args, "requestId": key, "result": result, "cached": True})
                return result
            error = "IDEMPOTENCY_CONFLICT"
        elif action not in self.tools:
            error = "UNKNOWN_ACTION"
        else:
            try:
                jsonschema.Draft7Validator(self.tools[action]["parameters"]).validate(args)
            except jsonschema.ValidationError:
                error = "INVALID_ARGUMENTS"
        if error:
            result = {"error": {"code": error}}
            self.protocol_errors.append({"code": error, "action": action, "requestId": key})
        else:
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    result = self.episode.call(action, args)
                # Validate output serializability before accepting/caching it.
                json.dumps(result, allow_nan=False)
            except Exception as exc:
                result = {"error": {"code": "TOOL_ERROR", "type": type(exc).__name__, "message": str(exc)[:500]}}
            self.cache[key] = (signature, result)
        self.trace.append({"action": action, "input": args, "requestId": key, "result": result, "cached": False})
        return result


def restrict_runtime():
    """Audited native tools need only public fixture/module reads and memory writes."""
    datasets = cache_root()
    dataset_lock()
    os.environ.clear()
    os.environ["MONOCODE_EVAL_DATA_ROOT"] = str(datasets)
    sys.dont_write_bytecode = True
    read_roots = [ROOT, ROOT.parent / "bin", ROOT.parent / "data", datasets, Path(sys.base_prefix) / "lib", Path("/usr/lib"), Path("/usr/local/lib"), Path("/usr/share")]

    def audit(event, args):
        if event.startswith("socket.") or event in ("subprocess.Popen", "os.system", "os.posix_spawn", "os.exec", "os.fork"):
            raise PermissionError("Network and subprocess are disabled in public fixtures")
        if event == "open":
            path, mode, flags = args
            if (isinstance(mode, str) and any(ch in mode for ch in "wax+")) or (isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)):
                raise PermissionError("File writes are disabled in public fixtures")
            if isinstance(path, (str, bytes, os.PathLike)):
                resolved = Path(os.fsdecode(path)).resolve()
                if resolved != Path("/dev/null") and not any(resolved.is_relative_to(root) for root in read_roots):
                    raise PermissionError("Only public fixtures and Python runtime files may be read")
        if event in ("os.remove", "os.rename", "os.mkdir", "os.rmdir", "os.symlink", "os.link", "os.chmod", "os.truncate"):
            raise PermissionError("Filesystem mutation is disabled in public fixtures")

    sys.addaudithook(audit)


def main():
    restrict_runtime()
    session = Session()
    for line in sys.stdin:
        try:
            if len(line) > LIMIT:
                raise ValueError("Input limit exceeded")
            value = session.handle(json.loads(line))
            response = {"ok": True, "value": value}
        except Exception as exc:
            response = {"ok": False, "error": {"code": "BRIDGE_ERROR", "type": type(exc).__name__, "message": str(exc)[:700]}}
        encoded = json.dumps(response, ensure_ascii=False, allow_nan=False)
        if len(encoded) > LIMIT:
            encoded = json.dumps({"ok": False, "error": {"code": "OUTPUT_LIMIT"}})
        print(encoded, flush=True)


if __name__ == "__main__":
    main()
