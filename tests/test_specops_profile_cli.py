"""Execute profile CLI parsing and private exclusive writes; no NUC or Docker."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

from specops_delivery.profile import source_policy
from specops_delivery.render import CONFIGS
from specops_delivery.scope import affected
from specops_delivery import producer

ROOT=Path(__file__).resolve().parents[1]
PORTAL=ROOT/'scripts/portal-dev-profile.py'
BLOB='a'*40
BASELINE=CONFIGS['portal']['image']+'@sha256:'+'b'*64
COMMON=['--source-workflow','17','--publisher-workflow','23','--required-workflows','17','19','--publisher-blob',BLOB]
# A child process executes the actual Portal argument parser/writer; only the
# host-specific prepare() is replaced. No /opt access, Docker or mock writer.
PORTAL_DRIVER='''
import importlib.util,json,os,sys
from unittest.mock import Mock
spec=importlib.util.spec_from_file_location('portal_profile_cli',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.prepare=Mock(return_value=json.loads(os.environ['PROFILE_CLI_FIXTURE']))
module.main(sys.argv[2:])
module.prepare.assert_called_once_with('/opt/servicios-dev/portal',os.environ['PROFILE_CLI_BASELINE'],17,23,[17,19],'a'*40)
'''


def maintenance_paths():
    paths=['specops_delivery/profile.py','tests/test_specops_profile_cli.py','docs/SPECOPS_PROFILE_CLI.md']
    if PORTAL.exists():paths.append('scripts/portal-dev-profile.py')
    return paths


@unittest.skipUnless(os.name=='posix','0600 and exclusive output are POSIX host requirements')
class ProfileCLI(unittest.TestCase):
    def variants(self):
        result=[('source-'+app,[sys.executable,'-m','specops_delivery.profile','--app',app],
                 source_policy(app,17,23,[17,19],BLOB)) for app in CONFIGS]
        if PORTAL.exists():
            result.append(('portal',[sys.executable,'-c',PORTAL_DRIVER,str(PORTAL),'--baseline',BASELINE],
                           {'version':1,'enabled':False,'app':'portal','synthetic_fixture':'private-cli-test',
                            'source':source_policy('portal',17,23,[17,19],BLOB)}))
        return result

    def invoke(self,variant,target,umask=0,extra=None):
        name,args,expected=variant
        env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','PROFILE_CLI_FIXTURE':json.dumps(expected),
             'PROFILE_CLI_BASELINE':BASELINE}
        return subprocess.run([*args,*COMMON,'--output',str(target),*(extra or [])],cwd=ROOT,
                              env=env,capture_output=True,text=True,timeout=20,umask=umask)

    def test_cli_creates_valid_json_0600_even_with_permissive_umask(self):
        for variant in self.variants():
            for mask in (0,0o077):
                with self.subTest(cli=variant[0],umask=mask),tempfile.TemporaryDirectory() as temp:
                    target=Path(temp)/'private profile.json'
                    result=self.invoke(variant,target,mask)
                    self.assertEqual(result.returncode,0,result.stderr)
                    info=target.lstat()
                    self.assertTrue(stat.S_ISREG(info.st_mode))
                    self.assertEqual(stat.S_IMODE(info.st_mode),0o600)
                    self.assertEqual(info.st_uid,os.geteuid())
                    self.assertEqual(json.loads(target.read_text()),variant[2])
                    if variant[0]=='portal':self.assertFalse(json.loads(target.read_text())['enabled'])

    def test_cli_second_attempt_is_exclusive_and_does_not_overwrite(self):
        for variant in self.variants():
            with self.subTest(cli=variant[0]),tempfile.TemporaryDirectory() as temp:
                target=Path(temp)/'private.json'
                first=self.invoke(variant,target)
                self.assertEqual(first.returncode,0,first.stderr)
                target.write_bytes(b'EXISTING-PRIVATE-CONTENT\n')
                before=target.stat();again=self.invoke(variant,target)
                self.assertNotEqual(again.returncode,0)
                self.assertIn('FileExistsError',again.stderr)
                self.assertEqual(target.read_bytes(),b'EXISTING-PRIVATE-CONTENT\n')
                self.assertEqual((target.stat().st_ino,target.stat().st_mtime_ns),(before.st_ino,before.st_mtime_ns))
                self.assertEqual(stat.S_IMODE(target.stat().st_mode),0o600)

    def test_cli_refuses_existing_and_dangling_destination_symlinks(self):
        for variant in self.variants():
            for existing in (True,False):
                with self.subTest(cli=variant[0],existing_target=existing),tempfile.TemporaryDirectory() as temp:
                    root=Path(temp);target=root/'target.json';link=root/'profile.json'
                    if existing:target.write_bytes(b'DO-NOT-REPLACE\n')
                    link.symlink_to(target)
                    result=self.invoke(variant,link)
                    self.assertNotEqual(result.returncode,0)
                    self.assertIn('FileExistsError',result.stderr)
                    self.assertTrue(link.is_symlink())
                    self.assertEqual(os.readlink(link),str(target))
                    if existing:self.assertEqual(target.read_bytes(),b'DO-NOT-REPLACE\n')
                    else:self.assertFalse(target.exists())

    def test_cli_missing_parent_does_not_create_directories_or_partial_output(self):
        for variant in self.variants():
            with self.subTest(cli=variant[0]),tempfile.TemporaryDirectory() as temp:
                target=Path(temp)/'missing'/'profile.json'
                result=self.invoke(variant,target)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('FileNotFoundError',result.stderr)
                self.assertFalse(target.parent.exists())

    def test_source_cli_rejects_invalid_arguments_before_creation(self):
        for variant in self.variants():
            if variant[0]=='portal':continue  # prepare is deliberately mocked here.
            for extra in (['--source-workflow','0'],['--publisher-blob','invalid']):
                with self.subTest(cli=variant[0],extra=extra),tempfile.TemporaryDirectory() as temp:
                    target=Path(temp)/'profile.json'
                    result=self.invoke(variant,target,extra=extra)
                    self.assertNotEqual(result.returncode,0)
                    self.assertFalse(target.exists())


class MaintenanceScope(unittest.TestCase):
    def test_changed_paths_are_not_candidate_inputs_in_either_repository(self):
        files=[{'filename':p,'status':'modified'} for p in maintenance_paths()]
        for cfg in CONFIGS.values():
            with self.subTest(app=cfg['app']):self.assertFalse(affected(files,cfg['candidate_paths']))
        if (ROOT/'specops/github.py').exists():
            from specops.github import GitHubSource
            for cfg in CONFIGS.values():
                source=GitHubSource(None,{'repository':cfg['repository'],'candidate_paths':cfg['candidate_paths']})
                self.assertFalse(source.affected(files))

    def test_publisher_rejects_maintenance_before_artifact_or_candidate_operations(self):
        for cfg in CONFIGS.values():
            class ReadOnly:
                def request(self,path,method='GET',body=None):
                    if method!='GET' or body is not None:raise AssertionError('unexpected mutation')
                    if '/actions/runs/' in path:
                        return {'id':100,'workflow_id':10,'path':cfg['source_path'],'event':'pull_request',
                                'repository':{'full_name':cfg['repository']},'head_repository':{'full_name':cfg['repository']},
                                'head_sha':'b'*40,'actor':{'id':45120213},'triggering_actor':{'id':45120213},
                                'status':'completed','conclusion':'success','pull_requests':[{'number':7}]}
                    if '/pulls/7' in path:
                        return {'number':7,'state':'open','user':{'id':45120213},
                                'head':{'sha':'b'*40,'repo':{'full_name':cfg['repository']}},
                                'base':{'ref':'main','repo':{'full_name':cfg['repository']}}}
                    if '/actions/workflows/' in path:return {'id':10}
                    raise AssertionError('unexpected API operation')
                def pages(self,path,*args,**kwargs):
                    if not path.endswith('/pulls/7/files'):raise AssertionError('unexpected artifact query')
                    return [{'filename':p} for p in maintenance_paths()]
            with self.subTest(app=cfg['app']),self.assertRaisesRegex(ValueError,'source-outside-scope'):
                producer.provenance(ReadOnly(),cfg,100)


if __name__=='__main__':unittest.main()
