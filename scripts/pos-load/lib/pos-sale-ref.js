'use strict';
// מימוש ייחוס של פונקציית השרת "מכירה בקופה" – לפי הממשק הצפוי, לא הקוד האמיתי.
// ⚠️ פונקציות השרת של הקופה נבנות במקביל בסשן ז' ועוד לא קיימות ב-main. המימוש הזה משמש רק כדי
//    שאפשר יהיה להריץ את הבדיקות כבר עכשיו מול האמולטור. אחרי המיזוג – מריצים את אותן בדיקות מול
//    הפונקציה האמיתית (POS_IMPL=fn, ראו lib/pos-client.js) ומשווים.
//
// הממשק הצפוי (בנוי לפי הדפוס הקיים של createCore ב-firebase/functions/orders.js):
//   posSale({ reqId, br, dev, lines:[{pid, vid, qty, price}], pay:{m, amt}, custId?, at })
//     → { id, no, total, dup }
//   - reqId נוצר במכשיר לפני השליחה (גם בלי אינטרנט). שליחה חוזרת של אותו reqId מחזירה את אותה מכירה (dup:true),
//     בלי מספר חדש ובלי תנועת מלאי נוספת.
//   - מספור רץ לכל סניף: b/{biz}/poscfg/seq_{br} = { n }. המספר נקבע בתוך טרנזקציה, ולכן אין חורים ואין כפילויות:
//     טרנזקציה שנכשלה/בוטלה לא "שורפת" מספר.
//   - המכירה: b/{biz}/pos/s{reqId}. מלאי: b/{biz}/stock/{br}_{pid}_{vid} (increment, בלי קריאה).
//     סיכום יומי: b/{biz}/posday/{br}_{yyyymmdd} (increment) – כדי שדוח יומי יעלה קריאה אחת ולא מאות.
//   - בדיקת מחיר בשרת: קורא את מסמכי המוצרים של השורות (getAll) ובודק שהמחיר תואם (או מסמן חריגה).

const { FieldValue } = require('firebase-admin/firestore');
const { P } = require('./env');

const dayKey = (ms) => { const d = new Date(ms + 2 * 3600e3); return d.toISOString().slice(0, 10).replace(/-/g, ''); }; // שעון ישראל (חורף) – מספיק לדמו

// מונה פעולות: כמה קריאות וכתיבות כל מכירה עלתה (לפי מה שמחויב ב-Firestore: כל מסמך שנקרא = קריאה, כל set/update = כתיבה).
function counter() { return { reads: 0, writes: 0, attempts: 0 }; }

async function posSale(db, input, ops = counter(), opt = {}) {
  const { reqId, br, dev, lines, pay, custId, at } = input;
  if (!/^[\w-]{6,80}$/.test(reqId || '')) throw new Error('reqId לא תקין');
  if (!Array.isArray(lines) || !lines.length || lines.length > 200) throw new Error('שורות לא תקינות');
  const ref = db.doc(P('pos/s' + reqId));
  const seq = db.doc(P('poscfg/seq_' + br));
  const pids = Array.from(new Set(lines.map((l) => l.pid)));
  // מחירי המוצרים נקראים לפני הטרנזקציה: הם לא חלק מהמספור, וכך הנעילה על מונה הסניף קצרה ככל האפשר
  // (בבדיקה הראשונה, כשהם נקראו בתוך הטרנזקציה, 100 מכירות במקביל נתקעו על נעילות – ראו RESULTS.md).
  const prods = opt.prodsInTx ? null : await db.getAll(...pids.map((p) => db.doc(P('prod/' + p))));
  if (prods) ops.reads += prods.length;
  let out = null;
  let w = 0; // כתיבות של הניסיון האחרון בלבד – רק הוא נשמר בפועל. קריאות של ניסיונות שנכשלו כן מחויבות.
  await db.runTransaction(async (tx) => {
    ops.attempts++;
    w = 0;
    const [s, q] = await tx.getAll(ref, seq);
    ops.reads += 2;
    if (s.exists) { out = { id: s.id, no: s.get('no'), total: s.get('total'), dup: true }; return; }
    let pr = prods;
    if (!pr) { pr = await tx.getAll(...pids.map((p) => db.doc(P('prod/' + p)))); ops.reads += pr.length; }
    const pm = new Map(pr.map((d) => [d.id, d]));
    const warn = [];
    let total = 0;
    const items = lines.map((l) => {
      const p = pm.get(l.pid);
      if (!p || !p.exists) throw new Error('מוצר לא קיים: ' + l.pid);
      const v = (p.get('variants') || []).find((x) => x.vid === l.vid);
      if (!v) throw new Error('וריאציה לא קיימת: ' + l.pid + '/' + l.vid);
      if (Math.abs(v.price - l.price) > 0.001) warn.push({ pid: l.pid, vid: l.vid, list: v.price, sold: l.price });
      total += l.qty * l.price;
      return { pid: l.pid, vid: l.vid, n: p.get('name'), qty: l.qty, price: l.price };
    });
    total = Math.round(total * 100) / 100;
    const no = (q.exists && typeof q.get('n') === 'number' ? q.get('n') : 0) + 1;
    const now = Date.now();
    const doc = { no, br, dev: dev || null, items, total, pay: pay || null, at: at || now, srv: now, reqId, demo: !!input.demo };
    if (custId) doc.custId = custId;
    if (warn.length) doc.warn = warn;
    tx.set(ref, doc); w++;
    tx.set(seq, { n: no }); w++;
    if (!opt.noStock) for (const it of items) { tx.set(db.doc(P(`stock/${br}_${it.pid}_${it.vid}`)), { q: FieldValue.increment(-it.qty), br, pid: it.pid, vid: it.vid }, { merge: true }); w++; }
    if (!opt.noDay) { tx.set(db.doc(P(`posday/${br}_${dayKey(doc.at)}`)), { cnt: FieldValue.increment(1), sum: FieldValue.increment(total), br }, { merge: true }); w++; }
    out = { id: ref.id, no, total, dup: false };
  }, { maxAttempts: opt.maxAttempts || 5 });
  ops.writes += w;
  return out;
}

module.exports = { posSale, counter, dayKey };
