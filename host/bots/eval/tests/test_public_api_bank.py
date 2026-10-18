"""Offline native-execution regressions for the API-Bank public subset."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))
from eval_data import data_path

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'api_bank'
spec = importlib.util.spec_from_file_location('api_bank_under_test', ROOT / 'adapter.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


def execute_reference(episode):
    trace = []
    final = ''
    for step in episode.reference():
        for call in step.get('calls', []):
            result = episode.call(call['action'], call['input'])
            trace.append({**call, 'result': result})
        if 'final' in step:
            final = step['final']
    return final, trace


class PublicAPIBankTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not data_path('public/api_bank/cases.jsonl').is_file():
            raise unittest.SkipTest('Prepare the API-Bank cache before running dataset regressions')
        cls.cases = api.load_cases()
        cls.by_api = {case['data']['target']['api_name']: case for case in cls.cases}

    def test_all_32_references_execute_native_tools(self):
        self.assertEqual(len(self.cases), 32)
        self.assertEqual(len(self.by_api), 32)
        for case in self.cases:
            with self.subTest(case=case['id']):
                episode = api.Episode(case)
                final, trace = execute_reference(episode)
                result = episode.grade(final, trace)
                self.assertTrue(result['passed'], result)
                self.assertEqual(trace[0]['result']['api_name'], case['data']['target']['api_name'])
                self.assertEqual(len(result['checks']), 6)

    def test_empty_action_and_wrong_final_fail_every_case(self):
        for case in self.cases:
            with self.subTest(case=case['id']):
                episode = api.Episode(case)
                final = episode.reference()[-1]['final']
                self.assertFalse(episode.grade(final, [])['passed'])
                _, trace = execute_reference(episode)
                self.assertFalse(episode.grade('done', trace)['passed'])
                self.assertFalse(episode.grade('{}', trace)['passed'])

    def test_forged_result_does_not_pass_without_execution(self):
        episode = api.Episode(self.cases[0])
        call = episode.reference()[0]['calls'][0]
        final = episode.reference()[-1]['final']
        forged = [{**call, 'result': copy.deepcopy(episode._expected_result)}]
        grade = episode.grade(final, forged)
        self.assertFalse(grade['passed'])
        self.assertFalse(grade['checks'][0]['passed'])

    def test_corrupted_trace_rejected_after_real_execution(self):
        episode = api.Episode(self.cases[0])
        final, trace = execute_reference(episode)
        trace[0]['result']['output'] = 'fabricated'
        self.assertFalse(episode.grade(final, trace)['passed'])

    def test_unknown_actions_and_extra_arguments_do_not_mutate(self):
        episode = api.Episode(self.cases[0])
        before = api.snapshot(episode._manager)
        self.assertIn('error', episode.call('DeleteUserFiles', {'path': '/tmp'}))
        call = episode.reference()[0]['calls'][0]
        self.assertIn('error', episode.call(call['action'], {**call['input'], '__extra__': True}))
        self.assertIn('error', episode.call(call['action'], {}))
        self.assertEqual(api.snapshot(episode._manager), before)
        self.assertFalse(episode.grade(episode.reference()[-1]['final'], [])['passed'])

    def test_wrong_native_argument_cannot_pass(self):
        case = self.by_api['QueryStock']
        episode = api.Episode(case)
        call = episode.reference()[0]['calls'][0]
        call['input']['stock_code'] = 'UNKNOWN'
        result = episode.call(call['action'], call['input'])
        self.assertIsNotNone(result['exception'])
        grade = episode.grade(json.dumps({key: result[key] for key in ('api_name', 'output', 'exception')}), [{**call, 'result': result}])
        self.assertFalse(grade['passed'])

    def test_native_exception_is_structured_and_does_not_escape(self):
        episode = api.Episode(self.by_api['BookHotel'])
        call = episode.reference()[0]['calls'][0]
        call['input']['check_in_time'] = 'not-a-date'
        result = episode.call(call['action'], call['input'])
        self.assertIsNone(result['output'])
        self.assertIsInstance(result['exception'], str)
        self.assertFalse(episode.grade('{}', [{**call, 'result': result}])['passed'])

    def test_state_check_closes_weak_upstream_health_checker(self):
        episode = api.Episode(self.by_api['RecordHealthData'])
        call = episode.reference()[0]['calls'][0]
        call['input']['health_data'][0]['value'] = '999999'
        result = episode.call(call['action'], call['input'])
        # This upstream checker ignores health_data values. Full state must catch it.
        self.assertTrue(api.native_check(episode._manager, episode._target, result))
        final = json.dumps({key: result[key] for key in ('api_name', 'output', 'exception')})
        grade = episode.grade(final, [{**call, 'result': result}])
        self.assertFalse(grade['passed'])
        self.assertFalse(next(c for c in grade['checks'] if c['name'] == 'full_local_database_state')['passed'])

    def test_episode_reset_and_mutation_isolation(self):
        case = next(c for c in self.cases if c['data']['target']['api_name'] == 'AddAgenda')
        first, second = api.Episode(case), api.Episode(case)
        initial = api.snapshot(second._manager)
        final, trace = execute_reference(first)
        self.assertTrue(first.grade(final, trace)['passed'])
        self.assertNotEqual(api.snapshot(first._manager), initial)
        self.assertEqual(api.snapshot(second._manager), initial)
        trace[0]['result']['output'] = 'client mutation'
        self.assertEqual(first._ledger[0]['result']['output'], 'success')
        final2, trace2 = execute_reference(second)
        self.assertTrue(second.grade(final2, trace2)['passed'])
        self.assertEqual(api.snapshot(first._manager), api.snapshot(second._manager))

    def test_start_contains_only_observed_context_and_schemas(self):
        case = copy.deepcopy(self.cases[0])
        case['data']['raw_record']['expected_output'] = 'HIDDEN_FUTURE_CANARY'
        case['data']['future_tool_result'] = 'FUTURE_RESULT_CANARY'
        episode = api.Episode(case)
        start = episode.start()
        rendered = json.dumps(start)
        self.assertNotIn('HIDDEN_FUTURE_CANARY', rendered)
        self.assertNotIn('FUTURE_RESULT_CANARY', rendered)
        self.assertNotIn('expected_output', rendered)
        self.assertEqual(set(start), {'prompt', 'tools'})
        self.assertIn(case['data']['input'].removesuffix('Generate API Request:\n'), start['prompt'])
        self.assertTrue(all(t['parameters']['additionalProperties'] is False for t in start['tools']))

    def test_native_prehistory_replayed_and_fixture_files_unchanged(self):
        case = next(c for c in self.cases if c['data']['history_api_count'] > 0)
        manifest = json.loads((ROOT / 'manifest.json').read_text())
        fixtures = [data_path('public/api_bank/' + file['path']) for file in manifest['initial_state']['files']]
        self.assertTrue(fixtures)
        before = {p.name: p.read_bytes() for p in fixtures}
        episode = api.Episode(case)
        manual = api.ToolManager()
        for record in case['data']['history']:
            if record['role'] == 'API':
                api.dispatch(manual, record['api_name'], api.canonical_arguments(manual, record))
        self.assertEqual(episode._initial_state, api.snapshot(manual))
        execute_reference(episode)
        self.assertEqual(before, {p.name: p.read_bytes() for p in fixtures})

    def test_offline_and_no_provider_modules_loaded(self):
        with patch.object(socket, 'create_connection', side_effect=AssertionError('network forbidden')):
            for case in self.cases:
                episode = api.Episode(case)
                final, trace = execute_reference(episode)
                self.assertTrue(episode.grade(final, trace)['passed'])
        loaded = [name for name in sys.modules if name.startswith('_monocode_public_api_bank_vendor')]
        self.assertFalse(any(fragment in name for name in loaded for fragment in ('tool_search', 'translate', 'dictionary', 'search_engine', 'utils')))

    def test_arithmetic_guard_blocks_code_and_unbounded_syntax(self):
        episode = api.Episode(self.by_api['Calculator'])
        for formula in ("__import__('os').system('echo bad')", '((1+2)*3)', '(' * 500 + '1+2' + ')' * 500, '1**9999999'):
            self.assertIn('error', episode.call('Calculator', {'formula': formula}))

    def test_manifest_checksums_and_exact_mapping(self):
        manifest = json.loads((ROOT / 'manifest.json').read_text())
        self.assertEqual(manifest['imported_original_records'], 534)
        self.assertEqual(manifest['executable_variants'], 32)
        self.assertEqual(manifest['distinct_dialogues'], 32)
        for file in manifest['data']['files'] + manifest['initial_state']['files']:
            self.assertEqual(hashlib.sha256(data_path('public/api_bank/' + file['path']).read_bytes()).hexdigest(), file['sha256'])
        mapping = json.loads(data_path('public/api_bank/raw/data_mapping.json').read_text())
        self.assertEqual(len(mapping), 399)
        self.assertTrue(all(row['expected_call_exact_match'] for row in mapping))
        excluded = [json.loads(line) for line in data_path('public/api_bank/exclusions.jsonl').read_text().splitlines()]
        self.assertEqual(len(excluded) + len(self.cases), 534)
        self.assertEqual(len({case['upstream_id'] for case in self.cases}), 32)

    def test_selected_native_methods_preserved_verbatim(self):
        original = (ROOT / 'raw/upstream_code/tool_manager.py').read_text()
        vendor = (ROOT / 'vendor/tool_manager.py').read_text()
        a = next(n for n in ast.parse(original).body if isinstance(n, ast.ClassDef))
        b = next(n for n in ast.parse(vendor).body if isinstance(n, ast.ClassDef))
        by_name = {n.name: n for n in a.body if isinstance(n, ast.FunctionDef)}
        for method in b.body:
            if isinstance(method, ast.FunctionDef) and method.name != '__init__':
                self.assertEqual(ast.get_source_segment(vendor, method), ast.get_source_segment(original, by_name[method.name]))

    def test_no_file_effect_or_network_primitives_in_vendored_apis(self):
        banned_names = {'open', 'eval', 'exec', 'compile', '__import__'}
        allowed_imports = {'datetime', 'json', 'os', 'api'}
        for file in (ROOT / 'vendor/apis').glob('*.py'):
            tree = ast.parse(file.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(n.name in allowed_imports for n in node.names), file)
                elif isinstance(node, ast.ImportFrom):
                    self.assertIn(node.module, allowed_imports, file)
                elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, banned_names, file)


if __name__ == '__main__':
    unittest.main()
