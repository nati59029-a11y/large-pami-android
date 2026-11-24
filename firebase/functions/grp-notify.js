'use strict';
// קבוצות התכתבות (סבב 3, 17.11.2026): התראה לטלפון על הודעה חדשה בקבוצה.
//   grpMsg  – טריגר על יצירת grp/{gid}/m/{mid} (לארג' פעמי במצב legacy, בשורש).
//   grpMsgB – טריגר על יצירת b/{bizId}/grp/{gid}/m/{mid}.
//   grpDel / grpDelB – מחיקה מדורגת כשקבוצה נמחקת (ראו onDel למטה).
//   grpMDel / grpMDelB – מחיקת הודעה בודדת (מנהל): last מחושב מחדש, וקובץ הסרטון שלה נמחק (ראו onMDel למטה).
// ההודעה כבר עברה את החוקים (חבר בקבוצה / מנהל, ao, md, by == השולח). השרת לא סומך על שום שם מההודעה מלבד byN כגיבוי:
// שם השולח נלקח מ-staff/{by}.name, ואם אין – מ-byN (שהחוקים מחייבים להיות של השולח עצמו, isMyName).
// נמענים: כל ה-uid ב-mem שהם עובד פעיל (staff/{uid}.active == true) או מנהל (admins/{uid}), וכל מנהלי העסק (admins) – חוץ מהשולח.
//   מי שהשתיק (grp/{gid}/r/{uid}.mu == true) – לא מקבל, חוץ מבקבוצה עם ao == true ("רק המנהל שולח" – אי אפשר להשתיק).
// תנאים לעסק: עסק קיים ופעיל, תוספת groups מופעלת (כמו החוקים). בשורש – רק כשלארג' פעמי במצב legacy (שם החוקים לא בודקים תוספת).
// ההתראה: כותרת = שם הקבוצה, גוף = "<שולח>: <תחילת ההודעה>" או "<שולח>: 📷 תמונה" / "<שולח>: 🎬 סרטון".
//   tag לכל קבוצה (grp_<gid>) – הודעה חדשה מחליפה את ההתראה הקודמת של אותה קבוצה. במסך נעול מוסתר (private). data: { k: 'grp', id: gid }.
//   בלי כפתורים – הודעת notification רגילה לכל טלפון רשום (fcmPayload בלי act).
// בנוסף: grp/{gid}.last = { txt (עד 120), byN, t, k } – רק אם ההודעה חדשה מ-last הקיים (טרנזקציה; הודעה שמגיעה באיחור לא דורסת).
// 24.11.2026: אחרי ההתראות – זיהוי התחייבויות בקבוצה שפתוחה לגיטי (lib/sec-cmt.js; הצעה בלבד, sec_cmt).
// אזור: europe-west1 בלבד (כמו secMailWork – טריגר Firestore), בלי ניסיון חוזר (כדי לא לשלוח התראה פעמיים).
const { onDocumentCreated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { NEW_REGION } = require('./lib/region');
const T = require('./lib/tenant');

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TO = 300; // כמו מגבלת mem בחוקים – לחברים; המנהלים נוספים מעבר לזה (הערה 1 של הבודק)
const PREV = 100; // אורך תחילת ההודעה בגוף ההתראה
const KIND_TXT = { img: '📷 תמונה', vid: '🎬 סרטון' };

const clean = (v) => String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// גוף ההתראה. m = ההודעה, name = שם השולח, gname = שם הקבוצה
function msgOf(m, name, gname) {
  const txt = clean(m.txt);
  const what = m.k === 't' ? cut(txt, PREV) : KIND_TXT[m.k] + (txt ? ' ' + cut(txt, PREV) : '');
  return { title: cut(clean(gname) || 'קבוצה', 60), body: (name ? cut(name, 40) + ': ' : '') + what };
}

// הנמענים. g = מסמך הקבוצה, admins = רשימת uid של המנהלים, staffOf(uid) → נתוני staff או null, muted(uid) → bool
async function recipients(g, sender, admins, staffOf, muted) {
  const adm = new Set(admins);
  const mem = Array.isArray(g.mem) ? g.mem.filter((u) => typeof u === 'string' && ID_RE.test(u)) : [];
  const out = [];
  const cap = MAX_TO + adm.size;
  for (const u of [...new Set(admins.concat(mem))]) {
    if (u === sender) continue;
    if (out.length >= cap) { logger.warn('grpMsg: recipients capped', { cap }); break; }
    if (!adm.has(u)) { const s = await staffOf(u); if (!s || s.active !== true) continue; }
    if (g.ao !== true && (await muted(u))) continue;
    out.push(u);
  }
  return out;
}

async function fcmSend(tokens, msg, gid) {
  const { getMessaging } = require('firebase-admin/messaging');
  const RM = require('./secretary-remind')._core;
  const r = await getMessaging().sendEachForMulticast(RM.fcmPayload(tokens, Object.assign({ id: gid }, msg), { data: { k: 'grp' }, tag: 'grp_' + gid }));
  return r.responses.map((x, i) => ({ token: tokens[i], ok: x.success, code: x.error && x.error.code }));
}

// הליבה. bizId = null לשורש (legacy). m = נתוני ההודעה. opts: { send(tokens, msg, gid), now } לבדיקות
async function onMsg(bizId, gid, mid, m, opts) {
  const o = opts || {};
  if (!ID_RE.test(String(gid || '')) || !ID_RE.test(String(mid || '')) || !m || typeof m !== 'object') return { ok: false, r: 'bad' };
  if (!['t', 'img', 'vid'].includes(m.k) || typeof m.by !== 'string' || !ID_RE.test(m.by)) return { ok: false, r: 'bad' };
  const biz = await T.loadBiz(bizId || T.BIZ0);
  if (!biz || biz.status !== 'active') return { ok: false, r: 'biz' };
  if (!bizId && biz.dataRoot !== 'legacy') return { ok: false, r: 'not-legacy' }; // השורש שייך רק ללארג' פעמי ב-legacy
  if (bizId && biz.features.groups !== true) return { ok: false, r: 'feature-off' };
  const prefix = bizId ? 'b/' + bizId + '/' : '';
  return T.runInBiz({ bizId: biz.bizId, prefix }, async () => {
    const db = T.tdb();
    const gRef = db.doc('grp/' + gid);
    const gs = await gRef.get();
    if (!gs.exists) return { ok: false, r: 'no-group' };
    const g = gs.data() || {};
    const admins = (await db.collection('admins').get()).docs.map((d) => d.id).filter((u) => ID_RE.test(u));
    const staffOf = async (u) => { const s = await db.doc('staff/' + u).get(); return s.exists ? s.data() || {} : null; };
    const muted = async (u) => { const r = await db.doc('grp/' + gid + '/r/' + u).get(); return r.exists && r.get('mu') === true; };
    const snd = await staffOf(m.by);
    const name = clean((snd && snd.name) || m.byN).slice(0, 100);
    const msg = msgOf(m, name, g.name);
    const t = Number.isInteger(m.t) ? m.t : (o.now || Date.now());
    // last – לפני השליחה (גם אם אין למי לשלוח)
    try {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(gRef);
        if (!s.exists) return;
        const l = s.get('last');
        if (l && typeof l === 'object' && Number(l.t) > t) return;
        tx.update(gRef, { last: { txt: cut(clean(m.txt), 120), byN: name, t, k: m.k } });
      });
    } catch (e) { logger.warn('grpMsg: last failed', { bizId: biz.bizId, name: e && e.name, code: e && e.code }); }
    const to = await recipients(g, m.by, admins, staffOf, muted);
    const RM = require('./secretary-remind')._core;
    const send = o.send || fcmSend;
    let sent = 0;
    for (const u of to) {
      try {
        const toks = await RM.tokensOf(db, u);
        if (!toks.length) continue;
        const res = await send(toks, msg, gid);
        if (res.some((x) => x.ok)) sent++;
        await RM.dropTokens(db, u, res.filter((x) => !x.ok && RM.BAD_TOKEN.includes(x.code)).map((x) => x.token));
      } catch (e) {
        logger.warn('grpMsg: push failed', { bizId: biz.bizId, name: e && e.name, code: e && e.code });
      }
    }
    // 24.11.2026 (גיטי, סבב 3 חלק ב): זיהוי התחייבויות – רק טקסט, רק אם הקבוצה פתוחה לגיטי ברגע הזה והמתג פעיל (lib/sec-cmt.js בודק הכול).
    // תקלה כאן לא משפיעה על ההתראות (כבר נשלחו). o.cmt === false – בלי זיהוי (בדיקות של ההתראות בלבד)
    let cmt = null;
    if (o.cmt !== false && clean(m.txt)) cmt = await require('./lib/sec-cmt').safe(db, { ch: 'grp', gid, mid, from: name, grp: clean(g.name).slice(0, 60), text: m.txt }, { biz, ai: o.ai, now: o.now });
    return { ok: true, n: to.length, sent, cmt };
  });
}

