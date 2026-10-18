import subprocess,unittest,json,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class JudgeLauncherTests(unittest.TestCase):
 def test_bundle_compiles_before_usage_validation_without_inference(self):
  p=subprocess.run(['node',str(ROOT/'bin/judge_existing.mjs')],capture_output=True,text=True,timeout=20)
  self.assertNotEqual(p.returncode,0);self.assertIn('Usage: judge_existing.mjs',p.stderr);self.assertNotIn('Build failed',p.stderr)
 def test_incomplete_extension_blocks_further_budget_use(self):
  with tempfile.TemporaryDirectory() as directory:
   campaign=Path(directory);(campaign/'campaign.json').write_text(json.dumps({'finishedAt':'done','budget':{'requests':82,'reportedUsd':0.08}}))
   stale=campaign/'incomplete';stale.mkdir();(stale/'extension-intent.json').write_text('{}')
   p=subprocess.run(['node',str(ROOT/'bin/judge_existing.mjs'),str(campaign),str(campaign/'next'),'unused'],capture_output=True,text=True,timeout=20)
   self.assertNotEqual(p.returncode,0);self.assertIn('Unfinished prior judge extension',p.stderr);self.assertFalse((campaign/'next').exists())
if __name__=='__main__':unittest.main()
