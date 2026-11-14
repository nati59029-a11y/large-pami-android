'use strict';
// סריקת חנות בתלת מימד – שלב 5ב (14.11.2026): הלוגיקה הטהורה של שמירת המפה, הגדרות סניף וטקסטורות, בלי Firestore
// (נבדקת ב-Node בלי אמולטור). המקור המחייב: חוזה הנתונים, סעיפים 1.1, 4.1, 4.3, 4.4, 4.17, 5.1–5.3.
//   cleanMap(input, ctx)       – בדיקת תקינות של המפה שנשלחה לפי טבלאות 4.3 (א', ב', ג'): סוגים, גבולות, מזהים, מצולעים.
//                                שדות לא מוכרים לא נשמרים (נרשמים ב-dropped). v, upd, by, delAt, delBy – השרת קובע, לא הלקוח.
//   mergeDel(old, map, who)    – כללי מחיקה (סל מחזור, ע5): שינוי del בפריט או במפה – מנהל בלבד; פריט שמור שחסר במפה החדשה
//                                = מחיקה: מנהל – נשמר עם del:1 (לא נעלם), עובד – שגיאה. delAt/delBy נקבעים בשרת.
//   finalCheck(map, old)       – אחרי המיזוג: גבולות רשימות, חדר חי אחד לפחות, גוף בחדר קיים, 2000 מקטעים, מזהה גוף שלא חוזר.
//   checkLock(old, baseV)      – נעילה מפני שמירה כפולה: baseV חייב להיות שווה ל-v הנוכחי (0 = מפה חדשה).
//   verId / prune              – מזהה גרסה (000012) ומה למחוק כדי להשאיר 30 גרסאות אחרונות.
//   branchIds / cleanBranch    – סניפים קיימים (org.branches, או main) וקלט s3SetBranch.
//   decodeTex / jpegSize / texPath / nextTexN – תמונת טקסטורה: JPEG בלבד, עד 600,000 בתים, כל צלע 256/512/1024.

const { sniff } = require('./scan');

const MAX_BYTES = 800000;     // גודל מסמך מפה מרבי (4.3)
const KEEP_VERS = 30;         // גרסאות לשמור (4.4)
const MAX_BAYS = 2000;
const MAXC = 10000, MIN_AREA = 10000; // 100 מטר; מ"ר אחד בסמ"ר
const TEX_MAX = 600000;       // טקסטורה (5.1)
const TEX_SIDES = [256, 512, 1024];
const DEF_BR = Object.freeze({ wh: false, cap: 500, on: true }); // בלי מסמך s3br (4.1)
const LISTS = ['rooms', 'walls', 'cols', 'doors', 'fx', 'syms', 'tx'];   // רכיבים עם id ו-del*
const LIMIT = { rooms: 20, walls: 100, cols: 100, doors: 40, fx: 400, syms: 40, tx: 60, uz: 50 };
const NAME = { rooms: 'חדר', walls: 'קיר', cols: 'עמוד', doors: 'דלת', fx: 'גוף', syms: 'סמל', tx: 'טקסטורה', uz: 'אזור לא ודאי' };
const RE = {
  br: /^[a-z0-9_]{2,20}$/,
  map: /^[sw]-[a-z0-9_]{2,20}$/,
  uid: /^[A-Za-z0-9_-]{6,128}$/,
  qid: /^[A-Za-z0-9-]{16,40}$/,
  rooms: /^r[0-9]{1,4}$/, walls: /^w[0-9]{1,4}$/, cols: /^c[0-9]{1,4}$/, doors: /^d[0-9]{1,4}$/,
  fx: /^f[0-9]{1,4}$/, syms: /^y[0-9]{1,4}$/, tx: /^t[0-9]{1,4}$/,
};
const FX_K = ['gon', 'wall', 'fridge', 'table', 'stand', 'bin'];
const TWO = ['gon', 'table', 'stand'];

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const inR = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const str = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '') : null);
function fail(code, msg, extra) { const e = new Error(msg || code); e.code = code; if (extra) Object.assign(e, extra); return e; }

