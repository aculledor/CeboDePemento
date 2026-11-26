"""Docker COPY coverage and rename-aware candidate scope; no network or Docker."""
import json
from pathlib import Path, PurePosixPath
import re
import shlex


def matches(path, scopes):
    return any(path == s or s.endswith('/') and path.startswith(s) for s in scopes)


def affected(files, scopes):
    return any(matches(f.get(k,''), scopes) for f in files for k in ('filename','previous_filename'))


def build_inputs(dockerfile, context):
    context=context.rstrip('/')
    prefix=context+'/' if context and context!='.' else ''
    result=[prefix+'Dockerfile',prefix+'.dockerignore']
    text=re.sub(r'\\\n',' ',Path(dockerfile).read_text())
    for line in text.splitlines():
        if not re.match(r'^\s*(COPY|ADD)\s',line,re.I):continue
        body=line.strip().split(None,1)[1]
        if body.startswith('--from='):continue
        while body.startswith('--'):body=body.split(None,1)[1]
        parts=json.loads(body) if body.startswith('[') else shlex.split(body)
        for value in parts[:-1]:
            if '://' in value or '..' in PurePosixPath(value).parts:raise ValueError('Unreviewed external build input')
            value=value.removeprefix('./')
            if value in ('','.'):result.append(prefix)
            else:result.append(prefix+value.rstrip('/'))
    return result


def verify(dockerfile, context, scopes):
    for value in build_inputs(dockerfile,context):
        # COPY . means the entire context, including future files, is input.
        if not value or value.endswith('/'):
            if not any(s.endswith('/') and value.startswith(s) for s in scopes):raise ValueError('Uncovered COPY context: '+value)
        elif not matches(value,scopes) and value+'/' not in scopes:
            raise ValueError('Uncovered COPY input: '+value)