// מחיקה מדורגת (grpDel / grpDelB): כשהמנהל מוחק את grp/{gid}, השרת מוחק את כל תתי-האוספים (m, m/{mid}/p, r)
// ואת קובצי הסרטונים בתחילית grpv/{gid}/ (בעסק: b/{bizId}/grpv/{gid}/). בלי זה ההודעות נשארות יתומות (בלתי נגישות, אבל תופסות מקום).
// אין בדיקת הרשאה כאן – רק מנהל רשאי למחוק קבוצה (החוקים), והטריגר רץ רק אחרי שהמחיקה כבר קרתה.
// opts: { bucket } לבדיקות (אובייקט עם deleteFiles({ prefix })).
async function onDel(bizId, gid, opts) {
  const o = opts || {};
  if (!ID_RE.test(String(gid || '')) || (bizId && !T.BIZ_RE.test(String(bizId)))) return { ok: false, r: 'bad' };
  const { getFirestore } = require('firebase-admin/firestore');
  const db = getFirestore();
  const P = bizId ? 'b/' + bizId + '/' : '';
  const ref = db.doc(P + 'grp/' + gid);
  if ((await ref.get()).exists) return { ok: false, r: 'exists' }; // נוצרה מחדש באותו מזהה – לא נוגעים
  await db.recursiveDelete(ref); // המסמך כבר נמחק; recursiveDelete מוחק את כל תתי-האוספים שלו
  let files = true;
  try {
    const bucket = o.bucket || require('firebase-admin/storage').getStorage().bucket();
    await bucket.deleteFiles({ prefix: P + 'grpv/' + gid + '/' });
  } catch (e) {
    files = false; // לא קריטי: כלל ה-lifecycle מוחק את הסרטונים אחרי 90 יום בכל מקרה
    logger.warn('grpDel: video cleanup failed', { bizId: bizId || T.BIZ0, name: e && e.name, code: e && e.code });
  }
  return { ok: true, files };
}

