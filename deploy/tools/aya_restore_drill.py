"""Deletion-safe restore drill of the local synthetic Compose stack (Phase 9), for Root to run.

    python3 -I deploy/tools/aya_restore_drill.py prepare [--port PORT] [--jose-util PATH]
    python3 -I deploy/tools/aya_restore_drill.py run DRILL_DIR
    python3 -I deploy/tools/aya_restore_drill.py status DRILL_DIR
    python3 -I deploy/tools/aya_restore_drill.py cleanup DRILL_DIR

prepare  creates the drill's private directory (0700) under .vps-runtime-20261018, named by its new label
         aya-amar-p9-drill-<UTC stamp>-<random>, for two NEW Compose projects of deploy/compose.yaml: <label>-src, a
         private source fixture with its own front on one free high loopback port (overlay restore/source.yaml), and
         <label>-tgt, the isolated restore target (overlay restore/target.yaml), which publishes no port at all. It
         generates both stacks' secrets (directories 0700, files 0600; never printed, never in an argument). The
         source gets its own role passwords, GoTrue ES256 signing key (pinned jose-util), admin credential, the
         read-only backup role's database URL for the ledger export, and four prepared .test users: o1 and o2, whose
         deletions become older history, A, deleted after the snapshot, and the bystander B. The target gets its own
         role passwords, byte copies of exactly the source's signing key, JWT secret and admin credential (so the
         restored Auth signs and verifies as the source did), the schema owner's database URL for the replay, and one
         placeholder user that is never created.
run      the drill, in order, stopping at the first failure, which it reports with every step not run:
           preserved_before        the Phase 8 stack and the services on 8087, 8088 and 8092, as found; read only
           source_start            the API image (with the ledger tool) built; the source started, its client
                                   authentication, migration and readiness through its front; READ COMMITTED as the
                                   transaction default of every role, overridden by no generated database URL
           source_history          o1 and o2 created through Auth's internal admin API, given an account, an adult
                                   profile with consent, an import and an event through the real API, then deleted
                                   through the API: the older tombstones
           source_fixtures         A (two sessions) and B (one) populated the same way; controls through the front;
                                   their credentials kept privately
           source_snapshot         pg_dump of aya_app and aya_auth as the read-only aya_backup role BEFORE A's deletion
           source_delete_a         A deleted through the API: rows erased, provider identity deleted, its old token
                                   and password refused at the source; B unchanged
           source_ledger           the newest ledger exported as aya_backup, read out, kept privately and checked: the
                                   three deletions, the older ones included, never B
           target_closed           the target started CLOSED: its database only, no published port, internal
                                   networks only, empty schemas, READ COMMITTED
           target_restore          both pre-deletion dumps restored, each in one transaction; A is back
           target_auth_controls    the target's Auth started; A's old access token, a control refresh token and A's
                                   password work there before the replay; A's second refresh token is never used
           target_replay           the replay of the newest ledger, the target's API still absent: it must exit 0
           target_open_internally  only then the target's API, on its internal networks only; the database checks
           target_denials          while A's old access token is unexpired: Auth's user_not_found, the API's 401, the
                                   unused refresh token not found, the password invalid; B's old token, documents and
                                   fresh login work and its rows and identity are unchanged; A's anchor and exact
                                   tombstone kept
           target_repeat           the replay again: nothing erased or changed but one counted provider attempt more
           target_re_erase         rows of A seeded beneath its confirmed tombstone, in the target only, then erased
                                   again by a third replay; B unchanged
           preserved_after         the Phase 8 stack, the older services and the source's B as before
         Both stacks stay up for review; `cleanup` removes them. A replay that does not exit 0 leaves the target closed
         and its reconciliation pending: run says so and exits 3. Any other failure exits 1.
status   the containers of both projects, with states and health.
cleanup  deletes the source's prepared identities by exact ID (404: already absent), removes both projects
         (containers, networks, volumes) and the source's API image after checking its label, then every secret,
         credential and drill file. The private snapshots, ledgers and reports stay.

The drill reuses deploy/tools/aya_stack.py, loaded by its absolute path and never changed: its Docker environment (the
anonymous CLI configuration), its pinned images, guards and checks. Every Docker command names one of the drill's two
projects; nothing is pulled, pruned or removed by pattern, and the Phase 8 stack and every other container, network,
volume and image are only ever read. Every subprocess and request is bounded in time. Evidence under
.vps-prep-evidence-20261018 holds names, states, statuses, counts, booleans and hashes only, scanned for every secret
and identifier of the drill before it is written; the private report under <drill>/reports holds the rest.
"""
from pathlib import Path
import argparse
import base64
import datetime
import hashlib
import http.client
import importlib.util
import json
import os
import re
import secrets
import shutil
import ssl
import subprocess
import sys
import time
import urllib.parse
import uuid

TOOLS = Path('/Users/amarmaruf/Documents/Codex/2026-10-13/task-2/ayailmu-backend-20261017/deploy/tools')


def load_stack_tool():
    """deploy/tools/aya_stack.py, by its absolute path: the drill reuses its guards, Docker environment and helpers."""
    spec = importlib.util.spec_from_file_location('aya_stack', TOOLS / 'aya_stack.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


aya = load_stack_tool()
Refused = aya.Refused

RESTORE = aya.DEPLOY / 'restore'
OVERLAYS = {'source': RESTORE / 'source.yaml', 'target': RESTORE / 'target.yaml'}
PREFIX = 'aya-amar-p9-drill-'
# Every Compose profile of each project: listing, logs and removal see them all; nothing ever starts them all.
PROFILES = {'source': ('ops', 'backup', 'drill'),
            'target': ('restored', 'drill', 'ops', 'backup', 'never-in-a-restore-target')}
# The Phase 8 stack and the older local services, which the drill only reads.
WATCHED_STACK = aya.RUNTIME / 'aya-amar-p8-stack-20261019t001346-a61a36'
OLD_SERVICES = (('preview8087', 'localhost', 8087, '/'), ('guest8088', '127.0.0.1', 8088, '/'),
                ('api8092', '127.0.0.1', 8092, '/v1/healthz'))
# The source's prepared users, in the order of their files: two older deletions, the deleted user and the bystander.
USERS = ('o1', 'o2', 'a', 'b')
OLDER = ('o1', 'o2')
DELETED = ('o1', 'o2', 'a')
# What each populated account owns: profiles, device links, events, imports.
OWNED = {'o1': (1, 1, 1, 1), 'o2': (1, 1, 1, 1), 'a': (1, 1, 2, 1), 'b': (1, 1, 3, 1)}
NOTHING = (0, 0, 0, 0)
# A's old access token (GoTrue issues it for an hour) must keep this long when the target starts, and this long at the
# denial, which therefore cannot be an expiry.
MIN_SECONDS_AT_TARGET = 900
MIN_SECONDS_AT_DENIAL = 60
MAX_REPLY_BYTES = 4 << 20
MAX_LEDGER_BYTES = 2 << 20
LEDGER_IN = '/ledger/in/ledger.json'
APP_TABLES = ('db.accounts', 'db.profiles', 'db.profile_sources', 'db.imports', 'db.events',
              'db.deletions_without_attempts')
SECRET_KEYS = ('d', 'password', 'email', 'access_token', 'refresh_token', 'held_refresh_token')

FAMILY = 'expo-trial-arabic'
CONSENT = {'version': 'trial-consent-1', 'at': '2026-10-15T00:00:00Z'}
NEW_ADULT = ('{"new_profile":{"kind":"adult","settings":{"instruction_lang":"id","session_minutes":10,'
             '"arabic_scale":1.25},"consent":{"version":"trial-consent-1","at":"2026-10-15T00:00:00Z"}}}')
# صَادِقٌ, assembled from code points so no editor or transport can alter it.
SADIQUN = ''.join(chr(code) for code in (0x0635, 0x064e, 0x0627, 0x062f, 0x0650, 0x0642, 0x064c))

UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
EXPORT_LINE = re.compile(r'^ayailmu-ledger: exported (\d+) deletions into a new private ledger file, sha256 ([0-9a-f]{64})$')
REPLAY_LINE = re.compile(r'^deletion ([0-9a-f-]{36}): account row (created|kept), tombstone (created|kept), erased again '
                         r'(\d+) profiles, (\d+) device links, (\d+) events, (\d+) imports; identity (deleted|pending: .+)$')
INSTANT = re.compile(r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$')
REPLAY_EXITS = {1: 'refused or failed before its COMMIT: nothing written, nothing asked of Auth',
                3: 'committed, but an identity deletion is pending',
                4: 'its COMMIT failed and its outcome is unknown'}

# The server's transaction defaults and every role- or database-level override of the isolation level.
ISOLATION_SQL = """\\set ON_ERROR_STOP on
SELECT 'isolation.server', setting, source FROM pg_settings WHERE name = 'default_transaction_isolation';
SELECT 'isolation.overrides', count(*) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) AS c(setting)
 WHERE c.setting ILIKE '%transaction_isolation%';
"""


# --- small helpers ---------------------------------------------------------------------------------------------------


def is_uuid(value):
    return isinstance(value, str) and UUID_RE.match(value) is not None


def doc(value):
    return value if isinstance(value, dict) else {}


def leaks(text, values):
    """How many of values text contains (0 is the only acceptable answer)."""
    return sum(1 for value in values if value in text)


def redact(text, values):
    for value in values:
        text = text.replace(value, '[REDACTED_DRILL_SECRET]')
    return text


def write_private_bytes(path, data):
    """A new 0600 file holding data; never overwrites."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(data)
    return path


def copy_private(source, target):
    return write_private_bytes(target, source.read_bytes())


def emit(document):
    print(json.dumps(document, indent=2))


def token_claims(token):
    """The header and claims of a token the drill's Auth issued: compared only, never verified or printed."""
    def decode(segment):
        return json.loads(base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4)))
    header, payload = token.split('.')[:2]
    return decode(header), decode(payload)


def instant(text):
    """An RFC 3339 time as PostgreSQL's JSON or the ledger writes it, as an aware datetime; None otherwise."""
    matched = INSTANT.match(text) if isinstance(text, str) else None
    if not matched:
        return None
    year, month, day, hour, minute, second = (int(matched.group(n)) for n in range(1, 7))
    fraction = int((matched.group(7) or '').ljust(6, '0')[:6])
    zone = matched.group(8)
    minutes = 0 if zone == 'Z' else (1 if zone[0] == '+' else -1) * (int(zone[1:3]) * 60 + int(zone[4:6]))
    return datetime.datetime(year, month, day, hour, minute, second, fraction,
                             tzinfo=datetime.timezone(datetime.timedelta(minutes=minutes)))


def same_instant(a, b):
    return instant(a) is not None and instant(a) == instant(b)


def http_status(host, port, path):
    """One bounded GET of an older local service, without credentials: its status, 0 without an answer."""
    connection = http.client.HTTPConnection(host, port, timeout=5)
    try:
        connection.request('GET', path, headers={'Accept': '*/*'})
        response = connection.getresponse()
        response.read(1 << 16)
        return response.status
    except (OSError, http.client.HTTPException):
        return 0
    finally:
        connection.close()


