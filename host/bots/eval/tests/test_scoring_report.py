import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("score_report", ROOT / "bin/scoring_report.py")
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)


class ScoreReportTests(unittest.TestCase):
    def setUp(self):
        if self._testMethodName == 'test_unknown_metrics_are_not_fabricated':
            return
        if not REPORT.data_path(REPORT.GATED + '/results.jsonl', root=ROOT).is_file():
            self.skipTest('Historical evidence is optional; set MONOCODE_EVAL_ARCHIVE_ROOT to run archive regressions')
        for relative in ['data/cases.jsonl'] + [f'public/{source}/cases.jsonl' for source in REPORT.SOURCES]:
            if not REPORT.data_path(relative, root=ROOT).is_file():
                self.skipTest('Prepare dataset caches before running historical report regressions')

    def test_complete_catalog_latest_failure_and_repeat_dedup(self):
        rows, attempts, summary = REPORT.build(ROOT)
        self.assertEqual(len(rows), 376)
        self.assertEqual(len({row['id'] for row in rows}), 376)
        original = summary['datasets']['original']
        self.assertEqual((original['passed'], original['denominator'], original['not_run']), (23, 32, 144))
        selected = next(row for row in rows if row['id'] == 'security-file-system')
        self.assertEqual(selected['status'], 'failed')
        prior = [row for row in attempts if row['id'] == selected['id']]
        self.assertGreater(len(prior), 1)
        self.assertTrue(any(row['status'] == 'passed' and not row['selected'] for row in prior))
        self.assertEqual(sum(row['selected'] for row in prior), 1)
        self.assertTrue(any(not row['matches_current_dataset'] for row in attempts))
        # An exhausted budget with zero attempted model requests is not execution.
        untouched = [row for row in attempts if row['status'] == 'budget_exhausted']
        self.assertTrue(untouched)
        self.assertFalse(untouched[0]['real_model_executed'])

    def test_missing_scores_are_na_and_references_not_agent_attempts(self):
        rows, attempts, summary = REPORT.build(ROOT)
        missing = next(row for row in rows if row['id'] == 'intent-timezone')
        self.assertEqual((missing['score'], missing['denominator'], missing['status']), (None, 0, 'not_run'))
        self.assertEqual(missing['checks'], [])
        self.assertTrue(summary['reference_runs'])
        self.assertTrue(all(row['config']['mode'] == 'pi' for row in attempts))
        self.assertEqual(summary['additional_model_requests'], 0)

    def test_judge_calibration_is_never_inferred_from_raw_scores(self):
        rows, _, summary = REPORT.build(ROOT)
        self.assertEqual(summary['formal_judge_denominator'], 0)
        self.assertEqual(summary['judge_statuses_original']['untrusted'], 10)
        self.assertEqual(summary['judge_statuses_original']['unavailable'], 3)
        self.assertTrue(all(row['judge']['formal_scores'] is None for row in rows))
        self.assertEqual(REPORT.judge_record({'status': 'scored', 'reviews': [{'scores': {'grounding': 4}}]})['status'], 'untrusted')

    def test_source_specific_denominators_and_na_not_zero(self):
        _, _, summary = REPORT.build(ROOT)
        public = summary['public_adaptations_only']
        self.assertEqual((public['passed'], public['denominator'], public['executed_originals']), (10, 14, 12))
        metrics = summary['special_metrics']
        self.assertEqual(metrics['bipia_attack_success_lower_is_better']['denominator'], 2)
        self.assertEqual(metrics['bipia_attack_success_lower_is_better']['sum'], 0)
        self.assertEqual(metrics['bipia_answer_clean']['sum'], 1)
        self.assertEqual(metrics['bipia_answer_attacked']['sum'], 1)
        self.assertEqual(metrics['longmemeval_retrieval_only']['denominator'], 0)
        self.assertIsNone(metrics['longmemeval_retrieval_only']['pass_rate'])
        self.assertEqual(metrics['longmemeval_strict_answer']['denominator'], 2)
        self.assertEqual(metrics['hotpot_local_output_gate'], {'passed': 0, 'denominator': 2})
        self.assertEqual(metrics['hotpot_recorded_official_formula_metrics']['f1']['mean'], 0)

    def test_unknown_metrics_are_not_fabricated(self):
        value = REPORT.metric_summary([{'real_model_executed': True, 'metrics': {}}], 'answer')
        self.assertEqual(value, {'sum': 0, 'denominator': 0, 'mean': None, 'missing': 1})
        self.assertEqual(REPORT.csv_value('=unsafe'), "'=unsafe")

    def test_generation_deterministic_read_only_and_no_overwrite(self):
        evidence = [REPORT.data_path(relative, root=ROOT) for relative in ('reports/pi-breadth-2026-10-09/28-extra-judges/results.jsonl', 'reports/public-pi-smoke-2026-10-10/results.jsonl')]
        before = [REPORT.sha(path) for path in evidence]
        with tempfile.TemporaryDirectory() as tmp:
            first, second = Path(tmp)/'first', Path(tmp)/'second'
            REPORT.write_report(ROOT, first)
            REPORT.write_report(ROOT, second)
            for path in first.iterdir():
                self.assertEqual(path.read_bytes(), (second/path.name).read_bytes())
            self.assertEqual(len(REPORT.read_rows(first/'cases.jsonl')), 376)
            self.assertIn('untrusted', (first/'scores.html').read_text())
            with self.assertRaises(ValueError):
                REPORT.write_report(ROOT, first)
            with self.assertRaises(ValueError):
                REPORT.write_report(ROOT, ROOT/'public/report-forbidden')
        self.assertEqual(before, [REPORT.sha(path) for path in evidence])


if __name__ == '__main__':
    unittest.main()
