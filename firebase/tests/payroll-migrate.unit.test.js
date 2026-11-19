'use strict';
// שכר, שלב ב' (18.11.2026) – מיגרציה ב-ensure() של האפליקציה, בלי אמולטור:
//   ensure מוסיף רק S.wh / S.bon / S.psl כמערכים ריקים (כשחסרים או כשהם לא מערך), ולא נוגע בשום דבר אחר.
//   "לפני" = אותה ensure מ-index.html בלי שורת השכר (כלומר כמו שהייתה), "אחרי" = ensure הנוכחית.
//   מצב שמור (שכבר עבר את ensure הישנה) + ensure החדשה ← JSON זהה, חוץ מ-3 המערכים. רשומות קיימות (כולל subs[].pay) לא משתנות.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = path.join(__dirname, '..', '..', 'app-source', 'www', 'index.html');
const PAY = "['wh','bon','psl','enotes'].forEach(k=>{if(!Array.isArray(d[k]))d[k]=[]});", PAY_END = "x.nmig=1}catch(e){}});"; // PAY..PAY_END = מיגרציית שכר + הערות עובד (S.enotes, הגירה מ-ext.notes)

// הקוד של ensure מתוך index.html: מ-"function ensure(d){" עד " return d}"
function ensureSrc() {
  const h = fs.readFileSync(HTML, 'utf8'), a = h.indexOf('function ensure(d){'), b = h.indexOf('\n return d}', a);
  assert.ok(a > 0 && b > a && b - a < 6000, 'ensure לא נמצאה במקום הצפוי ב-index.html');
  return h.slice(a, b + 11);
}
// הרצה בהקשר נפרד (מערכים מהקשר אחר – משווים ב-JSON ולא ב-deepEqual). uid צפוי (מונה), heKey כמו באפליקציה בקירוב (רק להשוואת שמות)
function mk(src) {
  let n = 0; const ctx = { uid: () => 'u' + (++n), heKey: (s) => String(s || '').replace(/\s+/g, ' ').trim() };
  vm.createContext(ctx); vm.runInContext(src + '\nthis.ensure=ensure;', ctx); return (d) => ctx.ensure(d);
}
const SRC = ensureSrc();
const ensureNew = () => mk(SRC);
const ensureOld = () => { assert.ok(SRC.includes(PAY), 'שורת המיגרציה של השכר לא נמצאה ב-ensure'); const a = SRC.indexOf(PAY), b = SRC.indexOf(PAY_END); assert.ok(b > a, 'סוף מיגרציית ההערות לא נמצא'); return mk(SRC.slice(0, a) + SRC.slice(b + PAY_END.length)); };
const J = (o) => JSON.stringify(o);
const clone = (o) => JSON.parse(J(o));
const strip = (o) => { const c = clone(o); delete c.wh; delete c.bon; delete c.psl; delete c.enotes; return c; };

// גיבויים / מצבים ישנים לדוגמה (נתונים סינתטיים)
const OLD = [
  {},
  { v: 1, cats: [{ id: 'e_sal', kind: 'exp', name: 'משכורות', beh: 'emp' }], subs: [{ id: 's1', cat: 'e_sal', name: 'דנה', ext: { role: 'קופאית', phone: '050-0000000' } }],
    tx: [{ id: 't1', t: 'exp', cat: 'e_sal', sub: 's1', date: '2026-10-31', amt: 5200.5, plan: '2026-10', pays: [{ id: 'p1', d: '2026-11-01', a: 5200.5, m: 'מזומן' }] },
      { id: 't2', t: 'exp', cat: 'e_sal', sub: 's1', date: '2026-11-10', amt: -120, plan: '2026-11', pays: [] }],
    fixTpl: [], loans: [], ccx: [], inbox: [], theme: 'dark', fs: 2, pmOff: 3 },
  { cats: [{ id: 'i_yh', kind: 'inc', name: 'קופה', beh: 'simple' }], subs: [], tx: [], zc: [{ id: 'z1' }], zcMig: 1, ownExp: false, zcThr: 50,
    subs2: 'x', orgC: { branches: [] }, fixOk: { a: 1 } },
  { cats: 'פגום', subs: null, tx: {}, inbox: 5 },
];

