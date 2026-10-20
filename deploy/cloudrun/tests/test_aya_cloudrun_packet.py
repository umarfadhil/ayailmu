"""RED tests of the local Cloud Run preflight and packet tool, deploy/cloudrun/aya_cloudrun_packet.py.

    python3 -I -B -m unittest discover -s deploy/cloudrun/tests -p 'test_*.py' -v

The tool runs as its own process, as a reviewer runs it, with nothing in its environment but PATH. These tests pin its
externally visible contract (docs/superpowers/plans/2026-10-20-cloud-run-gotrue-prep.md, sections B to E): commands,
exit statuses, the one JSON document on standard output, the packet file, and what it refuses. They never import the
tool. Every host is a documentation name (RFC 2606) and every secret a reference name; nothing here is a credential.
"""
import ast
import copy
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = REPO / 'deploy' / 'cloudrun' / 'aya_cloudrun_packet.py'
EXAMPLE = REPO / 'deploy' / 'cloudrun' / 'example-input.json'
COMPOSE = REPO / 'deploy' / 'compose.yaml'
PLAN = 'docs/superpowers/plans/2026-10-20-cloud-run-gotrue-prep.md'

INPUT_FORMAT = 'ayailmu-cloudrun-input/1'
RESULT_FORMAT = 'ayailmu-cloudrun-result/1'
TOPOLOGY = 'api-and-gotrue-on-cloud-run-with-supabase-postgres'
MAX_INPUT_BYTES = 65536

# Every gate of plan section E: each result lists all of them, every time, as outstanding.
REQUIRED_GATES = frozenset({
    'api-cloud-run-proxy-admission',
    'api-secret-file-mounts',
    'api-database-tls-and-session-settings',
    'api-production-deployment-profile',
    'api-amd64-provenance-build',
    'gotrue-image-platform',
    'hosted-database-permissions-and-migrations',
    'gotrue-postgres-grant-and-rls',
    'gotrue-namespace-runtime',
    'gotrue-keys-and-admin-credential',
    'smtp-delivery',
    'client-account-flows',
    'oauth-only-reauth',
    'native-builds-and-callbacks',
    'reviewed-content',
    'operations',
    'cost-and-resource-approval',
})

# The required secret slots in the plan's order (section B.5); the Google slot follows them when Google is on.
SECRET_SLOTS = (
    'api_database_url',
    'api_auth_admin_credential',
    'migration_database_url',
    'auth_database_url',
    'auth_jwt_keys',
    'auth_jwt_secret',
    'auth_smtp_password',
    'database_root_ca',
)
GOOGLE_SLOT = 'auth_google_client_secret'

# Stands in for a credential pasted by mistake: it must never come back on any output.
CANARY = 'CANARY-SECRET-VALUE-7F3A9C'

READINESS_CLAIMS = ('deployment_ready', 'applies_changes', 'creates_resources', 'hosted_compatibility_verified',
                    'zero_cost_guaranteed')


def reference(slot, version='1'):
    """A secret reference: a Secret Manager secret name and a pinned version, never the value."""
    return {'secret': 'aya-' + slot.replace('_', '-'), 'version': version}


def example_input():
    """A complete, valid input. Its names are documentation names, so it says it is an example."""
    return {
        'format': INPUT_FORMAT,
        'example': True,
        'api': {'origin': 'https://api.example.com', 'max_instances': 2, 'db_pool_max_conns': 3},
        'auth': {'origin': 'https://auth.example.com', 'max_instances': 2, 'db_pool_max_size': 2},
        'database': {
            'host': 'db.example.com',
            'port': 5432,
            'connection_mode': 'session',
            'tls_mode': 'verify-full',
            'connection_limit': 60,
            'migration_connections': 1,
            'backup_connections': 1,
            'headroom_connections': 5,
        },
        'secret_references': {slot: reference(slot) for slot in SECRET_SLOTS},
    }


# The budget of example_input(): 2 x 3 (API) + 2 x 2 (Auth) + 1 (migration) + 1 (backup) + 5 (headroom).
EXAMPLE_BUDGET = {'api': 6, 'auth': 4, 'migration': 1, 'backup': 1, 'headroom': 5, 'total': 17, 'limit': 60}


def with_value(doc, path, value):
    """A copy of doc with the member at the dotted path set, its parents created when absent."""
    doc = copy.deepcopy(doc)
    *parents, last = path.split('.')
    node = doc
    for name in parents:
        node = node.setdefault(name, {})
    node[last] = value
    return doc


def without(doc, path):
    """A copy of doc without the member at the dotted path."""
    doc = copy.deepcopy(doc)
    *parents, last = path.split('.')
    node = doc
    for name in parents:
        node = node[name]
    del node[last]
    return doc