// מחיקת הודעה בודדת (grpMDel / grpMDelB, אחרי סבב בדיקה 1): רק מנהל מוחק הודעה (החוקים), והטריגר רץ אחרי המחיקה.
// 1. last: אם ההודעה שנמחקה לא ישנה מ-last (או שאין last) – last מחושב מחדש בטרנזקציה מההודעה האחרונה שנשארה (לפי t),
//    ואם לא נשארה אף הודעה – last נמחק. כך הטקסט של הודעה שנמחקה לא נשאר ברשימת הקבוצות.
// 1א. pin (תוספת 17.11): אם ההודעה שנמחקה היא ההודעה המוצמדת (pin.mid == mid) – pin נמחק.
// 2. סרטון: נמחק רק הקובץ של אותה הודעה, ורק אם vp שווה בדיוק ל-grpv/{gid}/{mid} (בעסק: b/{bizId}/grpv/{gid}/{mid}).
// בלי לולאה: כשהקבוצה כולה נמחקת (grpDel → recursiveDelete), מסמך הקבוצה כבר לא קיים – לא מחושב last ולא נוגעים בקבצים
// (grpDel מוחק את כל התחילית בעצמו). כתיבת last לא מפעילה שום טריגר של הודעות.
// m = נתוני ההודעה שנמחקה (ev.data). opts: { bucket } לבדיקות (אובייקט עם file(path).delete()).
async function onMDel(bizId, gid, mid, m, opts) {
  const o = opts || {};
  if (!ID_RE.test(String(gid || '')) || !ID_RE.test(String(mid || '')) || (bizId && !T.BIZ_RE.test(String(bizId)))) return { ok: false, r: 'bad' };
  const d = m && typeof m === 'object' ? m : {};
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const db = getFirestore();
  const P = bizId ? 'b/' + bizId + '/' : '';
  const gRef = db.doc(P + 'grp/' + gid);
  const t = Number.isInteger(d.t) ? d.t : null;
  let pin = false;
  const last = await db.runTransaction(async (tx) => {
    const gs = await tx.get(gRef);
    if (!gs.exists) return 'no-group';
    // תוספת 17.11: ההודעה המוצמדת נמחקה – pin נמחק (באותה טרנזקציה)
    const pn = gs.get('pin');
    const upd = pn && typeof pn === 'object' && pn.mid === mid ? { pin: FieldValue.delete() } : {};
    pin = 'pin' in upd;
    const l = gs.get('last');
    let r;
    if (l && typeof l === 'object' && t !== null && Number(l.t) > t) r = 'older';
    else {
      const q = await tx.get(gRef.collection('m').orderBy('t', 'desc').limit(1));
      if (q.empty) {
        if (l !== undefined) upd.last = FieldValue.delete();
        r = 'cleared';
      } else {
        const x = q.docs[0].data() || {};
        const by = typeof x.by === 'string' && ID_RE.test(x.by) ? x.by : '';
        const st = by ? await tx.get(db.doc(P + 'staff/' + by)) : null;
        const name = clean((st && st.exists && st.get('name')) || x.byN).slice(0, 100);
        upd.last = { txt: cut(clean(x.txt), 120), byN: name, t: Number.isInteger(x.t) ? x.t : 0, k: ['t', 'img', 'vid'].includes(x.k) ? x.k : 't' };
        r = 'recalc';
      }
    }
    if (Object.keys(upd).length) tx.update(gRef, upd);
    return r;
  });
  if (last === 'no-group') return { ok: true, last, file: 'skip', pin: false };
  let file = 'none';
  const vp = P + 'grpv/' + gid + '/' + mid;
  if (d.k === 'vid' && d.vp === vp) {
    try {
      const bucket = o.bucket || require('firebase-admin/storage').getStorage().bucket();
      await bucket.file(vp).delete({ ignoreNotFound: true });
      file = 'deleted';
    } catch (e) {
      file = 'failed'; // לא קריטי: כלל ה-lifecycle מוחק אחרי 90 יום
      logger.warn('grpMDel: video delete failed', { bizId: bizId || T.BIZ0, name: e && e.name, code: e && e.code });
    }
  }
  return { ok: true, last, file, pin };
}

