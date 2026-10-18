"""External historical storage and evidence/output containment regressions."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'bin'))
import eval_data

SPEC = importlib.util.spec_from_file_location('archive_score_report', ROOT / 'bin/scoring_report.py')
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)


class ArchivePathsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        self.root = self.base / 'project/host/bots/eval'
        (self.root / 'data').mkdir(parents=True)
        (self.root / 'data/datasets.lock.json').write_text(json.dumps({'sources': {}}))
        self.environment = patch.dict(os.environ, {'XDG_DATA_HOME': str(self.base / 'user-data')}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_archive_default_and_explicit_root_preserve_logical_paths(self):
        archive = self.base / 'user-data/monocode/eval-archive'
        self.assertEqual(eval_data.archive_root(self.root), archive)
        self.assertEqual(eval_data.data_path('reports/run/results.jsonl', self.root), archive / 'reports/run/results.jsonl')
        explicit = self.base / 'existing-archive'
        with patch.dict(os.environ, {'MONOCODE_EVAL_ARCHIVE_ROOT': str(explicit)}):
            self.assertEqual(eval_data.data_path('reports/run/results.jsonl', self.root), explicit / 'reports/run/results.jsonl')
            self.assertEqual(eval_data.resolve_data_file(self.root / 'reports/run', self.root), explicit / 'reports/run')
        self.assertEqual(eval_data.data_path('data/judge-calibration.json', self.root), self.root / 'data/judge-calibration.json')

    def test_custom_fixture_root_remains_local(self):
        fixture = self.base / 'fixture'
        fixture.mkdir()
        self.assertEqual(eval_data.data_path('reports/run/results.jsonl', fixture), fixture / 'reports/run/results.jsonl')
        self.assertEqual(eval_data.require_external_output(fixture / 'reports/new', fixture), fixture / 'reports/new')

    def test_evidence_rejects_absolute_traversal_and_symlink_escape(self):
        reports = eval_data.data_path('reports', self.root)
        reports.mkdir(parents=True)
        outside = self.base / 'outside.jsonl'
        outside.write_text('private')
        (reports / 'escape.jsonl').symlink_to(outside)
        for relative in ('../outside.jsonl', str(outside), 'reports/escape.jsonl', ''):
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                REPORT.evidence_path(relative, self.root)

    def test_outputs_reject_project_paths_and_symlink_aliases(self):
        project = self.root.parents[2]
        alias = self.base / 'project-alias'
        alias.symlink_to(project, target_is_directory=True)
        for output in (self.root / 'reports/new', project / 'build/report', alias / 'new-report'):
            with self.subTest(output=output), self.assertRaises(ValueError):
                eval_data.require_external_output(output, self.root)
        self.assertEqual(eval_data.require_external_output(self.base / 'new-report', self.root), self.base / 'new-report')

    def test_missing_archive_fails_before_dataset_preparation(self):
        with patch.object(REPORT, 'ensure_data', side_effect=AssertionError('must not download')):
            with self.assertRaisesRegex(FileNotFoundError, 'MONOCODE_EVAL_ARCHIVE_ROOT'):
                REPORT.build(self.root)


if __name__ == '__main__':
    unittest.main()
