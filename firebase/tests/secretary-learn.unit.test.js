'use strict';
// "תגובה למזכירה" (15.11.2026): בדיקות יחידה ל-lib/sec-learn.js (בלי אמולטור ובלי רשת). חלק מ-test:multibiz.
// כללי הבטיחות הקבועים, ניקוי כלל, סינון מוקדם, התאמה שמרנית, "לשאול לבד?", כל תנאי השליחה לבד, כשלונות ברצף.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../functions/lib/sec-learn.js');

describe('sec-learn: כללי הבטיחות הקבועים (בקוד)', () => {
  it('הוראה / פנייה: תשלום, מחיקה, סיסמאות ופרטים רגישים מזוהים', () => {
    for (const t of ['תשלמי לספק כשמגיעה חשבונית', 'העבירי לו את הכסף', 'תעשי העברה בנקאית', 'שלחי לו את פרטי האשראי', 'please pay the supplier', 'מה התשלום?']) assert.equal(L.safeOf(t), 'pay', t);
    for (const t of ['תמחקי את הלקוח הזה', 'למחוק את כל ההזמנות', 'delete my data']) assert.equal(L.safeOf(t), 'del', t);
    for (const t of ['שלחי לו את הסיסמה', 'תני לו את קוד האימות', 'מה הת"ז שלו', 'send me the password', 'מה מספר החשבון בבנק?']) assert.equal(L.safeOf(t), 'secret', t);
    for (const t of ['תעני לו בקצרה ובנימוס', 'מעכשיו תאשרי במייל שקיבלנו', 'תגידי שהמחיר 50 ש"ח', 'אל תתריעי לי על זה', 'תזכירי לו שאנחנו סגורים בשישי']) assert.equal(L.safeOf(t), '', t);
  });
  it('טקסט יוצא: התחייבות להעברת כסף, מספר כרטיס / חשבון, סיסמה – חסום; טלפון ושעות – מותר', () => {
    for (const t of ['העברנו לך 500 ₪', 'נחזיר לך את הכסף מחר', 'we will refund you']) assert.equal(L.safeOf(t, true), 'pay', t);
    for (const t of ['מספר הכרטיס 4580 1234 5678 9012', 'הסיסמה היא 1234', 'קוד האימות שלך: 5521', 'ת.ז 123456789']) assert.equal(L.safeOf(t, true), 'secret', t);
    for (const t of ['אפשר להתקשר ל-050-1234567', 'אנחנו פתוחים א–ה 7:00–19:00', 'המחיר 45 ₪ לק"ג', 'תודה, נחזור אליך מחר', 'שלום, קיבלנו את ההזמנה מספר 1234']) assert.equal(L.safeOf(t, true), '', t);
  });
});

