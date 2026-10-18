#!/usr/bin/env python3
"""Reconcile this prototype's local-only native client after realm JSON edits.

Keycloak startup import deliberately skips an existing realm. This command updates
only umar-native in realm umar at loopback port 8285. No user data is read or changed.
"""
import json, pathlib, urllib.request, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:8285'
def req(path,data=None,method=None,token=None,form=False):
    headers={}
    if token:headers['Authorization']='Bearer '+token
    if data is not None:
        headers['Content-Type']='application/x-www-form-urlencoded' if form else 'application/json'
        data=urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
    with urllib.request.urlopen(urllib.request.Request(BASE+path,data=data,headers=headers,method=method),timeout=10) as r:
        raw=r.read();return json.loads(raw) if raw else None
token=req('/realms/master/protocol/openid-connect/token',{'client_id':'admin-cli','grant_type':'password','username':'umar_local_admin','password':(ROOT/'.local/admin_password').read_text().strip()},form=True)['access_token']
clients=req('/admin/realms/umar/clients?clientId=umar-native',token=token)
assert len(clients)==1 and clients[0]['clientId']=='umar-native'
client=clients[0];path='/admin/realms/umar/clients/'+client['id'];desired=json.loads((ROOT/'deploy/umar-realm.json').read_text())['clients'][0]
for k in ('standardFlowEnabled','directAccessGrantsEnabled','implicitFlowEnabled','serviceAccountsEnabled','fullScopeAllowed','attributes','redirectUris','webOrigins'):client[k]=desired[k]
req(path,client,method='PUT',token=token)
mappers={m['name']:m for m in req(path+'/protocol-mappers/models',token=token)}
for mapper in desired['protocolMappers']:
    old=mappers.get(mapper['name'])
    if old:
        mapper['id']=old['id'];req(path+'/protocol-mappers/models/'+old['id'],mapper,method='PUT',token=token)
    else:req(path+'/protocol-mappers/models',mapper,method='POST',token=token)
print('Configured only realm umar client umar-native on 127.0.0.1:8285. No users changed.')
