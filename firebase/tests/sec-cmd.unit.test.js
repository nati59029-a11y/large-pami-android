'use strict';
// המזכירה – פקודות משימה בתוך האפליקציה (app-source/www/sec-cmd.js): בדיקות יחידה, בלי אמולטור ובלי רשת.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../app-source/www/sec-cmd.js');

const STAFF = [
  { uid: 'u1', name: 'מרים כהן' },
  { uid: 'u2', name: 'דני לוי' },
  { uid: 'u3', name: 'דני אברהם' },
  { uid: 'u4', name: 'שרה' },
  { uid: 'u5', name: 'יוסי' },
  { uid: 'u6', name: 'לאה', em: 'leah' },
];
// יום ראשון 22.11.2026, 14:00 (שעון ישראל)
const NOW = { y: 2026, m: 10, d: 22, h: 14, n: 0, dow: 0 };
const P = (t, now) => C.parse(t, { staff: STAFF, now: now || NOW });
const due = (r) => r.due && [r.due.d, r.due.m + 1, r.due.h, r.due.n].join('/');
const uids = (r) => r.to.map((z) => z.uid).join(',');

describe('sec-cmd: יצירת משימה', () => {
  it('נקבה + שם פרטי + "עד מחר"', () => {
    const r = P('פתחי למרים משימה לסדר את מחלקת האפייה עד מחר');
    assert.equal(r.k, 'new'); assert.equal(uids(r), 'u1');
    assert.equal(r.txt, 'לסדר את מחלקת האפייה'); assert.equal(due(r), '23/11/23/59'); assert.equal(r.pri, '');
  });
  it('בלי המילה "משימה": "תני ל… ל…" + יום בשבוע + דחוף', () => {
    const r = P('תני ליוסי לנקות את המחסן עד יום חמישי דחוף');
    assert.equal(uids(r), 'u5'); assert.equal(r.txt, 'לנקות את המחסן'); assert.equal(due(r), '26/11/23/59'); assert.equal(r.pri, 'h');
  });
  it('זכר: "פתח משימה ל…" (שם בסוף החלק הראשון)', () => {
    const r = P('פתח משימה לשרה לבדוק את המקרר');
    assert.equal(r.k, 'new'); assert.equal(uids(r), 'u4'); assert.equal(r.txt, 'לבדוק את המקרר');
  });
  it('"תן ל…" בזכר', () => {
    const r = P('תן ליוסי לסדר את המדפים מחרתיים');
    assert.equal(uids(r), 'u5'); assert.equal(r.txt, 'לסדר את המדפים'); assert.equal(due(r), '24/11/23/59');
  });
  it('לכל העובדים עם נקודתיים', () => {
    const r = P('משימה לכל העובדים: לשטוף את הרצפה');
    assert.equal(r.all, true); assert.equal(r.txt, 'לשטוף את הרצפה'); assert.equal(r.due, null);
  });
  it('שני עובדים: "לשרה ולמרים" + מחרתיים בבוקר', () => {
    const r = P('פתחי משימה לשרה ולמרים לסדר מדפים מחרתיים בבוקר');
    assert.equal(uids(r), 'u4,u1'); assert.equal(r.txt, 'לסדר מדפים'); assert.equal(due(r), '24/11/9/0');
  });
  it('ניקוד וכתיב מלא/חסר בשם', () => {
    assert.equal(uids(P('פִּתְחִי לְמִרְיָם משימה לנקות')), 'u1');
    assert.equal(uids(P('פתחי למירים משימה לנקות')), 'u1');
  });
  it('שם מלא של שתי מילים מכריע בין שני "דני"', () => {
    const r = P('פתחי לדני לוי משימה להזמין קמח');
    assert.equal(uids(r), 'u2'); assert.equal(r.amb, null); assert.equal(r.txt, 'להזמין קמח');
  });
  it('שם שמתחיל ב-ל ("ללאה")', () => {
    assert.equal(uids(P('תני ללאה לקפל קרטונים')), 'u6');
  });
  it('שם כפול → amb עם שני העובדים', () => {
    const r = P('תני לדני לנקות את המחסן');
    assert.ok(r.amb); assert.deepEqual(r.amb.list.map((z) => z.uid).sort(), ['u2', 'u3']); assert.equal(r.to.length, 0);
  });
  it('שם לא קיים (עם "משימה") → unk', () => {
    const r = P('פתחי לאבי משימה לסדר את המחסן');
    assert.equal(r.unk, 'אבי'); assert.equal(r.to.length, 0); assert.equal(r.txt, 'לסדר את המחסן');
  });
  it('שם לא קיים בלי "משימה" ("תני לאבי לנקות") → unk', () => {
    assert.equal(P('תני לאבי לנקות את המחסן').unk, 'אבי');
  });
  it('אין נמען ואין טקסט: "משימה חדשה לעובד"', () => {
    const r = P('משימה חדשה לעובד');
    assert.equal(r.k, 'new'); assert.equal(r.to.length, 0); assert.equal(r.all, false); assert.equal(r.unk, ''); assert.equal(r.txt, '');
  });
  it('יש נמען בלי טקסט', () => {
    const r = P('פתחי משימה ליוסי');
    assert.equal(uids(r), 'u5'); assert.equal(r.txt, '');
  });
  it('תאריך DD/MM ושעה "ב-10"', () => {
    const r = P('פתחי לשרה משימה להזמין קמח עד 25/12 ב-10');
    assert.equal(r.txt, 'להזמין קמח'); assert.equal(due(r), '25/12/10/0');
  });
  it('"בעוד 3 ימים" ו"בשעה 16:30"', () => {
    assert.equal(due(P('תני לשרה לבדוק מלאי בעוד 3 ימים')), '25/11/23/59');
    assert.equal(due(P('תני לשרה לבדוק מלאי מחר בשעה 16:30')), '23/11/16/30');
  });
  it('"היום" ושעה שעברה → err past', () => {
    const r = P('פתחי ליוסי משימה לנקות היום ב-10');
    assert.equal(r.err, 'past');
  });
  it('שעה בלי יום שכבר עברה → מחר', () => {
    assert.equal(due(P('פתחי ליוסי משימה לנקות ב-11:00')), '23/11/11/0');
  });
  it('אותו יום בשבוע = השבוע הבא; "לא דחוף" לא מסמן דחוף', () => {
    const r = P('פתחי ליוסי משימה לנקות עד יום ראשון לא דחוף');
    assert.equal(due(r), '29/11/23/59'); assert.equal(r.pri, ''); assert.equal(r.txt, 'לנקות');
  });
  it('DD/MM שכבר עבר השנה → השנה הבאה', () => {
    const r = P('פתחי לשרה משימה לספור מלאי עד 3/1');
    assert.equal(r.due.y, 2027); assert.equal(r.due.m, 0); assert.equal(r.due.d, 3);
  });
  it('תאריך לא קיים (31/2) נשאר בטקסט ולא נחשב יעד', () => {
    const r = P('פתחי לשרה משימה לבדוק 31/2');
    assert.equal(r.due, null);
  });
});

