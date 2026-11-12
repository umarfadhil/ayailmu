"""Local synthetic Compose stack of Amar's adult Arabic app (deploy/compose.yaml), for Root to run.

    python3 -I deploy/tools/aya_stack.py prepare [--port PORT] [--jose-util PATH]
    python3 -I deploy/tools/aya_stack.py up RUNTIME_DIR [--keep-on-failure]
    python3 -I deploy/tools/aya_stack.py status RUNTIME_DIR
    python3 -I deploy/tools/aya_stack.py verify RUNTIME_DIR
    python3 -I deploy/tools/aya_stack.py backup RUNTIME_DIR
    python3 -I deploy/tools/aya_stack.py stop RUNTIME_DIR
    python3 -I deploy/tools/aya_stack.py down RUNTIME_DIR [--purge-backups]
    python3 -I deploy/tools/aya_stack.py initdb-modes

prepare  creates one stack's private runtime directory (0700) under .vps-runtime-20261018, named by its new label
         aya-amar-p8-stack-<UTC stamp>-<random>, which is also its Compose project name. It picks (or checks) a free high
         port on 127.0.0.1, generates every synthetic secret into secrets/ (directories 0700, files 0600; never printed,
         never in an argument): one password per database role, each service's database URL, GoTrue's ES256 signing
         key (the pinned go-jose jose-util generates it), a service_role admin JWT jose-util signs with it, the backup
         role's pgpass, and two .test users. It writes stack.env (names, port and paths only) for Compose.
up       builds the API image (aya-amar-api:<label>) from backend/, starts the stack, waits for the migration job and
         every healthcheck, checks that the database enforces exactly the stack's client authentication rules and that
         the migration printed the schema version, exports the root of Caddy's local CA to proxy-root.crt and checks
         readiness through the front. A failure saves redacted logs and removes what this stack created, unless
         --keep-on-failure.
status   containers, health and readiness through the front.
verify   container users, read-only roots, capabilities, networks, mounts, published ports and image IDs; no secret value
         in docker inspect, compose config or the API image; host and volume secret ownership and modes; database roles,
         grants, client authentication and connections, with probes that show the runtime role cannot run DDL and the
         backup role cannot write (in transactions that always roll back); the migration job run again changing nothing;
         Auth's settings; then the prepared users are created through Auth's internal admin API and verify-stack.cjs runs
         the real SDK and API checks through the front, ending with each user's account deletion through the API. Any
         prepared user left behind is deleted by its exact ID.
backup   pg_dump --format=custom of aya_app and aya_auth as the read-only aya_backup role, written by this process into
         backups/<stamp>/ (0700, files 0600), with sizes, SHA-256 and a pg_restore --list table count. Restoring is NOT
         part of this slice and is not verified.
stop     docker compose stop for exactly this project: its volumes, secrets and backups stay, and `up` starts the
         same data again.
down     docker compose down --volumes for exactly this project, removes its API image after checking its label,
         confirms nothing labelled for the stack is left, and removes the secrets and runtime files. Backups are kept
         (private) unless --purge-backups.
initdb-modes
         sets, then checks, mode 0755 on exactly postgres/initdb/20-aya-hba.sh (no secret) and on no other file, as
         prepare and up do first: under Docker Desktop the PostgreSQL entrypoint executes that script, and the kernel
         refuses (exit 126) unless it is really executable.

Every Docker command runs with the anonymous Docker CLI configuration and names this stack's project; nothing is pulled,
pruned or removed by pattern, and no other container, network, volume or image is touched. Output and the evidence files
under .vps-prep-evidence-20261018 hold names, states, statuses, counts and hashes only.
"""
from pathlib import Path
import argparse
import datetime
import hashlib
import http.client
import json
import os
import secrets
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import time

ROOT = Path('/Users/amarmaruf/Documents/Codex/2026-10-13/task-2')
WORKTREE = ROOT / 'ayailmu-backend-20261017'
DEPLOY = WORKTREE / 'deploy'
BACKEND = WORKTREE / 'backend'
COMPOSE_FILE = DEPLOY / 'compose.yaml'
DB_CHECKS = DEPLOY / 'tools' / 'db-checks.sql'
VERIFY_SCRIPT = DEPLOY / 'tools' / 'verify-stack.cjs'
HBA_INITIALIZER = DEPLOY / 'postgres' / 'initdb' / '20-aya-hba.sh'
EVIDENCE = ROOT / '.vps-prep-evidence-20261018'
RUNTIME = ROOT / '.vps-runtime-20261018'
DOCKER = '/usr/local/bin/docker'
NODE = '/Users/amarmaruf/.nvm/versions/node/v22.16.0/bin/node'
JOSE_UTIL = RUNTIME / 'go-jose-v4.1.6-util'
PREFIX = 'aya-amar-p8-stack-'
API_IMAGE_REPOSITORY = 'aya-amar-api'

# The pinned official images and the local image IDs Root recorded for them (phase8-cached-images-readonly-preflight.json).
IMAGES = {
    'postgres': 'docker.io/library/postgres:16.15-bookworm@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4',
    'gotrue': 'docker.io/supabase/gotrue:v2.197.0@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b',
    'caddy': 'docker.io/library/caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f',
    'golang': 'docker.io/library/golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61',
}
IMAGE_IDS = {
    'postgres': 'sha256:4b5d4fd438e2c1ce13106e4996fc604f0a1cff39cde48b546fcac3cf1a233c3a',
    'gotrue': 'sha256:1fe404919398421de491a1580e1dcce1faca055e985fd9bd9029520880845056',
    'caddy': 'sha256:f6a2207268b0f0914df9d3569e1824d6adcfa7b59fbffe0f3cbc5d2d60423f71',
    'golang': 'sha256:8daab0ae6527cc929bebbfbce0d6e4c7ba363d6213264ffeb5d5bd559d4a03a7',
}

# The front's synthetic names, which resolve nowhere; clients reach them on 127.0.0.1 by their own resolution.
API_HOST = 'api.ayailmu-local.test'
AUTH_HOST = 'auth.ayailmu-local.test'
APP_HOST = 'app.ayailmu-local.test'
# A fixed synthetic issuer: accounts are keyed by it, so a restored stack keeps it.
ISSUER = 'https://auth.ayailmu-local.test/auth/v1'
AUDIENCE = 'authenticated'
SCHEMA_VERSION = '3'
USERS = 2
# The server-only admin credential's lifetime; prepare a new stack after it.
ADMIN_TOKEN_LIFETIME = 7 * 24 * 3600
# Host ports this helper never takes: the existing PostgreSQL, Auth emulator, APIs, previews and fixtures.
RESERVED_PORTS = {6543, 9099, 8087, 8088, 8091, 8092, 58582, 59838, 63290}

ROLE_PASSWORDS = ('postgres', 'aya_owner', 'aya_runtime', 'aya_backup', 'aya_auth_owner')
SECRET_FILES = (
    'db/postgres-password', 'db/aya_owner.password', 'db/aya_runtime.password', 'db/aya_backup.password',
    'db/aya_auth_owner.password', 'auth/database-url', 'auth/jwt-keys.json', 'auth/jwt-secret', 'migrate/database-url',
    'api/database-url', 'api/admin-key', 'backup/pgpass', 'ops/admin-header',
) + tuple('ops/users/user-%d.json' % n for n in range(1, USERS + 1))
# The user each secret volume belongs to.
VOLUME_OWNERS = {'db': 999, 'auth': 1000, 'migrate': 65532, 'api': 65532, 'backup': 999, 'ops': 65532}