def answer_envelope(event_id, source, at):
    """An Expo v2 four-choice answer envelope exactly in the stored client shape, as verify-stack.cjs writes it."""
    timestamp = at.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    learner, install = source['local_profile_id'], source['install_id']
    payload = (
        '{"answer_id":"%s","learner_id":"%s","item_id":"A3-M01","content_version":"demo-synthetic-0.3",'
        '"rules_version":"pilot-0.3-local","app_version":"0.3.0","timestamp":"%s","local_date":"%s",'
        '"session_id":"ses-p9-1","pool":"PRACT","unit":"A","skills":["LEX-A:W-A3"],'
        '"raw_response":"{\\"kind\\":\\"choice\\",\\"option_id\\":\\"k\\"}","auto_score":{"answer":"correct"},'
        '"outcome":"correct","error_tags":[],"serious_tag":null,"hint_used":false,"help_lines_shown":[],'
        '"first_attempt":true,"fresh_evidence":true,"time_on_item_ms":5300,"audio_status":null,"report_flag":false,'
        '"review_status":"draft","synthetic":true,"answer_schema":2,"evidence_mode":"recognition-4",'
        '"lineage":"A:word-form:%s","role":"practice","presented_options":[{"id":"d2","text":"sahabat","position":0},'
        '{"id":"d3","text":"orang yang sakit","position":1},{"id":"k","text":"orang yang jujur","position":2},'
        '{"id":"d1","text":"orang yang bersedekah","position":3}],"selected_option_id":"k","selected_position":2,'
        '"misconceptions":[]}') % (event_id, learner, timestamp, timestamp[:10], SADIQUN)
    return ('{"envelope_version":1,"event_id":"%s","kind":"answer","schema":"expo.answer_record","schema_version":2,'
            '"curriculum":{"family":"%s","track":"arab","content_version":"demo-synthetic-0.3",'
            '"rules_version":"pilot-0.3-local"},"source":{"app":"expo","install_id":"%s","app_version":"0.3.0",'
            '"local_profile_id":"%s"},"payload":%s}') % (event_id, FAMILY, install, learner, payload)


# --- fingerprints, read as the bootstrap superuser over each stack's own database socket -----------------------------


def app_sql(accounts):
    """Per user key: count and digest of every app table's rows of the account (rows rendered by PostgreSQL itself, in
    UTC), its anchor and its tombstone; per table, the whole database; the deletion records without and with their
    attempts; the schema's migrations. Digests and counts only, besides the anchors' and tombstones' own fields."""
    lines = ['\\set ON_ERROR_STOP on', "SET TimeZone = 'UTC';"]
    for key, account in sorted(accounts.items()):
        if not is_uuid(account):
            raise Refused('an account ID is not a canonical UUID')
        where = "account_id = '%s'" % account
        for table in ('accounts', 'profiles', 'profile_sources', 'imports', 'account_deletions'):
            lines.append("SELECT 'app.%s.%s', count(*), coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') "
                         "FROM ayailmu.%s x WHERE x.%s;" % (key, table, table, where))
        lines.append("SELECT 'app.%s.events', count(*), coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') "
                     "FROM ayailmu.events x WHERE x.profile_id IN (SELECT profile_id FROM ayailmu.profiles WHERE %s);"
                     % (key, where))
        lines.append("SELECT 'anchor.%s', json_build_object('auth_mode', auth_mode, 'issuer', issuer, 'subject', subject, "
                     "'created_at', created_at)::text FROM ayailmu.accounts WHERE %s;" % (key, where))
        lines.append("SELECT 'tomb.%s', json_build_object('deletion_id', deletion_id, 'requested_at', requested_at, "
                     "'profiles', erased_profiles, 'device_links', erased_device_links, 'events', erased_events, "
                     "'imports', erased_imports, 'attempts', identity_attempts, 'deleted_at', identity_deleted_at, "
                     "'last_failure_at', identity_last_failure_at)::text FROM ayailmu.account_deletions WHERE %s;"
                     % (key, where))
    for table in ('accounts', 'profiles', 'profile_sources', 'imports', 'events'):
        lines.append("SELECT 'db.%s', count(*), coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') "
                     "FROM ayailmu.%s x;" % (table, table))
    lines.append("SELECT 'db.deletions_without_attempts', count(*), coalesce(md5(string_agg((to_jsonb(d) - "
                 "'identity_attempts')::text, '|' ORDER BY d.account_id)), '') FROM ayailmu.account_deletions d;")
    lines.append("SELECT 'db.deletion_attempts', coalesce(json_object_agg(account_id, identity_attempts "
                 "ORDER BY account_id), '{}')::text FROM ayailmu.account_deletions;")
    lines.append("SELECT 'db.migrations', coalesce(json_agg(version ORDER BY version), '[]')::text "
                 "FROM ayailmu.schema_migrations;")
    return '\n'.join(lines) + '\n'


def auth_sql(subjects, sessions):
    """Per user key: the identity's core (what a login never changes), its row without and with the last-login
    metadata, its identities, sessions and active refresh tokens; per kept session, its active refresh tokens. Counts
    and digests only."""
    lines = ['\\set ON_ERROR_STOP on', "SET TimeZone = 'UTC';"]
    for key, subject in sorted(subjects.items()):
        if not is_uuid(subject):
            raise Refused('a user ID is not a canonical UUID')
        lines.append("SELECT 'auth.%s.user_core', count(*), coalesce(md5(string_agg(jsonb_build_object('id', u.id, "
                     "'email', u.email, 'encrypted_password', u.encrypted_password, 'created_at', u.created_at, "
                     "'email_confirmed_at', u.email_confirmed_at, 'aud', u.aud, 'role', u.role, 'banned_until', "
                     "u.banned_until, 'deleted_at', u.deleted_at)::text, '|')), '') FROM auth.users u WHERE u.id = '%s';"
                     % (key, subject))
        lines.append("SELECT 'auth.%s.user_stable', count(*), coalesce(md5(string_agg((to_jsonb(u) - 'last_sign_in_at' - "
                     "'updated_at')::text, '|')), '') FROM auth.users u WHERE u.id = '%s';" % (key, subject))
        lines.append("SELECT 'auth.%s.user_full', count(*), coalesce(md5(string_agg(to_jsonb(u)::text, '|')), '') "
                     "FROM auth.users u WHERE u.id = '%s';" % (key, subject))
        lines.append("SELECT 'auth.%s.identities', count(*), '' FROM auth.identities i WHERE i.user_id = '%s';"
                     % (key, subject))
        lines.append("SELECT 'auth.%s.sessions', count(*), '' FROM auth.sessions s WHERE s.user_id = '%s';"
                     % (key, subject))
        lines.append("SELECT 'auth.%s.active_refresh_tokens', count(*), '' FROM auth.refresh_tokens r "
                     "WHERE r.user_id = '%s' AND r.revoked IS NOT TRUE;" % (key, subject))
    for name, session in sorted(sessions.items()):
        if not is_uuid(session):
            raise Refused('a session ID is not a canonical UUID')
        lines.append("SELECT 'auth.session.%s.active_refresh_tokens', count(*), '' FROM auth.refresh_tokens r "
                     "WHERE r.session_id = '%s' AND r.revoked IS NOT TRUE;" % (name, session))
    lines.append("SELECT 'auth.all.users', count(*), '' FROM auth.users;")
    return '\n'.join(lines) + '\n'


def seed_sql(account, profile, tag):
    """Controlled rows of the deleted user A, written straight into the THROWAWAY target only, beneath A's existing
    confirmed tombstone: one profile with one device link, one import and two events, as ledger_test.go seeds them."""
    if not (is_uuid(account) and is_uuid(profile) and re.match(r'^[0-9a-f]{8}$', tag)):
        raise Refused('the seed rows were given an unusable identifier')
    install, learner, imported = 'inst-p9-seed-' + tag, 'lrn-p9-seed-' + tag, 'imp-p9-seed-' + tag
    lines = [
        '\\set ON_ERROR_STOP on',
        'BEGIN;',
        "INSERT INTO ayailmu.profiles (profile_id, account_id, kind, consent_version, consent_at) "
        "VALUES ('%s', '%s', 'adult', 'trial-consent-1', now());" % (profile, account),
        "INSERT INTO ayailmu.profile_sources (account_id, profile_id, app, install_id, local_profile_id) "
        "VALUES ('%s', '%s', 'expo', '%s', '%s');" % (account, profile, install, learner),
        "INSERT INTO ayailmu.imports (account_id, import_id, request_sha256, profile_id, receipt) "
        "VALUES ('%s', '%s', decode(repeat('ab', 32), 'hex'), '%s', '{}');" % (account, imported, profile),
    ]
    for seq in (1, 2):
        lines.append(
            "INSERT INTO ayailmu.events (profile_id, seq, event_id, kind, record_schema, schema_version, family, track, "
            "content_version, rules_version, curriculum_status, occurred_at, local_date, payload_raw, semantic_sha256, "
            "source_app, source_install_id, source_app_version, source_local_profile_id, import_id) VALUES ('%s', %d, "
            "'evt-p9-seed-%s-%d', 'answer', 'aya.answer', 1, 'arab', 'core', 'c1', 'r1', 'registered', now(), "
            "current_date, '{}', decode(repeat('cd', 32), 'hex'), 'expo', '%s', '1.0.0', '%s', '%s');"
            % (profile, seq, tag, seq, install, learner, imported))
    lines.append('COMMIT;')
    return '\n'.join(lines) + '\n'


def count(rows, name):
    value = rows.get(name)
    try:
        return int(value.split('|')[0]) if value is not None else None
    except ValueError:
        return None


def subset(rows, prefix):
    return {name: value for name, value in rows.items() if name.startswith(prefix)}


def owned_counts(rows, key):
    return tuple(count(rows, 'app.%s.%s' % (key, table)) for table in ('profiles', 'profile_sources', 'events', 'imports'))


def row_document(rows, name):
    value = rows.get(name)
    try:
        return json.loads(value) if value else {}
    except ValueError:
        return {}


def erased_of(record):
    return (record.get('profiles'), record.get('device_links'), record.get('events'), record.get('imports'))


# --- secrets ---------------------------------------------------------------------------------------------------------


def secret_values(drill):
    """Every secret and credential the drill holds, longest first, for redaction and leak scans only; never printed:
    both stacks' role passwords, database URLs, keys, JWT secret and admin credential, the users' addresses and
    passwords, and every token the run kept."""
    values = set()

    def add(value):
        if isinstance(value, str) and len(value.strip()) >= 8:
            values.add(value.strip())

    roots = [drill.private / role / name for role in ('source', 'target') for name in ('secrets', 'keys', 'drill-files')]
    roots.append(drill.private / 'credentials')
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob('*')):
            if path.is_symlink() or not path.is_file() or path.parent.name == 'ledger-in':
                continue
            text = path.read_text(errors='replace').strip()
            if path.name.endswith('.json'):
                try:
                    document = json.loads(text)
                except ValueError:
                    add(text)
                    continue
                for item in (document if isinstance(document, list) else [document]):
                    for key in SECRET_KEYS:
                        add(doc(item).get(key))
            elif path.name == 'pgpass':
                for line in text.splitlines():
                    add(line.rsplit(':', 1)[-1])
            elif path.name.endswith('.header') or path.name == 'admin-header':
                add(text.split('Bearer ', 1)[-1])
            else:
                add(text)
                if path.name == 'database-url':
                    add(urllib.parse.urlsplit(text).password)
    return sorted(values, key=len, reverse=True)


# --- the drill and its two stacks ------------------------------------------------------------------------------------


class Drill:
    """The drill's private directory and receipt (manifest.json, 0600): labels, port, state, history, the source
    users' IDs and the artifacts' hashes. No secret."""

    def __init__(self, private, manifest):
        self.private, self.manifest = private, manifest

    @classmethod
    def new(cls, port):
        label = PREFIX + aya.stamp() + '-' + secrets.token_hex(3)
        private = aya.private_dir(aya.RUNTIME / label)
        manifest = {'label': label, 'port': port, 'source_project': label + '-src', 'target_project': label + '-tgt',
                    'issuer': aya.ISSUER, 'audience': aya.AUDIENCE, 'images': aya.IMAGES, 'created_at': aya.now_iso(),
                    'state': 'preparing', 'history': []}
        drill = cls(private, manifest)
        drill.record()
        return drill

    @classmethod
    def load(cls, path):
        private = Path(path).resolve(strict=True)
        if private.parent != aya.RUNTIME.resolve() or not private.name.startswith(PREFIX):
            raise SystemExit('refusing: not a drill directory of this helper')
        info = private.stat()
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise SystemExit('refusing: the drill directory is not private to this user')
        manifest = json.loads((private / 'manifest.json').read_text())
        if manifest.get('label') != private.name:
            raise SystemExit('refusing: the manifest does not belong to this directory')
        return cls(private, manifest)

    label = property(lambda self: self.manifest['label'])
    port = property(lambda self: int(self.manifest['port']))

    def side(self, role):
        return Side(self, role)

    def record(self):
        temporary = self.private / 'manifest.json.tmp'
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(self.manifest, handle, indent=2)
        os.replace(temporary, self.private / 'manifest.json')

    def note(self, action, **facts):
        self.manifest['history'].append(dict(facts, action=action, at=aya.now_iso()))
        self.record()


