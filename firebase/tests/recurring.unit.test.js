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

// ---------- 22.11.2026: היעד בפועל (tkDl) ותזכורת איחור לעובד ----------
const LT = require(path.join(FN, 'lib', 'tk-late.js'));
const SR = require(path.join(FN, 'lib', 'sec-remind.js'));
// tkDl ו-tkLateNow מהאפליקציה (index.html), כמו שהם
function appDl() {
  const src = fs.readFileSync(HTML, 'utf8');
  const a = src.match(/const tkDl=t=>[^;]+;/), b = src.match(/const tkLateNow=t=>[^;]+;/);
  assert.ok(a && b, 'tkDl / tkLateNow לא נמצאו באפליקציה');
  // eslint-disable-next-line no-new-func
  return new Function('NOW', a[0] + b[0].replace('Date.now()', 'NOW()') + 'return { tkDl, tkLateNow };');
}

describe('tkDl בשרת = tkDl באפליקציה; איחור לפי dl', () => {
  const N = Date.UTC(2026, 10, 22, 10, 0);
  const H1 = 3600000;
  const CASES = [
    { st: 'open', due: N - H1 }, { st: 'open', due: N + H1 }, { st: 'open', due: N - H1, dl: 0 }, { st: 'open', due: N - H1, dl: N + H1 },
    { st: 'open', due: N + H1, dl: N - H1 }, { st: 'open', due: N - H1, dl: -1 }, { st: 'open', due: N + H1, dl: -1 }, { st: 'open' },
    { st: 'open', dl: N - H1 }, { st: 'open', dl: 0 }, { st: 'wait', due: N - H1 }, { st: 'done', dl: N - H1 }, { st: 'open', due: N - 40 * 864e5 },
  ];
  it('אותו יעד ואותו "באיחור עכשיו" כמו באפליקציה, בכל המקרים', () => {
    const app = appDl()(() => N);
    for (const t of CASES) {
      assert.deepEqual(TK.tkDl(t), app.tkDl(t), JSON.stringify(t));
      assert.equal(TK.tkLateAt(t, N), app.tkLateNow(t), JSON.stringify(t));
    }
  });
  it('תזכורת המזכירה (taskCands): dl שנדחה – לא באיחור; dl=0 – לא; dl שעבר (due עתידי) – כן', () => {
    const ts = [
      { txt: 'דחוי', st: 'open', due: N - H1, dl: N + H1 },
      { txt: 'בלי יעד', st: 'open', due: N - H1, dl: 0 },
      { txt: 'יעד שעבר', st: 'open', due: N + H1, dl: N - H1 },
      { txt: 'ישן', st: 'open', due: N - H1 },
      { txt: 'בהמתנה', st: 'wait', due: N - H1 },
    ];
    const c = SR.taskCands(ts, {}, N, '2026-11-22');
    assert.equal(c.length, 1);
    assert.match(c[0].title, /^2 משימות/);
    assert.ok(c[0].body.includes('יעד שעבר') && c[0].body.includes('ישן') && !c[0].body.includes('דחוי') && !c[0].body.includes('בלי יעד'));
    assert.deepEqual(SR.taskCands([ts[0], ts[1]], {}, N, '2026-11-22'), []);
  });
});