class ToolCase(unittest.TestCase):
    """Runs the tool as a reviewer would. While the tool does not exist, every test fails here, never passes."""

    def setUp(self):
        if not TOOL.is_file():
            self.fail(f'deploy/cloudrun/aya_cloudrun_packet.py does not exist yet: the GREEN slice adds it ({PLAN}, '
                      'section F)')
        self.tmp = Path(tempfile.mkdtemp(prefix='aya-cloudrun-test-'))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_tool(self, *args, stdin=b''):
        return subprocess.run([sys.executable, '-I', '-B', str(TOOL), *(str(a) for a in args)], input=stdin,
                              capture_output=True, cwd=self.tmp, env={'PATH': os.defpath}, timeout=60)

    def write(self, doc, name='input.json'):
        """Writes doc, a JSON value or exact bytes, to a file of this test's own directory."""
        path = self.tmp / name
        path.write_bytes(doc if isinstance(doc, bytes) else json.dumps(doc).encode('utf-8'))
        return path

    def result(self, proc):
        """The one JSON document on standard output: printable ASCII only, ending in a newline."""
        out = proc.stdout
        self.assertTrue(out.endswith(b'\n'), f'standard output does not end in a newline: {out[-120:]!r}')
        unprintable = sorted({b for b in out if b != 0x0A and not 0x20 <= b <= 0x7E})
        self.assertEqual(unprintable, [], 'standard output holds bytes that are not printable ASCII')
        doc = json.loads(out.decode('ascii'))
        self.assertIsInstance(doc, dict)
        self.assertEqual(doc.get('format'), RESULT_FORMAT)
        return doc

    def check(self, doc):
        proc = self.run_tool('check', self.write(doc))
        return proc, self.result(proc)

    def findings(self, result):
        return [(f['code'], f['field']) for f in result['configuration']['findings']]

    def assertValid(self, proc, result):
        detail = self.findings(result) if result.get('configuration') else result
        self.assertEqual(proc.returncode, 0, detail)
        self.assertIs(result['configuration']['valid'], True)
        self.assertEqual(result['configuration']['findings'], [])
        self.assertIsNone(result['error'])
        self.assertIsInstance(result['packet'], dict)

    def assertInvalid(self, proc, result, code, field):
        detail = self.findings(result) if result.get('configuration') else result
        self.assertEqual(proc.returncode, 1, detail)
        self.assertIs(result['configuration']['valid'], False)
        self.assertIsNone(result['packet'])
        self.assertIn((code, field), detail, detail)

    def assertNotEvaluated(self, proc, result, code):
        self.assertEqual(proc.returncode, 2, result)
        self.assertEqual(result['error']['code'], code, result)
        self.assertIsNone(result['configuration'])
        self.assertIsNone(result['packet'])

    def assertRefused(self, doc, code, field):
        proc, result = self.check(doc)
        self.assertInvalid(proc, result, code, field)

    def entries(self):
        return sorted(p.name for p in self.tmp.iterdir())


