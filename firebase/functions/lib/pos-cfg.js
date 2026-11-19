'use strict';
// קופה (POS), שלב 0 – הגדרות קופה לכל עסק (poscfg/main). פונקציות טהורות (בלי Firestore).
// מבנה כללי של מפתח-ערך עם ברירות מחדל בקוד, כדי שאפשר יהיה להוסיף הגדרה בשורה אחת ב-DEFS בלי לשנות שרת, כללים או מסך:
//   ערך בפועל = ברירת המחדל בקוד (DEFS[k].def) ← ברירת המחדל של סוג העסק (TYPES[type].d[k]) ← הערך שנשמר לעסק (poscfg/main.v[k]).
//   הגדרה מסוג obj מתמזגת לפי שדות (למשל discMax.lead לבד).
// poscfg/main = { type, v: { <מפתח>: <ערך> }, upd, by } – רק השרת כותב (posCfgSet). מפתח שנשמר ולא מוכר כאן (גרסה ישנה/חדשה) – מתעלמים.
// מי משנה: who 'sa' – מנהל־על בלבד; who 'mgr' – מנהל העסק או מנהל־על. סוג העסק – מנהל־על בלבד.
// הרשימה כאן היא ההתחלה (מתוכנית הקופה, פרק "הנתונים", poscfg/main). סשן האפיון (ה) משלים את הרשימה המלאה – מוסיפים שורות ל-DEFS.
// סכומים באגורות. reason בשגיאות: unknown-key, bad-value, not-allowed, bad-type.

const PAY = ['cash', 'card', 'link', 'phone', 'check', 'transfer', 'credit', 'voucher'];

// t: 'int' | 'num' | 'bool' | 'str' | 'enum' | 'arr' (תת-קבוצה של opts) | 'obj' (שדות f). min/max/re/opts לפי הסוג. n = שם בעברית למסך הניהול.
const DEFS = Object.freeze({
  vatRate: { n: 'שיעור מע"מ (%)', t: 'num', def: 18, min: 0, max: 100, who: 'sa' },
  discMax: { n: 'הנחה מרבית (%) – קופאי / אחראי משמרת', t: 'obj', who: 'mgr',
    f: { cashier: { n: 'קופאי', t: 'num', def: 5, min: 0, max: 100 }, lead: { n: 'אחראי משמרת', t: 'num', def: 15, min: 0, max: 100 } } },
  openCashDef: { n: 'מזומן בפתיחת משמרת (אגורות)', t: 'int', def: 50000, min: 0, max: 10000000, who: 'mgr' },
  lockMin: { n: 'נעילת מסך אחרי (דקות, 0 = בלי)', t: 'int', def: 3, min: 0, max: 120, who: 'mgr' },
  rcptFooter: { n: 'שורה בתחתית הקבלה', t: 'str', def: '', max: 200, who: 'mgr' },
  payOn: { n: 'אמצעי תשלום פעילים', t: 'arr', def: ['cash', 'card'], opts: PAY, who: 'mgr' },
  retDays: { n: 'ימים להחזרה', t: 'int', def: 14, min: 0, max: 365, who: 'mgr' },
  beginner: { n: 'מצב מתחיל', t: 'bool', def: true, who: 'mgr' },
  allocMin: { n: 'סף מספר הקצאה (אגורות, לפני מע"מ)', t: 'int', def: 500000, min: 0, max: 100000000, who: 'sa' },
  cashMax: { n: 'תקרת מזומן (אגורות)', t: 'int', def: 600000, min: 0, max: 100000000, who: 'sa' },
  wbc: { n: 'ברקוד משקל', t: 'obj', who: 'mgr',
    f: { prefix: { n: 'קידומת', t: 'str', def: '', max: 3, re: /^[0-9]{0,3}$/ }, mode: { n: 'מקודד', t: 'enum', def: 'price', opts: ['price', 'wt'] } } },
  retNoRcptPrice: { n: 'מחיר בהחזרה בלי קבלה', t: 'enum', def: 'cur', opts: ['cur', 'min90'], who: 'mgr' },
  cashRound: { n: 'עיגול מזומן (אגורות)', t: 'enum', def: 10, opts: [1, 10, 50, 100], who: 'sa' },
  stockBlock: { n: 'חסימת מכירה כשהמלאי 0', t: 'bool', def: false, who: 'mgr' },
  pinOffline: { n: 'אישור אחראי ב-PIN גם בלי רשת', t: 'bool', def: true, who: 'sa' },
});