// ---------- מצולע חדר (אותו אלגוריתם כמו S3G.polyValid באפליקציה) ----------
function polyArea(p) { let s = 0; const n = p.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; } return s / 2; }
function orient(ax, ay, bx, by, cx, cy) { const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); return v > 0 ? 1 : v < 0 ? -1 : 0; }
function onSeg(ax, ay, bx, by, cx, cy) { return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(ay, by) <= cy && cy <= Math.max(ay, by); }
function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy), o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSeg(ax, ay, bx, by, cx, cy)) || (o2 === 0 && onSeg(ax, ay, bx, by, dx, dy)) || (o3 === 0 && onSeg(cx, cy, dx, dy, ax, ay)) || (o4 === 0 && onSeg(cx, cy, dx, dy, bx, by));
}
// מבנה בלבד: 6–80 מספרים שלמים, זוגי, 0–10000
const polyShape = (p) => Array.isArray(p) && p.length >= 6 && p.length <= 80 && p.length % 2 === 0 && p.every((v) => inR(v, 0, MAXC));
// מצולע פשוט (בלי חיתוך עצמי), בלי פינות כפולות, שטח > 1 מ"ר. מחזיר '' או הודעה בעברית.
function polyErr(p) {
  if (!polyShape(p)) return 'הפינות לא תקינות (3 עד 40 פינות, בתוך 100 מטר)';
  const n = p.length / 2;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (p[2 * i] === p[2 * j] && p[2 * i + 1] === p[2 * j + 1]) return 'שתי פינות של החדר באותה נקודה';
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 1; j < n; j++) {
      const j2 = (j + 1) % n;
      if (j === i2 || j2 === i) continue;
      if (segsCross(p[2 * i], p[2 * i + 1], p[2 * i2], p[2 * i2 + 1], p[2 * j], p[2 * j + 1], p[2 * j2], p[2 * j2 + 1])) return 'קירות החדר חוצים זה את זה';
    }
  }
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    if (orient(p[2 * a], p[2 * a + 1], p[2 * i], p[2 * i + 1], p[2 * b], p[2 * b + 1]) === 0 && !onSeg(p[2 * a], p[2 * a + 1], p[2 * b], p[2 * b + 1], p[2 * i], p[2 * i + 1])) return 'קירות החדר חוצים זה את זה';
  }
  if (Math.abs(polyArea(p)) <= MIN_AREA) return 'החדר קטן מדי (צריך יותר ממטר מרובע)';
  return '';
}

// ---------- סכמת השדות (טבלאות 4.3) ----------
// [סוג, חובה, ...]: i = int בטווח; s = string באורך (אחרי הסרת תווי בקרה); b = bool; e = אחד מהרשימה; re = string לפי תבנית
const I = (a, b, req) => ({ t: 'i', a, b, req: req !== false });
const S = (a, b, req) => ({ t: 's', a, b, req: req !== false });
const B = (req) => ({ t: 'b', req: req !== false });
const E = (vals, req) => ({ t: 'e', vals, req: req !== false });
const X = (re, req) => ({ t: 're', re, req: req !== false });
const XY = { x: I(0, MAXC), y: I(0, MAXC) };
const SCHEMA = {
  rooms: { name: S(1, 30), p: { t: 'poly', req: true }, h: I(200, 600), tex: { t: 'tex', req: false } },
  walls: { p: { t: 'seg', req: true }, t: I(5, 50) },
  cols: Object.assign({}, XY, { w: I(10, 300), d: I(10, 300), rnd: B(false) }),
  doors: Object.assign({}, XY, { w: I(60, 500), a: I(0, 359), k: E(['ent', 'in', 'emg', 'wh']) }),
  syms: Object.assign({ k: E(['cash', 'ent', 'exit']) }, XY, { a: I(0, 359) }),
  tx: { path: { t: 'path', req: true }, w: E(TEX_SIDES), h: E(TEX_SIDES) },
  fx: Object.assign({ k: E(FX_K) }, XY, {
    w: I(30, 2000), d: I(20, 300), h: I(30, 300), a: I(0, 359), sides: E([1, 2]), bays: I(1, 30), lvl: I(1, 12),
    hi: B(), glass: B(false), room: X(RE.rooms), num: I(1, 999), name: S(0, 30, false),
  }),
  uz: Object.assign({}, XY, { w: I(50, MAXC), d: I(50, MAXC), txt: S(0, 80), ok: B() }),
};

