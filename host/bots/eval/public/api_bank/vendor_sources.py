"""Re-vendor the audited API-Bank subset; no downloads or upstream agent imports."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
REVISION = 'f30ccf22b4e2617fab32958d4c03f5c1f2e7dfcf'
MODULES = '''add_agenda add_alarm add_meeting add_reminder book_hotel calculator cancel_registration cancel_timed_switch check_token delete_agenda delete_alarm delete_meeting delete_reminder delete_scene document_qa emergency_knowledge get_user_token image_caption modify_agenda modify_alarm modify_meeting modify_registration modify_reminder play_music query_agenda query_alarm query_balance query_health_data query_history_today query_meeting query_registration query_reminder query_scene query_stock record_health_data speech_recognition symptom_search timed_switch wiki'''.split()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main(source):
    vendor = ROOT / 'vendor'
    apis = vendor / 'apis'
    apis.mkdir(parents=True, exist_ok=True)
    originals = ROOT / 'raw' / 'upstream_code'
    originals.mkdir(parents=True, exist_ok=True)
    (vendor / '__init__.py').write_text('"""Audited local API-Bank runtime; see ../NOTICE.md."""\n')
    (apis / '__init__.py').write_text('from .api import API\n')
    registry = []
    audit = []
    for module in ['api'] + MODULES:
        filename = module + '.py'
        data = (source / 'apis' / filename).read_bytes()
        (originals / filename).write_bytes(data)
        text = data.decode().replace('from apis.api import API', 'from .api import API').replace('from apis import API', 'from .api import API')
        tree = ast.parse(text)
        removed = []
        for cls in tree.body:
            if isinstance(cls, ast.ClassDef):
                if module != 'api': registry.append((module, cls.name))
                for method in cls.body:
                    if isinstance(method, ast.FunctionDef) and method.name == 'dump_database':
                        removed.append((method.lineno, method.end_lineno))
        lines = text.splitlines(keepends=True)
        for start, end in reversed(removed):
            del lines[start-1:end]
        text = ''.join(lines)
        (apis / filename).write_text(text)
        audit.append({'upstream_path': 'api-bank/apis/' + filename, 'upstream_sha256': sha(data), 'vendored_path': 'vendor/apis/' + filename, 'vendored_sha256': sha(text.encode()), 'changes': ['package-relative API import'] + (['removed unreachable filesystem dump_database method'] if removed else [])})
    (vendor / 'registry.py').write_text('\n'.join(f'from .apis.{m} import {c}' for m,c in registry) + '\n\nCLASSES = (' + ', '.join(c for _,c in registry) + ',)\n')
    data=(source/'tool_manager.py').read_bytes(); (originals/'tool_manager.py').write_bytes(data)
    original=data.decode(); cls=next(n for n in ast.parse(original).body if isinstance(n, ast.ClassDef))
    retained={'get_api_by_name','get_api_description','init_tool','api_call','list_all_apis'}
    methods='\n\n'.join('    '+ast.get_source_segment(original,n) for n in cls.body if isinstance(n,ast.FunctionDef) and n.name in retained)
    preamble='''"""API-Bank ToolManager; explicit local registry replaces upstream discovery.
The five dispatch/initialization/description methods below are upstream verbatim.
"""
import copy
import json
from pathlib import Path
from .registry import CLASSES
from eval_data import data_path

class ToolManager:
    def __init__(self, initial_databases=None):
        if initial_databases is None:
            fixture_dir = data_path('public/api_bank/fixtures')
            initial_databases = {p.stem: json.loads(p.read_text()) for p in sorted(fixture_dir.glob('*.json'))}
        self.init_databases = copy.deepcopy(initial_databases)
        self.apis = []
        self.inited_tools = {}
        for cls in CLASSES:
            info = {'name': cls.__name__, 'class': cls, 'description': cls.description,
                    'input_parameters': cls.input_parameters, 'output_parameters': cls.output_parameters}
            if getattr(cls, 'database_name', None) in self.init_databases:
                info['init_database'] = self.init_databases[cls.database_name]
            self.apis.append(info)
        self.token_checker = self.init_tool('CheckToken')

'''
    text=preamble+methods+'\n'; (vendor/'tool_manager.py').write_text(text)
    audit.append({'upstream_path':'api-bank/tool_manager.py','upstream_sha256':sha(data),'vendored_path':'vendor/tool_manager.py','vendored_sha256':sha(text.encode()),'changes':['constructor uses explicit audited registry and per-instance deep copied fixtures; no dynamic imports/CWD dependence','retain five dispatch/initialization/description methods verbatim; omit CLI, parser, ToolSearcher imports']})
    fixtures=ROOT/'fixtures'; fixtures.mkdir(exist_ok=True)
    # Complete upstream initial state, including databases unused by the selected tools.
    for p in sorted((source/'init_database').glob('*.json')):
        shutil.copyfile(p,fixtures/p.name)
    shutil.copyfile(source/'LICENSE',ROOT/'LICENSE-CODE-APACHE-2.0.txt')
    shutil.copyfile(source/'README.md',ROOT/'raw'/'UPSTREAM_README.md')
    (ROOT/'vendor_audit.json').write_text(json.dumps({'revision':REVISION,'files':audit},indent=2)+'\n')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('source',type=Path)
    main(parser.parse_args().source)
