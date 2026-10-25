#!/usr/bin/env python3
"""Supabase PostgreSQL target manifest validator and one-shot migration/verification wrapper.

Run as:  python3 -I infra/supabase/supabase_target.py <command> ...

Commands (none connects unless it is `migrate --execute` or `verify --execute`):
  validate  MANIFEST [--peer OTHER] [--check-files] [--allow-local-test]
  inventory MANIFEST [--json]
  dsn-check MANIFEST --role migration|runtime [--dsn-file PATH]
  render-env MANIFEST --role migration|runtime
  migrate   MANIFEST --migrate-bin PATH [--execute --confirm-project REF]
  verify    MANIFEST --role migration|runtime [--execute --confirm-project REF]

Safety properties (each is tested):
  * A connection string lives only in a private file; it is never printed, logged, put in argv or
    written anywhere. Output is scanned for its password before printing.
  * Incomplete, placeholder, example, mixed-app, mixed-project and mixed-identity manifests are refused.
  * The default of `migrate` and `verify` is a dry run that opens no network or database connection.
  * Remote execution needs status=owner-approved, an exact recorded approval and --confirm-project.
  * Only stdlib; the file is byte-identical in the Umar and Ayangaji clones (a test compares digests).
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

HERE = Path(__file__).resolve().parent
SCHEMA_VERSION = 1

# --- per-app identity -------------------------------------------------------------------------------------------------
# Mirrors source guards that cannot be loosened here: Umar's store fixes `public` (search_path "public, pg_temp" and the
# runtime privilege check); the adult store refuses `public`, `information_schema` and `pg_*` (backend/internal/store).
APPS = {
    "umar": {"role_prefix": "umar_", "fixed_schema": "public", "sql_dir": "umar"},
    "ayangaji": {"role_prefix": "aya_", "fixed_schema": None, "sql_dir": "ayangaji"},
}
# Schemas that a hosted Supabase project owns; a standalone GoTrue or the adult app must never claim them.
SUPABASE_RESERVED_SCHEMAS = {
    "auth", "storage", "realtime", "extensions", "graphql", "graphql_public", "vault", "pgsodium", "pgsodium_masks",
    "net", "cron", "pgbouncer", "supabase_functions", "supabase_migrations", "_realtime", "_analytics", "pgtle",
    "information_schema", "public",
}
SUPABASE_RESERVED_ROLES = {
    "postgres", "anon", "authenticated", "service_role", "authenticator", "pgbouncer", "dashboard_user",
    "supabase_admin", "supabase_auth_admin", "supabase_storage_admin", "supabase_read_only_user",
    "supabase_replication_admin", "supabase_etl_admin", "pgsodium_keyholder", "pgsodium_keyiduser",
    "pgsodium_keymaker", "supabase_realtime_admin", "supabase_functions_admin", "pg_monitor", "public",
}
# Identity database placement. The pinned GoTrue v2.197.0 migration 00_init_auth_schema.up.sql hard-codes `auth.users`, so it
# cannot run in a custom GOTRUE_DB_NAMESPACE against a protected `auth` schema (a real probe failed with 42501 and left the
# application sentinels intact; a control with a separate identity database, namespace `auth` and a dedicated non-admin role
# succeeded). The only supported topology is therefore a separate self-hosted PostgreSQL database that keeps `auth`.
SELF_HOSTED_PLACEMENT = "self-hosted-postgres"
HOSTED_IDENTITY_PLACEMENTS = ("dedicated-project", "same-project-dedicated-schema")  # recognised only to be refused
VENDOR_NAMESPACE = "auth"
SELF_HOSTED_IDENTITY_KEYS = {"placement", "instance_id", "name", "namespace", "role"}
HOSTED_ONLY_IDENTITY_KEYS = {"project_ref", "accepts_shared_failure_domain"}
INSTANCE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
IDENTITY_DB_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
RESERVED_DATABASE_NAMES = {"postgres", "template0", "template1"}
CONNECTION_URL_RE = re.compile(r"(?i)\bpostgres(?:ql)?://")
API_ROLES = ("anon", "authenticated", "service_role")  # Supabase Data API roles; the Postgres-only design grants them nothing.

REF_RE = re.compile(r"^[a-z0-9]{20}$")
REGION_RE = re.compile(r"^[a-z]{2}(?:-[a-z]+)+-[0-9]{1,2}$")
ROLE_RE = re.compile(r"^[a-z][a-z0-9_]{2,47}$")
SCHEMA_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
HOST_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
DATE_RE = r"[0-9]{4}-[0-9]{2}-[0-9]{2}"
PLACEHOLDER_RE = re.compile(
    r"(?i)(replace|placeholder|change-?me|todo|tbd|your-|\[[A-Z_-]+\]|<[A-Za-z_-]+>|xxxx|dummy|sample|\.example\b|"
    r"\.invalid\b|\.test\b|example\.(com|org|net)|^password$|^secret$)")
WEAK_PASSWORD_RE = re.compile(r"(?i)(your-?password|change-?me|placeholder|replace|^password|^secret|^example)")
NON_PUBLIC_TLDS = {"localhost", "local", "test", "invalid", "example", "onion", "alt", "arpa", "internal", "intranet",
                   "private", "corp", "home", "lan", "localdomain"}
DSN_QUERY_ALLOWED = {"sslmode", "sslrootcert", "connect_timeout", "application_name"}

# Decision identifiers: every open owner decision has one stable ID, referenced by `UNDECIDED:Dnn` sentinels.
DECISIONS = {
    "D01": "Supabase organization to use (existing free organization, or another)",
    "D02": "Project name/ref for this app (one dedicated project per app; creation needs exact approval)",
    "D03": "Region of the project and of the runtime host",
    "D04": "Plan (free vs paid: backups/PITR, pausing, IPv4 add-on, dedicated pooler availability)",
    "D05": "Connection path: direct (IPv6 or IPv4 add-on) vs shared session pooler (IPv4); never transaction mode",
    "D06": "Approved migration and runtime role names (created by the owner, never by default tooling)",
    "D07": "Where private DSN files live, who provisions and rotates them",
    "D08": "Self-hosted PostgreSQL for the standalone GoTrue identity database (instance id, database name, role); "
           "the vendor `auth` namespace is kept and hosted Supabase placements are unsupported",
    "D09": "Public domain, TLS termination and issuer URL of the standalone GoTrue",
    "D10": "SMTP provider, sender domain (SPF/DKIM/DMARC) and templates for GoTrue mail",
    "D11": "Supabase server root CA file (downloaded from Database settings) and its pinned SHA-256",
    "D12": "Backup, restore-test, retention and deletion-replay policy",
    "D13": "Owner confirms the Data API is disabled in the dashboard (proposal only; never applied by tooling)",
    "D14": "Runtime host/platform for the Go API and GoTrue (needs IPv6 egress for direct, or the session pooler)",
    "D15": "PostgreSQL major version of the project versus local tests (local binaries here are 16)",
    "D16": "Ayangaji staging web CORS origin(s) and trusted proxy addresses (production mode refuses native-only)",
    "D17": "Ayangaji schema name (code default `ayailmu` predates the Ayangaji name; renaming later is a data migration)",
    "D18": "Admin credential for the adult API's GoTrue admin calls: source, scope and rotation",
}


# Every field that must be present as a string in a supabase-kind manifest, with the decision that fills it.
REQUIRED_STRINGS = {
    "organization.slug": "D01", "organization.plan": "D04", "project.ref": "D02", "project.region": "D03",
    "database.connection_mode": "D05", "database.host": "D05", "database.name": "D02", "database.schema": "D17",
    "database.tls.root_ca_file": "D11", "database.tls.root_ca_sha256": "D11", "roles.migration": "D06",
    "roles.runtime": "D06", "secrets.migration_dsn_file": "D07", "secrets.runtime_dsn_file": "D07",
    "auth.public_origin": "D09", "auth.issuer": "D09", "auth.database.placement": "D08", "auth.database.namespace": "D08",
    "auth.database.role": "D08", "auth.smtp.provider": "D10",
    "runtime.host_platform": "D14", "runtime.listen": "D14", "backup.strategy": "D12",
}


class Findings:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def add(self, code: str, path: str, message: str, decision: str | None = None) -> None:
        self.items.append({"code": code, "path": path, "message": message, "decision": decision})

    def __bool__(self) -> bool:
        return bool(self.items)


def load_manifest(path: str) -> dict:
    p = Path(path)
    if not p.is_file():
        raise SystemExit("manifest is not a readable file")
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise SystemExit("manifest is not valid JSON")
    if not isinstance(doc, dict):
        raise SystemExit("manifest must be a JSON object")
    return doc


def dig(doc: dict, dotted: str):
    cur = doc
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def walk(doc, prefix=""):
    if isinstance(doc, dict):
        for k, v in doc.items():
            yield from walk(v, f"{prefix}{k}.")
    elif isinstance(doc, list):
        for i, v in enumerate(doc):
            yield from walk(v, f"{prefix}{i}.")
    else:
        yield prefix[:-1], doc


# --- syntax helpers (aligned with the adult config rules; asserted against the real Go loader in tests) ----------------
def is_dns_name(s: str) -> bool:
    if not isinstance(s, str) or not s or len(s) > 253 or s != s.lower():
        return False
    return all(HOST_LABEL_RE.match(label) for label in s.split("."))


def is_public_dns_name(s: str) -> bool:
    if not is_dns_name(s) or "." not in s:
        return False
    tld = s.rsplit(".", 1)[1]
    return any("a" <= c <= "z" for c in tld) and tld not in NON_PUBLIC_TLDS


def is_https_origin(s: str, port_ok: set[str] | None = None) -> bool:
    """Exactly https://<public lowercase DNS name>[:port]; no path, userinfo, query, IP literal or default port."""
    if not isinstance(s, str) or not s.startswith("https://"):
        return False
    host, colon, port = s[len("https://"):].partition(":")
    if colon:
        if not port.isdigit() or str(int(port)) != port or not 1 <= int(port) <= 65535 or port == "443":
            return False
        if port_ok is not None and port not in port_ok:
            return False
    return is_public_dns_name(host)


