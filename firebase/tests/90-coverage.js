'use strict';
// בדיקות כיסוי ובדיקות על הטקסט של הכללים. רץ אחרי כל שאר הבדיקות.
// 1. כל תא ב"אוסף × תפקיד × פעולה" (permissions-matrix.json) נבדק, והבדיקה עברה עם התוצאה הצפויה.
// 2. כל שורה בטבלת המיפוי (app-operations.json) מכוסה בבדיקת "מותר" שעברה, לכל תפקיד שמבצע אותה.
// 3. כל קריאה ל-fsx בקוד האפליקציה מופיעה בטבלת המיפוי (אף פעולה לא נשכחה).
// 4. "request.auth != null" לא מופיע לבד כתנאי גישה.
// 5. הכלל האחרון בכל קובץ סוגר את כל מה שלא הוגדר.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const matrix = require('./permissions-matrix.json');
const ops = require('./app-operations.json');
const H = require('./helpers');

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const rulesText = (f) => stripComments(fs.readFileSync(path.join(H.ROOT, f), 'utf8'));

function expandMatrix() {
  const cells = [];
  for (const [service, colls] of Object.entries({ firestore: matrix.firestore, storage: matrix.storage })) {
    for (const [coll, spec] of Object.entries(colls)) {
      for (const [op, flags] of Object.entries(spec.ops)) {
        assert.equal(flags.length, H.ROLES.length, `${coll}/${op}: צריך תו לכל אחד מ-5 התפקידים`);
        H.ROLES.forEach((role, i) => cells.push({ key: `${service}|${coll}|${role}|${op}`, service, coll, role, op,
          expected: flags[i] === 'A' ? 'allow' : 'deny', tableText: spec.tableText[role], source: spec.source }));
      }
    }
  }
  return cells;
}