// בודק שדה אחד. מחזיר [ערך נקי] או זורק הודעה
function field(spec, v, ctx) {
  switch (spec.t) {
    case 'i': if (!inR(v, spec.a, spec.b)) throw `מספר שלם בין ${spec.a} ל-${spec.b}`; return v;
    case 's': { const s = str(v); if (s === null || s.trim().length < spec.a || s.length > spec.b) throw spec.a ? `טקסט באורך ${spec.a} עד ${spec.b}` : `טקסט עד ${spec.b} תווים`; return s; }
    case 'b': if (typeof v !== 'boolean') throw 'כן/לא'; return v;
    case 'e': if (!spec.vals.includes(v)) throw 'ערך לא מוכר'; return v;
    case 're': if (typeof v !== 'string' || !spec.re.test(v)) throw 'מזהה לא תקין'; return v;
    case 'poly': if (!polyShape(v)) throw '3 עד 40 פינות, בתוך 100 מטר'; return v.slice();
    case 'seg': if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => inR(n, 0, MAXC))) throw 'קטע של 4 מספרים בתוך 100 מטר'; return v.slice();
    case 'tex': {
      if (!isObj(v)) throw 'לא תקין';
      const o = {};
      for (const k of Object.keys(v)) {
        if (!['w', 'f', 'c'].includes(k)) { ctx.drop('tex.' + k); continue; }
        if (typeof v[k] !== 'string' || !RE.tx.test(v[k])) throw 'מזהה טקסטורה לא תקין';
        o[k] = v[k];
      }
      return o;
    }
    case 'path': {
      const pre = `b/${ctx.bizId}/store3d/${ctx.br}/tex/${ctx.mapId}/`;
      if (typeof v !== 'string' || v.length > 300 || !v.startsWith(pre) || !/^t[0-9]{1,4}_[0-9]{1,2}\.jpg$/.test(v.slice(pre.length))) throw 'נתיב טקסטורה לא תקין';
      return v;
    }
    default: throw 'לא תקין';
  }
}

// פריט ברשימה: id (חוץ מ-uz), השדות לפי הסכמה, ו-del (0/1). delAt/delBy מהלקוח – לא נקראים.
function cleanItem(list, o, ctx, errs) {
  const label = NAME[list] + (o && typeof o.id === 'string' ? ' ' + o.id.slice(0, 8) : '');
  if (!isObj(o)) { errs.push(NAME[list] + ': לא תקין'); return null; }
  const out = {};
  if (list !== 'uz') {
    if (typeof o.id !== 'string' || !RE[list].test(o.id)) { errs.push(NAME[list] + ': מזהה לא תקין'); return null; }
    out.id = o.id;
  }
  const sc = SCHEMA[list];
  for (const k of Object.keys(sc)) {
    if (o[k] === undefined || o[k] === null) { if (sc[k].req) errs.push(`${label}: חסר השדה ${k}`); continue; }
    try { out[k] = field(sc[k], o[k], ctx); } catch (m) { errs.push(`${label}: ${k} – ${typeof m === 'string' ? m : 'לא תקין'}`); }
  }
  if (list !== 'uz' && o.del !== undefined) {
    if (o.del === 1) out.del = 1;
    else if (o.del !== 0) errs.push(`${label}: del – 0 או 1`);
  }
  for (const k of Object.keys(o)) if (!(k in sc) && !['id', 'del', 'delAt', 'delBy'].includes(k)) ctx.drop(list + '.' + k);
  if (list === 'fx' && out.sides === 2 && out.k && !TWO.includes(out.k)) errs.push(`${label}: לסוג הזה יש רק צד אחד`);
  return out;
}

