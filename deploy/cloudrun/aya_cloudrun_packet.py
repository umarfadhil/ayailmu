#!/usr/bin/env python3
"""Local, non-applying preflight and packet writer for the Cloud Run + self-hosted GoTrue topology.

    python3 -I -B deploy/cloudrun/aya_cloudrun_packet.py check INPUT
    python3 -I -B deploy/cloudrun/aya_cloudrun_packet.py packet INPUT OUTPUT

INPUT is an explicit regular file or `-` for standard input. The tool checks a closed, non-secret JSON document and
prints one deterministic printable-ASCII JSON result. `packet` also writes that result to a new 0600 file. It never
applies, provisions, executes or sends anything, and it reads no environment variable, account or network. A valid
configuration is never a claim that anything is ready: every gate stays outstanding.

Exit status: 0 the configuration is valid, 1 it is invalid, 2 it was not evaluated (usage, input, parse or output).
Contract: docs/superpowers/plans/2026-10-20-cloud-run-gotrue-prep.md, sections B to E.
"""
import hashlib
import json
import os
import re
import stat
import sys

INPUT_FORMAT = 'ayailmu-cloudrun-input/1'
RESULT_FORMAT = 'ayailmu-cloudrun-result/1'
TOPOLOGY = 'api-and-gotrue-on-cloud-run-with-supabase-postgres'
MAX_INPUT_BYTES = 65536

# The GoTrue reference pinned at deploy/compose.yaml:20. It is repeated, never overridden.
GOTRUE_IMAGE = ('docker.io/supabase/gotrue:v2.197.0'
                '@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b')

NON_PUBLIC_LABELS = frozenset({'localhost', 'local', 'test', 'invalid', 'example', 'onion', 'alt', 'arpa', 'internal',
                               'intranet', 'private', 'corp', 'home', 'lan', 'localdomain'})
HOST_RE = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?')
DOCUMENTATION_RE = re.compile(r'(?:\A|\.)example\.(?:com|net|org)\Z')
IDENTIFIER_RE = re.compile(r'[a-z][a-z0-9_]{0,62}')
MEMBER_NAME_RE = re.compile(r'[a-z][a-z0-9_]{0,31}')
SECRET_NAME_RE = re.compile(r'aya-[a-z0-9]+(?:-[a-z0-9]+)*')
SECRET_VERSION_RE = re.compile(r'[1-9][0-9]{0,9}')

SECRET_FRAGMENTS = ('password', 'passwd', 'secret', 'token', 'private', 'apikey', 'credential', 'jwk', 'dsn',
                    'database_url', 'connection_string', 'conninfo')
SECRET_WORDS = frozenset({'pass', 'key', 'keys'})

RESERVED_SCHEMAS = frozenset({'public', 'information_schema', 'auth', 'storage', 'realtime', 'extensions', 'graphql',
                              'graphql_public', 'pgbouncer', 'vault', 'net', 'cron', 'pgsodium', 'pgsodium_masks'})
RESERVED_SCHEMA_PREFIXES = ('pg_', 'supabase')
RESERVED_ROLES = frozenset({'postgres', 'public', 'anon', 'authenticated', 'service_role', 'authenticator',
                            'dashboard_user', 'pgbouncer'})
RESERVED_ROLE_PREFIXES = ('pg_', 'pgsodium', 'supabase')

SCHEMA_DEFAULTS = {'app': 'ayailmu', 'auth': 'aya_auth'}
ROLE_DEFAULTS = {'app_owner': 'aya_owner', 'app_runtime': 'aya_runtime', 'auth_owner': 'aya_auth_owner',
                 'backup': 'aya_backup'}

# The required secret slots in order; the Google slot follows them and is required only when Google sign-in is on.
SECRET_SLOTS = ('api_database_url', 'api_auth_admin_credential', 'migration_database_url', 'auth_database_url',
                'auth_jwt_keys', 'auth_jwt_secret', 'auth_smtp_password', 'database_root_ca')
GOOGLE_SLOT = 'auth_google_client_secret'