def unique_strings(v) -> bool:
    """A non-empty list of distinct strings (checked before hashing, so a nested list or object is a finding, not a crash)."""
    return isinstance(v, list) and bool(v) and all(isinstance(x, str) for x in v) and len(set(v)) == len(v)


def canonical_ip(s: str) -> bool:
    try:
        return str(ipaddress.ip_address(s)) == s
    except ValueError:
        return False


HOSTED_SUPABASE_SUFFIXES = (".supabase.co", ".supabase.com", ".supabase.in", ".supabase.net", ".supabase.red")


def is_hosted_supabase_name(host: str) -> bool:
    """A name under Supabase's own domains is hosted Auth/API, never the standalone, self-hosted GoTrue."""
    return isinstance(host, str) and (host.endswith(HOSTED_SUPABASE_SUFFIXES) or host in ("supabase.co", "supabase.com"))


def origin_host(s) -> str:
    return s.split("://", 1)[1].split(":")[0].split("/")[0] if isinstance(s, str) and "://" in s else ""


def is_unicast_ip_literal(s: str) -> bool:
    try:
        a = ipaddress.ip_address(s)
    except ValueError:
        return False
    return (canonical_ip(s) and not (a.is_unspecified or a.is_loopback or a.is_multicast or a.is_link_local)
            and s != "255.255.255.255")


def deploy_listen_ok(s: str) -> bool:
    ip, _, port = s.rpartition(":")
    return (ip in ("0.0.0.0",) or (canonical_ip(ip) and ipaddress.ip_address(ip).version == 4
                                   and ipaddress.ip_address(ip).is_loopback)) and port.isdigit() \
        and str(int(port)) == port and 1 <= int(port) <= 65535


def loopback_listen_ok(s: str) -> bool:
    ip, _, port = s.rpartition(":")
    return canonical_ip(ip) and ipaddress.ip_address(ip).is_loopback and port.isdigit() \
        and str(int(port)) == port and 1 <= int(port) <= 65535


def abs_clean_path(s) -> bool:
    return isinstance(s, str) and s.startswith("/") and "\x00" not in s and ".." not in Path(s).parts \
        and s == os.path.normpath(s) and len(s) <= 1024


def git_worktree_root(start: Path) -> Path | None:
    for p in [start, *start.parents]:
        if (p / ".git").exists():
            return p
    return None


def inside_git_worktree(path: str) -> bool:
    return git_worktree_root(Path(path).resolve().parent) is not None


