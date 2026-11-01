#!/usr/bin/env python3
"""Synthetic local-only code+PKCE test against real Keycloak and API. No token output."""
import base64, hashlib, http.cookiejar, json, pathlib, secrets, sys, urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser
ROOT=pathlib.Path(__file__).resolve().parents[1]
AUTH='http://127.0.0.1:8285'
API='http://127.0.0.1:8185'
CALLBACK='http://127.0.0.1:8385/callback'
class StopCallback(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if newurl.startswith(CALLBACK): return None
        if not newurl.startswith(AUTH+'/'): raise RuntimeError('unexpected auth redirect origin')
        return super().redirect_request(req,fp,code,msg,headers,newurl)
class LoopbackCookiePolicy(http.cookiejar.DefaultCookiePolicy):
    # Fixture only: model trusted-loopback browser handling, never allow off-host HTTP.
    def return_ok_secure(self,cookie,request):
        u=urllib.parse.urlsplit(request.get_full_url())
        if u.scheme=='http' and u.hostname=='127.0.0.1' and u.port==8285:return True
        return super().return_ok_secure(cookie,request)
jar=http.cookiejar.CookieJar(policy=LoopbackCookiePolicy())
http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),StopCallback())
def request(url,data=None,token=None,form=False,expected=200):
    headers={}
    if token:headers['Authorization']='Bearer '+token
    if data is not None:
        headers['Content-Type']='application/x-www-form-urlencoded' if form else 'application/json'
        data=urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
    try:
        res=http.open(urllib.request.Request(url,data=data,headers=headers),timeout=10)
    except urllib.error.HTTPError as e:
        if e.code!=expected:
            (ROOT/'.local/smoke-error.html').write_bytes(e.read())
            raise RuntimeError(f'{urllib.parse.urlsplit(url).path}: status {e.code}, expected {expected}; response saved locally') from None
        return e.read(),e.headers
    if res.status!=expected:raise RuntimeError(f'{url}: unexpected status {res.status}')
    return res.read(),res.headers
def obj(*args,**kwargs):return json.loads(request(*args,**kwargs)[0])
class LoginForm(HTMLParser):
    def __init__(self):super().__init__();self.action=None;self.fields={};self.active=False
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='form' and a.get('id')=='kc-form-login':self.action=a['action'];self.active=True
        if tag=='input' and self.active and a.get('type')=='hidden' and a.get('name'):self.fields[a['name']]=a.get('value','')
    def handle_endtag(self,tag):
        if tag=='form':self.active=False
admin_password=(ROOT/'.local/admin_password').read_text().strip()
admin=obj(AUTH+'/realms/master/protocol/openid-connect/token',{'grant_type':'password','client_id':'admin-cli','username':'umar_local_admin','password':admin_password},form=True)['access_token']
suffix=secrets.token_hex(6);username='synthetic-'+suffix;password=secrets.token_urlsafe(24)
request(AUTH+'/admin/realms/umar/users',{'username':username,'firstName':'Synthetic','lastName':'Fixture','email':username+'@example.invalid','emailVerified':True,'enabled':True,'credentials':[{'type':'password','value':password,'temporary':False}]},admin,expected=201)
# The application client must reject password grant; only bootstrap admin uses it above.
request(AUTH+'/realms/umar/protocol/openid-connect/token',{'grant_type':'password','client_id':'umar-native','username':username,'password':password},form=True,expected=400)
verifier=secrets.token_urlsafe(64);challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode();state=secrets.token_urlsafe(24)
query=urllib.parse.urlencode({'client_id':'umar-native','response_type':'code','redirect_uri':CALLBACK,'scope':'openid umar.sync','state':state,'nonce':secrets.token_urlsafe(24),'code_challenge':challenge,'code_challenge_method':'S256','max_age':0})
html,_=request(AUTH+'/realms/umar/protocol/openid-connect/auth?'+query)
form=LoginForm();form.feed(html.decode())
if not form.action or not form.action.startswith(AUTH+'/'):raise RuntimeError('login form unavailable or unexpected origin')
form.fields.update(username=username,password=password)
_,headers=request(form.action,form.fields,form=True,expected=302)
callback=headers['Location'];params=urllib.parse.parse_qs(urllib.parse.urlparse(callback).query)
if params.get('state')!=[state] or 'code' not in params:raise RuntimeError('invalid authorization callback')
tokens=obj(AUTH+'/realms/umar/protocol/openid-connect/token',{'grant_type':'authorization_code','client_id':'umar-native','redirect_uri':CALLBACK,'code':params['code'][0],'code_verifier':verifier},form=True)
token=tokens['access_token']
request(API+'/v1/learners',token=tokens['id_token'],expected=401)
account=obj(API+'/v1/account',{'adult_confirmed':True,'declaration_version':'adult-owner-v1','synthetic':True},token)
p=obj(API+'/v1/learners',{'client_learner_id':'synthetic-native-'+suffix,'kind':'ADULT','lang':'id','synthetic':True},token)
path=API+'/v1/learners/'+p['id'];obj(path+'/consent',{'granted':True,'version':'synthetic-sync-v1','synthetic':True},token)
# Pull shapes and source metadata from the pinned local registry, never personal device data.
registry=json.loads((ROOT/'internal/catalog/registry.json').read_text());events=[]
for kind,response in [('trace',{'kind':'sequence','sequence':['1','2']}),('story',{'kind':'choice','option_id':'seen'})]:
    pack,item=next((p,i) for p in registry['packs'] if 'adults' in p['audiences'] for i in p['items'].values() if i['type']==kind)
    item_id=next(k for k,v in pack['items'].items() if v is item)
    events.append(json.dumps({'answer_id':'synthetic-'+kind+'-'+suffix,'learner_id':p['client_learner_id'],'item_id':item_id,'track':pack['track'],'content_version':pack['content_version'],'rules_version':pack['rules_version'],'app_version':'synthetic-test','timestamp':'2026-10-18T10:00:00Z','local_date':'2026-10-18','session_id':'synthetic-session','lang':pack['instruction_langs'][0],'pool':item['pool'],'unit':item['unit'],'skills':[],'raw_response':json.dumps(response),'auto_score':{},'outcome':'not_assessed','first_attempt':True,'fresh_evidence':False,'review_status':item['review_status'],'synthetic':True,'item_type':kind},separators=(',',':')))
batch={'schema_version':1,'synthetic':True,'events':events}
receipts=obj(path+'/events',batch,token)
assert len(receipts)==2 and all(r['registry_status']=='registered' and not r['duplicate'] for r in receipts)
assert all(r['duplicate'] for r in obj(path+'/events',batch,token))
page=obj(path+'/events?after=0&limit=1',token=token);assert page['has_more'] and page['events'][0]['payload']==events[0]
page2=obj(path+'/events?after='+str(page['next_cursor']),token=token);assert page2['events'][0]['payload']==events[1]
obj(path+'/consent',{'granted':False,'version':'synthetic-sync-v1','synthetic':True},token)
request(path+'/events',batch,token,expected=403)
print(json.dumps({'status':'passed','provider':'Keycloak 26.8.1','flow':'authorization_code + PKCE S256','password_grant':'disabled for native client','id_token_as_bearer':'rejected','events':['trace','story'],'registry_status':'registered','byte_preservation':True,'replay':'duplicate receipts','withdrawal':'upload blocked','synthetic_only':True,'source_commit':registry['source_commit']},indent=2))
