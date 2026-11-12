'use strict';
// תוכניות ניוד ברירת מחדל (2026-11-12): נטענות פעם אחת לכל עסק שהסלולר (cellular) מופעל אצלו –
// כשמנהל־העל מפעיל את המתג (setBusinessFeatures) או, בעסק שהמתג כבר פעיל בו, בכניסה הראשונה למסכי הניוד (ensureLinePlans).
// המקור: האקסל של בעל העסק (גיליון "כשרים" + גיליון "כללי") → line-plans-seed.json.
// אחרי הטעינה הכול רגיל: עריכה / הוספה / כיבוי / מחיקה. הסימון ordcfg/cell.seeded מונע טעינה חוזרת (גם אחרי מחיקה).
// לא נוגע בתוכניות קיימות: תוכנית עם אותו שם + חברה + מחיר חודשי לא נוספת שוב. חברות חסרות מצטרפות לרשימת חברות הניוד.
const SEED = require('./line-plans-seed.json');

const MAX_LIST = 30;
const keyOf = (p) => [p.carrier || '', p.name || '', typeof p.monthly === 'number' ? p.monthly : ''].join('|');

// db = Firestore של העסק (T.tdb() או prefixed). מחזיר { added, already }
async function seedLinePlans(db, opts) {
  const o = opts || {};
  const days = Number.isInteger(o.days) ? o.days : 60;
  const ref = db.doc('ordcfg/cell');
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists && s.get('seeded')) return { added: 0, already: true };
    const ex = await tx.get(db.collection('lineplan').limit(500));
    const have = new Set(ex.docs.map((d) => keyOf(d.data() || {})));
    const cur = s.exists && Array.isArray(s.get('carriers')) ? s.get('carriers').filter((x) => typeof x === 'string') : [];
    const carriers = [...new Set(cur.concat(SEED.carriers))].slice(0, MAX_LIST);
    const now = Date.now();
    let added = 0;
    for (const p of SEED.plans) {
      if (have.has(keyOf(p))) continue;
      have.add(keyOf(p));
      tx.set(db.collection('lineplan').doc(), Object.assign({}, p, { days, on: true, upd: now, by: o.by || 'seed', seed: SEED.v }));
      added++;
    }
    tx.set(ref, { carriers, seeded: now, upd: now }, { merge: true });
    return { added, already: false };
  });
}

module.exports = { seedLinePlans, SEED };