describe('ensure – מיגרציית שכר (S.wh, S.bon, S.psl)', () => {
  it('מצב שמור ישן: אחרי ensure החדשה זהה ב-JSON, חוץ מ-3 מערכים ריקים', () => {
    OLD.forEach((o, i) => {
      const saved = ensureOld()(clone(o)); // כמו שנשמר בטלפון עד היום
      const r = ensureNew()(clone(saved));
      assert.equal(J([r.wh, r.bon, r.psl]), '[[],[],[]]', 'מקרה ' + i);
      assert.equal(J(strip(r)), J(saved), 'מקרה ' + i + ': שדה אחר השתנה');
    });
  });
  it('גיבוי גולמי ישן (לפני כל ensure): ההבדל היחיד בין הישנה לחדשה הוא 3 המערכים', () => {
    OLD.forEach((o, i) => {
      const a = ensureOld()(clone(o)), b = ensureNew()(clone(o));
      assert.equal(J(strip(b)), J(a), 'מקרה ' + i);
      assert.deepEqual(Object.keys(b).filter((k) => !(k in a)).sort(), ['bon', 'enotes', 'psl', 'wh'], 'מקרה ' + i);
    });
  });
  it('נתוני שכר קיימים לא משתנים; ערך שאינו מערך ← מערך ריק; ensure פעמיים = פעם אחת', () => {
    const wh = [{ id: 'h1', sub: 's1', d: '2026-11-01', in: '08:00', out: '16:00', brk: 30, src: 'man', n: '' }];
    const bon = [{ id: 'b1', sub: 's1', mon: '2026-11', a: 300, n: 'מכירות' }];
    const psl = [{ id: 'q1', sub: 's1', mon: '2026-10', f: 'ps1', name: 'x.pdf', gross: 6000, net: 5200.5, ec: [{ k: 'bl', n: 'ביטוח לאומי', a: 210 }], src: 'man', ok: 1, at: 5 }];
    const pay = { mode: 'hr', rate: 45, m: 'מזומן', slip: false, uid: 'w1', rules: [{ id: 'r1', d: [5], s: '22:00', e: '06:00', r: 55 }], add: [{ id: 'a1', n: 'נסיעות', k: 'day', a: 22.5 }] };
    const st = ensureNew()(clone(Object.assign({}, OLD[1], { wh, bon, psl, subs: [Object.assign({}, OLD[1].subs[0], { pay })] })));
    assert.equal(J(st.wh), J(wh)); assert.equal(J(st.bon), J(bon)); assert.equal(J(st.psl), J(psl)); assert.equal(J(st.subs[0].pay), J(pay));
    assert.equal(J(ensureNew()(clone(st))), J(st), 'ensure פעם שנייה שינתה משהו');
    const bad = ensureNew()(clone(Object.assign({}, OLD[1], { wh: { a: 1 }, bon: 'x', psl: null })));
    assert.equal(J([bad.wh, bad.bon, bad.psl]), '[[],[],[]]');
  });
});

describe('ensure – הערות עובד (S.enotes, הגירה מ-ext.notes)', () => {
  const st = () => ({ cats: [{ id: 'e_sal', kind: 'exp', beh: 'emp' }], subs: [{ id: 's1', cat: 'e_sal', name: 'דנה', ext: { start: '2025-03-01', notes: 'ישן' } }, { id: 's2', cat: 'e_sal', name: 'בלי', ext: { notes: '  ' } }, { id: 's3', cat: 'e_sal', name: 'ג' }] });
  it('הערה ox:1 אחת לכרטיס עם ext.notes; ext.notes לא משתנה; הרצה חוזרת בלי כפילות', () => {
    const e = ensureNew(), r = e(st()); e(r); e(r);
    assert.equal(r.enotes.length, 1); const n = r.enotes[0];
    assert.equal(J([n.sub, n.t, n.d, n.ox]), J(['s1', 'ישן', '2025-03-01', 1]));
    assert.equal(r.subs[0].ext.notes, 'ישן'); assert.equal(r.subs[1].ext.notes, '  ');
  });
  it('הערה מועברת שנמחקה לא נוצרת מחדש', () => {
    const e = ensureNew(), r = e(st()); r.enotes = []; e(r); assert.equal(r.enotes.length, 0);
  });
  it('S.enotes שאינו מערך מתוקן; הערות קיימות לא משתנות', () => {
    const e = ensureNew(), a = e({ enotes: 5 }); assert.equal(J(a.enotes), '[]');
    const b = e({ enotes: [{ id: 'x', sub: 's9', t: 'ת', d: '2026-01-01', at: 'a' }] }); assert.equal(b.enotes.length, 1);
  });
});
