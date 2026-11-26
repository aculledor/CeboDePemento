"""Public wire/producer fixtures. No token, registry or real GitHub mutation."""
import base64
import copy
from dataclasses import asdict
import io
import json
import re
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import yaml
from specops_delivery import producer as p
from specops_delivery.render import CONFIGS,render
from specops_delivery.scope import affected,verify
from specops_delivery.profile import source_policy

ROOT=Path(__file__).resolve().parents[1]
APP='portal' if (ROOT/'apps/portal').exists() else 'cebo'
CFG=CONFIGS[APP];SHA='a'*40;TREE='b'*40;DIGEST='sha256:'+'c'*64

def value():return p.make_candidate(CFG,{'sha':SHA,'tree':TREE,'pr':7,'source_run':100,'digest':DIGEST},110,1)

def encoded(v):return {'content':base64.b64encode(json.dumps(v).encode()).decode(),'sha':TREE}

class Fake:
 def __init__(self):
  self.mutations=[];self.files=[{'filename':next(s for s in CFG['candidate_paths'] if s.endswith('/'))+'server.ts'}]
  self.source={'number':7,'draft':True,'node_id':'SOURCE_FIXTURE','state':'open','head':{'sha':SHA,'repo':{'full_name':CFG['repository']}},'base':{'ref':'main','repo':{'full_name':CFG['repository']}},'user':{'id':p.OWNER}}
  self.run={'id':100,'workflow_id':10,'repository':{'full_name':CFG['repository']},'head_repository':{'full_name':CFG['repository']},'head_sha':SHA,'path':CFG['source_path'],'event':'pull_request','actor':{'id':p.OWNER},'triggering_actor':{'id':p.OWNER},'status':'completed','conclusion':'success','pull_requests':[{'number':7}],'run_attempt':1,'created_at':'2026-11-26T01:32:39Z','run_started_at':'2026-11-26T01:32:39Z'}
  self.latest=100;self.c=value();self.old=CFG['image'].removesuffix('-dev')+'@sha256:'+'d'*64
  self.doc={'version':1,'app':APP,'candidate':self.c,'candidate_id':p.identity(self.c),'previous_image':self.old,'dev_receipt':'e'*64,'promotion_pr':9}
  self.promotion={'number':9,'merged':True,'merged_at':'2026-11-26T02:06:18Z','merged_by':{'id':p.OWNER},'base':{'ref':'specops-promotions/'+APP},'head':{'repo':{'full_name':p.CONTROL},'sha':'f'*40},'merge_commit_sha':'f'*40}
  self.prod=[]
 def request(self,path,method='GET',body=None):
  if method!='GET':
   self.mutations.append((path,method,body))
   if path.endswith('/pulls/7/merge'):
    self.source.update(state='closed',merged=True,merged_at='2026-11-26T02:06:18Z',draft=False);self.run['pull_requests']=[]
   return {'merged':True}
  if '/actions/runs/' in path:return self.run
  if '/actions/workflows/' in path:return {'id':10+CFG['required_workflows'].index('.github/workflows/'+path.rsplit('/',1)[-1])}
  if '/git/commits/' in path:return {'tree':{'sha':TREE}}
  if '/pulls/7' in path:return self.source
  if '/pulls/9' in path:return self.promotion
  if '/branches/' in path:return {'commit':{'sha':'f'*40}}
  if '/contents/releases/' in path:return encoded(self.doc)
  if '/compare/' in path:return {'status':'ahead','merge_base_commit':{'sha':SHA}}
  raise AssertionError(path)
 def pages(self,path,key=None):
  if '/pulls?state=closed&base=' in path:return [self.promotion]
  if '/pulls/9/files' in path:return [{'filename':'releases/'+APP+'.json','status':'modified'}]
  if '/pulls/7/files' in path:return self.files
  if '/attempts/' in path:
   number=int(path.split('/actions/runs/')[1].split('/')[0])
   return [{'run_id':number,'run_attempt':1,'status':'completed','conclusion':'success','started_at':'2026-11-26T01:32:41Z','completed_at':'2026-11-26T01:36:15Z'}]
  if '/runs?' in path:
   workflow=int(re.search(r'/workflows/(\d+)/',path)[1]);idx=workflow-10
   return [dict(self.run,id=self.latest+idx,workflow_id=workflow,path=CFG['required_workflows'][idx])]
  if '/statuses' in path:return self.prod if self.prod else [{'context':'specops/dev/'+APP,'state':'success','description':self.doc['candidate_id']+':'+self.doc['dev_receipt']}]
  raise AssertionError(path)

