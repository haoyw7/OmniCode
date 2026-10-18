import importlib.util,json,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('importer',ROOT/'bin/import_benchmark.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ImportTests(unittest.TestCase):
 def setUp(self):self.sources=json.loads((ROOT/'data/sources.json').read_text())['sources']
 def test_pinned_plan(self):
  source=next(s for s in self.sources if s['id']=='bfcl');plan=module.make_plan(source)
  self.assertEqual(plan['revision'],source['revision']);self.assertEqual(plan['status'],'plan-only-not-integrated')
 def test_unpinned_or_non_https_source_refused(self):
  for source in [{'revision':'main','url':'https://github.com/a/b'},{'revision':'a'*40,'url':'file:///tmp/repo'}]:
   with self.assertRaises(ValueError):module.make_plan(source)
 def test_gated_not_automatically_fetched(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'data';p=subprocess.run(['python3',str(ROOT/'bin/import_benchmark.py'),'--source','gaia','--fetch','--out',str(out)],capture_output=True,text=True)
   self.assertNotEqual(p.returncode,0);self.assertFalse(out.exists())
 def test_manual_license_blocks_fetch(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'data';p=subprocess.run(['python3',str(ROOT/'bin/import_benchmark.py'),'--source','toolsandbox','--fetch','--out',str(out)],capture_output=True,text=True)
   self.assertNotEqual(p.returncode,0);self.assertFalse(out.exists())
if __name__=='__main__':unittest.main()