describe('כיסוי ובדיקות טקסט של הכללים', () => {
  it('כיסוי: כל תא "אוסף × תפקיד × פעולה" נבדק ועבר עם התוצאה הצפויה', () => {
    const cells = expandMatrix();
    const done = new Map();
    for (const r of H.RESULTS.matrix) done.set(r.key, r.expected);
    const missing = cells.filter((c) => done.get(c.key) !== c.expected).map((c) => c.key);
    const extra = [...done.keys()].filter((k) => !cells.find((c) => c.key === k));
    assert.deepEqual(missing, [], 'תאים בלי בדיקה שעברה');
    assert.deepEqual(extra, [], 'בדיקות שלא מופיעות ברשימה');

    // כל 9 האוספים ו-5 התפקידים מופיעים
    const nine = ['admins', 'cfg', 'shelf', 'fb', 'bk', 'chunks', 'inbox', 'staff', 'app_backup_status'];
    for (const c of nine) for (const r of H.ROLES) assert.ok(cells.some((x) => x.coll === c && x.role === r), `${c} × ${r} חסר`);

    const denyCells = cells.filter((c) => c.expected === 'deny');
    // כל תא שבטבלה כתוב בו "אין" – כל הפעולות עליו בבדיקת "נחסם"
    const noneCells = cells.filter((c) => c.tableText === 'אין');
    assert.ok(noneCells.every((c) => c.expected === 'deny'), 'תא "אין" שמסומן כמותר');
    const summary = {
      cells: cells.length, allowCells: cells.length - denyCells.length, denyCells: denyCells.length,
      tableNoneCells: new Set(noneCells.map((c) => `${c.service}|${c.coll}|${c.role}`)).size,
      tableNoneOps: noneCells.length,
      perCollection: Object.fromEntries([...new Set(cells.map((c) => c.coll))].map((k) => [k, cells.filter((c) => c.coll === k).length])),
    };
    fs.mkdirSync(path.join(__dirname, '.results'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '.results', 'matrix-cells.json'), JSON.stringify(cells, null, 1));
    fs.writeFileSync(path.join(__dirname, '.results', 'summary.json'), JSON.stringify(summary, null, 1));
    console.log('# סיכום כיסוי: ' + JSON.stringify(summary));
  });

  it('כיסוי: כל שורה בטבלת המיפוי מכוסה בבדיקת "מותר" שעברה (ובבדיקת "נחסם" למחובר שאינו ב-staff ולעובד מושבת)', () => {
    const missing = [];
    for (const row of ops.rows) {
      const roles = row.who.concat(row.who.includes('manager') ? ['managerAdminsOnly'] : []);
      for (const role of roles) if (!H.RESULTS.app.find((r) => r.id === row.id && r.role === role && r.result === 'allow')) missing.push(`${row.id}/${role}/allow`);
      for (const role of ['signedIn', 'disabledEmployee']) if (!H.RESULTS.app.find((r) => r.id === row.id && r.role === role && r.result === 'deny')) missing.push(`${row.id}/${role}/deny`);
    }
    assert.deepEqual(missing, []);
  });

  it('כיסוי: כל קריאה ל-Firestore בקוד האפליקציה (fsx) מופיעה בטבלת המיפוי, בשורה הנכונה', () => {
    const lines = H.appSourceLines();
    const calls = [];
    lines.forEach((l, i) => { const n = (l.match(/fsx\(/g) || []).length; for (let k = 0; k < n; k++) calls.push(i + 1); });
    const callLines = calls.filter((n) => n !== ops.fsxDefinitionLine);
    assert.ok(lines[ops.fsxDefinitionLine - 1].includes('async function fsx('), 'שורת ההגדרה של fsx זזה');
    // כל שורה עם קריאה – יש לה שורת מיפוי; כל שורת מיפוי – הקטע שלה באמת נמצא בשורה הזו
    for (const n of new Set(callLines)) assert.ok(ops.rows.some((r) => r.line === n), `שורה ${n}: קריאה ל-fsx בלי שורה בטבלת המיפוי`);
    for (const r of ops.rows) assert.ok(lines[r.line - 1].includes(r.snippet), `${r.id}: הקטע "${r.snippet}" לא נמצא בשורה ${r.line}`);
    // אין פנייה ל-Firestore שלא דרך fsx
    const direct = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /firestore\.googleapis\.com/.test(l));
    assert.deepEqual(direct.map(([n]) => n), [ops.fsbLine], 'פנייה ישירה ל-Firestore מחוץ ל-FSB');
    console.log(`# קריאות fsx בקוד: ${callLines.length} (ב-${new Set(callLines).size} שורות); שורות במיפוי: ${ops.rows.length}`);
  });

  for (const f of ['firestore.rules', 'storage.rules']) {
    it(`${f}: "request.auth != null" לא מופיע לבד כתנאי גישה`, () => {
      const t = rulesText(f);
      const re = /request\.auth\s*!=\s*null/g; let m; let count = 0;
      while ((m = re.exec(t))) {
        count++;
        const after = t.slice(m.index + m[0].length).trimStart();
        assert.ok(after.startsWith('&&'), `מופע ${count}: אחרי התנאי אין "&&" – כלומר הוא עומד לבד`);
      }
      // ואין כלל allow שהתנאי שלו הוא רק זה
      assert.ok(!/allow[^;]*:\s*if\s*request\.auth\s*!=\s*null\s*;/.test(t));
      console.log(`# ${f}: ${count} מופעים של request.auth != null, כולם מחוברים ב-&& לבדיקת תפקיד או זהות`);
    });
  }

  it('firestore.rules: הכלל האחרון סוגר את כל מה שלא הוגדר', () => {
    const t = rulesText('firestore.rules');
    const matches = [...t.matchAll(/match\s+(\/[^\s{]*(?:\{[^}]*\}[^\s{]*)*)\s*\{/g)].map((m) => m[1]);
    assert.equal(matches[matches.length - 1], '/{document=**}');
    assert.match(t, /match\s+\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}\s*\}\s*\}\s*$/);
    // אין אוספים נוספים מעבר ל-9 שבטבלה
    const colls = matches.filter((p) => p !== '/databases/{database}/documents' && p !== '/{document=**}').map((p) => p.split('/')[1]);
    assert.deepEqual(colls.sort(), ['admins', 'app_backup_status', 'bk', 'cfg', 'chunks', 'fb', 'inbox', 'shelf', 'staff']);
  });

  it('storage.rules: הכלל האחרון סוגר את כל מה שלא הוגדר', () => {
    const t = rulesText('storage.rules');
    const matches = [...t.matchAll(/match\s+(\/\S*)\s*\{/g)].map((m) => m[1]);
    assert.equal(matches[matches.length - 1], '/{allPaths=**}');
    assert.match(t, /match\s+\/\{allPaths=\*\*\}\s*\{\s*allow read, write: if false;\s*\}\s*\}\s*\}\s*$/);
    assert.deepEqual(matches.filter((p) => p.startsWith('/app') || p.startsWith('/{all')), ['/app_backups/{userId}/{fileName}', '/app_releases/{allPaths=**}', '/{allPaths=**}']);
  });

  it('המקרים המיוחדים רצו', () => {
    const need = ['case1-cfg', 'case1-shelf', 'case2-disabled-immediately', 'case2-no-self-reactivate', 'case3-manager-admins-only', 'storage-50mb-boundary', 'storage-app-releases-admins-only-and-disable', 'storage-app-releases-rest', 'anonymous']
      .concat(H.ROLES.map((r) => 'case3-' + r));
    const got = new Set(H.RESULTS.special.map((r) => r.key));
    assert.deepEqual(need.filter((k) => !got.has(k)), []);
  });
});