# --- manifest validation ------------------------------------------------------------------------------------------------
def validate(doc: dict, *, allow_local_test: bool = False) -> Findings:
    f = Findings()

    # 1. Sentinels and placeholders anywhere in the document.
    for path, value in walk(doc):
        if isinstance(value, str):
            if value.startswith("UNDECIDED"):
                d = value.partition(":")[2] or None
                f.add("undecided", path, "owner decision still open", d if d in DECISIONS else None)
            elif PLACEHOLDER_RE.search(value) and not path.startswith("approvals."):
                f.add("placeholder", path, "value looks like a placeholder")
            if CONNECTION_URL_RE.search(value):
                f.add("manifest-credential", path, "a connection string must live only in a private file, never in a manifest")

    if doc.get("schema_version") != SCHEMA_VERSION:
        f.add("schema-version", "schema_version", f"schema_version must be {SCHEMA_VERSION}")
    app = doc.get("app")
    if not isinstance(app, str) or app not in APPS:
        f.add("app", "app", "app must be 'umar' or 'ayangaji'")
        return f
    spec = APPS[app]
    status = doc.get("status")
    kind = doc.get("kind")
    if status == "example":
        f.add("example-status", "status", "an example manifest is a template and never a deployable target")
    elif status not in ("draft", "owner-approved", "local-test"):
        f.add("status", "status", "status must be example, draft, owner-approved or local-test")
    if kind not in ("supabase", "local-test"):
        f.add("kind", "kind", "kind must be supabase or local-test")
    if (kind == "local-test") != (status == "local-test"):
        f.add("kind", "kind", "kind local-test and status local-test must be used together")
    if kind == "local-test":
        if not allow_local_test:
            f.add("local-test", "kind", "a local-test target needs --allow-local-test and is never a deployment")
        _validate_local_test(doc, spec, f)
        return f

    for dotted, decision in REQUIRED_STRINGS.items():
        if not isinstance(dig(doc, dotted), str) or not dig(doc, dotted):
            f.add("missing", dotted, "required field is absent or not a string", decision)

    # 2. Project identity.
    ref = dig(doc, "project.ref")
    region = dig(doc, "project.region")
    if isinstance(ref, str) and not ref.startswith("UNDECIDED") and not REF_RE.match(ref):
        f.add("project-ref", "project.ref", "project ref must be 20 lowercase letters/digits", "D02")
    if isinstance(region, str) and not region.startswith("UNDECIDED") and not REGION_RE.match(region):
        f.add("region", "project.region", "region must look like ap-southeast-1", "D03")
    major = dig(doc, "project.postgres_major")
    if isinstance(major, str) and major.startswith("UNDECIDED"):
        pass  # reported once by the sentinel scan
    elif isinstance(major, bool) or not isinstance(major, int) or major not in (15, 16, 17):
        f.add("postgres-major", "project.postgres_major", "postgres_major must be the integer 15, 16 or 17", "D15")
    if not isinstance(dig(doc, "organization.slug"), str) or not dig(doc, "organization.slug"):
        f.add("organization", "organization.slug", "organization slug missing", "D01")
    if dig(doc, "organization.plan") not in ("free", "pro", "team", "enterprise") and not str(
            dig(doc, "organization.plan")).startswith("UNDECIDED"):
        f.add("plan", "organization.plan", "plan must be free, pro, team or enterprise", "D04")

    # 3. Database endpoint.
    mode = dig(doc, "database.connection_mode")
    host = dig(doc, "database.host")
    port = dig(doc, "database.port")
    if mode == "transaction-pooler":
        f.add("transaction-pooler", "database.connection_mode",
              "transaction pooling is incompatible with prepared statements and session state used by both backends", "D05")
    elif mode not in ("direct", "session-pooler") and not str(mode).startswith("UNDECIDED"):
        f.add("connection-mode", "database.connection_mode", "connection_mode must be direct or session-pooler", "D05")
    if isinstance(host, str) and not host.startswith("UNDECIDED"):
        if mode == "direct":
            want = f"db.{ref}.supabase.co" if isinstance(ref, str) and REF_RE.match(ref) else None
            if host != want:
                f.add("host-ref-mismatch", "database.host", "direct host must be exactly db.<project ref>.supabase.co", "D05")
        elif mode == "session-pooler":
            m = re.match(r"^aws-[0-9]+-([a-z0-9-]+)\.pooler\.supabase\.com$", host)
            if not m or m.group(1) != region:
                f.add("host-region-mismatch", "database.host",
                      "session pooler host must be aws-<n>-<project region>.pooler.supabase.com", "D05")
    if isinstance(port, str) and port.startswith("UNDECIDED"):
        pass  # reported once by the sentinel scan
    elif port == 6543:
        f.add("transaction-pooler", "database.port", "port 6543 is transaction pooling; use 5432", "D05")
    elif port != 5432 or isinstance(port, bool):
        f.add("port", "database.port", "port is required and must be exactly the integer 5432 (direct or session pooler)", "D05")
    if dig(doc, "database.name") != "postgres":
        f.add("database-name", "database.name", "a Supabase project exposes its application database as 'postgres'", "D02")
    schema = dig(doc, "database.schema")
    if spec["fixed_schema"] is not None:
        if schema != spec["fixed_schema"]:
            f.add("schema", "database.schema", f"{app} requires schema {spec['fixed_schema']} (hard-coded in the store)")
    elif isinstance(schema, str) and not schema.startswith("UNDECIDED"):
        if not SCHEMA_RE.match(schema) or schema in SUPABASE_RESERVED_SCHEMAS or schema.startswith("pg_"):
            f.add("schema", "database.schema", "schema must be lowercase, not public/pg_*/a Supabase-owned schema", "D17")
    elif not isinstance(schema, str):
        f.add("schema", "database.schema", "schema missing", "D17")
    if dig(doc, "database.tls.sslmode") != "verify-full":
        f.add("tls-sslmode", "database.tls.sslmode", "sslmode must be exactly verify-full", "D11")
    ca = dig(doc, "database.tls.root_ca_file")
    if isinstance(ca, str) and not ca.startswith("UNDECIDED") and not (abs_clean_path(ca) and not inside_git_worktree(ca)):
        f.add("tls-root-ca", "database.tls.root_ca_file", "root CA must be a clean absolute path outside any git work tree", "D11")
    sha = dig(doc, "database.tls.root_ca_sha256")
    if isinstance(sha, str) and not sha.startswith("UNDECIDED") and not SHA256_RE.match(sha):
        f.add("tls-root-ca-sha", "database.tls.root_ca_sha256", "root CA digest must be lowercase hex SHA-256", "D11")

    # 4. Roles.
    roles = dig(doc, "roles")
    if roles is not None and not isinstance(roles, dict):
        f.add("type", "roles", "roles must be an object with a migration and a runtime role", "D06")
        roles = {}
    roles = roles or {}
    mig, run = roles.get("migration"), roles.get("runtime")
    for key, val in (("migration", mig), ("runtime", run)):
        if not isinstance(val, str) or val.startswith("UNDECIDED"):
            continue
        if not ROLE_RE.match(val) or val in SUPABASE_RESERVED_ROLES or val.startswith(("pg_", "supabase_")):
            f.add("role", f"roles.{key}", "role must be a dedicated non-reserved lowercase name (never postgres/anon/etc.)", "D06")
        elif not val.startswith(spec["role_prefix"]):
            f.add("role-prefix", f"roles.{key}", f"{app} roles must start with {spec['role_prefix']} (mixed app identity)", "D06")
    if isinstance(mig, str) and mig == run:
        f.add("role-reuse", "roles", "migration and runtime must be different roles", "D06")

    # 5. Private secret files (paths only; contents are never read here).
    for key in ("migration_dsn_file", "runtime_dsn_file"):
        p = dig(doc, f"secrets.{key}")
        if isinstance(p, str) and not p.startswith("UNDECIDED") and not (abs_clean_path(p) and not inside_git_worktree(p)):
            f.add("secret-path", f"secrets.{key}", "secret file must be a clean absolute path outside any git work tree", "D07")
    m_p, r_p = dig(doc, "secrets.migration_dsn_file"), dig(doc, "secrets.runtime_dsn_file")
    if isinstance(m_p, str) and m_p == r_p:
        f.add("secret-reuse", "secrets", "migration and runtime must use different secret files", "D07")

    # 6. Data API posture (owner attestation only; the tool cannot read or change the dashboard).
    if dig(doc, "data_api.disabled_confirmed_by_owner") is not True:
        f.add("data-api", "data_api.disabled_confirmed_by_owner",
              "owner must confirm the Data API is disabled (Postgres-only design); tooling never changes the dashboard", "D13")

    # 7. Standalone GoTrue identity.
    _validate_auth(doc, app, ref, f)
    _validate_runtime(doc, app, f)
    if dig(doc, "backup.strategy") is None or str(dig(doc, "backup.strategy")).startswith("UNDECIDED"):
        f.add("backup", "backup.strategy", "backup/restore strategy open", "D12")

    # 8. Approvals use exact strings; absence/pending is allowed in draft, required by --execute.
    approvals = doc.get("approvals")
    if not isinstance(approvals, dict):
        f.add("approvals", "approvals", "approvals object missing")
    elif status == "owner-approved":
        token = approvals.get("migration")
        if not (isinstance(ref, str) and isinstance(token, str) and re.fullmatch(f"approved:{re.escape(ref)}:migration:{DATE_RE}", token)):
            f.add("approval-token", "approvals.migration", "owner-approved status needs approved:<ref>:migration:<date>")
    return f


