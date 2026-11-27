'use strict';
// התראת טלפון על חוסר חדש שממתין לאישור (27.11.2026, "אישור חוסרים ע"י מנהל").
//   hsPush  – טריגר יצירה על hsr/{id} (לארג' פעמי במצב legacy, בשורש).
//   hsPushB – טריגר יצירה על b/{bizId}/hsr/{id}.
// רק פריט ב-st 'pend' שנוצר (t) בטווח 10 דקות מעכשיו (לא מסמך ישן שהועתק). חוסר 'open' (מאשר / hsD) – בלי התראה.
// מי מקבל: כל המנהלים (admins) + עובדים פעילים שהמתג perms.hsA דולק אצלם עכשיו. לעולם לא היוצר (by).
// תנאים: עסק קיים ופעיל, תוספת suppliers (b/). בשורש – רק כשלארג' פעמי במצב legacy. שבת וחג (tk-time.js, quietAt) – לא נשלח כלום.
// ההתראה: "חוסר חדש לאישור", גוף = שם המוצר · שם המוסיף. data: { k: 'hs', id }, tag hs_<id>.
// אזור: europe-west1 בלבד, בלי ניסיון חוזר (כדי לא לשלוח פעמיים). שגיאה נרשמת ביומן ולא נזרקת. בנוי בדפוס של tasks-push.js.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { NEW_REGION } = require('./lib/region');
const T = require('./lib/tenant');
const TK = require('./lib/tk-time');

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const NEW_MS = 10 * 60 * 1000;
const MAX_TO = 100;

const clean = (v) => String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const isId = (u) => typeof u === 'string' && ID_RE.test(u);
const fresh = (d, now) => !!d && typeof d === 'object' && d.st === 'pend' && isId(d.by) && typeof d.t === 'number' && Math.abs(now - d.t) <= NEW_MS;
const msgOf = (d, name) => ({ title: 'חוסר חדש לאישור', body: cut(cut(clean(d.n), 80) || 'חוסר', 120) + ' · ' + (cut(clean(name), 40) || 'עובד') });

async function fcmSend(tokens, msg, tag) {
  const { getMessaging } = require('firebase-admin/messaging');
  const RM = require('./secretary-remind')._core;
  const r = await getMessaging().sendEachForMulticast(RM.fcmPayload(tokens, msg, { data: { k: 'hs' }, tag }));
  return r.responses.map((x, i) => ({ token: tokens[i], ok: x.success, code: x.error && x.error.code }));
}

// d = הפריט שנוצר. opts – רק לבדיקות (send מדומה, now)
async function onHs(bizId, id, d, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  if (!fresh(d, now)) return { ok: true, r: 'skip' }; // לפני כל קריאה מהמסד
  if (!isId(String(id || '')) || (bizId && !T.BIZ_RE.test(String(bizId)))) return { ok: false, r: 'bad' };
  if (TK.quietAt(now)) return { ok: true, r: 'quiet' };
  const biz = await T.loadBiz(bizId || T.BIZ0);
  if (!biz || biz.status !== 'active') return { ok: false, r: 'biz' };
  if (!bizId && biz.dataRoot !== 'legacy') return { ok: false, r: 'not-legacy' };
  if (bizId && biz.features.suppliers !== true) return { ok: false, r: 'feature-off' };
  const prefix = bizId ? 'b/' + bizId + '/' : '';
  return T.runInBiz({ bizId: biz.bizId, prefix }, async () => {
    const db = T.tdb();
    const [ad, ap, by] = await Promise.all([db.collection('admins').get(), db.collection('staff').where('perms.hsA', '==', true).get(), db.doc('staff/' + d.by).get()]);
    const to = [...new Set(ad.docs.map((x) => x.id).concat(ap.docs.filter((x) => x.get('active') === true).map((x) => x.id)))]
      .filter((u) => isId(u) && u !== d.by).slice(0, MAX_TO);
    const msg = Object.assign({ id }, msgOf(d, (by.exists && by.get('name')) || d.byN));
    const RM = require('./secretary-remind')._core;
    const send = o.send || (process.env.FUNCTIONS_EMULATOR === 'true' ? null : fcmSend);
    let sent = 0;
    for (const u of to) {
      try {
        const toks = await RM.tokensOf(db, u);
        if (!toks.length) continue;
        if (!send) { sent++; continue; } // אמולטור בלי שליחה מדומה – רק ספירה
        const res = await send(toks, msg, 'hs_' + id);
        if (res.some((r) => r.ok)) sent++;
        await RM.dropTokens(db, u, res.filter((r) => !r.ok && RM.BAD_TOKEN.includes(r.code)).map((r) => r.token));
      } catch (e) {
        logger.warn('hsPush: push failed', { bizId: biz.bizId, name: e && e.name, code: e && e.code });
      }
    }
    return { ok: true, k: 'hs', n: to.length, sent };
  });
}

const OPTS = { region: NEW_REGION, retry: false, timeoutSeconds: 60, memory: '256MiB', maxInstances: 5 };
const fail = (e) => { logger.error('hsPush failed', { reason: 'internal', name: e && e.name, code: e && e.code }); };
const runHs = (bizId, ev, opts) => Promise.resolve().then(() => onHs(bizId, ev.params.id, ev.data && typeof ev.data.data === 'function' ? ev.data.data() : null, opts)).catch(fail);
exports.hsPush = onDocumentCreated(Object.assign({ document: 'hsr/{id}' }, OPTS), (ev) => runHs(null, ev));
exports.hsPushB = onDocumentCreated(Object.assign({ document: 'b/{bizId}/hsr/{id}' }, OPTS), (ev) => {
  if (!T.BIZ_RE.test(String(ev.params.bizId || ''))) return null;
  return runHs(ev.params.bizId, ev);
});
Object.defineProperty(exports, '_core', { enumerable: false, value: { onHs, runHs, msgOf, fresh, NEW_MS } });
