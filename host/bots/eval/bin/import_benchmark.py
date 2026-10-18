#!/usr/bin/env python3
"""Reproducible optional upstream snapshot acquisition. Never executes upstream code.
Default prints a pinned plan only. --fetch requires an explicit new output directory.
Restricted/gated sources remain manual and are not downloaded by this script.
"""
import argparse, hashlib, json, re, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def make_plan(source):
    if not re.fullmatch(r'[a-f0-9]{40}',source.get('revision') or ''):raise ValueError('No acquired immutable revision; follow the manual source instructions.')
    url=source['url']
    if not re.fullmatch(r'https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',url):raise ValueError('Only official allowlisted HTTPS GitHub sources are supported.')
    return {'source':source['id'],'url':url,'revision':source['revision'],'mode':source['import_mode'],'status':'plan-only-not-integrated','license':source['code_license'],'data_license':source['data_license'],'official_run':source['official_run']}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',required=True);p.add_argument('--fetch',action='store_true');p.add_argument('--out',type=Path);a=p.parse_args()
    sources=json.loads((ROOT/'data/sources.json').read_text())['sources'];source=next((s for s in sources if s['id']==a.source),None)
    if source is None:raise SystemExit('Unknown source')
    try:plan=make_plan(source)
    except ValueError as e:raise SystemExit(str(e))
    print(json.dumps(plan,ensure_ascii=False,indent=2))
    if not a.fetch:return
    if source['import_mode']!='optional-pinned-checkout':raise SystemExit('This source requires manual license/access/environment review; automatic fetch is disabled.')
    if not a.out or a.out.exists():raise SystemExit('--out must name a new directory; existing paths are never overwritten.')
    a.out.parent.mkdir(parents=True,exist_ok=True)
    flags=['git','-c','core.hooksPath=/dev/null','-c','protocol.file.allow=never']
    subprocess.run(flags+['clone','--no-checkout','--filter=blob:none',source['url'],str(a.out)],check=True,timeout=180)
    subprocess.run(flags+['-C',str(a.out),'fetch','--depth=1','origin',source['revision']],check=True,timeout=180)
    subprocess.run(flags+['-C',str(a.out),'checkout','--detach',source['revision']],check=True,timeout=180)
    actual=subprocess.check_output(['git','-C',str(a.out),'rev-parse','HEAD'],text=True).strip()
    if actual!=source['revision']:raise SystemExit('Revision mismatch; snapshot is invalid.')
    plan.update(status='upstream-snapshot-only-not-evaluated',license_sha256=hashlib.sha256((a.out/'LICENSE').read_bytes()).hexdigest())
    (a.out/'monocode-import-lock.json').write_text(json.dumps(plan,indent=2)+'\n')
    print('Fetched immutable upstream snapshot. No tasks have been converted, evaluated, or counted in the local suite.')
if __name__=='__main__':main()
