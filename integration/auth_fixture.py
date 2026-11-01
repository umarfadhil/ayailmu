"""Local Keycloak fixture helpers. Only generated synthetic users; never prints tokens."""
import base64, hashlib, http.cookiejar, json, pathlib, secrets, urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser
BASE='http://127.0.0.1:8286'
CALLBACK='http://127.0.0.1:8386/callback'
class StopCallback(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if newurl.startswith(CALLBACK):return None
        if not newurl.startswith(BASE+'/'):raise RuntimeError('Unexpected auth origin')
        return super().redirect_request(req,fp,code,msg,headers,newurl)
class LoopbackCookies(http.cookiejar.DefaultCookiePolicy):
    def return_ok_secure(self,cookie,request):
        u=urllib.parse.urlsplit(request.get_full_url())
        if u.scheme=='http' and u.hostname=='127.0.0.1' and u.port==8286:return True
        return super().return_ok_secure(cookie,request)
class Form(HTMLParser):
    def __init__(self):super().__init__();self.action=None;self.fields={};self.active=False
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='form' and a.get('id')=='kc-form-login':self.action=a['action'];self.active=True
        if tag=='input' and self.active and a.get('type')=='hidden' and a.get('name'):self.fields[a['name']]=a.get('value','')
    def handle_endtag(self,tag):
        if tag=='form':self.active=False
class Client:
    def __init__(self):self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar(policy=LoopbackCookies())),StopCallback())
    def request(self,path,data=None,token=None,form=False,method=None,expected=200):
        url=path if path.startswith(BASE+'/') else BASE+path
        headers={}
        if token:headers['Authorization']='Bearer '+token
        if data is not None:
            headers['Content-Type']='application/x-www-form-urlencoded' if form else 'application/json'
            data=urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
        try:r=self.http.open(urllib.request.Request(url,data=data,headers=headers,method=method),timeout=10)
        except urllib.error.HTTPError as e:
            if e.code!=expected:raise RuntimeError(f'{urllib.parse.urlsplit(url).path}: HTTP {e.code}; expected {expected}') from None
            return e.read(),e.headers
        if r.status!=expected:raise RuntimeError('Unexpected local auth response')
        return r.read(),r.headers
    def json(self,*args,**kwargs):
        b,_=self.request(*args,**kwargs);return json.loads(b) if b else None
    def login(self,username,password):
        verifier=secrets.token_urlsafe(64);challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode();state=secrets.token_urlsafe(24)
        query=urllib.parse.urlencode({'client_id':'umar-native','response_type':'code','redirect_uri':CALLBACK,'scope':'openid umar.sync','state':state,'nonce':secrets.token_urlsafe(24),'code_challenge':challenge,'code_challenge_method':'S256','prompt':'login','max_age':0})
        html,_=self.request('/realms/umar-integration/protocol/openid-connect/auth?'+query)
        form=Form();form.feed(html.decode())
        if not form.action or not form.action.startswith(BASE+'/'):raise RuntimeError('Unexpected login form')
        form.fields.update(username=username,password=password)
        _,headers=self.request(form.action,form.fields,form=True,expected=302)
        params=urllib.parse.parse_qs(urllib.parse.urlsplit(headers['Location']).query)
        if params.get('state')!=[state] or 'code' not in params:raise RuntimeError('Invalid code callback')
        return self.json('/realms/umar-integration/protocol/openid-connect/token',{'grant_type':'authorization_code','client_id':'umar-native','redirect_uri':CALLBACK,'code':params['code'][0],'code_verifier':verifier},form=True)