TOP_MEMBERS = {'format': False, 'example': True, 'api': True, 'auth': True, 'database': True, 'schemas': False,
               'roles': False, 'secret_references': True}
API_MEMBERS = {'origin': True, 'min_instances': False, 'max_instances': True, 'db_pool_max_conns': True}
AUTH_MEMBERS = {'origin': True, 'issuer': False, 'min_instances': False, 'max_instances': True,
                'db_pool_max_size': True, 'google_enabled': False}
DATABASE_MEMBERS = {'host': True, 'port': True, 'connection_mode': True, 'tls_mode': True, 'connection_limit': True,
                    'migration_connections': True, 'backup_connections': True, 'headroom_connections': True}
SCHEMA_MEMBERS = {name: False for name in SCHEMA_DEFAULTS}
ROLE_MEMBERS = {name: False for name in ROLE_DEFAULTS}
SECRET_MEMBERS = {slot: False for slot in SECRET_SLOTS + (GOOGLE_SLOT,)}

MESSAGES = {
    'missing_field': 'A required member is missing.',
    'invalid_type': 'The member has the wrong JSON type.',
    'unknown_field': 'The member is not part of the closed input.',
    'secret_field_refused': 'A member named like a secret is refused; give a secret reference instead.',
    'invalid_origin': 'The origin is not a canonical https origin on a public name.',
    'non_public_host': 'The last label of the name is not a public one.',
    'managed_supabase_host': 'Managed Supabase hosts are not used by this topology; GoTrue is self-hosted.',
    'placeholder_host': 'A documentation name is allowed only in an input labelled as an example.',
    'origin_collision': 'The API and Auth services need different origins.',
    'invalid_host': 'The database host is not one exact public host name.',
    'transaction_pooling_unsupported': 'Transaction pooling does not fit the API connection settings.',
    'invalid_connection_mode': 'The connection mode must be direct or session.',
    'tls_not_verify_full': 'The TLS mode must be verify-full.',
    'out_of_range': 'The number is outside its permitted range.',
    'unbounded_pool': 'A pool size of 0 means unlimited in GoTrue and is refused.',
    'min_exceeds_max': 'The minimum instances exceed the maximum.',
    'connection_budget_exceeded': 'The worst-case connection budget exceeds the plan limit.',
    'invalid_identifier': 'The name is not a lowercase identifier of at most 63 bytes.',
    'reserved_schema': 'The schema name is reserved by PostgreSQL or Supabase.',
    'reserved_role': 'The role name is reserved by PostgreSQL or Supabase.',
    'schema_collision': 'The app and Auth schemas must differ.',
    'role_collision': 'Each role must have its own name.',
    'missing_secret_reference': 'A required secret reference is missing.',
    'unpinned_secret_version': 'The secret version must be pinned, not latest.',
    'invalid_secret_reference': 'A secret reference is a Secret Manager name and a pinned version, nothing else.',
    'secret_reference_reused': 'A secret name may be used by one slot only.',
    'unused_secret_reference': 'The Google secret is given while Google sign-in is off.',
}