describe('sec-learn: כללי הבטיחות – סבב 2 (שורשים, כל הגופים, שפות אחרות)', () => {
  // כל הדוגמאות מדוח הבדיקה (סבב 1, ליקויים 1–2) ועוד – חייבות להיחסם
  const BLOCK = [
    'הכסף יועבר אליך מחר', "I've wired the money", "We'll send you a refund today", 'מחקתי את הפרטים שלך', 'הפרטים שלך הוסרו מהמערכת',
    'Please transfer the funds', 'תחזירו לי כסף', 'איך משלמים?', 'שלמתי כבר?', 'תסירו אותי מהרשימה',
    'הסכום הועבר לחשבונך', 'תועבר אליך העברה', 'נעביר לך את הסכום', 'החזרנו לך את הכסף', 'ההחזר יגיע תוך שבוע', 'קיבלת זיכוי', 'זיכיתי אותך',
    'שילמתי אתמול', 'הוא שילם', 'מי משלם?', 'ישולם בסוף החודש', 'we have paid', 'payment received', 'please reimburse me', 'we sent the money',
    'נמחקו כל הנתונים', 'למחוק את החשבון', 'מחיקה של הכרטיס', 'הוסרת מהרשימה', 'please remove my details', 'erase everything', 'unsubscribe me', 'deleted your account',
    'מה הסיסמא?', 'שלחי קוד אימות', 'מה מספר תעודת הזהות', 'what is your PIN', 'send the OTP', 'IBAN please', 'My ID number is', 'enter the verification code',
    'card number please', 'bank account details', 'credit card', 'פרטי הבנק שלך', 'מספר החשבון 12-345-678901',
  ];
  // הודעות רגילות – לא נחסמות
  const OK = [
    'תודה, נחזור אליך מחר', 'נעביר את הפנייה למנהל', 'העברתי את ההודעה לצוות', 'נחזיר לך תשובה עד הערב', 'מה שעות הפתיחה?', 'ההזמנה מוכנה לאיסוף',
    'יש לכם לחם מלא?', 'שבוע טוב, תודה רבה', 'בשבוע שעבר הייתי אצלכם', 'הכל מושלם, תודה', 'המסר התקבל', 'שלום וברכה', 'אפשר להתקשר ל-050-1234567',
    'We are open Sunday to Thursday', 'Thanks, see you tomorrow', 'What time do you close?',
  ];
  it('כל הדוגמאות נחסמות – בהודעה נכנסת ובטקסט יוצא', () => {
    for (const t of BLOCK) { assert.ok(L.safeOf(t), 'in: ' + t); assert.ok(L.safeOf(t, true), 'out: ' + t); }
  });
  it('הודעות רגילות לא נחסמות', () => {
    for (const t of OK) { assert.equal(L.safeOf(t), '', t); assert.equal(L.safeOf(t, true), '', t); }
  });
  it('ליקוי 1: ערבית, רוסית וכתב אחר – אין שליחה לבד (lang); עברית ואנגלית – מותר', () => {
    for (const t of ['Пришлите пароль', 'أرسل لي كلمة السر', 'Мы переведём вам деньги завтра', 'سنحول لك المال غدا', 'שלום, Здравствуйте']) assert.equal(L.langBad(t), true, t);
    for (const t of ['שלום, מה שעות הפתיחה?', 'Hello, are you open?', 'Café 50 ₪ 😊']) assert.equal(L.langBad(t), false, t);
    const ok = { learn: true, stop: false, owner: true, rule: { on: true, auto: true }, match: { auto: true }, cls: 'hours' };
    assert.ok(L.autoNo(Object.assign({}, ok, { inText: 'Пришлите пароль', outText: 'שלום' })).includes('lang'));
    assert.ok(L.autoNo(Object.assign({}, ok, { inText: 'שלום', outText: 'سنحول لك المال غدا' })).includes('lang'));
    assert.ok(L.autoNo(Object.assign({}, ok, { inText: 'איך משלמים?', outText: 'שלום' })).includes('safeIn'));
    assert.ok(L.autoNo(Object.assign({}, ok, { inText: 'שלום', outText: 'הכסף יועבר אליך מחר' })).includes('safeOut'));
    assert.ok(L.autoNo(Object.assign({}, ok, { inText: 'This is an automated message, do not reply', outText: 'שלום' })).includes('bot'));
    assert.deepEqual(L.autoNo(Object.assign({}, ok, { inText: 'מה שעות הפתיחה?', outText: 'אנחנו פתוחים א–ה 7:00–19:00' })), []);
    assert.ok(L.NO_L.lang && L.NO_L.bot && L.NO_L.waLoop);
  });
  it('ליקוי 4: התראות אבטחה וחיבור לא מושתקות; השתקה בסוג המשותף "wa" – רק לפי משפחה', () => {
    for (const k of ['gmailon|b|1', 'gcalon|u|1', 'gexp|x', 'mailgap|b|d', 'mailskip|b|g', 'mailover|b|d', 'maillag|b|d', 'histcap|1', 'clean|x']) assert.equal(L.noteMutable({ key: k }), false, k);
    const r = L.cleanRule({ ch: 'note', instr: 'אל תתריעי לי על זה', sc: 'typ', item: { typ: 'wa', key: 'unsure|abc' } });
    assert.deepEqual(r.scope, { typ: 'wa', fam: 'unsure' });
    assert.deepEqual(L.cleanRule({ ch: 'note', instr: 'אל תתריעי לי על זה', sc: 'typ', item: { typ: 'cal', key: 'cal:1:2' } }).scope, { typ: 'cal' });
    // כלל ישן בלי משפחה על הסוג המשותף – לא משתיק כלום
    const old = [{ id: 'o', ch: 'note', act: 'mute', scope: { typ: 'wa' }, on: true }];
    assert.deepEqual(L.prefilter(old, { ch: 'note', typ: 'wa', key: 'unsure|1' }), []);
  });
});

