#!/usr/bin/env python3
"""Fetch a pinned MIT LongMemEval oracle JSON and import a type-stratified sample; no model grading."""
import argparse, collections, hashlib, json, re, sys, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'bin'))
from eval_data import ensure_data, resolve_data_file
REPO='xiaowu0162/longmemeval-cleaned'
BASE='https://huggingface.co/datasets/'+REPO
PIN='98d7416c24c778c2fee6e6f3006e7a073259d48f'
ORACLE_SHA='821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def validate_row(row):
    for field in ('question_id','question_type','question','question_date'):
        if not isinstance(row.get(field),str):raise ValueError('Invalid '+field)
    if type(row.get('answer')) not in (str,int):raise ValueError('Answer must preserve original string/integer type')
    for field in ('haystack_session_ids','haystack_dates','haystack_sessions','answer_session_ids'):
        if not isinstance(row.get(field),list):raise ValueError('Invalid '+field)
    if not len(row['haystack_session_ids'])==len(row['haystack_dates'])==len(row['haystack_sessions']):raise ValueError('Evidence alignment mismatch')
    if not set(row['answer_session_ids']).issubset(row['haystack_session_ids']):raise ValueError('Missing answer evidence')
    for session in row['haystack_sessions']:
        if not isinstance(session,list):raise ValueError('Invalid evidence session')
        for message in session:
            if not isinstance(message,dict) or not isinstance(message.get('role'),str) or not isinstance(message.get('content'),str):raise ValueError('Invalid evidence message')
    return row['question_id']
def validate_sample(path):
    manifest=json.loads((path/'manifest.json').read_text())
    raw=resolve_data_file(path/'records.json').read_bytes()
    if sha(raw)!=manifest['subsetSha256']:raise ValueError('Subset hash mismatch')
    rows=json.loads(raw);ids=[validate_row(r) for r in rows]
    if len(set(ids))!=18 or ids!=manifest['upstreamIds']:raise ValueError('ID mismatch')
    counts=dict(collections.Counter(r['question_type'] for r in rows))
    if len(counts)!=6 or any(n!=3 for n in counts.values()):raise ValueError('Strata mismatch')
    return {'valid':True,'taskCount':len(rows),'questionTypes':counts,'abstentionCount':sum(r['question_id'].endswith('_abs') for r in rows),'answerTypes':dict(collections.Counter(type(r['answer']).__name__ for r in rows)),'status':'original-oracle-subset-format-validated-NOT-model-scored','revision':manifest['revision']}
def fetch(directory):
    if directory.exists():raise ValueError('Download directory must be new')
    directory.mkdir(parents=True)
    for name in ('README.md','longmemeval_oracle.json'):
        with urllib.request.urlopen(f'{BASE}/resolve/{PIN}/{name}',timeout=90) as response:raw=response.read(64*1024*1024+1)
        if len(raw)>64*1024*1024:raise ValueError('Oversized download')
        (directory/name).write_bytes(raw)
    if sha((directory/'longmemeval_oracle.json').read_bytes())!=ORACLE_SHA:raise ValueError('Pinned oracle checksum mismatch')
def import_sample(snapshot,out):
    raw=(snapshot/'longmemeval_oracle.json').read_bytes()
    if sha(raw)!=ORACLE_SHA:raise ValueError('Pinned oracle checksum mismatch')
    card=(snapshot/'README.md').read_text()
    if not re.search(r'^license:\s*mit\s*$',card,re.M):raise ValueError('Expected MIT data card')
    all_rows=json.loads(raw)
    for row in all_rows:validate_row(row)
    selected=[]
    for category in sorted({r['question_type'] for r in all_rows}):
        group=sorted((r for r in all_rows if r['question_type']==category),key=lambda r:sha(('17:'+r['question_id']).encode()))
        chosen=[]
        for predicate in (lambda r:r['question_id'].endswith('_abs'),lambda r:type(r['answer']) is int):
            found=next((r for r in group if predicate(r) and r not in chosen),None)
            if found:chosen.append(found)
        chosen += [r for r in group if r not in chosen][:3-len(chosen)]
        selected+=chosen
    if out.exists():raise ValueError('Output directory must be new')
    out.mkdir(parents=True);target=out/'records.json';target.write_text(json.dumps(selected,ensure_ascii=False,indent=2)+'\n')
    (out/'DATASET_CARD.md').write_text(card)
    audit=next(r for r in json.loads((ROOT/'data/license-audit.json').read_text()) if r.get('repo')=='xiaowu0162/LongMemEval' and r.get('path')=='LICENSE')
    license_text=audit.get('text',audit.get('content',audit.get('body')))
    if not isinstance(license_text,str):raise ValueError('Missing audited MIT license text')
    (out/'UPSTREAM_CODE_LICENSE').write_text(license_text)
    manifest={'official_url':BASE,'license_url':BASE+'/blob/'+PIN+'/README.md','data_license':'MIT (dataset card, separate from code license)','revision':PIN,'sourceFile':'longmemeval_oracle.json','sha256':ORACLE_SHA,'subsetSha256':sha(target.read_bytes()),'upstreamIds':[r['question_id'] for r in selected],'split':'oracle','variant':'longmemeval-cleaned; 18 original oracle records','transformation':'selection and JSON serialization only; full evidence and original answer types preserved','seed':17,'sampling':'three per six question types; include abstention where available and integer answers where available; fill by SHA256(seed:question_id) order','env_requirement':'raw JSON parser supports str/int answers; official long-memory ingestion/evaluator not run; oracle evidence is not S/M long-context memory','sourceRows':len(all_rows)}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    provenance=[{**{k:manifest[k] for k in ('official_url','license_url','revision','split','variant','transformation','seed','env_requirement')},'upstream_id':r['question_id'],'sha256':sha(json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()),'question_type':r['question_type'],'abstention':r['question_id'].endswith('_abs'),'answer_type':type(r['answer']).__name__} for r in selected]
    (out/'provenance.jsonl').write_text('\n'.join(json.dumps(p,ensure_ascii=False) for p in provenance)+'\n')
    result=validate_sample(out);(out/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
    (out/'README.md').write_text('# LongMemEval oracle sample\n\n18 original records, three per six question types; includes four abstention cases and integer/string answers. Full oracle evidence is retained. MIT dataset card is included; UPSTREAM_CODE_LICENSE preserves the separate audited repository notice. See manifest.json and provenance.jsonl for immutable source, hashes and selection.\n\nImported and format-validated only. No model score, original S/M long-context score or official leaderboard reproduction is claimed. The Hugging Face viewer ArrowTypeError does not affect raw JSON parsing.\n')
    return result
def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
    f=s.add_parser('fetch');f.add_argument('--out',type=Path,required=True)
    i=s.add_parser('import');i.add_argument('--snapshot',type=Path,required=True);i.add_argument('--out',type=Path,required=True)
    v=s.add_parser('validate');v.add_argument('--path',type=Path,required=True)
    a=p.parse_args()
    if a.command=='validate' and a.path.resolve()==ROOT/'data/upstream/longmemeval-oracle-sample':ensure_data(['longmemeval'])
    if a.command=='fetch':fetch(a.out);print('Pinned oracle downloaded and checksum verified; not evaluated.')
    else:print(json.dumps(import_sample(a.snapshot,a.out) if a.command=='import' else validate_sample(a.path),indent=2))
if __name__=='__main__':main()