class Side(aya.Stack):
    """One Compose project of the drill, the source fixture or the restore target: compose.yaml plus its overlay, with
    its own env file, secrets and drill files under <drill>/<role>. It reuses aya_stack.Stack's checks (container
    states, client authentication, the proxy root, the front, leftovers) for its own project only."""

    def __init__(self, drill, role):
        project = drill.manifest['%s_project' % role]
        super().__init__(drill.private / role, {'label': project, 'project': project, 'port': drill.port,
                                                'api_image': aya.API_IMAGE_REPOSITORY + ':' + project})
        self.drill, self.role = drill, role
        self.overlay = OVERLAYS[role]
        self.profiles = PROFILES[role]

    files_dir = property(lambda self: self.private / 'drill-files')

    def compose_args(self, *args, profiles=()):
        chosen = [item for name in profiles for item in ('--profile', name)]
        return [aya.DOCKER, 'compose', '--project-name', self.project, '--project-directory', str(aya.DEPLOY),
                '--file', str(aya.COMPOSE_FILE), '--file', str(self.overlay), '--env-file', str(self.env_file),
                *chosen, *args]

    def compose(self, *args, input=None, timeout=300, profiles=()):
        return subprocess.run(self.compose_args(*args, profiles=profiles), env=aya.DOCKER_ENV, input=input, text=True,
                              capture_output=True, timeout=timeout)

    def ps(self):
        listed = self.compose('ps', '--all', '--format', 'json', timeout=60, profiles=self.profiles)
        aya.require(listed, 'list the %s containers' % self.role)
        by_service = {}
        for entry in aya.parse_json_lines(listed.stdout):
            if entry.get('Project', self.project) == self.project:
                by_service.setdefault(entry.get('Service'), []).append(entry)
        return by_service

    def secret_values(self):
        return secret_values(self.drill)

    def write_log(self, name, text):
        logs = self.private / 'logs'
        if not logs.exists():
            aya.private_dir(logs)
        path = logs / ('%s-%s-%s-redacted.log' % (aya.stamp(), name, secrets.token_hex(2)))
        aya.write_private(path, redact(text, secret_values(self.drill)))
        return path.name

    def save_logs(self):
        saved = []
        for service in aya.ONE_SHOT + aya.LONG_RUNNING + ('aya-drill-init',):
            result = self.compose('logs', '--no-color', '--timestamps', service, timeout=60, profiles=self.profiles)
            if result.returncode == 0:
                saved.append(self.write_log(service, result.stdout + '\n' + result.stderr))
        return saved

    def remove_owned(self):
        """docker compose down --volumes for this project only (every profile), then, for the source, its API image
        after checking its label. The target owns no image: it ran the source's."""
        report = {}
        if self.env_file.is_file():
            down = self.compose('down', '--volumes', '--remove-orphans', '--timeout', '30', timeout=300,
                                profiles=self.profiles)
            report['compose_down'] = 'ok' if down.returncode == 0 else 'failed'
        else:
            report['compose_down'] = 'ok' if not any(self.leftovers().values()) else 'failed: stack.env is gone'
        if self.role == 'source':
            labelled = aya.docker('image', 'inspect', '--format', '{{index .Config.Labels "aya.stack"}}', self.api_image)
            if labelled.returncode:
                report['api_image'] = 'absent'
            elif labelled.stdout.strip() != self.label:
                report['api_image'] = 'kept: not labelled for this stack'
            else:
                report['api_image'] = 'removed' if aya.docker('image', 'rm', self.api_image).returncode == 0 \
                    else 'removal failed'
        else:
            report['api_image'] = 'none: the target ran the source image'
        report['leftovers'] = self.leftovers()
        return report


def psql(side, database, sql, timeout=120):
    """sql on stdin of psql as the bootstrap superuser over the side's own database socket: its name|value lines."""
    ran = side.compose('exec', '-T', 'aya-db', 'psql', '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-U',
                       'postgres', '-d', database, '-f', '-', input=sql, timeout=timeout)
    if ran.returncode:
        side.write_log('psql-' + database, ran.stdout + '\n' + ran.stderr)
        raise Refused('a database query of the %s failed' % side.role)
    rows = {}
    for line in ran.stdout.splitlines():
        if '|' in line:
            name, value = line.split('|', 1)
            rows[name] = value
    return rows


