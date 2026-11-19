'use strict';
// "כלל שכר בכתב חופשי" (שלב D, משימה 2026-11-19_תנאי-שכר-והערות-עובד) – צד השרת.
//   payRuleAi({ text, base? }) → { ok:true, comp, base?, explain, unsure, dropped, errs, use:{n,max} }
//                              | { ok:false, unparsed:true, explain, unsure, dropped, errs, use:{n,max} }
//     text – הכלל כפי שהמנהל כתב (חובה, 1–500 תווים אחרי trim). base – לא חובה, הקשר בלבד: { mode:'hr'|'mo', rate, mo } (שדות אחרים נזרקים).
//     comp – רכיבים במבנה pay.comp, אחרי validComp (lib/payroll-core.js), עם id חדש ('ai_…'), src = הכלל ו-ai:1.
//     base – שינוי בסיס שהובן (רק השדות שהשתנו): { mode?, rate?, mo?, add?:[{id,n,k,a}], rules?:[{id,d,s,e,r}] }.
//     dropped – כמה רכיבים/שדות נזרקו כלא תקינים; errs – עד 5 סיבות בעברית (מ-validComp).
//   מנהל בלבד (admins/{uid} של העסק, או מנהל־על), ורק עסק במבנה b (legacy נדחה – אחרת המונה ייכתב לשורש).
//   תקרה: 50 פענוחים ביום (שעון ישראל) לעסק – מונה בטרנזקציה ב-b/{bizId}/payai/{YYYY-MM-DD} = { n } (רק השרת; אין כללי Firestore –
//   החסימה הכללית חוסמת את האפליקציה). כשל בשירות ה-AI – הפענוח מוחזר למונה. תשובה לא מובנת – נספרת.
//   לעולם לא נשמר דבר מהכלל עצמו – רק מוחזר לאפליקציה, והמנהל מאשר ושומר במכשיר.
// שגיאות (details.reason): not-manager, legacy, bad-input, bad-text, empty, too-long, bad-base, cap (resource-exhausted),
//   ai-unavailable (unavailable), no-key (failed-precondition). ההודעה בעברית.
// פרטיות: ל-Gemini נשלחים רק הכלל והבסיס המספרי – בלי שם עובד, שם עסק או מזהים. ביומן השרת – רק מספרים, לא הטקסט.

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const TK = require('./lib/tk-time');
const AI = require('./lib/sec-ai');
const P = require('./lib/pay-ai');

const DAILY_MAX = 50;
const AI_TIMEOUT = 45000;
const MSG = {
  'bad-text': 'כתבו את הכלל בטקסט',
  empty: 'כתבו את הכלל לפני הפענוח',
  'too-long': 'הכלל ארוך מדי – עד ' + P.MAX_TEXT + ' תווים',
  'bad-base': 'נתוני הבסיס לא תקינים',
};

async function take(db, ref, max) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const n = (s.exists && Number(s.get('n'))) || 0;
    if (n >= max) return { ok: false, n };
    tx.set(ref, { n: n + 1, at: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, n: n + 1 };
  });
}

// o (בדיקות): { now, max, ai } – ai = פונקציה במקום AI.multi
async function payRuleAi(request, o) {
  const opt = o || {};
  const d = inputObject(request);
  const who = await requireStaff(request);
  if (who.role !== 'manager') throw new HttpsError('permission-denied', 'הפעולה זמינה למנהל בלבד', { reason: 'not-manager' });
  if (!who.prefix) throw new HttpsError('failed-precondition', 'פענוח כלל שכר זמין רק אחרי מעבר העסק למבנה החדש', { reason: 'legacy' });
  const inp = P.checkInput(d);
  if (!inp.ok) throw new HttpsError('invalid-argument', MSG[inp.reason] || 'קלט לא תקין', { reason: inp.reason });

  const db = getFirestore();
  const max = opt.max || DAILY_MAX;
  const day = TK.dayStr(TK.ymdOf(opt.now || Date.now()));
  const ref = db.doc(who.prefix + 'payai/' + day);
  const t = await take(db, ref, max);
  if (!t.ok) throw new HttpsError('resource-exhausted', 'הגעתם לתקרת ' + max + ' פענוחים להיום. נסו שוב מחר, או הגדירו את הרכיב ידנית.', { reason: 'cap', max });

  let r;
  try {
    r = await (opt.ai || AI.multi)({ system: P.SYS, parts: [{ text: P.userPart(inp.text, inp.cur) }], json: true, timeoutMs: AI_TIMEOUT });
  } catch (e) {
    // לא באשמת המנהל – מחזירים את הפענוח למונה (לא יורד מתחת ל-0)
    try {
      await db.runTransaction(async (tx) => { const s = await tx.get(ref); const n = (s.exists && Number(s.get('n'))) || 0; if (n > 0) tx.set(ref, { n: n - 1 }, { merge: true }); });
    } catch (e2) { /* המונה – לא קריטי */ }
    const reason = e && e.details && e.details.reason;
    logger.warn('payRuleAi: ai failed', { bizId: who.bizId, reason: reason || (e && e.name) });
    if (reason === 'no-key') throw new HttpsError('failed-precondition', 'הפענוח עוד לא מוגדר בשרת. פנו לספק.', { reason: 'no-key' });
    throw new HttpsError('unavailable', 'הפענוח לא זמין כרגע. נסו שוב בעוד דקה, או הגדירו את הרכיב ידנית.', { reason: 'ai-unavailable' });
  }
  const out = P.parseOut(r && r.text, inp.text);
  out.use = { n: t.n, max };
  logger.info('payRuleAi', { bizId: who.bizId, ok: out.ok, comp: out.comp ? out.comp.length : 0, base: !!out.base, dropped: out.dropped, n: t.n });
  return out;
}

const wrap = (fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('payRuleAi failed', { name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

exports.payRuleAi = onCall({ secrets: [AI.GEMINI_API_KEY], timeoutSeconds: 60, memory: '256MiB', maxInstances: 5 }, wrap((r) => payRuleAi(r)));
Object.defineProperty(exports, '_core', { enumerable: false, value: { call: (o) => wrap((r) => payRuleAi(r, o)), DAILY_MAX } });