# Every gate stays outstanding. Summaries are prose: no statements to run, no commands.
GATES = (
    ('api-cloud-run-proxy-admission',
     'Production admits requests only from exact trusted proxy IP literals; Cloud Run has no such profile in code.',
     ('backend/internal/httpapi/admission.go:23-40', 'backend/internal/config/production_staging.go:22-24')),
    ('api-secret-file-mounts',
     'Secret files must be owned by the process user with no group or other access; Cloud Run mounts are not '
     'adapted.',
     ('backend/internal/config/config.go:383-421',)),
    ('api-database-tls-and-session-settings',
     'Nothing requires verify-full; startup does not assert search_path or default_transaction_isolation.',
     ('backend/internal/store/store.go:44-77',)),
    ('api-production-deployment-profile',
     'The only deployment value is staging, and production requires non-empty web origins.',
     ('backend/internal/config/production_staging.go:29-33,50-53', 'backend/internal/config/deploy.go:152-161')),
    ('api-amd64-provenance-build',
     'No linux/amd64 API image of the current revision exists, and the running binary records no revision.',
     ('deploy/api/Dockerfile', 'phase22 runtime report (outside the repository)')),
    ('gotrue-image-platform',
     'The pinned GoTrue digest was used only on the local arm64 Compose stack; its linux/amd64 availability is '
     'unverified.',
     ('deploy/compose.yaml:20',)),
    ('hosted-database-permissions-and-migrations',
     'Hosted postgres is not a superuser. These roles, schemas, grants and default privileges, Data API exclusion '
     'and both migration sets are untested on a disposable hosted project.',
     ('deploy/postgres/initdb/10-aya-roles.sql:1-65',)),
    ('gotrue-postgres-grant-and-rls',
     'Migration 20240612123726 enables row-level security on Auth tables and gives postgres SELECT WITH GRANT '
     'OPTION; a non-owner backup needs BYPASSRLS.',
     ('GoTrue migrations/20240612123726_enable_rls_update_grants.up.sql:3-35',
      'deploy/postgres/initdb/10-aya-roles.sql:8-9,24')),
    ('gotrue-namespace-runtime',
     'Static review of pinned GoTrue v2.197.0 shows cmd/migrate_cmd.go:64 passing DB.Namespace into the migration '
     'templates and internal/models/user.go:139 returning unqualified users, so the Auth role and connection '
     'search_path matter. No hosted runtime or migration has been executed; behaviour under a custom namespace '
     'remains to be verified on a disposable hosted project.',
     ('GoTrue cmd/migrate_cmd.go:64', 'GoTrue internal/models/user.go:139',
      'GoTrue internal/conf/configuration.go:121', 'GoTrue README.md:278-280')),
    ('gotrue-keys-and-admin-credential',
     'The durable ES256 key set, the required JWT secret and a bounded admin credential need an owner, custody and '
     'rotation.',
     ('GoTrue internal/conf/configuration.go:145-157', 'deploy/README.md:227')),
    ('smtp-delivery',
     'Sender domain with SPF, DKIM and DMARC; verification, resend and reset links; proof of delivery.',
     ('GoTrue README.md:516-552', 'deploy/compose.yaml:122-146')),
    ('client-account-flows',
     'The app accepts only .test password accounts, keeps sessions in memory and has no export or deletion screen.',
     ('RN app/src/auth/supabaseAuth.ts:347-353,632-633', 'RN app/src/app/settings.tsx:132')),
    ('oauth-only-reauth',
     'Recent sign-in comes only from a password sign-in, so a Google-only account cannot export or delete.',
     ('backend/internal/authn/supabase.go:327-333', 'backend/internal/httpapi/account.go:111-121')),
    ('native-builds-and-callbacks',
     'Signed iOS and Android builds, app IDs, the native callback and Google registration; Expo Go proves no OAuth.',
     ('RN app/app.json:9-33', 'RN app/src/auth/googleDevice.ts:14')),
    ('reviewed-content',
     'The active content pack is synthetic, with every item and screen in draft.',
     ('RN app/src/content/fixtures/demo-v0.3.json:4', 'RN app/src/content/gating.ts:23-26')),
    ('operations',
     'Scheduled off-instance backups, a restore rehearsal with deletion-ledger replay before exposure, retention, '
     'monitoring, alerts and rate limits.',
     ('backend/cmd/ayailmu-ledger/main.go:1-40', 'backend/internal/store/migrations/0002_account_deletion.sql:1-4')),
    ('cost-and-resource-approval',
     'The owner decision record holds a dedicated unbilled project and its verified owner. Billing linkage, paid '
     'resources, credential creation, API enablement, OAuth grants, new access grants and live deployment are not '
     'approved. Min instances 0 bills by use and promises no zero cost.',
     ('owner decision record', 'plan: Cloud project snapshot')),
)