def _validate_local_test(doc: dict, spec: dict, f: Findings) -> None:
    host = dig(doc, "database.host")
    if host not in ("localhost", "127.0.0.1"):
        f.add("local-host", "database.host", "a local-test target must name localhost or 127.0.0.1")
    if dig(doc, "database.tls.sslmode") != "verify-full":
        f.add("tls-sslmode", "database.tls.sslmode", "local-test also uses verify-full against a throwaway CA")
    if not isinstance(dig(doc, "database.port"), int) or not 1024 <= dig(doc, "database.port") <= 65535:
        f.add("port", "database.port", "port must be a high TCP port")
    schema = dig(doc, "database.schema")
    fixed = spec["fixed_schema"]
    if (fixed and schema != fixed) or (not fixed and not (isinstance(schema, str) and SCHEMA_RE.match(schema)
                                                          and schema not in SUPABASE_RESERVED_SCHEMAS)):
        f.add("schema", "database.schema", "schema violates this app's rule")
    for key in ("migration", "runtime"):
        r = dig(doc, f"roles.{key}")
        if not (isinstance(r, str) and ROLE_RE.match(r) and r.startswith(spec["role_prefix"])):
            f.add("role", f"roles.{key}", "role must be a dedicated app-prefixed name")


def _validate_auth(doc: dict, app: str, ref, f: Findings) -> None:
    if dig(doc, "auth.provider") != "standalone-gotrue":
        f.add("auth-provider", "auth.provider", "auth.provider must be exactly standalone-gotrue (no hosted Supabase Auth)")
    origin, issuer = dig(doc, "auth.public_origin"), dig(doc, "auth.issuer")
    # Umar requires issuer == public origin exactly (labconfig.Issuer). The adult store takes any exact issuer string and its
    # local stack uses <origin>/auth/v1 (GoTrue behind a path-routing front), so both shapes are accepted there; either way
    # GOTRUE_JWT_ISSUER must be configured to the identical string.
    issuer_forms = [origin] if app == "umar" or not isinstance(origin, str) else [origin, origin + "/auth/v1"]
    for key, val in (("public_origin", origin), ("issuer", issuer)):
        base = val[: -len("/auth/v1")] if key == "issuer" and app == "ayangaji" and isinstance(val, str) and val.endswith("/auth/v1") else val
        if isinstance(val, str) and not val.startswith("UNDECIDED") and not is_https_origin(base):
            f.add("auth-origin", f"auth.{key}", "must be an https origin on a public lowercase DNS name (no IP, path or test name)", "D09")
    if isinstance(origin, str) and isinstance(issuer, str) and not origin.startswith("UNDECIDED") \
            and not issuer.startswith("UNDECIDED") and issuer not in issuer_forms:
        f.add("auth-issuer", "auth.issuer", "issuer must equal the public origin exactly"
              + (" (or origin + /auth/v1)" if app == "ayangaji" else ""), "D09")
    for key in ("public_origin", "issuer", "supabase_url"):
        if is_hosted_supabase_name(origin_host(dig(doc, f"auth.{key}"))):
            f.add("auth-hosted", f"auth.{key}", "a Supabase-hosted name cannot be the standalone self-hosted GoTrue's identity", "D09")
    surl = dig(doc, "auth.supabase_url")
    if app == "ayangaji" and isinstance(surl, str) and isinstance(origin, str) and is_https_origin(surl, port_ok={"9443"}) \
            and is_https_origin(origin) and surl.split("://", 1)[1].split(":")[0] != origin.split("://", 1)[1].split(":")[0]:
        f.add("auth-url-host", "auth.supabase_url", "the verifier URL must name the same host as the public origin", "D09")
    if dig(doc, "auth.audience") != "authenticated":
        f.add("auth-audience", "auth.audience", "audience must be exactly authenticated (GOTRUE_JWT_AUD)")
    place = dig(doc, "auth.database.placement")
    ns = dig(doc, "auth.database.namespace")
    arole = dig(doc, "auth.database.role")
    if place == SELF_HOSTED_PLACEMENT:
        _validate_self_hosted_identity(doc, ref, ns, f)
    else:
        if place in HOSTED_IDENTITY_PLACEMENTS:
            f.add("auth-placement-unsupported", "auth.database.placement",
                  "hosted identity placements are unsupported: the pinned GoTrue hard-codes auth.users and fails in a custom "
                  f"namespace; use {SELF_HOSTED_PLACEMENT} (a separate self-hosted database that keeps the auth namespace)", "D08")
        elif not str(place).startswith("UNDECIDED"):
            f.add("auth-placement", "auth.database.placement", f"placement must be {SELF_HOSTED_PLACEMENT}", "D08")
        _validate_hosted_identity_legacy(doc, ref, place, ns, f)
    if isinstance(ns, str) and ns == dig(doc, "database.schema"):
        f.add("auth-namespace", "auth.database.namespace", "identity and application data must not share a schema", "D08")
    if isinstance(arole, str) and not arole.startswith("UNDECIDED") and (
            not ROLE_RE.match(arole) or arole in SUPABASE_RESERVED_ROLES or arole in (dig(doc, "roles.migration"), dig(doc, "roles.runtime"))):
        f.add("auth-role", "auth.database.role", "GoTrue database role must be dedicated and distinct from app roles", "D08")
    if str(dig(doc, "auth.smtp.provider")).startswith("UNDECIDED") or not dig(doc, "auth.smtp.provider"):
        f.add("smtp", "auth.smtp.provider", "SMTP provider open (GoTrue confirmation/recovery mail cannot work without it)", "D10")


