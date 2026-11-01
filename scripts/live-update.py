#!/usr/bin/env python3
"""Live update ("עדכון חי") tools for the build. Uses only Python and the openssl command.

  native-id <app-source-dir>
      Fingerprint (SHA-256) of everything that makes the native (Android) part of the app:
      package.json, capacitor.config.json, scripts/patch-android.sh, android-plugin/*.java.
      A bundle is used only by an APK with the same fingerprint, so new screens never run on
      native code they were not built with.

  config --pub PUB.pem --url URL --native-id HEX --out live-update.properties
      The settings built into the APK: the PUBLIC key, the manifest address, the fingerprint.

  bundle --www DIR --version N --native-id HEX --out OUT
      Builds OUT/public/app-updates/bundles/N.zip (same bytes every time for the same files) and
      OUT/payload.txt (the text that gets signed: version, fingerprint, ZIP SHA-256, and the
      SHA-256 and size of every file). Nothing secret is needed.

  sign --payload OUT/payload.txt --key KEY.pem --out manifest.json
      Signs payload.txt with the private key (ECDSA P-256, SHA-256) -> manifest.json.

  verify --manifest manifest.json --pub PUB.pem --root OUT/public/app-updates
      Checks the signature and the ZIP, the same checks the app makes. Used before uploading.
"""
import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

SAFE = re.compile(r"^[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+)*(/[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+)*)*$")
NATIVE_FILES = ["package.json", "capacitor.config.json", "scripts/patch-android.sh"]


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def native_id(src):
    files = list(NATIVE_FILES)
    pdir = os.path.join(src, "android-plugin")
    files += sorted("android-plugin/" + f for f in os.listdir(pdir) if f.endswith(".java"))
    h = hashlib.sha256()
    for rel in files:
        with open(os.path.join(src, rel), "rb") as f:
            h.update(("%s %s\n" % (rel, sha256(f.read()))).encode())
    return h.hexdigest()


def pem_to_der(path):
    txt = open(path).read()
    m = re.search(r"-----BEGIN PUBLIC KEY-----(.*?)-----END PUBLIC KEY-----", txt, re.S)
    if not m:
        sys.exit("ERROR: %s is not a PEM public key" % path)
    import base64
    return base64.b64decode("".join(m.group(1).split()))


def cmd_native_id(a):
    print(native_id(a.src))


def cmd_config(a):
    if not re.match(r"^https://[A-Za-z0-9.\-]+(:[0-9]+)?/app-updates/manifest\.json$", a.url) and not a.allow_http:
        sys.exit("ERROR: the manifest address must be https://<host>/app-updates/manifest.json")
    if not re.match(r"^[0-9a-f]{64}$", a.native_id):
        sys.exit("ERROR: bad native id")
    der = pem_to_der(a.pub)
    with open(a.out, "w") as f:
        f.write("# Live update settings (public values only). Written by the build.\n")
        f.write("publicKey=%s\n" % der.hex())
        f.write("manifestUrl=%s\n" % a.url)
        f.write("nativeId=%s\n" % a.native_id)
    print("live update settings written: %s (public key %d bytes, %s)" % (a.out, len(der), a.url))


def cmd_bundle(a):
    v = int(a.version)
    if v <= 0:
        sys.exit("ERROR: bad version")
    files = []
    for root, dirs, names in os.walk(a.www):
        dirs.sort()
        for n in sorted(names):
            full = os.path.join(root, n)
            rel = os.path.relpath(full, a.www).replace(os.sep, "/")
            if not SAFE.match(rel):
                sys.exit("ERROR: file name not allowed in a bundle: %r" % rel)
            files.append(rel)
    files.sort()
    if "index.html" not in files:
        sys.exit("ERROR: index.html is missing in %s" % a.www)
    buf = io.BytesIO()
    lines = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in files:
            data = open(os.path.join(a.www, rel), "rb").read()
            info = zipfile.ZipInfo(rel, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
            lines.append("file %s %d %s" % (sha256(data), len(data), rel))
    zbytes = buf.getvalue()
    out_dir = os.path.join(a.out, "public", "app-updates", "bundles")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "%d.zip" % v), "wb") as f:
        f.write(zbytes)
    payload = ["LPLU1", "version %d" % v, "native %s" % a.native_id, "bundle bundles/%d.zip" % v,
               "zip %s %d" % (sha256(zbytes), len(zbytes))] + lines
    with open(os.path.join(a.out, "payload.txt"), "w", newline="\n") as f:
        f.write("\n".join(payload) + "\n")
    print("bundle %d: %d files, zip %d bytes, sha256 %s" % (v, len(files), len(zbytes), sha256(zbytes)))


