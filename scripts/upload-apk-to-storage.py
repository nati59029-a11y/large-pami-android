#!/usr/bin/env python3
"""Upload the APK and a small version file to Firebase Storage (app_releases/latest/).

Used by .github/workflows/main.yml (job "apk-storage"), only on main. Python standard library + the
openssl command only (both exist on the GitHub runner), so nothing is installed.

What is uploaded, in this order:
  1. app_releases/latest/large-pami.apk  (the APK)
  2. app_releases/latest/version.json    {"versionCode", "size", "sha256", "file", "uploadedAt"}
The APK goes first: a phone that reads the old version.json while the new APK is already there gets a
SHA-256 that does not match, so it refuses to install (safe) and tries again at the next check.
After each upload the size (and MD5, when the server returns it) are compared with the local file.

Sign-in: the service account key (--sa, the JSON of the secret FIREBASE_SERVICE_ACCOUNT) is turned into a
short access token (OAuth, JWT signed with openssl). The private key is written to a temporary file that
only this user can read, and deleted right after signing. Nothing secret is printed.

Tests (on a computer): with the environment variable STORAGE_EMULATOR_HOST=127.0.0.1:<port> it talks
to the local Storage emulator instead (no key needed, no request to Google).

  python3 scripts/upload-apk-to-storage.py --apk app-debug.apk --version-code 1062 \
      --bucket <bucket> --sa sa.json [--prefix app_releases/latest/] [--summary file]
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

APK_NAME = 'large-pami.apk'
SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def access_token(sa_path):
    sa = json.load(open(sa_path, encoding='utf-8'))
    for k in ('client_email', 'private_key'):
        if not sa.get(k):
            raise SystemExit('the service account JSON has no ' + k)
    token_uri = sa.get('token_uri') or 'https://oauth2.googleapis.com/token'
    now = int(time.time())
    head = b64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    claim = b64url(json.dumps({'iss': sa['client_email'], 'scope': SCOPE, 'aud': token_uri,
                               'iat': now, 'exp': now + 600}).encode())
    signing_input = (head + '.' + claim).encode()
    fd, key_path = tempfile.mkstemp(prefix='sa-key-', suffix='.pem')
    try:
        os.chmod(key_path, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(sa['private_key'])
        sig = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', key_path], input=signing_input,
                             capture_output=True, check=True).stdout
    finally:
        os.remove(key_path)
    jwt = (head + '.' + claim + '.' + b64url(sig)).encode()
    body = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                   'assertion': jwt.decode()}).encode()
    req = urllib.request.Request(token_uri, data=body, method='POST',
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)['access_token']


def upload(api, auth, bucket, name, data, content_type):
    """Multipart upload (metadata + content in one request), JSON API of Cloud Storage."""
    meta = {'name': name, 'contentType': content_type, 'cacheControl': 'no-cache, max-age=0'}
    boundary = 'lp-' + hashlib.sha256(os.urandom(16)).hexdigest()[:24]
    body = (('--%s\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n%s\r\n--%s\r\nContent-Type: %s\r\n\r\n'
             % (boundary, json.dumps(meta), boundary, content_type)).encode() + data
            + ('\r\n--%s--\r\n' % boundary).encode())
    url = '%s/upload/storage/v1/b/%s/o?uploadType=multipart' % (api, urllib.parse.quote(bucket, safe=''))
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Authorization': auth, 'Content-Type': 'multipart/related; boundary=' + boundary})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            obj = json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit('upload of %s failed: HTTP %s %s' % (name, e.code, e.read()[:300].decode('utf-8', 'replace')))
    if int(obj.get('size', -1)) != len(data):
        raise SystemExit('upload of %s: size on the server %s != local %d' % (name, obj.get('size'), len(data)))
    md5 = obj.get('md5Hash')
    if md5 and base64.b64decode(md5) != hashlib.md5(data).digest():
        raise SystemExit('upload of %s: MD5 on the server does not match the local file' % name)
    return obj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apk', required=True)
    ap.add_argument('--version-code', required=True, type=int)
    ap.add_argument('--bucket', required=True)
    ap.add_argument('--sa', help='service account JSON (not needed with STORAGE_EMULATOR_HOST)')
    ap.add_argument('--prefix', default='app_releases/latest/')
    ap.add_argument('--summary', help='file to append a short summary to (GITHUB_STEP_SUMMARY)')
    a = ap.parse_args()

    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]', a.bucket):
        raise SystemExit('bad bucket name: ' + a.bucket)
    if not re.fullmatch(r'app_releases/[a-z0-9_-]+/', a.prefix):
        raise SystemExit('the prefix must be app_releases/<name>/')
    data = open(a.apk, 'rb').read()
    if len(data) < 4 or data[:2] != b'PK':
        raise SystemExit('this is not an APK file: ' + a.apk)

    emu = os.environ.get('STORAGE_EMULATOR_HOST', '')
    if emu:
        api, auth = 'http://' + emu, 'Bearer owner'
    else:
        if not a.sa:
            raise SystemExit('--sa is required')
        api, auth = 'https://storage.googleapis.com', 'Bearer ' + access_token(a.sa)

    sha = hashlib.sha256(data).hexdigest()
    version = {'versionCode': a.version_code, 'size': len(data), 'sha256': sha, 'file': APK_NAME,
               'uploadedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    upload(api, auth, a.bucket, a.prefix + APK_NAME, data, 'application/vnd.android.package-archive')
    vj = (json.dumps(version, indent=1) + '\n').encode()
    upload(api, auth, a.bucket, a.prefix + 'version.json', vj, 'application/json')

    line = 'APK %d uploaded to Firebase Storage: gs://%s/%s%s (%d bytes, SHA-256 %s)' % (
        a.version_code, a.bucket, a.prefix, APK_NAME, len(data), sha)
    print(line)
    if a.summary:
        with open(a.summary, 'a', encoding='utf-8') as f:
            f.write(line + '\n')


if __name__ == '__main__':
    sys.exit(main())
