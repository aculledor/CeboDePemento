"""Generate pinned, self-contained GitHub workflows. Never invoked by write jobs."""
from pathlib import Path
import json
import yaml
from .bundle import bundle

class LiteralDumper(yaml.SafeDumper):
    pass
LiteralDumper.add_representer(str, lambda dumper, value: dumper.represent_scalar('tag:yaml.org,2002:str', value, style='|' if '\n' in value else None))

CHECKOUT='actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'
UPLOAD='actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
PUBLISHER_BUDGET=96*1024
APP_TOKEN='actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349'
CONFIGS={
 'portal':{'app':'portal','repository':'aculledor/servidor-casa','image':'ghcr.io/aculledor/servidor-casa-portal-dev','source_path':'.github/workflows/portal.yml','publisher_path':'.github/workflows/portal-specops.yml','build_artifact':'specops-portal-build-v1','schema':1,'port':3000,'health':'/healthz','required_workflows':['.github/workflows/portal.yml','.github/workflows/panel.yml','.github/workflows/validar.yml','.github/workflows/specops.yml']},
 'cebo':{'app':'cebo','repository':'aculledor/CeboDePemento','image':'ghcr.io/aculledor/cebo-de-pemento-dev','source_path':'.github/workflows/ci-ghcr.yml','publisher_path':'.github/workflows/cebo-specops.yml','build_artifact':'specops-cebo-build-v1','schema':0,'frozen_paths':['apps/api/migrations/'],'port':3001,'health':'/api/health','required_workflows':['.github/workflows/ci-ghcr.yml']}}

for _app, _cfg in CONFIGS.items():
 _scope=Path(__file__).with_name(_app+'-scope.json')
 if _scope.exists():_cfg['candidate_paths']=json.loads(_scope.read_text())


def inline(config, mode):
 return "python3 - <<'SPECOPS_INLINE'\n"+bundle(config,mode)+"\nSPECOPS_INLINE"


def step(config,mode,**extra):
 return {'name':mode+' — fixed inline protocol','env':{'GH_TOKEN':'${{ github.token }}','SPECOPS_MODE':mode,**extra.pop('env',{})},'run':inline(config,mode),**extra}


def publisher(app):
 c=CONFIGS[app]
 condition="github.ref == 'refs/heads/main' && github.run_attempt == 1 && vars.SPECOPS_REAL_PUBLICATION == 'enabled-after-acceptance' && (github.event_name != 'workflow_run' || (github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_repository.full_name == github.repository && github.event.workflow_run.actor.id == 45120213))"
 verify={'if':condition,'runs-on':'ubuntu-24.04','timeout-minutes':20,'permissions':{'contents':'read','actions':'read','pull-requests':'read'},'outputs':{k:'${{ steps.verified.outputs.'+k+' }}' for k in ('digest','artifact_id','artifact_digest','already_published')},'steps':[
  {'run':'sudo apt-get update -qq && sudo apt-get install -y skopeo'},step(c,'verify',id='verified')]}
 verified={'VERIFIED_DIGEST':'${{ needs.verify.outputs.digest }}','VERIFIED_ARTIFACT_ID':'${{ needs.verify.outputs.artifact_id }}','VERIFIED_ARTIFACT_DIGEST':'${{ needs.verify.outputs.artifact_digest }}'}
 publish={'if':condition+" && needs.verify.outputs.already_published != 'true'",'needs':'verify','runs-on':'ubuntu-24.04','timeout-minutes':20,'permissions':{'contents':'read','actions':'read','pull-requests':'read','packages':'write'},'steps':[
  {'run':'sudo apt-get update -qq && sudo apt-get install -y skopeo'},step(c,'fetch',id='input',env=verified),
  {'name':'Login only in copy-only job','env':{'GHCR_TOKEN':'${{ github.token }}'},'run':"set -euo pipefail\numask 077\nprintf '%s' \"$GHCR_TOKEN\" | skopeo login --authfile \"$RUNNER_TEMP/specops-auth.json\" --username \"$GITHUB_ACTOR\" --password-stdin ghcr.io >/dev/null 2>&1 || { echo 'SpecOps stage=ghcr-login code=command-failed' >&2; exit 1; }"},
  {'name':'Copy tested OCI without execution or rebuild','id':'copy','env':{'EXPECTED':'${{ needs.verify.outputs.digest }}','OCI_PATH':'${{ steps.input.outputs.oci_path }}'},'run':f'''set -euo pipefail
umask 077
[[ "$EXPECTED" =~ ^sha256:[0-9a-f]{{64}}$ && "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]]
ref="{c['image']}:candidate-$GITHUB_RUN_ID"
skopeo copy --all --preserve-digests --authfile "$RUNNER_TEMP/specops-auth.json" "oci-archive:$OCI_PATH" "docker://$ref" >/dev/null 2>&1 || {{ echo 'SpecOps stage=ghcr-copy code=command-failed' >&2; exit 1; }}
skopeo inspect --raw --authfile "$RUNNER_TEMP/specops-auth.json" "docker://$ref" > "$RUNNER_TEMP/remote-index.json" 2>/dev/null || {{ echo 'SpecOps stage=ghcr-inspect code=command-failed' >&2; exit 1; }}
actual="sha256:$(sha256sum "$RUNNER_TEMP/remote-index.json" | cut -d' ' -f1)"
[[ "$actual" == "$EXPECTED" ]] || {{ echo 'SpecOps stage=ghcr-digest code=published-digest-changed' >&2; exit 1; }}
printf 'digest=%s\\n' "$actual" >> "$GITHUB_OUTPUT"
'''},step(c,'candidate',id='candidate',env={**verified,'REMOTE_DIGEST':'${{ steps.copy.outputs.digest }}'}),
  {'uses':UPLOAD,'with':{'name':'specops-candidate-v1','path':'${{ steps.candidate.outputs.candidate_path }}','retention-days':90,'if-no-files-found':'error'}},
  {'name':'Remove only ephemeral registry credential','if':'always()','run':'rm -f -- "$RUNNER_TEMP/specops-auth.json"'}]}
 return {'name':'SpecOps '+app+' — trusted digest publisher (disabled until acceptance)','on':{'workflow_run':{'workflows':['Portal Familiar — calidad, seguridad e identidad aislada' if app=='portal' else 'Validar y publicar Cebo de Pemento AMD64'],'types':['completed']},'workflow_dispatch':{'inputs':{'source_run':{'required':True,'type':'string','description':'Completed internal PR CI run; create a NEW publisher run, never rerun'}}}},'permissions':{'contents':'read'},'concurrency':{'group':'specops-publisher-'+app,'cancel-in-progress':False},'jobs':{'verify':verify,'publish':publish}}


