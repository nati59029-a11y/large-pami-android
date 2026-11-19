// עדכון אוטומטי (0.1.7): ההחלטה מתי לרענן, ניקוי upd.json, וקבצי הסקריפט ב-Windows (בדיקה סטטית – PowerShell לא רץ כאן)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const UP = require('../src/lib/upd.js');

const ok = (ver) => ({ at: 1, ok: true, ver, err: '', fails: 0 });
test('wantReload: רק גרסה חדשה בדיסק שהסקריפט סיים להעתיק, לא בזמן ריצה, ולא שוב תוך שעה', () => {
  const base = { cur: '0.1.7', disk: '0.1.8', upd: ok('0.1.8'), busy: false, last: null, now: 10e6 };
  assert.equal(UP.wantReload(base), true);
  assert.equal(UP.wantReload({ ...base, busy: true }), false, 'ריצה באמצע');
  assert.equal(UP.wantReload({ ...base, disk: '0.1.7' }), false, 'אותה גרסה');
  assert.equal(UP.wantReload({ ...base, disk: '0.1.6' }), false, 'גרסה ישנה יותר בדיסק');
  assert.equal(UP.wantReload({ ...base, upd: ok('0.1.7') }), false, 'הסקריפט עוד לא סיים (upd.json מהגרסה הקודמת)');
  assert.equal(UP.wantReload({ ...base, upd: { ...ok('0.1.8'), ok: false } }), false, 'הסקריפט נכשל');
  assert.equal(UP.wantReload({ ...base, upd: null }), false, 'אין upd.json');
  // הסקריפט באמצע העתקה של גרסה נוספת (upd.json "copying", ver ריק) בזמן שגרסה קודמת שהותקנה עוד לא נטענה → לא מרעננים
  assert.equal(UP.wantReload({ ...base, upd: { at: 2, ok: false, ver: '', err: 'copying', fails: 0 } }), false, 'באמצע העתקה');
  assert.equal(UP.wantReload({ ...base, disk: 'x' }), false);
  assert.equal(UP.wantReload({ ...base, last: { to: '0.1.8', at: 10e6 - 60e3 } }), false, 'כבר ניסינו לפני דקה');
  assert.equal(UP.wantReload({ ...base, last: { to: '0.1.8', at: 10e6 - 2 * 3600e3 } }), true, 'אחרי שעה – שוב');
  assert.equal(UP.wantReload({ ...base, last: { to: '0.1.9', at: 10e6 } }), true, 'גרסה אחרת');
  assert.equal(UP.cmpVer('0.1.10', '0.1.9') > 0, true);
});

test('cleanUpd: שדות לא תקינים נזרקים, שגיאה מסוננת וקצרה', () => {
  assert.equal(UP.cleanUpd(null), null);
  assert.equal(UP.cleanUpd([]), null);
  assert.equal(UP.cleanUpd({ at: 'x', ok: true }), null);
  assert.equal(UP.cleanUpd({ at: 5, ok: 'yes' }), null);
  assert.deepEqual(UP.cleanUpd({ at: 5.4, ok: false, ver: '1.2', err: 'bad <b>"hash"</b>' + 'x'.repeat(200), fails: -3, extra: 1 }),
    { at: 5, ok: false, ver: '', err: ('bad bhash/b' + 'x'.repeat(200)).slice(0, 120), fails: 0 });
  assert.equal(UP.cleanUpd({ at: 1, ok: true, ver: '0.1.7', fails: 5000 }).fails, 999);
});

test('קבצי העדכון ב-Windows: נכללים בבנייה, מצביעים רק על המאגר הזה, ובודקים hash ומזהה תוסף', () => {
  const src = path.join(__dirname, '..', 'src');
  const up = fs.readFileSync(path.join(src, 'updater', 'caspit-update.ps1'), 'utf8');
  assert.ok(!/[^\x00-\x7f]/.test(up), 'caspit-update.ps1 – ASCII בלבד (Windows PowerShell 5.1 בלי BOM)');
  for (const x of ['Get-FileHash', "-ne $want", '[string]$nm.key -ne [string]$cur.key', '/XF manifest.json upd.json', 'Copy-Item -LiteralPath (Join-Path $x \'manifest.json\')', 'caspit-ext-v', "Write-Upd $false"]) assert.ok(up.includes(x), x);
  assert.ok(up.indexOf('robocopy') < up.indexOf("Copy-Item -LiteralPath (Join-Path $x 'manifest.json')"), 'manifest.json אחרון');
  // בודק עצמאי סבב 1: לעולם לא מוחקים בתיקייה (בלי /MIR), לא עוקבים אחרי קיצורי תיקיות, מסרבים לתיקייה כללית; "מעתיק" לפני ההעתקה
  const code = up.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n'); // בלי הערות
  assert.ok(!/\/MIR|\/PURGE|Remove-Item[^\n]*\$Target/i.test(code), 'בלי מחיקה בתיקיית התוסף');
  assert.ok(up.includes(' /XJ ') && up.includes("throw 'unsafe-folder'") && up.includes("GetFolderPath('MyDocuments')"));
  const cp = up.indexOf("Write-Upd $false '' 'copying' $true");
  assert.ok(cp > 0 && cp < up.indexOf('$null = robocopy'), 'upd.json "copying" לפני ההעתקה');
  assert.ok(up.lastIndexOf('Write-Upd $true $verS') > up.indexOf('Copy-Item -LiteralPath (Join-Path $x'), 'upd.json אחרי ההעתקה');
  const urls = up.match(/https:\/\/[^\s'"]+/g);
  assert.ok(urls.every((u) => /^https:\/\/(api\.)?github\.com\/(repos\/)?nati59029-a11y\/large-pami-android\//.test(u) || u.startsWith('https://api.github.com/repos/$Repo') || u.startsWith('https://github\\.com/')), urls.join(' '));
  assert.ok(!/Invoke-Expression|iex\s|DownloadString|Start-Process/.test(up), 'בלי הרצת קוד שהורד');
  const ins = fs.readFileSync(path.join(src, 'updater', 'install.ps1'));
  assert.deepEqual([...ins.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'install.ps1 – UTF-8 עם BOM (הודעות בעברית)');
  const it = ins.toString('utf8');
  assert.ok(it.includes('$deny -contains $full'), 'ההתקנה מסרבת לתיקייה כללית');
  for (const x of ['-RunLevel Limited', '-StartWhenAvailable', "'02:30'", 'caspit-update.ps1', 'LargePami Caspit Update']) assert.ok(it.includes(x), x);
  const cmd = fs.readFileSync(path.join(src, 'install-auto-update.cmd'), 'utf8');
  assert.ok(!/[^\x00-\x7f]/.test(cmd) && cmd.includes('%~dp0updater\\install.ps1') && cmd.includes('\r\n'));
});