describe('sec-learn: כלל חדש', () => {
  it('cleanRule: ערוץ, פעולה, תחום וסימון בטיחות – נקבעים בקוד', () => {
    const m = L.cleanRule({ ch: 'mail', instr: '  תעני לו   בנימוס  ', sc: 'cls', item: { cls: 'hours', from: 'A@x.com' } });
    assert.deepEqual(m, { ch: 'mail', act: 'reply', instr: 'תעני לו בנימוס', scope: { cls: 'hours' }, safe: '' });
    assert.deepEqual(L.cleanRule({ ch: 'mail', instr: 'x', sc: 'from', item: { cls: 'hours', from: 'A@x.com' } }).scope, { from: L.hashTo('a@x.com') });
    assert.deepEqual(L.cleanRule({ ch: 'wa', instr: 'x', sc: 'all', item: { cls: 'hours', from: '9725' } }).scope, {});
    // סוג "אחר" – לא מספיק ספציפי: ברירת המחדל היא השולח
    assert.deepEqual(L.cleanRule({ ch: 'wa', instr: 'x', item: { cls: 'other', from: '972501' } }).scope, { from: L.hashTo('972501') });
    assert.equal(L.cleanRule({ ch: 'mail', instr: 'תשלמי לו', item: {} }).safe, 'pay');
    const n = L.cleanRule({ ch: 'note', instr: 'אל תתריעי לי על זה', item: { typ: 'wa', key: 'unsure|abc' } });
    assert.equal(n.act, 'mute'); assert.deepEqual(n.scope, { typ: 'wa', fam: 'unsure' });
    assert.equal(L.cleanRule({ ch: 'note', instr: 'תזכירי לי מוקדם יותר', item: { typ: 'cal' } }).act, 'info');
    assert.equal(L.cleanRule({ ch: 'chat', instr: 'מעכשיו תעני בקצרה' }).act, 'style');
    assert.equal(L.cleanRule({ ch: 'rep', instr: 'x' }), null);
    assert.equal(L.cleanRule({ ch: 'chat', instr: '' }), null);
    assert.equal(L.cleanRule({ ch: 'chat', instr: 'א'.repeat(301) }), null);
  });
  it('התראות בטיחות לא מושתקות', () => {
    for (const k of ['stop|1', 'mailheld|2026', 'fail|x', 'mrsent|r|1', 'mrfail|r|1', 'mrask|r', 'mroff|r|1', 'draftcap|d']) assert.equal(L.noteMutable({ key: k }), false, k);
    for (const k of ['unsure|x', 'cal:1:2', 'close:i_nl:2026-11-14', 'win:1']) assert.equal(L.noteMutable({ key: k }), true, k);
  });
});

