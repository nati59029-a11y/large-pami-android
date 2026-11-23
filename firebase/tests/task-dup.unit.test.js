'use strict';
// זיהוי משימה כפולה (app-source/www/task-dup.js): בדיקות יחידה, בלי אמולטור. מקרים שאמורים להיתפס וכאלה שלא.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../app-source/www/task-dup.js');

const T = 1795000000000, DAY = 864e5;
const ex = (id, txt, o) => Object.assign({ id, txt, st: 'open', ow: 'u1', to: ['u1'], dl: T + DAY }, o || {});
const hit = (txt, list, nt) => D.find(Object.assign({ txt, uids: ['u1'], dl: T + DAY }, nt || {}), list);

describe('task-dup: נרמול', () => {
  it('ניקוד, אותיות שימוש וריבוי מתאחדים', () => {
    assert.equal(D.norm('לנקות את המחסן'), D.norm('ניקיון המחסנים'));
    assert.equal(D.norm('לְהַזְמִין מדפים'), D.norm('הזמנת המדף'));
  });
  it('מילים נרדפות: לשטוף = לנקות, לקנות = להזמין', () => {
    assert.equal(D.norm('לשטוף מקרר'), D.norm('לנקות את המקרר'));
    assert.equal(D.norm('לקנות חלב'), D.norm('להזמין חלב'));
  });
});

describe('task-dup: מה שאמור להיתפס', () => {
  it('טקסט זהה', () => assert.equal(hit('להזמין חלב', [ex('a', 'להזמין חלב')]).length, 1));
  it('אותה משמעות בניסוח אחר', () => {
    assert.equal(hit('לנקות את המחסן', [ex('a', 'ניקיון המחסן היום')]).length, 1);
    assert.equal(hit('לשטוף את המקרר', [ex('a', 'לנקות מקרר')])[0].task.id, 'a');
    assert.equal(hit('להתקשר לספק הירקות', [ex('a', 'טלפון לספק ירקות')]).length, 1);
  });
  it('רבים ויחיד, ו"ה" בתחילת מילה', () => {
    assert.equal(hit('לסדר את המדפים', [ex('a', 'סידור מדף')]).length, 1);
  });
  it('אותו עובד מעלה ציון', () => {
    const same = hit('לבדוק חשבוניות ספקים', [ex('a', 'לבדוק את החשבונית של הספק')])[0];
    assert.ok(same && same.why.includes('אותו עובד'));
  });
  it('משימה בהמתנה לאישור גם נחשבת פתוחה', () => assert.equal(hit('להזמין חלב', [ex('a', 'להזמין חלב', { st: 'wait' })]).length, 1));
  it('יעד קרוב מוצג בסיבות', () => assert.ok(hit('לנקות מחסן', [ex('a', 'ניקיון מחסן')])[0].why.includes('יעד קרוב')));
});

describe('task-dup: מה שלא אמור להיתפס', () => {
  it('אותה פעולה, חפץ אחר', () => {
    assert.equal(hit('לנקות את המחסן', [ex('a', 'לנקות את המקרר')]).length, 0);
    assert.equal(hit('להזמין חלב', [ex('a', 'להזמין מדפים')]).length, 0);
  });
  it('אותו חפץ, פעולה אחרת', () => {
    assert.equal(hit('לבדוק מקרר', [ex('a', 'לתקן מקרר')]).length, 0);
  });
  it('מספרים שונים', () => assert.equal(hit('לבדוק הזמנה 5', [ex('a', 'לבדוק הזמנה 6')]).length, 0));
  it('משימה סגורה או שהושלמה לא נספרת', () => {
    assert.equal(hit('להזמין חלב', [ex('a', 'להזמין חלב', { st: 'done' })]).length, 0);
  });
  it('פעולה כללית בלבד ("לנקות") ללא מילת תוכן משותפת', () => {
    assert.equal(hit('לנקות מחסן', [ex('a', 'לשטוף רצפה')]).length, 0);
  });
  it('עובד אחר ויעד רחוק – לא נתפס כשהדמיון חלקי', () => {
    assert.equal(hit('לבדוק את המלאי של החלב', [ex('a', 'לבדוק מלאי', { ow: 'u2', to: ['u2'], dl: T + 20 * DAY })], { txt: 'לבדוק את המלאי של החלב' }).length, 0);
  });
  it('קלט ריק או לא תקין לא זורק שגיאה', () => {
    assert.deepEqual(D.find(null, null), []);
    assert.deepEqual(D.find({ txt: '' }, [ex('a', 'x')]), []);
    assert.deepEqual(D.find({ txt: 'להזמין חלב' }, [null, {}, { st: 'open' }]), []);
  });
});
