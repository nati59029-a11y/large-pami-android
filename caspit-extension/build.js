#!/usr/bin/env node
// בניית התוסף: מעתיק את src/ ל-dist/<backend>/ וממלא את כתובת השרת (prod / test / local לבדיקות).
//   node caspit-extension/build.js --backend prod|test   [--zip]
//   node caspit-extension/build.js --backend local --api http://127.0.0.1:8787/cxBot --out <dir>
// בדיקות בטיחות לפני בנייה: הרשאות מינימליות בלבד, אין <all_urls>, אין eval / new Function, וקבצי הליבה זהים לאפליקציה.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const URLS = {
  prod: 'https://europe-west1-largpeami.cloudfunctions.net/cxBot',
  test: 'https://europe-west1-largpeami-test-f4691.cloudfunctions.net/cxBot',
};
const PERMS = ['alarms', 'storage', 'scripting', 'idle'];
const SRC = path.join(__dirname, 'src');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
const has = (name) => process.argv.includes('--' + name);
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])); }

function check() {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const bad = [];
  if (JSON.stringify(m.permissions.slice().sort()) !== JSON.stringify(PERMS.slice().sort())) bad.push('permissions: ' + m.permissions.join(','));
  const s = JSON.stringify(m);
  for (const x of ['<all_urls>', 'externally_connectable', 'downloads', 'cookies', 'webRequest', 'unsafe-eval', 'http://*/*', 'https://*/*']) if (s.includes(x)) bad.push('manifest has ' + x);
  for (const f of walk(SRC).filter((f) => f.endsWith('.js'))) {
    const t = fs.readFileSync(f, 'utf8');
    if (/\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(\s*['"`]https?:/.test(t)) bad.push('eval/remote code in ' + path.relative(SRC, f));
  }
  if (bad.length) { console.error('SAFETY CHECK FAILED:\n  ' + bad.join('\n  ')); process.exit(1); }
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sync-ext-core.js')], { stdio: 'inherit' });
}

function build() {
  const backend = arg('backend', 'prod');
  const api = arg('api', URLS[backend]);
  if (!api) { console.error('unknown backend ' + backend + ' (prod|test, or --api)'); process.exit(1); }
  if (backend !== 'local' && !/^https:\/\//.test(api)) { console.error('api must be https'); process.exit(1); }
  const origin = new URL(api).origin.replace(/:\d+$/, ''); // match pattern בלי פורט
  const out = arg('out', path.join(__dirname, 'dist', backend));
  check();
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(SRC, out, { recursive: true });
  const mf = path.join(out, 'manifest.json');
  fs.writeFileSync(mf, fs.readFileSync(mf, 'utf8').replace('__CXBOT_ORIGIN__', origin));
  const cf = path.join(out, 'config.js');
  fs.writeFileSync(cf, fs.readFileSync(cf, 'utf8').replace('__CXBOT_URL__', api).replace('__BACKEND__', backend));
  const ver = JSON.parse(fs.readFileSync(mf, 'utf8')).version;
  console.log(`built ${out} (backend=${backend}, api=${api}, version=${ver})`);
  if (has('zip')) {
    const zip = path.join(__dirname, 'dist', `caspit-extension-${ver}${backend === 'prod' ? '' : '-' + backend}.zip`);
    fs.rmSync(zip, { force: true });
    execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out, stdio: 'inherit' });
    console.log('zip ' + zip);
  }
}
if (require.main === module) { if (has('check')) check(); else build(); }
module.exports = { URLS, PERMS };