describe('sec-learn: התאמה שמרנית', () => {
  const R = [
    { id: 'r1', uid: 'u1', ch: 'mail', instr: 'שעות', scope: { cls: 'hours' }, on: true },
    { id: 'r2', uid: 'u1', ch: 'mail', instr: 'יוסי', scope: { from: L.hashTo('yossi@x.com') }, on: true },
    { id: 'r3', uid: 'u2', ch: 'mail', instr: 'כבוי', scope: {}, on: false },
    { id: 'r4', uid: 'u1', ch: 'wa', instr: 'ווצאפ', scope: {}, on: true },
    { id: 'n1', uid: 'u1', ch: 'note', act: 'mute', instr: 'השתקה', scope: { typ: 'wa', fam: 'unsure' }, on: true },
  ];
  it('prefilter: ערוץ, פעיל, שולח, סוג התראה ומשפחה', () => {
    assert.deepEqual(L.prefilter(R, { ch: 'mail', from: 'other@x.com' }).map((r) => r.id), ['r1']);
    assert.deepEqual(L.prefilter(R, { ch: 'mail', from: 'Yossi@x.com' }).map((r) => r.id), ['r1', 'r2']);
    assert.deepEqual(L.prefilter(R, { ch: 'wa', from: '972' }).map((r) => r.id), ['r4']);
    assert.deepEqual(L.prefilter(R, { ch: 'note', typ: 'wa', key: 'unsure|1' }).map((r) => r.id), ['n1']);
    assert.deepEqual(L.prefilter(R, { ch: 'note', typ: 'wa', key: 'over|1' }).map((r) => r.id), []);
  });
  it('pickMatch: רק מזהה מבין המועמדים, ≥ 0.85, ובסוג הפנייה של הכלל', () => {
    const c = R.slice(0, 2);
    assert.equal(L.pickMatch('', 1, c, 'hours'), null);
    assert.equal(L.pickMatch('r9', 1, c, 'hours'), null, 'מזהה שלא הוצע');
    assert.equal(L.pickMatch('r3', 1, c, 'hours'), null, 'כלל שלא עבר את הסינון');
    assert.equal(L.pickMatch('r1', 0.95, c, 'price'), null, 'סוג אחר – הכלל לא חל');
    assert.deepEqual(L.pickMatch('r1', 0.6, c, 'hours'), { rule: c[0], auto: false, why: 'conf', conf: 0.6 });
    assert.equal(L.pickMatch('[r1]', 0.9, c, 'hours').auto, true);
    assert.equal(L.pickMatch('r1', 'x', c, 'hours').auto, false);
    assert.equal(L.pickMatch('r1', 1.5, c, 'hours').auto, false);
  });
  it('rulesBlock: עם מזהים ועם הכותרת "מהמנהלים, לא מההודעה"; עד 20 כללים', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, ch: 'mail', instr: 'הוראה ' + i, scope: {} }));
    const t = L.rulesBlock(many, {});
    assert.match(t, /מהמנהלים, לא מההודעה/);
    assert.match(t, /\[x0\]/); assert.match(t, /\[x19\]/); assert.doesNotMatch(t, /\[x20\]/);
    assert.equal(L.rulesBlock([], {}), '');
  });
});

