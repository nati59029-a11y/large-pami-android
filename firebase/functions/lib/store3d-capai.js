'use strict';
// הקמת חנות שלב 5 (17.11.2026): הלוגיקה הטהורה של "בדיקה חכמה" לפריט (s3CapCheck) ו"המערכת מציעה" (s3CapDec), בלי Firestore.
// חוזה: תוצרים/0-חוזה-נתונים.md – 3.3 (cap, ai, prods, diff, גודל עד 60,000 בתים), 3.5 (fx.st), 3.7 (s3use/s_{mapId}), 4 (s3SetupLim).
//   setupQuota(doc, o)     – מכסת הקמה חד-פעמית למפה: lim = 2 × מקטעים + 50, גדל לבד כשהמפה גדלה ולא יורד; תקרה ידנית (limBy) לא משתנה.
//   setupRefund(doc, k)    – החזרה (רק כשהמודל לא ענה). setupLim(doc, lim, uid, now) – שינוי התקרה (מנהל־על).
//   buildAi(cl, o)         – תשובה נקייה ← ai (st auto ≥ 0.8 / rev), כולל diff של סוג/קומות/מקטעים מול המפה – תמיד rev (באישור).
//   applyPhotos(ph, cl, …) – quad/xr/yr/q מה-AI לתמונות. תמונה שנערכה ידנית (man: 1, op geo) – quad/xr/yr לא נדרסים (q כן).
//   capSt(doc, item, uid, now) – מצב הפריט אחרי הבדיקה/החלטה (ok רק עם חזית, כיסוי ≥ 0.95, שני הקצוות, בלי diff ממתין – או חזית ידנית שאושרה).
//   fitSize(doc)           – מסמך cap עד 60,000 בתים: קודם מוצרים בביטחון נמוך, אחר כך diff שאינו ממתין, אחר כך gaps. ai.cut = כמה הוצאו.
//   kindFx(fx, kind)       – סוג חדש לגוף: בסיסי ב-k (בלי st), מפורט ב-st עם k בסיסי (fx.k לא מורחב). expAdd – "העתק לרשימה".
const P = require('./prompts-bayscan');

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const inR = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
function fail(code, msg, extra) { const e = new Error(msg || code); e.code = code; if (extra) e.extra = extra; return e; }

const AUTO = 0.8, COV_OK = 0.95, LIM_MAX = 100000, DOC_MAX = 60000, EXP_MAX = 60;
// סוג מפורט (fx.st) ← k בסיסי מחייב (חוזה 3.5). oth – כל k
const ST_BASE = { dfr: 'fridge', ofr: 'fridge', frz: 'fridge', pal: 'table', rack: 'stand', ctr: 'table', oth: null };
const BASE_K = ['gon', 'wall', 'fridge', 'table', 'stand', 'bin'];
const TWO = ['gon', 'table', 'stand'];

// ---------- מכסת הקמה (s3use/s_{mapId}) ----------
const baseLim = (bays) => Math.min(LIM_MAX, 2 * Math.max(0, bays | 0) + 50);
// doc = המסמך הקיים או null. o = { bays, k, now }. מחזיר { doc (לכתיבה עם merge), warn, usage } או זורק s3-setup-limit
function setupQuota(doc, o) {
  const d = isObj(doc) ? doc : {};
  const base = baseLim(o.bays);
  const lim0 = inR(d.lim, 0, LIM_MAX) ? d.lim : base;
  const lim = typeof d.limBy === 'string' && d.limBy ? lim0 : Math.max(lim0, base);
  const n0 = inR(d.n, 0, LIM_MAX) ? d.n : 0, k = o.k || 1;
  if (n0 + k > lim) throw fail('s3-setup-limit', `נגמרה מכסת הבדיקות החכמות של ההקמה במפה הזו (${n0} מתוך ${lim}). מנהל המערכת יכול להגדיל אותה.`, { n: n0, lim });
  const n = n0 + k, hi = n >= 0.8 * lim;
  const had = d.w80 === true && hi;   // התקרה גדלה מתחת ל-80% – ההתראה תישלח שוב כשיגיעו
  const warn = hi && !had;
  return { doc: { n, lim, w80: had || warn, upd: o.now }, warn, usage: { n, lim, w80: hi } };
}
function setupRefund(doc, k, now) {
  if (!isObj(doc) || !inR(doc.n, 0, LIM_MAX)) return null;
  return { n: Math.max(0, doc.n - (k || 1)), upd: now };
}
// s3SetupLim: n לא משתנה; lim < n מותר (= חסום). w80 מתאפס כש-n < 80% מהתקרה החדשה
function setupLim(doc, lim, uid, now) {
  const d = isObj(doc) ? doc : {};
  const n = inR(d.n, 0, LIM_MAX) ? d.n : 0;
  const out = { n, lim, limBy: uid, limAt: now, upd: now };
  out.w80 = d.w80 === true && n >= 0.8 * lim;
  return out;
}

