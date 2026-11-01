"""Dedicated local synthetic realm only. Never prints credentials or access tokens."""
import contextlib
import fcntl
import json
import os
import pathlib
import secrets
import time
from auth_fixture import Client

ROOT = pathlib.Path(__file__).resolve().parent

@contextlib.contextmanager
def fixture_lock():
    os.umask(0o077)
    (ROOT / '.local').mkdir(exist_ok=True)
    with (ROOT / '.local/fixture.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another synthetic fixture/test run is active; run these suites sequentially') from None
        yield

def generate():
    os.umask(0o077)
    c = Client()
    admin = c.json('/realms/master/protocol/openid-connect/token', {
        'client_id': 'admin-cli', 'grant_type': 'password', 'username': 'umar_integration_admin',
        'password': (ROOT / '.local/admin_password').read_text().strip(),
    }, form=True)['access_token']
    client = c.json('/admin/realms/umar-integration/clients?clientId=umar-native', token=admin)[0]
    assert client['publicClient'] and not client['directAccessGrantsEnabled']
    path = '/admin/realms/umar-integration/clients/' + client['id']
    # Recover the dedicated lab's known five-minute lifetime after interrupted tests.
    stable = {**client.get('attributes', {}), 'access.token.lifespan': '300'}
    client['attributes'] = stable
    c.request(path, client, token=admin, method='PUT', expected=204)
    suffix = secrets.token_hex(6)
    users = {}
    for label in ('A', 'B'):
        username = 'syn-integration-' + suffix + '-' + label.lower()
        password = secrets.token_urlsafe(24)
        c.request('/admin/realms/umar-integration/users', {
            'username': username, 'firstName': 'Synthetic', 'lastName': 'Fixture',
            'email': username + '@example.invalid', 'emailVerified': True, 'enabled': True,
            'credentials': [{'type': 'password', 'value': password, 'temporary': False}],
        }, token=admin, expected=201)
        users[label] = {'username': username, 'password': password}
    tokens = {label: Client().login(u['username'], u['password'])['access_token'] for label, u in users.items()}
    try:
        client['attributes'] = {**stable, 'access.token.lifespan': '1'}
        c.request(path, client, token=admin, method='PUT', expected=204)
        tokens['expired'] = Client().login(users['A']['username'], users['A']['password'])['access_token']
    finally:
        client['attributes'] = stable
        c.request(path, client, token=admin, method='PUT', expected=204)
    time.sleep(2)
    (ROOT / '.local/synthetic-accounts.json').write_text(json.dumps(users))
    (ROOT / '.local/token-fixtures.json').write_text(json.dumps(tokens))
    print('Generated local synthetic code+PKCE fixtures. No credentials or tokens printed.', flush=True)