def cmd_sign(a):
    payload = open(a.payload, "rb").read()
    m = re.search(rb"^version ([0-9]+)$", payload, re.M)
    if not payload.startswith(b"LPLU1\n") or not m:
        sys.exit("ERROR: %s is not a live update payload" % a.payload)
    with tempfile.TemporaryDirectory() as td:
        sig_path = os.path.join(td, "sig.der")
        r = subprocess.run(["openssl", "dgst", "-sha256", "-sign", a.key, "-out", sig_path, a.payload],
                           capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit("ERROR: signing failed: " + r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "ERROR: signing failed")
        sig = open(sig_path, "rb").read()
    doc = {"format": 1, "version": int(m.group(1)), "payload": payload.hex(), "sig": sig.hex()}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(doc, f)
    print("manifest signed: version %s, %s" % (m.group(1).decode(), a.out))


def cmd_verify(a):
    doc = json.load(open(a.manifest))
    payload = bytes.fromhex(doc["payload"])
    sig = bytes.fromhex(doc["sig"])
    with tempfile.TemporaryDirectory() as td:
        p, s = os.path.join(td, "p"), os.path.join(td, "s")
        open(p, "wb").write(payload)
        open(s, "wb").write(sig)
        r = subprocess.run(["openssl", "dgst", "-sha256", "-verify", a.pub, "-signature", s, p],
                           capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("ERROR: the signature does not match the public key")
    text = payload.decode()
    zline = re.search(r"^zip ([0-9a-f]{64}) ([0-9]+)$", text, re.M)
    bline = re.search(r"^bundle (bundles/[0-9]+\.zip)$", text, re.M)
    zbytes = open(os.path.join(a.root, bline.group(1)), "rb").read()
    if sha256(zbytes) != zline.group(1) or len(zbytes) != int(zline.group(2)):
        sys.exit("ERROR: the bundle ZIP does not match the signed SHA-256")
    want = {}
    for l in text.splitlines():
        if l.startswith("file "):
            _, h, n, rel = l.split(" ", 3)
            want[rel] = (h, int(n))
    with zipfile.ZipFile(io.BytesIO(zbytes)) as z:
        names = [i.filename for i in z.infolist() if not i.is_dir()]
        if sorted(names) != sorted(want):
            sys.exit("ERROR: the ZIP files differ from the signed list")
        for rel in names:
            d = z.read(rel)
            if (sha256(d), len(d)) != want[rel]:
                sys.exit("ERROR: %s does not match its SHA-256" % rel)
    print("OK: signature valid, ZIP and %d files match (version %s)" % (len(want), doc["version"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("native-id"); p.add_argument("src"); p.set_defaults(f=cmd_native_id)
    p = sp.add_parser("config"); p.add_argument("--pub", required=True); p.add_argument("--url", required=True)
    p.add_argument("--native-id", required=True); p.add_argument("--out", required=True)
    p.add_argument("--allow-http", action="store_true", help=argparse.SUPPRESS); p.set_defaults(f=cmd_config)
    p = sp.add_parser("bundle"); p.add_argument("--www", required=True); p.add_argument("--version", required=True)
    p.add_argument("--native-id", required=True); p.add_argument("--out", required=True); p.set_defaults(f=cmd_bundle)
    p = sp.add_parser("sign"); p.add_argument("--payload", required=True); p.add_argument("--key", required=True)
    p.add_argument("--out", required=True); p.set_defaults(f=cmd_sign)
    p = sp.add_parser("verify"); p.add_argument("--manifest", required=True); p.add_argument("--pub", required=True)
    p.add_argument("--root", required=True); p.set_defaults(f=cmd_verify)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