describe('sec-cmd: מעקב', () => {
  const K = (t) => (P(t) || {}).k || null;
  it('באיחור', () => { assert.equal(K('מה באיחור?'), 'late'); assert.equal(K('כמה משימות באיחור'), 'late'); assert.equal(K('אילו משימות מאחרות?'), 'late'); });
  it('ממתין לאישור', () => { assert.equal(K('מה ממתין לאישור?'), 'wait'); assert.equal(K('ממתין לאישור'), 'wait'); assert.equal(K('משימות שמחכות לאישור'), 'wait'); });
  it('מצב המשימות', () => { assert.equal(K('מצב המשימות'), 'status'); assert.equal(K('מה מצב המשימות היום?'), 'status'); assert.equal(K('תגידי לי מה המצב של המשימות'), 'status'); });
  it('מי לא עומד במשימות', () => { assert.equal(K('מי לא עומד במשימות?'), 'lag'); assert.equal(K('מי הכי מאחר במשימות'), 'lag'); });
  it('להיום ודחופות', () => { assert.equal(K('משימות להיום'), 'today'); assert.equal(K('אילו משימות דחופות?'), 'urg'); });
});

describe('sec-cmd: תזכורת והעברה', () => {
  it('"הזכירי ל… על המשימה של …"', () => {
    const r = P('הזכירי ליוסי על המשימה של המחסן');
    assert.equal(r.k, 'nd'); assert.equal(uids(r), 'u5'); assert.deepEqual(r.q, ['המחסן']);
  });
  it('"תעבירי את המשימה של … ל…"', () => {
    const r = P('תעבירי את המשימה של המחסן לשרה');
    assert.equal(r.k, 'mv'); assert.equal(uids(r), 'u4'); assert.deepEqual(r.q, ['המחסן']);
  });
  it('העברה לשם כפול → amb', () => {
    assert.ok(P('תעבירי את המשימה של המחסן לדני').amb);
  });
  it('matchTasks: לפי מילה, לפי עובד, רק פתוחות', () => {
    const T = [
      { id: 'a', st: 'open', txt: 'לנקות את המחסן', ow: 'u5', owN: 'יוסי', to: ['u5'], cr: 1 },
      { id: 'b', st: 'open', txt: 'לסדר את המחסן הקדמי', ow: 'u4', owN: 'שרה', to: ['u4'], cr: 2 },
      { id: 'c', st: 'done', txt: 'מחסן ישן', ow: 'u5', to: ['u5'], cr: 3 },
      { id: 'd', st: 'open', txt: 'להזמין קמח', ow: '', to: ['u1', 'u5'], cr: 4 },
    ];
    assert.deepEqual(C.matchTasks(['המחסן'], T).map((t) => t.id), ['a', 'b']);
    assert.deepEqual(C.matchTasks(['המחסן'], T, { uid: 'u5' }).map((t) => t.id), ['a']);
    assert.deepEqual(C.matchTasks(['הקדמי', 'מחסן'], T).map((t) => t.id), ['b']);
    assert.deepEqual(C.matchTasks([], T, { uid: 'u5' }).map((t) => t.id), ['a', 'd']);
  });
});

