"""Audited API-Bank stateful next-tool continuations (stdlib, offline).

This is a local adapted subset metric, not the complete API-Bank benchmark.
Native ToolManager dispatch and per-API checkers execute against isolated fixtures.
"""
from __future__ import annotations

import ast
import copy
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(ROOT.parents[1] / "bin"))
from eval_data import data_path
_PACKAGE = '_monocode_public_api_bank_vendor'
if _PACKAGE not in sys.modules:
    _spec = importlib.util.spec_from_file_location(_PACKAGE, ROOT / 'vendor' / '__init__.py', submodule_search_locations=[str(ROOT / 'vendor')])
    _module = importlib.util.module_from_spec(_spec)
    sys.modules[_PACKAGE] = _module
    _spec.loader.exec_module(_module)
from importlib import import_module
ToolManager = import_module(_PACKAGE + '.tool_manager').ToolManager


def load_cases():
    return [json.loads(line) for line in data_path("public/api_bank/cases.jsonl").read_text().splitlines() if line]


def canonical_arguments(manager, target):
    """Import-time bridge for upstream string-encoded lists; never evaluates code."""
    args = copy.deepcopy(target['param_dict'])
    parameters = manager.get_api_by_name(target['api_name'])['input_parameters']
    for name, value in args.items():
        kind = parameters[name]['type']
        if kind in ('list', 'list(str)') and isinstance(value, str):
            value = ast.literal_eval(value)
            if not isinstance(value, list):
                raise ValueError('encoded list is not a list')
            args[name] = value
        elif kind == 'int' and isinstance(value, str):
            args[name] = int(value)
        elif kind == 'float' and isinstance(value, str):
            args[name] = float(value)
        elif kind == 'bool' and value in ('True', 'False'):
            args[name] = value == 'True'
    return args


def dispatch(manager, action, arguments):
    args = copy.deepcopy(arguments)
    parameters = manager.get_api_by_name(action)['input_parameters']
    # Upstream ToolManager accepts a textual bool; expose standard JSON booleans.
    for name, value in args.items():
        if parameters[name]['type'] == 'bool' and type(value) is bool:
            args[name] = str(value)
    return copy.deepcopy(manager.api_call(action, **args))


def native_check(manager, target, response):
    return bool(manager.init_tool(target['api_name']).check_api_call_correctness(
        copy.deepcopy(response), copy.deepcopy(target['result'])))


def snapshot(manager):
    # Native AddAgenda creates int dictionary keys; JSON transport uses strings.
    return json.loads(json.dumps(manager.init_databases, ensure_ascii=False))


