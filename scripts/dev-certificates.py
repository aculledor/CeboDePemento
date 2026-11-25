#!/usr/bin/env python3
"""Issue a constrained DEV CA and leaf offline. The CA directory NEVER goes to NUC."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

HOST = "cebo-dev.home.arpa"


def run(*args):
    subprocess.run(["openssl", *args], check=True, capture_output=True)


def issue(ca_dir, tls_dir):
    ca, tls = Path(ca_dir).resolve(), Path(tls_dir).resolve()
    if ca == tls or ca.is_relative_to(tls) or tls.is_relative_to(ca):
        raise ValueError("CA and deployable TLS directories must be separate")
    for directory in (ca, tls):
        if directory.exists() and (directory.is_symlink() or any(directory.iterdir())):
            raise ValueError("Use new empty directories; existing keys are never overwritten")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ca, 0o700)
    # Directory traversal for Caddy UID/GID1000; only the leaf key is shared.
    os.chmod(tls, 0o750)
    with tempfile.TemporaryDirectory() as tmp:
        root_cfg = Path(tmp) / "root.cnf"
        root_cfg.write_text("""[req]
distinguished_name=dn
x509_extensions=ca
prompt=no
[dn]
CN=Cebo DEV restricted offline root
[ca]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
nameConstraints=critical,permitted;DNS:cebo-dev.home.arpa,excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:::/::
""")
        run("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
            "-days", "365", "-config", str(root_cfg), "-keyout", str(ca / "root.key"), "-out", str(ca / "root.crt"))
        csr = Path(tmp) / "server.csr"
        run("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
            "-subj", "/CN=" + HOST, "-keyout", str(tls / "server.key"), "-out", str(csr))
        leaf_cfg = Path(tmp) / "leaf.cnf"
        leaf_cfg.write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:" + HOST + "\n")
        run("x509", "-req", "-in", str(csr), "-CA", str(ca / "root.crt"), "-CAkey", str(ca / "root.key"),
            "-set_serial", "0x" + os.urandom(16).hex(), "-days", "30", "-extfile", str(leaf_cfg), "-out", str(tls / "server.crt"))
    (tls / "root.crt").write_bytes((ca / "root.crt").read_bytes())
    for file in ca.iterdir():
        file.chmod(0o600)
    for file in tls.iterdir():
        file.chmod(0o640 if file.suffix == ".key" else 0o644)
        if os.geteuid() == 0:
            os.chown(file, 0, 1000)
    if os.geteuid() == 0:
        os.chown(tls, 0, 1000)
    run("verify", "-CAfile", str(tls / "root.crt"), "-verify_hostname", HOST, str(tls / "server.crt"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ca-dir", required=True)
    parser.add_argument("--tls-dir", required=True)
    args = parser.parse_args()
    issue(args.ca_dir, args.tls_dir)
    print("DEV leaf verified; retain CA private key offline. No trust store modified.")
