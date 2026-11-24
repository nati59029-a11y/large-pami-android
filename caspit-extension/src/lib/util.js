// תוסף כספית – עזרים: גיבוב sha256, base64, קריאת CSV/Excel לשורות, מזהה ריצה, מגבלות בטיחות.
(function (root) {
'use strict';
const LIMITS = { price: 500, newMax: 100000 }; // מגבלות בכל ריצה – גם בתוסף, לא רק בשרת. 0.1.20: פריטים חדשים – ללא הגבלה (100000; בפועל לפי האפליקציה, limits.newMax)
const subtle = () => (root.crypto && root.crypto.subtle) || (typeof require === 'function' ? require('crypto').webcrypto.subtle : null);
async function sha256(data) {
  const u = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const h = new Uint8Array(await subtle().digest('SHA-256', u));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}
function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function rid(prefix) {
  const a = new Uint8Array(12);
  (root.crypto || require('crypto').webcrypto).getRandomValues(a);
  return (prefix || 'cb') + Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 22);
}
// CSV → שורות (מירכאות כפולות, פסיק או נקודה-פסיק, CRLF)
function parseCsv(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// בייטים של קובץ מכספית → שורות. Excel (xlsx/xls/HTML) דרך XLSX, אחרת CSV (UTF-8 או windows-1255 דרך CaspitCore.decode)
function readRows(u8, name, X, C) {
  const head = Array.from(u8.subarray(0, 8));
  const zip = head[0] === 0x50 && head[1] === 0x4b, ole = head[0] === 0xd0 && head[1] === 0xcf;
  const htmlish = /^\s*</.test(String.fromCharCode.apply(null, Array.from(u8.subarray(0, 64))));
  if (zip || ole || /\.xlsx?$/i.test(name || '') || htmlish) {
    if (!X) throw Object.assign(new Error('ספריית האקסל לא נטענה'), { code: 'parse' });
    const wb = X.read(u8, { type: 'array', cellDates: false });
    return X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  }
  return parseCsv(C ? C.decode(u8) : new TextDecoder().decode(u8));
}
// ---------- היכרות: בחירת קישורי תפריט (0.1.12, תיקוני בודק) ----------
// links מ-menuIn: [{ t, h, u?, bad? }] – u = כותרת התפריט שתחת המעבר עליה הקישור נחשף; bad = בטקסט מילה אסורה (DENY_HE/DENY_EN), "הגדר" או "ייבוא".
// find: רק התאמה מדויקת של הטקסט, ולא קישור bad (בלי התאמה חלקית: "ייבוא מבצעים" / "הוספת מבצעים" לא ייבחרו במקום "מבצעים")
function menuPick(links, find) {
  const f = String(find || '').trim();
  if (!f) return null;
  return (links || []).find((l) => l && !l.bad && l.t === f) || null;
}
// findAll: רק קישורים שנחשפו תחת אחת מכותרות התפריט (under), לא bad, שהטקסט כולל אחד מביטויי הדוח (בלי רישיות), hash תקין ולא מסך מוכר; עד max
function menuAll(links, words, under, known, max, hashRe) {
  const W = (words || []).map((w) => String(w).toLowerCase()).filter(Boolean), U = new Set((under || []).map(String)), K = new Set(known || []), out = [];
  for (const l of links || []) {
    if (out.length >= (max || 8)) break;
    if (!l || l.bad || !U.has(l.u) || K.has(l.h) || (hashRe && !hashRe.test(l.h))) continue;
    if (!W.some((w) => String(l.t).toLowerCase().includes(w))) continue;
    K.add(l.h); out.push(l);
  }
  return out;
}
const api = { LIMITS, sha256, toB64, fromB64, rid, parseCsv, readRows, menuPick, menuAll };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxUtil = api;
})(typeof self !== 'undefined' ? self : this);