class ResultContractTests(ToolCase):
    """Configuration validity is reported apart from readiness, which is never claimed."""

    def test_valid_example_is_valid_but_never_deployment_ready(self):
        proc, result = self.check(example_input())
        self.assertValid(proc, result)
        self.assertEqual(result['command'], 'check')
        self.assertIs(result['configuration']['example'], True)
        self.assertIs(result['deployment_ready'], False)
        self.assertIs(result['packet']['non_executable'], True)
        self.assertIs(result['packet']['example'], True)

    def test_every_outcome_keeps_readiness_claims_false_and_lists_every_gate(self):
        outcomes = {
            'valid': ('check', self.write(example_input(), 'valid.json')),
            'invalid': ('check', self.write(with_value(example_input(), 'database.connection_mode', 'transaction'),
                                            'invalid.json')),
            'unparsable': ('check', self.write(b'{', 'unparsable.json')),
            'usage': (),
        }
        for name, args in outcomes.items():
            with self.subTest(outcome=name):
                result = self.result(self.run_tool(*args))
                for claim in READINESS_CLAIMS:
                    self.assertIs(result[claim], False, claim)
                ids = {gate['id'] for gate in result['gates']}
                self.assertTrue(REQUIRED_GATES <= ids, sorted(REQUIRED_GATES - ids))
                for gate in result['gates']:
                    self.assertEqual(gate['status'], 'outstanding', gate['id'])
                    self.assertIsInstance(gate['summary'], str)
                    self.assertTrue(gate['summary'].strip(), gate['id'])
                    self.assertIsInstance(gate['sources'], list)
                    self.assertTrue(all(isinstance(s, str) for s in gate['sources']), gate['id'])

    def test_output_is_deterministic_and_names_the_exact_input(self):
        path = self.write(example_input())
        first, second = self.run_tool('check', path), self.run_tool('check', path)
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual(self.result(first)['input_sha256'], hashlib.sha256(path.read_bytes()).hexdigest())

    def test_packet_fixes_the_two_service_topology_and_its_defaults(self):
        proc, result = self.check(example_input())
        self.assertValid(proc, result)
        packet = result['packet']
        self.assertEqual(packet['topology'], TOPOLOGY)
        self.assertEqual(set(packet['services']), {'api', 'auth'})
        api, auth, database = packet['services']['api'], packet['services']['auth'], packet['database']
        self.assertEqual((api['origin'], api['min_instances'], api['max_instances'], api['db_pool_max_conns']),
                         ('https://api.example.com', 0, 2, 3))
        self.assertIsNone(api['image'], 'no current linux/amd64 API image exists, so none may be named')
        self.assertEqual((auth['origin'], auth['issuer'], auth['audience']),
                         ('https://auth.example.com', 'https://auth.example.com', 'authenticated'))
        self.assertEqual((auth['min_instances'], auth['max_instances'], auth['db_pool_max_size']), (0, 2, 2))
        self.assertIs(auth['google_enabled'], False)
        self.assertIsNone(auth['google_callback'])
        self.assertEqual((database['host'], database['port'], database['connection_mode'], database['tls_mode']),
                         ('db.example.com', 5432, 'session', 'verify-full'))
        self.assertEqual(database['schemas'], {'app': 'ayailmu', 'auth': 'aya_auth'})
        self.assertEqual(database['roles'], {'app_owner': 'aya_owner', 'app_runtime': 'aya_runtime',
                                             'auth_owner': 'aya_auth_owner', 'backup': 'aya_backup'})
        self.assertEqual(packet['secret_references'], {slot: reference(slot) for slot in SECRET_SLOTS})

    def test_partial_schema_and_role_names_keep_the_other_defaults(self):
        doc = with_value(example_input(), 'schemas', {'auth': 'aya_gotrue'})
        doc = with_value(doc, 'roles', {'backup': 'aya_dump'})
        proc, result = self.check(doc)
        self.assertValid(proc, result)
        database = result['packet']['database']
        self.assertEqual(database['schemas'], {'app': 'ayailmu', 'auth': 'aya_gotrue'})
        self.assertEqual(database['roles'], {'app_owner': 'aya_owner', 'app_runtime': 'aya_runtime',
                                             'auth_owner': 'aya_auth_owner', 'backup': 'aya_dump'})

    def test_gotrue_image_is_the_reference_pinned_in_compose(self):
        match = re.search(r'^\s*gotrue:\s*&gotrue-image\s+(\S+)\s*$', COMPOSE.read_text(encoding='utf-8'), re.M)
        self.assertIsNotNone(match, 'deploy/compose.yaml no longer pins the GoTrue image')
        pinned = match.group(1)
        self.assertRegex(pinned, r'^docker\.io/supabase/gotrue:v2\.197\.0@sha256:[0-9a-f]{64}$')
        proc, result = self.check(example_input())
        self.assertValid(proc, result)
        self.assertEqual(result['packet']['services']['auth']['image'], pinned)

    def test_topology_and_images_cannot_be_overridden(self):
        for path, value in (('topology', 'single-container'), ('services', {}),
                            ('auth.image', 'docker.io/supabase/gotrue:latest'), ('api.image', 'aya-amar-api:latest')):
            with self.subTest(member=path):
                self.assertRefused(with_value(example_input(), path, value), 'unknown_field', path)

    def test_result_holds_no_executable_database_bootstrap(self):
        proc = self.run_tool('check', self.write(example_input()))
        self.assertValid(proc, self.result(proc))
        text = proc.stdout.decode('ascii').lower()
        for statement in ('create role', 'alter role', 'create schema', 'create database', 'alter default privileges'):
            self.assertNotIn(statement, text)

    def test_documentation_names_are_refused_outside_an_example(self):
        proc, result = self.check(with_value(example_input(), 'example', False))
        for field in ('api.origin', 'auth.origin', 'database.host'):
            self.assertInvalid(proc, result, 'placeholder_host', field)


