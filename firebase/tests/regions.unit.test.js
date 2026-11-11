'use strict';
// מעבר לאירופה (11.11.2026): בדיקת אזורי הפונקציות, בלי אמולטור (טוען את הקוד ובודק את ההגדרות שהפרסום ישתמש בהן).
//   - כל onCall: בדיוק שני אזורים – europe-west1 (חדש) ו-us-central1 (לטלפונים עם גרסה ישנה).
//   - מתוזמנת, טריגרים ו-onRequest: אזור אחד בלבד (us-central1). ריצה כפולה של מתוזמנת/טריגר = פעולה כפולה.
//   - אין minInstances (בלי עלות קבועה).
//   - רשימת הפרסום שמופקת מהקוד (scripts/list-callable-functions.js) = כל ה-onCall, בלי אף פונקציה מיוחדת.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FN_DIR = path.join(__dirname, '..', 'functions');
const ex = require(path.join(FN_DIR, 'index.js'));
const hook = require(path.join(FN_DIR, 'yemot-hook.js')); // tzintukJoin מושבת (לא מיוצא מ-index.js), אבל אם יופעל – אזור אחד
const R = require(path.join(FN_DIR, 'lib', 'region.js'));

const BOTH = ['europe-west1', 'us-central1'];
const SINGLE = ['expirePromosOnLine', 'syncLegacyAdmin', 'syncLegacyStaff', 'tzintukJoin', 'publicBrand'];
const ep = (f) => f && f.__endpoint;
const regions = (f) => [].concat(ep(f).region || []);
const entries = Object.entries(ex).filter(([, f]) => ep(f));
const callable = entries.filter(([, f]) => ep(f).callableTrigger).map(([n]) => n).sort();

describe('אזורי פונקציות (מעבר לאירופה)', () => {
  it('הקבועים: אזור חדש europe-west1, ישן us-central1', () => {
    assert.equal(R.NEW_REGION, 'europe-west1');
    assert.equal(R.LEGACY_REGION, 'us-central1');
    assert.deepEqual(R.CALL_REGIONS, BOTH);
  });

  it('כל פונקציה מיוצאת היא onCall או אחת מהפונקציות המיוחדות', () => {
    const other = entries.filter(([, f]) => !ep(f).callableTrigger).map(([n]) => n).sort();
    assert.deepEqual(other, ['expirePromosOnLine', 'publicBrand', 'syncLegacyAdmin', 'syncLegacyStaff']);
    assert.ok(callable.length >= 60, 'נמצאו רק ' + callable.length + ' פונקציות onCall');
  });

  it('כל onCall מוגדרת בדיוק בשני האזורים', () => {
    const bad = callable.filter((n) => JSON.stringify(regions(ex[n])) !== JSON.stringify(BOTH));
    assert.deepEqual(bad, [], 'פונקציות onCall בלי שני האזורים: ' + bad.join(', '));
  });

  it('5 הפונקציות המיוחדות – באזור us-central1 בלבד', () => {
    for (const n of SINGLE) {
      const f = ex[n] || hook[n];
      assert.ok(ep(f), n + ' לא נמצאה');
      assert.equal(ep(f).callableTrigger, undefined, n + ' לא אמורה להיות onCall');
      assert.deepEqual(regions(f), ['us-central1'], n);
    }
    assert.ok(ep(ex.expirePromosOnLine).scheduleTrigger, 'expirePromosOnLine מתוזמנת');
    assert.ok(ep(ex.syncLegacyAdmin).eventTrigger && ep(ex.syncLegacyStaff).eventTrigger, 'טריגרים של Firestore');
  });

  it('אין פונקציה שאינה onCall ביותר מאזור אחד', () => {
    const bad = entries.filter(([, f]) => !ep(f).callableTrigger && regions(f).length !== 1).map(([n]) => n);
    assert.deepEqual(bad, []);
  });

  it('אין minInstances (בלי עלות קבועה)', () => {
    // ResetValue (ברירת המחדל של הספרייה) = 0. כל מספר גדול מ-0, או ערך מחושב, נחשב minInstances
    const isMin = (v) => (typeof v === 'number' ? v > 0 : !!v && !(v.constructor && v.constructor.name === 'ResetValue'));
    const bad = [...entries, ['tzintukJoin', hook.tzintukJoin]].filter(([, f]) => isMin(ep(f).minInstances)).map(([n]) => n);
    assert.deepEqual(bad, []);
  });

  it('רשימת הפרסום מהסקריפט = כל ה-onCall', () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'list-callable-functions.js')], { encoding: 'utf8' }).trim();
    const list = out.split(',');
    assert.deepEqual([...list].sort(), callable);
    for (const n of SINGLE) assert.ok(!list.includes(n), n + ' לא אמורה להיות ברשימת הפרסום הכפול');
    for (const n of list) assert.match(n, /^[A-Za-z][A-Za-z0-9_]{0,62}$/); // אותו תנאי כמו ב-deploy-functions.yml
  });
});
