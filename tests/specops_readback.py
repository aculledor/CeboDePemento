#!/usr/bin/env python3
"""Read-only reproduction of real bootstrap inputs; never a publisher/candidate.

Only fixed, public stage/status codes reach logs. No raw exception, URL, HTTP
headers, subprocess output or artifact/application content is printed.
"""
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import urllib.error
import urllib.parse

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from specops_delivery import producer as p
from specops_delivery.render import CONFIGS

APP='portal' if (Path(__file__).resolve().parents[1]/'apps/portal').exists() else 'cebo'
SOURCE={'portal':45903242249,'cebo':45903253447}
CURRENT='startup'
CODES=frozenset('github-unavailable api-pagination-limit artifact-redirects api-size api-path api-url artifact-host api-list artifact-size-or-checksum artifact-size artifact-checksum build-artifact-ambiguous build-artifact-members build-size source-pr-association source-pr-number source-pr source-pr-state source-pr-not-merged source-obsolete source-provenance source-actor source-ci source-run-id source-tree source-outside-scope migration-not-supported-v1 ci-pr-association ci-pr-not-merged ci-after-merge ci-job-provenance ci-jobs-absent ci-timestamp oci-platform oci-provenance command-failed hosted-fixture-only registry-loopback registry-rewrote-digest tested-image-identity previous-candidate-tree candidate-archive-size'.split())
HTTP=frozenset((200,201,204,301,302,303,304,307,308,400,401,403,404,408,410,422,429,500,502,503,504))


def emit(event,**fields):print(json.dumps({'probe':'specops-readback-v1','event':event,**fields},sort_keys=True),flush=True)


def phase(name):
    global CURRENT
    CURRENT=name;emit('stage',stage=name)


class Opener:
    def __init__(self,wrapped):self.wrapped=wrapped
    def open(self,request,**kwargs):
        # The original production opener performs ALL URL/host checks unchanged.
        kind='github-api' if urllib.parse.urlsplit(request.full_url).hostname=='api.github.com' else 'artifact-storage'
        try:
            result=self.wrapped.open(request,**kwargs)
            emit('http',target=kind,status=result.status if result.status in HTTP else 'other')
            return result
        except urllib.error.HTTPError as error:
            emit('http',target=kind,status=error.code if error.code in HTTP else 'other');raise


class ReadAPI(p.API):
    def __init__(self,token):
        super().__init__(token);self.opener=Opener(self.opener)
    def request(self,path,method='GET',body=None):
        if method!='GET' or body is not None:raise ValueError('read-only-probe')
        return super().request(path,method,body)


# Static classifications only. Process output is inspected in memory and never
# printed, serialized or uploaded, including on an unknown error.
ORIGINAL_PROCESS_RUN=p.subprocess.run

def observed_process(*args,**kwargs):
    result=ORIGINAL_PROCESS_RUN(*args,**kwargs)
    if result.returncode:
        text=(result.stderr or '').lower()
        codes=(('auth.json','credential-file'),('permission denied','permission-denied'),
               ('operation not permitted','operation-not-permitted'),
               ('http response to https client','registry-tls'),('x509:','registry-certificate'),
               ('connection refused','registry-unavailable'),('unauthorized','registry-auth'),
               ('toomanyrequests','registry-rate-limit'),('unsupported','unsupported-format'),
               ('no such file','missing-local-input'),('digest','digest-preservation'))
        matched=[code for needle,code in codes if needle in text]
        emit('command-rejected',code=matched[0] if matched else 'unclassified-command',
             categories=matched,exit=result.returncode if result.returncode in (1,2,125,126,127,137,-9,-15) else 'other')
    return result

p.subprocess.run=observed_process

# Static command phases only; arguments and subprocess output never reach logs.
ORIGINAL_RUN=p.run

def observed_run(args,raw=False,**kwargs):
    command='local-command'
    if args[:2]==['skopeo','copy']:command='registry-copy'
    elif args[:2]==['skopeo','inspect']:command='registry-inspect' if any(a.startswith('docker://') for a in args) else 'oci-inspect'
    elif args[:2]==['docker','run']:command='registry-start' if 'registry:2.8.3' in args else 'runtime-start'
    elif args[:2]==['docker','port']:command='registry-port'
    elif args[:2]==['docker','pull']:command='runtime-pull'
    elif args[:2]==['docker','exec']:command='runtime-health'
    elif args[:3]==['docker','image','inspect']:command='runtime-identity'
    emit('command',stage=command)
    return ORIGINAL_RUN(args,raw=raw,**kwargs)

p.run=observed_run

def main():
    if not (os.environ.get('CI')=='true' and os.environ.get('GITHUB_ACTIONS')=='true' and
            os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted' and os.uname().nodename!='nuc-cas'):
        raise ValueError('hosted-fixture-only')
    cfg=CONFIGS[APP];api=ReadAPI(os.environ['GH_TOKEN']);source=SOURCE[APP]
    phase('provenance');meta=p.provenance(api,cfg,source)
    phase('candidate-discovery');duplicate=p.already_published(api,cfg,meta)
    emit('duplicate-check',already_published=duplicate)
    phase('artifact-metadata');artifact=p.build_artifact(api,cfg,source)
    with tempfile.TemporaryDirectory(prefix='specops-readback-') as tmp:
        phase('artifact-download');archive=api.archive(cfg['repository'],artifact,Path(tmp)/'input.zip')
        phase('artifact-extract');path=p.extract_build(archive,tmp)
        phase('oci-inspect');digest=p.inspect_oci(path,cfg,meta['sha'])
        # No further API access; code under test receives no GitHub credential.
        api.token='';os.environ.pop('GH_TOKEN',None)
        phase('oci-runtime');p.test_digest(path,cfg,digest,tmp)
        phase('oci-recheck');p.require(p.inspect_oci(path,cfg,meta['sha'])==digest,'tested-oci-changed')
    emit('success',stage='complete',candidate_created=False,published=False)


if __name__=='__main__':
    try:main()
    except Exception as error:
        text=str(error) if type(error) is ValueError else ''
        code=text if text in CODES or text in {'github-response-'+str(s) for s in HTTP} else 'unclassified-error'
        emit('rejected',stage=CURRENT,code=code)
        raise SystemExit(1)
