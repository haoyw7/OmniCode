#!/usr/bin/env python3
"""Import and validate an unmodified BFCL v4 sample. Never execute functions or score models."""
import argparse, hashlib, json, shutil, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'bin'))
from eval_data import ensure_data, resolve_data_file
CATEGORIES = ('simple_python','multiple','parallel','parallel_multiple','irrelevance')
DATA = Path('berkeley-function-call-leaderboard/bfcl_eval/data')
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def validate_row(row):
    if not isinstance(row,dict) or not isinstance(row.get('id'),str) or not row['id']: raise ValueError('Invalid task ID')
    question=row.get('question')
    if not isinstance(question,list) or not question:raise ValueError('Missing question turns')
    for turn in question:
        if not isinstance(turn,list) or not turn:raise ValueError('Invalid question turn')
        for message in turn:
            if not isinstance(message,dict) or not isinstance(message.get('role'),str) or not isinstance(message.get('content'),str):raise ValueError('Invalid message')
    functions=row.get('function')
    if not isinstance(functions,list) or not functions:raise ValueError('Missing functions')
    names=set()
    for f in functions:
        name=f.get('name')
        if not isinstance(name,str) or not name or name in names:raise ValueError('Invalid or duplicate function name')
        names.add(name);p=f.get('parameters')
        if not isinstance(f.get('description'),str) or not isinstance(p,dict) or not isinstance(p.get('properties'),dict) or not isinstance(p.get('required'),list):raise ValueError('Invalid function schema')
        if not all(isinstance(k,str) and k in p['properties'] for k in p['required']):raise ValueError('Required property missing')
    return row['id']
def validate_sample(path):
    manifest=json.loads((path/'manifest.json').read_text());seen=set();counts={}
    if sha(path/'LICENSE') != manifest['licenseSha256']:raise ValueError('License hash mismatch')
    for category in CATEGORIES:
        file=resolve_data_file(path/f'BFCL_v4_{category}.jsonl');entry=manifest['categories'][category]
        if sha(file)!=entry['subsetSha256']:raise ValueError('Subset hash mismatch')
        rows=[json.loads(line) for line in file.read_text().splitlines() if line.strip()]
        ids=[validate_row(row) for row in rows]
        if ids!=entry['ids'] or len(ids)!=6 or any(i in seen for i in ids):raise ValueError('Selection mismatch')
        seen.update(ids);counts[category]=len(ids)
        if category!='irrelevance':
            answer=resolve_data_file(path/'possible_answer'/file.name)
            if sha(answer)!=entry['answersSubsetSha256']:raise ValueError('Answer hash mismatch')
            answers=[json.loads(line) for line in answer.read_text().splitlines() if line.strip()]
            if [a.get('id') for a in answers]!=ids or not all(isinstance(a.get('ground_truth'),list) for a in answers):raise ValueError('Answer alignment mismatch')
    return {'valid':True,'taskCount':len(seen),'categories':counts,'groundTruthRecords':24,'status':'imported-format-validated-NOT-model-scored','upstreamRevision':manifest['revision']}
def import_sample(snapshot,out):
    source=next(s for s in json.loads((ROOT/'data/sources.json').read_text())['sources'] if s['id']=='bfcl')
    actual=subprocess.check_output(['git','-C',str(snapshot),'rev-parse','HEAD'],text=True).strip()
    if actual!=source['revision']:raise ValueError('Snapshot revision mismatch')
    if out.exists():raise ValueError('Output must not exist')
    out.mkdir(parents=True);(out/'possible_answer').mkdir()
    shutil.copy2(snapshot/'LICENSE',out/'LICENSE')
    manifest={'source':'bfcl','revision':actual,'provenance':'unmodified-original-upstream-lines; deterministically sampled, not adapted','codeLicense':source['code_license'],'dataLicense':source['data_license'],'licenseUrl':source['code_license_url'],'dataLicenseUrl':source['data_license_url'],'licenseSha256':sha(out/'LICENSE'),'sampling':'Six evenly spaced line indexes per category, including first and last; fixed-order representative sample, not random or a leaderboard split.','categories':{}}
    provenance=[]
    for category in CATEGORIES:
        name=f'BFCL_v4_{category}.json';original=snapshot/DATA/name
        lines=[line for line in original.read_text().splitlines() if line.strip()]
        indices=[round(i*(len(lines)-1)/5) for i in range(6)]
        selected=[lines[i] for i in indices];rows=[json.loads(line) for line in selected]
        ids=[validate_row(row) for row in rows]
        target=out/f'BFCL_v4_{category}.jsonl';target.write_text('\n'.join(selected)+'\n')
        entry={'sourceUrl':source['url']+'/blob/'+actual+'/'+str(DATA/name),'sourceSha256':sha(original),'sourceRows':len(lines),'sourceLineNumbers':[i+1 for i in indices],'ids':ids,'subsetSha256':sha(target)}
        if category!='irrelevance':
            original_answers=snapshot/DATA/'possible_answer'/name
            answers={json.loads(line)['id']:line for line in original_answers.read_text().splitlines() if line.strip()}
            target_answers=out/'possible_answer'/target.name;target_answers.write_text('\n'.join(answers[i] for i in ids)+'\n')
            entry.update(answersSourceSha256=sha(original_answers),answersSubsetSha256=sha(target_answers))
        provenance += [{'official_url':entry['sourceUrl'],'license_url':source['data_license_url'],'revision':actual,'sha256':hashlib.sha256(line.encode()).hexdigest(),'upstream_id':row['id'],'split':'v4 non-live categories','variant':category,'transformation':'Original JSONL line selected without adaptation','seed':None,'env_requirement':'Official upstream AST/execution evaluator required for model scoring; not converted to MonoCode fixtures'} for row,line in zip(rows,selected)]
        manifest['categories'][category]=entry
    (out/'provenance.jsonl').write_text('\n'.join(json.dumps(p) for p in provenance)+'\n')
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    result=validate_sample(out);(out/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
    (out/'README.md').write_text('# BFCL v4 representative sample\n\n30 original upstream question records and 24 original ground-truth records, six per category. Source: ShishirPatil/gorilla at '+actual+'. Apache-2.0; original license is included. Selection and hashes are recorded in manifest.json. No function descriptions or questions were adapted.\n\nThis sample has been downloaded, imported and structurally validated only. It is separate from MonoCode\'s 176 original fixtures; no model performance or official BFCL leaderboard score is claimed. The irrelevance category has no copied answer file. Official AST/execution grading remains upstream and was not run.\n')
    return result
def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    imp=sub.add_parser('import');imp.add_argument('--snapshot',type=Path,required=True);imp.add_argument('--out',type=Path,required=True)
    val=sub.add_parser('validate');val.add_argument('--path',type=Path,required=True)
    a=p.parse_args()
    if a.command=='validate' and a.path.resolve()==ROOT/'data/upstream/bfcl-v4-sample':ensure_data(['bfcl'])
    result=import_sample(a.snapshot.resolve(),a.out.resolve()) if a.command=='import' else validate_sample(a.path.resolve())
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
