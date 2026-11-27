"""Budget, source equivalence and execution of plain mode-specific bundles."""
import ast
import copy
import json
import os
from pathlib import Path
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch

from specops_delivery import producer
from specops_delivery.bundle import bundle, MODES, MODULES, specialize_main
from specops_delivery.render import CONFIGS, PUBLISHER_BUDGET, render

ROOT=Path(__file__).resolve().parents[1]
APP='portal' if (ROOT/'apps/portal').exists() else 'cebo'
CFG=CONFIGS[APP]
SHA='a'*40;TREE='b'*40;DIGEST='sha256:'+'c'*64


def load(mode, config=None):
    module=ModuleType('specops_inline_test')
    exec(compile(bundle(config or (CONFIGS if mode=='integrate' else CFG),mode),'<inline>','exec'),module.__dict__)
    return module


class Bundle(unittest.TestCase):
    def test_publishers_fit_96_kib_and_keep_32_kib_under_root_ceiling(self):
        self.assertEqual(PUBLISHER_BUDGET,96*1024)
        for app in CONFIGS:
            with self.subTest(app=app),tempfile.TemporaryDirectory() as temp:
                render(app,temp)
                size=(Path(temp)/'.github/workflows'/f'{app}-specops.yml').stat().st_size
                self.assertLessEqual(size,PUBLISHER_BUDGET)
                self.assertGreaterEqual(128*1024-size,32*1024)
        # Root's independent 128 KiB security limit is not raised by this P2.
        path=ROOT/'specops/github.py'
        if path.exists():self.assertIn('file["size"] <= 128*1024',path.read_text())

    def test_oversized_generation_fails_before_writing_publisher(self):
        with tempfile.TemporaryDirectory() as temp,patch('specops_delivery.render.inline',return_value='x'*(96*1024)):
            with self.assertRaisesRegex(ValueError,'publisher-budget-96-kib'):render(APP,temp)
            self.assertFalse((Path(temp)/'.github/workflows'/f'{APP}-specops.yml').exists())

    def test_only_reachable_protocol_paths_are_embedded(self):
        expected={'verify':{'test_digest','fetch_build','inspect_oci'},
                  'fetch':{'fetch_build','inspect_oci'},'candidate':{'make_candidate'},
                  'prepare':{'prepare_promotion'},'integrate':{'integrate'}}
        watched=set.union(*expected.values())
        for mode in MODES:
            with self.subTest(mode=mode):
                module=load(mode)
                self.assertEqual(watched & set(vars(module)),expected[mode])
                if mode!='verify':self.assertNotIn('runtime_fixture',vars(module))
                if mode in ('fetch','candidate','prepare','integrate'):
                    self.assertNotIn('test_digest',vars(module))
                self.assertIn('diagnostic_record',vars(module))
                self.assertIn('API',vars(module))

    def test_kept_functions_classes_and_constants_have_unchanged_ast(self):
        original={}
        for name in MODULES:
            for node in ast.parse((ROOT/'specops_delivery'/name).read_text()).body:
                if isinstance(node,(ast.FunctionDef,ast.ClassDef)):original[node.name]=node
                if isinstance(node,ast.Assign):
                    for target in node.targets:
                        if isinstance(target,ast.Name):original[target.id]=node
        for mode in MODES:
            for node in ast.parse(bundle(CONFIGS if mode=='integrate' else CFG,mode)).body:
                name=node.name if isinstance(node,(ast.FunctionDef,ast.ClassDef)) else (
                    node.targets[0].id if isinstance(node,ast.Assign) else None)
                if name in original and name not in ('main','CONFIG'):
                    self.assertEqual(ast.dump(node),ast.dump(original[name]),(mode,name))

    def test_no_runtime_local_imports_compression_or_code_loader(self):
        for mode in MODES:
            nodes=list(ast.walk(ast.parse(bundle(CONFIGS if mode=='integrate' else CFG,mode))))
            self.assertFalse(any(isinstance(n,ast.ImportFrom) and n.level for n in nodes))
            self.assertFalse(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and
                                 n.func.id in ('exec','eval','compile','__import__') for n in nodes))
            self.assertFalse(any(isinstance(n,ast.Import) and any(a.name in ('zlib','marshal') for a in n.names) for n in nodes))

    def test_other_mode_cannot_use_the_specialized_dispatcher(self):
        for mode in MODES:
            module=load(mode)
            with patch.dict(os.environ,{'SPECOPS_MODE':'unsupported','GH_TOKEN':'fixture'}),patch.object(module,'API') as api:
                with self.assertRaisesRegex(ValueError,'producer-mode'):module.main()
                api.assert_not_called()
        with self.assertRaisesRegex(ValueError,'unsupported-bundle-mode'):bundle(CFG,'unsupported')

    def test_unknown_expressions_keep_short_circuit_side_effects(self):
        source="""def main():
    mode = 'fetch'
    if mark() and mode == 'verify':
        mark()
    if mode == 'fetch' or mark():
        mark()
"""
        calls=[];namespace={'mark':lambda:calls.append('mark'),'require':producer.require}
        main=specialize_main(ast.parse(source).body[0],'fetch')
        exec(compile(ast.fix_missing_locations(ast.Module(body=[main],type_ignores=[])),'<test>','exec'),namespace)
        namespace['main']();self.assertEqual(calls,['mark','mark'])
        shadow="""def main():
    mode = 'fetch'
    def inner(mode):
        return 'verify' if mode == 'verify' else 'other'
    mark(inner('verify'))
"""
        calls=[];namespace={'mark':calls.append,'require':producer.require}
        main=specialize_main(ast.parse(shadow).body[0],'fetch')
        exec(compile(ast.fix_missing_locations(ast.Module(body=[main],type_ignores=[])),'<test>','exec'),namespace)
        namespace['main']();self.assertEqual(calls,['verify'])
        with self.assertRaisesRegex(ValueError,'dispatcher-mode-reassignment'):
            specialize_main(ast.parse("def main():\n mode='fetch'\n if change:\n  mode='verify'\n").body[0],'fetch')

    def execute(self,module,mode,scenario):
        config=CONFIGS if mode=='integrate' else CFG
        meta={'sha':SHA,'tree':TREE,'pr':7,'source_run':100,'digest':DIGEST,
              'artifact_id':8,'artifact_digest':'sha256:'+'d'*64}
        calls=[]
        def record(name,value=None,result=None):
            def invoke(*args,**kwargs):
                calls.append((name,value));return copy.deepcopy(result)
            return invoke
        class API:
            def __init__(self,token):calls.append(('token',token))
            def pages(self,path):return [{'head':{'repo':{'full_name':CFG['repository']},'sha':SHA},'user':{'id':45120213}}]
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);event=root/'event.json'
            data={'inputs':{'source_run':'100'}}
            if scenario=='workflow-run':data={'workflow_run':{'id':100}}
            if scenario=='no-source':data={}
            if mode=='integrate' and scenario!='periodic':data={'pull_request':{'base':{'ref':'specops-promotions/'+APP},'number':9}}
            event.write_text(json.dumps(data))
            fetch=root/'specops-fetch';fetch.mkdir();(fetch/'meta.json').write_text(json.dumps(meta))
            env={'SPECOPS_MODE':mode,'GH_TOKEN':'synthetic-read-only','GITHUB_REPOSITORY':producer.CONTROL if mode=='integrate' else CFG['repository'],
                 'GITHUB_REF':'refs/heads/main','GITHUB_RUN_ATTEMPT':'1','RUNNER_TEMP':temp,'GITHUB_EVENT_PATH':str(event),
                 'VERIFIED_DIGEST':DIGEST,'VERIFIED_ARTIFACT_ID':'8','VERIFIED_ARTIFACT_DIGEST':meta['artifact_digest'],
                 'REMOTE_DIGEST':DIGEST,'GITHUB_RUN_ID':'110'}
            if scenario=='bad-repo':env['GITHUB_REPOSITORY']='unauthorized/repo'
            if scenario=='bad-ref':env['GITHUB_REF']='refs/heads/untrusted'
            if scenario=='bad-attempt':env['GITHUB_RUN_ATTEMPT']='2'
            if scenario=='changed-digest':env['VERIFIED_DIGEST']='sha256:'+'e'*64
            patches={'CONFIG':copy.deepcopy(config),'API':API}
            possible={'provenance':record('provenance',result={k:meta[k] for k in ('sha','tree','pr','source_run')}),
                      'already_published':record('duplicate',result=scenario=='duplicate'),
                      'fetch_build':lambda api,cfg,source,work:(calls.append(('fetch',None)) or copy.deepcopy(meta),work/'image.oci.tar'),
                      'test_digest':record('test-digest'),'inspect_oci':record('inspect',result=DIGEST),
                      'prepare_promotion':record('prepare'),'integrate':record('integrate'),'integrate_periodic':record('periodic'),
                      'statuses':record('statuses',result=[{'id':5,'state':'success','description':'e'*64+':'+'f'*64}]),
                      'output':lambda values:calls.append(('output',values.copy()))}
            patches.update({key:value for key,value in possible.items() if hasattr(module,key)})
            with patch.dict(os.environ,env),patch.multiple(module,**patches):
                try:module.main();error=None
                except Exception as failure:error=module.diagnostic_record(failure)
            files={str(path.relative_to(root)):path.read_text() for path in root.rglob('*') if path.is_file() and path!=event}
            return json.dumps({'calls':calls,'files':files,'error':error},sort_keys=True).replace(temp,'<work>')

    def test_specialized_dispatch_matches_full_source_for_each_mode_and_rejections(self):
        for mode in MODES:
            scenarios=['normal','workflow-run','bad-repo','bad-ref']
            if mode in ('verify','fetch','candidate'):scenarios+=['bad-attempt','no-source','changed-digest']
            if mode=='verify':scenarios+=['duplicate']
            if mode=='integrate':scenarios+=['periodic']
            for scenario in scenarios:
                with self.subTest(mode=mode,scenario=scenario):
                    self.assertEqual(self.execute(load(mode),mode,scenario),self.execute(producer,mode,scenario))


if __name__=='__main__':unittest.main()