class Delivery(unittest.TestCase):
 def test_wire_strict_and_compatible(self):
  c=value();self.assertEqual(len(c),15);self.assertEqual(p.candidate(c,CFG),c)
  for key,new in [('publisher_attempt',2),('pr',True),('platform','linux/arm64'),('digest','sha256:'+'d'*64),('migration','unsafe'),('image',CFG['image'].removesuffix('-dev'))]:
   bad=dict(c,**{key:new})
   with self.subTest(key=key),self.assertRaises(ValueError):p.candidate(bad,CFG)
  with self.assertRaises(ValueError):p.candidate(dict(c,command='evil'),CFG)
  if APP=='portal':
   from specops.policy import Candidate
   for cfg in CONFIGS.values():
    wire=p.make_candidate(cfg,{'sha':SHA,'tree':TREE,'pr':7,'source_run':100,'digest':DIGEST},110,1)
    self.assertEqual(Candidate.parse(wire).id,p.identity(wire))
 def test_provenance_stale_fork_unauthorized_failed_pending(self):
  self.assertEqual(p.provenance(Fake(),CFG,100)['sha'],SHA)
  for mutate in [lambda a:a.run['head_repository'].update(full_name='evil/fork'),lambda a:a.run['actor'].update(id=99),lambda a:a.source['user'].update(id=99),lambda a:a.source['head'].update(sha='d'*40),lambda a:a.run.update(conclusion='failure'),lambda a:a.run.update(status='in_progress'),lambda a:setattr(a,'latest',101),lambda a:setattr(a,'files',[{'filename':'unrelated.md'}])]:
   api=Fake();mutate(api)
   with self.assertRaises(ValueError):p.provenance(api,CFG,100)
   self.assertEqual(api.mutations,[])
 def test_migration_none_refuses_changed_migration_and_rename(self):
  if APP!='cebo':return
  for files in [[{'filename':'apps/api/migrations/0007_new.sql'}],[{'filename':'other.sql','previous_filename':'apps/api/migrations/0006_pescaderias_import.sql'}]]:
   api=Fake();api.files=files
   with self.assertRaisesRegex(ValueError,'migration-not-supported-v1'):p.provenance(api,CFG,100)
   self.assertEqual(api.mutations,[])
 def test_scope_rename_and_new_copy_input(self):
  scopes=CFG['candidate_paths'];docker=ROOT/'apps/portal/Dockerfile' if APP=='portal' else ROOT/'Dockerfile'
  verify(docker,'apps/portal' if APP=='portal' else '.',scopes)
  self.assertTrue(affected([{'filename':'outside','previous_filename':next(s for s in scopes if s.endswith('/'))+'renamed'}],scopes))
  self.assertFalse(affected([{'filename':scopes[0].rstrip('/')+'-old/file'}],scopes))
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'Dockerfile';path.write_text(docker.read_text()+'\nCOPY unreviewed-input /new\n')
   if APP=='cebo':
    with self.assertRaises(ValueError):verify(path,'.',scopes)
   else:
    # Portal COPY . already covers every present/future context input.
    verify(path,'apps/portal',scopes)
    with self.assertRaises(ValueError):verify(path,'new-context',scopes)
 def test_producer_and_root_source_scope_identical(self):
  policy=source_policy(APP,10,20,[10,11],'e'*40)
  self.assertEqual(policy['candidate_paths'],CFG['candidate_paths'])
  self.assertEqual(policy['publisher_path'],CFG['publisher_path'])
  with self.assertRaises(ValueError):source_policy(APP,0,20,[10],'e'*40)
 def test_flat_artifact_rejects_traversal_and_extra_members(self):
  for names in [('image.oci.tar',),('../image.oci.tar',),('image.oci.tar','extra')]:
   with tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)/'source.zip'
    with zipfile.ZipFile(path,'w') as z:
     for name in names:z.writestr(name,b'fake-oci')
    if len(names)==1 and names[0]=='image.oci.tar':self.assertEqual(p.extract_build(path,tmp).read_bytes(),b'fake-oci')
    else:
     with self.assertRaises(ValueError):p.extract_build(path,tmp)
 def test_baseline_requires_confirmed_production(self):
  api=Fake();bootstrap={'version':1,'app':APP,'current_image':api.old};self.assertEqual(p.baseline(api,CFG,bootstrap),api.old)
  with self.assertRaises(ValueError):p.baseline(api,CFG,api.doc)
  api.prod=[{'context':'specops/prod/'+APP,'state':'success','description':p.identity(api.c)+':'+DIGEST.split(':')[1]}]
  self.assertEqual(p.baseline(api,CFG,api.doc),CFG['image']+'@'+DIGEST)
  api.prod[0].update(state='failure',description=p.identity(api.c)+':'+api.old.rsplit(':',1)[1])
  self.assertEqual(p.baseline(api,CFG,api.doc),api.old)
  api.prod[0]['description']='e'*64+':'+api.old.rsplit(':',1)[1]
  with self.assertRaises(ValueError):p.baseline(api,CFG,api.doc)
 def test_admin_merge_integrates_exact_sha_with_normal_merge(self):
  api=Fake();self.assertEqual(p.integrate(api,CFG,9),api.c)
  self.assertEqual(len(api.mutations),2);self.assertEqual(api.mutations[0][0],'/graphql');self.assertEqual(api.mutations[0][2]['variables']['id'],'SOURCE_FIXTURE');path,method,body=api.mutations[1]
  self.assertTrue(path.endswith('/pulls/7/merge'));self.assertEqual(method,'PUT');self.assertEqual(body['sha'],SHA);self.assertEqual(body['merge_method'],'merge')
  api.mutations=[];p.integrate(api,CFG,9);self.assertEqual(api.mutations,[])
 def test_gate_no_unauthorized_source_merge(self):
  for mutate in [lambda a:a.promotion['merged_by'].update(id=99),lambda a:a.promotion.update(merged=False),lambda a:a.doc.update(promotion_pr=10),lambda a:a.doc.update(version=2),lambda a:a.doc.update(app='other'),lambda a:a.doc.update(command='evil'),lambda a:a.doc.update(candidate_id='0'*64),lambda a:a.source['head'].update(sha='e'*40),lambda a:a.run.update(conclusion='failure')]:
   api=Fake();mutate(api)
   with self.assertRaises(ValueError):p.integrate(api,CFG,9)
   self.assertEqual(api.mutations,[])
 def test_duplicate_publication_preserves_first_candidate_evidence(self):
  c=value();meta={k:c[k] for k in ('sha','tree','source_run')}
  with patch.object(p,'publisher_candidates',return_value=iter([c])):
   self.assertTrue(p.already_published(None,CFG,meta))
  with patch.object(p,'publisher_candidates',return_value=iter([])):
   self.assertFalse(p.already_published(None,CFG,meta))
  with patch.object(p,'publisher_candidates',return_value=iter([dict(c,tree='0'*40)])):
   with self.assertRaisesRegex(ValueError,'previous-candidate-tree'):p.already_published(None,CFG,meta)
 def test_proposal_is_idempotent_binds_its_number_and_never_merges(self):
  class Proposal(Fake):
   def __init__(self):
    super().__init__();self.proposals=[];self.head={'version':1,'app':APP,'current_image':self.old};self.base=copy.deepcopy(self.head)
   def request(self,path,method='GET',body=None):
    if method=='GET' and '/git/ref/heads/' in path:return {'object':{'sha':TREE}} # interrupted prepare already created this ref
    if method=='GET' and '/contents/releases/' in path:return encoded(self.base if 'specops-promotions' in path else self.head)
    if method=='PUT' and '/contents/releases/' in path:self.mutations.append((path,method,body));self.head=json.loads(base64.b64decode(body['content']));return {}
    if method=='POST' and path.endswith('/pulls'):
     self.mutations.append((path,method,body));pr={'number':9,'node_id':'fixture-node','draft':True,'head':{'ref':body['head']}};self.proposals.append(pr);return pr
    if path=='/graphql':
     self.mutations.append((path,method,body));self.proposals[0]['draft']=False;return {}
    return super().request(path,method,body)
   def pages(self,path,key=None):
    if '/pulls?state=open' in path:return self.proposals
    return super().pages(path,key)
  api=Proposal();receipt=p.identity(api.c)+':'+'e'*64
  with patch.object(p,'trusted_candidate',return_value=api.c):
   doc=p.prepare_promotion(api,CFG,SHA,receipt);self.assertEqual(doc['promotion_pr'],9);self.assertEqual(api.head,doc)
   count=len(api.mutations);self.assertEqual(p.prepare_promotion(api,CFG,SHA,receipt),doc);self.assertEqual(len(api.mutations),count)
   api.base=doc;self.assertEqual(p.prepare_promotion(api,CFG,SHA,receipt),doc);self.assertEqual(len(api.mutations),count)
  self.assertFalse(any('/merge' in call[0] for call in api.mutations))
  self.assertFalse(any(call[0].endswith('/git/refs') for call in api.mutations)) # no duplicate orphan branch creation
  self.assertTrue(any(call[0]=='/graphql' for call in api.mutations))
 def test_artifact_checksum_and_size_reject_before_unpacking(self):
  from contextlib import closing
  api=p.API('synthetic-test-only');data=b'fixture archive'
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'zip'
   with patch.object(api,'open',return_value=closing(io.BytesIO(data))):
    with self.assertRaisesRegex(ValueError,'artifact-checksum'):api.archive(CFG['repository'],{'id':1,'digest':'sha256:'+'0'*64,'size_in_bytes':len(data)},path)
   self.assertEqual(path.read_bytes(),data)
   with self.assertRaisesRegex(ValueError,'artifact-size-or-checksum'):api.archive(CFG['repository'],{'id':1,'digest':'sha256:'+'0'*64,'size_in_bytes':769*1024**2},Path(temp)/'too-large')
 def test_generated_workflows_match_inline_audited_sources(self):
  with tempfile.TemporaryDirectory() as tmp:
   render(APP,tmp)
   for path in (Path(tmp)/'.github/workflows').iterdir():self.assertEqual(path.read_bytes(),(ROOT/'.github/workflows'/path.name).read_bytes())
  workflow=ROOT/'.github/workflows'/CFG['publisher_path'].rsplit('/',1)[-1]
  self.assertLessEqual(workflow.stat().st_size,128*1024)
  cfg=yaml.safe_load(workflow.read_text())
  for name,job in cfg['jobs'].items():
   self.assertIn('enabled-after-acceptance',job['if']);self.assertFalse(any('checkout@' in s.get('uses','') for s in job['steps']));self.assertFalse(any('docker build' in s.get('run','') for s in job['steps']))
   self.assertEqual(job['permissions'].get('packages'), 'write' if name=='publish' else None)
   self.assertEqual(job['permissions']['pull-requests'],'read')
   for step in job['steps']:
    if 'uses' in step:self.assertRegex(step['uses'],r'@[a-f0-9]{40}$')
  upload=next(s for s in cfg['jobs']['publish']['steps'] if 'uses' in s)
  self.assertEqual(upload['with']['retention-days'],90);self.assertEqual(upload['with']['name'],'specops-candidate-v1')

 def test_real_merged_run_provenance_uses_candidate_pr_and_immutable_job_times(self):
  fixture=json.loads((ROOT/'tests/fixtures/ci-merged-cebo.json').read_text());cfg=CONFIGS['cebo']
  class Real:
   def request(self,path,*args):
    if '/actions/runs/' in path:return fixture['run']
    if '/pulls/' in path:return fixture['pr']
    if '/actions/workflows/' in path:return {'id':fixture['run']['workflow_id']}
    if '/git/commits/' in path:return {'tree':{'sha':TREE}}
    raise AssertionError(path)
   def pages(self,path,*args,**kwargs):
    if '/attempts/' in path:return fixture['jobs']
    if '/files' in path:return [{'filename':'apps/api/src/server.ts'}]
    if '/runs?' in path:return [fixture['run']]
    raise AssertionError(path)
  api=Real();run_id=fixture['run']['id']
  self.assertEqual(p.provenance(api,cfg,run_id,open_only=False,pr_number=2)['pr'],2)
  with self.assertRaises(ValueError):p.provenance(api,cfg,run_id)
  for field,changed in [('number',99),('repository','evil/repo'),('sha','0'*40),('association',[{'number':99}]),('actor',99),('workflow',99),('closed',False),('late','2026-11-26T03:00:00Z')]:
   original=copy.deepcopy(fixture)
   if field=='number':fixture['pr']['number']=changed
   elif field=='repository':fixture['run']['head_repository']['full_name']=changed
   elif field=='sha':fixture['pr']['head']['sha']=changed
   elif field=='association':fixture['run']['pull_requests']=changed
   elif field=='actor':fixture['run']['actor']['id']=changed
   elif field=='workflow':fixture['run']['workflow_id']=changed;api_workflow=fixture['run']['workflow_id']
   elif field=='closed':fixture['pr'].update(merged=False,merged_at=None)
   elif field=='late':fixture['jobs'][0]['completed_at']=changed
   # The workflow endpoint is independent of a tampered run's workflow ID.
   if field=='workflow':
    with patch.object(api,'request',side_effect=lambda path,*args: {'id':original['run']['workflow_id']} if '/actions/workflows/' in path else Real.request(api,path,*args)):
     with self.assertRaises(ValueError):p.provenance(api,cfg,run_id,open_only=False,pr_number=2)
   else:
    with self.subTest(field=field),self.assertRaises(ValueError):p.provenance(api,cfg,run_id,open_only=False,pr_number=2)
   fixture.clear();fixture.update(original)
 def test_repeated_periodic_integration_after_merge_skips_ci_without_skipping_identity(self):
  api=Fake();p.integrate(api,CFG,9);self.assertEqual(api.run['pull_requests'],[])
  mutations=list(api.mutations);original=api.request
  def no_ci(path,*args):
   if '/actions/runs/' in path:raise AssertionError('Already integrated source re-fetched CI')
   return original(path,*args)
  with patch.object(api,'request',side_effect=no_ci):
   for _ in range(3):p.integrate_periodic(api,{APP:CFG})
  self.assertEqual(api.mutations,mutations)
  for mutate in [lambda a:a.promotion['merged_by'].update(id=99),lambda a:a.doc.update(candidate_id='0'*64),lambda a:a.source.update(number=99),lambda a:a.source['head'].update(sha='e'*40),lambda a:a.source['head']['repo'].update(full_name='evil/fork'),lambda a:a.source['user'].update(id=99)]:
   bad=Fake();p.integrate(bad,CFG,9);bad.mutations=[];mutate(bad)
   with self.assertRaises(ValueError):p.integrate_periodic(bad,{APP:CFG})
   self.assertEqual(bad.mutations,[])
 def test_periodic_retry_recovers_lost_response_after_source_merge(self):
  api=Fake();original=api.request;failed=[False]
  def interrupted(path,*args):
   if '/compare/' in path and not failed[0]:failed[0]=True;raise ValueError('temporary-network-failure')
   return original(path,*args)
  with patch.object(api,'request',side_effect=interrupted):
   with self.assertRaises(ValueError):p.integrate(api,CFG,9)
  self.assertEqual(api.run['pull_requests'],[]);mutations=list(api.mutations)
  p.integrate_periodic(api,{APP:CFG});self.assertEqual(api.mutations,mutations)
 def test_open_source_and_required_ci_cannot_drop_or_contradict_association(self):
  for refs in ([],[{'number':99}],[{'number':7},{'number':99}]):
   api=Fake();api.run['pull_requests']=refs
   with self.assertRaises(ValueError):p.provenance(api,CFG,100)
  api=Fake();original=api.pages
  def wrong_required(path,*args,**kwargs):
   rows=original(path,*args,**kwargs)
   if '/actions/workflows/' in path:
    rows[0]['pull_requests']=[]
   return rows
  with patch.object(api,'pages',side_effect=wrong_required),self.assertRaises(ValueError):p.integrate(api,CFG,9)
  self.assertEqual(api.mutations,[])
 def test_ci_helper_is_identical_to_core_when_core_is_present(self):
  core=ROOT/'specops/ci.py'
  if core.exists():self.assertEqual(core.read_bytes(),(ROOT/'specops_delivery/ci.py').read_bytes())

if __name__=='__main__':unittest.main()