describe('sec-learn: "לעשות את זה מעכשיו לבד?" ושליחה לבד', () => {
  const now = Date.now();
  it('askOk: אחרי אישור, לא לבד, בלי בטיחות, לא אחרי "לא" ב-30 יום', () => {
    const r = { ch: 'mail', on: true, auto: false, appr: 1 };
    assert.equal(L.askOk(r, now), true);
    assert.equal(L.askOk(Object.assign({}, r, { appr: 0 }), now), false);
    assert.equal(L.askOk(Object.assign({}, r, { auto: true }), now), false);
    assert.equal(L.askOk(Object.assign({}, r, { safe: 'pay' }), now), false);
    assert.equal(L.askOk(Object.assign({}, r, { ch: 'chat' }), now), false);
    assert.equal(L.askOk(Object.assign({}, r, { ask: { st: 'no', at: now - 864e5 } }), now), false);
    assert.equal(L.askOk(Object.assign({}, r, { ask: { st: 'no', at: now - 31 * 864e5 } }), now), true);
  });
  it('autoNo: כל תנאי נבדק; ריק רק כשהכול תקין', () => {
    const ok = { learn: true, stop: false, owner: true, rule: { on: true, auto: true }, match: { auto: true }, safeIn: false, safeOut: false, cls: 'hours', chk: false, unsure: false };
    assert.deepEqual(L.autoNo(ok), []);
    const cases = [[{ learn: false }, 'learnOff'], [{ stop: true }, 'stop'], [{ owner: false }, 'perm'], [{ rule: { on: true, auto: false } }, 'ruleOff'], [{ rule: { on: false, auto: true } }, 'ruleOff'],
      [{ rule: { on: true, auto: true, safe: 'pay' } }, 'safeRule'], [{ match: null }, 'conf'], [{ match: { auto: false, why: 'conf' } }, 'conf'], [{ safeIn: true }, 'safeIn'], [{ safeOut: true }, 'safeOut'],
      [{ cls: 'pay' }, 'money'], [{ cls: 'debt' }, 'money'], [{ chk: true }, 'chk'], [{ unsure: true }, 'unsure'], [{ extra: ['window'] }, 'window']];
    for (const [o, w] of cases) assert.ok(L.autoNo(Object.assign({}, ok, o)).includes(w), w);
    // פניות רגישות (תלונה, מחיר, החזר) – מותר לבד לפי כלל שאושר (החלטת בעל הפרויקט)
    for (const cls of ['complaint', 'price', 'refund', 'other']) assert.deepEqual(L.autoNo(Object.assign({}, ok, { cls })), [], cls);
    assert.deepEqual(L.noL(['stop', 'window', 'nope']), ['"עצור הכל" פעיל', 'עברו 24 שעות מההודעה האחרונה של הפונה']);
  });
  it('כשלונות ברצף: בשלישי הכלל מפסיק לשלוח לבד', () => {
    assert.deepEqual(L.failNext({}), { fails: 1, off: false });
    assert.deepEqual(L.failNext({ fails: 1 }), { fails: 2, off: false });
    assert.deepEqual(L.failNext({ fails: 2 }), { fails: 3, off: true });
  });
  it('maskTo: הסתרה חלקית ביומן', () => {
    assert.equal(L.maskTo('yossi@x.com'), 'yo***@x.com');
    assert.equal(L.maskTo('972501234567'), '***4567');
  });
});

