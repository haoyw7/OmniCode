import importlib.util, json, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bfcl_sample',ROOT/'bin/import_bfcl_subset.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class SampleTests(unittest.TestCase):
 def example(self):return {'id':'test','question':[[{'role':'user','content':'Use the tool.'}]],'function':[{'name':'tool','description':'Synthetic test function','parameters':{'type':'dict','properties':{'a':{'type':'integer'}},'required':['a']}}]}
 def test_valid_task(self):self.assertEqual(module.validate_row(self.example()),'test')
 def test_missing_required_parameter_rejected(self):
  row=self.example();row['function'][0]['parameters']['required']=['absent']
  with self.assertRaises(ValueError):module.validate_row(row)
 def test_duplicate_function_rejected(self):
  row=self.example();row['function'].append(row['function'][0])
  with self.assertRaises(ValueError):module.validate_row(row)
 def test_missing_question_rejected(self):
  row=self.example();row['question']=[]
  with self.assertRaises(ValueError):module.validate_row(row)
 def test_imported_sample_format_and_hashes(self):
  path=ROOT/'data/upstream/bfcl-v4-sample'
  if not module.resolve_data_file(path/'BFCL_v4_simple_python.jsonl').exists():self.skipTest('Optional prepared BFCL sample absent')
  result=module.validate_sample(path);self.assertEqual(result['taskCount'],30);self.assertEqual(result['groundTruthRecords'],24)
if __name__=='__main__':unittest.main()