// הקלט של s3SaveMap. ctx = { bizId, mapId }. מחזיר { map, dropped } או זורק fail('bad-map', הודעה, { errs }).
const TOP_SERVER = ['v', 'upd', 'by', 'delAt', 'delBy']; // השרת קובע – לא נקראים מהלקוח
function cleanMap(input, c) {
  if (!isObj(input)) throw fail('bad-map', 'המפה לא תקינה', { errs: ['המפה חסרה'] });
  const kind = c.mapId.charAt(0), br = c.mapId.slice(2);
  const dropped = new Set();
  const ctx = { bizId: c.bizId, mapId: c.mapId, br, drop: (k) => dropped.add(k) };
  const errs = [];
  const m = { br, kind };
  if (input.br !== br) errs.push('הסניף במפה לא מתאים למזהה המפה');
  if (input.kind !== kind) errs.push('סוג המפה (חנות/מחסן) לא מתאים למזהה המפה');
  const top = { name: S(1, 40), grid: E([25, 50, 100]), numDir: E(['rtl', 'ltr']), src: E(['manual', 'draft']), seq: I(0, 9999, false) };
  for (const k of Object.keys(top)) {
    if (input[k] === undefined || input[k] === null) { if (top[k].req) errs.push('חסר השדה ' + k); continue; }
    try { m[k] = field(top[k], input[k], ctx); } catch (e) { errs.push(k + ' – ' + (typeof e === 'string' ? e : 'לא תקין')); }
  }
  if (input.ent !== undefined && input.ent !== null && input.ent !== '') {
    if (typeof input.ent !== 'string' || !RE.doors.test(input.ent)) errs.push('ent – מזהה דלת לא תקין');
    else m.ent = input.ent;
  }
  if (input.del !== undefined) { if (input.del === 1) m.del = 1; else if (input.del !== 0) errs.push('del – 0 או 1'); }
  for (const list of LISTS.concat(['uz'])) {
    const v = input[list];
    if (v === undefined || v === null) { if (list !== 'tx' && list !== 'uz') m[list] = []; continue; }
    if (!Array.isArray(v)) { errs.push(NAME[list] + ': צריכה להיות רשימה'); continue; }
    if (v.length > LIMIT[list] * 2) { errs.push(`יותר מדי ${NAME[list]} (עד ${LIMIT[list]})`); continue; }
    const out = [], seen = new Set();
    for (const o of v) {
      const x = cleanItem(list, o, ctx, errs);
      if (!x) continue;
      if (x.id) { if (seen.has(x.id)) { errs.push(`${NAME[list]} ${x.id}: מזהה כפול`); continue; } seen.add(x.id); }
      out.push(x);
    }
    m[list] = out;
  }
  for (const k of Object.keys(input)) if (!(k in top) && !['br', 'kind', 'ent', 'del'].concat(LISTS, ['uz'], TOP_SERVER).includes(k)) dropped.add(k);
  if (errs.length) throw fail('bad-map', 'המפה לא תקינה: ' + errs.slice(0, 3).join(' · ') + (errs.length > 3 ? ` ועוד ${errs.length - 3}` : ''), { errs: errs.slice(0, 20) });
  return { map: m, dropped: [...dropped].slice(0, 20) };
}

// ---------- מחיקה (סל מחזור) ----------
// who = { mgr, uid, now }. old = המפה השמורה (או null). מחזיר מפה חדשה עם del/delAt/delBy שהשרת קבע.
// זורק fail('del-mgr') כשעובד (s3m) מוחק, משחזר או מסיר פריט שמור.
const DEL_MSG = 'מחיקה ושחזור של פריטים במפה – למנהל בלבד';
function stamp(target, prev, who) {
  if (prev && prev.del === 1 && Number.isInteger(prev.delAt) && typeof prev.delBy === 'string') { target.del = 1; target.delAt = prev.delAt; target.delBy = prev.delBy; }
  else { target.del = 1; target.delAt = who.now; target.delBy = who.uid; }
}
function unstamp(o) { delete o.del; delete o.delAt; delete o.delBy; }
function mergeDel(old, map, who) {
  const m = Object.assign({}, map);
  const o0 = isObj(old) ? old : null;
  const was = !!(o0 && o0.del === 1), now = map.del === 1;
  if (was !== now && !who.mgr) throw fail('del-mgr', 'מחיקה ושחזור של מפה – למנהל בלבד');
  if (now) stamp(m, o0, who); else unstamp(m);
  for (const list of LISTS) {
    const prev = new Map((o0 && Array.isArray(o0[list]) ? o0[list] : []).filter((x) => isObj(x) && typeof x.id === 'string').map((x) => [x.id, x]));
    const out = [];
    for (const it0 of Array.isArray(map[list]) ? map[list] : []) {
      const it = Object.assign({}, it0), p = prev.get(it.id);
      const del = it.del === 1, pdel = !!(p && p.del === 1);
      if (del !== pdel && !who.mgr) throw fail('del-mgr', DEL_MSG);
      if (del) stamp(it, p, who); else unstamp(it);
      out.push(it);
      prev.delete(it.id);
    }
    // פריט שמור שלא נשלח = מחיקה. מנהל: נשאר ברשימה כמחוק (לא נעלם, המזהה לא חוזר לשימוש). עובד: שגיאה.
    for (const p of prev.values()) {
      if (!who.mgr) throw fail('del-mgr', 'אי אפשר להסיר פריט שכבר נשמר במפה. ' + DEL_MSG);
      const it = Object.assign({}, p); stamp(it, p, who); out.push(it);
    }
    if (out.length || list !== 'tx' || Array.isArray(map.tx)) m[list] = out;
  }
  return m;
}