class Refusal(Exception):
    """The input could not be evaluated (exit status 2); carries the error code only, never a value."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


class DuplicateMember(Exception):
    pass


def _join(parent, name):
    return f'{parent}.{name}' if parent else name


class Findings:
    """Findings of one evaluation: a code and a field path each, never a value."""

    def __init__(self):
        self.items = set()

    def add(self, code, field):
        self.items.add((field, code))

    def listing(self):
        return [{'code': code, 'field': field, 'message': MESSAGES[code]} for field, code in sorted(self.items)]


# --- input -----------------------------------------------------------------------------------------------------------

def read_input(source):
    """At most MAX_INPUT_BYTES from standard input or from one regular, non-symlink file; nothing else is read."""
    if source == '-':
        try:
            data = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        except (OSError, ValueError, AttributeError):
            raise Refusal('input_unreadable')
    else:
        try:
            info = os.lstat(source)
        except (OSError, ValueError):
            raise Refusal('input_unreadable')
        if not stat.S_ISREG(info.st_mode):
            raise Refusal('input_not_regular_file')
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, 'O_CLOEXEC', 0)
        try:
            fd = os.open(source, flags)
        except (OSError, ValueError):
            raise Refusal('input_unreadable')
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise Refusal('input_not_regular_file')
            data = b''
            while len(data) <= MAX_INPUT_BYTES:
                chunk = os.read(fd, MAX_INPUT_BYTES + 1 - len(data))
                if not chunk:
                    break
                data += chunk
        except OSError:
            raise Refusal('input_unreadable')
        finally:
            os.close(fd)
    if len(data) > MAX_INPUT_BYTES:
        raise Refusal('input_too_large')
    return data


def _no_duplicates(pairs):
    members = {}
    for name, value in pairs:
        if name in members:
            raise DuplicateMember()
        members[name] = value
    return members


def _no_constants(name):
    raise ValueError(name)


def parse_input(data):
    """The input document: one JSON object of the supported format, with no duplicate member at any depth."""
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        raise Refusal('input_not_utf8')
    try:
        doc = json.loads(text, object_pairs_hook=_no_duplicates, parse_constant=_no_constants)
    except DuplicateMember:
        raise Refusal('duplicate_member')
    except (ValueError, RecursionError):
        raise Refusal('invalid_json')
    if not isinstance(doc, dict):
        raise Refusal('not_an_object')
    if not isinstance(doc.get('format'), str) or doc['format'] != INPUT_FORMAT:
        raise Refusal('unsupported_format')
    return doc


# --- evaluation ------------------------------------------------------------------------------------------------------

def _unknown(f, parent, name):
    """An unknown member: refused as a secret when its name looks like one, otherwise as unknown."""
    lowered = name.lower()
    secret_like = (any(fragment in lowered for fragment in SECRET_FRAGMENTS)
                   or bool(SECRET_WORDS & set(lowered.split('_'))))
    shown = name if MEMBER_NAME_RE.fullmatch(name) else '<member>'
    f.add('secret_field_refused' if secret_like else 'unknown_field', _join(parent, shown))


def _object(f, value, path, members):
    """The value when it is a JSON object, with unknown and missing members reported; members maps name -> required."""
    if not isinstance(value, dict):
        f.add('invalid_type', path)
        return None
    for name in sorted(value):
        if name not in members:
            _unknown(f, path, name)
    for name, required in members.items():
        if required and name not in value:
            f.add('missing_field', _join(path, name))
    return value


def _section(f, parent, parent_path, name, members, default=None):
    if name not in parent:
        return default
    return _object(f, parent[name], _join(parent_path, name), members)


def _integer(f, section, path, name):
    """The member when it is an exact JSON integer; booleans and floats are the wrong type."""
    if name not in section:
        return None
    value = section[name]
    if isinstance(value, bool) or not isinstance(value, int):
        f.add('invalid_type', _join(path, name))
        return None
    return value


def _ranged(f, section, path, name, low, high):
    value = _integer(f, section, path, name)
    if value is None:
        return None
    if not low <= value <= high:
        f.add('out_of_range', _join(path, name))
        return None
    return value


def _min_instances(f, section, path, maximum):
    if 'min_instances' not in section:
        return 0
    value = _integer(f, section, path, 'min_instances')
    if value is None:
        return None
    field = _join(path, 'min_instances')
    if value < 0 or (maximum is None and value > 10):
        f.add('out_of_range', field)
    elif maximum is not None and value > maximum:
        f.add('min_exceeds_max', field)
    else:
        return value
    return None


def _host_syntax_ok(host):
    return len(host) <= 253 and HOST_RE.fullmatch(host) is not None


def _host_policy(f, host, field, example):
    """Findings for a syntactically valid host name; example is True, False or None when unknown."""
    if host.rsplit('.', 1)[1] in NON_PUBLIC_LABELS:
        f.add('non_public_host', field)
    if example is False and DOCUMENTATION_RE.search(host):
        f.add('placeholder_host', field)


def _origin(f, section, path, name, example):
    """The origin when it is a canonical https origin on a host name; policy findings are added either way."""
    if name not in section:
        return None
    field = _join(path, name)
    value = section[name]
    if not isinstance(value, str):
        f.add('invalid_type', field)
        return None
    host = value[len('https://'):]
    if not value.startswith('https://') or not _host_syntax_ok(host):
        f.add('invalid_origin', field)
        return None
    _host_policy(f, host, field, example)
    for managed in ('supabase.co', 'supabase.com'):
        if host == managed or host.endswith('.' + managed):
            f.add('managed_supabase_host', field)
    return value


def _database_host(f, database, example):
    if 'host' not in database:
        return
    value = database['host']
    if not isinstance(value, str):
        f.add('invalid_type', 'database.host')
    elif not _host_syntax_ok(value):
        f.add('invalid_host', 'database.host')
    else:
        _host_policy(f, value, 'database.host', example)


def _database_choices(f, database):
    for name in ('connection_mode', 'tls_mode'):
        if name in database and not isinstance(database[name], str):
            f.add('invalid_type', _join('database', name))
    mode = database.get('connection_mode')
    if isinstance(mode, str) and mode not in ('direct', 'session'):
        f.add('transaction_pooling_unsupported' if mode == 'transaction' else 'invalid_connection_mode',
              'database.connection_mode')
    tls = database.get('tls_mode')
    if isinstance(tls, str) and tls != 'verify-full':
        f.add('tls_not_verify_full', 'database.tls_mode')


def _identifiers(f, section, path, defaults, reserved, prefixes, reserved_code):
    """The effective, valid name of each member, in order; defaults fill the members left out."""
    names = {}
    for name, default in defaults.items():
        field = _join(path, name)
        value = section.get(name, default)
        if not isinstance(value, str):
            f.add('invalid_type', field)
        elif not IDENTIFIER_RE.fullmatch(value):
            f.add('invalid_identifier', field)
        elif value in reserved or value.startswith(prefixes):
            f.add(reserved_code, field)
        else:
            names[name] = value
    return names


def _reference(value):
    """(finding code or None, secret name when it is a valid one) for one secret reference."""
    if not isinstance(value, dict) or set(value) != {'secret', 'version'}:
        return 'invalid_secret_reference', None
    secret, version = value['secret'], value['version']
    if not isinstance(secret, str) or not isinstance(version, str):
        return 'invalid_secret_reference', None
    if len(secret) > 63 or not SECRET_NAME_RE.fullmatch(secret):
        return 'invalid_secret_reference', None
    if version == 'latest':
        return 'unpinned_secret_version', secret
    if not SECRET_VERSION_RE.fullmatch(version):
        return 'invalid_secret_reference', secret
    return None, secret


def _secret_references(f, references, google):
    """The pinned references that are in use; google is True, False, or None when google_enabled is invalid."""
    used = {}
    seen = set()
    for slot in SECRET_SLOTS + (GOOGLE_SLOT,):
        field = _join('secret_references', slot)
        if slot == GOOGLE_SLOT:
            if google is None:
                continue
            if not google:
                if slot in references:
                    f.add('unused_secret_reference', field)
                continue
        if slot not in references:
            f.add('missing_secret_reference', field)
            continue
        code, secret = _reference(references[slot])
        if code:
            f.add(code, field)
        if secret is not None:
            if secret in seen:
                f.add('secret_reference_reused', field)
            seen.add(secret)
        if code is None:
            used[slot] = {'secret': secret, 'version': references[slot]['version']}
    return used


def evaluate(doc):
    """(findings, packet): the packet is built only when there is no finding."""
    f = Findings()
    example = doc['example'] if isinstance(doc.get('example'), bool) else None
    if 'example' in doc and example is None:
        f.add('invalid_type', 'example')
    _object(f, doc, '', TOP_MEMBERS)

    api = _section(f, doc, '', 'api', API_MEMBERS)
    auth = _section(f, doc, '', 'auth', AUTH_MEMBERS)
    database = _section(f, doc, '', 'database', DATABASE_MEMBERS)
    schemas = _section(f, doc, '', 'schemas', SCHEMA_MEMBERS, {})
    roles = _section(f, doc, '', 'roles', ROLE_MEMBERS, {})
    references = _section(f, doc, '', 'secret_references', SECRET_MEMBERS)

    api_origin = api_min = api_max = api_pool = None
    if api is not None:
        api_origin = _origin(f, api, 'api', 'origin', example)
        api_max = _ranged(f, api, 'api', 'max_instances', 1, 10)
        api_min = _min_instances(f, api, 'api', api_max)
        api_pool = _ranged(f, api, 'api', 'db_pool_max_conns', 1, 20)

    auth_origin = issuer = auth_min = auth_max = auth_pool = google = None
    if auth is not None:
        auth_origin = _origin(f, auth, 'auth', 'origin', example)
        issuer = _origin(f, auth, 'auth', 'issuer', example) if 'issuer' in auth else auth_origin
        auth_max = _ranged(f, auth, 'auth', 'max_instances', 1, 10)
        auth_min = _min_instances(f, auth, 'auth', auth_max)
        if _integer(f, auth, 'auth', 'db_pool_max_size') == 0:
            f.add('unbounded_pool', 'auth.db_pool_max_size')
        else:
            auth_pool = _ranged(f, auth, 'auth', 'db_pool_max_size', 1, 20)
        google = auth.get('google_enabled', False)
        if not isinstance(google, bool):
            f.add('invalid_type', 'auth.google_enabled')
            google = None
    if api_origin is not None and api_origin == auth_origin:
        f.add('origin_collision', 'auth.origin')

    port = limit = migration = backup = headroom = None
    if database is not None:
        _database_host(f, database, example)
        _database_choices(f, database)
        port = _ranged(f, database, 'database', 'port', 1, 65535)
        limit = _ranged(f, database, 'database', 'connection_limit', 1, 10000)
        migration = _ranged(f, database, 'database', 'migration_connections', 1, 100)
        backup = _ranged(f, database, 'database', 'backup_connections', 1, 100)
        headroom = _ranged(f, database, 'database', 'headroom_connections', 1, 100)

    budget = None
    counts = (api_max, api_pool, auth_max, auth_pool, migration, backup, headroom, limit)
    if all(count is not None for count in counts):
        budget = {'api': api_max * api_pool, 'auth': auth_max * auth_pool, 'migration': migration, 'backup': backup,
                  'headroom': headroom, 'limit': limit}
        budget['total'] = budget['api'] + budget['auth'] + migration + backup + headroom
        if budget['total'] > limit:
            f.add('connection_budget_exceeded', 'database.connection_limit')

    schema_names = role_names = {}
    if schemas is not None:
        schema_names = _identifiers(f, schemas, 'schemas', SCHEMA_DEFAULTS, RESERVED_SCHEMAS,
                                    RESERVED_SCHEMA_PREFIXES, 'reserved_schema')
        if 'app' in schema_names and schema_names.get('auth') == schema_names['app']:
            f.add('schema_collision', 'schemas.auth')
    if roles is not None:
        role_names = _identifiers(f, roles, 'roles', ROLE_DEFAULTS, RESERVED_ROLES, RESERVED_ROLE_PREFIXES,
                                  'reserved_role')
        earlier = set()
        for name in ROLE_DEFAULTS:
            if name in role_names:
                if role_names[name] in earlier:
                    f.add('role_collision', _join('roles', name))
                earlier.add(role_names[name])

    secrets = None
    if references is not None:
        secrets = _secret_references(f, references, google)

    if f.items:
        return f, None
    packet = {
        'non_executable': True,
        'example': example,
        'topology': TOPOLOGY,
        'services': {
            'api': {'origin': api_origin, 'image': None, 'min_instances': api_min, 'max_instances': api_max,
                    'db_pool_max_conns': api_pool},
            'auth': {'origin': auth_origin, 'issuer': issuer, 'audience': 'authenticated', 'image': GOTRUE_IMAGE,
                     'min_instances': auth_min, 'max_instances': auth_max, 'db_pool_max_size': auth_pool,
                     'google_enabled': google, 'google_callback': auth_origin + '/callback' if google else None},
        },
        'database': {
            'host': database['host'], 'port': port, 'connection_mode': database['connection_mode'],
            'tls_mode': database['tls_mode'], 'schemas': schema_names, 'roles': role_names,
            'connection_budget': budget,
        },
        'secret_references': secrets,
    }
    return f, packet


# --- output ----------------------------------------------------------------------------------------------------------

def build_result(command, digest, error, findings, example, packet):
    configuration = None
    if findings is not None:
        configuration = {'valid': not findings.items, 'example': example, 'findings': findings.listing()}
    return {
        'format': RESULT_FORMAT,
        'command': command,
        'input_sha256': digest,
        'error': {'code': error} if error else None,
        'configuration': configuration,
        'deployment_ready': False,
        'applies_changes': False,
        'creates_resources': False,
        'hosted_compatibility_verified': False,
        'zero_cost_guaranteed': False,
        'gates': [{'id': gate, 'status': 'outstanding', 'summary': summary, 'sources': list(sources)}
                  for gate, summary, sources in GATES],
        'packet': packet,
    }


def render(result):
    """Deterministic printable ASCII: ensure_ascii escapes control characters, DEL and everything non-ASCII."""
    return (json.dumps(result, ensure_ascii=True, sort_keys=True, indent=2) + '\n').encode('ascii')


def check_output(path):
    """OUTPUT must be a new path (a symlink, dangling or not, counts as existing) in an existing directory."""
    try:
        os.lstat(path)
    except FileNotFoundError:
        try:
            parent_is_directory = stat.S_ISDIR(os.stat(os.path.dirname(path) or '.').st_mode)
        except (OSError, ValueError):
            parent_is_directory = False
        if not parent_is_directory:
            raise Refusal('output_unwritable')
        return
    except (OSError, ValueError):
        raise Refusal('output_unwritable')
    raise Refusal('output_exists')


def write_output(path, data):
    """Creates path exclusively with mode 0600; it never replaces or follows anything."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | getattr(os, 'O_CLOEXEC', 0)
    try:
        fd = os.open(path, flags, 0o600)
    except FileExistsError:
        raise Refusal('output_exists')
    except (OSError, ValueError):
        raise Refusal('output_unwritable')
    try:
        os.fchmod(fd, 0o600)
        view = memoryview(data)
        while view:
            view = view[os.write(fd, view):]
    except OSError:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise Refusal('output_unwritable')
    finally:
        os.close(fd)


def run(argv):
    """(exit status, rendered result). The packet file, when asked for, is written before this returns."""
    if len(argv) == 2 and argv[0] == 'check':
        command, source, target = 'check', argv[1], None
    elif len(argv) == 3 and argv[0] == 'packet':
        command, source, target = 'packet', argv[1], argv[2]
    else:
        return 2, render(build_result(None, None, 'usage', None, False, None))
    digest = None
    try:
        data = read_input(source)
        digest = hashlib.sha256(data).hexdigest()
        doc = parse_input(data)
        if target is not None:
            check_output(target)
        findings, packet = evaluate(doc)
        status = 1 if findings.items else 0
        rendered = render(build_result(command, digest, None, findings, doc.get('example') is True, packet))
        if target is not None and packet is not None:
            write_output(target, rendered)
        return status, rendered
    except Refusal as refusal:
        return 2, render(build_result(command, digest, refusal.code, None, False, None))


def main(argv):
    status, rendered = run(argv)
    sys.stdout.buffer.write(rendered)
    sys.stdout.buffer.flush()
    return status


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