class CommandLineTests(ToolCase):
    """Two commands on explicit input, and no way to apply anything."""

    def test_there_is_no_default_apply_or_deploy_command(self):
        path = self.write(example_input())
        for args in ((), ('deploy', path), ('apply', path), ('create', path), ('run', path), ('up',), ('CHECK', path),
                     ('check', '--apply', path), ('check', '--execute', path)):
            with self.subTest(args=[str(a) for a in args]):
                proc = self.run_tool(*args)
                self.assertNotEvaluated(proc, self.result(proc), 'usage')
        self.assertEqual(self.entries(), ['input.json'])

    def test_wrong_argument_counts_are_usage_errors(self):
        path = self.write(example_input())
        for args in (('check',), ('check', path, path), ('packet', path),
                     ('packet', path, self.tmp / 'a.json', self.tmp / 'b.json')):
            with self.subTest(args=[str(a) for a in args]):
                proc = self.run_tool(*args)
                self.assertNotEvaluated(proc, self.result(proc), 'usage')
        self.assertEqual(self.entries(), ['input.json'])

    def test_standard_input_is_read_with_a_dash(self):
        data = json.dumps(example_input()).encode('utf-8')
        proc = self.run_tool('check', '-', stdin=data)
        result = self.result(proc)
        self.assertValid(proc, result)
        self.assertEqual(result['input_sha256'], hashlib.sha256(data).hexdigest())

    def test_unparsable_input_is_not_evaluated(self):
        for data, code in (
            (b'', 'invalid_json'),
            (b'{', 'invalid_json'),
            (b'{"format": "ayailmu-cloudrun-input/1"} {}', 'invalid_json'),
            (b'{"format": "ayailmu-cloudrun-input/1", "example": NaN}', 'invalid_json'),
            (b'{"format": "ayailmu-cloudrun-input/1", "example": Infinity}', 'invalid_json'),
            (b'[]', 'not_an_object'),
            (b'"ayailmu-cloudrun-input/1"', 'not_an_object'),
            (b'{"format": "ayailmu-cloudrun-input/1", "api": {"max_instances": 1, "max_instances": 2}}',
             'duplicate_member'),
            (b'\xff\xfe{}', 'input_not_utf8'),
        ):
            with self.subTest(data=data):
                proc = self.run_tool('check', '-', stdin=data)
                self.assertNotEvaluated(proc, self.result(proc), code)

    def test_unsupported_formats_are_not_evaluated(self):
        for doc in ({}, {'format': 'ayailmu-cloudrun-input/2'}, {'format': 1}, {'format': INPUT_FORMAT + ' '},
                    with_value(example_input(), 'format', 'ayailmu-cloudrun-input/0')):
            with self.subTest(format=doc.get('format')):
                proc = self.run_tool('check', '-', stdin=json.dumps(doc).encode('utf-8'))
                self.assertNotEvaluated(proc, self.result(proc), 'unsupported_format')

    def test_input_must_be_one_small_regular_utf8_file(self):
        valid = self.write(example_input(), 'valid.json')
        link = self.tmp / 'link.json'
        os.symlink(valid, link)
        large = self.write(json.dumps(example_input()).encode('utf-8') + b' ' * MAX_INPUT_BYTES, 'large.json')
        latin = self.write(b'{"format": "ayailmu-cloudrun-input/1", "example": "caf\xe9"}', 'latin.json')
        for path, code in ((self.tmp / 'missing.json', 'input_unreadable'), (self.tmp, 'input_not_regular_file'),
                           (link, 'input_not_regular_file'), (large, 'input_too_large'),
                           (latin, 'input_not_utf8')):
            with self.subTest(input=path.name):
                proc = self.run_tool('check', path)
                self.assertNotEvaluated(proc, self.result(proc), code)

    def test_standard_input_has_the_same_size_limit(self):
        data = json.dumps(example_input()).encode('utf-8') + b' ' * MAX_INPUT_BYTES
        proc = self.run_tool('check', '-', stdin=data)
        self.assertNotEvaluated(proc, self.result(proc), 'input_too_large')


class InputShapeTests(ToolCase):
    """A closed document: exact JSON types, missing members named, nothing unknown accepted."""

    def test_values_must_have_their_exact_json_type(self):
        for path, value in (('api.max_instances', True), ('api.max_instances', 2.0), ('api.max_instances', '2'),
                            ('api.max_instances', None), ('database.port', '5432'), ('auth.google_enabled', 1),
                            ('example', 'false'), ('api.origin', 42), ('api', 'https://api.example.com'),
                            ('schemas', ['ayailmu', 'aya_auth'])):
            with self.subTest(member=path, value=value):
                self.assertRefused(with_value(example_input(), path, value), 'invalid_type', path)

    def test_missing_required_members_are_named(self):
        for path in ('example', 'api', 'api.origin', 'api.max_instances', 'auth.db_pool_max_size', 'database',
                     'database.host', 'database.tls_mode', 'secret_references'):
            with self.subTest(member=path):
                self.assertRefused(without(example_input(), path), 'missing_field', path)

    def test_unknown_members_are_refused_rather_than_ignored(self):
        for path in ('region', 'privileges', 'roles.app_runtime_superuser', 'database.sslmode', 'api.cors_origins'):
            with self.subTest(member=path):
                self.assertRefused(with_value(example_input(), path, True), 'unknown_field', path)


class OriginTests(ToolCase):
    """API and Auth are separate services at canonical public https roots; Auth is self-hosted, never Supabase's."""

    MALFORMED = (
        'http://api.example.com', 'HTTPS://api.example.com', 'https://API.example.com', 'https://api.example.com/',
        'https://api.example.com/auth/v1', 'https://api.example.com:443', 'https://api.example.com:8443',
        'https://user@api.example.com', 'https://api.example.com?x=1', 'https://api.example.com#top',
        'https://*.example.com', 'https://api.example.com.', 'https://api..example.com', 'https://-api.example.com',
        'https://' + 'a' * 64 + '.example.com', 'https://localhost', 'https://127.0.0.1', 'https://10.0.0.1',
        'https://[::1]', 'https://${API_HOST}', 'https://{{ api_host }}', ' https://api.example.com',
        'https://api.example.com ', 'https://api.example.com\n', '',
    )
    NON_PUBLIC = ('localhost', 'local', 'test', 'invalid', 'example', 'onion', 'alt', 'arpa', 'internal', 'intranet',
                  'private', 'corp', 'home', 'lan', 'localdomain')

    def test_malformed_origins_are_refused(self):
        for origin in self.MALFORMED:
            with self.subTest(origin=origin):
                self.assertRefused(with_value(example_input(), 'api.origin', origin), 'invalid_origin', 'api.origin')

    def test_non_public_names_are_refused(self):
        for tld in self.NON_PUBLIC:
            with self.subTest(tld=tld):
                self.assertRefused(with_value(example_input(), 'auth.origin', f'https://auth.{tld}'),
                                   'non_public_host', 'auth.origin')

    def test_managed_supabase_hosts_are_refused_for_this_topology(self):
        for path, origin in (('auth.origin', 'https://abcdefghijklmnopqrst.supabase.co'),
                             ('auth.origin', 'https://auth.supabase.com'),
                             ('auth.issuer', 'https://abcdefghijklmnopqrst.supabase.co'),
                             ('api.origin', 'https://abcdefghijklmnopqrst.supabase.co')):
            with self.subTest(member=path, origin=origin):
                self.assertRefused(with_value(example_input(), path, origin), 'managed_supabase_host', path)

    def test_api_and_auth_need_their_own_origins(self):
        self.assertRefused(with_value(example_input(), 'auth.origin', 'https://api.example.com'),
                           'origin_collision', 'auth.origin')

    def test_explicit_issuer_follows_the_origin_rules(self):
        proc, result = self.check(with_value(example_input(), 'auth.issuer', 'https://issuer.example.com'))
        self.assertValid(proc, result)
        self.assertEqual(result['packet']['services']['auth']['issuer'], 'https://issuer.example.com')
        for issuer in ('https://auth.example.com/', 'auth.example.com', 'https://auth.example.com/auth/v1'):
            with self.subTest(issuer=issuer):
                self.assertRefused(with_value(example_input(), 'auth.issuer', issuer), 'invalid_origin', 'auth.issuer')


