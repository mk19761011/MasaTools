"""Inspect presence and change the explicit contact enable flag; never log values."""
import json
import os
import re
from urllib.request import Request, urlopen
from urllib.error import HTTPError

account = os.environ['CLOUDFLARE_ACCOUNT_ID']
project = os.environ['CLOUDFLARE_PROJECT_NAME']
assert re.fullmatch(r'[a-fA-F0-9]{32}', account)
assert project == 'masatools'
url = f'https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{project}'
mode = os.environ.get('CONTACT_CONFIG_MODE', 'inspect')
assert mode in ('inspect', 'enable', 'disable')

def api(method='GET', body=None):
    request = Request(url, method=method, data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],
                 'Content-Type':'application/json'})
    try:
        with urlopen(request, timeout=45) as response:
            data = json.load(response)
    except HTTPError as error:
        raise SystemExit(f'Cloudflare request failed: HTTP {error.code}') from None
    if not data.get('success'):
        raise SystemExit('Cloudflare request was not successful; no values logged')
    return data['result']

def value(variables, key):
    return variables.get(key, {}).get('value', '')

result = api()
variables = result.get('deployment_configs', {}).get('production', {}).get('env_vars', {})
needed = ('CONTACT_RELAY_SECRET','CONTACT_RELAY_URL','CONTACT_TURNSTILE_SECRET','CONTACT_TURNSTILE_SITEKEY')
presence = {key: bool(variables.get(key)) for key in needed}
print(json.dumps({'present':presence, 'contact_enabled':value(variables,'CONTACT_ENABLED') == 'true'}, sort_keys=True), flush=True)
if mode != 'inspect':
    if mode == 'enable' and not all(presence.values()):
        raise SystemExit('Required configuration is missing; enable flag unchanged')
    flag = 'true' if mode == 'enable' else 'false'
    changed = api('PATCH', {'deployment_configs':{'production':{'env_vars':{
        'CONTACT_ENABLED':{'type':'plain_text','value':flag}}}}})
    updated = changed['deployment_configs']['production']['env_vars']
    assert value(updated, 'CONTACT_ENABLED') == flag
    assert all(key in updated for key in variables), 'Existing variables missing from response'
    print('Contact enable flag updated. Publish a new deployment to apply it.', flush=True)