// סוגי עסק. d = ברירות מחדל של הסוג (דורסות את DEFS). מוסיפים סוג – שורה כאן. 'general' – ברירת המחדל לעסק בלי סוג.
const TYPES = Object.freeze({
  general: { n: 'כללי', d: {} },
  disposables: { n: 'חד-פעמי ומוצרי אפייה', d: {} },
  grocery: { n: 'מכולת / מזון', d: {} },
  fashion: { n: 'ביגוד והנעלה', d: {} },
  electronics: { n: 'סלולר ואלקטרוניקה', d: {} },
  other: { n: 'אחר', d: {} },
});
const TYPE0 = 'general';
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;

const fail = (reason, msg) => { const e = new Error(msg || reason); e.reason = reason; return e; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (Array.isArray(v) ? v.slice() : isObj(v) ? Object.assign({}, v) : v);

// בדיקת ערך לפי הגדרה (ללא obj). מחזיר את הערך המנורמל או זורק bad-value
function check(d, v, k) {
  const bad = () => fail('bad-value', 'ערך לא תקין: ' + k);
  switch (d.t) {
    case 'int': if (!Number.isInteger(v) || v < d.min || v > d.max) throw bad(); return v;
    case 'num': if (typeof v !== 'number' || !Number.isFinite(v) || v < d.min || v > d.max) throw bad(); return Math.round(v * 100) / 100;
    case 'bool': if (typeof v !== 'boolean') throw bad(); return v;
    case 'str': if (typeof v !== 'string' || v.length > d.max || (d.re && !d.re.test(v)) || /[\u0000-\u001f]/.test(v)) throw bad(); return v;
    case 'enum': if (!d.opts.includes(v)) throw bad(); return v;
    case 'arr': {
      if (!Array.isArray(v) || v.some((x) => !d.opts.includes(x)) || new Set(v).size !== v.length) throw bad();
      return d.opts.filter((x) => v.includes(x)); // סדר קבוע
    }
    default: throw bad();
  }
}
function defOf(k, type, types) {
  const d = DEFS[k];
  const td = (types[type] || types[TYPE0]).d;
  if (d.t === 'obj') {
    const o = {};
    for (const [f, fd] of Object.entries(d.f)) o[f] = clone(fd.def);
    if (isObj(td[k])) Object.assign(o, td[k]);
    return o;
  }
  return Object.prototype.hasOwnProperty.call(td, k) ? clone(td[k]) : clone(d.def);
}
const typeOf = (doc, types) => (doc && Object.prototype.hasOwnProperty.call(types || TYPES, doc.type) ? doc.type : TYPE0);

// הערך בפועל של כל ההגדרות. ערך שמור לא תקין (למשל אחרי שינוי טווח) – נופל לברירת המחדל, לא מפיל את הקופה.
// → { type, cfg: { k: ערך }, src: { k: 'def'|'type'|'biz' } }. types – לבדיקות בלבד (ברירת מחדל TYPES)
function eff(doc, types) {
  types = types || TYPES;
  const type = typeOf(doc, types);
  const v = doc && isObj(doc.v) ? doc.v : {};
  const td = types[type].d;
  const cfg = {}, src = {};
  for (const [k, d] of Object.entries(DEFS)) {
    let val = defOf(k, type, types);
    src[k] = Object.prototype.hasOwnProperty.call(td, k) ? 'type' : 'def';
    if (Object.prototype.hasOwnProperty.call(v, k)) {
      try {
        if (d.t === 'obj') {
          if (!isObj(v[k])) throw fail('bad-value');
          const o = Object.assign({}, val);
          for (const [f, x] of Object.entries(v[k])) if (d.f[f]) o[f] = check(d.f[f], x, k + '.' + f);
          val = o;
        } else val = check(d, v[k], k);
        src[k] = 'biz';
      } catch (e) { /* ערך שמור לא תקין – ברירת המחדל */ }
    }
    cfg[k] = val;
  }
  return { type, cfg, src };
}

// שינוי: cur = poscfg/main הנוכחי (או null); p = { type?, set?: { k: ערך }, unset?: [k] }; role = 'sa' | 'mgr'.
// → המסמך החדש { type, v } (בלי upd/by). obj ב-set – חלקי מותר (משתלב עם מה שנשמר). unset מחזיר לברירת המחדל.
function patch(cur, p, role) {
  if (role !== 'sa' && role !== 'mgr') throw fail('not-allowed', 'אין הרשאה');
  p = isObj(p) ? p : {};
  const out = { type: typeOf(cur), v: Object.assign({}, cur && isObj(cur.v) ? cur.v : {}) };
  // מפתחות שנשמרו ואינם מוכרים עוד – נשארים (לא מוחקים נתונים), אבל eff מתעלם מהם
  if (p.type !== undefined) {
    if (role !== 'sa') throw fail('not-allowed', 'רק מנהל־על בוחר סוג עסק');
    if (typeof p.type !== 'string' || !Object.prototype.hasOwnProperty.call(TYPES, p.type)) throw fail('bad-type', 'סוג עסק לא מוכר');
    out.type = p.type;
  }
  const set = p.set === undefined ? {} : p.set;
  const unset = p.unset === undefined ? [] : p.unset;
  if (!isObj(set) || !Array.isArray(unset)) throw fail('bad-value', 'קלט לא תקין');
  for (const k of Object.keys(set).concat(unset)) {
    if (typeof k !== 'string' || !KEY_RE.test(k) || !Object.prototype.hasOwnProperty.call(DEFS, k)) throw fail('unknown-key', 'הגדרה לא מוכרת: ' + String(k).slice(0, 40));
    if (DEFS[k].who === 'sa' && role !== 'sa') throw fail('not-allowed', 'רק מנהל־על משנה את ההגדרה: ' + k);
  }
  for (const k of unset) delete out.v[k];
  for (const [k, x] of Object.entries(set)) {
    const d = DEFS[k];
    if (d.t === 'obj') {
      if (!isObj(x) || !Object.keys(x).length) throw fail('bad-value', 'ערך לא תקין: ' + k);
      const o = Object.assign({}, isObj(out.v[k]) ? out.v[k] : {});
      for (const [f, fx] of Object.entries(x)) {
        if (!d.f[f]) throw fail('unknown-key', 'הגדרה לא מוכרת: ' + k + '.' + String(f).slice(0, 20));
        o[f] = check(d.f[f], fx, k + '.' + f);
      }
      out.v[k] = o;
    } else out.v[k] = check(d, x, k);
  }
  return out;
}

// תיאור ההגדרות למסך הניהול (בלי RegExp)
function describe() {
  const one = (d) => { const o = { n: d.n, t: d.t }; for (const x of ['def', 'min', 'max', 'opts']) if (d[x] !== undefined) o[x] = clone(d[x]); return o; };
  return {
    defs: Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, Object.assign(one(d), { who: d.who }, d.f ? { f: Object.fromEntries(Object.entries(d.f).map(([f, fd]) => [f, one(fd)])) } : {})])),
    types: Object.entries(TYPES).map(([id, t]) => ({ id, n: t.n })),
  };
}

module.exports = { DEFS, TYPES, TYPE0, PAY, eff, patch, describe, check };