class DatabaseTests(ToolCase):
    """An exactly copied host, a direct or session-mode endpoint, and TLS that verifies the full certificate."""

    def test_transaction_pooling_is_refused_for_the_current_pgx_contract(self):
        self.assertRefused(with_value(example_input(), 'database.connection_mode', 'transaction'),
                           'transaction_pooling_unsupported', 'database.connection_mode')

    def test_direct_and_session_mode_endpoints_are_accepted(self):
        for mode, host in (('direct', 'db.abcdefghijklmnopqrst.supabase.co'),
                           ('session', 'aws-0-ap-southeast-1.pooler.supabase.com'),
                           ('session', 'db.example.com')):
            with self.subTest(mode=mode, host=host):
                doc = with_value(with_value(example_input(), 'database.connection_mode', mode), 'database.host', host)
                proc, result = self.check(doc)
                self.assertValid(proc, result)
                database = result['packet']['database']
                self.assertEqual((database['connection_mode'], database['host']), (mode, host))

    def test_unknown_connection_modes_are_refused(self):
        for mode in ('pool', 'statement', 'Session', 'session ', ''):
            with self.subTest(mode=mode):
                self.assertRefused(with_value(example_input(), 'database.connection_mode', mode),
                                   'invalid_connection_mode', 'database.connection_mode')

    def test_tls_must_verify_the_full_certificate(self):
        for mode in ('disable', 'allow', 'prefer', 'require', 'verify-ca', 'VERIFY-FULL', ''):
            with self.subTest(mode=mode):
                self.assertRefused(with_value(example_input(), 'database.tls_mode', mode),
                                   'tls_not_verify_full', 'database.tls_mode')

    def test_database_host_is_one_exact_name(self):
        for host in ('postgres://db.example.com', 'db.example.com:5432', 'db.example.com/postgres', 'DB.example.com',
                     'user@db.example.com', '192.0.2.10', '2001:db8::1', '[2001:db8::1]', 'localhost',
                     'db.example.com.', '*.example.com', 'db example.com', 'db.example.com\n', ''):
            with self.subTest(host=host):
                self.assertRefused(with_value(example_input(), 'database.host', host), 'invalid_host', 'database.host')
        for host in ('db.local', 'db.internal', 'db.test'):
            with self.subTest(host=host):
                self.assertRefused(with_value(example_input(), 'database.host', host),
                                   'non_public_host', 'database.host')


class BudgetTests(ToolCase):
    """Every instance may open its whole pool: max instances multiply, then migration, backup and headroom are kept."""

    def test_budget_is_accounted_per_instance_with_reserved_connections(self):
        proc, result = self.check(example_input())
        self.assertValid(proc, result)
        self.assertEqual(result['packet']['database']['connection_budget'], EXAMPLE_BUDGET)

    def test_budget_boundary(self):
        proc, result = self.check(with_value(example_input(), 'database.connection_limit', EXAMPLE_BUDGET['total']))
        self.assertValid(proc, result)
        self.assertRefused(with_value(example_input(), 'database.connection_limit', EXAMPLE_BUDGET['total'] - 1),
                           'connection_budget_exceeded', 'database.connection_limit')

    def test_max_instances_multiply_each_pool(self):
        # API at 9 x 5: 45 + 4 + 7 = 56 fits 60; at 10 x 5: 61 does not. Auth at 9 x 5: 6 + 45 + 7 = 58; at 10 x 5: 63.
        for service, pool in (('api', 'db_pool_max_conns'), ('auth', 'db_pool_max_size')):
            with self.subTest(service=service):
                fits = with_value(with_value(example_input(), f'{service}.{pool}', 5), f'{service}.max_instances', 9)
                proc, result = self.check(fits)
                self.assertValid(proc, result)
                self.assertRefused(with_value(fits, f'{service}.max_instances', 10),
                                   'connection_budget_exceeded', 'database.connection_limit')

    def test_instances_and_pools_are_bounded(self):
        for path, value, code in (
            ('api.max_instances', 0, 'out_of_range'),
            ('api.max_instances', 1000, 'out_of_range'),
            ('auth.max_instances', 0, 'out_of_range'),
            ('api.min_instances', -1, 'out_of_range'),
            ('api.db_pool_max_conns', 0, 'out_of_range'),
            ('api.db_pool_max_conns', 1000, 'out_of_range'),
            ('auth.db_pool_max_size', 0, 'unbounded_pool'),
            ('auth.db_pool_max_size', 1000, 'out_of_range'),
            ('database.port', 0, 'out_of_range'),
            ('database.port', 65536, 'out_of_range'),
            ('database.connection_limit', 0, 'out_of_range'),
            ('database.migration_connections', 0, 'out_of_range'),
            ('database.backup_connections', 0, 'out_of_range'),
            ('database.headroom_connections', 0, 'out_of_range'),
        ):
            with self.subTest(member=path, value=value):
                self.assertRefused(with_value(example_input(), path, value), code, path)

    def test_min_instances_default_to_zero_and_never_exceed_max(self):
        self.assertRefused(with_value(example_input(), 'api.min_instances', 3), 'min_exceeds_max', 'api.min_instances')
        self.assertRefused(with_value(example_input(), 'auth.min_instances', 3), 'min_exceeds_max',
                           'auth.min_instances')
        proc, result = self.check(with_value(example_input(), 'auth.min_instances', 1))
        self.assertValid(proc, result)
        self.assertEqual(result['packet']['services']['auth']['min_instances'], 1)
        self.assertEqual(result['packet']['services']['api']['min_instances'], 0)
        self.assertIs(result['zero_cost_guaranteed'], False)


