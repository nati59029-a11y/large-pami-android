#!/usr/bin/env node
// תוסף כספית: בודק שהעותקים בתוסף זהים לאפליקציה.
//   caspit-extension/src/lib/caspit-core.js  ==  app-source/www/caspit-core.js  (בייט-בייט)
//   caspit-extension/src/lib/xlsx.full.min.js == אותה גרסה של xlsx שהאפליקציה נועלת ב-app-source/package.json,
//     ואם xlsx מותקן (node_modules/xlsx, או --xlsx <path>) – זהה בייט-בייט ל-dist/xlsx.full.min.js שלו (כמו שהאפליקציה מעתיקה ב-prepare.js).
//   --write: מעתיק את caspit-core.js מהאפליקציה לתוסף (ואת xlsx אם נמצא), במקום רק לבדוק.
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const W = process.argv.includes('--write');
const xi = process.argv.indexOf('--xlsx');
const bad = [];

const coreApp = path.join(R, 'app-source/www/caspit-core.js'), coreExt = path.join(R, 'caspit-extension/src/lib/caspit-core.js');
if (W) fs.copyFileSync(coreApp, coreExt);
if (!fs.readFileSync(coreApp).equals(fs.readFileSync(coreExt))) bad.push('caspit-core.js differs from app-source/www/caspit-core.js (run: node scripts/sync-ext-core.js --write)');

const want = JSON.parse(fs.readFileSync(path.join(R, 'app-source/package.json'), 'utf8')).dependencies.xlsx;
const xExt = path.join(R, 'caspit-extension/src/lib/xlsx.full.min.js');
const cands = [xi > 0 ? process.argv[xi + 1] : null, path.join(R, 'node_modules/xlsx'), path.join(R, 'app-source/node_modules/xlsx'), path.join(R, 'caspit-extension/node_modules/xlsx')].filter(Boolean);
const found = cands.find((p) => fs.existsSync(path.join(p, 'package.json')));
if (found) {
  const v = JSON.parse(fs.readFileSync(path.join(found, 'package.json'), 'utf8')).version;
  if (v !== want) bad.push(`installed xlsx ${v} at ${found} != app pin ${want}`);
  else {
    const src = path.join(found, 'dist/xlsx.full.min.js');
    if (W) fs.copyFileSync(src, xExt);
    if (!fs.readFileSync(src).equals(fs.readFileSync(xExt))) bad.push(`xlsx.full.min.js differs from xlsx@${want}`);
  }
}
const mv = /make_xlsx_lib\(e\)\{e\.version="(\d+\.\d+\.\d+)"/.exec(fs.readFileSync(xExt, 'utf8'));
const extVer = mv ? mv[1] : null;
if (!extVer) bad.push('cannot read the version of caspit-extension/src/lib/xlsx.full.min.js');
if (extVer && extVer !== want) bad.push(`extension xlsx version ${extVer} != app pin ${want}`);

if (bad.length) { console.error('sync-ext-core: FAIL\n  ' + bad.join('\n  ')); process.exit(1); }
console.log(`sync-ext-core: OK (caspit-core identical; xlsx ${want}${found ? ' identical to ' + path.relative(R, found) : ' version checked'})`);
