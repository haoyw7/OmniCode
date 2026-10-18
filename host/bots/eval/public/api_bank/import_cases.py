"""Rebuild frozen, seed-17 cases from bundled public raw JSON and transcripts.

No model calls or network. Run vendor_sources.py once when updating upstream code.
"""
from __future__ import annotations
import argparse
import collections
import copy
import hashlib
import json
from pathlib import Path
import random
import shutil
from adapter import ToolManager, canonical_arguments, dispatch, native_check, validate_arguments

ROOT=Path(__file__).resolve().parent
HF_REV='12e8158b7628c168f07e8f31fbbe3445e99f44cf'
CODE_REV='f30ccf22b4e2617fab32958d4c03f5c1f2e7dfcf'
HF_URL='https://huggingface.co/datasets/liminghao1630/API-Bank'
REPO_URL='https://github.com/AlibabaResearch/DAMO-ConvAI'
SEED=17

def sha(data): return hashlib.sha256(data).hexdigest()
def stable(value): return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def category(api):
    if any(s in api for s in ('Agenda','Alarm','Meeting','Reminder')): return 'calendar_and_reminders'
    if any(s in api for s in ('Scene','Switch')): return 'smart_home'
    if any(s in api for s in ('HealthData','Registration')): return 'health_records_and_appointments'
    if api in ('QueryStock','QueryBalance','BookHotel'): return 'travel_and_finance_fixtures'
    if api in ('EmergencyKnowledge','SymptomSearch'): return 'medical_knowledge_fixture_lookup'
    if api in ('ImageCaption','SpeechRecognition','PlayMusic'): return 'media_fixture_tools'
    if api=='Calculator': return 'arithmetic'
    if api=='GetUserToken': return 'mock_authentication'
    return 'document_and_knowledge_lookup'

