// תוסף כספית – עדכון אוטומטי (0.1.7, טהור: בלי chrome.*).
// המשימה המתוזמנת במחשב החנות (updater/caspit-update.ps1) מורידה את הגרסה האחרונה מ-GitHub, מחליפה את קבצי התיקייה,
// ובסוף כותבת upd.json: { at, ok, ver (הגרסה שבדיסק), err, fails (כישלונות ברצף) }.
// התוסף קורא את upd.json ואת manifest.json מהדיסק, ומרענן את עצמו (chrome.runtime.reload) רק כשהגרסה בדיסק חדשה יותר,
// הסקריפט סיים בהצלחה עם אותה גרסה, ואין ריצה באמצע. אותו upd.json נשלח לשרת ב-hello (התראות למנהל ותצוגה באפליקציה).
(function (root) {
'use strict';
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const ERR_RE = /[^\w .:/()-]/g;
function cmpVer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
// upd.json מהדיסק → אובייקט נקי, או null אם חסר / לא תקין
function cleanUpd(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  const at = Number(u.at);
  if (!Number.isFinite(at) || at <= 0 || typeof u.ok !== 'boolean') return null;
  const ver = typeof u.ver === 'string' && VER_RE.test(u.ver) ? u.ver : '';
  const fails = Number.isInteger(u.fails) && u.fails >= 0 ? Math.min(u.fails, 999) : 0;
  return { at: Math.round(at), ok: u.ok, ver, err: String(u.err == null ? '' : u.err).replace(ERR_RE, '').slice(0, 120), fails };
}
// לרענן? cur = הגרסה שנטענה, disk = הגרסה ב-manifest.json שבדיסק, upd = cleanUpd(...),
// last = { to, at } – ניסיון רענון קודם (שלא החזיר את הגרסה החדשה: לא מנסים שוב לאותה גרסה במשך שעה, כדי לא להיכנס ללולאה)
function wantReload(o) {
  const { cur, disk, upd, busy, last, now } = o || {};
  if (busy || !VER_RE.test(String(disk || '')) || !VER_RE.test(String(cur || ''))) return false;
  if (cmpVer(disk, cur) <= 0) return false;
  if (!upd || upd.ok !== true || upd.ver !== disk) return false; // הסקריפט עוד לא סיים להעתיק (או נכשל באמצע)
  if (last && last.to === disk && (now || 0) - (last.at || 0) < 3600e3) return false;
  return true;
}
const api = { cmpVer, cleanUpd, wantReload, VER_RE };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxUpd = api;
})(typeof self !== 'undefined' ? self : this);
