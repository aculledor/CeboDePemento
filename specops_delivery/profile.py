"""Generate the source section of a reviewed root profile, never install it."""
import argparse
import json
from pathlib import Path
import re
from .render import CONFIGS


def source_policy(app,source_workflow,publisher_workflow,required_workflows,publisher_blob):
 cfg=CONFIGS[app]
 if not required_workflows or any(type(x)!=int or x<=0 for x in [source_workflow,publisher_workflow,*required_workflows]):raise ValueError('Real positive workflow IDs required')
 if not re.fullmatch('[a-f0-9]{40}',publisher_blob):raise ValueError('Audited workflow Git blob required')
 return {**{k:cfg[k] for k in ('app','repository','candidate_paths','publisher_path')},'authors':[45120213],'publishers':[45120213],'admins':[45120213],'source_workflow':source_workflow,'publisher_workflow':publisher_workflow,'required_workflows':required_workflows,'publisher_blob_shas':[publisher_blob]}

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--app',choices=CONFIGS,required=True);p.add_argument('--source-workflow',type=int,required=True);p.add_argument('--publisher-workflow',type=int,required=True);p.add_argument('--required-workflows',type=int,nargs='+',required=True);p.add_argument('--publisher-blob',required=True);p.add_argument('--output',required=True)
 a=p.parse_args();value=source_policy(a.app,a.source_workflow,a.publisher_workflow,a.required_workflows,a.publisher_blob)
 with Path(a.output).open('x',opener=lambda path,flags:__import__('os').open(path,flags,0o600)) as f:json.dump(value,f,indent=2)
