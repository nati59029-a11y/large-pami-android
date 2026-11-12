#!/usr/bin/env python3
"""12.11.2026: אפליקציה עם הסמל של העסק – בלי עבודה ידנית.

שני מצבים (build-biz-apks.yml):
  discover  <sa.json> <bucket> <brands-dir>
      קורא את כל העסקים (Firestore b/*) עם חשבון השירות. לכל עסק פעיל שיש לו לוגו במיתוג (brand.logoPath == b/<id>/brand/logo):
      מוריד את הלוגו מ-Storage ל-<brands-dir>/<id>/logo.png (PNG מרובע, לפחות 192 פיקסלים) ומוסיף אותו ל-build-biz.json
      (appName = שם התצוגה במיתוג). עסק שכבר רשום ידנית ב-build-biz.json – נשאר כמו שהוא. לארג' פעמי לא נכלל (יש לו APK משלו).
      כל כשל (אין הרשאה, אין רשת, לוגו פגום) – הודעה, והבנייה ממשיכה בלי העסק הזה. לא כותב דבר ל-Firebase.
  fail <sa.json> <bizId>   – בנייה של עסק אחד שנכשלה: apkState.st = failed
  tag  <sa.json> <bizId>
      אחרי פרסום APK של העסק (רק מ-main): כותב b/<bizId>.apkTag = 'biz-<bizId>' (updateMask – רק השדה הזה),
      כדי שדף ההזמנה ומייל ההזמנה יפנו ל-APK עם הסמל של העסק. רק אם העסק קיים.
"""
import importlib.util
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BIZ_RE = re.compile(r'^[a-z0-9-]{3,30}$')
BIZ0 = 'larg' + 'peami'
_spec = importlib.util.spec_from_file_location('up', os.path.join(HERE, 'upload-apk-to-storage.py'))
UP = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(UP)


def token(sa_path, scope):
    UP.SCOPE = scope
    return UP.access_token(sa_path)


def get(url, tok, raw=False):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok})
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
    return b if raw else json.loads(b)


def fv(v):
    if not isinstance(v, dict):
        return None
    if 'stringValue' in v:
        return v['stringValue']
    if 'booleanValue' in v:
        return v['booleanValue']
    if 'mapValue' in v:
        return {k: fv(x) for k, x in (v['mapValue'].get('fields') or {}).items()}
    return None


def clean_name(s):
    s = re.sub(r'[<>&"\'\x00-\x1f]', '', str(s or '')).strip()
    return s[:30]


def save_png(data, path):
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    im.load()
    im = im.convert('RGBA')
    s = max(im.size)
    if s < 192:  # לוגו קטן – מגדילים (biz-icons.py דורש לפחות 192)
        r = 192 / s
        im = im.resize((max(1, round(im.size[0] * r)), max(1, round(im.size[1] * r))), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'PNG')