// 15.11.2026 (סעיף 6): צ'אט נקי, "מול העיניים" וכללי ניתוב
describe('sec-learn: כללי ניתוב, "מאז הכניסה הקודמת" ותזכורות בפיד', () => {
  it('routeOf: הוראת ניתוב מזוהה; שאלה או משפט בלי הוראה – לא', () => {
    assert.deepEqual(L.routeOf("חשבוניות מהיום – לקטגוריה 'בטיפול' באפליקציה"), { kind: 'inv', dest: 'hold' });
    assert.deepEqual(L.routeOf('מעכשיו חשבוניות למסך לטיפול'), { kind: 'inv', dest: 'hold' });
    assert.deepEqual(L.routeOf('מעכשיו תזכורות רק בלשונית היומן'), { kind: 'rem', dest: 'tab' });
    assert.deepEqual(L.routeOf('מעכשיו התראות לא בצ׳אט'), { kind: 'note', dest: 'tab' });
    assert.deepEqual(L.routeOf("מעכשיו חשבוניות שוב לצ'אט"), { kind: 'inv', dest: 'chat' });
    for (const t of ['כמה חשבוניות בטיפול?', 'חשבוניות בטיפול', 'מה בטיפול היום', 'תזכירי לי מחר להתקשר', '']) assert.equal(L.routeOf(t), null, t);
  });
  // תיקון סבב 1: בקשות רגילות לא נתפסות כהוראת ניתוב
  it('routeOf: רק עם "מעכשיו" + יעד מפורש אחרי סוג הפריט; "טיפול" אחרי שם עצם או בשלילה – לא יעד', () => {
    for (const t of [
      'תשימי לי תזכורת מחר בבוקר לטיפול ברכב',
      'תכניסי תזכורת ליום שלישי לטיפול שיניים',
      'תציג לי את החשבוניות שבטיפול',
      "תציג לי את כל החשבוניות בצ'אט",
      "מעכשיו כל החשבוניות שלא בטיפול לצ'אט",
      'מעכשיו תזכירי לי כל יום על טיפול ברכב',
      'תמיד תשימי לי תזכורת לטיפול שיניים',
      'מעכשיו חשבוניות למסך טיפול ברכב',
      "למה תמיד החשבוניות בצ'אט",
      'מעכשיו לטיפול – חשבוניות',
    ]) assert.equal(L.routeOf(t), null, t);
    assert.deepEqual(L.routeOf('חשבוניות מהיום – למסך לטיפול'), { kind: 'inv', dest: 'hold' });
    assert.deepEqual(L.routeOf('מעכשיו תזכורות רק בלשונית שלהן'), { kind: 'rem', dest: 'tab' });
    assert.deepEqual(L.routeOf('מהיום חשבוניות לטיפול באפליקציה'), { kind: 'inv', dest: 'hold' });
    assert.deepEqual(L.routeOf('חשבוניות מהיום – לבטיפול'), { kind: 'inv', dest: 'hold' });
    assert.deepEqual(L.routeOf("מכאן והלאה התראות בצ'אט"), { kind: 'note', dest: 'chat' });
  });
  it('routeRule / routesOf / applyRoutes: האחרון גובר, כבוי לא חל, ברירת מחדל – הכול בצ\'אט', () => {
    const r = L.routeRule('חשבוניות מהיום – לבטיפול', { kind: 'inv', dest: 'hold' });
    assert.deepEqual(r, { ch: 'route', act: 'route', instr: 'חשבוניות מהיום – לבטיפול', scope: { kind: 'inv' }, dest: 'hold', safe: '' });
    assert.equal(L.routeRule('x', { kind: 'zzz', dest: 'hold' }), null);
    assert.equal(L.scopeL(r), 'חשבוניות ← מסך "לטיפול" באפליקציה');
    const R = L.routesOf([Object.assign({}, r, { t: 1 }), { ch: 'route', scope: { kind: 'inv' }, dest: 'tab', on: true, t: 2 }, { ch: 'route', scope: { kind: 'rem' }, dest: 'hold', on: false, t: 3 }, { ch: 'chat', instr: 'קצר', t: 4 }]);
    assert.deepEqual(R, { inv: 'tab' });
    const items = [{ k: 'inv', id: 1 }, { k: 'rem', id: 2 }, { k: 'note', id: 3 }];
    assert.deepEqual(L.applyRoutes(items, {}), { feed: items, hold: [] });
    assert.deepEqual(L.applyRoutes(items, { inv: 'hold', note: 'tab' }), { feed: [{ k: 'rem', id: 2 }], hold: [{ k: 'inv', id: 1 }] });
  });
  it('sinceOf: כניסה ראשונה – 24 שעות; כניסה חדשה – מהכניסה הקודמת; כניסה חוזרת תוך 2 דקות / בלי visit – אותו "מאז"; לא יותר מ-7 ימים', () => {
    const now = 1e12;
    assert.equal(L.sinceOf(null, now, true), now - 864e5);
    assert.equal(L.sinceOf({ chat: now - 3600e3, prev: now - 9e6 }, now, true), now - 3600e3);
    assert.equal(L.sinceOf({ chat: now - 60e3, prev: now - 9e6 }, now, true), now - 9e6);
    assert.equal(L.sinceOf({ chat: now - 3600e3, prev: now - 9e6 }, now, false), now - 9e6);
    assert.equal(L.sinceOf({ chat: now - 30 * 864e5, prev: 1 }, now, true), now - 7 * 864e5);
  });
  it('remLine / relDay: "תזכורת: … – מחר 08:00", אירוע בלי שעה, יום בשבוע', () => {
    assert.equal(L.remLine({ title: 'להתקשר לספק', d: '2026-11-16', rem: true }, '2026-11-15', '08:00'), 'תזכורת: להתקשר לספק – מחר 08:00');
    assert.equal(L.remLine({ title: 'פגישה', d: '2026-11-15', tm: '14:30' }, '2026-11-15', '08:00'), 'ביומן: פגישה – היום 14:30');
    assert.equal(L.relDay('2026-11-18', '2026-11-15'), 'יום רביעי 18.11');
    assert.equal(L.relDay('bad', '2026-11-15'), '');
  });
});

