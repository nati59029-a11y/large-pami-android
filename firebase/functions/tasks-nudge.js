'use strict';
// מרכז עבודה סבב 3 (15.11.2026): "הזכר לעובד" שכבה ב' – tkNudge({ taskId }): התראת טלפון לעובד על משימה פתוחה.
// שכבה א' (באפליקציה): המנהל כותב nd (זמן) ו-ndN על המשימה, והעובד רואה "תזכורת מהמנהל" בראש "היום שלי".
// שכבה ב' (כאן): אחרי כתיבת nd האפליקציה קוראת לפונקציה, והשרת שולח התראת טלפון. כל כשל באפליקציה נבלע (התזכורת עדיין מופיעה באפליקציה).
// מי: מנהל העסק בלבד (requireStaff + role manager), תוספת tasks מופעלת. המשימה נקראת בתוך העסק של המנהל (T.tdb()) – משימה של עסק אחר לא נמצאת.
// תנאים: משימה קיימת, st == 'open', ו-nd נכתב בעשר הדקות האחרונות (ההתראה צמודה לתזכורת שנכתבה באפליקציה).
// נמענים: ow (מי שמטפל), ואם אין – to (עד 30). רק עובד פעיל (staff/{uid}.active == true), לא המנהל עצמו.
// הגבלה: פעם ב-30 דקות למשימה – fn_rate/tkNudge_<taskId> { t, nd } בתוך העסק (אין כלל = חסום מהאפליקציה). nd שכבר נשלח – לא נשלח שוב.
// תוכן ההתראה (16.11.2026, בקשת בעל העסק): "תזכורת מהמנהל" + טקסט המשימה (בלי טקסט – הנוסח הכללי). במסך נעול מוסתר (private). data: { k: 'tk', id }.
// כפתורים בהתראה (16.11.2026): טלפון שנרשם עם act:1 מקבל הודעת data עם אסימון חד־פעמי ל"טופל" (pushAct – push-act.js).
// הפונקציה לא מפורסמת עד מיזוג ואישור בעל העסק.
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const RM = require('./secretary-remind')._core;

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const GAP = 30 * 60000, ND_FRESH = 10 * 60000, MAX_TO = 30;
const MSG = { title: 'משימות', body: 'תזכורת מהמנהל למשימה – פרטים באפליקציה' };
const msgOf = (t) => { const x = String((t && t.txt) || '').replace(/\s+/g, ' ').trim(); return x ? { title: 'תזכורת מהמנהל', body: x.length > 400 ? x.slice(0, 399) + '…' : x } : MSG; };

// 16.11.2026 (כפתורים בהתראה): טלפון ישן – בדיוק כמו קודם; טלפון עם כפתורים – הודעת data בלבד (RM.fcmPayload)
async function fcmSendTk(tokens, msg) {
  const { getMessaging } = require('firebase-admin/messaging');
  const r = await getMessaging().sendEachForMulticast(RM.fcmPayload(tokens, msg, { data: { k: 'tk' }, tag: 'tk_' + msg.id }));
  return r.responses.map((x, i) => ({ token: tokens[i], ok: x.success, code: x.error && x.error.code }));
}

// הליבה (גם לבדיקות: opts.send מדומה, opts.now). who = תוצאת requireStaff (העסק כבר נקבע ב-scope).
async function nudge(who, input, opts) {
  const o = opts || {};
  if (who.role !== 'manager') throw new HttpsError('permission-denied', 'רק מנהל יכול לשלוח תזכורת', { reason: 'not-manager' });
  const taskId = typeof input.taskId === 'string' ? input.taskId : '';
  if (!ID_RE.test(taskId)) throw new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-task' });
  const now = o.now || Date.now();
  const db = T.tdb();
  const tRef = db.doc('tasks/' + taskId), rRef = db.doc('fn_rate/tkNudge_' + taskId);
  // בדיקה ושמירת ההגבלה באותה טרנזקציה – שתי קריאות במקביל לא שולחות פעמיים
  const t = await db.runTransaction(async (tx) => {
    const [s, r] = await Promise.all([tx.get(tRef), tx.get(rRef)]);
    if (!s.exists) throw new HttpsError('not-found', 'המשימה לא נמצאה', { reason: 'no-task' });
    const d = s.data() || {};
    if (d.st !== 'open') throw new HttpsError('failed-precondition', 'המשימה כבר לא פתוחה', { reason: 'not-open' });
    const nd = Number.isInteger(d.nd) ? d.nd : 0;
    if (!(nd > 0) || Math.abs(now - nd) > ND_FRESH) throw new HttpsError('failed-precondition', 'אין תזכורת חדשה במשימה', { reason: 'no-nd' });
    const last = r.exists ? Number(r.get('t')) || 0 : 0;
    if ((r.exists && r.get('nd') === nd) || (last && now - last < GAP)) throw new HttpsError('resource-exhausted', 'כבר נשלחה תזכורת בחצי השעה האחרונה', { reason: 'rate-limit' });
    tx.set(rRef, { t: now, nd });
    return d;
  });
  const str = (v) => (typeof v === 'string' ? v : '');
  let to = str(t.ow) && ID_RE.test(t.ow) ? [t.ow] : (Array.isArray(t.to) ? t.to.filter((u) => typeof u === 'string' && ID_RE.test(u)) : []);
  to = [...new Set(to)].filter((u) => u !== who.uid).slice(0, MAX_TO);
  let sent = 0, n = 0;
  for (const u of to) {
    try {
      const st = await db.doc('staff/' + u).get();
      if (!st.exists || st.get('active') !== true) continue;
      n++;
      const toks = await RM.tokensOf(db, u);
      if (!toks.length) continue;
      // כפתורים (16.11.2026): "טופל" רק כשאפשר לסיים בלי האפליקציה – המטפל עצמו, בלי תמונה נדרשת; אחרת "פתח" (open). "הזכר לי" – מקומי בטלפון
      const can = t.ow === u && t.pr !== '1' && !(Number(t.np) > 0) && !require('./push-act')._core.ckOpen(t);
      const res = await RM.sendItem(o.send || fcmSendTk, toks, new Set(await RM.tokensAct(db, u)), Object.assign({ id: taskId }, msgOf(t)), { uid: u, bizId: who.bizId },
        { bizId: who.bizId, uid: u, kind: 'tk', id: taskId, acts: can ? ['done'] : [], show: (can ? 'done' : 'open') + ',h1,d1', now });
      if (res.some((x) => x.ok)) sent++;
      await RM.dropTokens(db, u, res.filter((x) => !x.ok && RM.BAD_TOKEN.includes(x.code)).map((x) => x.token));
    } catch (e) {
      logger.warn('tkNudge: push failed', { bizId: who.bizId, name: e && e.name, code: e && e.code });
    }
  }
  return { ok: true, n, sent };
}

exports.tkNudge = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request, { feature: 'tasks' });
  return nudge(who, inputObject(request));
}));
Object.defineProperty(exports, '_core', { enumerable: false, value: { nudge, MSG, msgOf, GAP } });