def discover(sa_path, bucket, brands):
    cfg_path = os.path.join(brands, 'build-biz.json')
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    have = {b.get('bizId') for b in cfg.get('businesses', []) if isinstance(b, dict)}
    pid = json.load(open(sa_path))['project_id']
    tok = token(sa_path, 'https://www.googleapis.com/auth/cloud-platform')
    docs, pt = [], ''
    for _ in range(20):
        u = f'https://firestore.googleapis.com/v1/projects/{pid}/databases/(default)/documents/b?pageSize=300' + ('&pageToken=' + urllib.parse.quote(pt) if pt else '')
        j = get(u, tok)
        docs += j.get('documents') or []
        pt = j.get('nextPageToken') or ''
        if not pt:
            break
    added = []
    for d in docs:
        bid = d['name'].rsplit('/', 1)[-1]
        if not BIZ_RE.match(bid) or bid in (BIZ0, 'business') or bid in have:
            continue
        f = {k: fv(v) for k, v in (d.get('fields') or {}).items()}
        br = f.get('brand') if isinstance(f.get('brand'), dict) else {}
        if f.get('status') == 'suspended':
            continue
        logo = br.get('logoPath') == f'b/{bid}/brand/logo'
        ap = f.get('apkState') if isinstance(f.get('apkState'), dict) else {}
        # 12.11.2026: עסק בלי לוגו נבנה רק אם מנהל־העל בחר "המשך בלי לוגו" (apkState.noLogo, נכתב רק בשרת) – סמל כללי ושם העסק
        if not logo and ap.get('noLogo') is not True:
            continue
        nm = clean_name(br.get('name') or f.get('name') or '')
        if not nm:
            print(f'::notice::{bid}: אין שם תצוגה – דולג')
            continue
        if not logo:
            cfg.setdefault('businesses', []).append({'bizId': bid, 'appName': nm, 'auto': True, 'noLogo': True})
            added.append(bid + '(no-logo)')
            continue
        try:
            data = get(f'https://storage.googleapis.com/storage/v1/b/{bucket}/o/' + urllib.parse.quote(f'b/{bid}/brand/logo', safe='') + '?alt=media', tok, raw=True)
            save_png(data, os.path.join(brands, bid, 'logo.png'))
        except Exception as e:  # noqa: BLE001 – עסק אחד לא עוצר את כולם
            print(f'::warning::{bid}: הלוגו לא נטען ({type(e).__name__}) – דולג')
            continue
        cfg.setdefault('businesses', []).append({'bizId': bid, 'appName': nm, 'auto': True})
        added.append(bid)
    json.dump(cfg, open(cfg_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('auto businesses:', ' '.join(added) or '(none)')


def tag(sa_path, bid):
    if not BIZ_RE.match(bid) or bid in (BIZ0, 'business'):
        raise SystemExit('bad bizId')
    pid = json.load(open(sa_path))['project_id']
    tok = token(sa_path, 'https://www.googleapis.com/auth/cloud-platform')
    base = f'https://firestore.googleapis.com/v1/projects/{pid}/databases/(default)/documents/b/{bid}'
    d = get(base, tok)  # 404 → שגיאה: לא יוצרים מסמך עסק חדש
    f = {k: fv(v) for k, v in (d.get('fields') or {}).items()}
    ap = f.get('apkState') if isinstance(f.get('apkState'), dict) else {}
    br = f.get('brand') if isinstance(f.get('brand'), dict) else {}
    # 12.11.2026: גם apkState = ready – כרטיס העסק מציג "האפליקציה מוכנה" ומאפשר לשלוח הזמנה
    st = {'st': {'stringValue': 'ready'}, 't': {'integerValue': str(int(time.time() * 1000))},
          'noLogo': {'booleanValue': br.get('logoPath') != f'b/{bid}/brand/logo'}, 'rebuild': {'booleanValue': ap.get('rebuild') is True}}
    patch(base, tok, {'apkTag': {'stringValue': 'biz-' + bid}, 'apkState': {'mapValue': {'fields': st}}}, ['apkTag', 'apkState'])
    print(f'apkTag set: b/{bid} = biz-{bid} (ready)')


def patch(base, tok, fields, paths):
    q = '&'.join('updateMask.fieldPaths=' + urllib.parse.quote(p) for p in paths)
    req = urllib.request.Request(base + '?' + q + '&currentDocument.exists=true', data=json.dumps({'fields': fields}).encode(), method='PATCH',
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()


def fail(sa_path, bid):
    """בנייה של עסק אחד שנכשלה: apkState.st = failed (רק השדות האלה)."""
    if not BIZ_RE.match(bid) or bid in (BIZ0, 'business'):
        raise SystemExit('bad bizId')
    pid = json.load(open(sa_path))['project_id']
    tok = token(sa_path, 'https://www.googleapis.com/auth/cloud-platform')
    base = f'https://firestore.googleapis.com/v1/projects/{pid}/databases/(default)/documents/b/{bid}'
    patch(base, tok, {'apkState': {'mapValue': {'fields': {'st': {'stringValue': 'failed'}, 'why': {'stringValue': 'build'}}}}}, ['apkState.st', 'apkState.why'])
    print(f'apkState failed: b/{bid}')


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) == 4 and a[0] == 'discover':
        discover(a[1], a[2], a[3])
    elif len(a) == 3 and a[0] == 'tag':
        tag(a[1], a[2])
    elif len(a) == 3 and a[0] == 'fail':
        fail(a[1], a[2])
    else:
        raise SystemExit(__doc__)