describe('התראת איחור לעובד – lib/tk-late.js', () => {
  const at = (y, m, d, hh, mm) => TK.zoned(y, m - 1, d, hh, mm);
  const N = at(2026, 11, 22, 10, 0); // ראשון 10:00 שעון ישראל
  const H1 = 3600000, D1 = 864e5;
  const tk = (id, o) => Object.assign({ id, txt: 'משימה ' + id, st: 'open', due: N - H1, ow: 'u1' }, o);

  it('שקט: שבת וערב שבת אחרי 13:00, לילה 22:00–07:00; יום חול 10:00 – לא שקט', () => {
    assert.equal(LT.quiet(N), false);
    assert.equal(LT.quiet(at(2026, 11, 22, 6, 59)), true);
    assert.equal(LT.quiet(at(2026, 11, 22, 7, 0)), false);
    assert.equal(LT.quiet(at(2026, 11, 22, 21, 59)), false);
    assert.equal(LT.quiet(at(2026, 11, 22, 22, 0)), true);
    assert.equal(LT.quiet(at(2026, 11, 21, 12, 0)), true);  // שבת
    assert.equal(LT.quiet(at(2026, 11, 20, 14, 0)), true);  // שישי אחרי 13:00
    assert.equal(LT.quiet(at(2026, 11, 20, 10, 0)), false); // שישי בבוקר
  });

  it('מועמדות: רק פתוחה ובאיחור לפי tkDl, עד 30 יום, ועם ow או to', () => {
    assert.ok(LT.lateDl(tk('a'), N));
    assert.equal(LT.lateDl(tk('a', { dl: 0 }), N), 0);
    assert.equal(LT.lateDl(tk('a', { dl: N + H1 }), N), 0);
    assert.equal(LT.lateDl(tk('a', { due: N + H1, dl: N - H1 }), N), N - H1);
    assert.equal(LT.lateDl(tk('a', { st: 'wait' }), N), 0);
    assert.equal(LT.lateDl(tk('a', { due: N - 31 * D1 }), N), 0);
    assert.ok(LT.lateDl(tk('a', { due: N - 29 * D1 }), N));
    assert.equal(LT.lateDl(tk('a', { ow: '' }), N), 0);
    assert.ok(LT.lateDl(tk('a', { ow: '', to: ['u2', 'u3'] }), N));
    assert.deepEqual(LT.recips(tk('a', { ow: '', to: ['u2', 'u2', 'bad/id', 'u3'] })), ['u2', 'u3']);
    assert.deepEqual(LT.recips(tk('a', { to: ['u2'] })), ['u1']);
  });

  it('איגוד: התראה אחת לכל עובד, הישנה ראשונה; סימון לכל משימה; מי שכבר קיבל / לא פעיל – לא', () => {
    const ts = [tk('t1', { due: N - 2 * H1 }), tk('t2', { due: N - 5 * H1 }), tk('t3', { ow: '', to: ['u1', 'u2', 'off'] }), tk('t4', { ow: 'u3' }), tk('t5', { dl: 0 })];
    const marks = new Map([['t4', new Set(['u3'])]]);
    const P = LT.pick(ts, marks, N, (u) => u !== 'off');
    assert.deepEqual(P.users.map((x) => [x.uid, x.tasks.map((t) => t.id)]), [['u1', ['t2', 't1', 't3']], ['u2', ['t3']]]);
    assert.deepEqual(P.marks.sort((a, b) => (a.id < b.id ? -1 : 1)), [{ id: 't1', u: ['u1'] }, { id: 't2', u: ['u1'] }, { id: 't3', u: ['u1', 'u2'] }]);
    // ריצה שנייה עם הסימונים – כלום
    const M2 = new Map(P.marks.map((m) => [m.id, new Set(m.u)]));
    M2.set('t4', new Set(['u3']));
    assert.deepEqual(LT.pick(ts, M2, N + 15 * 60000, (u) => u !== 'off').users, []);
  });

  it('תקרה: עד 20 עובדים בריצה; השאר לא מסומנים (יקבלו בריצה הבאה)', () => {
    const ts = Array.from({ length: 25 }, (_, i) => tk('t' + i, { ow: 'w' + i, due: N - (30 - i) * H1 }));
    const P = LT.pick(ts, new Map(), N, () => true);
    assert.equal(P.users.length, LT.MAX_USERS);
    assert.equal(P.marks.length, 20);
    assert.deepEqual(P.users[0].uid, 'w0');
    const M = new Map(P.marks.map((m) => [m.id, new Set(m.u)]));
    assert.deepEqual(LT.pick(ts, M, N, () => true).users.map((x) => x.uid), ['w20', 'w21', 'w22', 'w23', 'w24']);
  });

  it('הטקסט: אחת – "יש לך משימה באיחור" + הטקסט; כמה – "יש לך N משימות באיחור"', () => {
    assert.deepEqual(LT.msgOf([{ id: 'a', txt: 'לנקות את המקרר' }]), { title: 'יש לך משימה באיחור', body: 'לנקות את המקרר' });
    const m = LT.msgOf([{ txt: 'א' }, { txt: 'ב' }, { txt: 'ג' }, { txt: 'ד' }]);
    assert.equal(m.title, 'יש לך 4 משימות באיחור');
    assert.equal(m.body, 'א · ב · ג ועוד 1');
    assert.equal(LT.msgOf([{ txt: '' }]).body, 'פרטים באפליקציה');
  });

  it('recurringTasks: בדיקת האיחור רצה בריצה אחת מכל 3 (פעם ב-15 דקות)', () => {
    const R = require(path.join(FN, 'recurring.js'))._core;
    let n = 0;
    for (let t = N; t < N + 3600000; t += 300000) if (R.lateSlot(t + 2000)) n++;
    assert.equal(n, 4);
    assert.equal(typeof R.lateAll, 'function');
  });
});