class IdentifierTests(ToolCase):
    """App and Auth schemas and four roles of their own, never Supabase's or PostgreSQL's reserved names."""

    def test_reserved_schemas_are_refused(self):
        for name in ('auth', 'public', 'storage', 'realtime', 'extensions', 'graphql', 'graphql_public', 'pgbouncer',
                     'vault', 'net', 'cron', 'pgsodium', 'information_schema', 'pg_catalog', 'pg_temp_1',
                     'supabase_migrations', 'supabase_functions'):
            with self.subTest(schema=name):
                self.assertRefused(with_value(example_input(), 'schemas', {'auth': name}),
                                   'reserved_schema', 'schemas.auth')

    def test_reserved_roles_are_refused(self):
        for name in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'anon',
                     'authenticated', 'service_role', 'authenticator', 'dashboard_user', 'pgbouncer',
                     'pg_read_all_data', 'pgsodium_keyholder', 'public'):
            with self.subTest(role=name):
                self.assertRefused(with_value(example_input(), 'roles', {'auth_owner': name}),
                                   'reserved_role', 'roles.auth_owner')

    def test_unsafe_identifiers_are_refused(self):
        for name in ('Ayailmu', 'aya-ilmu', '1aya', '_aya', 'aya ilmu', 'aya;drop', 'aya"x', "aya'x", 'aya\nx',
                     'a' * 64, '', 'ayailmué'):
            with self.subTest(name=name):
                self.assertRefused(with_value(example_input(), 'schemas', {'app': name}),
                                   'invalid_identifier', 'schemas.app')
                self.assertRefused(with_value(example_input(), 'roles', {'backup': name}),
                                   'invalid_identifier', 'roles.backup')

    def test_schemas_and_roles_must_not_collide(self):
        self.assertRefused(with_value(example_input(), 'schemas', {'app': 'ayailmu', 'auth': 'ayailmu'}),
                           'schema_collision', 'schemas.auth')
        self.assertRefused(with_value(example_input(), 'roles', {'app_runtime': 'aya_owner'}),
                           'role_collision', 'roles.app_runtime')
        self.assertRefused(with_value(example_input(), 'roles', {'backup': 'aya_auth_owner'}),
                           'role_collision', 'roles.backup')