def wait_services(side, exited=(), healthy=(), seconds=420):
    """Waits until every one-shot of exited has exited 0 and every service of healthy runs healthy; a one-shot that
    failed, or a service that stopped or turned unhealthy, refuses at once."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        services = side.ps()
        for name in exited:
            if any(entry.get('State') == 'exited' and int(entry.get('ExitCode', 1)) != 0 for entry in services.get(name, [])):
                raise Refused('%s %s exited with an error' % (side.role, name))
        for name in healthy:
            for entry in services.get(name, []):
                if entry.get('State') in ('exited', 'dead') or entry.get('Health') == 'unhealthy':
                    raise Refused('%s %s stopped or is unhealthy' % (side.role, name))
        done = all(any(entry.get('State') == 'exited' and int(entry.get('ExitCode', 1)) == 0
                       for entry in services.get(name, [])) for name in exited)
        ready = all(any(entry.get('State') == 'running' and entry.get('Health') == 'healthy'
                        for entry in services.get(name, [])) for name in healthy)
        if done and ready:
            return
        time.sleep(3)
    raise Refused('the %s did not reach the expected state in time' % side.role)


class Front:
    """HTTPS to the source's front from this process, trusting only the source's exported root: the front's name is the
    SNI, the certificate name checked and the Host; no proxy, no redirect, a bounded reply. A token is only ever in an
    Authorization header and a password only in a request body, never in a URL."""

    def __init__(self, side):
        self.port = side.port
        self.context = ssl.create_default_context(cafile=str(side.root_cert))

    def request(self, name, method, path, body=None, headers=None):
        connection = aya.FrontConnection(name, self.port, self.context, timeout=15)
        try:
            sent = {'Accept': 'application/json'}
            sent.update(headers or {})
            data = None
            if body is not None:
                data = body.encode('utf-8')
                sent.setdefault('Content-Type', 'application/json')
            connection.request(method, path, body=data, headers=sent)
            response = connection.getresponse()
            raw = response.read(MAX_REPLY_BYTES + 1)
            if len(raw) > MAX_REPLY_BYTES:
                raise Refused('a reply of the source front was larger than any expected')
            try:
                document = json.loads(raw) if raw else None
            except ValueError:
                document = None
            return response.status, {k.lower(): v for k, v in response.getheaders()}, document, raw
        finally:
            connection.close()

    def api(self, method, path, token=None, body=None, headers=None):
        sent = dict(headers or {})
        if token:
            sent['Authorization'] = 'Bearer ' + token
        return self.request(aya.API_HOST, method, path, body, sent)

    def auth(self, method, path, token=None, body=None):
        return self.request(aya.AUTH_HOST, method, path, body, {'Authorization': 'Bearer ' + token} if token else None)


def observe_preserved():
    """The older services' statuses and the Phase 8 stack's readiness and running containers, read only."""
    found = {'old_services': {name: http_status(host, port, path) for name, host, port, path in OLD_SERVICES}}
    try:
        stack = aya.Stack.load(WATCHED_STACK)
        watched = {'readiness': stack.readiness(),
                   'containers': sorted(entry.get('ID') for entries in stack.ps().values() for entry in entries
                                        if entry.get('State') == 'running')}
        code, _, document = stack.front(aya.API_HOST, '/v1/readyz')
        watched['readiness_through_front'] = code if document == {'status': 'ready'} else 'not ready (%d)' % code
        found['phase8_stack'] = watched
    except BaseException as error:
        found['phase8_stack'] = {'unavailable': str(error) if isinstance(error, (Refused, SystemExit))
                                 else type(error).__name__}
    return found


def public_preserved(found):
    watched = dict(found['phase8_stack'])
    containers = watched.pop('containers', None)
    if containers is not None:
        watched['running_containers'] = len(containers)
        watched['container_set_sha256'] = hashlib.sha256('\n'.join(containers).encode()).hexdigest()
    return {'old_services': found['old_services'], 'phase8_stack': watched}


def write_evidence(drill, action, document, identifiers, values=None):
    """A sanitized evidence summary, refused if it names any secret or identifier of the drill."""
    path = aya.EVIDENCE / ('phase9-restore-%s-%s.json' % (drill.label, action))
    text = json.dumps(dict(label=drill.label, at=aya.now_iso(), **document), indent=2) + '\n'
    if leaks(text, (secret_values(drill) if values is None else values) + list(identifiers)):
        raise Refused('an evidence summary would have carried a secret or an identifier')
    path.write_text(text)
    return path


# --- the run ---------------------------------------------------------------------------------------------------------

STEPS = ('preserved_before', 'source_start', 'source_history', 'source_fixtures', 'source_snapshot', 'source_delete_a',
         'source_ledger', 'target_closed', 'target_restore', 'target_auth_controls', 'target_replay',
         'target_open_internally', 'target_denials', 'target_repeat', 'target_re_erase', 'preserved_after')


class Run:
    def __init__(self, drill):
        self.drill = drill
        self.source, self.target = drill.side('source'), drill.side('target')
        self.stamp = aya.stamp()
        self.status = dict((name, 'not run') for name in STEPS)
        self.current = None
        self.checks = []
        self.private = {}   # the private report: identifiers, digests, fingerprints and every outcome
        self.public = {}    # the evidence: statuses, counts, booleans and hashes only
        self.failure = None
        self.pending = None
        self.front = None
        self.users = dict((key, json.loads((self.source.secrets_dir / ('ops/users/user-%d.json' % n)).read_text()))
                          for n, key in enumerate(USERS, 1))
        self.ids, self.accounts, self.profiles, self.deletions, self.sessions = {}, {}, {}, {}, {}
        self.tokens = {}
        self.fp = {}
        self.b_documents = {}
        self.snapshot_dir, self.snapshot_hashes = None, {}
        self.ledger, self.ledger_raw, self.deletion_keys = None, None, {}
        self.a_access_expires = None

    # --- bookkeeping ---

    def check(self, name, ok):
        self.checks.append({'step': self.current, 'name': name, 'pass': bool(ok)})
        if not ok:
            raise Refused('check failed: ' + name)

    def identifiers(self):
        """IDs of the drill's users, accounts, profiles, sessions and deletions: private, so no evidence names one."""
        found = set()
        for mapping in (self.ids, self.accounts, self.profiles, self.deletions, self.sessions):
            found.update(value for value in mapping.values() if isinstance(value, str) and len(value) >= 8)
        return sorted(found, key=len, reverse=True)

    def execute(self):
        for name in STEPS:
            self.current = name
            self.status[name] = 'running'
            try:
                getattr(self, name)()
            except BaseException as error:
                self.status[name] = 'failed'
                self.failure = {'step': name, 'reason': str(error) if isinstance(error, Refused) else type(error).__name__}
                break
            self.status[name] = 'passed'
        return self.finish()

    def finish(self):
        failed = self.failure is not None
        if failed:
            saved = {}
            for side in (self.source, self.target):
                try:
                    saved[side.role] = side.save_logs() if side.env_file.is_file() else []
                except BaseException as error:
                    saved[side.role] = 'logs not saved: ' + type(error).__name__
            self.private['saved_logs'] = saved
        if not failed:
            state = 'run passed'
        elif self.pending:
            state = 'replay not confirmed; reconciliation pending'
        else:
            state = 'run failed at ' + self.failure['step']
        values = secret_values(self.drill)
        report = {'run': self.stamp, 'state': state, 'steps': self.status, 'failure': self.failure,
                  'pending_reconciliation': self.pending, 'checks': self.checks, 'facts': self.private,
                  'public_facts': self.public}
        text = json.dumps(report, indent=2, default=str) + '\n'
        if leaks(text, values):
            text = redact(text, values)
            state += '; the private report had to be redacted'
        path = aya.write_private(self.drill.private / 'reports' / ('run-%s.json' % self.stamp), text)
        failed_checks = [entry['name'] for entry in self.checks if not entry['pass']]
        evidence = {'run': self.stamp, 'state': state, 'result': 'fail' if failed else 'pass', 'steps': self.status,
                    'failure': self.failure, 'pending_reconciliation': self.pending,
                    'checks_passed': sum(1 for entry in self.checks if entry['pass']), 'checks_total': len(self.checks),
                    'failed_checks': failed_checks, 'checks': self.checks, 'facts': self.public,
                    'private_report': str(path.relative_to(self.drill.private))}
        written = write_evidence(self.drill, 'run-' + self.stamp, evidence, self.identifiers(), values)
        self.drill.manifest.update(state=state, last_run=self.stamp)
        self.drill.note('run', state=state, failure=self.failure, pending=self.pending)
        emit({'label': self.drill.label, 'run': self.stamp, 'state': state, 'steps': self.status,
              'failure': self.failure, 'pending_reconciliation': self.pending,
              'checks': '%d/%d' % (evidence['checks_passed'], evidence['checks_total']), 'failed_checks': failed_checks,
              'evidence': str(written), 'private_report': str(path),
              'next': 'review, then: python3 -I deploy/tools/aya_restore_drill.py cleanup ' + str(self.drill.private)})
        if not failed:
            return 0
        return 3 if self.pending else 1

    # --- shared steps ---

    def transaction_defaults(self, side):
        """READ COMMITTED as the server's transaction default, no role or database overriding the isolation level,
        and every database URL the drill generated for this stack carrying nothing but sslmode=disable."""
        rows = psql(side, 'postgres', ISOLATION_SQL)
        server = rows.get('isolation.server', '').split('|')
        overrides = rows.get('isolation.overrides', '').split('|')[0]
        queries = {}
        for path in sorted(list(side.secrets_dir.rglob('database-url')) + list(side.files_dir.rglob('database-url'))):
            queries[str(path.relative_to(side.private))] = urllib.parse.urlsplit(path.read_text().strip()).query
        found = {'server_default': server[0], 'server_default_source': server[1] if len(server) > 1 else None,
                 'role_or_database_overrides': overrides,
                 'database_urls_carry_only_sslmode_disable': dict((name, query == 'sslmode=disable')
                                                                  for name, query in queries.items())}
        self.public['%s_transaction_defaults' % side.role] = found
        self.check('%s.server_transaction_default_is_read_committed' % side.role, server[0] == 'read committed')
        self.check('%s.no_role_or_database_overrides_the_isolation' % side.role, overrides == '0')
        self.check('%s.generated_database_urls_override_no_setting' % side.role,
                   bool(queries) and all(found['database_urls_carry_only_sslmode_disable'].values()))

    def fingerprints(self, side):
        accounts = dict((key, value) for key, value in self.accounts.items() if is_uuid(value))
        subjects = dict((key, value) for key, value in self.ids.items() if is_uuid(value))
        sessions = dict((key, value) for key, value in self.sessions.items() if is_uuid(value))
        return {'app': psql(side, 'aya_app', app_sql(accounts)), 'auth': psql(side, 'aya_auth', auth_sql(subjects, sessions))}

    def sign_in(self, key, purpose):
        """A password sign-in through the source's front; its token is the user's, under the stack's issuer, audience
        and signing key."""
        status, document = self.password_grant(key)
        self.check('%s.%s_password_sign_in_at_the_source' % (key, purpose),
                   status == 200 and all(isinstance(document.get(name), str) and document.get(name)
                                         for name in ('access_token', 'refresh_token')))
        header, claims = token_claims(document['access_token'])
        audience = claims.get('aud') if isinstance(claims.get('aud'), list) else [claims.get('aud')]
        self.check('%s.%s_token_is_the_users_under_the_stack_issuer_audience_and_key' % (key, purpose),
                   claims.get('sub') == self.ids[key] and claims.get('iss') == aya.ISSUER and aya.AUDIENCE in audience and
                   header.get('alg') == 'ES256' and header.get('kid') == self.drill.manifest.get('signing_kid') and
                   is_uuid(claims.get('session_id')))
        return document

    def password_grant(self, key):
        user = self.users[key]
        status, _, document, _ = self.front.auth('POST', '/token?grant_type=password',
                                                 body=json.dumps({'email': user['email'], 'password': user['password']}))
        return status, doc(document)

    def populate(self, key, token):
        """Through the source's front and API: the account, a guest import of an adult profile with its consent and its
        first event, a settings patch, the remaining events, then a pull and progress that show them all."""
        events = OWNED[key][2]
        api = self.front.api
        status, _, me, _ = api('GET', '/v1/me', token)
        self.check('%s.me_creates_its_account' % key,
                   status == 200 and is_uuid(doc(me).get('account_id')) and doc(me).get('profiles') == [])
        account = me['account_id']
        source = {'app': 'expo', 'install_id': 'inst-p9-' + secrets.token_hex(8),
                  'local_profile_id': 'lrn-p9-' + secrets.token_hex(8)}
        first = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0) - datetime.timedelta(hours=1)
        ids = ['evt-p9-' + secrets.token_hex(10) for _ in range(events)]
        body = '{"import_id":"imp-p9-%s","source":%s,"target":%s,"events":[%s]}' % (
            secrets.token_hex(10), json.dumps(source, separators=(',', ':')), NEW_ADULT,
            answer_envelope(ids[0], source, first))
        status, _, receipt, _ = api('POST', '/v1/imports', token, body)
        receipt = doc(receipt)
        self.check('%s.import_201_adult_profile_with_consent_and_its_first_event' % key,
                   status == 201 and receipt.get('profile_created') is True and receipt.get('stored') == 1 and
                   receipt.get('event_ids_sha256') == hashlib.sha256(ids[0].encode()).hexdigest() and
                   is_uuid(receipt.get('profile_id')))
        profile = receipt['profile_id']
        status, headers, document, _ = api('GET', '/v1/profiles/' + profile, token)
        document = doc(document)
        self.check('%s.profile_is_adult_with_the_consent' % key,
                   status == 200 and document.get('kind') == 'adult' and
                   doc(document.get('consent')).get('version') == CONSENT['version'] and headers.get('etag') == '"r1"')
        status, _, document, _ = api('PATCH', '/v1/profiles/' + profile, token, '{"settings":{"session_minutes":15}}',
                                     {'Content-Type': 'application/merge-patch+json', 'If-Match': '"r1"'})
        self.check('%s.settings_patch_makes_revision_2' % key, status == 200 and doc(document).get('revision') == 2)
        for n, event in enumerate(ids[1:], 1):
            envelope = answer_envelope(event, source, first + datetime.timedelta(minutes=n))
            status, _, document, _ = api('POST', '/v1/profiles/%s/events' % profile, token, '{"events":[%s]}' % envelope)
            results = doc(document).get('results')
            self.check('%s.event_upload_stored' % key, status == 200 and isinstance(results, list) and len(results) == 1
                       and doc(results[0]).get('result') == 'stored')
        status, _, document, _ = api('GET', '/v1/profiles/%s/events?after=0' % profile, token)
        pulled = [doc(event).get('event_id') for event in (doc(document).get('events') or [])]
        self.check('%s.pull_returns_every_event_in_order' % key, status == 200 and pulled == ids)
        status, _, document, _ = api('GET', '/v1/profiles/%s/progress?family=%s' % (profile, FAMILY), token)
        self.check('%s.progress_counts_every_event' % key, status == 200 and doc(document).get('events') == events)
        return account, profile

    def delete_at_source(self, key):
        """The user's account deleted through the source's API with a fresh password sign-in (the API wants one within
        five minutes): its server data erased and its provider identity deleted, confirmed."""
        session = self.sign_in(key, 'deletion')
        token = session['access_token']
        status, _, me, _ = self.front.api('GET', '/v1/me', token)
        self.check('%s.signs_in_again_to_the_same_account' % key,
                   status == 200 and doc(me).get('account_id') == self.accounts[key])
        status, _, document, _ = self.front.api('POST', '/v1/me/deletion', token,
                                                json.dumps({'confirm': 'delete-account', 'account_id': self.accounts[key]}))
        document = doc(document)
        self.check('%s.deletion_completed_data_erased_identity_deleted' % key,
                   status == 200 and document.get('status') == 'completed' and
                   document.get('account_id') == self.accounts[key] and
                   doc(document.get('server_data')).get('status') == 'erased' and
                   doc(document.get('identity_provider')).get('status') == 'deleted' and
                   is_uuid(document.get('deletion_id')))
        self.deletions[key] = document['deletion_id']

    def probe(self, *args):
        """One aya-probe run on the target's internal networks: its last line, split."""
        ran = self.target.compose('run', '--rm', '--no-deps', '-T', 'aya-probe', *args, timeout=120, profiles=('drill',))
        self.check('probe.output_holds_no_secret', leaks(ran.stdout + ran.stderr, secret_values(self.drill)) == 0)
        lines = [line.split() for line in ran.stdout.splitlines() if line.strip()]
        outcome = lines[-1] if lines else ['probe', 'none', '-']
        self.private.setdefault('probes', []).append({'step': self.current, 'args': list(args),
                                                      'exit_code': ran.returncode, 'outcome': outcome})
        return outcome

    def replay(self, name):
        """One replay of the newest ledger into the target: its lines by user key. Any exit but 0 stops the drill with
        the target's reconciliation pending."""
        ran = self.target.compose('run', '--rm', '--no-deps', '-T', 'aya-ledger-replay', LEDGER_IN, timeout=900,
                                  profiles=('drill',))
        values = secret_values(self.drill)
        self.check('replay.%s.output_holds_no_secret' % name, leaks(ran.stdout + ran.stderr, values) == 0)
        lines = {}
        for line in ran.stdout.splitlines():
            matched = REPLAY_LINE.match(line.strip())
            if matched:
                lines[matched.group(1)] = {'account_row': matched.group(2), 'tombstone': matched.group(3),
                                           'erased': tuple(int(matched.group(n)) for n in range(4, 8)),
                                           'identity': matched.group(8)}
        by_key = dict((self.deletion_keys.get(deletion, 'unknown'), line) for deletion, line in lines.items())
        self.private.setdefault('replays', {})[name] = {'exit_code': ran.returncode, 'lines': lines,
                                                        'stdout': ran.stdout, 'stderr': redact(ran.stderr, values)}
        self.public.setdefault('replays', {})[name] = {
            'exit_code': ran.returncode,
            'deletions': dict((key, dict(line, erased=list(line['erased']))) for key, line in by_key.items())}
        if ran.returncode != 0:
            meaning = REPLAY_EXITS.get(ran.returncode, 'an unexpected exit')
            if name == 'first':
                after = 'the target stays closed: its API was never started'
            else:
                after = "the target's API, opened internally after the first replay exited 0, was left as it was"
            self.pending = 'the %s replay exited %d (%s); %s; operator reconciliation is pending' % (
                name, ran.returncode, meaning, after)
            raise Refused('the %s replay exited %d' % (name, ran.returncode))
        return by_key

    def expect_replay(self, name, by_key, expected):
        """expected: user key -> (account row, tombstone, rows erased again); every identity deleted at the target."""
        self.check('replay.%s.one_line_per_ledger_deletion' % name, sorted(by_key) == sorted(DELETED))
        for key, (account_row, tombstone, erased) in sorted(expected.items()):
            line = by_key[key]
            self.check('replay.%s.%s_account_row_%s_tombstone_%s' % (name, key, account_row, tombstone),
                       line['account_row'] == account_row and line['tombstone'] == tombstone)
            self.check('replay.%s.%s_erased_again_%s' % (name, key, '_'.join(str(n) for n in erased)),
                       line['erased'] == tuple(erased))
            self.check('replay.%s.%s_identity_deleted_at_the_target_auth' % (name, key), line['identity'] == 'deleted')

    def ledger_entry(self, key):
        return dict((entry.get('account_id'), entry) for entry in self.ledger['deletions'])[self.accounts[key]]

    def exposure(self, phase, allowed):
        """The target's services exactly within allowed, no container publishing any port, every network internal."""
        target = self.target
        services = target.ps()
        self.check('target.%s.runs_nothing_beyond_its_phase' % phase, set(services) <= set(allowed))
        listed = aya.require(aya.docker('ps', '--all', '--quiet', '--filter', 'label=aya.stack=' + target.label),
                             'list the target containers')
        containers = listed.stdout.split()
        published = 0
        for container in containers:
            info = json.loads(aya.require(aya.docker('inspect', container), 'inspect a target container').stdout)[0]
            bindings = doc(doc(info.get('HostConfig')).get('PortBindings'))
            ports = doc(doc(info.get('NetworkSettings')).get('Ports'))
            if any(bindings.values()) or any(ports.values()):
                published += 1
        networks = aya.require(aya.docker('network', 'ls', '--quiet', '--filter', 'label=aya.stack=' + target.label),
                               'list the target networks').stdout.split()
        routed = 0
        for network in networks:
            inspected = aya.docker('network', 'inspect', '--format', '{{.Internal}}', network)
            if inspected.returncode or inspected.stdout.strip() != 'true':
                routed += 1
        self.public.setdefault('target_exposure', {})[phase] = {
            'services': sorted(services), 'containers': len(containers), 'containers_publishing_a_port': published,
            'networks': len(networks), 'networks_with_a_route_out': routed}
        self.check('target.%s.publishes_no_port' % phase, published == 0)
        self.check('target.%s.has_only_internal_networks' % phase, routed == 0)

    # --- the steps ---

    def preserved_before(self):
        found = observe_preserved()
        self.private['preserved_before'] = found
        self.public['preserved_before'] = public_preserved(found)

    def source_start(self):
        source = self.source
        self.public['source_fixture_reason'] = (
            'the deploy wiring adds the ledger tool to the API image, so the running Phase 8 stack no longer matches '
            'its recorded deploy hashes; the drill builds a new private source fixture and leaves that stack as it is')
        self.public['hba_initializer'] = aya.hba_initializer_mode()
        built = source.compose('build', 'aya-api', timeout=1800)
        source.write_log('build', built.stdout + '\n' + built.stderr)
        aya.require(built, 'build the API image')
        image = aya.docker('image', 'inspect', '--format', '{{.Id}} {{index .Config.Labels "aya.stack"}} {{.Config.User}}',
                           source.api_image)
        aya.require(image, 'inspect the API image')
        image_id, image_label, image_user = (image.stdout.split() + ['', '', ''])[:3]
        self.check('source.api_image_built_labelled_and_running_as_65532',
                   image_label == source.label and image_user == '65532:65532')
        self.public['api_image_id'] = image_id
        self.drill.manifest['api_image_id'] = image_id
        self.drill.record()
        aya.require(source.compose('up', '--detach', '--no-build', timeout=600), 'start the source')
        source.wait_ready()
        wait_services(source, exited=('aya-drill-init',))
        self.public['source_client_authentication'] = source.enforced_hba()
        migrated = source.compose('logs', '--no-color', '--no-log-prefix', 'aya-migrate', timeout=60)
        lines = [line.strip() for line in migrated.stdout.splitlines() if line.strip()]
        self.check('source.migration_job_printed_schema_version_3', bool(lines) and lines[-1] == aya.SCHEMA_VERSION)
        self.public['source_proxy_root_sha256'] = source.export_root()
        status, _, document = source.front(aya.API_HOST, '/v1/readyz')
        self.check('source.ready_through_its_own_front', status == 200 and document == {'status': 'ready'})
        self.front = Front(source)
        self.transaction_defaults(source)

    def source_history(self):
        made = self.source.compose('run', '--rm', '--no-deps', '-T', 'aya-users', 'create', timeout=120,
                                   profiles=('ops',))
        files = dict(('user-%d.json' % n, key) for n, key in enumerate(USERS, 1))
        for line in made.stdout.splitlines():
            parts = line.split()
            if len(parts) == 4 and parts[0] == 'create' and parts[1] in files and parts[2] == '200' and is_uuid(parts[3]):
                self.ids[files[parts[1]]] = parts[3]
        self.drill.manifest['user_ids'] = dict(self.ids)
        self.drill.record()
        self.check('source.prepared_users_created_through_the_internal_admin_api', sorted(self.ids) == sorted(USERS))
        for key in OLDER:
            session = self.sign_in(key, 'first')
            self.accounts[key], self.profiles[key] = self.populate(key, session['access_token'])
            self.delete_at_source(key)
            status, _, document, _ = self.front.api('GET', '/v1/me', session['access_token'])
            self.check('%s.old_access_token_gets_api_401_after_its_deletion' % key,
                       status == 401 and doc(document).get('code') == 'unauthenticated')
        self.public['older_deletions'] = len(OLDER)

    def source_fixtures(self):
        a1 = self.sign_in('a', 'session_1')
        self.accounts['a'], self.profiles['a'] = self.populate('a', a1['access_token'])
        # A's second session: its refresh token is held for the target's denial and never used before it.
        a2 = self.sign_in('a', 'session_2')
        b1 = self.sign_in('b', 'session_1')
        self.accounts['b'], self.profiles['b'] = self.populate('b', b1['access_token'])
        self.sessions = {'a1': token_claims(a1['access_token'])[1]['session_id'],
                         'a2': token_claims(a2['access_token'])[1]['session_id']}
        for key, session in (('a', a1), ('b', b1)):
            status, _, document, _ = self.front.auth('GET', '/user', token=session['access_token'])
            self.check('%s.old_access_token_answers_its_identity_at_the_source_auth' % key,
                       status == 200 and doc(document).get('id') == self.ids[key])
            status, _, document, _ = self.front.api('GET', '/v1/me', session['access_token'])
            self.check('%s.old_access_token_reaches_its_account_at_the_source_api' % key,
                       status == 200 and doc(document).get('account_id') == self.accounts[key])
        profile = self.profiles['b']
        for path in ('/v1/me', '/v1/profiles/' + profile, '/v1/profiles/%s/events?after=0' % profile):
            status, _, _, raw = self.front.api('GET', path, b1['access_token'])
            self.check('b.api_document_served_at_the_source', status == 200 and bool(raw))
            self.b_documents[path] = hashlib.sha256(raw).hexdigest()
        self.tokens = {'a_access': a1['access_token'], 'a_refresh_control': a1['refresh_token'],
                       'a_refresh_held': a2['refresh_token'], 'b_access': b1['access_token']}
        self.a_access_expires = int(token_claims(a1['access_token'])[1]['exp'])
        b_access_expires = int(token_claims(b1['access_token'])[1]['exp'])
        for key in USERS:
            record = {'email': self.users[key]['email'], 'password': self.users[key]['password'],
                      'user_id': self.ids[key], 'account_id': self.accounts.get(key), 'profile_id': self.profiles.get(key)}
            if key == 'a':
                record.update(access_token=a1['access_token'], refresh_token=a1['refresh_token'],
                              held_refresh_token=a2['refresh_token'], access_expires=self.a_access_expires,
                              sessions=self.sessions)
            if key == 'b':
                record.update(access_token=b1['access_token'], refresh_token=b1['refresh_token'],
                              access_expires=b_access_expires)
            aya.write_private(self.drill.private / 'credentials' / ('%s.json' % key), json.dumps(record, indent=2) + '\n')
        now = int(time.time())
        self.public['source_controls'] = {'a_old_access_seconds_left': self.a_access_expires - now,
                                          'b_old_access_seconds_left': b_access_expires - now,
                                          'a_sessions_kept': 2, 'b_sessions_kept': 1,
                                          'b_api_documents_digested': len(self.b_documents)}

    def source_snapshot(self):
        before = self.fp['source_before_deletion'] = self.fingerprints(self.source)
        app, auth = before['app'], before['auth']
        for key in OLDER:
            self.check('%s.older_deletion_left_no_owned_row_and_a_confirmed_tombstone' % key,
                       owned_counts(app, key) == NOTHING and row_document(app, 'tomb.' + key).get('deleted_at') is not None
                       and count(auth, 'auth.%s.user_core' % key) == 0)
        for key in ('a', 'b'):
            self.check('%s.owns_its_populated_rows_before_the_snapshot' % key, owned_counts(app, key) == OWNED[key])
        self.check('a.two_sessions_each_with_its_refresh_token_before_the_snapshot',
                   count(auth, 'auth.a.sessions') == 2 and count(auth, 'auth.session.a1.active_refresh_tokens') == 1 and
                   count(auth, 'auth.session.a2.active_refresh_tokens') == 1)
        self.check('b.its_identity_and_session_before_the_snapshot',
                   count(auth, 'auth.b.user_core') == 1 and count(auth, 'auth.b.sessions') == 1)
        directory = aya.private_dir(self.drill.private / 'snapshots' / self.stamp)
        values = secret_values(self.drill)
        results = {}
        for database in ('aya_app', 'aya_auth'):
            path = directory / (database + '.dump')
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as out:
                dumped = subprocess.run(self.source.compose_args('run', '--rm', '--no-deps', '-T', 'aya-backup', 'pg_dump',
                                                                 '--format=custom', '--no-password',
                                                                 '--dbname=' + database, profiles=('backup',)),
                                        env=aya.DOCKER_ENV, stdout=out, stderr=subprocess.PIPE, timeout=900)
            if dumped.returncode or path.stat().st_size == 0:
                aya.write_private(directory / (database + '-dump-redacted.log'),
                                  redact(dumped.stderr.decode(errors='replace'), values))
                raise Refused('pg_dump of the source %s as aya_backup failed' % database)
            with open(path, 'rb') as dump:
                listed = subprocess.run(self.source.compose_args('run', '--rm', '--no-deps', '-T', 'aya-backup',
                                                                 'pg_restore', '--list', profiles=('backup',)),
                                        env=aya.DOCKER_ENV, stdin=dump, capture_output=True, timeout=300)
            aya.require(listed, 'list the %s snapshot' % database)
            entries = [line for line in listed.stdout.decode(errors='replace').splitlines()
                       if line.strip() and not line.startswith(';')]
            tables = sorted(set(' '.join(line.split()[-3:-1]) for line in entries if ' TABLE DATA ' in line))
            self.snapshot_hashes[database] = aya.sha256_file(path)
            results[database] = {'file': str(path.relative_to(self.drill.private)), 'bytes': path.stat().st_size,
                                 'sha256': self.snapshot_hashes[database], 'toc_entries': len(entries),
                                 'tables_with_data': len(tables)}
        self.snapshot_dir = directory
        after = self.fingerprints(self.source)
        self.check('source.snapshot_taken_with_nothing_changed_meanwhile', after == before)
        self.drill.manifest['snapshot'] = results
        self.drill.record()
        self.public['snapshot'] = dict(results, taken='before A was deleted, after the older deletions',
                                       role='aya_backup (read only)')

    def source_delete_a(self):
        self.delete_at_source('a')
        token = self.tokens['a_access']
        status, _, document, _ = self.front.api('GET', '/v1/me', token)
        self.check('a.old_access_token_gets_api_401_at_the_source',
                   status == 401 and doc(document).get('code') == 'unauthenticated')
        status, _, document, _ = self.front.auth('GET', '/user', token=token)
        self.check('a.old_access_token_is_user_not_found_at_the_source_auth',
                   status == 403 and doc(document).get('error_code') == 'user_not_found')
        status, document = self.password_grant('a')
        self.check('a.password_is_invalid_credentials_at_the_source',
                   status == 400 and document.get('error_code') == 'invalid_credentials')
        before = self.fp['source_before_deletion']
        after = self.fp['source_after_deletion'] = self.fingerprints(self.source)
        app, auth = after['app'], after['auth']
        record = row_document(app, 'tomb.a')
        self.check('a.source_erased_every_owned_row', owned_counts(app, 'a') == NOTHING)
        self.check('a.source_tombstone_is_the_api_deletion_with_its_identity_confirmed',
                   record.get('deletion_id') == self.deletions['a'] and record.get('deleted_at') is not None and
                   record.get('attempts') == 1 and erased_of(record) == OWNED['a'])
        self.check('a.source_kept_its_exact_account_anchor', app.get('anchor.a') == before['app'].get('anchor.a'))
        self.check('a.source_auth_no_longer_has_the_identity_or_a_session',
                   count(auth, 'auth.a.user_core') == 0 and count(auth, 'auth.a.sessions') == 0)
        self.check('b.source_rows_unchanged_by_the_deletion_of_a',
                   subset(app, 'app.b.') == subset(before['app'], 'app.b.') and
                   app.get('anchor.b') == before['app'].get('anchor.b'))
        self.check('b.source_identity_unchanged_by_the_deletion_of_a',
                   subset(auth, 'auth.b.') == subset(before['auth'], 'auth.b.'))
        status, _, document, _ = self.front.api('GET', '/v1/me', self.tokens['b_access'])
        self.check('b.old_access_token_still_reaches_its_account_at_the_source',
                   status == 200 and doc(document).get('account_id') == self.accounts['b'])

    def source_ledger(self):
        source = self.source
        db_before = subset(self.fingerprints(source)['app'], 'db.')
        dsn = (source.files_dir / 'ledger-export' / 'database-url').read_text().strip()
        self.check('ledger.export_uses_the_read_only_backup_role', urllib.parse.urlsplit(dsn).username == 'aya_backup')
        name = 'ledger-%s.json' % aya.stamp()
        exported = source.compose('run', '--rm', '--no-deps', '-T', 'aya-ledger-export', '/ledger/out/' + name,
                                  timeout=300, profiles=('drill',))
        values = secret_values(self.drill)
        self.check('ledger.export_output_holds_no_secret_or_identifier',
                   leaks(exported.stdout + exported.stderr, values + self.identifiers()) == 0)
        lines = [line.strip() for line in exported.stdout.splitlines() if line.strip()]
        matched = EXPORT_LINE.match(lines[-1]) if lines else None
        self.public['ledger_export'] = {'exit_code': exported.returncode, 'output_is_the_count_and_sha256': bool(matched)}
        if exported.returncode:
            source.write_log('ledger-export', exported.stdout + '\n' + exported.stderr)
        self.check('ledger.export_exit_0', exported.returncode == 0 and matched is not None)
        printed_count, printed_sha = int(matched.group(1)), matched.group(2)
        read = subprocess.run(source.compose_args('run', '--rm', '--no-deps', '-T', 'aya-ledger-read', '/ledger/out/' + name,
                                                  profiles=('drill',)),
                              env=aya.DOCKER_ENV, capture_output=True, timeout=120)
        raw = read.stdout
        self.check('ledger.read_out_of_its_volume_intact',
                   read.returncode == 0 and 0 < len(raw) <= MAX_LEDGER_BYTES and
                   hashlib.sha256(raw).hexdigest() == printed_sha)
        path = write_private_bytes(self.drill.private / 'ledgers' / name, raw)
        self.check('ledger.private_copy_has_the_printed_sha256', aya.sha256_file(path) == printed_sha)
        self.ledger_raw = raw
        self.drill.manifest['ledger'] = {'file': str(path.relative_to(self.drill.private)), 'sha256': printed_sha,
                                         'deletions': printed_count}
        self.drill.record()
        ledger = self.ledger = json.loads(raw.decode('utf-8'))
        entries = ledger.get('deletions') or []
        by_account = dict((doc(entry).get('account_id'), doc(entry)) for entry in entries)
        after = self.fp['source_after_deletion']['app']
        self.check('ledger.format_and_trusted_provider',
                   ledger.get('format') == 'ayailmu-deletion-ledger-1' and ledger.get('auth_mode') == 'local-supabase' and
                   ledger.get('issuer') == aya.ISSUER)
        self.check('ledger.exactly_the_three_recorded_deletions_older_history_included',
                   printed_count == len(DELETED) and len(entries) == len(DELETED) and
                   set(by_account) == set(self.accounts[key] for key in DELETED))
        text = raw.decode('utf-8')
        self.check('ledger.never_names_the_bystander_or_an_address',
                   self.accounts['b'] not in text and self.ids['b'] not in text and '@' not in text)
        for key in DELETED:
            entry = by_account[self.accounts[key]]
            record = row_document(after, 'tomb.' + key)
            identity, erased = doc(entry.get('identity')), doc(entry.get('erased'))
            self.check('ledger.%s_is_the_exact_anchor_and_record' % key,
                       entry.get('subject') == self.ids[key] and entry.get('auth_mode') == 'local-supabase' and
                       entry.get('issuer') == aya.ISSUER and
                       entry.get('deletion_id') == record.get('deletion_id') == self.deletions[key] and
                       (erased.get('profiles'), erased.get('device_links'), erased.get('events'),
                        erased.get('imports')) == OWNED[key] and
                       identity.get('attempts') == record.get('attempts') and
                       same_instant(identity.get('deleted_at'), record.get('deleted_at')) and
                       same_instant(entry.get('requested_at'), record.get('requested_at')))
            self.deletion_keys[entry['deletion_id']] = key
        self.check('ledger.historically_confirmed_deletions_included',
                   all(doc(by_account[self.accounts[key]].get('identity')).get('deleted_at') for key in DELETED))
        self.check('ledger.export_changed_nothing_at_the_source',
                   subset(self.fingerprints(source)['app'], 'db.') == db_before)
        self.public['ledger'] = {'file': str(path.relative_to(self.drill.private)), 'bytes': len(raw),
                                 'sha256': printed_sha, 'deletions': printed_count,
                                 'older_deletions_included': len(OLDER), 'bystander_absent': True,
                                 'exported_as': 'aya_backup (read only)'}

    def target_closed(self):
        target = self.target
        left = self.a_access_expires - int(time.time())
        self.public['a_old_access_seconds_left_when_the_target_starts'] = left
        self.check('a.old_access_token_keeps_at_least_15_minutes_for_the_target', left >= MIN_SECONDS_AT_TARGET)
        files = target.files_dir
        aya.private_dir(files / 'ledger-in')
        write_private_bytes(files / 'ledger-in' / 'ledger.json', self.ledger_raw)
        probe = aya.private_dir(files / 'probe')
        aya.write_private(probe / 'a-access.header', 'Authorization: Bearer %s\n' % self.tokens['a_access'])
        aya.write_private(probe / 'a-refresh-control.json',
                          json.dumps({'refresh_token': self.tokens['a_refresh_control']}) + '\n')
        aya.write_private(probe / 'a-refresh-held.json', json.dumps({'refresh_token': self.tokens['a_refresh_held']}) + '\n')
        aya.write_private(probe / 'b-access.header', 'Authorization: Bearer %s\n' % self.tokens['b_access'])
        for key in ('a', 'b'):
            aya.write_private(probe / ('%s-password.json' % key),
                              json.dumps({'email': self.users[key]['email'], 'password': self.users[key]['password']}) + '\n')
        aya.require(target.compose('up', '--detach', '--no-build', 'aya-db', 'aya-drill-init', timeout=600),
                    'start the target database, closed')
        wait_services(target, exited=('aya-secrets-init', 'aya-drill-init'), healthy=('aya-db',))
        self.public['target_client_authentication'] = target.enforced_hba()
        self.transaction_defaults(target)
        app = psql(target, 'aya_app', "SELECT 'tables', count(*) FROM pg_tables WHERE schemaname = 'ayailmu';\n")
        auth = psql(target, 'aya_auth', "SELECT 'tables', count(*) FROM pg_tables WHERE schemaname = 'auth';\n")
        self.check('target.app_and_auth_schemas_empty_before_the_restore', app.get('tables') == '0' and
                   auth.get('tables') == '0')
        self.exposure('closed', ('aya-secrets-init', 'aya-drill-init', 'aya-db'))

    def target_restore(self):
        target = self.target
        for database in ('aya_app', 'aya_auth'):
            path = self.snapshot_dir / (database + '.dump')
            self.check('target.%s_snapshot_unchanged_since_its_dump' % database,
                       aya.sha256_file(path) == self.snapshot_hashes[database])
            with open(path, 'rb') as dump:
                restored = subprocess.run(target.compose_args('exec', '-T', 'aya-db', 'pg_restore', '--exit-on-error',
                                                              '--single-transaction', '--clean', '--if-exists',
                                                              '--no-password', '--username=postgres',
                                                              '--dbname=' + database),
                                          env=aya.DOCKER_ENV, stdin=dump, capture_output=True, timeout=600)
            if restored.returncode:
                target.write_log('restore-' + database, restored.stdout.decode(errors='replace') + '\n' +
                                 restored.stderr.decode(errors='replace'))
            self.check('target.%s_restored_in_one_transaction' % database, restored.returncode == 0)
        restored = self.fp['target_restored'] = self.fingerprints(target)
        before = self.fp['source_before_deletion']
        app, auth = restored['app'], restored['auth']
        self.check('target.schema_at_this_binary_version', json.loads(app.get('db.migrations') or '[]') == [1, 2, 3])
        self.check('target.every_app_table_equals_the_pre_deletion_snapshot', subset(app, 'db.') == subset(before['app'], 'db.'))
        self.check('target.every_users_rows_anchor_and_tombstone_equal_the_snapshot',
                   all(subset(app, 'app.%s.' % key) == subset(before['app'], 'app.%s.' % key) and
                       app.get('anchor.' + key) == before['app'].get('anchor.' + key) and
                       app.get('tomb.' + key) == before['app'].get('tomb.' + key) for key in USERS))
        self.check('target.identities_and_sessions_equal_the_snapshot', auth == before['auth'])
        self.check('a.old_rows_resurrected_without_a_tombstone_in_the_target',
                   owned_counts(app, 'a') == OWNED['a'] and not row_document(app, 'tomb.a'))
        self.check('a.old_identity_resurrected_in_the_target_auth',
                   count(auth, 'auth.a.user_core') == 1 and count(auth, 'auth.a.sessions') == 2)
        self.check('older_tombstones_restored_with_their_confirmations',
                   all(row_document(app, 'tomb.' + key).get('deleted_at') for key in OLDER))
        self.public['restore'] = {'databases': 2, 'single_transaction_each': True, 'clean_if_exists': True,
                                  'restored_as': 'the bootstrap superuser over the target database socket',
                                  'a_rows_resurrected': list(OWNED['a']), 'a_identity_resurrected': True}

    def target_auth_controls(self):
        target = self.target
        aya.require(target.compose('up', '--detach', '--no-build', 'aya-auth', timeout=600, profiles=('restored',)),
                    'start the target Auth')
        wait_services(target, healthy=('aya-db', 'aya-auth'))
        self.exposure('auth_restored', ('aya-secrets-init', 'aya-drill-init', 'aya-db', 'aya-auth'))
        outcomes = {}
        outcomes['a_old_access_at_auth'] = self.probe('user', 'a-access.header', self.ids['a'])
        outcomes['b_old_access_at_auth'] = self.probe('user', 'b-access.header', self.ids['b'])
        self.check('a.old_access_token_valid_at_the_target_auth_before_the_replay',
                   outcomes['a_old_access_at_auth'][1:] == ['200', 'match'])
        self.check('b.old_access_token_valid_at_the_target_auth', outcomes['b_old_access_at_auth'][1:] == ['200', 'match'])
        outcomes['a_control_refresh'] = self.probe('refresh', 'a-refresh-control.json')
        self.check('a.control_refresh_token_works_at_the_target_before_the_replay',
                   outcomes['a_control_refresh'][1:] == ['200', 'issued'])
        outcomes['a_password'] = self.probe('password', 'a-password.json')
        self.check('a.password_signs_in_at_the_target_before_the_replay', outcomes['a_password'][1:] == ['200', 'issued'])
        auth = self.fingerprints(target)['auth']
        self.check('a.held_refresh_token_unused_its_session_still_holds_it_active',
                   count(auth, 'auth.session.a2.active_refresh_tokens') == 1 and count(auth, 'auth.a.sessions') == 3)
        self.check('target.api_absent_before_the_replay', not target.ps().get('aya-api'))
        self.public['before_replay'] = dict((name, ' '.join(outcome[1:])) for name, outcome in outcomes.items())
        self.public['before_replay']['a_sessions'] = count(auth, 'auth.a.sessions')
        self.public['before_replay']['a_held_refresh_token_session_active_tokens'] = count(
            auth, 'auth.session.a2.active_refresh_tokens')

    def target_replay(self):
        target = self.target
        migrated = target.compose('run', '--rm', '--no-deps', '-T', 'aya-migrate', timeout=300, profiles=('restored',))
        self.check('target.migration_job_exit_0_prints_only_3_changes_nothing',
                   migrated.returncode == 0 and migrated.stdout.strip() == aya.SCHEMA_VERSION)
        self.check('target.api_still_absent_before_the_replay', not target.ps().get('aya-api'))
        by_key = self.replay('first')
        self.expect_replay('first', by_key, {'a': ('kept', 'created', OWNED['a']), 'o1': ('kept', 'kept', NOTHING),
                                             'o2': ('kept', 'kept', NOTHING)})

    def target_open_internally(self):
        target = self.target
        aya.require(target.compose('up', '--detach', '--no-build', 'aya-api', timeout=600, profiles=('restored',)),
                    'start the target API on its internal networks')
        wait_services(target, exited=('aya-secrets-init', 'aya-migrate'), healthy=('aya-db', 'aya-auth', 'aya-api'))
        self.exposure('api_internal', ('aya-secrets-init', 'aya-drill-init', 'aya-db', 'aya-auth', 'aya-migrate', 'aya-api'))
        outcome = self.probe('ready')
        self.check('target.api_ready_on_its_internal_network', outcome[1:] == ['200', 'ready'])
        ran = target.compose('exec', '-T', 'aya-db', 'psql', '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1',
                             '-U', 'postgres', '-d', 'postgres', '-f', '-', input=aya.DB_CHECKS.read_text(), timeout=120)
        aya.require(ran, 'run the database checks in the target')
        self.check('target.database_checks_printed_no_secret', leaks(ran.stdout + ran.stderr, secret_values(self.drill)) == 0)
        db = {}
        for line in ran.stdout.splitlines():
            if '|' in line:
                name, value = line.split('|', 1)
                db[name] = value
        checks, facts = [], {}
        aya.evaluate_database(db, checks, facts)
        failed = [name for name, ok in checks if not ok]
        self.public['target_database_checks'] = {'passed': len(checks) - len(failed), 'total': len(checks),
                                                 'failed': failed}
        self.check('target.restored_roles_grants_ownership_and_probes_as_the_stack_requires', bool(checks) and not failed)

    def target_denials(self):
        target = self.target
        restored = self.fp['target_restored']
        first = self.fingerprints(target)
        self.check('b.rows_unchanged_by_the_replay', subset(first['app'], 'app.b.') == subset(restored['app'], 'app.b.') and
                   first['app'].get('anchor.b') == restored['app'].get('anchor.b'))
        self.check('b.identity_unchanged_by_the_replay_before_any_login',
                   subset(first['auth'], 'auth.b.') == subset(restored['auth'], 'auth.b.'))
        left = self.a_access_expires - int(time.time())
        self.public['a_old_access_seconds_left_at_the_denial'] = left
        self.check('a.old_access_token_still_unexpired_at_the_denial', left >= MIN_SECONDS_AT_DENIAL)
        outcomes = {}
        outcomes['a_old_access_at_auth'] = self.probe('user', 'a-access.header')
        outcomes['a_old_access_at_api'] = self.probe('me', 'a-access.header')
        outcomes['a_held_refresh'] = self.probe('refresh', 'a-refresh-held.json')
        outcomes['a_password'] = self.probe('password', 'a-password.json')
        outcomes['ready'] = self.probe('ready')
        self.check('a.old_access_token_is_user_not_found_at_the_target_auth',
                   outcomes['a_old_access_at_auth'][1:] == ['403', 'user_not_found'])
        self.check('a.old_access_token_gets_the_uniform_401_at_the_target_api',
                   outcomes['a_old_access_at_api'][1:] == ['401', 'unauthenticated'])
        self.check('a.unconsumed_refresh_token_is_not_found_at_the_target',
                   outcomes['a_held_refresh'][1:] == ['400', 'refresh_token_not_found'])
        self.check('a.password_is_invalid_credentials_at_the_target',
                   outcomes['a_password'][1:] == ['400', 'invalid_credentials'])
        self.check('target.api_ready_beside_the_denials', outcomes['ready'][1:] == ['200', 'ready'])
        outcomes['b_old_access_at_auth'] = self.probe('user', 'b-access.header', self.ids['b'])
        outcomes['b_old_access_at_api'] = self.probe('me', 'b-access.header', self.accounts['b'])
        self.check('b.old_source_access_token_valid_at_the_target_auth',
                   outcomes['b_old_access_at_auth'][1:] == ['200', 'match'])
        self.check('b.old_source_access_token_reaches_its_account_at_the_target_api',
                   outcomes['b_old_access_at_api'][1:] == ['200', 'match'])
        for path, digest in sorted(self.b_documents.items()):
            outcome = self.probe('api', 'b-access.header', path)
            self.check('b.target_serves_the_same_api_document_as_the_source', outcome[1:] == ['200', digest])
        second = self.fingerprints(target)
        self.check('b.old_token_use_changed_no_row_or_identity',
                   subset(second['app'], 'app.b.') == subset(first['app'], 'app.b.') and
                   subset(second['auth'], 'auth.b.') == subset(first['auth'], 'auth.b.'))
        # B's fresh login updates its last-login metadata on purpose, after its data was compared.
        outcomes['b_password_and_api'] = self.probe('password', 'b-password.json', self.accounts['b'])
        self.check('b.password_signs_in_and_the_new_token_reaches_its_account',
                   outcomes['b_password_and_api'][1:] == ['200', 'issued', 'me', '200', 'match'])
        third = self.fingerprints(target)
        app, auth = third['app'], third['auth']
        self.check('b.identity_survives_its_login_with_its_core_unchanged',
                   auth.get('auth.b.user_core') == first['auth'].get('auth.b.user_core') and
                   count(auth, 'auth.b.identities') == count(first['auth'], 'auth.b.identities') == 1)
        self.check('b.rows_unchanged_after_its_login', subset(app, 'app.b.') == subset(first['app'], 'app.b.'))
        entry = self.ledger_entry('a')
        record = row_document(app, 'tomb.a')
        self.check('a.target_holds_no_owned_row', owned_counts(app, 'a') == NOTHING)
        self.check('a.target_kept_the_exact_account_anchor', app.get('anchor.a') == restored['app'].get('anchor.a'))
        self.check('a.target_tombstone_is_exactly_the_ledger_record',
                   record.get('deletion_id') == entry.get('deletion_id') and
                   same_instant(record.get('requested_at'), entry.get('requested_at')) and
                   erased_of(record) == OWNED['a'] and
                   same_instant(record.get('deleted_at'), doc(entry.get('identity')).get('deleted_at')) and
                   record.get('attempts') == doc(entry.get('identity')).get('attempts') + 1)
        self.check('a.target_auth_no_longer_has_the_identity_or_a_session',
                   count(auth, 'auth.a.user_core') == 0 and count(auth, 'auth.a.sessions') == 0)
        # Recorded, not required: the refresh denial above is the behavioural proof, whatever rows GoTrue keeps.
        self.public['a_active_refresh_token_rows_after_the_replay'] = count(auth, 'auth.a.active_refresh_tokens')
        for key in OLDER:
            entry = self.ledger_entry(key)
            record = row_document(app, 'tomb.' + key)
            self.check('%s.target_tombstone_kept_and_its_identity_reconciled_again' % key,
                       record.get('deletion_id') == entry.get('deletion_id') and owned_counts(app, key) == NOTHING and
                       same_instant(record.get('deleted_at'), doc(entry.get('identity')).get('deleted_at')) and
                       record.get('attempts') == doc(entry.get('identity')).get('attempts') + 1)
        self.public['denials'] = dict((name, ' '.join(outcome[1:])) for name, outcome in outcomes.items())
        self.public['denials']['b_api_documents_identical_to_the_source'] = len(self.b_documents)

    def target_repeat(self):
        before = self.fingerprints(self.target)['app']
        by_key = self.replay('second')
        self.expect_replay('second', by_key, dict((key, ('kept', 'kept', NOTHING)) for key in DELETED))
        after = self.fingerprints(self.target)['app']
        self.check('target.second_replay_erased_nothing_and_changed_no_record_but_the_attempts',
                   all(after.get(name) == before.get(name) for name in APP_TABLES))
        attempts_before = json.loads(before.get('db.deletion_attempts') or '{}')
        attempts_after = json.loads(after.get('db.deletion_attempts') or '{}')
        self.check('target.second_replay_counted_exactly_one_new_provider_attempt_per_deletion',
                   len(attempts_before) == len(DELETED) and set(attempts_after) == set(attempts_before) and
                   all(attempts_after[account] == attempts_before[account] + 1 for account in attempts_before))
        self.public['repeat'] = {'rows_erased': 0, 'records_changed_besides_attempts': 0,
                                 'new_provider_attempts_counted': len(attempts_before)}

    def target_re_erase(self):
        target = self.target
        before = self.fingerprints(target)['app']
        psql(target, 'aya_app', seed_sql(self.accounts['a'], str(uuid.uuid4()), secrets.token_hex(4)))
        seeded = self.fingerprints(target)['app']
        self.check('a.controlled_rows_seeded_beneath_its_confirmed_tombstone_in_the_target_only',
                   owned_counts(seeded, 'a') == (1, 1, 2, 1) and row_document(seeded, 'tomb.a').get('deleted_at'))
        by_key = self.replay('third')
        self.expect_replay('third', by_key, {'a': ('kept', 'kept', (1, 1, 2, 1)), 'o1': ('kept', 'kept', NOTHING),
                                             'o2': ('kept', 'kept', NOTHING)})
        after = self.fingerprints(target)['app']
        self.check('a.seeded_rows_erased_again_beneath_the_existing_tombstone', owned_counts(after, 'a') == NOTHING)
        self.check('b.unchanged_by_the_seeding_and_the_re_erasure', subset(after, 'app.b.') == subset(before, 'app.b.'))
        self.check('target.re_erasure_left_every_table_as_before_the_seeding',
                   all(after.get(name) == before.get(name) for name in APP_TABLES))
        attempts_before = json.loads(before.get('db.deletion_attempts') or '{}')
        attempts_after = json.loads(after.get('db.deletion_attempts') or '{}')
        self.check('target.third_replay_counted_one_more_provider_attempt_per_deletion',
                   set(attempts_after) == set(attempts_before) and
                   all(attempts_after[account] == attempts_before[account] + 1 for account in attempts_before))
        self.public['re_erasure'] = {'seeded': [1, 1, 2, 1], 'erased_again': list(by_key['a']['erased']),
                                     'bystander_unchanged': True}

    def preserved_after(self):
        found = observe_preserved()
        before = self.private['preserved_before']
        self.private['preserved_after'] = found
        self.public['preserved_after'] = public_preserved(found)
        self.check('preserved.older_services_answer_200_as_before',
                   found['old_services'] == before['old_services'] and
                   all(status == 200 for status in found['old_services'].values()))
        watched, was = found['phase8_stack'], before['phase8_stack']
        self.check('preserved.phase8_stack_ready_with_the_same_containers',
                   watched.get('readiness') == 'ready' and watched.get('readiness_through_front') == 200 and
                   bool(watched.get('containers')) and watched.get('containers') == was.get('containers'))
        source = self.fingerprints(self.source)
        snapshot = self.fp['source_before_deletion']
        self.check('b.source_rows_and_identity_unchanged_since_the_snapshot',
                   subset(source['app'], 'app.b.') == subset(snapshot['app'], 'app.b.') and
                   subset(source['auth'], 'auth.b.') == subset(snapshot['auth'], 'auth.b.'))
        self.check('source.still_ready', self.source.readiness() == 'ready')


