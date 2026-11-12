'use strict';
// משימות קבועות (12.11.2026) – בדיקות יחידה בלי אמולטור:
//   1. tkDue/tkBiz בשרת (functions/lib/tk-time.js) = tkDue/tkBiz מהאפליקציה (index.html), כשהאפליקציה רצה בשעון ישראל
//      והשרת רץ ב-UTC ובניו יורק (אין תלות באזור הזמן של השרת). אלפי זמנים: שלוש שנים, כל החגים, מעברי שעון.
//   2. decide(rule, now) – הפונקציה הטהורה שמחליטה אם לפתוח משימה עכשיו ומה מפתח היום.
//   3. הפונקציה recurringTasks מיוצאת, מתוזמנת כל 5 דקות בשעון ישראל, באזור us-central1 בלבד.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FN = path.join(__dirname, '..', 'functions');
const TK = require(path.join(FN, 'lib', 'tk-time.js'));
const HTML = path.join(__dirname, '..', '..', 'app-source', 'www', 'index.html');

// הקוד של המשימות מהאפליקציה: מ-const TK_OFF עד function tkDue (כולל)
function appCode() {
  const L = fs.readFileSync(HTML, 'utf8').split('\n');
  const a = L.findIndex((l) => l.startsWith('const TK_OFF=')), b = L.findIndex((l) => l.startsWith('function tkDue('));
  assert.ok(a > 0 && b > a && b - a < 10, 'קוד המשימות באפליקציה לא נמצא במקום הצפוי');
  return L.slice(a, b + 1).join('\n');
}

// הזמנים לבדיקה (epoch ms): סריקה כל 47 דקות ב-2025–2028, כל דקה סביב 8 מעברי שעון, וכל שעה בחגים
function samples() {
  const out = [];
  for (let t = Date.UTC(2025, 0, 1); t < Date.UTC(2028, 11, 31); t += 47 * 60000) out.push(t);
  // מעברי שעון בישראל (שישי לפני ראשון האחרון של מרץ 02:00; ראשון האחרון של אוקטובר 02:00)
  for (const s of ['2025-03-28T00:00Z', '2025-10-26T00:00Z', '2026-03-27T00:00Z', '2026-10-25T00:00Z', '2027-03-26T00:00Z', '2027-10-31T00:00Z', '2028-03-24T00:00Z', '2028-10-29T00:00Z']) {
    const c = Date.parse(s);
    for (let t = c - 4 * 3600000; t < c + 4 * 3600000; t += 60000) out.push(t);
    for (let k = -4; k <= 4; k++) out.push(c + 22 * 3600000 + k * 60000, c - 2 * 3600000 + k); // סביב חצות ישראל, במילישניות
  }
  // ערב ראש השנה תשפ"ז – שמחת תורה, פסח תשפ"ז, שבועות, פורים, תשעה באב (נדחה) – כל 10 דקות
  for (const [s, e] of [['2026-09-10', '2026-10-06'], ['2027-04-19', '2027-05-01'], ['2027-06-09', '2027-06-14'], ['2027-03-21', '2027-03-25'], ['2026-07-21', '2026-07-25'], ['2027-08-10', '2027-08-14']]) {
    for (let t = Date.parse(s + 'T00:00Z') - 3 * 3600000; t < Date.parse(e + 'T00:00Z'); t += 10 * 60000) out.push(t);
  }
  return out;
}