class SecretReferenceTests(ToolCase):
    """Secrets are named by pinned reference only, one per slot, never shared and never given as values."""

    def test_every_required_slot_needs_a_reference(self):
        for slot in SECRET_SLOTS:
            with self.subTest(slot=slot):
                self.assertRefused(without(example_input(), f'secret_references.{slot}'),
                                   'missing_secret_reference', f'secret_references.{slot}')

    def test_references_are_pinned_names_not_values(self):
        field = 'secret_references.api_database_url'
        self.assertRefused(with_value(example_input(), field, reference('api_database_url', 'latest')),
                           'unpinned_secret_version', field)
        for value in (
            {'secret': 'aya-api-database-url', 'version': 1},
            {'secret': 'aya-api-database-url', 'version': '0'},
            {'secret': 'aya-api-database-url', 'version': '01'},
            {'secret': 'aya-api-database-url', 'version': 'v1'},
            {'secret': 'AYA-API-DATABASE-URL', 'version': '1'},
            {'secret': 'api-database-url', 'version': '1'},
            {'secret': 'aya-', 'version': '1'},
            {'secret': 'aya-' + 'x' * 60, 'version': '1'},
            {'secret': 'projects/p/secrets/aya-api-database-url', 'version': '1'},
            {'secret': 'aya-api-database-url'},
            {'version': '1'},
            {'secret': 'aya-api-database-url', 'version': '1', 'value': 'x'},
            'aya-api-database-url',
            None,
            ['aya-api-database-url', '1'],
        ):
            with self.subTest(reference=value):
                self.assertRefused(with_value(example_input(), field, value), 'invalid_secret_reference', field)

    def test_a_secret_is_never_shared_between_slots(self):
        for version in ('1', '2'):
            with self.subTest(version=version):
                shared = {'secret': 'aya-api-database-url', 'version': version}
                self.assertRefused(with_value(example_input(), 'secret_references.auth_database_url', shared),
                                   'secret_reference_reused', 'secret_references.auth_database_url')

    def test_google_secret_follows_google_sign_in(self):
        google_on = with_value(example_input(), 'auth.google_enabled', True)
        self.assertRefused(google_on, 'missing_secret_reference', f'secret_references.{GOOGLE_SLOT}')
        proc, result = self.check(with_value(google_on, f'secret_references.{GOOGLE_SLOT}', reference(GOOGLE_SLOT)))
        self.assertValid(proc, result)
        self.assertIs(result['packet']['services']['auth']['google_enabled'], True)
        self.assertEqual(result['packet']['services']['auth']['google_callback'], 'https://auth.example.com/callback')
        self.assertRefused(with_value(example_input(), f'secret_references.{GOOGLE_SLOT}', reference(GOOGLE_SLOT)),
                           'unused_secret_reference', f'secret_references.{GOOGLE_SLOT}')

    def test_unknown_slots_are_refused(self):
        self.assertRefused(with_value(example_input(), 'secret_references.auth_service_role',
                                      reference('auth_service_role')),
                           'unknown_field', 'secret_references.auth_service_role')


class SecretValueTests(ToolCase):
    """No credential is accepted, and no refused value comes back on any output."""

    def test_secret_members_are_refused_by_name(self):
        for path in ('database.password', 'service_role_key', 'auth.smtp_pass', 'api.jwt_secret',
                     'auth.google_client_secret', 'database.dsn', 'database.database_url', 'auth.signing_keys',
                     'api.admin_token'):
            with self.subTest(member=path):
                self.assertRefused(with_value(example_input(), path, 'x'), 'secret_field_refused', path)

    def test_refused_values_never_reach_any_output(self):
        for path, value in (
            ('database.password', CANARY),
            ('service_role_key', CANARY),
            (CANARY, 1),
            ('secret_references.api_database_url', f'postgres://aya_runtime:{CANARY}@db.example.com:5432/postgres'),
            ('secret_references.auth_jwt_keys', {'secret': 'aya-auth-jwt-keys', 'version': '1', 'd': CANARY}),
            ('auth.issuer', f'eyJhbGciOiJFUzI1NiJ9.{CANARY}.c2lnbmF0dXJl'),
            ('database.host', f'postgres://user:{CANARY}@db.example.com'),
            ('api.origin', f'https://{CANARY}@api.example.com'),
        ):
            with self.subTest(member=path):
                source = self.write(with_value(example_input(), path, value))
                output = self.tmp / 'packet.json'
                for proc in (self.run_tool('check', source), self.run_tool('packet', source, output)):
                    result = self.result(proc)
                    self.assertEqual(proc.returncode, 1, result)
                    self.assertNotIn(CANARY.encode(), proc.stdout)
                    self.assertNotIn(CANARY.encode(), proc.stderr)
                self.assertFalse(output.exists(), 'an invalid configuration wrote a packet')


class PacketFileTests(ToolCase):
    """The packet is one new private file, written only for a valid configuration and never over anything."""

    def test_packet_is_written_once_to_a_new_private_file(self):
        source, output = self.write(example_input()), self.tmp / 'packet.json'
        proc = self.run_tool('packet', source, output)
        result = self.result(proc)
        self.assertValid(proc, result)
        self.assertEqual(result['command'], 'packet')
        info = os.lstat(output)
        self.assertTrue(stat.S_ISREG(info.st_mode))
        self.assertEqual(stat.S_IMODE(info.st_mode), 0o600)
        self.assertEqual(json.loads(output.read_bytes().decode('ascii')), result)
        self.assertEqual(self.entries(), ['input.json', 'packet.json'])

    def test_existing_output_is_never_replaced(self):
        source = self.write(example_input())
        existing = self.tmp / 'existing.json'
        existing.write_bytes(b'sentinel')
        dangling = self.tmp / 'dangling.json'
        os.symlink(self.tmp / 'target.json', dangling)
        linked = self.tmp / 'linked.json'
        os.symlink(existing, linked)
        for output in (existing, dangling, linked):
            with self.subTest(output=output.name):
                proc = self.run_tool('packet', source, output)
                self.assertNotEvaluated(proc, self.result(proc), 'output_exists')
        self.assertEqual(existing.read_bytes(), b'sentinel')
        self.assertFalse((self.tmp / 'target.json').exists())
        self.assertTrue(dangling.is_symlink() and linked.is_symlink())

    def test_invalid_configuration_writes_no_packet(self):
        source = self.write(with_value(example_input(), 'database.connection_mode', 'transaction'))
        output = self.tmp / 'packet.json'
        proc = self.run_tool('packet', source, output)
        self.assertInvalid(proc, self.result(proc), 'transaction_pooling_unsupported', 'database.connection_mode')
        self.assertFalse(output.exists())

    def test_output_directory_must_already_exist(self):
        output = self.tmp / 'missing' / 'packet.json'
        proc = self.run_tool('packet', self.write(example_input()), output)
        self.assertNotEvaluated(proc, self.result(proc), 'output_unwritable')
        self.assertFalse(output.parent.exists())