def _validate_self_hosted_identity(doc: dict, ref, ns, f: Findings) -> None:
    """A separate self-hosted identity database. Only identifiers live in a manifest: never a host, DSN or credential."""
    ident = dig(doc, "auth.database")
    for key in sorted(k for k in ident if k not in SELF_HOSTED_IDENTITY_KEYS):
        if key in HOSTED_ONLY_IDENTITY_KEYS:
            f.add("auth-mixed-topology", f"auth.database.{key}",
                  f"a hosted-placement field cannot be combined with {SELF_HOSTED_PLACEMENT}", "D08")
        else:
            f.add("auth-identity-field", f"auth.database.{key}",
                  "not part of the self-hosted identity topology (identifiers only; connection details never go in a manifest)", "D08")
    inst, name = ident.get("instance_id"), ident.get("name")
    for key, val in (("instance_id", inst), ("name", name)):
        if not isinstance(val, str) or not val:
            f.add("missing", f"auth.database.{key}", "required field is absent or not a string", "D08")
    if isinstance(inst, str) and inst and not inst.startswith("UNDECIDED"):
        if not INSTANCE_ID_RE.match(inst):
            f.add("auth-instance", "auth.database.instance_id", "instance id must be 2-63 lowercase letters, digits or hyphens", "D08")
        elif inst == ref:
            f.add("auth-instance", "auth.database.instance_id",
                  "the identity database must run on its own instance, not the application's Supabase project", "D08")
    if isinstance(name, str) and name and not name.startswith("UNDECIDED") and (
            not IDENTITY_DB_NAME_RE.match(name) or name in RESERVED_DATABASE_NAMES or name.startswith("pg_")):
        f.add("auth-database-name", "auth.database.name",
              "identity database name must be lowercase and not postgres/template*/pg_*", "D08")
    if isinstance(ns, str) and not ns.startswith("UNDECIDED") and ns != VENDOR_NAMESPACE:
        f.add("auth-namespace", "auth.database.namespace",
              f"the pinned GoTrue only runs with its vendor namespace; use exactly {VENDOR_NAMESPACE} in the separate identity database", "D08")


def _validate_hosted_identity_legacy(doc: dict, ref, place, ns, f: Findings) -> None:
    """Findings kept for the refused hosted placements, so confusion with Supabase's own schemas stays visible."""
    if isinstance(ns, str) and not ns.startswith("UNDECIDED"):
        if not SCHEMA_RE.match(ns) or ns in SUPABASE_RESERVED_SCHEMAS or ns.startswith("pg_"):
            f.add("auth-namespace", "auth.database.namespace",
                  "GoTrue namespace must not be auth/public/another Supabase-owned schema (hosted auth schema is off limits)", "D08")
    prj = dig(doc, "auth.database.project_ref")
    if place == "dedicated-project":
        if not isinstance(prj, str) or prj.startswith("UNDECIDED") or not REF_RE.match(prj):
            f.add("auth-project", "auth.database.project_ref", "dedicated-project placement needs the identity project ref", "D08")
        elif prj == ref:
            f.add("auth-project", "auth.database.project_ref", "dedicated identity project must differ from the application project", "D08")
    elif place == "same-project-dedicated-schema":
        if prj != ref:
            f.add("auth-project", "auth.database.project_ref", "same-project placement must repeat the application project ref", "D08")
        if dig(doc, "auth.database.accepts_shared_failure_domain") is not True:
            f.add("auth-shared-domain", "auth.database.accepts_shared_failure_domain",
                  "owner must explicitly accept one failure/credential domain for app and identity data", "D08")


def _validate_runtime(doc: dict, app: str, f: Findings) -> None:
    rt = dig(doc, "runtime")
    if rt is not None and not isinstance(rt, dict):
        f.add("type", "runtime", "runtime must be an object", "D14")
        rt = {}
    rt = rt or {}
    if not str(rt.get("host_platform", "UNDECIDED")) or str(rt.get("host_platform", "UNDECIDED")).startswith("UNDECIDED"):
        f.add("runtime-host", "runtime.host_platform", "runtime host/platform open", "D14")
    listen = rt.get("listen")
    if app == "umar":
        # cmd/server refuses any non-loopback bind: the API must be fronted by a local TLS proxy.
        if not (isinstance(listen, str) and loopback_listen_ok(listen)):
            f.add("listen", "runtime.listen", "umar API binds only a literal loopback address with a port")
        jwks = dig(doc, "auth.jwks_url")
        if not (isinstance(jwks, str) and re.match(r"^http://(127\.0\.0\.1|\[::1\]):[0-9]{1,5}/\.well-known/jwks\.json$", jwks)):
            f.add("jwks-url", "auth.jwks_url", "umar fetches JWKS over a literal-loopback http route to the co-located GoTrue")
    else:
        if not (isinstance(listen, str) and deploy_listen_ok(listen)):
            f.add("listen", "runtime.listen", "ayangaji deploy listen must be 0.0.0.0:<port> or 127.0.0.1:<port>")
        hosts = rt.get("allowed_hosts")
        if not (unique_strings(hosts) and all(is_public_dns_name(h.partition(":")[0]) for h in hosts)):
            f.add("allowed-hosts", "runtime.allowed_hosts", "need at least one unique public DNS Host value", "D09")
        origins = rt.get("cors_origins")
        if not (unique_strings(origins) and all(is_https_origin(o) for o in origins)):
            f.add("cors-origins", "runtime.cors_origins",
                  "production staging refuses native-only: at least one exact public https web origin is required", "D16")
        proxies = rt.get("trusted_proxies")
        if not (unique_strings(proxies) and all(is_unicast_ip_literal(p) for p in proxies)):
            f.add("trusted-proxies", "runtime.trusted_proxies", "need unique canonical unicast IP literals", "D16")
        url = dig(doc, "auth.supabase_url")
        if not (isinstance(url, str) and is_https_origin(url, port_ok={"9443"})):
            f.add("auth-url", "auth.supabase_url", "must be https://<public dns name>[:9443] with nothing more", "D09")
        akf = dig(doc, "secrets.admin_key_file")
        if not (abs_clean_path(akf) and not inside_git_worktree(akf)):
            f.add("secret-path", "secrets.admin_key_file", "admin credential file must be a clean absolute path outside git", "D18")
        elif isinstance(akf, str) and akf in (dig(doc, "secrets.migration_dsn_file"), dig(doc, "secrets.runtime_dsn_file")):
            f.add("secret-reuse", "secrets.admin_key_file", "admin credential must have its own file", "D18")


def _identity_store(doc: dict):
    """What identifies the identity storage of a manifest, or None while it is incomplete or still undecided."""
    def ident(key):
        v = dig(doc, f"auth.database.{key}")
        return v if isinstance(v, str) and v and not v.startswith("UNDECIDED") else None
    place = dig(doc, "auth.database.placement")
    if place == SELF_HOSTED_PLACEMENT and ident("instance_id") and ident("name"):
        return ("self-hosted", ident("instance_id"), ident("name"))
    if place in HOSTED_IDENTITY_PLACEMENTS and ident("project_ref"):
        return ("project", ident("project_ref"))
    return None


