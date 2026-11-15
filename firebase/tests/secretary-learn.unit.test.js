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