# --- commands --------------------------------------------------------------------------------------------------------


def write_env(side, image_label):
    """The Compose interpolation values: names, the port, paths; never a secret."""
    aya.write_private(side.env_file, ''.join('%s=%s\n' % item for item in (
        ('AYA_STACK_PROJECT', side.project), ('AYA_STACK_LABEL', side.label), ('AYA_STACK_PORT', str(side.port)),
        ('AYA_STACK_SECRETS_DIR', str(side.secrets_dir)), ('AYA_STACK_API_HOST', aya.API_HOST),
        ('AYA_STACK_AUTH_HOST', aya.AUTH_HOST), ('AYA_STACK_APP_HOST', aya.APP_HOST), ('AYA_STACK_ISSUER', aya.ISSUER),
        ('AYA_DRILL_FILES_DIR', str(side.files_dir)), ('AYA_DRILL_IMAGE_LABEL', image_label))))


def generate_side(side, users, jose=None, signing_source=None):
    """One stack's secrets, as aya_stack.py prepare generates them: its own role passwords and database URLs and, for
    the source, its own signing key, JWT secret and admin credential, which the target copies byte for byte. Returns
    the role passwords (for the drill's own database URLs) and the signing key's kid."""
    base = aya.private_dir(side.secrets_dir)
    for name in ('db', 'auth', 'migrate', 'api', 'backup', 'ops', 'ops/users'):
        aya.private_dir(base / name)
    passwords = dict((role, secrets.token_hex(32)) for role in aya.ROLE_PASSWORDS)
    aya.write_private(base / 'db/postgres-password', passwords['postgres'] + '\n')
    for role in aya.ROLE_PASSWORDS[1:]:
        aya.write_private(base / ('db/%s.password' % role), passwords[role] + '\n')

    def dsn(role, database):
        return 'postgres://%s:%s@aya-db:5432/%s?sslmode=disable' % (role, passwords[role], database)

    aya.write_private(base / 'migrate/database-url', dsn('aya_owner', 'aya_app') + '\n')
    aya.write_private(base / 'api/database-url', dsn('aya_runtime', 'aya_app') + '\n')
    aya.write_private(base / 'auth/database-url', dsn('aya_auth_owner', 'aya_auth') + '\n')
    aya.write_private(base / 'backup/pgpass', ''.join('aya-db:5432:%s:aya_backup:%s\n' % (database, passwords['aya_backup'])
                                                      for database in ('aya_app', 'aya_auth')))
    kid = None
    if signing_source is None:
        aya.write_private(base / 'auth/jwt-secret', secrets.token_urlsafe(48) + '\n')
        keys = aya.private_dir(side.private / 'keys')
        kid = 'aya-amar-p9-' + secrets.token_hex(6)
        generated = subprocess.run([str(jose), 'generate-key', '--use', 'sig', '--alg', 'ES256', '--kid', kid],
                                   cwd=keys, capture_output=True, text=True, timeout=30)
        private_key = keys / ('jwk-sig-' + kid + '-priv.json')
        if generated.returncode or not private_key.is_file():
            raise Refused('jose-util could not generate the signing key')
        jwk = json.loads(private_key.read_text())
        if jwk.get('kty') != 'EC' or jwk.get('crv') != 'P-256' or not jwk.get('d') or jwk.get('kid') != kid:
            raise Refused('jose-util did not generate a private P-256 key under its kid')
        jwk.update(alg='ES256', use='sig', key_ops=['sign', 'verify'])
        aya.write_private(base / 'auth/jwt-keys.json', json.dumps([jwk], separators=(',', ':')) + '\n')
        issued = int(time.time())
        admin = aya.jose_sign(jose, private_key, {'role': 'service_role', 'iss': aya.ISSUER, 'iat': issued,
                                                  'exp': issued + aya.ADMIN_TOKEN_LIFETIME})
        aya.write_private(base / 'api/admin-key', admin + '\n')
        aya.write_private(base / 'ops/admin-header', 'Authorization: Bearer ' + admin + '\n')
    else:
        for relative in ('auth/jwt-keys.json', 'auth/jwt-secret', 'api/admin-key', 'ops/admin-header'):
            copy_private(signing_source.secrets_dir / relative, base / relative)
    tag = secrets.token_hex(4)
    for n, key in enumerate(users, 1):
        user = {'email': 'aya-p9-%s-%s@example.test' % (tag, key), 'password': secrets.token_urlsafe(24),
                'email_confirm': True, 'role': 'authenticated'}
        aya.write_private(base / ('ops/users/user-%d.json' % n), json.dumps(user) + '\n')
    aya.private_dir(side.files_dir)
    return dsn, kid