// ---------- תוצאת ה-AI ----------
const kindOf = (fx) => (isObj(fx) ? (typeof fx.st === 'string' && fx.st in ST_BASE ? fx.st : fx.k) : '');
// cl = cleanBayScan. o = { item, fx, now }. מחזיר ai (חוזה 3.3ב) + per (מספרי התמונות עם אדם – לא נשמר במסמך)
function buildAi(cl, o) {
  const ai = { cov: cl.cov, conf: cl.conf, ver: P.VERSION, at: o.now };
  if (cl.ends.length) ai.ends = cl.ends;
  if (cl.gaps.length) ai.gaps = cl.gaps;
  if (cl.retake) ai.retake = cl.retake;
  const diff = [];
  if (o.item.k === 'b') {
    if (cl.kind) { ai.kind = cl.kind; if (cl.kc !== undefined) ai.kc = cl.kc; }
    if (cl.lvl) ai.lvl = cl.lvl;
    ai.prods = cl.prods.map((p) => Object.assign({}, p, { st: p.conf >= AUTO ? 'auto' : 'rev' }));
    const fx = o.fx || {}, cur = kindOf(fx), conf = cl.kc !== undefined ? cl.kc : cl.conf;
    // שינוי סוג / קומות / מקטעים – תמיד באישור (rev), גם בביטחון גבוה
    if (cl.kind && cur && cl.kind !== cur) diff.push({ k: 'kind', was: P.KIND_HE[cur] || cur, got: P.KIND_HE[cl.kind], conf });
    if (cl.lvl && inR(fx.lvl, 1, 12) && cl.lvl !== fx.lvl) diff.push({ k: 'lvl', was: String(fx.lvl), got: String(cl.lvl), conf: cl.conf });
    if (cl.bays && cl.bays !== 1) diff.push({ k: 'bays', was: '1', got: String(cl.bays), conf: cl.conf });
  }
  for (const d of cl.diff) diff.push(d);
  // רוחב – רק לידיעה (מתקנים בעורך); מוצר / קטגוריה – ≥ 0.8 נכנס לבד עם ביטול
  ai.diff = diff.slice(0, P.LIM.diff).map((d) => Object.assign(d, { st: d.k === 'prod' || d.k === 'cat' ? (d.conf >= AUTO ? 'auto' : 'rev') : 'rev' }));
  if (!ai.diff.length) delete ai.diff;
  if (ai.prods && !ai.prods.length) delete ai.prods;
  return ai;
}
// ph = רשימת התמונות במסמך (בזמן הכתיבה). sent = [{ n, i }] – אילו תמונות נשלחו ובאיזה מספר. מחזיר { ph, drop: [תמונות עם אדם] }
function applyPhotos(ph, cl, sent) {
  const byI = new Map(cl.photos.map((p) => [p.i, p])), per = new Set(cl.per);
  const nOf = new Map(sent.map((s) => [s.n, s.i]));
  const drop = [], out = [];
  for (const p0 of Array.isArray(ph) ? ph : []) {
    if (!isObj(p0)) { out.push(p0); continue; }
    const i = nOf.get(p0.n);
    if (i && per.has(i)) { drop.push(p0); continue; } // אדם בתמונה – התמונה לא נשמרת (כמו בבדיקת מדף)
    const r = i && byI.get(i);
    if (!r) { out.push(p0); continue; }
    const p = Object.assign({}, p0);
    if (p0.man !== 1) { if (r.quad) p.quad = r.quad; if (r.xr) p.xr = r.xr; if (r.yr) p.yr = r.yr; } // תיקון ידני לא נדרס
    if (r.q !== undefined) p.q = r.q;
    out.push(p);
  }
  return { ph: out, drop };
}

// ---------- מצב הפריט (חוזה 3.3, "מתי ok") ----------
// doc = המסמך אחרי השינוי; moved = הגיאומטריה זזה. משנה את doc (st, okBy, okAt) ומחזיר אותו
function capSt(doc, moved, uid, now) {
  if (doc.st === 'skip' || doc.st === 'orph') return doc;
  const ai = isObj(doc.ai) ? doc.ai : null;
  const pending = !!(ai && Array.isArray(ai.diff) && ai.diff.some((d) => d && d.st === 'rev'));
  const aiOk = !!(ai && typeof ai.cov === 'number' && ai.cov >= COV_OK && Array.isArray(ai.ends) && ai.ends.includes('l') && ai.ends.includes('r'));
  const manOk = doc.man === true && typeof doc.okBy === 'string';
  if (doc.fr && !moved && !pending && (aiOk || manOk)) {
    if (doc.st !== 'ok' || !doc.okBy) Object.assign(doc, { okBy: doc.okBy || uid, okAt: Number.isInteger(doc.okAt) ? doc.okAt : now });
    doc.st = 'ok';
  } else {
    doc.st = (Array.isArray(doc.ph) && doc.ph.length) || doc.fr ? 'part' : 'todo';
    if (!manOk || moved) { delete doc.okBy; delete doc.okAt; } // אישור ידני של חזית נשמר עד שה-diff יוכרע
  }
  return doc;
}