def peer_findings(doc: dict, peer: dict) -> Findings:
    """Refuse two manifests that share any identity: the two apps must stay in separate projects, hosts, roles, issuers."""
    f = Findings()
    if doc.get("app") == peer.get("app"):
        f.add("peer-same-app", "app", "both manifests describe the same app")
        return f
    pairs = [
        ("project.ref", "peer-project", "both apps name the same Supabase project (one project per app)"),
        ("auth.public_origin", "peer-issuer", "both apps share a public auth origin"),
        ("auth.issuer", "peer-issuer", "both apps share an issuer"),
        ("auth.database.project_ref", "peer-auth-project", "both apps share an identity project"),
        ("secrets.migration_dsn_file", "peer-secret", "both apps share a secret file"),
        ("secrets.runtime_dsn_file", "peer-secret", "both apps share a secret file"),
        ("roles.migration", "peer-role", "both apps share a database role"),
        ("roles.runtime", "peer-role", "both apps share a database role"),
        ("auth.database.role", "peer-role", "both apps share an identity database role"),
        ("runtime.listen", "peer-listen", "both apps share a listen address"),
    ]
    # A direct host embeds the project ref, so a shared direct host is a shared project. A shared-pooler host is shared by
    # unrelated projects of a region (the user <role>.<ref> selects the project), so it is not an identity collision.
    if dig(doc, "database.connection_mode") == "direct" and dig(peer, "database.connection_mode") == "direct":
        pairs.append(("database.host", "peer-host", "both apps name the same direct database host"))
    for dotted, code, msg in pairs:
        a, b = dig(doc, dotted), dig(peer, dotted)
        if a is not None and a == b and not str(a).startswith("UNDECIDED"):
            f.add(code, dotted, msg)
    for key in ("migration", "runtime"):
        for key2 in ("migration", "runtime"):
            a, b = dig(doc, f"roles.{key}"), dig(peer, f"roles.{key2}")
            if a is not None and a == b and key != key2:
                f.add("peer-role", f"roles.{key}", "a role of one app is a role of the other")
    # Identity stores: the same namespace name (`auth`) in two different databases is not shared storage; the same store is.
    mine, theirs = _identity_store(doc), _identity_store(peer)
    if mine is not None and mine == theirs:
        f.add("peer-auth-database", "auth.database", "both apps share one identity database")
        ns = dig(doc, "auth.database.namespace")
        if isinstance(ns, str) and ns == dig(peer, "auth.database.namespace"):
            f.add("peer-auth-namespace", "auth.database.namespace", "both apps share an identity namespace in one identity database")
    for one, other in ((doc, peer), (peer, doc)):
        inst = dig(one, "auth.database.instance_id")
        if isinstance(inst, str) and not inst.startswith("UNDECIDED") and inst in (dig(one, "project.ref"), dig(other, "project.ref")):
            f.add("peer-auth-project", "auth.database.instance_id", "an identity instance is an application project")
    return f


# --- DSN file handling (never printed) ----------------------------------------------------------------------------------
class Dsn:
    __slots__ = ("user", "password", "host", "port", "db", "query", "raw")

    def __init__(self, raw: str) -> None:
        self.raw = raw
        u = urlsplit(raw)
        if u.scheme not in ("postgres", "postgresql"):
            raise ValueError("scheme")
        if "," in (u.netloc.rpartition("@")[2]) or u.hostname is None:
            raise ValueError("host")
        self.user = unquote(u.username or "")
        self.password = unquote(u.password or "")
        self.host = u.hostname
        self.port = u.port
        self.db = unquote(u.path.lstrip("/"))
        self.query = parse_qsl(u.query, keep_blank_values=True, strict_parsing=bool(u.query))


def read_private_file(path: str, f: Findings, label: str) -> str | None:
    try:
        st = os.lstat(path)
    except OSError:
        f.add("secret-file", label, "secret file is missing")
        return None
    if not stat.S_ISREG(st.st_mode):
        f.add("secret-file", label, "secret file must be a regular file, not a symlink or directory")
        return None
    if st.st_uid != os.getuid() or st.st_mode & 0o177:
        f.add("secret-file-mode", label, "secret file must be owned by the invoking user with mode 0600 or stricter")
        return None
    if st.st_size == 0 or st.st_size > 4096:
        f.add("secret-file", label, "secret file must hold one short connection string")
        return None
    data = Path(path).read_text(encoding="utf-8")
    line = data.rstrip("\n")
    if "\n" in line or "\r" in line or line != line.strip() or any(ord(c) < 32 for c in line):
        f.add("secret-file", label, "secret file must hold exactly one line without control characters")
        return None
    return line


def dsn_check(doc: dict, role_kind: str, dsn_file: str | None) -> tuple[Findings, Dsn | None]:
    f = Findings()
    path = dsn_file or dig(doc, f"secrets.{role_kind}_dsn_file")
    if not isinstance(path, str) or not abs_clean_path(path):
        f.add("secret-path", f"secrets.{role_kind}_dsn_file", "no usable DSN file path", "D07")
        return f, None
    if inside_git_worktree(path):
        f.add("secret-path", f"secrets.{role_kind}_dsn_file", "DSN file must not be inside a git work tree", "D07")
        return f, None
    raw = read_private_file(path, f, f"secrets.{role_kind}_dsn_file")
    if raw is None:
        return f, None
    try:
        d = Dsn(raw)
    except ValueError:
        f.add("dsn-syntax", "dsn", "file does not hold a valid single-host PostgreSQL URL")
        return f, None
    role = dig(doc, f"roles.{role_kind}")
    ref = dig(doc, "project.ref")
    kind = doc.get("kind")
    expected_user = role if dig(doc, "database.connection_mode") != "session-pooler" else f"{role}.{ref}"
    if d.user != expected_user:
        f.add("dsn-user", "dsn.user", "DSN user does not match the manifest role (pooler users are <role>.<project ref>)")
    if d.host != dig(doc, "database.host") or d.port != dig(doc, "database.port") or d.db != dig(doc, "database.name"):
        f.add("dsn-target", "dsn.host", "DSN host, port or database differ from the manifest (mixed target)")
    if len(d.password) < 16 or WEAK_PASSWORD_RE.search(d.password) or d.password.lower() == d.user.lower():
        f.add("dsn-password", "dsn.password", "DSN password is empty, short or a placeholder")
    keys = [k for k, _ in d.query]
    extra = sorted(set(keys) - DSN_QUERY_ALLOWED)
    if extra or len(keys) != len(set(keys)):
        f.add("dsn-query", "dsn.query", "DSN query may only hold sslmode, sslrootcert, connect_timeout, application_name, once each")
    q = dict(d.query)
    if q.get("sslmode") != "verify-full":
        f.add("dsn-sslmode", "dsn.query.sslmode", "DSN must carry sslmode=verify-full")
    ca = dig(doc, "database.tls.root_ca_file")
    if q.get("sslrootcert") != ca:
        f.add("dsn-sslrootcert", "dsn.query.sslrootcert", "DSN sslrootcert must be the manifest root CA file")
    if "connect_timeout" in q and not (q["connect_timeout"].isdigit() and 1 <= int(q["connect_timeout"]) <= 60):
        f.add("dsn-query", "dsn.query.connect_timeout", "connect_timeout must be 1..60")
    # Root CA integrity.
    if isinstance(ca, str) and abs_clean_path(ca):
        try:
            cst = os.lstat(ca)
            ok = stat.S_ISREG(cst.st_mode) and not cst.st_mode & 0o022
            digest = hashlib.sha256(Path(ca).read_bytes()).hexdigest() if ok else None
        except OSError:
            digest = None
        if digest is None:
            f.add("root-ca-file", "database.tls.root_ca_file", "root CA is missing, not a regular file, or group/world writable", "D11")
        elif digest != dig(doc, "database.tls.root_ca_sha256"):
            f.add("root-ca-digest", "database.tls.root_ca_sha256", "root CA file digest differs from the pinned SHA-256", "D11")
    if kind == "local-test" and d.host not in ("localhost", "127.0.0.1"):
        f.add("dsn-target", "dsn.host", "local-test DSN must name localhost or 127.0.0.1")
    return f, d