describe('sec-cmd: לא נתפס (ממשיך ל-AI)', () => {
  const NOT = [
    'כמה משימות היו בחודש שעבר?',
    'מה קרה היום?',
    'תזרים לחודש',
    'אילו חשבוניות באיחור?',
    'מה ממתין לאישור בחשבוניות?',
    'תזכירי לי מחר ב-10 להתקשר לספק',
    'תזכירי לי על המשימה של המחסן',
    'תני לי סיכום משימות של השבוע',
    'פתחי את מסך המשימות',
    'מה עם המשימה של דני?',
    'איך פותחים משימה חוזרת?',
    'שלחי לדני הודעה בווצאפ',
    'תני לדני את הדוח',
    'תעבירי את החשבונית לרואה החשבון',
    'מי מאחר היום?',
    'מה המצב של ההזמנות?',
    'תגידי לרואה החשבון שהדוח מוכן',
    'כמה משימות פתוחות יש לכל עובד בחודש האחרון?',
  ];
  for (const t of NOT) it(t, () => assert.equal(P(t), null));
});

describe('sec-cmd: עזרים', () => {
  it('label', () => {
    assert.equal(C.label({ y: 2026, m: 10, d: 22, h: 23, n: 59 }, NOW), 'היום 23:59');
    assert.equal(C.label({ y: 2026, m: 10, d: 23, h: 9, n: 5 }, NOW), 'מחר 09:05');
    assert.equal(C.label({ y: 2026, m: 10, d: 26, h: 23, n: 59 }, NOW), 'יום ה׳ 26/11 23:59');
  });
  it('matchStaff: מייל, שם משפחה, ריק', () => {
    assert.deepEqual(C.matchStaff('leah', STAFF).map((z) => z.uid), ['u6']);
    assert.deepEqual(C.matchStaff('כהן', STAFF).map((z) => z.uid), ['u1']);
    assert.deepEqual(C.matchStaff('', STAFF), []);
  });
  it('body: יעד ועדיפות מתשובה חופשית', () => {
    const b = C.body('לנקות את המחסן עד מחר דחוף', NOW);
    assert.equal(b.txt, 'לנקות את המחסן'); assert.equal(b.pri, 'h'); assert.equal(b.due.d, 23);
  });
});