def main(source=None):
    dialog_dir=ROOT/'raw'/'dialogues'
    if source:
        dialog_dir.mkdir(exist_ok=True)
        for p in sorted((source/'lv1-lv2-samples'/'level-1-given-desc').glob('*.jsonl')):
            shutil.copyfile(p,dialog_dir/p.name)
    candidates=[]; exclusions=[]; seen_ids=set(); seen_content=set(); mapping=[]
    raw_paths=[ROOT/'raw'/f'level-{i}-api.json' for i in (1,2)]
    loaded=[]
    for path in raw_paths:
        split=path.stem
        rows=json.loads(path.read_text())
        for row_number,r in enumerate(rows):
            upstream_id=f"{r['file']}#{r['id']}"
            identity=(split,upstream_id); row_sha=sha(stable(r))
            entry={'split':split,'upstream_id':upstream_id,'raw_row':row_number,'row_sha256':row_sha}
            loaded.append(entry)
            def exclude(reason,details=None):
                exclusions.append({**entry,'reason':reason,**({'details':details} if details else {})})
            if identity in seen_ids or row_sha in seen_content:
                exclude('duplicate_id_or_sha256'); continue
            seen_ids.add(identity);seen_content.add(row_sha)
            if split=='level-2-api':
                exclude('ToolSearcher_requires_embedding_model_excluded_no_replacement_metric'); continue
            h=[json.loads(line) for line in (dialog_dir/r['file']).read_text().splitlines()]
            positions=[i for i,x in enumerate(h) if x['role']=='API']
            ordinal=r['input'].count('API-Request:')
            if ordinal>=len(positions): exclude('unmapped_context_ordinal');continue
            position=positions[ordinal]; target=h[position]
            serialized='API-Request: ['+target['api_name']+'('+', '.join(f"{k}='{v}'" for k,v in target['param_dict'].items())+')]'
            if serialized!=r['expected_output']:
                exclude('unmapped_expected_call');continue
            mapping.append({**entry,'dialogue_file':r['file'],'dialogue_sha256':sha((dialog_dir/r['file']).read_bytes()),'target_message_index':position,'api_ordinal':ordinal,'expected_call_exact_match':True})
            manager=ToolManager(); replay=[x for x in h[:position] if x['role']=='API']
            unavailable=sorted({x['api_name'] for x in replay+[target]}-set(manager.list_all_apis()))
            if unavailable:
                exclude('non_whitelisted_target_or_history',unavailable);continue
            if target['api_name']=='GetUserToken':
                exclude('mock_authentication_support_only_not_target');continue
            if sum(x['role']=='User' for x in h[:position])<2:
                # Keep short tool-usage contexts as an explicit stratum, not label all as long dialogues.
                context_kind='short_context'
            else: context_kind='multi_turn_context'
            try:
                for x in replay+[target]:
                    args=canonical_arguments(manager,x)
                    validate_arguments(manager,x['api_name'],args)
                    result=dispatch(manager,x['api_name'],args)
                    if not native_check(manager,x,result) or result['output']!=x['result']['output'] or result['exception']!=x['result']['exception']:
                        raise ValueError(f"native result or upstream checker mismatch at {x['api_name']}")
            except Exception as exc:
                exclude('native_replay_or_schema_mismatch',str(exc));continue
            descriptions=[json.loads(line) for line in r['instruction'].split('\n') if line.startswith('{"name":')]
            allowed=sorted({d['name'] for d in descriptions if d['name'] in manager.list_all_apis()})
            if target['api_name'] not in allowed:
                exclude('target_missing_from_original_schema');continue
            case_id='api_bank/'+r['file'].removesuffix('.jsonl')+'/'+str(r['id'])+'/stateful-continuation'
            case={
                'id':case_id,'source':'api_bank','upstream_id':upstream_id,'category':category(target['api_name']),'variant':'stateful-continuation',
                'provenance':{'official_url':HF_URL,'license_url':HF_URL+'/blob/'+HF_REV+'/README.md','revision':HF_REV,'sha256':sha(path.read_bytes()),'upstream_id':upstream_id,'split':split,'variant':'stateful-continuation','transformation':'native ToolManager execution; replay only prior recorded APIs; JSON schema/list/bool transport bridge; programmatic result and full-state grading; local structured final','seed':SEED,'env_requirement':'Python >=3.10 stdlib; isolated in-memory upstream fixture databases; no network/models/accounts','row_sha256':row_sha,'dialogue_revision':CODE_REV,'dialogue_sha256':sha((dialog_dir/r['file']).read_bytes()),'target_message_index':position},
                'data':{'raw_record':r,'input':r['input'],'history':h[:position],'target':target,'allowed_tools':allowed,'context_kind':context_kind,'history_api_count':len(replay),'original_dialogue_path':'raw/dialogues/'+r['file']}}
            candidates.append(case)
    # API-stratified sampling, category round robin; at most one row per API and dialogue.
    rng=random.Random(SEED); by_category=collections.defaultdict(lambda:collections.defaultdict(list))
    for case in sorted(candidates,key=lambda x:x['id']):
        by_category[case['category']][case['data']['target']['api_name']].append(case)
    category_order=sorted(by_category); rng.shuffle(category_order)
    api_orders={}
    for cat in category_order:
        api_orders[cat]=sorted(by_category[cat]);rng.shuffle(api_orders[cat])
        for api in api_orders[cat]:rng.shuffle(by_category[cat][api])
    selected=[];selected_dialogues=set();used_apis=set()
    while len(selected)<32:
        progress=False
        for cat in category_order:
            if len(selected)==32:break
            while api_orders[cat]:
                api=api_orders[cat].pop(0)
                choices=[c for c in by_category[cat][api] if c['data']['raw_record']['file'] not in selected_dialogues]
                if choices:
                    case=choices[0];selected.append(case);selected_dialogues.add(case['data']['raw_record']['file']);used_apis.add(api);progress=True;break
        if not progress:break
    assert 24<=len(selected)<=32,(len(selected),len(candidates))
    selected_ids={c['id'] for c in selected}
    for c in candidates:
        if c['id'] not in selected_ids:
            exclusions.append({'split':c['provenance']['split'],'upstream_id':c['upstream_id'],'row_sha256':c['provenance']['row_sha256'],'reason':'seed17_stratified_not_selected'})
    selected.sort(key=lambda x:x['id'])
    (ROOT/'cases.jsonl').write_text(''.join(json.dumps(c,ensure_ascii=False)+'\n' for c in selected))
    (ROOT/'exclusions.jsonl').write_text(''.join(json.dumps(e,ensure_ascii=False)+'\n' for e in exclusions))
    (ROOT/'raw'/'data_mapping.json').write_text(json.dumps(mapping,indent=2)+'\n')
    manifest={'source':'api_bank','status':'executable_adapted_subset','seed':SEED,'imported_original_records':len(loaded),'imported_by_split':dict(collections.Counter(x['split'] for x in loaded)),'eligible_after_native_replay':len(candidates),'executable_variants':len(selected),'distinct_upstream_problems':len(selected_ids),'distinct_dialogues':len(selected_dialogues),'distinct_target_apis':len(used_apis),'categories':dict(collections.Counter(c['category'] for c in selected)),'context_kinds':dict(collections.Counter(c['data']['context_kind'] for c in selected)),'history_api_counts':dict(collections.Counter(c['data']['history_api_count'] for c in selected)),'exclusion_counts':dict(collections.Counter(e['reason'] for e in exclusions)),'deduplication':'split+file+id and canonical raw-record SHA256 before sampling','sampling':'sort IDs, seed17 shuffle within API strata, shuffled category round robin, max one per API and dialogue, cap32','data':{'url':HF_URL,'revision':HF_REV,'license':'MIT (publisher dataset card, bundled verbatim)','files':[{ 'path':str(p.relative_to(ROOT)),'sha256':sha(p.read_bytes()),'records':len(json.loads(p.read_text()))} for p in raw_paths],'card_sha256':sha((ROOT/'raw/DATASET_CARD.md').read_bytes()),'mapping':'raw/data_mapping.json: all399 level1 expected calls exactly match structured repository targets by prior-API ordinal; upstream README says lv1-lv2-samples and HF test-data contain the conversation data'},'code':{'url':REPO_URL,'revision':CODE_REV,'license':'Apache-2.0','license_path':'LICENSE-CODE-APACHE-2.0.txt','runtime':'vendor/tool_manager.py retains five upstream methods verbatim, audited registry constructor and per-Episode deep copies','audit':'vendor_audit.json'},'initial_state':{'path':'fixtures','files':[{'path':'fixtures/'+p.name,'sha256':sha(p.read_bytes())} for p in sorted((ROOT/'fixtures').glob('*.json'))],'source_scope':'complete upstream init_database at pinned code revision; repository-shipped mock fixtures under repository Apache-2.0 license'},'metric':'adapted_stateful_next_tool_continuation; upstream per-API checker AND native result AND database state AND trace authenticity AND structured final','not_covered':['full interactive end-to-end dialogue success','API-Bank level2 ToolSearcher retrieval and level3 planning','live external APIs or model-driven perception','official language response ROUGE or LLM judge','malformed/mismatched native records listed in exclusions'],'runtime_dependencies':['Python >=3.10 standard library'],'model_calls':0}
    manifest['runtime_dependencies'] = ['Python >=3.10 standard library; validated on Python 3.14.4; upstream month/day parser needs revalidation for 3.15']
    manifest['raw_dialogue_files'] = len(list(dialog_dir.glob('*.jsonl')))
    manifest['data']['license_evidence_limitation'] = 'HF card declares MIT but provides no separate copyright/full license text; structured Git companion annotations mapped via publisher README and exact399 target correspondence, no separate data-specific Git license.'
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:manifest[k] for k in ('imported_original_records','eligible_after_native_replay','executable_variants','distinct_target_apis','categories','exclusion_counts')},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path)
    main(parser.parse_args().source)