def remove_side_files(side):
    for path in (side.secrets_dir, side.private / 'keys', side.files_dir):
        shutil.rmtree(path, ignore_errors=True)
    for path in (side.env_file, side.root_cert):
        if path.exists():
            path.unlink()


def prepare(args):
    jose = aya.jose_util(args.jose_util)
    for key, reference in aya.IMAGES.items():
        inspected = aya.docker('image', 'inspect', '--format', '{{.Id}}', reference)
        if inspected.returncode or inspected.stdout.strip() != aya.IMAGE_IDS[key]:
            raise SystemExit('a pinned image is not cached locally as recorded, and this helper never pulls: ' + key)
    if args.port is not None:
        if not (49152 <= args.port <= 65535) or args.port in aya.RESERVED_PORTS or not aya.port_free(args.port):
            raise SystemExit('refusing the port: it must be a free high port (49152-65535) on 127.0.0.1, not a reserved one')
        port = args.port
    else:
        port = aya.free_port()
    initializer = aya.hba_initializer_mode()
    drill = Drill.new(port)
    source, target = drill.side('source'), drill.side('target')
    try:
        for path in (source.private, target.private):
            aya.private_dir(path)
        for name in ('snapshots', 'ledgers', 'credentials', 'reports'):
            aya.private_dir(drill.private / name)
        source_dsn, kid = generate_side(source, USERS, jose=jose)
        aya.private_dir(source.files_dir / 'ledger-export')
        aya.write_private(source.files_dir / 'ledger-export' / 'database-url', source_dsn('aya_backup', 'aya_app') + '\n')
        write_env(source, source.project)
        target_dsn, _ = generate_side(target, ('unused',), signing_source=source)
        aya.private_dir(target.files_dir / 'ledger-replay')
        aya.write_private(target.files_dir / 'ledger-replay' / 'database-url', target_dsn('aya_owner', 'aya_app') + '\n')
        copy_private(source.secrets_dir / 'api/admin-key', target.files_dir / 'ledger-replay' / 'admin-key')
        write_env(target, source.project)
        drill.manifest.update(state='prepared', signing_kid=kid, sources=aya.source_hashes(), hba_initializer=initializer,
                              prepared_at=aya.now_iso())
        drill.record()
    except BaseException as error:
        for side in (source, target):
            remove_side_files(side)
        drill.manifest.update(state='prepare failed; its secret files were removed',
                              failure=str(error) if isinstance(error, Refused) else type(error).__name__)
        drill.record()
        emit({'label': drill.label, 'state': drill.manifest['state'], 'failure': drill.manifest['failure']})
        return 1
    write_evidence(drill, 'prepare', {'state': 'prepared', 'port': port, 'projects': {
        'source': source.project, 'target': target.project}, 'images': aya.IMAGES, 'sources': drill.manifest['sources'],
        'hba_initializer': initializer, 'source_users': len(USERS),
        'target_signing_material': 'byte copies of the source signing key, JWT secret and admin credential',
        'target_publishes': 'no port'}, identifiers=[])
    emit({'label': drill.label, 'state': 'prepared', 'drill_directory': str(drill.private), 'port': port,
          'source_project': source.project, 'source_front': ['https://%s:%d' % (aya.API_HOST, port),
                                                             'https://%s:%d' % (aya.AUTH_HOST, port)],
          'target_project': target.project, 'target_publishes': 'no port',
          'secrets': 'only in 0600 files under drill_directory; never printed',
          'next': 'python3 -I deploy/tools/aya_restore_drill.py run ' + str(drill.private)})
    return 0