const OPTS = { region: NEW_REGION, retry: false, timeoutSeconds: 120, memory: '256MiB', maxInstances: 5 };
const run = (bizId, ev) => {
  const d = ev.data && typeof ev.data.data === 'function' ? ev.data.data() : null;
  return onMsg(bizId, ev.params.gid, ev.params.mid, d).catch((e) => {
    logger.error('grpMsg failed', { reason: 'internal', name: e && e.name, code: e && e.code });
  });
};
exports.grpMsg = onDocumentCreated(Object.assign({ document: 'grp/{gid}/m/{mid}' }, OPTS), (ev) => run(null, ev));
exports.grpMsgB = onDocumentCreated(Object.assign({ document: 'b/{bizId}/grp/{gid}/m/{mid}' }, OPTS), (ev) => {
  if (!T.BIZ_RE.test(String(ev.params.bizId || ''))) return null;
  return run(ev.params.bizId, ev);
});
const DOPTS = { region: NEW_REGION, retry: false, timeoutSeconds: 300, memory: '256MiB', maxInstances: 2 };
const del = (bizId, ev) => onDel(bizId, ev.params.gid).catch((e) => {
  logger.error('grpDel failed', { reason: 'internal', name: e && e.name, code: e && e.code });
});
exports.grpDel = onDocumentDeleted(Object.assign({ document: 'grp/{gid}' }, DOPTS), (ev) => del(null, ev));
exports.grpDelB = onDocumentDeleted(Object.assign({ document: 'b/{bizId}/grp/{gid}' }, DOPTS), (ev) => {
  if (!T.BIZ_RE.test(String(ev.params.bizId || ''))) return null;
  return del(ev.params.bizId, ev);
});
const mdel = (bizId, ev) => {
  const d = ev.data && typeof ev.data.data === 'function' ? ev.data.data() : null;
  return onMDel(bizId, ev.params.gid, ev.params.mid, d).catch((e) => {
    logger.error('grpMDel failed', { reason: 'internal', name: e && e.name, code: e && e.code });
  });
};
exports.grpMDel = onDocumentDeleted(Object.assign({ document: 'grp/{gid}/m/{mid}' }, OPTS), (ev) => mdel(null, ev));
exports.grpMDelB = onDocumentDeleted(Object.assign({ document: 'b/{bizId}/grp/{gid}/m/{mid}' }, OPTS), (ev) => {
  if (!T.BIZ_RE.test(String(ev.params.bizId || ''))) return null;
  return mdel(ev.params.bizId, ev);
});
Object.defineProperty(exports, '_core', { enumerable: false, value: { onMsg, onDel, onMDel, msgOf, recipients, MAX_TO } });
