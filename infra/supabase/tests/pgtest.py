"""Disposable loopback PostgreSQL + TLS for infra tests. Never touches an existing cluster, database or credential.

Everything lives under a fresh /tmp directory (mode 0700) that is removed on exit, including on SIGINT/SIGTERM.
The server listens on 127.0.0.1 (a free high port) and on a 0700 Unix socket directory only; the TLS certificate is
issued by a throwaway CA for DNS:localhost / IP:127.0.0.1. Roles created here are ephemeral LOGIN roles with random
passwords that exist only in this cluster and in 0600 files inside the temp directory.
"""
from __future__ import annotations

import atexit
import os
import secrets
import shutil
import signal
import socket
import subprocess
from pathlib import Path

PG_BIN = Path(os.environ.get("PG_BIN", "/Applications/Postgres.app/Contents/Versions/16/bin"))
ADMIN = "infra_admin"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Cluster:
    def __init__(self) -> None:
        # Hex-only name: random suffixes must never resemble a manifest placeholder word.
        self.root = Path("/tmp") / f"infra-pg.{secrets.token_hex(6)}"
        self.root.mkdir(mode=0o700)
        self.data = self.root / "data"
        self.sock = self.root / "s"
        self.sock.mkdir(mode=0o700)
        self.port = free_port()
        self.log = self.root / "server.log"
        self.ca = self.root / "ca.pem"
        self.started = False
        atexit.register(self.stop)
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: (self.stop(), os._exit(130)))

    # -- lifecycle ---------------------------------------------------------------------------------------------------------
    def _tls(self) -> tuple[Path, Path]:
        key, crt, cakey = self.root / "server.key", self.root / "server.crt", self.root / "ca.key"
        ext = self.root / "san.cnf"
        ext.write_text("subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n")
        run = lambda *a: subprocess.run(a, check=True, capture_output=True)  # noqa: E731
        openssl = shutil.which("openssl") or "/opt/homebrew/bin/openssl"
        run(openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(cakey), "-out", str(self.ca),
            "-days", "2", "-subj", "/CN=infra throwaway CA")
        run(openssl, "req", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(self.root / "server.csr"),
            "-subj", "/CN=localhost")
        run(openssl, "x509", "-req", "-in", str(self.root / "server.csr"), "-CA", str(self.ca), "-CAkey", str(cakey),
            "-CAcreateserial", "-out", str(crt), "-days", "2", "-extfile", str(ext))
        for p in (key, cakey):
            os.chmod(p, 0o600)
        return key, crt

    def start(self) -> "Cluster":
        key, crt = self._tls()
        subprocess.run([str(PG_BIN / "initdb"), "-D", str(self.data), "-U", ADMIN, "--auth-local=trust",
                        "--auth-host=scram-sha-256", "--no-locale", "-E", "UTF8"], check=True, capture_output=True)
        opts = (f"-h 127.0.0.1 -p {self.port} -k {self.sock} -c unix_socket_permissions=0700 -c ssl=on "
                f"-c ssl_cert_file={crt} -c ssl_key_file={key} -c log_connections=on -c log_disconnections=off "
                f"-c fsync=off -c max_connections=40")
        subprocess.run([str(PG_BIN / "pg_ctl"), "-D", str(self.data), "-l", str(self.log), "-o", opts, "-w", "start"],
                       check=True, capture_output=True)
        self.started = True
        return self

    def stop(self) -> None:
        if self.started:
            subprocess.run([str(PG_BIN / "pg_ctl"), "-D", str(self.data), "-m", "immediate", "-w", "stop"],
                           capture_output=True)
            self.started = False
        shutil.rmtree(self.root, ignore_errors=True)

    # -- administration (over the private Unix socket, trust auth for the OS user only) -------------------------------------
    def psql(self, sql: str | None = None, *, db: str = "postgres", file: str | None = None, user: str = ADMIN,
             variables: dict[str, str] | None = None, check: bool = True) -> subprocess.CompletedProcess:
        cmd = [str(PG_BIN / "psql"), "-X", "-q", "-A", "-t", "-F", "|", "-v", "ON_ERROR_STOP=1",
               "-h", str(self.sock), "-p", str(self.port), "-U", user, "-d", db]
        for k, v in (variables or {}).items():
            cmd += ["-v", f"{k}={v}"]
        cmd += ["-f", file] if file else ["-c", sql]
        env = {"PATH": "/usr/bin:/bin", "PGCONNECT_TIMEOUT": "10"}
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
        if check and r.returncode != 0:
            raise RuntimeError(f"psql failed: {r.stderr.strip()[:500]}")
        return r

    def scalar(self, sql: str, db: str = "postgres") -> str:
        return self.psql(sql, db=db).stdout.strip()

    def create_database(self, name: str) -> None:
        self.psql(f'CREATE DATABASE "{name}"')

    def new_password(self) -> str:
        return secrets.token_hex(16)

    def connection_count(self, role: str) -> int:
        """Server-side evidence of connections by `role` (log_connections=on)."""
        text = self.log.read_text(errors="replace") if self.log.exists() else ""
        return text.count(f'user={role} ') + text.count(f'user={role},') + text.count(f"user={role}\n")

    # -- DSN files (secret material stays in 0600 files inside the temp directory) -----------------------------------------
    def dsn(self, user: str, password: str, db: str, *, host: str = "localhost", sslmode: str = "verify-full",
            rootcert: bool = True) -> str:
        q = f"sslmode={sslmode}"
        if rootcert:
            q += f"&sslrootcert={self.ca}"
        return f"postgres://{user}:{password}@{host}:{self.port}/{db}?{q}"

    def write_secret(self, name: str, content: str) -> Path:
        d = self.root / "secrets"
        d.mkdir(mode=0o700, exist_ok=True)
        p = d / name
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(content + "\n")
        return p
