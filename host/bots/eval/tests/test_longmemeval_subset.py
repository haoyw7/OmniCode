import importlib.util,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('longmem_sample',ROOT/'bin/import_longmemeval_subset.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class LongMemTests(unittest.TestCase):
 def example(self):return {'question_id':'test','question_type':'multi-session','question':'How many?','question_date':'2026-10-09','answer':2,'haystack_session_ids':['s1'],'haystack_dates':['2026-10-08'],'haystack_sessions':[[{'role':'user','content':'Two.'}]],'answer_session_ids':['s1']}
 def test_preserves_string_and_integer_answer_types(self):
  for answer in ('2',2):
   row=self.example();row['answer']=answer;module.validate_row(row);self.assertIs(type(row['answer']),type(answer))
 def test_rejects_misaligned_or_missing_evidence(self):
  row=self.example();row['haystack_dates']=[]
  with self.assertRaises(ValueError):module.validate_row(row)
  row=self.example();row['answer_session_ids']=['missing']
  with self.assertRaises(ValueError):module.validate_row(row)
 def test_rejects_boolean_coercion(self):
  row=self.example();row['answer']=True
  with self.assertRaises(ValueError):module.validate_row(row)
 def test_imported_sample(self):
  path=ROOT/'data/upstream/longmemeval-oracle-sample'
  if not module.resolve_data_file(path/'records.json').exists():self.skipTest('Optional prepared sample absent')
  result=module.validate_sample(path);self.assertEqual(result['taskCount'],18);self.assertEqual(result['abstentionCount'],4);self.assertEqual(result['answerTypes']['int'],3)
if __name__=='__main__':unittest.main()