// ---------- גודל מסמך (הערכה בשיטת Firestore: מחרוזת = בתים ב-UTF-8 + 1, מספר 8, בוליאני 1, שם שדה + 1) ----------
function sizeOf(v) {
  if (v === null || v === undefined) return 1;
  if (typeof v === 'string') return Buffer.byteLength(v, 'utf8') + 1;
  if (typeof v === 'number') return 8;
  if (typeof v === 'boolean') return 1;
  if (Array.isArray(v)) return v.reduce((s, x) => s + sizeOf(x), 0);
  if (isObj(v)) return Object.keys(v).reduce((s, k) => s + Buffer.byteLength(k, 'utf8') + 1 + sizeOf(v[k]), 0) + 32;
  return 8;
}
// מקצץ את ai במקום (מוצרים בביטחון נמוך קודם, אחר כך diff שאינו ממתין, אחר כך gaps). מחזיר כמה הוצאו; זורק אם עדיין גדול
function fitSize(doc, max) {
  const M = (max || DOC_MAX) - 200; // מרווח לשם המסמך ולשדות שהשרת מוסיף
  let cut = 0;
  const ai = doc.ai;
  if (sizeOf(doc) <= M) return 0;
  if (isObj(ai) && Array.isArray(ai.prods)) {
    const all = ai.prods, ord = all.map((p, i) => i).sort((a, b) => all[a].conf - all[b].conf || b - a), out = new Set();
    for (const i of ord) { if (sizeOf(doc) <= M) break; out.add(i); ai.prods = all.filter((p, j) => !out.has(j)); cut++; }
  }
  if (isObj(ai) && Array.isArray(ai.diff)) while (sizeOf(doc) > M) { const j = ai.diff.findIndex((d) => d.st !== 'rev'); if (j < 0) break; ai.diff.splice(j, 1); cut++; }
  if (isObj(ai) && Array.isArray(ai.gaps)) while (sizeOf(doc) > M && ai.gaps.length) { ai.gaps.pop(); cut++; }
  if (cut && isObj(ai)) ai.cut = cut;
  if (sizeOf(doc) > M) throw fail('too-big', 'תוצאת הבדיקה גדולה מדי לשמירה');
  return cut;
}

// ---------- החלטות ("המערכת מציעה") ----------
// סוג חדש לגוף. מחזיר את הגוף החדש, או זורק kind-sides (גוף דו-צדדי שהסוג החדש שלו חד-צדדי – משנים בעורך)
function kindFx(fx, kind) {
  const f = Object.assign({}, fx);
  if (BASE_K.includes(kind)) { f.k = kind; delete f.st; } else if (kind in ST_BASE) { if (ST_BASE[kind]) f.k = ST_BASE[kind]; f.st = kind; } else throw fail('bad-kind', 'סוג לא מוכר');
  if (f.sides === 2 && !TWO.includes(f.k)) throw fail('kind-sides', 'לגוף הזה יש שני צדדים, והסוג החדש הוא חד-צדדי. שנו את הסוג בעורך המפה.');
  if (kind === 'dfr' && f.glass === undefined) f.glass = true;
  return f;
}
const norm = (s) => String(s || '').replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// "העתק לרשימה": מוצרים שנכנסו (auto / ok) ← bay.exp. רק הוספה: רשומות קיימות לא משתנות; שם שכבר ברשימה – לא נוסף; עד 60
function expAdd(exp, prods) {
  const L = Array.isArray(exp) ? exp.slice() : [];
  const have = new Set(L.filter(isObj).map((e) => norm(e.n)));
  let added = 0;
  for (const p of Array.isArray(prods) ? prods : []) {
    if (!isObj(p) || (p.st !== 'auto' && p.st !== 'ok') || typeof p.n !== 'string') continue;
    const k = norm(p.n);
    if (!k || have.has(k)) continue;
    if (L.length >= EXP_MAX) break;
    const e = { n: p.n.slice(0, 60) };
    if (typeof p.cat === 'string' && p.cat) e.c = p.cat.slice(0, 30);
    L.push(e); have.add(k); added++;
  }
  return { exp: L, added };
}

module.exports = { AUTO, COV_OK, DOC_MAX, EXP_MAX, ST_BASE, baseLim, setupQuota, setupRefund, setupLim, kindOf, buildAi, applyPhotos, capSt, sizeOf, fitSize, kindFx, expAdd };