def redact(text: str, dsn: Dsn | None) -> str:
    if dsn is None:
        return text
    for secret in (dsn.raw, dsn.password):
        if secret:
            text = text.replace(secret, "[redacted]")
    return text


# --- rendering and execution ---------------------------------------------------------------------------------------------
def render_env(doc: dict, role_kind: str) -> dict[str, str]:
    """Non-secret service/migration environment. Secrets stay in private files or the host's secret mechanism."""
    app = doc["app"]
    host, schema = dig(doc, "database.host"), dig(doc, "database.schema")
    if app == "umar":
        env = {"UMAR_MIGRATE_ON_START": "false"}
        if role_kind == "runtime":
            env |= {
                "UMAR_LISTEN": dig(doc, "runtime.listen"),
                "UMAR_AUTH_PROVIDER": "gotrue",
                "UMAR_PUBLIC_ORIGIN": dig(doc, "auth.public_origin"),
                "UMAR_OIDC_ISSUER": dig(doc, "auth.issuer"),
                "UMAR_OIDC_JWKS_URL": dig(doc, "auth.jwks_url"),
            }
        return env  # UMAR_DATABASE_URL (a secret) is injected by the host or the migrate wrapper, never rendered
    env = {"AYA_DB_HOSTS": host, "AYA_DB_SCHEMA": schema, "AYA_DATABASE_URL_FILE": dig(doc, f"secrets.{role_kind}_dsn_file")}
    if role_kind == "runtime":
        env |= {
            "AYA_MODE": "production",
            "AYA_AUTH_PROVIDER": "standalone-gotrue",
            "AYA_DEPLOYMENT_ENV": "staging",
            "AYA_LISTEN": dig(doc, "runtime.listen"),
            "AYA_ALLOWED_HOSTS": ",".join(dig(doc, "runtime.allowed_hosts")),
            "AYA_CORS_ORIGINS": ",".join(dig(doc, "runtime.cors_origins")),
            "AYA_TRUSTED_PROXIES": ",".join(dig(doc, "runtime.trusted_proxies")),
            "AYA_SUPABASE_URL": dig(doc, "auth.supabase_url"),
            "AYA_SUPABASE_ISSUER": dig(doc, "auth.issuer"),
            "AYA_SUPABASE_AUDIENCE": dig(doc, "auth.audience"),
            "AYA_SUPABASE_ADMIN_KEY_FILE": dig(doc, "secrets.admin_key_file"),
        }
    return env


def clean_base_env() -> dict[str, str]:
    """No inherited PG*/AYA_*/UMAR_*/Google/Firebase variables: pgx would obey PGHOST, PGSERVICE and friends."""
    return {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}


def gate_execute(doc: dict, confirm: str | None, action: str) -> Findings:
    f = Findings()
    if doc.get("kind") == "local-test":
        return f
    ref = dig(doc, "project.ref")
    if doc.get("status") != "owner-approved":
        f.add("gate-status", "status", f"{action} --execute needs status owner-approved")
    token = dig(doc, f"approvals.{action}")
    if not (isinstance(token, str) and re.fullmatch(f"approved:{re.escape(str(ref))}:{action}:{DATE_RE}", token)):
        f.add("gate-approval", f"approvals.{action}", f"{action} needs the exact recorded approval approved:<ref>:{action}:<date>")
    if confirm != ref:
        f.add("gate-confirm", "--confirm-project", "--confirm-project must repeat the project ref exactly")
    return f


def print_findings(f: Findings, out=sys.stderr) -> None:
    for i in f.items:
        dec = f" decision={i['decision']}" if i["decision"] else ""
        print(f"REFUSED {i['code']} at {i['path']}{dec}: {i['message']}", file=out)


def full_validate(args, doc: dict) -> Findings:
    """The manifest's own findings plus its isolation from the other app's manifest.

    The peer is optional for offline inspection and dry runs. It is required for --execute on a Supabase-kind target, because
    this tool is what keeps the two apps' projects, roles, secrets and identity stores apart. Whenever a peer is given it must
    itself validate under the same rules before it is compared, so a stub, a stale or a malformed file cannot stand in for it.
    Everything here happens before any DSN file is read or any process is started."""
    allow = getattr(args, "allow_local_test", False)
    f = validate(doc, allow_local_test=allow)
    peer_path = getattr(args, "peer", None)
    if getattr(args, "execute", False) and doc.get("kind") != "local-test" and not peer_path:
        f.add("peer-required", "--peer",
              "--execute on a Supabase target needs --peer, the other app's valid manifest, to prove the two apps share no identity")
    if peer_path:
        peer = load_manifest(peer_path)
        f.items += [dict(i, code="peer-invalid", path="peer:" + i["path"], message=f"peer manifest: {i['message']} ({i['code']})")
                    for i in validate(peer, allow_local_test=allow).items]
        f.items += peer_findings(doc, peer).items
    return f


def cmd_validate(args) -> int:
    doc = load_manifest(args.manifest)
    f = full_validate(args, doc)
    if args.check_files and not f:
        for role in ("migration", "runtime"):
            ff, _ = dsn_check(doc, role, None)
            f.items += ff.items
    if f:
        print_findings(f)
        print(f"INVALID: {len(f.items)} finding(s)", file=sys.stderr)
        return 2
    print("VALID: manifest is complete and consistent (no connection was made; approvals are separate)")
    return 0


def cmd_inventory(args) -> int:
    doc = load_manifest(args.manifest)
    f = full_validate(args, doc)
    by_decision: dict[str, list[str]] = {}
    other = []
    for i in f.items:
        if i["decision"]:
            by_decision.setdefault(i["decision"], []).append(i["path"])
        else:
            other.append({"code": i["code"], "path": i["path"]})
    result = {"decisions": {d: {"question": DECISIONS[d], "fields": sorted(set(p))} for d, p in sorted(by_decision.items())},
              "other_findings": other}
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        for d, v in result["decisions"].items():
            print(f"{d}: {v['question']}\n      fields: {', '.join(v['fields'])}")
        for o in other:
            print(f"-- {o['code']} at {o['path']}")
    return 0