// 15.11.2026 (סעיף 7): "תזכירי לי שוב" – פענוח ניסוח בעברית בלי מודל, ותצוגת יום ושעה בתזכורת יומן
describe('sec-remind: snoozeOf, dayHm, whenL', () => {
  const RM = require('../functions/lib/sec-remind.js');
  const IL = (s) => Date.parse(s + ':00+02:00');
  const now = IL('2026-11-15T11:00'); // ראשון
  const hm = (r) => r && RM.il(r.at).day + ' ' + RM.il(r.at).hm;
  it('ניסוחים מוכרים → זמן נכון (שעון ישראל), עם תווית', () => {
    const cases = [
      ['תשלחי שוב בעוד שעה', '2026-11-15 12:00', 'היום 12:00'],
      ['בעוד 3 שעות', '2026-11-15 14:00', 'היום 14:00'],
      ['בעוד שלוש שעות', '2026-11-15 14:00'],
      ['בעוד שעתיים', '2026-11-15 13:00'],
      ['תזכירי לי בעוד 20 דקות', '2026-11-15 11:20'],
      ['בעוד חצי שעה', '2026-11-15 11:30'],
      ['בעוד רבע שעה', '2026-11-15 11:15'],
      ['בעוד שעה וחצי', '2026-11-15 12:30'],
      ['מחר בבוקר', '2026-11-16 08:00', 'מחר 08:00'],
      ['תזכירי לי שוב מחר בבוקר', '2026-11-16 08:00'],
      ['מחר ב-9:30', '2026-11-16 09:30'],
      ['מחר בשעה 14', '2026-11-16 14:00'],
      ['היום ב-16:00', '2026-11-15 16:00'],
      ['"שוב בעוד יומיים!"', '2026-11-17 11:00', 'יום שלישי 17.11, 11:00'],
    ];
    for (const [t, want, l] of cases) { const r = RM.snoozeOf(t, now); assert.equal(hm(r), want, t); if (l) assert.equal(r.l, l, t); }
  });
  it('"בעוד דקה" כשיש שניות – לא נדחה (עיגול כלפי מעלה)', () => {
    const r = RM.snoozeOf('בעוד דקה', now + 30e3);
    assert.ok(r && r.at >= now + 30e3 + 60e3 && r.at % 60e3 === 0);
  });
  it('"מחר בבוקר" בחמישי – יום העסקים הבא (ראשון) 08:00', () => {
    assert.equal(hm(RM.snoozeOf('מחר בבוקר', IL('2026-11-19T15:00'))), '2026-11-22 08:00');
  });
  it('לא מנחשים: הוראה אחרת, זמן שעבר, מעל 60 יום, שעה לא קיימת, טקסט ארוך', () => {
    for (const t of ['אל תתריעי לי על התראות כאלה', 'בעוד שעה תתקשרי לספק', 'היום ב-8:00', 'בעוד 90 ימים', 'מחר ב-25:00', 'בעוד 3 שעתיים', '', 'בעוד שעה '.repeat(10)]) assert.equal(RM.snoozeOf(t, now), null, t);
  });
  it('dayHm / whenL', () => {
    assert.equal(RM.dayHm('2026-11-15', '12:00'), 'יום ראשון 15.11, 12:00');
    assert.equal(RM.dayHm('2026-11-15'), 'יום ראשון 15.11');
    assert.equal(RM.whenL(IL('2026-11-15T12:00'), now), 'היום 12:00');
    assert.equal(RM.whenL(IL('2026-11-16T08:00'), now), 'מחר 08:00');
    assert.equal(RM.whenL(IL('2026-11-20T09:05'), now), 'יום שישי 20.11, 09:05');
  });
});
