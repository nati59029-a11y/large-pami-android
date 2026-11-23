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

    // כל האוספים (9 שבטבלה + משימות ותגובות במשימה) ו-5 התפקידים מופיעים
    const nine = ['admins', 'cfg', 'shelf', 'fb', 'bk', 'chunks', 'inbox', 'staff', 'app_backup_status', 'tasks', 'tasks_c', 'supinv', 'supinv_p', 'appreq', 'appreq_p', 'closings', 'closings_p', 'cashout', 'deposits', 'deposits_p', 'zlast', 'mq', 'mq_p'];
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
    // excluded: קריאות שבכוונה אין להן כלל בקובץ הזה (עם סיבה כתובה), למשל קוד שרץ רק מול פרויקט הבדיקות
    const excluded = ops.excluded || [];
    for (const n of new Set(callLines)) assert.ok(ops.rows.some((r) => r.line === n) || excluded.some((r) => r.line === n), `שורה ${n}: קריאה ל-fsx בלי שורה בטבלת המיפוי`);
    for (const r of ops.rows.concat(excluded)) assert.ok(lines[r.line - 1].includes(r.snippet), `${r.id}: הקטע "${r.snippet}" לא נמצא בשורה ${r.line}`);
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

  it('app-source/firestore.rules הוא עותק זהה תו-בתו של firebase/firestore.rules', () => {
    const a = fs.readFileSync(path.join(H.ROOT, 'firestore.rules'), 'utf8');
    const b = fs.readFileSync(path.join(H.ROOT, '..', 'app-source', 'firestore.rules'), 'utf8');
    assert.ok(a === b, 'app-source/firestore.rules שונה מ-firebase/firestore.rules – העתק אותו מחדש');
  });

  it('firestore.rules: הכלל האחרון סוגר את כל מה שלא הוגדר', () => {
    const t = rulesText('firestore.rules');
    const matches = [...t.matchAll(/match\s+(\/[^\s{]*(?:\{[^}]*\}[^\s{]*)*)\s*\{/g)].map((m) => m[1]);
    assert.equal(matches[matches.length - 1], '/{document=**}');
    assert.match(t, /match\s+\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}\s*\}\s*\}\s*$/);
    // אין אוספים נוספים מעבר ל-9 שבטבלה, משימות (tasks), תגובות (c – מקונן בתוך tasks/{id}),
    // חשבוניות ספקים לעובד (supinv, וחלקי התמונה p – מקונן בתוך supinv/{id}),
    // ובקשות לעדכון האפליקציה (appreq, וחלקי התמונות p – מקונן בתוך appreq/{id})
    // וסגירת קופה (closings, וחלקי הצילומים p – מקונן בתוך closings/{id})
    // והוצאות מקופה (cashout) ואישורי הפקדה (deposits, וחלקי הצילומים p – מקונן בתוך deposits/{id}) – שלב 2, וזמן הסגירה האחרונה (zlast)
    // ואוספי ימות (yemot_items, yemot_line_backups, yemot_hook_usage, yemot_lexicon – משימה 2026-11-02; yemot_fbsent – 17.11.2026; yemot_tzsend – 18.11.2026)
    // משימות פרטיות (ptk), כללי משימות קבועות (rtk) ובקשות למנהל (rq, ותגובות c – מקונן בתוך rq/{id}) – 12.11.2026
    // תמונות בבקשות למנהל: p בתוך rq/{id} ו-p בתוך rq/{id}/c/{cid} – 17.11.2026 (סבב 2)
    // קבוצות התכתבות (grp, ובתוכו m, m/p ו-r) – 17.11.2026 (סבב 3)
    // סימונים (אימוג'י) על הודעות בקבוצה (x בתוך grp) – 19.11.2026
    // תבניות משימה בענן (tkt, ובתוכו p) – 18.11.2026 (סבב 4)
    // חוסרים (hsr, ובתוכו p; hsph – טלפון ספק; hsx – שמות מוצרים מחשבוניות) – 18.11.2026
    // גלאי גרסת הכללים rv (get של rv/tk2 בלבד) – מרכז עבודה סבב 2, 15.11.2026
    // ייבוא ברקע (impJobs – 2026-11-11, מסמך העבודה; החלקים המוצפנים ב-impQ בלי כלל = סגורים)
    // תמחור חשבונית ספק (pinv, וחלקי התמונה p – מקונן בתוך pinv/{id}) – 12.11.2026
    // מחיר קבוע ללקוח (cprice) והתראות מחירון (aralert) – 14.11.2026
    // פרטי העסק למסמכים, מונים ומזהי בקשה (arcfg) – 14.11.2026, שלב 3 חלק ב'
    // "להזמין מספקים" מתוך מסך הליקוט (supord) – 14.11.2026, משוב סבב 3
    // חשבוניות, קבלות וזיכויים (ardoc) והקצאות (aralloc) – 15.11.2026, שלב 4
    // סריקת חנות בתלת מימד – store3d (14.11.2026): s3br, s3set, smap (ver, bay מקוננים), s3draft, sround, srun (ph, ai מקוננים), s3sum, s3fix, s3appeal, s3short, s3use, s3perf, s3qid, s3ntf; שלב 18א: pano מקונן בתוך smap (סיור 360)
    // הקמת חנות (17.11.2026, שלב 3): s3setup (n, cap מקוננים), s3look – קריאה בלבד, כתיבה רק מהשרת
    // המזכירה – כללים אישיים ויומן "נשלח לבד" (sec_mrule, sec_mlog – 15.11.2026, שרת בלבד)
    // נוכחות (pres) ויומן שימוש (act) – 23.11.2026
    // הדפסת מדבקות – מוצר שהוקלד ידנית (lblp – 22.11.2026; מנהל או עובד עם המתג lbl)
    // ריבוי עסקים (2026-11-05): אוספי השורש נבדקים רק עד הבלוק match /b/{bizId}, שמכיל העתק שלהם בתוך העסק
    const rootPart = t.slice(0, t.indexOf('match /b/{bizId} {'));
    const rootMatches = [...rootPart.matchAll(/match\s+(\/[^\s{]*(?:\{[^}]*\}[^\s{]*)*)\s*\{/g)].map((m) => m[1]);
    const colls = rootMatches.filter((p) => p !== '/databases/{database}/documents' && p !== '/{document=**}').map((p) => p.split('/')[1]);
    assert.ok(/match \/b\/\{bizId\} \{/.test(t), 'בלוק העסקים חסר');
    assert.deepEqual(colls.sort(), ['act', 'admins', 'ai', 'app_backup_status', 'appreq', 'aralert', 'aralloc', 'arcfg', 'ardoc', 'bay', 'bk', 'c', 'c', 'cap', 'cardLog', 'cashout', 'cat', 'cfg', 'chunks', 'closings', 'cprice', 'cust', 'custcfg', 'deposits', 'fb', 'grp', 'hsph', 'hsr', 'hsx', 'impJobs', 'inbox', 'lblp', 'log', 'm', 'm', 'mq', 'n', 'n', 'ord', 'ordcfg', 'ordpay', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'pano', 'ph', 'pinv', 'pres', 'prod', 'ptk', 'r', 'rq', 'rtk', 'rv', 's3appeal', 's3br', 's3draft', 's3fix', 's3look', 's3ntf', 's3perf', 's3qid', 's3set', 's3setup', 's3short', 's3sum', 's3use', 'sec_cal', 'sec_cfg', 'sec_chat', 'sec_draft', 'sec_facts', 'sec_facts_sensitive', 'sec_in', 'sec_inv', 'sec_log', 'sec_mirror', 'sec_mlog', 'sec_mrule', 'sec_note', 'sec_rep', 'sec_rules', 'sec_usage', 'shelf', 'smap', 'sround', 'srun', 'staff', 'stockLog', 'superadmins', 'supinv', 'supord', 'tasks', 'tkt', 'users', 'ver', 'x', 'xfer', 'yemot_fbsent', 'yemot_hook_usage', 'yemot_items', 'yemot_lexicon', 'yemot_line_backups', 'yemot_tzsend', 'zlast']);
    assert.match(t, /match \/tasks\/\{id\} \{[\s\S]*match \/c\/\{cid\} \{/, 'c חייב להיות מקונן בתוך tasks');
    assert.match(t, /match \/rq\/\{id\} \{[\s\S]*?match \/c\/\{cid\} \{/, 'c חייב להיות מקונן בתוך rq');
    assert.match(t, /match \/tasks\/\{id\} \{[\s\S]*match \/p\/\{pid\} \{/, 'p (תמונות משימה) חייב להיות מקונן בתוך tasks');
    assert.match(t, /match \/supinv\/\{id\} \{[\s\S]*match \/p\/\{k\} \{/, 'p חייב להיות מקונן בתוך supinv');
    assert.match(t, /match \/appreq\/\{id\} \{[\s\S]*match \/p\/\{k\} \{/, 'p חייב להיות מקונן בתוך appreq');
    assert.match(t, /match \/closings\/\{id\} \{[\s\S]*match \/p\/\{k\} \{/, 'p חייב להיות מקונן בתוך closings');
    assert.match(t, /match \/cust\/\{id\} \{[\s\S]*match \/p\/\{k\} \{/, 'p חייב להיות מקונן בתוך cust (fb/ord-card)');
    assert.match(t, /match \/deposits\/\{id\} \{[\s\S]*match \/p\/\{k\} \{/, 'p חייב להיות מקונן בתוך deposits');
    assert.match(t, /match \/grp\/\{gid\} \{[\s\S]*?match \/m\/\{mid\} \{[\s\S]*?match \/p\/\{pid\} \{[\s\S]*?match \/r\/\{uid\} \{/, 'm, p ו-r חייבים להיות מקוננים בתוך grp');
    assert.match(t, /match \/grp\/\{gid\} \{[\s\S]*?match \/m\/\{mid\} \{[\s\S]*?match \/x\/\{xid\} \{[\s\S]*?match \/r\/\{uid\} \{/, 'x (סימונים) חייב להיות מקונן בתוך grp');
    assert.match(t, /match \/tkt\/\{id\} \{[\s\S]*?match \/p\/\{pid\} \{/, 'p חייב להיות מקונן בתוך tkt (תבניות משימה)');
    assert.match(t, /match \/pinv\/\{id\} \{[\s\S]*?match \/p\/\{k\} \{/, 'p חייב להיות מקונן בתוך pinv');
    assert.match(t, /match \/hsr\/\{id\} \{[\s\S]*?match \/p\/\{pid\} \{/, 'p חייב להיות מקונן בתוך hsr (חוסרים)');
    assert.match(t, /match \/smap\/\{mapId\} \{[\s\S]*?match \/ver\/\{vid\} \{[\s\S]*?match \/bay\/\{bayId\} \{/, 'ver ו-bay חייבים להיות מקוננים בתוך smap (store3d)');
    assert.match(t, /match \/smap\/\{mapId\} \{[\s\S]*?match \/pano\/\{pid\} \{[\s\S]*?match \/bay\/\{bayId\} \{/, 'pano חייב להיות מקונן בתוך smap (שלב 18א)');
    assert.match(t, /match \/s3setup\/\{mapId\} \{[\s\S]*?match \/n\/\{itemId\} \{[\s\S]*?match \/cap\/\{key\} \{/, 'n ו-cap חייבים להיות מקוננים בתוך s3setup (הקמת חנות)');
    assert.match(t, /match \/srun\/\{runId\} \{[\s\S]*?match \/ph\/\{slot\} \{[\s\S]*?match \/ai\/\{slot\} \{/, 'ph ו-ai חייבים להיות מקוננים בתוך srun (store3d)');
    // המזכירה (2026-11-11): m מקונן בתוך sec_chat, p בתוך sec_inv
    assert.match(t, /match \/sec_chat\/\{uid\} \{\s*allow read, create, update, delete: if false;\s*match \/m\/\{id\} \{/, 'm חייב להיות מקונן בתוך sec_chat');
    assert.match(t, /match \/sec_note\/\{uid\} \{\s*allow read, create, update, delete: if false;\s*match \/n\/\{id\} \{/, 'n חייב להיות מקונן בתוך sec_note (המזכירה שלב 4)');
    assert.match(t, /match \/sec_inv\/\{id\} \{[^}]*\}?[\s\S]{0,200}match \/p\/\{k\} \{/, 'p חייב להיות מקונן בתוך sec_inv');
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