def schema(manager, action):
    info = manager.get_api_by_name(action)
    kinds = {'str': 'string', 'int': 'integer', 'float': 'number', 'bool': 'boolean', 'list': 'array', 'list(str)': 'array'}
    properties = {}
    for name, param in info['input_parameters'].items():
        prop = {'type': kinds[param['type']], 'description': param['description']}
        if param['type'] == 'list(str)':
            prop['items'] = {'type': 'string'}
        elif param['type'] == 'list':
            prop['items'] = {'type': 'object'}
        properties[name] = prop
    return {'name': action, 'description': info['description'], 'parameters': {
        'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}}


def validate_arguments(manager, action, args):
    if not isinstance(args, dict):
        raise ValueError('arguments must be an object')
    params = manager.get_api_by_name(action)['input_parameters']
    if set(args) != set(params):
        raise ValueError('missing or unknown argument')
    if len(json.dumps(args)) > 32768:
        raise ValueError('arguments exceed local bound')
    for name, value in args.items():
        kind = params[name]['type']
        okay = (kind == 'str' and isinstance(value, str) and len(value) <= 4096 or
                kind == 'int' and type(value) is int or
                kind == 'float' and type(value) in (int, float) or
                kind == 'bool' and type(value) is bool or
                kind in ('list', 'list(str)') and isinstance(value, list) and len(value) <= 128)
        if not okay:
            raise ValueError('invalid type or bound for ' + name)
        if kind == 'list(str)' and any(not isinstance(item, str) for item in value):
            raise ValueError('array elements must be strings')
        if kind == 'list' and any(not isinstance(item, dict) for item in value):
            raise ValueError('array elements must be objects')
    if action == 'Calculator':
        # Bound the native parser and exclude malformed nested/unary expressions.
        expression = ast.parse(args['formula'], mode='eval')
        nodes = list(ast.walk(expression))
        allowed = (ast.Expression, ast.BinOp, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Constant)
        if len(nodes) > 128 or any(not isinstance(n, allowed) for n in nodes):
            raise ValueError('unsupported arithmetic expression')
        if any(isinstance(n, ast.Constant) and (type(n.value) is not int or n.value < 0 or n.value > 10**15) for n in nodes):
            raise ValueError('only bounded nonnegative integer operands are supported')
        # The upstream parser does not support multiple nesting levels reliably.
        depth = maximum = 0
        for char in args['formula']:
            depth += (char == '(') - (char == ')')
            maximum = max(maximum, depth)
        if maximum > 1:
            raise ValueError('nested parentheses are outside the audited parser subset')


class Episode:
    def __init__(self, case, seed=17):
        self.case = copy.deepcopy(case)
        self.seed = seed
        data = self.case['data']
        self._target = data['target']
        self._manager = ToolManager()
        self._ledger = []
        self._allowed = tuple(data['allowed_tools'])
        # Only already-observed tool history is replayed; no future outputs are exposed.
        for target in data['history']:
            if target['role'] == 'API':
                result = dispatch(self._manager, target['api_name'], canonical_arguments(self._manager, target))
                if not native_check(self._manager, target, result) or result['output'] != target['result']['output'] or result['exception'] != target['result']['exception']:
                    raise ValueError('imported historical tool result does not replay')
        self._initial_state = snapshot(self._manager)
        oracle = ToolManager(self._initial_state)
        self._expected_result = dispatch(oracle, self._target['api_name'], canonical_arguments(oracle, self._target))
        if not native_check(oracle, self._target, self._expected_result):
            raise ValueError('imported target fails native checker')
        if self._expected_result['output'] != self._target['result']['output'] or self._expected_result['exception'] != self._target['result']['exception']:
            raise ValueError('imported target disagrees with native output')
        self._expected_state = snapshot(oracle)

    def start(self):
        return {
            'prompt': 'Continue this API-Bank dialogue at its next API action. The current year is 2023 unless the dialogue supplies a date. All accounts, passwords, records and URLs below are public synthetic benchmark fixtures; tools operate only on isolated local memory. Earlier API actions in this history have already run. Execute exactly the next requested API action using the supplied tools, then return JSON with exactly api_name, output and exception copied from its actual result. Do not perform later dialogue actions.\n\n' + self.case['data']['input'].removesuffix('Generate API Request:\n'),
            'tools': [schema(self._manager, action) for action in self._allowed],
        }

    def call(self, action, arguments):
        original = copy.deepcopy(arguments)
        try:
            if len(self._ledger) >= 8:
                raise ValueError('local call limit reached')
            if action not in self._allowed:
                raise ValueError('unknown or unavailable action')
            validate_arguments(self._manager, action, arguments)
            result = dispatch(self._manager, action, arguments)
        except Exception as exc:
            result = {'error': {'type': type(exc).__name__, 'message': str(exc)}}
        self._ledger.append({'action': action, 'input': original, 'result': copy.deepcopy(result)})
        return copy.deepcopy(result)

    def grade(self, final, trace):
        checks = []
        def check(name, passed, evidence=None):
            row = {'name': name, 'passed': bool(passed)}
            if evidence is not None: row['evidence'] = evidence
            checks.append(row)
        # Never trust a submitted success result unless this Episode executed it.
        try:
            observed = [{k: entry[k] for k in ('action', 'input', 'result')} for entry in trace]
            authentic = observed == self._ledger
        except (KeyError, TypeError):
            authentic = False
        check('executed_trace_authenticity', authentic)
        one = len(self._ledger) == 1 and self._ledger[0]['action'] == self._target['api_name']
        check('exactly_one_target_action', one)
        native = False
        if one:
            try:
                native = native_check(self._manager, self._target, self._ledger[0]['result'])
            except (KeyError, TypeError, ValueError, AssertionError, ZeroDivisionError, AttributeError):
                native = False
        check('upstream_per_api_correctness', native)
        output_matches = one and all(self._ledger[0]['result'].get(key) == self._expected_result[key] for key in ('output', 'exception'))
        check('native_result_matches_recorded_output', output_matches)
        check('full_local_database_state', snapshot(self._manager) == self._expected_state)
        answer = {key: self._expected_result[key] for key in ('api_name', 'output', 'exception')}
        try:
            final_matches = isinstance(final, str) and json.loads(final) == answer
        except (ValueError, TypeError):
            final_matches = False
        check('final_reports_executed_result', final_matches and one)
        return {'passed': all(row['passed'] for row in checks), 'checks': checks,
                'metrics': {'native_tool_calls': len(self._ledger), 'state_changed': snapshot(self._manager) != self._initial_state, 'metric': 'adapted_stateful_next_tool_continuation'}}

    def reference(self):
        return [{'calls': [{'action': self._target['api_name'], 'requestId': self.case['id'] + ':reference',
                            'input': canonical_arguments(self._manager, self._target)}]},
                {'calls': [], 'final': json.dumps({key: self._expected_result[key] for key in ('api_name', 'output', 'exception')}, ensure_ascii=False)}]