def token_step():
 return {'uses':APP_TOKEN,'id':'control','with':{'app-id':'${{ vars.SPECOPS_APP_ID }}','private-key':'${{ secrets.SPECOPS_APP_PRIVATE_KEY }}','owner':'aculledor','repositories':'servidor-casa\nCeboDePemento','permission-contents':'write','permission-pull-requests':'write','permission-actions':'read','permission-statuses':'read'}}


def promotion(app):
 c=CONFIGS[app]
 return {'name':'SpecOps '+app+' — prepare single-approval promotion','on':{'status':{},'workflow_dispatch':{},'schedule':[{'cron':'*/5 * * * *'}]},'permissions':{'contents':'read'},'concurrency':{'group':'specops-promotion-'+app,'cancel-in-progress':False},'jobs':{'prepare':{'if':"vars.SPECOPS_RELEASE_AUTOMATION == 'enabled-after-acceptance' && (github.event_name != 'status' || (github.event.state != 'pending' && (github.event.context == 'specops/dev/"+app+"' || github.event.context == 'specops/prod/"+app+"')))",'runs-on':'ubuntu-24.04','timeout-minutes':10,'steps':[token_step(),step(c,'prepare',env={'GH_TOKEN':'${{ steps.control.outputs.token }}'})]}}}


def integrator():
 return {'name':'SpecOps — integrate exact source after administrative promotion merge','on':{'pull_request_target':{'types':['closed'],'branches':['specops-promotions/portal','specops-promotions/cebo']},'schedule':[{'cron':'*/5 * * * *'}],'workflow_dispatch':{}},'permissions':{'contents':'read'},'concurrency':{'group':'specops-integrate','cancel-in-progress':False},'jobs':{'integrate':{'if':"(github.event_name != 'pull_request_target' || github.event.pull_request.merged == true) && vars.SPECOPS_RELEASE_AUTOMATION == 'enabled-after-acceptance'",'runs-on':'ubuntu-24.04','timeout-minutes':10,'steps':[token_step(),step(CONFIGS,'integrate',env={'GH_TOKEN':'${{ steps.control.outputs.token }}'})]}}}


def render(app, root):
 root=Path(root);folder=root/'.github/workflows';folder.mkdir(parents=True,exist_ok=True)
 files={app+'-specops.yml':publisher(app),app+'-promotion.yml':promotion(app)}
 if app=='portal':files['specops-integrate.yml']=integrator()
 for name,value in files.items():
  text='# Generated by specops_delivery/render.py; privileged runtime is entirely inline.\n'+yaml.dump(value,Dumper=LiteralDumper,sort_keys=False,allow_unicode=True,width=120)
  if name==app+'-specops.yml' and len(text.encode('utf-8'))>PUBLISHER_BUDGET:
   raise ValueError('publisher-budget-96-kib')
  (folder/name).write_text(text)


if __name__=='__main__':
 import sys
 render(sys.argv[1],sys.argv[2] if len(sys.argv)>2 else '.')
