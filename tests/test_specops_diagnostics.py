"""Regressions for anonymous loopback auth and bounded diagnostic vocabulary."""
import ast
from contextlib import closing
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock,patch
import urllib.error
import yaml
from specops_delivery import producer as p
from specops_delivery.diagnostics import Failure,SAFE_CODES,diagnostic_record,stage
from specops_delivery.render import CONFIGS,publisher

ROOT=Path(__file__).resolve().parents[1]
SECRET='PRIVATE-SENTINEL-never-log-this'


class Diagnostics(unittest.TestCase):
    def test_incident_ci_is_readonly_and_review_base_cannot_publish(self):
        workflow=yaml.safe_load((ROOT/'.github/workflows/specops-readback.yml').read_text())
        event=workflow.get('on',workflow.get(True))
        self.assertEqual(event['pull_request']['branches'],['review/specops-issue-40'])
        self.assertTrue(all(value=='read' for value in workflow['permissions'].values()))
        checkout=workflow['jobs']['readback']['steps'][0]
        self.assertFalse(checkout['with']['persist-credentials'])
        cfg=CONFIGS['portal'];sha='a'*40
        pr={'number':7,'state':'open','user':{'id':p.OWNER},'head':{'sha':sha,'repo':{'full_name':cfg['repository']}},
            'base':{'ref':'review/specops-issue-40','repo':{'full_name':cfg['repository']}}}
        with self.assertRaisesRegex(ValueError,'source-pr'):p.source_identity(pr,cfg,7,sha,True)

    def record(self,error):
        record=diagnostic_record(error)
        self.assertNotIn(SECRET,json.dumps(record))
        self.assertNotIn('https://',json.dumps(record))
        return record

    def test_known_nested_stage_and_reason_preserved(self):
        try:
            with stage('provenance'):
                with stage('api-read'):raise ValueError('github-response-403')
        except Failure as error:
            record=self.record(error)
            self.assertEqual(record['context'],['provenance','api-read'])
            self.assertEqual(record['code'],'github-response-403')
            self.assertEqual(record['stage'],'api-read')

    def test_unknown_errors_and_forged_fields_cannot_interpolate_private_data(self):
        class Unprintable:
            def __str__(self):raise RuntimeError(SECRET)
        cases=[(ValueError(SECRET),'invalid-evidence'),(KeyError(SECRET),'evidence-shape'),
               (OSError(SECRET),'local-io'),(RuntimeError(SECRET),'internal-error'),
               (json.JSONDecodeError(SECRET,SECRET,0),'invalid-json'),
               (subprocess.TimeoutExpired([SECRET],1,output=SECRET,stderr=SECRET),'command-timeout'),
               (Failure((SECRET,),SECRET),'internal-error'),
               (Failure(('api-read',),{'private':SECRET}),'internal-error'),
               (ValueError(Unprintable()),'invalid-evidence')]
        for error,code in cases:
            with self.subTest(code=code):self.assertEqual(self.record(error)['code'],code)

    def test_literal_rejections_all_have_an_explicit_allowlist_entry(self):
        for name in ('producer.py','ci.py'):
            for node in ast.walk(ast.parse((ROOT/'specops_delivery'/name).read_text())):
                if not isinstance(node,ast.Call) or not isinstance(node.func,ast.Name):continue
                arg=None
                if node.func.id=='require' and len(node.args)==2:arg=node.args[1]
                if node.func.id=='ValueError' and node.args:arg=node.args[0]
                if isinstance(arg,ast.Constant) and isinstance(arg.value,str):
                    self.assertIn(arg.value,SAFE_CODES)

    def test_process_failure_exposes_only_fixed_code_not_stderr_or_args(self):
        result=subprocess.CompletedProcess([],1,stdout=SECRET,
            stderr='reading auth.json: permission denied '+SECRET+' https://signed.invalid/?token='+SECRET)
        with patch.object(p.subprocess,'run',return_value=result):
            with self.assertRaises(Failure) as captured:
                p.run(['skopeo',SECRET],step='registry-copy')
        record=self.record(captured.exception)
        self.assertEqual(record['code'],'credential-file-permission')
        self.assertEqual(record['stage'],'registry-copy')

    def test_timeout_stage_and_subprocess_environment_exclude_tokens(self):
        with patch.dict(os.environ,{'GH_TOKEN':SECRET,'GITHUB_TOKEN':SECRET}),patch.object(
                p.subprocess,'run',side_effect=subprocess.TimeoutExpired([SECRET],300,stderr=SECRET)) as call:
            with self.assertRaises(Failure) as captured:p.run(['skopeo','inspect','fixture'],step='oci-index')
        self.assertEqual(set(call.call_args.kwargs['env']),{'PATH','HOME','LANG'})
        self.assertEqual(self.record(captured.exception)['code'],'command-timeout')

    def test_api_failure_keeps_status_and_hides_header_url_body(self):
        error=urllib.error.HTTPError('https://api.github.com/'+SECRET,403,SECRET,{'Authorization':SECRET},io.BytesIO(SECRET.encode()))
        api=p.API(SECRET);api.opener=Mock();api.opener.open.side_effect=error
        with self.assertRaises(Failure) as captured:api.request('/repos/owner/repo/actions/runs/1')
        self.assertEqual(self.record(captured.exception)['code'],'github-response-403')
        self.assertEqual(self.record(captured.exception)['context'],['api-read'])

    def test_redirect_keeps_authentication_only_on_github(self):
        api=p.API(SECRET);requests=[]
        url='https://objects.blob.core.windows.net/fixture?sig='+SECRET
        def opened(request,**kwargs):
            requests.append(request)
            if len(requests)==1:
                raise urllib.error.HTTPError(request.full_url,302,SECRET,{'Location':url},None)
            return io.BytesIO(b'fixture')
        api.opener=Mock();api.opener.open.side_effect=opened
        with api.open('https://api.github.com/repos/o/r/actions/artifacts/1/zip',artifact=True) as response:
            self.assertEqual(response.read(),b'fixture')
        self.assertEqual(requests[0].get_header('Authorization'),'Bearer '+SECRET)
        self.assertIsNone(requests[1].get_header('Authorization'))
        self.assertNotIn(SECRET,json.dumps(self.record(ValueError('artifact-host'))))

    def test_forbidden_redirect_is_not_requested(self):
        for url in ('http://objects.blob.core.windows.net/a','https://evil.invalid/a',
                    'https://user@objects.blob.core.windows.net/a','https://objects.blob.core.windows.net:444/a'):
            api=p.API(SECRET);api.opener=Mock()
            api.opener.open.side_effect=urllib.error.HTTPError('https://api.github.com',302,SECRET,{'Location':url},None)
            with self.subTest(url=url),self.assertRaises(ValueError):
                api.open('https://api.github.com/repos/o/r/actions/artifacts/1/zip',artifact=True)
            self.assertEqual(api.opener.open.call_count,1)

    def test_checksum_mismatch_remains_rejected_with_specific_stage(self):
        api=p.API(SECRET)
        with tempfile.TemporaryDirectory() as temp,patch.object(api,'open',return_value=closing(io.BytesIO(b'changed'))):
            with self.assertRaises(Failure) as captured:
                api.archive('o/r',{'id':1,'digest':'sha256:'+'0'*64,'size_in_bytes':7},Path(temp)/'zip')
        self.assertEqual(self.record(captured.exception)['context'],['artifact-download','artifact-checksum'])
        self.assertEqual(self.record(captured.exception)['code'],'artifact-checksum')

    def test_loopback_skopeo_uses_private_empty_auth_without_changing_ghcr_copy(self):
        for cfg in CONFIGS.values():
            raw='{"mediaType":"application/vnd.oci.image.index.v1+json"}'
            digest='sha256:'+hashlib.sha256(raw.encode()).hexdigest()
            ref='127.0.0.1:12345/specops-fixture@'+digest;calls=[]
            def command(args,raw=False,step=None):
                calls.append((args,step))
                if args[:2]==['docker','port']:return '127.0.0.1:12345'
                if args[0]=='skopeo':
                    self.assertIn('--authfile',args)
                    auth=Path(args[args.index('--authfile')+1])
                    self.assertEqual(auth.stat().st_mode&0o777,0o600)
                    self.assertEqual(json.loads(auth.read_text()),{'auths':{}})
                    self.assertTrue(args[-1].startswith('docker://127.0.0.1:'))
                    if args[1]=='inspect':return '{"mediaType":"application/vnd.oci.image.index.v1+json"}'
                    self.assertIn('--all',args);self.assertIn('--preserve-digests',args)
                if args[:3]==['docker','image','inspect']:
                    return json.dumps([{'RepoDigests':[ref],'Os':'linux','Architecture':'amd64'}])
                return ''
            with tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted'}),patch.object(
                    p,'run',side_effect=command),patch.object(p.urllib.request,'build_opener') as opener,patch.object(p.subprocess,'run'):
                opener.return_value.open.return_value.close.return_value=None
                p.test_digest(Path(temp)/'source.oci.tar',cfg,digest,temp)
            runtime=next(args for args,step in calls if step=='runtime-start')
            self.assertEqual(runtime[runtime.index('--network')+1],'none')
            self.assertIn('--cap-drop',runtime)
            self.assertEqual(runtime[-1],ref)
            self.assertTrue(all('ghcr.io' not in ' '.join(args) for args,step in calls))

    def test_copy_only_job_reports_fixed_errors_without_registry_output(self):
        cfg=publisher('portal')['jobs']['publish']
        login=next(s['run'] for s in cfg['steps'] if s.get('name')=='Login only in copy-only job')
        copy=next(s['run'] for s in cfg['steps'] if s.get('id')=='copy')
        raw=b'{"schemaVersion":2}\n';digest='sha256:'+hashlib.sha256(raw).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);binary=root/'skopeo'
            binary.write_text('#!/usr/bin/env python3\nimport os,sys\n'
                'mode=sys.argv[1]\n'
                'if os.environ.get("FAIL_COMMAND")==mode:\n'
                ' print(os.environ["PRIVATE_SENTINEL"]);print(os.environ["PRIVATE_SENTINEL"],file=sys.stderr);sys.exit(1)\n'
                'if mode=="inspect":sys.stdout.buffer.write('+repr(raw)+')\n')
            binary.chmod(0o755)
            env={**os.environ,'PATH':str(root)+':'+os.environ['PATH'],'RUNNER_TEMP':temp,
                 'GITHUB_ACTOR':'fixture','GITHUB_RUN_ID':'12','GHCR_TOKEN':SECRET,
                 'PRIVATE_SENTINEL':SECRET,'OCI_PATH':temp+'/synthetic.oci.tar',
                 'EXPECTED':digest,'GITHUB_OUTPUT':str(root/'output')}
            for mode,script in (('login',login),('copy',copy),('inspect',copy),('digest',copy),('success',copy)):
                with self.subTest(mode=mode):
                    scenario={**env,'FAIL_COMMAND':mode}
                    if mode=='digest':scenario['EXPECTED']='sha256:'+'0'*64
                    result=subprocess.run(['bash','-c',script],env=scenario,capture_output=True,text=True)
                    self.assertNotIn(SECRET,result.stdout+result.stderr)
                    if mode=='success':
                        self.assertEqual(result.returncode,0)
                        self.assertEqual((root/'output').read_text(),'digest='+digest+'\n')
                        self.assertEqual((root/'remote-index.json').stat().st_mode&0o777,0o600)
                    else:
                        self.assertNotEqual(result.returncode,0)
                        self.assertIn('stage=ghcr-'+mode,result.stderr)


if __name__=='__main__':unittest.main()
