#!/usr/bin/env python3
"""Exact inline producer implementation against hosted loopback; no GHCR/API writes."""
import os
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from specops_delivery.producer import inspect_oci,test_digest,make_candidate,candidate
from specops_delivery.render import CONFIGS

if __name__=='__main__':
    cfg=CONFIGS['cebo'];sha=os.environ['EXPECTED_SHA'];path=Path(sys.argv[1])
    digest=inspect_oci(path,cfg,sha)
    with tempfile.TemporaryDirectory(prefix='specops-cebo-fixture-') as tmp:test_digest(path,cfg,digest,tmp)
    wire=make_candidate(cfg,{'sha':sha,'tree':'b'*40,'pr':7,'source_run':100,'digest':digest},110,1)
    assert candidate(wire,cfg)['tested_digest']==digest
    print('Cebo candidate-v1 wire/digest validated synthetically; no candidate artifact or GHCR publication.')