// ---------- בדיקות אחרי המיזוג ----------
const live = (a) => (Array.isArray(a) ? a : []).filter((o) => isObj(o) && o.del !== 1);
const idNum = (id) => parseInt(String(id).slice(1), 10) || 0;
function bayCount(map) { return live(map.fx).reduce((s, f) => s + (f.sides === 2 ? 2 : 1) * (inR(f.bays, 1, 30) ? f.bays : 0), 0); }
// מחזיר את המפה עם seq ו-ent מעודכנים. זורק fail('bad-map' / 'id-reuse').
function finalCheck(map, old) {
  const errs = [];
  for (const list of LISTS.concat(['uz'])) if (Array.isArray(map[list]) && map[list].length > LIMIT[list]) errs.push(`יותר מ-${LIMIT[list]} ${NAME[list]} במפה`);
  const rooms = live(map.rooms);
  if (!rooms.length) errs.push('במפה אין אף חדר');
  for (const r of rooms) { const e = polyErr(r.p); if (e) errs.push(`חדר "${r.name || r.id}": ${e}`); }
  const rid = new Set(rooms.map((r) => r.id));
  for (const f of live(map.fx)) if (!rid.has(f.room)) errs.push(`גוף ${f.num || f.id}: החדר שלו לא קיים`);
  if (bayCount(map) > MAX_BAYS) errs.push(`יותר מ-${MAX_BAYS} מקטעים במפה`);
  if (errs.length) throw fail('bad-map', 'המפה לא תקינה: ' + errs.slice(0, 3).join(' · ') + (errs.length > 3 ? ` ועוד ${errs.length - 3}` : ''), { errs: errs.slice(0, 20) });
  // מזהה גוף לא חוזר לשימוש (1.1): גוף חדש חייב מספר גדול מ-seq השמור
  const o0 = isObj(old) ? old : null;
  const oseq = o0 && inR(o0.seq, 0, 9999) ? o0.seq : 0;
  const had = new Set((o0 && Array.isArray(o0.fx) ? o0.fx : []).map((f) => f && f.id));
  for (const f of map.fx) if (!had.has(f.id) && idNum(f.id) <= oseq) throw fail('id-reuse', 'מזהה הגוף ' + f.id + ' כבר היה בשימוש במפה. טענו את המפה מחדש ונסו שוב.');
  const out = Object.assign({}, map);
  out.seq = Math.max(oseq, inR(map.seq, 0, 9999) ? map.seq : 0, ...map.fx.map((f) => idNum(f.id)));
  if (out.seq > 9999) throw fail('bad-map', 'נגמרו המזהים במפה');
  // הכניסה הראשית חייבת להיות דלת קיימת; אחרת – לא נשמרת
  if (out.ent && !(map.doors || []).some((d) => d.id === out.ent)) delete out.ent;
  return out;
}

// ---------- נעילה, גודל, גרסאות ----------
// old = המפה השמורה (או null). baseV מהלקוח: מפה חדשה = 0; אחרת חייב להיות v הנוכחי.
const STALE = 'המפה השתנתה בטלפון אחר. טענו מחדש.';
function checkLock(old, baseV) {
  if (!Number.isInteger(baseV) || baseV < 0) throw fail('bad-base', 'מספר הגרסה שנשלח לא תקין');
  const cur = isObj(old) && Number.isInteger(old.v) ? old.v : 0;
  if (baseV !== cur) throw fail('stale', STALE);
  if (cur >= 1000000) throw fail('bad-map', 'המפה הגיעה למספר הגרסאות המרבי');
  return cur + 1;
}
const bytesOf = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
const verId = (v) => String(v).padStart(6, '0');
// עותק הגרסה הקודמת לאוסף ver: כל שדות המפה בלי del* של המפה עצמה (4.4)
function verDoc(old, who, why) {
  const m = Object.assign({}, old); delete m.del; delete m.delAt; delete m.delBy;
  const d = { m, v: old.v, at: who.now, by: who.uid };
  const w = str(why);
  if (w) d.why = w.trim().slice(0, 80);
  return d;
}
// מזהי הגרסאות (6 ספרות) למחיקה כך שיישארו keep האחרונות
function prune(ids, keep) {
  const k = Number.isInteger(keep) ? keep : KEEP_VERS;
  const L = ids.filter((x) => /^[0-9]{6}$/.test(x)).sort();
  return L.length > k ? L.slice(0, L.length - k) : [];
}

