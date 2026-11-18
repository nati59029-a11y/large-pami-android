'use strict';
// התראות טלפון על משימות (18.11.2026, החלטות בעל העסק).
//   tkPush  – טריגר על כתיבה ל-tasks/{id} (לארג' פעמי במצב legacy, בשורש).
//   tkPushB – טריגר על כתיבה ל-b/{bizId}/tasks/{id}.
//   ptkPush / ptkPushB – טריגר על יצירת משימה פרטית (ptk/{id}, b/{bizId}/ptk/{id}).
// מי מקבל:
//   עובד – משימה חדשה שנשלחה אליו (role 'a', לא קבועה), משימה שהוחזרה אליו, תגובה של מנהל.
//   כל המנהלים – משימה שעובד יצר (גם פרטית), ממתינה לאישור, בוצעה על ידי עובד, תגובה של עובד.
// בלי התראה: משימה קבועה (rc), משימה ישנה בלי to שלא נתפסה, תפיסה/העברה, "נקרא", סימון רשימה, אישור מנהל (wait → done).
// לעולם לא למי שעשה את הפעולה; עובד – רק פעיל (staff/{uid}.active == true); מנהלים – מ-admins.
// תנאים לעסק: עסק קיים ופעיל, תוספת tasks מופעלת (b/). בשורש – רק כשלארג' פעמי במצב legacy.
// שבת וחג: בחלון השקט (tk-time.js, quietAt) לא נשלח כלום, וגם לא נשלח אחר כך.
// ההתראה: בלי כפתורים (fcmPayload בלי act), private במסך נעול, data: { k: 'tk', id }, tag tkn_<id> (פרטית: ptk_<id>).
// הקשה על ההתראה פותחת את המשימות כמו היום (אין שינוי באפליקציה).
// אזור: europe-west1 בלבד, בלי ניסיון חוזר (כדי לא לשלוח פעמיים). שגיאה נרשמת ביומן ולא נזרקת.
const { onDocumentWrittenWithAuthContext, onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { NEW_REGION } = require('./lib/region');
const T = require('./lib/tenant');
const TK = require('./lib/tk-time');

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TO = 30; // כמו מגבלת to בחוקים
const BODY = 400;

const clean = (v) => String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isId = (u) => typeof u === 'string' && ID_RE.test(u);
const ids = (a) => (Array.isArray(a) ? a.filter(isId) : []);

// האם הכתיבה בכלל מעניינת (בלי קריאה מהמסד): יצירה, שינוי st, או cAt שגדל. מחיקה – לא
function trig(b, a) {
  if (!a || typeof a !== 'object') return false;
  if (!b || typeof b !== 'object') return !a.rc;
  return a.st !== b.st || num(a.cAt) > num(b.cAt);
}

// מי מטפל במשימה: ow, אחרת to, אחרת היוצר במשימת עובד (role 'w')
function handlerOf(a) {
  if (isId(a.ow)) return [a.ow];
  const to = ids(a.to);
  if (to.length) return to;
  return a.role === 'w' && isId(a.owner) ? [a.owner] : [];
}

// הליבה הטהורה. b/a = המשימה לפני/אחרי (null = לא קיימת). actor = מי שכתב (authId של משתמש באפליקציה, '' = שרת/לא ידוע).
// adm = Set של מזהי המנהלים. מחזיר { k, to: [uid] | 'adm', actor } או null
function evOf(b, a, actor, adm) {
  if (!trig(b, a)) return null;
  const A = adm || new Set();
  const who = isId(actor) ? actor : '';
  if (!b || typeof b !== 'object') {
    if (a.rc) return null;
    if (a.role === 'a') { const to = ids(a.to).filter((u) => u !== a.owner); return to.length ? { k: 'new', to, actor: a.owner } : null; }
    if (a.role === 'w') return { k: 'newW', to: 'adm', actor: a.owner };
    return null;
  }
  if (a.st !== b.st) {
    const by = who || (isId(a.ow) ? a.ow : ''); // כתיבת שרת (pushAct) – המטפל
    if (b.st === 'open' && a.st === 'wait') return { k: 'wait', to: 'adm', actor: by };
    if (b.st === 'open' && a.st === 'done') return A.has(by) ? null : { k: 'done', to: 'adm', actor: by };
    if ((b.st === 'wait' || b.st === 'done') && a.st === 'open') return { k: 'back', to: handlerOf(a), actor: who || (isId(a.cBy) ? a.cBy : '') };
  }
  if (num(a.cAt) > num(b.cAt) && isId(a.cBy)) return A.has(a.cBy) ? { k: 'cm', to: handlerOf(a), actor: a.cBy, mgr: true } : { k: 'cm', to: 'adm', actor: a.cBy };
  return null;
}

// הטקסט. ev = תוצאת evOf, a = המשימה, name = שם מי שעשה (רק להודעות למנהלים)
function msgOf(ev, a, name) {
  const txt = cut(clean(a.txt), BODY);
  const nm = cut(clean(name), 40) || 'עובד';
  switch (ev.k) {
    case 'new': return { title: 'משימה חדשה', body: txt };
    case 'back': return { title: 'המשימה הוחזרה אליך', body: cut(clean(a.cT) || clean(a.note) || clean(a.txt), BODY) };
    case 'cm':
      if (ev.mgr) { const cT = clean(a.cT), cN = clean(a.cN); return { title: 'תגובה חדשה מהמנהל', body: cT ? cut((cN ? cut(cN, 40) + ': ' : '') + cT, BODY) : txt }; }
      return { title: 'תגובה חדשה מ' + nm, body: cut(clean(a.cT), BODY) || txt };
    case 'newW': return { title: 'משימה חדשה מ' + nm, body: txt };
    case 'ptk': return { title: 'משימה פרטית חדשה של ' + nm, body: txt };
    case 'wait': return { title: 'ממתינה לאישור: ' + nm, body: txt };
    case 'done': return { title: 'בוצעה: ' + nm, body: txt };
    default: return null;
  }
}

async function fcmSend(tokens, msg, tag) {
  const { getMessaging } = require('firebase-admin/messaging');
  const RM = require('./secretary-remind')._core;
  const r = await getMessaging().sendEachForMulticast(RM.fcmPayload(tokens, msg, { data: { k: 'tk' }, tag }));
  return r.responses.map((x, i) => ({ token: tokens[i], ok: x.success, code: x.error && x.error.code }));
}

// בדיקות העסק ושליחה. mk(db, adm) → { ev, a, nameFallback } או null. kind = 'tk' / 'ptk'
async function deliver(bizId, id, kind, mk, opts) {
  const o = opts || {};
  if (!isId(String(id || '')) || (bizId && !T.BIZ_RE.test(String(bizId)))) return { ok: false, r: 'bad' };
  if (TK.quietAt(o.now || Date.now())) return { ok: true, r: 'quiet' };
  const biz = await T.loadBiz(bizId || T.BIZ0);
  if (!biz || biz.status !== 'active') return { ok: false, r: 'biz' };
  if (!bizId && biz.dataRoot !== 'legacy') return { ok: false, r: 'not-legacy' };
  if (bizId && biz.features.tasks !== true) return { ok: false, r: 'feature-off' };
  const prefix = bizId ? 'b/' + bizId + '/' : '';
  return T.runInBiz({ bizId: biz.bizId, prefix }, async () => {
    const db = T.tdb();
    const adm = new Set((await db.collection('admins').get()).docs.map((d) => d.id).filter(isId));
    const x = mk(adm);
    if (!x || !x.ev) return { ok: true, r: 'none' };
    const { ev, a } = x;
    const staffOf = async (u) => { const s = await db.doc('staff/' + u).get(); return s.exists ? s.data() || {} : null; };
    let name = '';
    if (ev.to === 'adm' && isId(ev.actor)) { const s = await staffOf(ev.actor); name = clean((s && s.name) || x.name); }
    const msg = msgOf(ev, a, name);
    const list = ev.to === 'adm' ? [...adm] : ev.to.slice(0, MAX_TO);
    const to = [];
    for (const u of [...new Set(list)]) {
      if (u === ev.actor) continue;
      if (!adm.has(u)) { const s = await staffOf(u); if (!s || s.active !== true) continue; }
      to.push(u);
    }
    const RM = require('./secretary-remind')._core;
    const send = o.send || (process.env.FUNCTIONS_EMULATOR === 'true' ? null : fcmSend);
    const tag = (kind === 'ptk' ? 'ptk_' : 'tkn_') + id;
    let sent = 0;
    for (const u of to) {
      try {
        const toks = await RM.tokensOf(db, u);
        if (!toks.length) continue;
        if (!send) { sent++; continue; } // אמולטור בלי שליחה מדומה – רק ספירה
        const res = await send(toks, Object.assign({ id }, msg), tag);
        if (res.some((r) => r.ok)) sent++;
        await RM.dropTokens(db, u, res.filter((r) => !r.ok && RM.BAD_TOKEN.includes(r.code)).map((r) => r.token));
      } catch (e) {
        logger.warn('tkPush: push failed', { bizId: biz.bizId, name: e && e.name, code: e && e.code });
      }
    }
    return { ok: true, k: ev.k, n: to.length, sent };
  });
}

// משימה (tasks). b/a = לפני/אחרי, actor = מזהה המשתמש שכתב ('' = שרת)
async function onTask(bizId, id, b, a, actor, opts) {
  if (!trig(b, a)) return { ok: true, r: 'skip' }; // לפני כל קריאה מהמסד
  const nameOf = (ev) => (ev.k === 'newW' ? a.by : ev.k === 'cm' ? a.cN : a.doneBy);
  return deliver(bizId, id, 'tk', (adm) => { const ev = evOf(b, a, actor, adm); return ev ? { ev, a, name: nameOf(ev) } : null; }, opts);
}

// משימה פרטית חדשה (ptk): עובד (לא מנהל) יצר – לכל המנהלים
async function onPtk(bizId, id, d, opts) {
  if (!d || typeof d !== 'object' || d.rc || !isId(d.owner)) return { ok: true, r: 'skip' };
  return deliver(bizId, id, 'ptk', (adm) => (adm.has(d.owner) ? null : { ev: { k: 'ptk', to: 'adm', actor: d.owner }, a: d, name: d.by }), opts);
}

const OPTS = { region: NEW_REGION, retry: false, timeoutSeconds: 60, memory: '256MiB', maxInstances: 5 };
const fail = (e) => { logger.error('tkPush failed', { reason: 'internal', name: e && e.name, code: e && e.code }); };
const dat = (s) => (s && s.exists && typeof s.data === 'function' ? s.data() || {} : null);
const runTk = (bizId, ev) => {
  const ch = ev.data || {};
  const actor = ev.authType === 'app_user' && isId(ev.authId) ? ev.authId : '';
  return onTask(bizId, ev.params.id, dat(ch.before), dat(ch.after), actor).catch(fail);
};
const runPtk = (bizId, ev) => onPtk(bizId, ev.params.id, ev.data && typeof ev.data.data === 'function' ? ev.data.data() : null).catch(fail);
exports.tkPush = onDocumentWrittenWithAuthContext(Object.assign({ document: 'tasks/{id}' }, OPTS), (ev) => runTk(null, ev));
exports.tkPushB = onDocumentWrittenWithAuthContext(Object.assign({ document: 'b/{bizId}/tasks/{id}' }, OPTS), (ev) => {
  if (!T.BIZ_RE.test(String(ev.params.bizId || ''))) return null;
  return runTk(ev.params.bizId, ev);
});
exports.ptkPush = onDocumentCreated(Object.assign({ document: 'ptk/{id}' }, OPTS), (ev) => runPtk(null, ev));
exports.ptkPushB = onDocumentCreated(Object.assign({ document: 'b/{bizId}/ptk/{id}' }, OPTS), (ev) => {
  if (!T.BIZ_RE.test(String(ev.params.bizId || ''))) return null;
  return runPtk(ev.params.bizId, ev);
});
Object.defineProperty(exports, '_core', { enumerable: false, value: { trig, evOf, handlerOf, msgOf, onTask, onPtk } });