def cmd_dsn_check(args) -> int:
    doc = load_manifest(args.manifest)
    f = full_validate(args, doc)
    if not f:
        ff, _ = dsn_check(doc, args.role, args.dsn_file)
        f.items += ff.items
    if f:
        print_findings(f)
        return 2
    print(f"VALID: {args.role} DSN file matches the manifest (contents not printed)")
    return 0


def cmd_render_env(args) -> int:
    doc = load_manifest(args.manifest)
    f = full_validate(args, doc)
    if f:
        print_findings(f)
        return 2
    for k, v in render_env(doc, args.role).items():
        if not re.fullmatch(r"[A-Za-z0-9_.,:/\[\]-]*", v):
            print(f"REFUSED render at {k}: value has characters outside the safe set", file=sys.stderr)
            return 2
        print(f"{k}={v}")
    return 0


def _resolve_bin(path: str) -> str | None:
    p = Path(path)
    return str(p.resolve()) if p.is_file() and os.access(p, os.X_OK) else None


def cmd_migrate(args) -> int:
    doc = load_manifest(args.manifest)
    f = full_validate(args, doc)
    if not f:
        ff, dsn = dsn_check(doc, "migration", None)
        f.items += ff.items
    else:
        dsn = None
    if f:
        print_findings(f)
        return 2
    binary = _resolve_bin(args.migrate_bin)
    if binary is None:
        print("REFUSED migrate-bin: --migrate-bin must be an executable file", file=sys.stderr)
        return 2
    app, ref = doc["app"], dig(doc, "project.ref") or "local-test"
    plan = [
        f"app={app} target={doc['kind']} project={ref} mode={dig(doc, 'database.connection_mode') or 'local'}",
        f"schema={dig(doc, 'database.schema')} migration_role={dig(doc, 'roles.migration')} tls=verify-full",
        "steps: connect once as the migration role -> apply embedded migrations (idempotent; backend-specific verification) -> verify -> exit",
        "runtime role is NOT touched; run the owner-reviewed grants template separately",
    ]
    if not args.execute:
        print("DRY RUN (no connection opened):")
        for line in plan:
            print("  " + line)
        print("Re-run with --execute --confirm-project <ref> only after the exact owner approval is recorded.")
        return 0
    g = gate_execute(doc, args.confirm_project, "migration")
    if g:
        print_findings(g)
        return 2
    env = clean_base_env()
    if app == "umar":
        env["UMAR_DATABASE_URL"] = dsn.raw  # env of the child only; never argv
    else:
        env |= render_env(doc, "migration")
    proc = subprocess.run([binary], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=300)
    sys.stdout.write(redact(proc.stdout, dsn))
    sys.stderr.write(redact(proc.stderr, dsn))
    print(f"migration process exit status {proc.returncode}")
    return proc.returncode


def cmd_verify(args) -> int:
    doc = load_manifest(args.manifest)
    f = full_validate(args, doc)
    dsn = None
    if not f:
        ff, dsn = dsn_check(doc, args.role, None)
        f.items += ff.items
    if f:
        print_findings(f)
        return 2
    sql_file = HERE / "sql" / APPS[doc["app"]]["sql_dir"] / "verify-readiness.sql"
    if not sql_file.is_file():
        print("REFUSED verify: readiness SQL missing", file=sys.stderr)
        return 2
    if not args.execute:
        print(f"DRY RUN (no connection opened): would run read-only {sql_file.relative_to(HERE.parent.parent)} as the "
              f"{args.role} role over verify-full TLS")
        return 0
    g = gate_execute(doc, args.confirm_project, "verify")
    if g:
        print_findings(g)
        return 2
    psql = shutil.which("psql", path=args.psql_path or os.environ.get("PATH", ""))
    if not psql:
        print("REFUSED verify: psql not found", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="infra-verify-") as tmp:
        os.chmod(tmp, 0o700)
        passfile = Path(tmp) / "pgpass"
        esc = lambda s: s.replace("\\", "\\\\").replace(":", "\\:")  # noqa: E731
        passfile.write_text(f"{esc(dsn.host)}:{dsn.port}:{esc(dsn.db)}:{esc(dsn.user)}:{esc(dsn.password)}\n")
        os.chmod(passfile, 0o600)
        env = clean_base_env() | {
            "PGPASSFILE": str(passfile), "PGSSLMODE": "verify-full", "PGSSLROOTCERT": dig(doc, "database.tls.root_ca_file"),
            "PGCONNECT_TIMEOUT": "10", "PGOPTIONS": "-c default_transaction_read_only=on",
        }
        cmd = [psql, "-X", "-q", "-A", "-t", "-F", "|", "-v", "ON_ERROR_STOP=1",
               "-h", dsn.host, "-p", str(dsn.port), "-U", dsn.user, "-d", dsn.db,
               "-v", f"schema={dig(doc, 'database.schema')}",
               "-v", f"migration_role={dig(doc, 'roles.migration')}",
               "-v", f"runtime_role={dig(doc, 'roles.runtime')}",
               "-v", f"expected_user={dsn.user.split('.')[0] if dig(doc, 'database.connection_mode') == 'session-pooler' else dsn.user}",
               "-f", str(sql_file)]
        proc = subprocess.run(cmd, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    out = redact(proc.stdout, dsn)
    if proc.returncode != 0:
        # psql errors carry role/host names but never the password; it is redacted anyway and the text is bounded.
        print("verify failed to run:", redact(proc.stderr.strip(), dsn)[:400], file=sys.stderr)
        return 1
    bad = 0
    for line in out.splitlines():
        name, _, val = line.partition("|")
        if name.startswith("must.") and val != "t":
            bad += 1
            print(f"FAIL {name}")
        else:
            print(f"ok   {name}={val}" if name.startswith("info.") else f"ok   {name}")
    print(f"verify: {bad} failing must-check(s)")
    return 1 if bad else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("manifest")
        p.add_argument("--peer", help="the other app's manifest; refuses any shared identity")
        p.add_argument("--allow-local-test", action="store_true")

    p = sub.add_parser("validate"); common(p); p.add_argument("--check-files", action="store_true"); p.set_defaults(fn=cmd_validate)
    p = sub.add_parser("inventory"); common(p); p.add_argument("--json", action="store_true"); p.set_defaults(fn=cmd_inventory)
    p = sub.add_parser("dsn-check"); common(p); p.add_argument("--role", required=True, choices=["migration", "runtime"])
    p.add_argument("--dsn-file"); p.set_defaults(fn=cmd_dsn_check)
    p = sub.add_parser("render-env"); common(p); p.add_argument("--role", required=True, choices=["migration", "runtime"])
    p.set_defaults(fn=cmd_render_env)
    p = sub.add_parser("migrate"); common(p); p.add_argument("--migrate-bin", required=True)
    p.add_argument("--execute", action="store_true"); p.add_argument("--confirm-project"); p.set_defaults(fn=cmd_migrate)
    p = sub.add_parser("verify"); common(p); p.add_argument("--role", required=True, choices=["migration", "runtime"])
    p.add_argument("--execute", action="store_true"); p.add_argument("--confirm-project")
    p.add_argument("--psql-path", help="directory containing psql"); p.set_defaults(fn=cmd_verify)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
