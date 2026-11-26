"""Fixed diagnostic vocabulary. Never format exceptions, commands or remote data."""
from contextlib import contextmanager
from functools import wraps
import json
import subprocess

SAFE_CODES=frozenset('api-list api-pagination-limit api-path api-size api-url artifact-checksum artifact-host artifact-redirects artifact-size artifact-size-or-checksum baseline-bootstrap baseline-image build-artifact-ambiguous build-artifact-members build-size candidate-archive-size candidate-artifact candidate-contract candidate-evidence-absent candidate-fields candidate-hashes candidate-numbers candidate-obsolete candidate-target ci-after-merge ci-job-provenance ci-jobs-absent ci-pr-association ci-pr-not-merged ci-pr-number ci-timestamp command-failed credential-file-permission dev-receipt-format github-token-missing github-unavailable hosted-fixture-only main-source-not-integrated migration-not-supported-v1 oci-platform oci-provenance output-format previous-candidate-tree previous-promotion-still-pending producer-mode promotion-admin-gate promotion-candidate promotion-dev-receipt promotion-document promotion-files promotion-format promotion-revoked proposal-branch-unavailable published-digest-changed publisher-run registry-loopback registry-rewrote-digest required-ci source-actor source-candidate-mismatch source-ci source-ci-absent source-obsolete source-outside-scope source-pr source-pr-association source-pr-not-merged source-pr-number source-pr-state source-provenance source-run source-run-id source-tree tested-image-identity tested-oci-changed trusted-integration-retry trusted-main trusted-main-first-attempt verified-input-changed workflow-repository invalid-json evidence-shape command-timeout local-io invalid-evidence internal-error'.split())
HTTP_CODES=frozenset('github-response-'+str(n) for n in (301,302,303,307,308,400,401,403,404,408,409,410,412,422,429,500,502,503,504))
STAGES=frozenset('entrypoint event-validation api-read provenance candidate-discovery artifact-metadata artifact-download artifact-checksum artifact-extract oci-inspect oci-index oci-config runtime-test registry-start registry-port registry-copy registry-inspect runtime-pull runtime-start runtime-health runtime-identity candidate-bind promotion-prepare source-integration local-command'.split())
_STACK=[]


def reason(error):
    if isinstance(error,Failure):return error.code if error.code in SAFE_CODES|HTTP_CODES else 'internal-error'
    if isinstance(error,json.JSONDecodeError):return 'invalid-json'
    if isinstance(error,subprocess.TimeoutExpired):return 'command-timeout'
    if isinstance(error,(KeyError,TypeError,IndexError)):return 'evidence-shape'
    if isinstance(error,OSError):return 'local-io'
    if type(error) is ValueError:
        # Membership in a static allowlist, never exception interpolation.
        value=str(error)
        return value if value in SAFE_CODES|HTTP_CODES else 'invalid-evidence'
    return 'internal-error'


class Failure(ValueError):
    def __init__(self,context,code):
        super().__init__(code);self.context=context;self.code=code


@contextmanager
def stage(name):
    if name not in STAGES:raise Failure(('entrypoint',),'internal-error')
    _STACK.append(name)
    try:yield
    except Failure:raise
    except Exception as error:raise Failure(tuple(_STACK),reason(error)) from None
    finally:_STACK.pop()


def diagnostic(name):
    def decorate(function):
        @wraps(function)
        def wrapped(*args,**kwargs):
            with stage(name):return function(*args,**kwargs)
        return wrapped
    return decorate


def diagnostic_record(error):
    context=error.context if isinstance(error,Failure) else ('entrypoint',)
    if not isinstance(context,tuple) or not context or any(type(s) is not str or s not in STAGES for s in context):context=('entrypoint',)
    return {'protocol':'specops-producer-v1','result':'rejected','stage':context[-1],'context':list(context),'code':reason(error)}