// מריץ קוד בתהליך נפרד עם אזור זמן נתון ומחזיר JSON
// הקלט (JSON) עובר ב-stdin ונקרא למשתנה IN
function runTZ(tz, code, input) {
  const pre = "const IN=JSON.parse(require('fs').readFileSync(0,'utf8'));\n";
  return JSON.parse(execFileSync(process.execPath, ['-e', pre + code], { input: JSON.stringify(input), env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
}

describe('משימות קבועות – tkDue בשרת זהה לאפליקציה', () => {
  const T = samples();

  it(`tkDue: ${T.length} זמנים – האפליקציה בשעון ישראל = השרת ב-UTC = השרת בניו יורק`, () => {
    const app = runTZ('Asia/Jerusalem', `${appCode()}\nprocess.stdout.write(JSON.stringify({due:IN.map(tkDue),tz:Intl.DateTimeFormat().resolvedOptions().timeZone}))`, T);
    assert.equal(app.tz, 'Asia/Jerusalem');
    const srvCode = `const TK=require(${JSON.stringify(path.join(FN, 'lib', 'tk-time.js'))});process.stdout.write(JSON.stringify({due:IN.map(TK.tkDue),tz:Intl.DateTimeFormat().resolvedOptions().timeZone}))`;
    for (const tz of ['UTC', 'America/New_York']) {
      const srv = runTZ(tz, srvCode, T);
      assert.equal(srv.tz, tz);
      const bad = [];
      for (let i = 0; i < T.length; i++) if (app.due[i] !== srv.due[i]) bad.push(new Date(T[i]).toISOString());
      assert.deepEqual(bad.slice(0, 5), [], `${tz}: ${bad.length} זמנים שונים`);
    }
    console.log(`# tkDue: ${T.length} זמנים זהים (אפליקציה Asia/Jerusalem מול שרת UTC ו-America/New_York)`);
  });

  it('tkBiz: כל יום ב-2025–2028 – אותה תשובה כמו באפליקציה', () => {
    const days = [];
    for (let t = Date.UTC(2025, 0, 1); t < Date.UTC(2029, 0, 1); t += 86400000) { const d = new Date(t); days.push([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]); }
    const app = runTZ('Asia/Jerusalem', `${appCode()}\nprocess.stdout.write(JSON.stringify(IN.map(([y,m,d])=>tkBiz(new Date(y,m,d,9)))))`, days);
    const srv = days.map(([y, m, d]) => TK.tkBiz({ y, m, d }));
    const bad = days.filter((_, i) => app[i] !== srv[i]).map((x) => x.join('-'));
    assert.deepEqual(bad, []);
    const off = days.filter(([y, m, d], i) => !srv[i] && new Date(Date.UTC(y, m, d)).getUTCDay() <= 4).length;
    assert.ok(off >= 4 * 15, 'נמצאו רק ' + off + ' ימי חג בימי חול');
    console.log(`# tkBiz: ${days.length} ימים זהים, מהם ${off} ימי חג/ערב חג בימי ראשון–חמישי`);
  });

  it('דוגמאות ידועות: ראש השנה תשפ"ז (12–13.9.2026) וערבו, יום כיפור, פורים תשפ"ז, תשעה באב נדחה', () => {
    const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return { y, m: m - 1, d: dd }; };
    assert.equal(TK.tkBiz(d('2026-09-10')), true);   // חמישי, כ"ח אלול – יום רגיל
    assert.equal(TK.isHoliday(d('2026-09-11')), true); // ערב ראש השנה (כ"ט אלול)
    assert.equal(TK.isHoliday(d('2026-09-12')), true); // א' תשרי
    assert.equal(TK.isHoliday(d('2026-09-21')), true); // יום כיפור
    assert.equal(TK.tkBiz(d('2026-09-14')), true);   // ראשון, ג' תשרי (צום גדליה – יום עסקים בלוח הזה)
    assert.equal(TK.isHoliday(d('2027-03-23')), true); // פורים תשפ"ז (י"ד אדר ב')
  });

  it('tkDue: משימה שנפתחת בשלישי 07:00 שעון ישראל – 72 שעות עסקים: שלישי, רביעי, חמישי – יעד ראשון 07:00 (שישי ושבת לא נספרים)', () => {
    const t = TK.zoned(2026, 10, 17, 7, 0); // שלישי 17.11.2026 07:00
    const due = TK.tkDue(t);
    const w = TK.wall(due);
    assert.deepEqual([w.y, w.m + 1, w.d, w.hh, w.mm], [2026, 11, 22, 7, 0]); // ראשון 22.11 07:00 (שישי ושבת לא נספרים)
  });

  it('zoned/wall: שעון ישראל בלי תלות בשרת (חורף +2, קיץ +3, מעבר שעון)', () => {
    assert.equal(TK.zoned(2026, 0, 15, 7, 0), Date.parse('2026-01-15T05:00:00Z'));
    assert.equal(TK.zoned(2026, 6, 15, 7, 0), Date.parse('2026-07-15T04:00:00Z'));
    assert.equal(TK.zoned(2026, 2, 27, 2, 30), Date.parse('2026-03-27T00:30:00Z')); // 02:30 לא קיימת – קדימה (03:30)
    assert.equal(TK.zoned(2026, 9, 25, 1, 30), Date.parse('2026-10-24T22:30:00Z')); // 01:30 כפולה – הראשונה
    assert.equal(TK.zoned(2026, 11, 32, 0, 0), Date.parse('2026-12-31T22:00:00Z')); // גלישה: 32.12 = 1.1.2027
  });
});

describe('משימות קבועות – decide (מתי לפתוח)', () => {
  const at = (y, m, d, hh, mm) => TK.zoned(y, m - 1, d, hh, mm);
  const ED = at(2025, 1, 1, 0, 0);
  const base = (o) => Object.assign({ on: true, fq: 'w', wd: [2], hh: 7, mm: 0, hol: true, ed: ED, last: '' }, o);

  it('שבועי, שלישי 07:00: 06:55 – עוד לא; 07:00 – כן, מפתח היום 20261117; 23:59 – עדיין כן (השלמה); שני/רביעי – לא', () => {
    assert.deepEqual(TK.decide(base(), at(2026, 11, 17, 6, 55)).go, false);
    const d = TK.decide(base(), at(2026, 11, 17, 7, 0));
    assert.equal(d.go, true); assert.equal(d.key, '20261117'); assert.equal(d.day, '2026-11-17'); assert.equal(d.at, at(2026, 11, 17, 7, 0));
    assert.equal(TK.decide(base(), at(2026, 11, 17, 23, 59)).go, true);
    assert.equal(TK.decide(base(), at(2026, 11, 16, 9, 0)).why, 'day');
    assert.equal(TK.decide(base(), at(2026, 11, 18, 9, 0)).why, 'day');
  });

  it('לא פעמיים באותו יום: last == היום → לא; למחרת השבוע הבא – כן', () => {
    assert.equal(TK.decide(base({ last: '2026-11-17' }), at(2026, 11, 17, 8, 0)).why, 'done-today');
    assert.equal(TK.decide(base({ last: '2026-11-17' }), at(2026, 11, 24, 8, 0)).go, true);
  });

  it('לא לפני ed: נשמר ב-08:00 – לא נפתחת היום על 07:00; נשמר ב-06:00 – נפתחת', () => {
    assert.equal(TK.decide(base({ ed: at(2026, 11, 17, 8, 0) }), at(2026, 11, 17, 8, 5)).why, 'before-edit');
    assert.equal(TK.decide(base({ ed: at(2026, 11, 17, 6, 0) }), at(2026, 11, 17, 8, 5)).go, true);
    assert.equal(TK.decide(base({ ed: at(2026, 11, 17, 7, 0) }), at(2026, 11, 17, 7, 0)).go, true); // בדיוק במועד
  });

  it('כבוי (on false/חסר) – לא', () => {
    assert.equal(TK.decide(base({ on: false }), at(2026, 11, 17, 8, 0)).why, 'off');
    assert.equal(TK.decide(base({ on: undefined }), at(2026, 11, 17, 8, 0)).why, 'off');
  });

  it('חג: hol true – לא נפתחת ביום כיפור (שני 21.9.2026) ובערב ראש השנה (שישי 11.9); hol false – נפתחת', () => {
    const r = base({ wd: [1, 5] });
    assert.equal(TK.decide(r, at(2026, 9, 21, 8, 0)).why, 'day');
    assert.equal(TK.decide(r, at(2026, 9, 11, 8, 0)).why, 'day');
    assert.equal(TK.decide(base({ wd: [1, 5], hol: false }), at(2026, 9, 21, 8, 0)).go, true);
    assert.equal(TK.decide(base({ wd: [1, 5], hol: false }), at(2026, 9, 11, 8, 0)).go, true);
    assert.equal(TK.decide(r, at(2026, 9, 28, 8, 0)).why, 'day'); // שני, חול המועד סוכות (י"ח תשרי)
  });

  it('יומי: ראשון–חמישי, לא שישי/שבת, לא חג (hol), כן בחג כש-hol false', () => {
    const r = base({ fq: 'd' });
    for (const d of [15, 16, 17, 18, 19]) assert.equal(TK.decide(r, at(2026, 11, d, 8, 0)).go, true, String(d));
    for (const d of [20, 21]) assert.equal(TK.decide(r, at(2026, 11, d, 8, 0)).go, false, String(d));
    assert.equal(TK.decide(r, at(2026, 9, 21, 8, 0)).go, false);
    assert.equal(TK.decide(base({ fq: 'd', hol: false }), at(2026, 9, 21, 8, 0)).go, true);
  });

  it('חודשי: md 15 – רק ב-15; md 31 בנובמבר (30 יום) – ב-30; md 30 בפברואר – ב-28; כולל שבת (בלי hol)', () => {
    assert.equal(TK.decide(base({ fq: 'm', md: 15 }), at(2026, 11, 15, 8, 0)).go, true);
    assert.equal(TK.decide(base({ fq: 'm', md: 15 }), at(2026, 11, 16, 8, 0)).go, false);
    assert.equal(TK.decide(base({ fq: 'm', md: 31 }), at(2026, 11, 30, 8, 0)).go, true);
    assert.equal(TK.decide(base({ fq: 'm', md: 31 }), at(2026, 12, 31, 8, 0)).go, true);
    assert.equal(TK.decide(base({ fq: 'm', md: 31 }), at(2026, 12, 30, 8, 0)).go, false);
    assert.equal(TK.decide(base({ fq: 'm', md: 30 }), at(2027, 2, 28, 8, 0)).go, true);
    assert.equal(TK.decide(base({ fq: 'm', md: 0 }), at(2027, 2, 28, 8, 0)).go, false);
  });

  it('גבול חצות ושעון השרת: 23:55 שעון ישראל = יום ישראלי (לא UTC)', () => {
    const r = base({ fq: 'w', wd: [2], hh: 23, mm: 55 });
    const t = at(2026, 11, 17, 23, 57); // = 21:57 UTC אותו יום; ובקיץ:
    assert.equal(TK.decide(r, t).key, '20261117');
    const r2 = base({ fq: 'w', wd: [3], hh: 0, mm: 5, ed: 0 });
    const t2 = at(2026, 7, 15, 0, 10); // רביעי 00:10 בישראל = שלישי 21:10 UTC
    const d2 = TK.decide(r2, t2);
    assert.equal(d2.go, true); assert.equal(d2.key, '20260715');
  });

  it('מעבר שעון: 02:30 ביום המעבר לקיץ (לא קיימת) – נפתחת מ-03:30; ביום המעבר לחורף 01:30 – פעם אחת', () => {
    const r = base({ fq: 'w', wd: [5], hh: 2, mm: 30 });
    assert.equal(TK.decide(r, Date.parse('2026-03-27T00:29:00Z')).go, false);
    assert.equal(TK.decide(r, Date.parse('2026-03-27T00:30:00Z')).go, true);
    const r2 = base({ fq: 'w', wd: [0], hh: 1, mm: 30 });
    const first = TK.decide(r2, Date.parse('2026-10-24T22:30:00Z'));
    assert.equal(first.go, true);
    assert.equal(TK.decide(Object.assign({}, r2, { last: first.day }), Date.parse('2026-10-24T23:30:00Z')).go, false);
  });

  it('nextAt: המועד הבא אחרי שמירה ביום שלישי 08:00 – שלישי הבא 07:00', () => {
    assert.equal(TK.nextAt(base({ ed: at(2026, 11, 17, 8, 0) }), at(2026, 11, 17, 8, 0)), at(2026, 11, 24, 7, 0));
  });
});

describe('משימות קבועות – הגדרת הפונקציה', () => {
  it('recurringTasks: מתוזמנת, כל 5 דקות, Asia/Jerusalem, us-central1 בלבד; ליבה לבדיקות לא נספרת', () => {
    const ex = require(path.join(FN, 'index.js'));
    const e = ex.recurringTasks && ex.recurringTasks.__endpoint;
    assert.ok(e && e.scheduleTrigger, 'recurringTasks לא מתוזמנת');
    assert.equal(e.scheduleTrigger.schedule, 'every 5 minutes');
    assert.equal(e.scheduleTrigger.timeZone, 'Asia/Jerusalem');
    assert.deepEqual([].concat(e.region), ['us-central1']);
    assert.ok(!Object.keys(ex).includes('_core'));
    assert.equal(typeof require(path.join(FN, 'recurring.js'))._core.runAll, 'function');
  });
});
