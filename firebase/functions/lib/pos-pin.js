'use strict';
// POS:W2 – איחוד גל 2 (18.11.2026): החיבור בין אישור שני של הגדרה רגישה (ש4, pos-cfg.js) לקוד ה-PIN של העובדים (ש5, pospin).
// verifyOwner(db, pin) → uid של בעל העסק שהקוד שלו תואם, או null.
//   בעל עסק = admins/{uid}.own === true (כמו posOwn בכללים). אין בעלים מסומן – null: מנהל רגיל לא יכול לאשר לעצמו בקוד שלו.
//   קוד נעול אצל ש5 (5 טעויות – lockUntil) לא נבדק. המונה והנעילה של האישור השני – ב-pos-cfg.js (poscfg/apprlock), לא כאן.
const AG = require('./pos-agg');

async function verifyOwner(db, pin) {
  if (typeof pin !== 'string' || !/^[0-9]{4,8}$/.test(pin)) return null;
  const ad = await db.collection('admins').where('own', '==', true).limit(20).get();
  const now = Date.now();
  for (const d of ad.docs) {
    const s = await db.doc('pospin/' + d.id).get();
    const rec = s.exists ? s.data() : null;
    if (!rec || !rec.h) continue;
    if (AG.lockState(rec, now).locked) continue;
    if (AG.pinMatch(pin, rec)) return d.id;
  }
  return null;
}

module.exports = { verifyOwner };
