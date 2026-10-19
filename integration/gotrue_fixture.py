"""Actual isolated GoTrue/Mailpit fixtures. Fabricated adults only; no secret output."""
import json
import pathlib
import re
import secrets
import time
from urllib import error, parse, request

ROOT = pathlib.Path(__file__).resolve().parent
AUTH = 'http://127.0.0.1:8287'
API = 'http://127.0.0.1:8187'
MAIL = 'http://127.0.0.1:8387'

def req(base, path, data=None, token=None, method=None, expected=(200,)):
    assert base in (AUTH, API, MAIL)
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if data is not None:
        data = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    try:
        response = request.urlopen(request.Request(base + path, data=data, headers=headers, method=method), timeout=10)
    except error.HTTPError as response:
        status = response.code
        body = response.read()
    else:
        status = response.status
        body = response.read()
    value = json.loads(body) if body else None
    if status not in expected:
        code = value.get('error_code', value.get('error', 'request_failed')) if isinstance(value, dict) else 'request_failed'
        raise RuntimeError(f'{path.split("?")[0]}: HTTP {status}; {code}')
    return value

def sign_in(email, password):
    assert email.endswith('@example.invalid')
    return req(AUTH, '/token?grant_type=password', {'email': email, 'password': password})

def mail_code(email, kind):
    assert email.endswith('@example.invalid')
    for _ in range(40):
        messages = req(MAIL, '/api/v1/search?query=' + parse.quote('to:' + email)).get('messages', [])
        for summary in messages:
            subject = summary['Subject'].lower()
            if kind == 'signup' and 'confirm' not in subject:
                continue
            if kind == 'recovery' and not ('reset' in subject or 'recover' in subject):
                continue
            message = req(MAIL, '/api/v1/message/' + summary['ID'])
            match = re.search(r'<strong>\s*([0-9]{6})\s*</strong>', message.get('HTML', ''))
            if match:
                return match[1]
        time.sleep(0.25)
    raise RuntimeError('Expected local synthetic confirmation/recovery email not delivered')

def create_confirmed(email, password):
    assert email.endswith('@example.invalid')
    req(AUTH, '/signup', {'email': email, 'password': password})
    denied = req(AUTH, '/token?grant_type=password', {'email': email, 'password': password}, expected=(400,))
    assert denied['error_code'] == 'email_not_confirmed'
    code = mail_code(email, 'signup')
    return req(AUTH, '/verify', {'email': email, 'token': code, 'type': 'signup'})

def generate(wait_expired=True):
    suffix = secrets.token_hex(6)
    users = {label: {'email': 'syn-gotrue-' + suffix + '-' + label.lower() + '@example.invalid', 'password': secrets.token_urlsafe(24)} for label in ('A', 'B')}
    a = create_confirmed(**users['A'])
    create_confirmed(**users['B'])
    assert a['user']['email_confirmed_at']
    owner = req(API, '/v1/account', {'declaration_version': 'adult-owner-v1', 'adult_confirmed': True, 'synthetic': True}, a['access_token'])
    assert owner == req(API, '/v1/account', token=a['access_token'])
    rotated = req(AUTH, '/token?grant_type=refresh_token', {'refresh_token': a['refresh_token']})
    assert rotated['user']['id'] == a['user']['id']
    assert rotated['refresh_token'] != a['refresh_token']
    assert req(API, '/v1/account', token=rotated['access_token']) == owner
    time.sleep(1.1)
    req(AUTH, '/recover', {'email': users['A']['email']})
    code = mail_code(users['A']['email'], 'recovery')
    recovery = req(AUTH, '/verify', {'email': users['A']['email'], 'token': code, 'type': 'recovery'})
    new_password = secrets.token_urlsafe(24)
    req(AUTH, '/user', {'password': new_password}, recovery['access_token'], method='PUT')
    req(AUTH, '/token?grant_type=password', users['A'], expected=(400,))
    users['A']['password'] = new_password
    req(AUTH, '/logout?scope=local', token=recovery['access_token'], method='POST', expected=(204,))
    req(AUTH, '/token?grant_type=refresh_token', {'refresh_token': recovery['refresh_token']}, expected=(400, 401))
    expired = sign_in(**users['A'])
    if wait_expired:
        print('Synthetic email/confirmation/recovery/rotation/logout passed; waiting for an actual issued token to expire.', flush=True)
        until = time.monotonic() + expired['expires_in'] + 2
        while time.monotonic() < until:
            time.sleep(min(5, max(0.1, until - time.monotonic())))
        req(API, '/v1/account', token=expired['access_token'], expected=(401,))
    tokens = {label: sign_in(**user)['access_token'] for label, user in users.items()}
    tokens.update(expired=expired['access_token'], api=API)
    private = ROOT / '.local/gotrue'
    private.mkdir(exist_ok=True)
    for name, value in [('synthetic-accounts.json', users), ('token-fixtures.json', tokens)]:
        path = private / name
        path.write_text(json.dumps(value))
        path.chmod(0o600)
    print('REAL_GOTRUE_AUTH_PASS: signup; actual Mailpit delivery; confirmation required; email/password; rotation; recovery; logout; exact API issuer; synthetic-only fixtures.', flush=True)
    return tokens

if __name__ == '__main__':
    from fixtures import fixture_lock
    with fixture_lock():
        generate()
