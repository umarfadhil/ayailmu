"""Shared fixtures for the infra tests: manifests, DSN files, CLI runner, Go builds. No secret is ever printed."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent / "supabase_target.py"
REPO = HERE.parents[2]  # the clone root
sys.path.insert(0, str(HERE))


def run_tool(*args: str, env_extra: dict | None = None, cwd: str | None = None) -> subprocess.CompletedProcess:
    env = {"PATH": "/usr/bin:/bin:/opt/homebrew/bin"} | (env_extra or {})
    return subprocess.run([sys.executable, "-I", str(TOOL), *args], capture_output=True, text=True, env=env, cwd=cwd, timeout=600)


def write_json(path: Path, doc: dict) -> Path:
    path.write_text(json.dumps(doc, indent=2))
    return path


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def private_file(path: Path, content: str, mode: int = 0o600) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(content + "\n")
    os.chmod(path, mode)
    return path


# --- complete, fabricated Supabase-kind manifests (no real project; hosts are never resolved or contacted) --------------
UMAR_REF, AYA_REF, UMAR_AUTH_REF, AYA_AUTH_REF = ("umarprojectref00000a", "ayaprojectref000001b",
                                                  "umarauthref000000002", "ayaauthref0000000003")
assert all(len(r) == 20 for r in (UMAR_REF, AYA_REF, UMAR_AUTH_REF, AYA_AUTH_REF)), "fixture refs must be 20 chars"


def supabase_manifest(app: str, base: Path, ca: Path) -> dict:
    """A syntactically complete manifest for `app`; every value is fabricated and none resolves or is contacted."""
    umar = app == "umar"
    ref = UMAR_REF if umar else AYA_REF
    pre = "umar_" if umar else "aya_"
    doc = {
        "schema_version": 1, "app": app, "status": "draft", "kind": "supabase",
        "organization": {"slug": "fixture-org", "plan": "free"},
        "project": {"ref": ref, "region": "ap-southeast-1", "postgres_major": 17},
        "database": {
            "connection_mode": "direct", "host": f"db.{ref}.supabase.co", "port": 5432, "name": "postgres",
            "schema": "public" if umar else "ayailmu",
            "tls": {"sslmode": "verify-full", "root_ca_file": str(ca), "root_ca_sha256": sha256_file(ca)},
        },
        "roles": {"migration": pre + "migrator", "runtime": pre + "runtime"},
        "secrets": {"migration_dsn_file": str(base / f"{app}-migration.dsn"), "runtime_dsn_file": str(base / f"{app}-runtime.dsn")},
        "data_api": {"disabled_confirmed_by_owner": True},
        "auth": {
            "provider": "standalone-gotrue", "audience": "authenticated",
            "public_origin": f"https://auth.{app}-fixture.net", "issuer": f"https://auth.{app}-fixture.net",
            # The supported topology: a separate, self-hosted identity PostgreSQL that keeps the vendor's `auth` namespace.
            "database": {"placement": "self-hosted-postgres", "instance_id": f"{app}-identity-db", "name": f"{app}_identity",
                         "namespace": "auth", "role": pre + "gotrue"},
            "smtp": {"provider": "fixture-smtp"},
        },
        "runtime": {"host_platform": "fixture-vm"},
        "backup": {"strategy": "fixture-policy"},
        "approvals": {"project_creation": "pending", "credential_provisioning": "pending", "dashboard_changes": "pending",
                      "migration": "pending", "verify": "pending", "runtime_start": "pending"},
    }
    if umar:
        doc["runtime"] |= {"listen": "127.0.0.1:8187"}
        doc["auth"]["jwks_url"] = "http://127.0.0.1:8287/.well-known/jwks.json"
    else:
        doc["runtime"] |= {"listen": "0.0.0.0:8080", "allowed_hosts": ["api.ayangaji-fixture.net"],
                           "cors_origins": ["https://app.ayangaji-fixture.net"], "trusted_proxies": ["203.0.113.10"]}
        doc["auth"]["supabase_url"] = "https://auth.ayangaji-fixture.net:9443"
        doc["secrets"]["admin_key_file"] = str(base / "aya-admin.key")
    return doc


def hosted_identity(doc: dict, placement: str = "dedicated-project") -> dict:
    """The earlier hosted topologies (a Supabase identity project, or a schema inside the application project). The pinned
    GoTrue v2.197.0 cannot run in a custom namespace on them (real probe: 42501), so the validator refuses them."""
    out = copy.deepcopy(doc)
    umar = out["app"] == "umar"
    ident = out["auth"]["database"]
    for key in ("instance_id", "name"):
        ident.pop(key, None)
    ident["placement"] = placement
    ident["namespace"] = "gotrue_umar" if umar else "gotrue_aya"
    ident["project_ref"] = (UMAR_AUTH_REF if umar else AYA_AUTH_REF) if placement == "dedicated-project" else out["project"]["ref"]
    if placement == "same-project-dedicated-schema":
        ident["accepts_shared_failure_domain"] = True
    return out


def local_manifest(app: str, base: Path, ca: Path, port: int, db: str, schema: str, migration: str, runtime: str) -> dict:
    return {
        "schema_version": 1, "app": app, "status": "local-test", "kind": "local-test",
        "database": {"host": "localhost", "port": port, "name": db, "schema": schema,
                     "tls": {"sslmode": "verify-full", "root_ca_file": str(ca), "root_ca_sha256": sha256_file(ca)}},
        "roles": {"migration": migration, "runtime": runtime},
        "secrets": {"migration_dsn_file": str(base / f"{app}-migration.dsn"), "runtime_dsn_file": str(base / f"{app}-runtime.dsn")},
        "approvals": {},
    }


def mutate(doc: dict, dotted: str, value) -> dict:
    out = copy.deepcopy(doc)
    cur = out
    parts = dotted.split(".")
    for p in parts[:-1]:
        cur = cur[p]
    if value is DELETE:
        cur.pop(parts[-1], None)
    else:
        cur[parts[-1]] = value
    return out


DELETE = object()


def go_build(module_dir: Path, out: Path, pkg: str) -> Path:
    env = dict(os.environ)
    r = subprocess.run(["go", "build", "-trimpath", "-o", str(out), pkg], cwd=module_dir, env=env, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("go build failed: " + r.stderr[-800:])
    return out