LONG_RUNNING = ('aya-db', 'aya-auth', 'aya-api', 'aya-proxy')
HEALTHCHECKED = ('aya-db', 'aya-auth', 'aya-api')
ONE_SHOT = ('aya-secrets-init', 'aya-migrate')
# Per service: image key (or 'api'), user, capabilities added back, networks, and the named volumes it mounts (rw?).
EXPECTED = {
    'aya-secrets-init': ('postgres', '0:0', {'CHOWN', 'DAC_OVERRIDE', 'FOWNER'}, set(),
                         {'db-secrets': True, 'auth-secrets': True, 'migrate-secrets': True, 'api-secrets': True,
                          'backup-secrets': True, 'ops-secrets': True, 'proxy-data': True}),
    'aya-db': ('postgres', '999:999', set(), {'data-net'}, {'db-data': True, 'db-secrets': False}),
    'aya-migrate': ('api', '65532:65532', set(), {'data-net'}, {'migrate-secrets': False}),
    'aya-auth': ('gotrue', '1000:1000', set(), {'auth-net', 'data-net'}, {'auth-secrets': False}),
    'aya-api': ('api', '65532:65532', set(), {'api-net', 'auth-net', 'data-net'}, {'api-secrets': False}),
    'aya-proxy': ('caddy', '65532:65532', {'NET_BIND_SERVICE'}, {'edge', 'api-net', 'auth-net'}, {'proxy-data': True}),
}
NETWORKS = {'edge': False, 'api-net': True, 'auth-net': True, 'data-net': True}
VOLUMES = ('db-data', 'db-secrets', 'auth-secrets', 'migrate-secrets', 'api-secrets', 'backup-secrets', 'ops-secrets',
           'proxy-data')
# The client authentication 20-aya-hba.sh writes: the bootstrap superuser only over the database container's own socket,
# as its own OS user; each service role only to its own database, from the data network, with SCRAM. Nothing else.
HBA_RULES = [{'type': 'local', 'database': ['all'], 'user': ['postgres'], 'address': None, 'method': 'peer'}] + [
    {'type': 'host', 'database': [database], 'user': [role], 'address': 'samenet', 'method': 'scram-sha-256'}
    for database, role in (('aya_app', 'aya_owner'), ('aya_app', 'aya_runtime'), ('aya_app', 'aya_backup'),
                           ('aya_auth', 'aya_auth_owner'), ('aya_auth', 'aya_backup'))]
# The rules the server enforces. pg_hba_file_rules reads pg_hba.conf as it is now, not as the server loaded it, so the
# file must also be unchanged since the server last loaded its configuration.
HBA_LOADED_SQL = """SELECT json_build_object(
  'rules', (SELECT json_agg(json_build_object('type', type, 'database', database, 'user', user_name, 'address', address,
                                              'method', auth_method) ORDER BY line_number) FROM pg_hba_file_rules),
  'errors', (SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL),
  'unchanged_since_loaded', (pg_stat_file(current_setting('hba_file'))).modification <= pg_conf_load_time())::text;
"""

DOCKER_ENV = os.environ.copy()
DOCKER_ENV.update(DOCKER_CONFIG=str(RUNTIME / 'docker-cli'), DOCKER_HOST='unix:///Users/amarmaruf/.docker/run/docker.sock')
for _key in ('DOCKER_CONTEXT', 'DOCKER_AUTH_CONFIG', 'COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES',
             'COMPOSE_ENV_FILES', 'COMPOSE_PATH_SEPARATOR'):
    DOCKER_ENV.pop(_key, None)


class Refused(Exception):
    """A failed step or check. Its message is a fixed description, never data."""


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S').lower()


def docker(*args, input=None, timeout=120):
    return subprocess.run([DOCKER, *args], env=DOCKER_ENV, input=input, text=True, capture_output=True,
                          timeout=timeout)


def require(result, step):
    if result.returncode:
        raise Refused(step + ' failed')
    return result


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def private_dir(path):
    path.mkdir(mode=0o700)
    os.chmod(path, 0o700)
    return path


def write_private(path, text):
    """A new 0600 file holding text; never overwrites."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(text)
    return path


def jose_util(path):
    binary = Path(path)
    if binary.is_dir():
        binary = binary / 'jose-util'
    if not (binary.is_file() and os.access(binary, os.X_OK)):
        raise SystemExit('the pinned jose-util binary was not found; pass --jose-util PATH')
    return binary


def jose_sign(binary, key_path, claims):
    """A compact ES256 JWS of claims, signed by jose-util: payload on stdin, token on stdout, nothing secret in arguments."""
    result = subprocess.run([str(binary), 'sign', '--key', str(key_path), '--alg', 'ES256'],
                            input=json.dumps(claims, separators=(',', ':')), text=True, capture_output=True, timeout=30)
    token = result.stdout.strip()
    if result.returncode or token.count('.') != 2:
        raise Refused('jose-util could not sign the admin credential')
    return token


def port_free(port):
    """Nothing listens on 127.0.0.1:port, it can be bound, and no container publishes it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1)
        if probe.connect_ex(('127.0.0.1', port)) == 0:
            return False
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(('127.0.0.1', port))
    except OSError:
        return False
    published = docker('ps', '--all', '--quiet', '--filter', 'publish=%d' % port)
    return published.returncode == 0 and published.stdout.strip() == ''