def run(args):
    drill = Drill.load(args.drill_directory)
    if drill.manifest['state'] != 'prepared':
        raise SystemExit('refusing: the drill is %s, not prepared; prepare a new drill' % drill.manifest['state'])
    if not aya.port_free(drill.port):
        raise SystemExit('refusing: 127.0.0.1:%d is no longer free' % drill.port)
    sources = aya.source_hashes()
    drill.manifest.update(state='running', run_started_at=aya.now_iso(), sources_at_run=sources)
    drill.record()
    work = Run(drill)
    work.public['deploy_files_changed_since_prepare'] = sources != drill.manifest.get('sources')
    return work.execute()


def status(args):
    drill = Drill.load(args.drill_directory)
    report = {'label': drill.label, 'state': drill.manifest.get('state'), 'port': drill.port, 'projects': {}}
    for role in ('source', 'target'):
        side = drill.side(role)
        if not side.env_file.is_file():
            report['projects'][side.project] = 'no stack.env'
            continue
        report['projects'][side.project] = dict(
            (service, [{'state': entry.get('State'), 'health': entry.get('Health') or None,
                        'exit_code': entry.get('ExitCode')} for entry in entries])
            for service, entries in sorted(side.ps().items()))
    emit(report)
    return 0


def cleanup(args):
    drill = Drill.load(args.drill_directory)
    source, target = drill.side('source'), drill.side('target')
    values = secret_values(drill)
    ids = [value for value in (drill.manifest.get('user_ids') or {}).values() if is_uuid(value)]
    report = {}
    if ids and source.env_file.is_file():
        removed = source.compose('run', '--rm', '--no-deps', '-T', 'aya-users', 'delete', *ids, timeout=120,
                                 profiles=('ops',))
        outcomes = [line.split()[-1] for line in removed.stdout.splitlines() if line.startswith('delete ')]
        report['source_identities'] = {'requested': len(ids), 'already_absent_404': outcomes.count('404'),
                                       'deleted_now_200': outcomes.count('200'),
                                       'other': len(outcomes) - outcomes.count('404') - outcomes.count('200')}
    report['target'] = target.remove_owned()
    report['source'] = source.remove_owned()
    clean = all(part['compose_down'] == 'ok' and not any(part['leftovers'].values())
                for part in (report['target'], report['source'])) and \
        report['source']['api_image'] in ('removed', 'absent')
    removed_files = []
    if clean:
        for path in (source.secrets_dir, source.private / 'keys', source.files_dir, target.secrets_dir, target.files_dir,
                     drill.private / 'credentials'):
            if path.exists():
                shutil.rmtree(path)
                removed_files.append(str(path.relative_to(drill.private)) + '/')
        for path in (source.env_file, source.root_cert, target.env_file):
            if path.exists():
                path.unlink()
                removed_files.append(str(path.relative_to(drill.private)))
    kept = sorted(name + '/' for name in ('snapshots', 'ledgers', 'reports') if (drill.private / name).exists())
    drill.manifest.update(state='removed' if clean else 'removal incomplete', removed_at=aya.now_iso())
    drill.note('cleanup', clean=clean, removed_files=removed_files)
    evidence = write_evidence(drill, 'cleanup-' + aya.stamp(), {
        'state': drill.manifest['state'], 'cleanup': report, 'removed_files': removed_files, 'kept_private': kept},
        identifiers=ids, values=values)
    emit({'label': drill.label, 'state': drill.manifest['state'], 'cleanup': report, 'removed_files': removed_files,
          'kept_private': kept, 'evidence': str(evidence), 'drill_directory': str(drill.private)})
    return 0 if clean else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest='command', required=True)
    start = commands.add_parser('prepare')
    start.add_argument('--port', type=int)
    start.add_argument('--jose-util', default=str(aya.JOSE_UTIL))
    for name in ('run', 'status', 'cleanup'):
        commands.add_parser(name).add_argument('drill_directory')
    args = parser.parse_args()
    handlers = {'prepare': prepare, 'run': run, 'status': status, 'cleanup': cleanup}
    try:
        return handlers[args.command](args)
    except Refused as error:
        emit({'command': args.command, 'result': 'refused', 'reason': str(error)})
        return 1


if __name__ == '__main__':
    sys.exit(main())
