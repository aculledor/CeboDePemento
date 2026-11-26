"""CI/PR binding after GitHub clears run.pull_requests on merge.

Shared byte-for-byte with candidate producers. No network or mutable timestamps.
"""
from datetime import datetime


def ci_time(value):
    try:
        if not isinstance(value, str):
            raise ValueError()
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.utcoffset() is None:
            raise ValueError()
        return result
    except (TypeError, ValueError):
        raise ValueError('ci-timestamp') from None


def ci_association(run, pr, expected_pr, allow_merged=False):
    if type(expected_pr) is not int or type(pr['number']) is not int or pr['number'] != expected_pr:
        raise ValueError('ci-pr-number')
    refs = run['pull_requests']
    if not isinstance(refs, list) or any(type(p.get('number')) is not int for p in refs):
        raise ValueError('ci-pr-association')
    numbers = [p['number'] for p in refs]
    # An explicit contradictory association is never an empty-list fallback.
    if numbers != [expected_pr] and numbers != []:
        raise ValueError('ci-pr-association')
    if pr['state'] == 'open' and not pr.get('merged_at'):
        if numbers != [expected_pr]:
            raise ValueError('ci-pr-association')
        return False
    if not allow_merged or pr['state'] != 'closed' or pr.get('merged') is not True:
        raise ValueError('ci-pr-not-merged')
    ci_time(pr.get('merged_at'))
    return True


def ci_before_merge(run, pr, jobs):
    merged = ci_time(pr.get('merged_at'))
    created, started = ci_time(run.get('created_at')), ci_time(run.get('run_started_at'))
    attempt = run.get('run_attempt')
    if type(attempt) is not int or attempt < 1 or not created <= started <= merged:
        raise ValueError('ci-after-merge')
    if not jobs or not any(j.get('conclusion') == 'success' for j in jobs):
        raise ValueError('ci-jobs-absent')
    for job in jobs:
        if (job.get('run_id') != run['id'] or job.get('run_attempt') != attempt or
                job.get('status') != 'completed' or job.get('conclusion') not in ('success', 'skipped')):
            raise ValueError('ci-job-provenance')
        first, last = ci_time(job.get('started_at')), ci_time(job.get('completed_at'))
        if not started <= first <= last <= merged:
            raise ValueError('ci-after-merge')