def free_port():
    for _ in range(50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        if port >= 49152 and port not in RESERVED_PORTS and port_free(port):
            return port
    raise Refused('no free high loopback port')


def source_hashes():
    """SHA-256 of every deploy file, and one digest over the backend build inputs (non-test Go, SQL, go.mod, go.sum)."""
    deploy = {str(path.relative_to(WORKTREE)): sha256_file(path)
              for path in sorted(DEPLOY.rglob('*')) if path.is_file() and '__pycache__' not in path.parts}
    lines = []
    for path in sorted(BACKEND.rglob('*')):
        relative = str(path.relative_to(WORKTREE))
        if not path.is_file() or path.name.endswith('_test.go'):
            continue
        if path.suffix in ('.go', '.sql') or path.name in ('go.mod', 'go.sum'):
            lines.append(relative + '\0' + sha256_file(path) + '\n')
    combined = hashlib.sha256(''.join(lines).encode()).hexdigest()
    return {'deploy_files': deploy, 'backend_build_inputs': {'files': len(lines), 'sha256': combined}}


def hba_initializer_mode():
    """Sets, then checks, mode 0755 on exactly postgres/initdb/20-aya-hba.sh, a regular file of this user that holds no
    secret, and on no other file. The PostgreSQL entrypoint executes an init script that `test -x` reports executable
    and sources any other; Docker Desktop's bind mounts report even a 0644 file executable, which the kernel then
    refuses to execute (exit 126)."""
    try:
        before = HBA_INITIALIZER.lstat()
        if stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid():
            os.chmod(HBA_INITIALIZER, 0o755)
        after = HBA_INITIALIZER.lstat()
    except OSError:
        raise Refused('the HBA initializer could not be made executable')
    if not (stat.S_ISREG(after.st_mode) and after.st_uid == os.getuid() and stat.S_IMODE(after.st_mode) == 0o755):
        raise Refused('the HBA initializer is not a regular file of this user with mode 0755')
    return {'file': str(HBA_INITIALIZER.relative_to(WORKTREE)), 'mode_before': '%04o' % stat.S_IMODE(before.st_mode),
            'mode': '%04o' % stat.S_IMODE(after.st_mode)}


def parse_json_lines(text):
    """docker compose ps --format json: one array, or one object per line."""
    text = text.strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else [parsed]
    except ValueError:
        return [json.loads(line) for line in text.splitlines() if line.strip()]


class FrontConnection(http.client.HTTPSConnection):
    """HTTPS to one of the front's names, connected to 127.0.0.1 by this process: the name is the SNI, the certificate
    name checked and the Host; only the context's CA (the stack's exported root) is trusted. No proxy, no redirect."""

    def __init__(self, name, port, context, timeout=10):
        super().__init__(name, port, context=context, timeout=timeout)
        self._front_name = name

    def connect(self):
        sock = socket.create_connection(('127.0.0.1', self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self._front_name)


class Stack:
    def __init__(self, private, manifest):
        self.private, self.manifest = private, manifest

    @classmethod
    def new(cls, port):
        label = PREFIX + stamp() + '-' + secrets.token_hex(3)
        private = private_dir(RUNTIME / label)
        manifest = {'label': label, 'project': label, 'runtime_directory': str(private), 'port': port,
                    'api_host': API_HOST, 'auth_host': AUTH_HOST, 'app_host': APP_HOST, 'issuer': ISSUER,
                    'audience': AUDIENCE, 'images': IMAGES, 'api_image': API_IMAGE_REPOSITORY + ':' + label,
                    'created_at': now_iso(), 'state': 'preparing', 'history': []}
        stack = cls(private, manifest)
        stack.record()
        return stack

    @classmethod
    def load(cls, path):
        private = Path(path).resolve(strict=True)
        if private.parent != RUNTIME.resolve() or not private.name.startswith(PREFIX):
            raise SystemExit('refusing: not a runtime directory of this helper')
        info = private.stat()
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise SystemExit('refusing: the runtime directory is not private to this user')
        manifest = json.loads((private / 'manifest.json').read_text())
        if manifest.get('label') != private.name or manifest.get('project') != private.name:
            raise SystemExit('refusing: the manifest does not belong to this directory')
        return cls(private, manifest)

    label = property(lambda self: self.manifest['label'])
    project = property(lambda self: self.manifest['project'])
    port = property(lambda self: int(self.manifest['port']))
    api_image = property(lambda self: self.manifest['api_image'])
    secrets_dir = property(lambda self: self.private / 'secrets')
    env_file = property(lambda self: self.private / 'stack.env')
    root_cert = property(lambda self: self.private / 'proxy-root.crt')

    def record(self):
        temporary = self.private / 'manifest.json.tmp'
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(self.manifest, handle, indent=2)
        os.replace(temporary, self.private / 'manifest.json')

    def note(self, action, **facts):
        self.manifest['history'].append(dict(facts, action=action, at=now_iso()))
        self.record()

    def compose_args(self, *args):
        return [DOCKER, 'compose', '--project-name', self.project, '--project-directory', str(DEPLOY),
                '--file', str(COMPOSE_FILE), '--env-file', str(self.env_file), *args]

    def compose(self, *args, input=None, timeout=300):
        return subprocess.run(self.compose_args(*args), env=DOCKER_ENV, input=input, text=True, capture_output=True,
                              timeout=timeout)

    # --- secrets -------------------------------------------------------------------------------------------------

    def generate(self, jose):
        """Every synthetic secret of the stack, into secrets/ (directories 0700, files 0600)."""
        base = private_dir(self.secrets_dir)
        for name in ('db', 'auth', 'migrate', 'api', 'backup', 'ops', 'ops/users'):
            private_dir(base / name)
        passwords = {role: secrets.token_hex(32) for role in ROLE_PASSWORDS}
        write_private(base / 'db/postgres-password', passwords['postgres'] + '\n')
        for role in ROLE_PASSWORDS[1:]:
            write_private(base / ('db/%s.password' % role), passwords[role] + '\n')

        def dsn(role, database):
            return 'postgres://%s:%s@aya-db:5432/%s?sslmode=disable' % (role, passwords[role], database)

        write_private(base / 'migrate/database-url', dsn('aya_owner', 'aya_app') + '\n')
        write_private(base / 'api/database-url', dsn('aya_runtime', 'aya_app') + '\n')
        write_private(base / 'auth/database-url', dsn('aya_auth_owner', 'aya_auth') + '\n')
        write_private(base / 'backup/pgpass', ''.join('aya-db:5432:%s:aya_backup:%s\n' % (database, passwords['aya_backup'])
                                                      for database in ('aya_app', 'aya_auth')))
        write_private(base / 'auth/jwt-secret', secrets.token_urlsafe(48) + '\n')

        # GoTrue's signing key: generated by the pinned jose-util into keys/, given the key_ops GoTrue needs (exactly
        # one key signs), as the reviewed Phase 4 fixture does.
        keys = private_dir(self.private / 'keys')
        kid = 'aya-amar-p8-' + secrets.token_hex(6)
        generated = subprocess.run([str(jose), 'generate-key', '--use', 'sig', '--alg', 'ES256', '--kid', kid],
                                   cwd=keys, capture_output=True, text=True, timeout=30)
        private_key = keys / ('jwk-sig-' + kid + '-priv.json')
        if generated.returncode or not private_key.is_file():
            raise Refused('jose-util could not generate the signing key')
        jwk = json.loads(private_key.read_text())
        if jwk.get('kty') != 'EC' or jwk.get('crv') != 'P-256' or not jwk.get('d') or jwk.get('kid') != kid:
            raise Refused('jose-util did not generate a private P-256 key under its kid')
        jwk.update(alg='ES256', use='sig', key_ops=['sign', 'verify'])
        write_private(base / 'auth/jwt-keys.json', json.dumps([jwk], separators=(',', ':')) + '\n')

        # The server-only admin credential: a service_role JWT that jose-util signs with Auth's own key.
        issued = int(time.time())
        admin = jose_sign(jose, private_key, {'role': 'service_role', 'iss': ISSUER, 'iat': issued,
                                              'exp': issued + ADMIN_TOKEN_LIFETIME})
        write_private(base / 'api/admin-key', admin + '\n')
        write_private(base / 'ops/admin-header', 'Authorization: Bearer ' + admin + '\n')

        # The prepared synthetic .test users, as Auth's admin API takes them: confirmed, role authenticated.
        tag = secrets.token_hex(4)
        for n in range(1, USERS + 1):
            user = {'email': 'aya-p8-%s-%d@example.test' % (tag, n), 'password': secrets.token_urlsafe(24),
                    'email_confirm': True, 'role': 'authenticated'}
            write_private(base / ('ops/users/user-%d.json' % n), json.dumps(user) + '\n')

        write_private(self.env_file, ''.join('%s=%s\n' % item for item in (
            ('AYA_STACK_PROJECT', self.project), ('AYA_STACK_LABEL', self.label), ('AYA_STACK_PORT', str(self.port)),
            ('AYA_STACK_SECRETS_DIR', str(self.secrets_dir)), ('AYA_STACK_API_HOST', API_HOST),
            ('AYA_STACK_AUTH_HOST', AUTH_HOST), ('AYA_STACK_APP_HOST', APP_HOST), ('AYA_STACK_ISSUER', ISSUER))))
        self.manifest.update(signing_kid=kid, admin_credential_expires_at=datetime.datetime.fromtimestamp(
            issued + ADMIN_TOKEN_LIFETIME, datetime.timezone.utc).isoformat(), prepared_users=USERS)
        self.record()

    def secret_values(self):
        """Every secret this stack holds, longest first, for redaction and leak scans only; never printed."""
        values = set()
        for relative in SECRET_FILES:
            path = self.secrets_dir / relative
            if not path.is_file():
                continue
            text = path.read_text().strip()
            values.add(text)
            if relative.endswith('.json'):
                document = json.loads(text)
                # A user's generated address is no credential, but no output names it either.
                for item in (document if isinstance(document, list) else [document]):
                    for key in ('d', 'password', 'email'):
                        if isinstance(item, dict) and item.get(key):
                            values.add(item[key])
            elif relative.endswith('database-url'):
                values.add(text.split('://', 1)[1].split('@', 1)[0].split(':', 1)[1])
            elif relative == 'backup/pgpass':
                values.update(line.rsplit(':', 1)[1] for line in text.splitlines())
            elif relative == 'ops/admin-header':
                values.add(text.split('Bearer ', 1)[1])
        for path in (self.private / 'keys').glob('*-priv.json') if (self.private / 'keys').is_dir() else ():
            values.add(json.loads(path.read_text()).get('d', ''))
        return sorted((value for value in values if len(value) >= 8), key=len, reverse=True)

    def redact(self, text, values=None):
        for value in values if values is not None else self.secret_values():
            text = text.replace(value, '[REDACTED_STACK_SECRET]')
        return text

    def leaks(self, text, values=None):
        """How many of the stack's secrets text contains (0 is the only acceptable answer)."""
        return sum(1 for value in (values if values is not None else self.secret_values()) if value in text)

    # --- containers ----------------------------------------------------------------------------------------------

    def ps(self):
        listed = self.compose('ps', '--all', '--format', 'json', timeout=60)
        require(listed, 'list the stack containers')
        by_service = {}
        for entry in parse_json_lines(listed.stdout):
            if entry.get('Project', self.project) == self.project:
                by_service.setdefault(entry.get('Service'), []).append(entry)
        return by_service

    def readiness(self):
        """'ready', 'waiting' or a fixed failure, from the containers' states and health."""
        services = self.ps()
        for name in ONE_SHOT:
            entries = services.get(name, [])
            if any(entry.get('State') == 'exited' and int(entry.get('ExitCode', 1)) != 0 for entry in entries):
                return name + ' exited with an error'
        for name in LONG_RUNNING:
            for entry in services.get(name, []):
                if entry.get('State') in ('exited', 'dead'):
                    return name + ' stopped'
                if entry.get('Health') == 'unhealthy':
                    return name + ' is unhealthy'
        done = all(any(entry.get('State') == 'exited' and int(entry.get('ExitCode', 1)) == 0
                       for entry in services.get(name, [])) for name in ONE_SHOT)
        healthy = all(any(entry.get('State') == 'running' and entry.get('Health') == 'healthy'
                          for entry in services.get(name, [])) for name in HEALTHCHECKED)
        running = any(entry.get('State') == 'running' for entry in services.get('aya-proxy', []))
        return 'ready' if done and healthy and running else 'waiting'

    def wait_ready(self, seconds=420):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            state = self.readiness()
            if state == 'ready':
                return
            if state != 'waiting':
                raise Refused(state)
            time.sleep(3)
        raise Refused('the stack did not become ready in time')

    def enforced_hba(self):
        """Refuses unless the database enforces exactly HBA_RULES, read as the bootstrap superuser over its socket. A
        cluster initialised without 20-aya-hba.sh keeps the generated rules, which accept any role, the bootstrap
        superuser included, from any address with its password."""
        ran = self.compose('exec', '-T', 'aya-db', 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U',
                           'postgres', '-d', 'postgres', '-f', '-', input=HBA_LOADED_SQL, timeout=60)
        require(ran, 'read the client authentication of the database')
        try:
            loaded = json.loads(ran.stdout)
        except ValueError:
            loaded = None
        if not (isinstance(loaded, dict) and loaded.get('rules') == HBA_RULES and loaded.get('errors') == 0 and
                loaded.get('unchanged_since_loaded') is True):
            raise Refused('the database does not enforce exactly the stack client authentication rules')
        return {'rules': len(HBA_RULES), 'errors': 0, 'unchanged_since_loaded': True}

    def save_logs(self):
        logs = self.private / 'logs'
        if not logs.exists():
            private_dir(logs)
        values = self.secret_values()
        saved = []
        for service in ONE_SHOT + LONG_RUNNING:
            result = self.compose('logs', '--no-color', '--timestamps', service, timeout=60)
            if result.returncode:
                continue
            path = logs / ('%s-%s-redacted.log' % (stamp(), service))
            write_private(path, self.redact(result.stdout + '\n' + result.stderr, values))
            saved.append(path.name)
        return saved

    def export_root(self):
        """The root certificate of Caddy's local CA, copied out of the proxy's volume to proxy-root.crt (0600)."""
        target = self.root_cert
        target.unlink(missing_ok=True)
        end = time.monotonic() + 60
        while time.monotonic() < end:
            copied = self.compose('cp', 'aya-proxy:/data/caddy/pki/authorities/local/root.crt', str(target), timeout=60)
            if copied.returncode == 0 and target.is_file():
                os.chmod(target, 0o600)
                text = target.read_text()
                if text.startswith('-----BEGIN CERTIFICATE-----') and text.count('BEGIN CERTIFICATE') == 1:
                    return sha256_file(target)
                raise Refused('the exported proxy root is not one PEM certificate')
            time.sleep(2)
        raise Refused("the proxy's local CA root could not be exported")

    def front(self, name, path):
        """One GET through the front, trusting only the exported root: (status, headers, parsed JSON or None)."""
        context = ssl.create_default_context(cafile=str(self.root_cert))
        connection = FrontConnection(name, self.port, context)
        try:
            connection.request('GET', path, headers={'Accept': 'application/json'})
            response = connection.getresponse()
            body = response.read(1 << 20)
            try:
                document = json.loads(body) if body else None
            except ValueError:
                document = None
            return response.status, {k.lower(): v for k, v in response.getheaders()}, document
        finally:
            connection.close()

    def remove_owned(self):
        """docker compose down --volumes for this project only, then its API image after checking its label."""
        report = {}
        if self.env_file.is_file():
            down_result = self.compose('down', '--volumes', '--remove-orphans', '--timeout', '30', timeout=300)
            report['compose_down'] = 'ok' if down_result.returncode == 0 else 'failed'
        else:
            report['compose_down'] = 'ok' if not any(self.leftovers().values()) else 'failed: stack.env is gone'
        labelled = docker('image', 'inspect', '--format', '{{index .Config.Labels "aya.stack"}}', self.api_image)
        if labelled.returncode:
            report['api_image'] = 'absent'
        elif labelled.stdout.strip() != self.label:
            report['api_image'] = 'kept: not labelled for this stack'
        else:
            report['api_image'] = 'removed' if docker('image', 'rm', self.api_image).returncode == 0 else 'removal failed'
        report['leftovers'] = self.leftovers()
        return report

    def leftovers(self):
        found = {}
        for kind, args in (('containers', ('ps', '--all', '--quiet')), ('volumes', ('volume', 'ls', '--quiet')),
                           ('networks', ('network', 'ls', '--quiet'))):
            names = set()
            for label in ('com.docker.compose.project=' + self.project, 'aya.stack=' + self.label):
                listed = docker(*args, '--filter', 'label=' + label)
                names.update(line for line in listed.stdout.split() if line)
            found[kind] = len(names)
        return found


def write_evidence(stack, action, **facts):
    path = EVIDENCE / ('phase8-local-stack-%s-%s.json' % (stack.label, action))
    document = dict(label=stack.label, state=stack.manifest.get('state'), port=stack.port, at=now_iso(), **facts)
    text = json.dumps(document, indent=2) + '\n'
    if stack.secrets_dir.is_dir() and stack.leaks(text):
        raise Refused('an evidence summary would have carried a secret')
    path.write_text(text)
    return path


def emit(document):
    print(json.dumps(document, indent=2))


# --- commands ------------------------------------------------------------------------------------------------------


def initdb_modes(args):
    """Only the HBA initializer's mode, which prepare and up also set and check: no runtime directory, no Docker."""
    emit({'command': 'initdb-modes', 'result': 'pass', 'hba_initializer': hba_initializer_mode()})
    return 0


def prepare(args):
    jose = jose_util(args.jose_util)
    for key, reference in IMAGES.items():
        inspected = docker('image', 'inspect', '--format', '{{.Id}}', reference)
        if inspected.returncode or inspected.stdout.strip() != IMAGE_IDS[key]:
            raise SystemExit('a pinned image is not cached locally as recorded, and this helper never pulls: ' + key)
    if not Path(NODE).is_file():
        raise SystemExit('the pinned Node 22 binary was not found')
    if args.port is not None:
        if not (49152 <= args.port <= 65535) or args.port in RESERVED_PORTS or not port_free(args.port):
            raise SystemExit('refusing the port: it must be a free high port (49152-65535) on 127.0.0.1, not a reserved one')
        port = args.port
    else:
        port = free_port()
    initializer = hba_initializer_mode()
    stack = Stack.new(port)
    try:
        stack.generate(jose)
        stack.manifest.update(state='prepared', sources=source_hashes(), hba_initializer=initializer,
                              prepared_at=now_iso())
        stack.record()
    except BaseException as error:
        shutil.rmtree(stack.secrets_dir, ignore_errors=True)
        shutil.rmtree(stack.private / 'keys', ignore_errors=True)
        stack.env_file.unlink(missing_ok=True)
        stack.manifest.update(state='prepare failed; its secret files were removed',
                              failure=str(error) if isinstance(error, Refused) else type(error).__name__)
        stack.record()
        emit({'label': stack.label, 'state': stack.manifest['state'], 'failure': stack.manifest['failure']})
        return 1
    write_evidence(stack, 'prepare', images=IMAGES, sources=stack.manifest['sources'], hba_initializer=initializer,
                   secret_files=len(SECRET_FILES), prepared_users=USERS)
    emit({'label': stack.label, 'state': 'prepared', 'runtime_directory': str(stack.private), 'port': port,
          'front': ['https://%s:%d' % (API_HOST, port), 'https://%s:%d' % (AUTH_HOST, port)],
          'published_on': '127.0.0.1:%d only' % port, 'issuer': ISSUER, 'hba_initializer': initializer,
          'secrets': 'only in 0600 files under runtime_directory/secrets; never printed'})
    return 0


def up(args):
    stack = Stack.load(args.runtime_directory)
    if stack.manifest['state'] not in ('prepared', 'stopped'):
        raise SystemExit('refusing: the stack is %s, not prepared' % stack.manifest['state'])
    if not port_free(stack.port):
        raise SystemExit('refusing: 127.0.0.1:%d is no longer free' % stack.port)
    # A stopped stack holds data: a failed start never removes it.
    resumed = stack.manifest['state'] == 'stopped'
    facts = {'resumed_stopped_stack': resumed, 'hba_initializer': hba_initializer_mode()}
    try:
        stack.manifest.update(state='starting', sources_at_up=source_hashes())
        stack.record()
        built = stack.compose('build', 'aya-api', timeout=1800)
        logs = stack.private / 'logs'
        if not logs.exists():
            private_dir(logs)
        write_private(logs / ('%s-build.log' % stamp()), stack.redact(built.stdout + '\n' + built.stderr))
        require(built, 'build the API image')
        image = docker('image', 'inspect', '--format', '{{.Id}} {{index .Config.Labels "aya.stack"}} {{.Config.User}}',
                       stack.api_image)
        require(image, 'inspect the API image')
        image_id, image_label, image_user = (image.stdout.split() + ['', '', ''])[:3]
        if image_label != stack.label or image_user != '65532:65532':
            raise Refused('the built API image is not labelled for this stack or does not run as 65532')
        facts['api_image_id'] = image_id
        require(stack.compose('up', '--detach', '--no-build', timeout=600), 'start the stack')
        stack.wait_ready()
        facts['client_authentication'] = stack.enforced_hba()
        migrated = stack.compose('logs', '--no-color', '--no-log-prefix', 'aya-migrate', timeout=60)
        lines = [line.strip() for line in migrated.stdout.splitlines() if line.strip()]
        if not lines or lines[-1] != SCHEMA_VERSION:
            raise Refused('the migration job did not print schema version ' + SCHEMA_VERSION)
        facts['migration_job_printed'] = lines[-1]
        facts['proxy_root_sha256'] = stack.export_root()
        status, _, document = stack.front(API_HOST, '/v1/readyz')
        if status != 200 or document != {'status': 'ready'}:
            raise Refused('the API is not ready through the front')
        facts['readiness_through_front'] = status
        stack.manifest.update(state='up', up_at=now_iso(), **facts)
        stack.note('up', **facts)
    except BaseException as error:
        failure = str(error) if isinstance(error, Refused) else type(error).__name__
        saved = stack.save_logs()
        cleanup = None
        if args.keep_on_failure or resumed:
            # Kept for diagnosis, and a stopped stack's data is never removed here; `down` removes it.
            stack.manifest.update(state='up failed; kept for diagnosis', last_failure=failure, failed_at=now_iso())
        else:
            cleanup = stack.remove_owned()
            stack.root_cert.unlink(missing_ok=True)
            clean = cleanup['compose_down'] == 'ok' and not any(cleanup['leftovers'].values())
            # Its secrets stay, so `up` can be run again once the cause is fixed.
            stack.manifest.update(state='prepared' if clean else 'up failed; removal incomplete', last_failure=failure,
                                  failed_at=now_iso())
        stack.note('up failed', failure=failure, cleanup=cleanup)
        write_evidence(stack, 'up-failed', failure=failure, redacted_logs=saved, cleanup=cleanup)
        emit({'label': stack.label, 'state': stack.manifest['state'], 'failure': failure, 'redacted_logs': saved,
              'cleanup': cleanup})
        return 1
    write_evidence(stack, 'up', **facts)
    emit({'label': stack.label, 'state': 'up', 'port': stack.port, **facts,
          'front': ['https://%s:%d' % (API_HOST, stack.port), 'https://%s:%d' % (AUTH_HOST, stack.port)],
          'trust': 'the exported root %s, in a client process only' % stack.root_cert.name})
    return 0


def stop(args):
    """Stops this project's containers and keeps its volumes, so `up` starts the same data again."""
    stack = Stack.load(args.runtime_directory)
    if stack.manifest['state'] != 'up':
        raise SystemExit('refusing: the stack is %s, not up' % stack.manifest['state'])
    require(stack.compose('stop', '--timeout', '30', timeout=300), 'stop the stack')
    running = [entry for entries in stack.ps().values() for entry in entries if entry.get('State') == 'running']
    stack.manifest.update(state='stopped' if not running else 'stop incomplete', stopped_at=now_iso())
    stack.note('stop', running_after=len(running))
    write_evidence(stack, 'stop', running_after=len(running))
    emit({'label': stack.label, 'state': stack.manifest['state'], 'running_after': len(running),
          'kept': 'volumes, secrets and backups; `up` starts the same data again, `down` removes it'})
    return 0 if not running else 1


def status(args):
    stack = Stack.load(args.runtime_directory)
    report = {'label': stack.label, 'state': stack.manifest['state'], 'port': stack.port, 'containers': {}}
    for service, entries in sorted(stack.ps().items()):
        report['containers'][service] = [{'state': entry.get('State'), 'health': entry.get('Health') or None,
                                          'exit_code': entry.get('ExitCode')} for entry in entries]
    if stack.root_cert.is_file():
        try:
            code, _, document = stack.front(API_HOST, '/v1/readyz')
            report['readiness_through_front'] = {'status': code, 'body': document}
        except (OSError, ssl.SSLError):
            report['readiness_through_front'] = 'no answer'
    emit(report)
    return 0


def inspect_containers(stack, values, checks):
    """Users, read-only roots, capabilities, privilege, networks, mounts, published ports, images and labels."""
    containers = {}
    for service, entries in stack.ps().items():
        if service in EXPECTED:
            containers[service] = [entry['ID'] for entry in entries]
    for service, (image_key, user, cap_add, networks, volumes) in EXPECTED.items():
        ids = containers.get(service, [])
        checks.append(('container.%s.exists' % service, len(ids) == 1))
        if len(ids) != 1:
            continue
        inspected = require(docker('inspect', ids[0]), 'inspect ' + service)
        checks.append(('container.%s.inspect_holds_no_secret' % service, stack.leaks(inspected.stdout, values) == 0))
        info = json.loads(inspected.stdout)[0]
        config, host = info['Config'], info['HostConfig']
        normalize = lambda caps: {cap.upper().removeprefix('CAP_') for cap in (caps or [])}
        attached = set(info['NetworkSettings']['Networks'])
        expected_networks = {stack.project + '_' + name for name in networks} if networks else {'none'}
        # The content-addressed image ID: the pinned image Root recorded, or the API image this stack built.
        image_ok = (info['Image'] == stack.manifest.get('api_image_id') and config['Image'] == stack.api_image
                    if image_key == 'api' else info['Image'] == IMAGE_IDS[image_key])
        named = {mount['Name'][len(stack.project) + 1:]: mount['RW'] for mount in info.get('Mounts', [])
                 if mount.get('Type') == 'volume' and mount.get('Name', '').startswith(stack.project + '_')}
        binds = [mount for mount in info.get('Mounts', []) if mount.get('Type') == 'bind']
        secret_binds = [mount for mount in binds if mount.get('Source', '').rstrip('/').endswith(str(stack.secrets_dir))]
        ports = host.get('PortBindings') or {}
        expected_ports = ({'%d/tcp' % stack.port: [{'HostIp': '127.0.0.1', 'HostPort': str(stack.port)}]}
                          if service == 'aya-proxy' else {})
        checks.extend([
            ('container.%s.user_%s' % (service, user.replace(':', '_')), config.get('User') == user),
            ('container.%s.read_only_root' % service, host.get('ReadonlyRootfs') is True),
            ('container.%s.drops_every_capability' % service, normalize(host.get('CapDrop')) == {'ALL'}),
            ('container.%s.adds_back_only_%s' % (service, '_'.join(sorted(cap_add)) or 'nothing'),
             normalize(host.get('CapAdd')) == cap_add),
            ('container.%s.no_new_privileges' % service,
             any(opt in ('no-new-privileges', 'no-new-privileges:true') for opt in host.get('SecurityOpt') or [])),
            ('container.%s.not_privileged' % service, host.get('Privileged') is False),
            ('container.%s.networks_exactly_%s' % (service, '_'.join(sorted(networks)) or 'none'),
             attached == expected_networks),
            ('container.%s.pinned_or_built_image' % service, image_ok),
            ('container.%s.labelled_for_the_stack' % service, (config.get('Labels') or {}).get('aya.stack') == stack.label),
            ('container.%s.volumes_exactly_its_own' % service, named == volumes),
            ('container.%s.secret_source_mounted_only_by_secrets_init' % service,
             (len(secret_binds) == 1 and secret_binds[0].get('RW') is False) if service == 'aya-secrets-init'
             else not secret_binds),
            ('container.%s.published_ports' % service, ports == expected_ports),
        ])


def verify(args):
    stack = Stack.load(args.runtime_directory)
    if stack.manifest['state'] != 'up':
        raise SystemExit('refusing: the stack is %s, not up' % stack.manifest['state'])
    run = 'verify-' + stamp()
    directory = private_dir(stack.private / run)
    values = stack.secret_values()
    checks = []
    facts = {}
    created = []
    sdk = None
    try:
        checks.append(('stack.ready', stack.readiness() == 'ready'))

        # Host side: the runtime directory and every secret file private to this user.
        mode_ok = True
        for path in [stack.private, stack.secrets_dir] + sorted(stack.secrets_dir.rglob('*')):
            info = path.lstat()
            wanted = 0o700 if path.is_dir() else 0o600
            mode_ok &= info.st_uid == os.getuid() and (info.st_mode & 0o777) == wanted and not path.is_symlink()
        checks.append(('host.runtime_and_secret_files_private_to_this_user', mode_ok))
        checks.append(('host.every_expected_secret_file_present',
                       all((stack.secrets_dir / relative).is_file() for relative in SECRET_FILES)))

        # Containers, networks and volumes.
        inspect_containers(stack, values, checks)
        for name, internal in NETWORKS.items():
            inspected = docker('network', 'inspect', '--format', '{{.Internal}} {{index .Labels "aya.stack"}}',
                               stack.project + '_' + name)
            checks.append(('network.%s.%s' % (name, 'internal' if internal else 'bridge_for_the_loopback_publish'),
                           inspected.returncode == 0 and inspected.stdout.split() == [str(internal).lower(), stack.label]))
        listed = docker('volume', 'ls', '--quiet', '--filter', 'label=aya.stack=' + stack.label)
        checks.append(('volumes.exactly_the_stack_volumes',
                       set(listed.stdout.split()) == {stack.project + '_' + name for name in VOLUMES}))
        config = stack.compose('config', timeout=60)
        checks.append(('compose.config_holds_no_secret', config.returncode == 0 and stack.leaks(config.stdout, values) == 0))
        history = docker('history', '--no-trunc', '--format', '{{.CreatedBy}}', stack.api_image)
        image = docker('image', 'inspect', stack.api_image)
        checks.append(('image.api_layers_and_config_hold_no_secret', history.returncode == 0 and image.returncode == 0 and
                       stack.leaks(history.stdout + image.stdout, values) == 0))

        # Inside the volumes: each file the service's own, mode 0400; each volume root 0700.
        inspected = stack.compose('run', '--rm', '--no-deps', '-T', 'aya-inspect', timeout=120)
        require(inspected, 'list the secret volumes')
        seen = {}
        for line in inspected.stdout.splitlines():
            relative, uid, gid, mode, kind, _ = line.split('|')
            seen[relative] = (int(uid), int(gid), mode, kind)
        expected = {}
        for volume, owner in VOLUME_OWNERS.items():
            expected[volume] = (owner, owner, '700', 'd')
        expected['ops/users'] = (65532, 65532, '700', 'd')
        for relative in SECRET_FILES:
            owner = VOLUME_OWNERS[relative.split('/', 1)[0]]
            expected[relative] = (owner, owner, '400', 'f')
        checks.append(('volumes.secret_files_exactly_owned_by_their_service_0400',
                       {key: value for key, value in seen.items()} == expected))

        # PostgreSQL: roles, grants, client authentication, connections and probes, as the superuser on the socket.
        def db_checks():
            ran = stack.compose('exec', '-T', 'aya-db', 'psql', '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1',
                                '-U', 'postgres', '-d', 'postgres', '-f', '-', input=DB_CHECKS.read_text(), timeout=120)
            require(ran, 'run the database checks')
            if stack.leaks(ran.stdout + ran.stderr, values):
                raise Refused('the database checks printed a secret')
            found = {}
            for line in ran.stdout.splitlines():
                if '|' in line:
                    name, value = line.split('|', 1)
                    found[name] = value
            return found

        db = db_checks()
        evaluate_database(db, checks, facts)

        # The migration job again: exit 0, the version only, and the record unchanged.
        again = stack.compose('run', '--rm', '--no-deps', '-T', 'aya-migrate', timeout=300)
        checks.append(('migration.rerun_exit_0_prints_only_the_version',
                       again.returncode == 0 and again.stdout.strip() == SCHEMA_VERSION))
        checks.append(('migration.rerun_changed_nothing',
                       db_checks().get('app.migrations_digest') == db.get('app.migrations_digest')))

        # Auth's own settings, from the internal network: sign-up off, email password on, everything else off.
        settings = stack.compose('run', '--rm', '--no-deps', '-T', 'aya-users', 'settings', timeout=120)
        lines = settings.stdout.splitlines()
        document = json.loads(lines[1]) if len(lines) >= 2 and lines[0] == 'settings 200' else {}
        external = document.get('external') or {}
        checks.extend([
            ('auth.settings_answered', bool(document)),
            ('auth.sign_up_disabled', document.get('disable_signup') is True),
            ('auth.no_mail_autoconfirm', document.get('mailer_autoconfirm') is False),
            ('auth.only_email_password_enabled',
             external.get('email') is True and not any(on for provider, on in external.items() if provider != 'email')),
        ])
        facts['auth_external_providers_checked'] = len(external)

        # The prepared users, through Auth's internal admin API only.
        made = stack.compose('run', '--rm', '--no-deps', '-T', 'aya-users', 'create', timeout=120)
        for line in made.stdout.splitlines():
            parts = line.split()
            if len(parts) == 4 and parts[0] == 'create' and parts[2] == '200' and len(parts[3]) == 36:
                created.append(parts[3])
        checks.append(('users.prepared_users_created', len(created) == USERS))
        stack.note('users created', count=len(created), ids=created)

        # The real SDK and API checks through the front.
        if len(created) == USERS:
            sdk_report = directory / 'sdk-report.json'
            node = subprocess.run([NODE, str(VERIFY_SCRIPT), str(stack.private), str(sdk_report)],
                                  env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}, capture_output=True, text=True,
                                  timeout=600)
            sdk = json.loads(sdk_report.read_text()) if sdk_report.is_file() else None
            checks.append(('sdk.verify_stack_passed', node.returncode == 0 and sdk is not None and sdk.get('result') == 'pass'))
            checks.append(('sdk.output_holds_no_secret', stack.leaks(node.stdout + node.stderr, values) == 0))
            if sdk is not None:
                facts['sdk_checks'] = '%s/%s' % (sdk.get('checksPassed'), sdk.get('checksTotal'))
                facts['sdk_failure'] = sdk.get('failure')

        after = db_checks()
        checks.append(('database.connections_after_the_run_only_service_roles',
                       all(name in ('connections.aya_runtime@aya_app', 'connections.aya_auth_owner@aya_auth')
                           for name in after if name.startswith('connections.'))))
        facts['app_account_deletions_after_run'] = after.get('app.account_deletions')
        facts['auth_users_after_run'] = after.get('auth.users')
    except BaseException as error:
        checks.append(('verify.completed', False))
        facts['failure'] = str(error) if isinstance(error, Refused) else type(error).__name__
    finally:
        # Any prepared user the run did not delete through the API, by its exact ID: 404 means already gone.
        if created:
            removed = stack.compose('run', '--rm', '--no-deps', '-T', 'aya-users', 'delete', *created, timeout=120)
            outcomes = [line.split()[-1] for line in removed.stdout.splitlines() if line.startswith('delete ')]
            facts['fallback_user_deletions'] = {'already_absent_404': outcomes.count('404'),
                                                'deleted_now_200': outcomes.count('200'),
                                                'other': len(outcomes) - outcomes.count('404') - outcomes.count('200')}
            checks.append(('users.none_left_behind', len(outcomes) == len(created) and
                           all(outcome in ('200', '404') for outcome in outcomes)))
            stack.note('users cleaned up', outcomes=facts['fallback_user_deletions'])
    passed = all(ok for _, ok in checks)
    summary = {'run': run, 'result': 'pass' if passed else 'fail',
               'checks_passed': sum(1 for _, ok in checks if ok), 'checks_total': len(checks),
               'failed_checks': [name for name, ok in checks if not ok], 'checks': [{'name': n, 'pass': ok} for n, ok in checks],
               'facts': facts, 'sdk_report': (str(directory / 'sdk-report.json') if sdk is not None else None)}
    write_private(directory / 'stack-report.json', json.dumps(summary, indent=2) + '\n')
    stack.note('verify', result=summary['result'], checks='%d/%d' % (summary['checks_passed'], summary['checks_total']))
    write_evidence(stack, run, result=summary['result'], checks_passed=summary['checks_passed'],
                   checks_total=summary['checks_total'], failed_checks=summary['failed_checks'], facts=facts,
                   sdk_checks=([{'name': c['name'], 'pass': c['pass']} for c in sdk['checks']] if sdk else None),
                   sdk_statuses=(sdk.get('statuses') if sdk else None), sdk_counts=(sdk.get('counts') if sdk else None))
    emit({key: summary[key] for key in ('run', 'result', 'checks_passed', 'checks_total', 'failed_checks', 'facts')})
    return 0 if passed else 1


def evaluate_database(db, checks, facts):
    """The expected roles, grants, ownership, client authentication, connections and probe outcomes."""
    def doc(name):
        try:
            return json.loads(db[name])
        except (KeyError, ValueError):
            return None

    service_roles = ('aya_owner', 'aya_runtime', 'aya_backup', 'aya_auth_owner')
    for role in service_roles:
        attributes = doc('role.' + role) or {}
        checks.append(('database.role.%s_login_scram_unprivileged' % role,
                       attributes.get('login') is True and attributes.get('scram_password') is True and
                       not any(attributes.get(key) for key in ('superuser', 'createdb', 'createrole', 'replication',
                                                               'inherit')) and
                       attributes.get('bypassrls') is (role == 'aya_backup')))
    checks.append(('database.only_the_bootstrap_superuser', db.get('roles.superusers') == '1' and
                   (doc('role.postgres') or {}).get('superuser') is True))
    checks.append(('database.no_role_memberships', db.get('roles.aya_memberships') == '0'))
    checks.append(('database.aya_app_owned_by_bootstrap_closed_to_public',
                   doc('database.aya_app') == {'owner': 'postgres', 'public_connect': False, 'public_temp': False}))
    checks.append(('database.aya_auth_owned_by_auth_owner_closed_to_public',
                   doc('database.aya_auth') == {'owner': 'aya_auth_owner', 'public_connect': False, 'public_temp': False}))
    grants = {
        ('aya_app', 'aya_owner'): {'connect': True, 'create': True, 'temp': False},
        ('aya_app', 'aya_runtime'): {'connect': True, 'create': False, 'temp': False},
        ('aya_app', 'aya_backup'): {'connect': True, 'create': False, 'temp': False},
        ('aya_app', 'aya_auth_owner'): {'connect': False, 'create': False, 'temp': False},
        ('aya_auth', 'aya_owner'): {'connect': False, 'create': False, 'temp': False},
        ('aya_auth', 'aya_runtime'): {'connect': False, 'create': False, 'temp': False},
        ('aya_auth', 'aya_backup'): {'connect': True, 'create': False, 'temp': False},
        ('aya_auth', 'aya_auth_owner'): {'connect': True, 'create': True, 'temp': True},
    }
    for (database, role), wanted in grants.items():
        checks.append(('database.grant.%s.%s' % (database, role), doc('grant.database.%s.%s' % (database, role)) == wanted))
    checks.append(('database.client_authentication_exactly_the_stack_rules', doc('hba.rules') == HBA_RULES and
                   db.get('hba.errors') == '0'))
    checks.append(('database.scram_password_encryption', db.get('setting.password_encryption') == 'scram-sha-256'))
    connections = {name: int(value) for name, value in db.items() if name.startswith('connections.')}
    checks.append(('database.connections_only_service_roles_to_their_databases',
                   set(connections) <= {'connections.aya_runtime@aya_app', 'connections.aya_auth_owner@aya_auth'} and
                   connections.get('connections.aya_runtime@aya_app', 0) >= 1))
    facts['connections'] = connections
    checks.append(('database.app_schema_owned_by_aya_owner', doc('app.schema') == {'owner': 'aya_owner'}))
    tables = doc('app.tables') or {}
    checks.append(('database.app_tables_all_owned_by_aya_owner', tables.get('count') == 7 and tables.get('owners') == ['aya_owner']))
    checks.append(('database.app_migrations_exactly_1_to_3', doc('app.migrations') == [1, 2, 3]))
    schema = {'aya_owner': {'usage': True, 'create': True}, 'aya_runtime': {'usage': True, 'create': False},
              'aya_backup': {'usage': True, 'create': False}, 'aya_auth_owner': {'usage': False, 'create': False}}
    for role, wanted in schema.items():
        checks.append(('database.app_schema_grant.%s' % role, doc('grant.schema.ayailmu.' + role) == wanted))
        checks.append(('database.app_public_schema_closed.%s' % role,
                       doc('grant.schema.app_public.' + role) == {'usage': False, 'create': False}))
    runtime = doc('grant.tables.ayailmu.aya_runtime') or {}
    backup = doc('grant.tables.ayailmu.aya_backup') or {}
    auth_owner = doc('grant.tables.ayailmu.aya_auth_owner') or {}
    count = runtime.get('tables')
    checks.append(('database.runtime_dml_on_every_app_table_nothing_more',
                   count == 7 and all(runtime.get(p) == 7 for p in ('select', 'insert', 'update', 'delete')) and
                   all(runtime.get(p) == 0 for p in ('truncate', 'references', 'trigger'))))
    checks.append(('database.backup_reads_every_app_table_nothing_more',
                   backup.get('tables') == 7 and backup.get('select') == 7 and
                   all(backup.get(p) == 0 for p in ('insert', 'update', 'delete', 'truncate', 'references', 'trigger'))))
    checks.append(('database.auth_owner_nothing_on_app_tables',
                   all(auth_owner.get(p) == 0 for p in ('select', 'insert', 'update', 'delete', 'truncate'))))
    probes = {
        'probe.runtime.create_table_in_app_schema': '42501', 'probe.runtime.create_table_in_public': '42501',
        'probe.runtime.create_schema': '42501', 'probe.runtime.create_temp_table': '42501',
        'probe.runtime.alter_table': '42501', 'probe.runtime.create_index': '42501', 'probe.runtime.drop_table': '42501',
        'probe.runtime.truncate': '42501', 'probe.runtime.select': '00000', 'probe.runtime.insert_rolled_back': '00000',
        'probe.backup.select_app': '00000', 'probe.backup.insert_app': '42501', 'probe.backup.update_app': '42501',
        'probe.backup.delete_app': '42501', 'probe.backup.truncate_app': '42501', 'probe.backup.create_table_app': '42501',
        'probe.auth_owner.select_app': '42501', 'probe.backup.select_auth': '00000', 'probe.backup.delete_auth': '42501',
        'probe.backup.create_table_auth': '42501', 'probe.runtime.select_auth': '42501',
    }
    for name, wanted in probes.items():
        checks.append(('database.' + name + '_' + wanted, db.get(name) == wanted))
    checks.append(('database.auth_schema_owned_by_auth_owner', doc('auth.schema') == {'owner': 'aya_auth_owner'}))
    auth_tables = doc('auth.tables') or {}
    checks.append(('database.auth_tables_all_owned_by_auth_owner',
                   (auth_tables.get('count') or 0) > 0 and auth_tables.get('owners') == ['aya_auth_owner']))
    checks.append(('database.auth_owner_search_path_auth', db.get('auth.owner_search_path') == 'search_path=auth'))
    auth_backup = doc('grant.tables.auth.aya_backup') or {}
    checks.append(('database.backup_reads_every_auth_table_nothing_more',
                   (auth_backup.get('tables') or 0) > 0 and auth_backup.get('select') == auth_backup.get('tables') and
                   all(auth_backup.get(p) == 0 for p in ('insert', 'update', 'delete', 'truncate'))))
    for role in ('aya_owner', 'aya_runtime'):
        grants_on_auth = doc('grant.tables.auth.' + role) or {}
        checks.append(('database.%s_nothing_on_auth_tables' % role,
                       all(grants_on_auth.get(p) == 0 for p in ('select', 'insert', 'update', 'delete', 'truncate'))))
    checks.append(('database.checks_completed', db.get('checks.complete') == 'yes'))
    facts['auth_tables'] = auth_tables.get('count')
    facts['auth_rls_tables'] = db.get('auth.rls_tables')
    facts['app_accounts'] = db.get('app.accounts')


def backup(args):
    stack = Stack.load(args.runtime_directory)
    if stack.manifest['state'] != 'up':
        raise SystemExit('refusing: the stack is %s, not up' % stack.manifest['state'])
    backups = stack.private / 'backups'
    if not backups.exists():
        private_dir(backups)
    run = stamp()
    directory = private_dir(backups / run)
    values = stack.secret_values()
    results = {}
    failure = None
    try:
        for database in ('aya_app', 'aya_auth'):
            path = directory / (database + '.dump')
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as out:
                dumped = subprocess.run(stack.compose_args('run', '--rm', '--no-deps', '-T', 'aya-backup', 'pg_dump',
                                                           '--format=custom', '--no-password', '--dbname=' + database),
                                        env=DOCKER_ENV, stdout=out, stderr=subprocess.PIPE, timeout=900)
            if dumped.returncode or path.stat().st_size == 0:
                write_private(directory / (database + '-dump-redacted.log'),
                              stack.redact(dumped.stderr.decode(errors='replace'), values))
                raise Refused('pg_dump of %s as aya_backup failed' % database)
            with open(path, 'rb') as dump:
                listed = subprocess.run(stack.compose_args('run', '--rm', '--no-deps', '-T', 'aya-backup', 'pg_restore',
                                                           '--list'), env=DOCKER_ENV, stdin=dump, capture_output=True,
                                        timeout=300)
            if listed.returncode:
                raise Refused('pg_restore --list could not read the %s dump' % database)
            entries = [line for line in listed.stdout.decode(errors='replace').splitlines()
                       if line.strip() and not line.startswith(';')]
            table_data = sorted({' '.join(line.split()[-3:-1]) for line in entries if ' TABLE DATA ' in line})
            results[database] = {'file': str(path.relative_to(stack.private)), 'bytes': path.stat().st_size,
                                 'sha256': sha256_file(path), 'toc_entries': len(entries),
                                 'tables_with_data': len(table_data), 'tables': table_data}
    except BaseException as error:
        failure = str(error) if isinstance(error, Refused) else type(error).__name__
    stack.note('backup', run=run, result='fail' if failure else 'pass', failure=failure)
    honest = ('pg_dump custom-format files as the read-only aya_backup role, owner-only (0600) in a 0700 directory, kept '
              'out of git and of every build context. Restore is NOT verified: the deletion-safe restore drill (ledger '
              'export and replay before readiness, re-erasure of resurrected data, provider reconciliation) is the next '
              'slice.')
    write_evidence(stack, 'backup-' + run, result='fail' if failure else 'pass', failure=failure, dumps=results,
                   restore_verified=False, note=honest)
    emit({'label': stack.label, 'run': run, 'result': 'fail' if failure else 'pass', 'failure': failure,
          'directory': str(directory), 'dumps': results, 'restore_verified': False})
    return 1 if failure else 0


def down(args):
    stack = Stack.load(args.runtime_directory)
    report = stack.remove_owned()
    clean = report['compose_down'] == 'ok' and report['api_image'] in ('removed', 'absent') and \
        not any(report['leftovers'].values())
    removed_files = []
    if clean:
        for path in (stack.secrets_dir, stack.private / 'keys'):
            if path.exists():
                shutil.rmtree(path)
                removed_files.append(path.name + '/')
        for path in (stack.env_file, stack.root_cert):
            if path.exists():
                path.unlink()
                removed_files.append(path.name)
        if args.purge_backups and (stack.private / 'backups').exists():
            shutil.rmtree(stack.private / 'backups')
            removed_files.append('backups/')
    stack.manifest.update(state='removed' if clean else 'removal incomplete', removed_at=now_iso())
    stack.note('down', clean=clean, removed_files=removed_files)
    evidence = write_evidence(stack, 'down', cleanup=report, removed_files=removed_files,
                              backups_kept=(stack.private / 'backups').exists())
    emit({'label': stack.label, 'state': stack.manifest['state'], 'cleanup': report, 'removed_files': removed_files,
          'backups_kept': (stack.private / 'backups').exists(), 'evidence': str(evidence),
          'runtime_directory': str(stack.private)})
    return 0 if clean else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest='command', required=True)
    start = commands.add_parser('prepare')
    start.add_argument('--port', type=int)
    start.add_argument('--jose-util', default=str(JOSE_UTIL))
    for name in ('up', 'status', 'verify', 'backup', 'stop', 'down'):
        command = commands.add_parser(name)
        command.add_argument('runtime_directory')
        if name == 'up':
            command.add_argument('--keep-on-failure', action='store_true')
        if name == 'down':
            command.add_argument('--purge-backups', action='store_true')
    commands.add_parser('initdb-modes')
    args = parser.parse_args()
    handlers = {'prepare': prepare, 'up': up, 'status': status, 'verify': verify, 'backup': backup, 'stop': stop,
                'down': down, 'initdb-modes': initdb_modes}
    try:
        return handlers[args.command](args)
    except Refused as error:
        emit({'command': args.command, 'result': 'refused', 'reason': str(error)})
        return 1


if __name__ == '__main__':
    sys.exit(main())