class SafetyTests(ToolCase):
    """Standard library only: no process, network, dynamic code or environment access, and input is never run."""

    FORBIDDEN_MODULES = frozenset({'subprocess', 'socket', 'ssl', 'http', 'urllib', 'ftplib', 'smtplib', 'poplib',
                                   'imaplib', 'telnetlib', 'xmlrpc', 'asyncio', 'multiprocessing', 'concurrent',
                                   'ctypes', 'webbrowser', 'pty', 'importlib', 'runpy'})
    FORBIDDEN_BUILTINS = frozenset({'eval', 'exec', 'compile', '__import__', 'breakpoint'})
    FORBIDDEN_OS = re.compile(r'system|popen|exec\w*|spawn\w*|fork\w*|posix_spawn\w*|startfile|environb?|getenvb?|'
                              r'putenv|unsetenv')

    def test_tool_uses_only_the_standard_library_without_process_network_or_environment_access(self):
        tree = ast.parse(TOOL.read_text(encoding='utf-8'), filename=str(TOOL))
        problems = []
        for node in ast.walk(tree):
            modules = []
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                modules = [node.module or '']
                if node.level:
                    problems.append(f'line {node.lineno}: relative import')
                if node.module == 'os':
                    problems += [f'line {node.lineno}: from os import {alias.name}' for alias in node.names
                                 if alias.name == '*' or self.FORBIDDEN_OS.fullmatch(alias.name)]
            for module in modules:
                top = module.split('.')[0]
                if top not in sys.stdlib_module_names or top in self.FORBIDDEN_MODULES:
                    problems.append(f'line {node.lineno}: imports {module}')
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id in self.FORBIDDEN_BUILTINS):
                problems.append(f'line {node.lineno}: calls {node.func.id}')
            if (isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == 'os'
                    and self.FORBIDDEN_OS.fullmatch(node.attr)):
                problems.append(f'line {node.lineno}: uses os.{node.attr}')
        self.assertEqual(problems, [])

    def test_input_text_is_never_executed(self):
        doc = with_value(example_input(), 'api.origin', 'https://$(touch pwned-a).example.com')
        doc = with_value(doc, 'auth.origin', 'https://`touch pwned-b`.example.com')
        doc = with_value(doc, 'schemas', {'app': 'x;touch pwned-c'})
        doc = with_value(doc, 'database.host', 'db.example.com;touch pwned-d')
        doc = with_value(doc, 'secret_references.api_database_url', {'secret': '$(touch pwned-e)', 'version': '1'})
        source = self.write(doc)
        for args in (('check', source), ('packet', source, self.tmp / 'packet.json')):
            with self.subTest(command=args[0]):
                proc = self.run_tool(*args)
                result = self.result(proc)
                self.assertEqual(proc.returncode, 1, result)
        self.assertEqual(self.entries(), ['input.json'])

    def test_control_characters_are_never_written_raw(self):
        doc = with_value(with_value(example_input(), 'api.origin', 'https://\x1b[2Japi.example.com'),
                         'schemas', {'app': 'aya\x00x'})
        proc = self.run_tool('check', self.write(doc))
        result = self.result(proc)
        self.assertInvalid(proc, result, 'invalid_origin', 'api.origin')
        self.assertInvalid(proc, result, 'invalid_identifier', 'schemas.app')
        self.assertNotIn(b'\x1b', proc.stderr)
        self.assertNotIn(b'\x00', proc.stderr)


class ExampleFileTests(ToolCase):
    """The shipped example is labelled, uses documentation names only, and is never called real or ready."""

    DOCUMENTATION = re.compile(r'^(?:[a-z0-9-]+\.)*example\.(?:com|net|org)$')

    def setUp(self):
        super().setUp()
        if not EXAMPLE.is_file():
            self.fail(f'deploy/cloudrun/example-input.json does not exist yet: the GREEN slice adds it ({PLAN}, '
                      'section F)')

    def test_shipped_example_is_a_labelled_non_executable_example(self):
        doc = json.loads(EXAMPLE.read_text(encoding='utf-8'))
        self.assertIs(doc['example'], True)
        hosts = [doc['api']['origin'].removeprefix('https://'), doc['auth']['origin'].removeprefix('https://'),
                 doc['database']['host']]
        if 'issuer' in doc['auth']:
            hosts.append(doc['auth']['issuer'].removeprefix('https://'))
        for host in hosts:
            self.assertRegex(host, self.DOCUMENTATION)
        proc = self.run_tool('check', EXAMPLE)
        result = self.result(proc)
        self.assertValid(proc, result)
        self.assertIs(result['configuration']['example'], True)
        self.assertIs(result['deployment_ready'], False)
        self.assertIs(result['packet']['non_executable'], True)
        self.assertIs(result['packet']['example'], True)


if __name__ == '__main__':
    unittest.main()
