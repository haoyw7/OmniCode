#!/usr/bin/env python3
"""Reproduce the bounded breadth campaign. Defaults to a dry plan; --execute spends existing provider quota."""
import argparse, datetime, json, subprocess, sys
from pathlib import Path
from eval_data import data_path, ensure_data, require_external_output
ROOT = Path(__file__).resolve().parents[1]
FIRST = ['intent-clarify-resolve','planning-read-before-write','retrieval-two-source','files-target-only','documents-preserve-id','spreadsheets-weighted','scheduling-cancel','email-resolve-address','memory-recall-before-answer','recovery-changing-language','delegation-two-independent','reliability-read-retry','permissions-scope-denied','security-private-token','structured-nested','degradation-partial-capability']
SECOND = ['planning-model-discovery','retrieval-injection-contradiction','files-source-unchanged','documents-heading-edit','spreadsheets-formula-injection','email-recipient-steering','recovery-permission-revoked','delegation-no-false-completion','reliability-reminder-timeout','permissions-deletion-explicit']
MODEL = 'openai-codex/gpt-5.6-luna'
JUDGE = 'openai-codex/gpt-6.1-sol'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',action='store_true');parser.add_argument('--out',type=Path)
    args=parser.parse_args()
    ensure_data(['original'])
    cases={c['id']:c for c in map(json.loads,data_path('data/cases.jsonl').read_text().splitlines())}
    smoke=[c['id'] for c in cases.values() if c['tier']=='smoke']
    plans=[{'ids':[case_id],'judge':i<10,'phase':'breadth'} for i,case_id in enumerate(FIRST)]
    plans += [{'ids':[case_id],'judge':False,'phase':'second-representative'} for case_id in SECOND]
    plans += [{'ids':smoke,'judge':False,'phase':'full-smoke'}]
    budget={'maxRequests':100,'maxUsd':1.0,'requestReserveUsd':0.01,'requests':0,'reportedUsd':0.0}
    if not args.execute:
        print(json.dumps({'plans':plans,'budget':budget,'agent':MODEL,'judge':JUDGE,'note':'Pi has no provider-side dollar cap. Stop before new requests when recorded costs reach the cap; one in-flight request can exceed its estimate.'},indent=2));return
    if args.out is None or args.out.exists():raise SystemExit('--out must be a new directory')
    require_external_output(args.out)
    out=args.out.resolve();out.mkdir(parents=True)
    ledger={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'budget':budget,'agent':MODEL,'judge':JUDGE,'planned':plans,'runs':[],'stoppedReason':None}
    def save(): (out/'campaign.json').write_text(json.dumps(ledger,indent=2)+'\n')
    save()
    for index,plan in enumerate(plans):
        remaining=100-budget['requests']; dollars=1.0-budget['reportedUsd']
        # Reserve a separate complete smoke run. Missing earlier cases remain visibly unrun.
        ceiling=remaining if plan['phase']=='full-smoke' else min(9,max(0,remaining-16))
        if ceiling<1 or dollars<0.01:
            if plan['phase']!='full-smoke' and remaining>=1 and dollars>=0.01:
                ledger['runs'].append({'planIndex':index,'ids':plan['ids'],'status':'skipped','reason':'reserve-full-smoke'});save();continue
            ledger['stoppedReason']='budget-exhausted';save();break
        run=out/f'{index+1:02d}-{plan["phase"]}'
        command=['node',str(ROOT/'bin/eval.mjs'),'run','--mode','pi','--ids',','.join(plan['ids']),'--model',MODEL,'--max-requests',str(ceiling),'--max-usd',str(dollars),'--request-usd','0.01','--timeout-ms','60000','--out',str(run)]
        if plan['judge']:command+=['--judge-model',JUDGE]
        print('RUN',index+1,','.join(plan['ids']),'judge='+str(plan['judge']),flush=True)
        proc=subprocess.run(command,cwd=ROOT.parents[2],timeout=600)
        if not (run/'summary.json').exists():
            ledger['stoppedReason']='runner-did-not-produce-summary';save();raise SystemExit(2)
        summary=json.loads((run/'summary.json').read_text())
        budget['requests']+=summary['budget']['requestsAttempted']
        cost=summary['usage']['costUsd']
        entry={'planIndex':index,'ids':plan['ids'],'phase':plan['phase'],'directory':str(run.relative_to(out)),'exitCode':proc.returncode,'statuses':summary['statuses'],'requests':summary['budget']['requestsAttempted'],'costUsd':cost,'command':command}
        ledger['runs'].append(entry)
        if cost is None:
            ledger['stoppedReason']='unknown-cost-or-infrastructure-error';save();break
        budget['reportedUsd']+=cost
        save()
        if summary['statuses'].get('environment_error') or summary['statuses'].get('skipped'):
            ledger['stoppedReason']='infrastructure-error';save();break
    ledger['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
    print(json.dumps({'budget':budget,'stoppedReason':ledger['stoppedReason']}),flush=True)
if __name__=='__main__':main()