// ---------- סניפים (s3SetBranch) ----------
// מזהי הסניפים הקיימים של העסק (b/{bizId}.org.branches); עסק בלי סניפים = main
function branchIds(org) {
  const L = isObj(org) && Array.isArray(org.branches) ? org.branches.filter((b) => isObj(b) && typeof b.id === 'string' && RE.br.test(b.id)).map((b) => b.id) : [];
  return L.length ? L : ['main'];
}
function cleanBranch(input) {
  const i = isObj(input) ? input : {};
  if (typeof i.brId !== 'string' || !RE.br.test(i.brId)) throw fail('bad-br', 'מזהה הסניף לא תקין');
  if (typeof i.wh !== 'boolean' || typeof i.on !== 'boolean') throw fail('bad-input', 'חסרים מחסן כן/לא או פעיל כן/לא');
  if (!inR(i.cap, 0, 100000)) throw fail('bad-cap', 'המכסה החודשית צריכה להיות מספר שלם בין 0 ל-100,000');
  return { brId: i.brId, wh: i.wh, cap: i.cap, on: i.on };
}
const brCfg = (d) => ({ wh: isObj(d) && d.wh === true, cap: isObj(d) && inR(d.cap, 0, 100000) ? d.cap : DEF_BR.cap, on: !(isObj(d) && d.on === false) });

// ---------- טקסטורה (s3PutTex) ----------
// מידות JPEG מתוך כותרת SOF. מחזיר { w, h } או null.
function jpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return null;
    let mk = buf[i + 1];
    while (mk === 0xff && i + 2 < buf.length) { i++; mk = buf[i + 1]; }
    if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
    if (mk === 0xd9 || mk === 0xda) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) {
      if (i + 8 >= buf.length) return null;
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}
// img = base64 (אפשר עם התחילית data:image/jpeg;base64,). מחזיר { buf, w, h } או זורק.
function decodeTex(img) {
  if (typeof img !== 'string' || !img) throw fail('bad-img', 'חסרה תמונה');
  const b64 = img.replace(/^data:image\/jpeg;base64,/, '');
  if (b64.length > Math.ceil(TEX_MAX / 3) * 4) throw fail('too-big', 'התמונה גדולה מדי (עד 600KB)');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) throw fail('bad-img', 'התמונה לא בפורמט base64');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw fail('bad-img', 'התמונה ריקה');
  if (buf.length > TEX_MAX) throw fail('too-big', 'התמונה גדולה מדי (עד 600KB)');
  if (sniff(buf) !== 'image/jpeg') throw fail('bad-type', 'מותרת רק תמונת JPEG');
  const sz = jpegSize(buf);
  if (!sz) throw fail('bad-img', 'לא הצלחנו לקרוא את מידות התמונה');
  if (!TEX_SIDES.includes(sz.w) || !TEX_SIDES.includes(sz.h)) throw fail('bad-size', 'כל צלע של טקסטורה צריכה להיות 256, 512 או 1024 פיקסלים');
  return { buf, w: sz.w, h: sz.h };
}
const texDir = (bizId, br, mapId) => `b/${bizId}/store3d/${br}/tex/${mapId}/`;
const texPath = (bizId, br, mapId, texId, n) => texDir(bizId, br, mapId) + texId + '_' + (n || 1) + '.jpg';
// המספר הבא לטקסטורה: גדול מכל מזהה שכבר קיים בקבצים (names – שמות מלאים) או ברשימת tx של המפה
function nextTexN(names, mapTx) {
  let n = 0;
  for (const p of names || []) { const m = /\/t([0-9]{1,4})_[0-9]{1,2}\.jpg$/.exec(String(p)); if (m) n = Math.max(n, +m[1]); }
  for (const t of Array.isArray(mapTx) ? mapTx : []) if (t && typeof t.id === 'string' && RE.tx.test(t.id)) n = Math.max(n, idNum(t.id));
  return n + 1;
}

module.exports = {
  MAX_BYTES, KEEP_VERS, MAX_BAYS, TEX_MAX, TEX_SIDES, DEF_BR, LISTS, LIMIT, RE, STALE,
  polyErr, cleanMap, mergeDel, finalCheck, checkLock, bytesOf, verId, verDoc, prune, bayCount,
  branchIds, cleanBranch, brCfg, jpegSize, decodeTex, texDir, texPath, nextTexN, fail,
};
