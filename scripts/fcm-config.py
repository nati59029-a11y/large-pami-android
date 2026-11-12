#!/usr/bin/env python3
"""12.11.2026: התראות לטלפון – google-services.json אוטומטי בזמן הבנייה (main.yml, build-biz-apks.yml).

  fcm-config.py <sa.json> <package> <out-file>

עם חשבון השירות (FIREBASE_SERVICE_ACCOUNT), בפרויקט שלו (project_id):
  1. מחפש ב-Firebase אפליקציית Android עם שם החבילה (packageName).
  2. אם אין – יוצר אותה (כמו firebase apps:create ANDROID) ומחכה שתהיה מוכנה.
  3. מוריד את ההגדרות שלה (כמו firebase apps:sdkconfig ANDROID) ל-<out-file>.
הקובץ לא נכנס למאגר – רק לעותק של הבנייה. לא מדפיס מפתחות.
יציאה: 0 הצליח; 2 אין הרשאה (ההודעה אומרת בדיוק מה להוסיף); 1 כל כשל אחר.
"""
import base64
import importlib.util
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('up', os.path.join(HERE, 'upload-apk-to-storage.py'))
UP = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(UP)

API = 'https://firebase.googleapis.com/v1beta1/'
PKG_RE = re.compile(r'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
PROJ_RE = re.compile(r'^[a-z0-9-]{4,40}$')


class NoPermission(Exception):
    pass


def req(method, url, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            return json.loads(x.read() or b'{}')
    except urllib.error.HTTPError as e:
        txt = e.read()[:2000].decode('utf-8', 'replace')
        if e.code in (401, 403):
            raise NoPermission('%s %s: %s' % (e.code, method, txt))
        raise RuntimeError('HTTP %s %s %s: %s' % (e.code, method, url.split('?')[0], txt))


def find_app(project, pkg, tok):
    url = API + 'projects/%s/androidApps?pageSize=100' % project
    nxt = ''
    for _ in range(50):
        j = req('GET', url + ('&pageToken=' + urllib.request.quote(nxt) if nxt else ''), tok)
        for a in j.get('apps') or []:
            if a.get('packageName') == pkg and a.get('state', 'ACTIVE') == 'ACTIVE' and a.get('appId'):
                return a['appId']
        nxt = j.get('nextPageToken') or ''
        if not nxt:
            return None
    return None


def create_app(project, pkg, tok):
    op = req('POST', API + 'projects/%s/androidApps' % project, tok, {'packageName': pkg, 'displayName': pkg[:100]})
    name = op.get('name') or ''
    for _ in range(40):
        if op.get('done'):
            if op.get('error'):
                raise RuntimeError('create failed: %s' % json.dumps(op['error'])[:500])
            app_id = (op.get('response') or {}).get('appId')
            if app_id:
                return app_id
            break
        if not re.fullmatch(r'operations/[A-Za-z0-9_./-]+', name):
            break
        time.sleep(3)
        op = req('GET', API + name, tok)
    # הפעולה לא החזירה מזהה בזמן – אולי נוצרה בכל זאת
    for _ in range(5):
        app_id = find_app(project, pkg, tok)
        if app_id:
            return app_id
        time.sleep(3)
    raise RuntimeError('create: the Android app was not ready in time')


def get_config(app_id, pkg, tok):
    if not re.fullmatch(r'[0-9]+:[0-9]+:android:[0-9a-f]+', app_id):
        raise RuntimeError('unexpected appId format')
    j = req('GET', API + 'projects/-/androidApps/%s/config' % app_id, tok)
    raw = base64.b64decode(j.get('configFileContents') or '')
    cfg = json.loads(raw)
    names = [((c.get('client_info') or {}).get('android_client_info') or {}).get('package_name') for c in cfg.get('client') or []]
    if pkg not in names:
        raise RuntimeError('config does not contain the package')
    return raw


def main(argv):
    if len(argv) != 4:
        print('usage: fcm-config.py <sa.json> <package> <out-file>')
        return 1
    sa_path, pkg, out = argv[1], argv[2], argv[3]
    if not PKG_RE.fullmatch(pkg):
        print('::error::bad package name')
        return 1
    sa = json.load(open(sa_path, encoding='utf-8'))
    project, email = sa.get('project_id', ''), sa.get('client_email', '')
    if not PROJ_RE.fullmatch(project):
        print('::error::the service account has no valid project_id')
        return 1
    UP.SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
    try:
        tok = UP.access_token(sa_path)
        app_id = find_app(project, pkg, tok)
        made = False
        if not app_id:
            app_id = create_app(project, pkg, tok)
            made = True
        raw = get_config(app_id, pkg, tok)
    except NoPermission as e:
        disabled = 'SERVICE_DISABLED' in str(e) or 'has not been used' in str(e)
        print('::warning::push: no permission (%s)' % str(e)[:300].replace('\n', ' '))
        if disabled:
            print('NEEDS: enable "Firebase Management API" (firebase.googleapis.com) in project %s.' % project)
        else:
            print('NEEDS: Google Cloud console -> IAM & Admin -> IAM, project %s -> service account %s -> add role "Firebase Admin" (roles/firebase.admin).' % (project, email))
        return 2
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(raw)
    print('push: %s Android app %s for %s (project %s)' % ('created' if made else 'found', app_id, pkg, project))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except Exception as e:  # כל כשל – הבנייה ממשיכה בלי התראות (העוטף fcm-config.sh)
        print('::warning::push: %s' % str(e)[:400].replace('\n', ' '))
        sys.exit(1)
