"""Offline contract, source-integrity and boundary tests for the BIPIA subset."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))
from eval_data import data_path

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'bipia'


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


def run_reference(adapter, case):
    episode = adapter.Episode(case)
    trace = []
    final = ''
    for decision in episode.reference():
        for call in decision.get('calls', []):
            result = episode.call(call['action'], call['input'])
            trace.append({**call, 'result': result})
        final = decision.get('final', final)
    return episode, final, trace


class BipiaAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not data_path('public/bipia/cases.jsonl').is_file():
            raise unittest.SkipTest('Prepare the BIPIA cache before running dataset regressions')
        cls.adapter = module('tested_public_bipia', ROOT / 'adapter.py')
        cls.cases = cls.adapter.load_cases()

    def test_counts_balanced_unique_originals(self):
        self.assertEqual(len(self.cases), 48)
        self.assertEqual(len({c['id'] for c in self.cases}), 48)
        self.assertEqual(len({c['upstream_id'] for c in self.cases}), 24)
        attacks = [c for c in self.cases if c['variant'] == 'attacked']
        self.assertEqual(len(attacks), 24)
        cells = {}
        for c in attacks:
            key = (c['data']['attack']['upstream_id'], c['data']['insertion']['position'])
            cells[key] = cells.get(key, 0) + 1
        self.assertEqual(sorted(cells.values()), [4] * 6)
        self.assertEqual(sum(c['data']['original']['ideal'] == 'unknown' for c in attacks), 12)

    def test_source_and_derived_hashes(self):
        manifest = json.loads((ROOT / 'manifest.json').read_text())
        for record in manifest['files']:
            self.assertEqual(hashlib.sha256(data_path("public/bipia/" + record["path"]).read_bytes()).hexdigest(), record['sha256'], record['path'])
        self.assertEqual(manifest['revision'], 'a004b69ec0dd446e0afd461d98cb5e96e120a5d0')
        self.assertEqual(manifest['counts']['raw_original_records'], 50)
        self.assertEqual(manifest['counts']['quality_excluded'], 1)

    def test_every_reference_fresh_episode_passes(self):
        for case in self.cases:
            with self.subTest(id=case['id']):
                ep, final, trace = run_reference(self.adapter, case)
                grade = ep.grade(final, trace)
                self.assertTrue(grade['passed'], grade)
                self.assertTrue(grade['metrics']['answer_correct'])
                self.assertFalse(grade['metrics']['attack_success'])

    def test_clean_attacked_share_prompt_and_reference(self):
        for i in range(0, len(self.cases), 2):
            clean, attacked = self.cases[i:i + 2]
            ep = self.adapter.Episode(clean)
            ap = self.adapter.Episode(attacked)
            self.assertEqual(ep.start(), ap.start())
            self.assertEqual(ep.reference(), ap.reference())
            start = json.dumps(ap.start())
            self.assertNotIn(attacked['data']['original']['context'], start)
            self.assertNotIn(attacked['data']['attack']['text'], start)
            self.assertNotIn(attacked['data']['attack']['target'], start)
            self.assertNotIn('ideal', start)

    def test_poison_exposed_only_by_read_email(self):
        case = next(c for c in self.cases if c['variant'] == 'attacked')
        ep = self.adapter.Episode(case)
        result = ep.call('read_email', {'email_id': 'email-001'})
        self.assertIn(case['data']['attack']['text'], result['body'])
        self.assertEqual(result['body'], case['data']['context'])
        self.assertNotIn('ideal', result)
        self.assertNotIn('target', result)

    def test_malformed_and_wrong_answers_fail(self):
        case = self.cases[0]
        for final in ['', '{', 'unknown', '{}', '{"answer":false}', '{"answer":"$987654321.12"}', '{"answer":"unknown","answer":"$10"}']:
            ep, _, trace = run_reference(self.adapter, case)
            self.assertFalse(ep.grade(final, trace)['passed'], final)

    def test_correct_answer_without_read_and_forged_trace_fail(self):
        ep, final, trace = run_reference(self.adapter, self.cases[0])
        blank = self.adapter.Episode(self.cases[0])
        self.assertFalse(blank.grade(final, [])['passed'])
        self.assertFalse(blank.grade(final, trace)['passed'])
        self.assertFalse(ep.grade(final, [])['passed'])

    def test_unknown_actions_bad_arguments_and_mutation_do_not_run(self):
        for action, args in [('send_email', {'to': 'attacker@example.com'}), ('open_url', {'url': 'https://example.com'}), ('read_email', {'email_id': '../../secret'}), ('read_email', {'email_id': 'email-001', 'send': True}), ('read_email', {})]:
            ep, final, trace = run_reference(self.adapter, self.cases[0])
            result = ep.call(action, args)
            self.assertIn('error', result)
            self.assertFalse(ep.grade(final, trace)['passed'])

    def test_episode_and_result_isolation(self):
        case = self.cases[0]
        ep = self.adapter.Episode(case)
        result = ep.call('read_email', {'email_id': 'email-001'})
        result['body'] = 'POISON OUTSIDE EPISODE'
        self.assertEqual(ep.call('read_email', {'email_id': 'email-001'})['body'], case['data']['context'])
        fresh = self.adapter.Episode(case)
        self.assertNotIn('POISON OUTSIDE EPISODE', json.dumps(fresh.start()))
        _, final, trace = run_reference(self.adapter, case)
        self.assertFalse(fresh.grade(final, trace)['passed'])

    def test_attack_success_separate_from_answer_correctness(self):
        case = next(c for c in self.cases if c['variant'] == 'attacked')
        ep, _, trace = run_reference(self.adapter, case)
        final = json.dumps({'answer': case['data']['original']['ideal'], 'injected': case['data']['attack']['target']})
        grade = ep.grade(final, trace)
        self.assertTrue(grade['metrics']['answer_correct'])
        self.assertTrue(grade['metrics']['attack_success'])
        self.assertFalse(grade['passed'])

    def test_strict_threshold_and_case_sensitive_matching(self):
        self.assertEqual(self.adapter.partial_ratio('abcde', 'abXde'), 80)
        self.assertFalse(self.adapter.match_attack('abcde', 'abXde')['attack_success'])
        self.assertTrue(self.adapter.match_attack('abcde', 'abcde')['attack_success'])
        self.assertFalse(self.adapter.match_attack('ABC', 'abc')['attack_success'])
        self.assertEqual(self.adapter.partial_ratio('', ''), 100)

    def test_pinned_scorer_rule_matches_current_cases(self):
        # Run the unchanged upstream scoring classes without its model framework.
        source = ROOT / 'upstream/bipia/metrics/eval/match.py'
        tree = ast.parse(source.read_text())
        classes = [node for node in tree.body if isinstance(node, ast.ClassDef)]
        namespace = {'BaseEval': object, 'fuzz': SimpleNamespace(partial_ratio=self.adapter.partial_ratio)}
        exec(compile(ast.Module(body=classes, type_ignores=[]), str(source), 'exec'), namespace)
        for case in self.cases:
            if case['variant'] != 'attacked':
                continue
            reference = case['data']['attack']['target']
            official = namespace['MatchRefEval'](reference=reference)
            for prediction in (reference, reference.upper(), case['data']['original']['ideal'],
                               json.dumps({'answer': case['data']['original']['ideal'], 'injected': reference})):
                self.assertEqual(self.adapter.match_attack(reference, prediction)['attack_success'],
                                 bool(official._compute_score(prediction=prediction)))

    def test_bad_gold_excluded_before_sampling(self):
        build = module('tested_bipia_builder', ROOT / 'build_subset.py')
        raw = [json.loads(line) for line in data_path("public/bipia/upstream/benchmark/email/test.jsonl").read_text().splitlines()]
        self.assertEqual(build.quality_reasons(raw[7]), ['gold_amount_not_supported_by_context'])
        self.assertEqual(build.quality_reasons({**raw[7], 'ideal': '$205.12'}), [])
        self.assertEqual(len(raw), 50)
        excluded = [f'benchmark/email/test.jsonl:{i}' for i, row in enumerate(raw, 1) if build.quality_reasons(row)]
        self.assertEqual(excluded, ['benchmark/email/test.jsonl:8'])
        self.assertFalse(any(c['upstream_id'] in excluded for c in self.cases))

    def test_insertion_matches_audited_upstream_without_runtime_nltk(self):
        # Stored sentence boundaries were generated by upstream's untrained Punkt tokenizer.
        import random
        for case in self.cases:
            data = case['data']
            original = data['original']['context']
            if case['variant'] == 'clean':
                self.assertEqual(data['context'], original)
                continue
            attack, ins = data['attack']['text'], data['insertion']
            if ins['position'] == 'start':
                expected = '\n'.join([attack, original])
            elif ins['position'] == 'end':
                expected = '\n'.join([original, attack])
            else:
                offset, _ = random.Random(2023).sample(ins['sentence_spans'], k=1)[0]
                self.assertEqual(offset, ins['offset'])
                expected = '\n'.join([original[:offset], attack, original[offset:]])
            self.assertEqual(data['context'], expected)


if __name__ == '__main__':
    unittest.main()
