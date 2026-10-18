"""Network-free regression checks for dataset cache boundaries and publication."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("prepare_data", Path(__file__).resolve().parents[1] / "bin/prepare_data.py")
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


class PrepareDataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.project = self.directory / "project"
        (self.project / "data").mkdir(parents=True)
        self.content = b'{"id":"locked-example"}\n'
        self.relative = "public/bfcl/cases.jsonl"
        self.digest = hashlib.sha256(self.content).hexdigest()
        self.original_contents = {
            "data/cases.jsonl": b'{"id":"external-original"}\n',
            "data/references.jsonl": b'{"caseId":"external-original","actions":[]}\n',
            "data/variants/example.jsonl": b'{"id":"external-variant"}\n',
        }
        self.lock = {"version": 1, "sources": {"bfcl": {"files": {self.relative: self.digest}},
                                               "original": {"files": {name: hashlib.sha256(raw).hexdigest()
                                                                      for name, raw in self.original_contents.items()}}}}
        self.lock_path = self.project / "data/datasets.lock.json"
        self.lock_path.write_text(json.dumps(self.lock))
        self.root = self.directory / "cache"
        for context in (patch.object(prepare, "EVAL_ROOT", self.project),
                        patch.object(prepare, "LOCK_PATH", self.lock_path),
                        patch.dict(os.environ, {"MONOCODE_EVAL_DATA_ROOT": str(self.root),
                                                "MONOCODE_EVAL_ORIGINAL_SOURCE": "",
                                                "XDG_DATA_HOME": str(self.directory / "user-data")})):
            context.start()
            self.addCleanup(context.stop)

    def build(self, command, **kwargs):
        stage = Path(command[command.index("--_stage") + 1])
        destination = stage / self.relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(self.content)
        # Extra build artifacts/code must not leak into the published dataset.
        (stage / "unlocked.json").write_text("not part of the dataset")
        self.assertFalse((self.root / "bfcl" / self.relative).exists())

    def test_prepares_only_selected_source_and_reuses_verified_cache(self):
        with patch.object(prepare.subprocess, "run", side_effect=self.build) as build:
            self.assertEqual(prepare.ensure_data(["bfcl"]), self.root)
            self.assertEqual(prepare.ensure_data("bfcl"), self.root)
        self.assertEqual(build.call_count, 1)
        self.assertFalse((self.root / "original").exists())
        self.assertEqual(list((self.root / "bfcl").rglob("*.jsonl")), [self.root / "bfcl" / self.relative])
        self.assertFalse((self.root / "bfcl/unlocked.json").exists())

    def test_rejects_changed_build_without_publishing_partial_files(self):
        def changed(command, **kwargs):
            stage = Path(command[command.index("--_stage") + 1])
            destination = stage / self.relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b"changed upstream data")
        with patch.object(prepare.subprocess, "run", side_effect=changed):
            with self.assertRaisesRegex(ValueError, "locked SHA256"):
                prepare.ensure_data("bfcl")
        self.assertFalse((self.root / "bfcl").exists())
        self.assertEqual(list(self.root.parent.glob(".prepare-*")), [])

    def test_rebuilds_corrupt_or_extra_cache_files(self):
        with patch.object(prepare.subprocess, "run", side_effect=self.build):
            prepare.ensure_data("bfcl")
        target = self.root / "bfcl" / self.relative
        target.write_bytes(b"corrupt")
        (self.root / "bfcl/extra.json").write_text("extra")
        def repaired(command, **kwargs):
            stage = Path(command[command.index("--_stage") + 1])
            output = stage / self.relative
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(self.content)
            self.assertEqual(target.read_bytes(), b"corrupt")
        with patch.object(prepare.subprocess, "run", side_effect=repaired) as build:
            prepare.ensure_data("bfcl")
        self.assertEqual(build.call_count, 1)
        self.assertTrue(prepare.valid_dataset(self.root / "bfcl", self.lock["sources"]["bfcl"]["files"]))

    def test_source_selection_validation_precedes_io(self):
        with patch.object(prepare.subprocess, "run") as build:
            with self.assertRaisesRegex(ValueError, "Unknown"):
                prepare.ensure_data("nonexistent")
        build.assert_not_called()
        self.assertFalse(self.root.exists())

    def test_download_checks_hash_and_does_not_reuse_corrupt_object(self):
        downloads = self.directory / "downloads"
        url = "https://example.invalid/pinned/data.json"
        with patch.object(prepare.urllib.request, "urlopen", return_value=io.BytesIO(self.content)) as request:
            downloaded = prepare.download(url, self.digest, downloads)
            self.assertEqual(prepare.download(url, self.digest, downloads), downloaded)
        self.assertEqual(request.call_count, 1)
        downloaded.write_bytes(b"corrupt")
        with patch.object(prepare.urllib.request, "urlopen", return_value=io.BytesIO(b"wrong download")):
            with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
                prepare.download(url, self.digest, downloads)
        self.assertEqual(downloaded.read_bytes(), b"corrupt")
        self.assertEqual(list(downloads.glob(".download-*")), [])

    def write_original_inputs(self, directory):
        for name, raw in self.original_contents.items():
            target = directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)

    def test_original_cold_cache_reads_default_external_inputs_without_generating(self):
        source = self.directory / "user-data/monocode/eval-inputs/original"
        self.write_original_inputs(source)
        with patch.object(prepare.subprocess, "run") as generator, patch.object(prepare.urllib.request, "urlopen") as network:
            prepare.ensure_data("original")
        generator.assert_not_called()
        network.assert_not_called()
        self.assertTrue(prepare.valid_dataset(self.root / "original", self.lock["sources"]["original"]["files"]))
        for name, raw in self.original_contents.items():
            self.assertEqual((source / name).read_bytes(), raw)

    def test_original_override_checks_each_file_before_publication(self):
        source = self.directory / "custom-inputs"
        self.write_original_inputs(source)
        (source / "data/references.jsonl").write_bytes(b"changed original input")
        with patch.dict(os.environ, {"MONOCODE_EVAL_ORIGINAL_SOURCE": str(source)}):
            with self.assertRaisesRegex(ValueError, "locked SHA256: data/references.jsonl"):
                prepare.ensure_data("original")
        self.assertFalse((self.root / "original").exists())
        self.assertEqual(list(self.root.parent.glob(".prepare-*")), [])

    def test_missing_original_source_reports_configuration_without_project_fallback(self):
        self.write_original_inputs(self.project)
        with self.assertRaisesRegex(FileNotFoundError, "MONOCODE_EVAL_ORIGINAL_SOURCE"):
            prepare.ensure_data("original")
        self.assertFalse((self.root / "original").exists())

    def test_original_https_source_uses_logical_paths_and_verified_downloads(self):
        base = "https://example.invalid/my-originals"
        seen = []
        def response(request, **kwargs):
            seen.append(request.full_url)
            self.assertTrue(request.full_url.startswith(base + "/"))
            relative = request.full_url.removeprefix(base + "/")
            return io.BytesIO(self.original_contents[relative])
        with patch.dict(os.environ, {"MONOCODE_EVAL_ORIGINAL_SOURCE": base + "/"}), \
                patch.object(prepare.urllib.request, "urlopen", side_effect=response):
            prepare.ensure_data("original")
        self.assertEqual(seen, [base + "/" + name for name in self.original_contents])
        self.assertTrue(prepare.valid_dataset(self.root / "original", self.lock["sources"]["original"]["files"]))

    def test_original_source_rejects_project_directory_and_non_https_url(self):
        with patch.object(prepare, "PROJECT_ROOT", self.project):
            with patch.dict(os.environ, {"MONOCODE_EVAL_ORIGINAL_SOURCE": str(self.project)}):
                with self.assertRaisesRegex(ValueError, "outside the project"):
                    prepare.ensure_data("original")
        with patch.dict(os.environ, {"MONOCODE_EVAL_ORIGINAL_SOURCE": "http://example.invalid/original"}):
            with self.assertRaisesRegex(ValueError, "HTTPS base URL"):
                prepare.ensure_data("original")


if __name__ == "__main__":
    unittest.main()
