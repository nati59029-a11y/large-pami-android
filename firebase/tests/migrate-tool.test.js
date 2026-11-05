'use strict';
// בדיקות כלי ההעברה (שלב 4, משימה 2026-11-05). רץ רק מול האמולטור, עם נתוני דמה במבנה של הנתונים האמיתיים
// (אותם אוספים, תת-אוספים וטיפוסים; לא נתונים אמיתיים). לא דרך all.test.js (שלא משתנה):
//   firebase emulators:exec --only firestore,storage --project demo-largpeami "node --test tests/migrate-tool.test.js"
// הבדיקות מפעילות את הכלי עצמו (node migrate/migrate.js ...) כתהליך נפרד, בדיוק כמו בהרצה ידנית.
// הערה: קוד הבדיקה (ולא הכלי) כותב לשורש ומנקה את האמולטור, כדי לדמות את האפליקציה ולהתחיל מאפס.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'migrate', 'migrate.js');
const GUARD = path.join(ROOT, 'migrate', 'guard.js');
const P = 'demo-largpeami';
const BIZ = 'largpeami';
const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const BASE = `http://${EMU}/v1/projects/${P}/databases/(default)/documents`;
const NAME = `projects/${P}/databases/(default)/documents`;
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'migrate-test-'));
const F = n => path.join(TMP, n);
const rq = createRequire(path.join(ROOT, 'functions', 'package.json'));
const { hashFields } = require('../migrate/fsrest');
const { checkGuard } = require('../migrate/guard');

if (!EMU || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('הבדיקות רצות רק בתוך האמולטור');

const enc = p => p.split('/').map(encodeURIComponent).join('/');
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: body && JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok && r.status !== 404) throw new Error(method + ' ' + url + ' ' + r.status + ' ' + t);
  return r.status === 404 ? null : (t ? JSON.parse(t) : {});
}
// "האפליקציה" כותבת (קוד בדיקה בלבד)
async function put(p, fields) { await api('POST', BASE + ':commit', { writes: [{ update: { name: NAME + '/' + p, fields } }] }); }
async function putMany(list) {
  for (let i = 0; i < list.length; i += 400) {
    await api('POST', BASE + ':commit', { writes: list.slice(i, i + 400).map(([p, f]) => ({ update: { name: NAME + '/' + p, fields: f } })) });
  }
}
async function get(p) { return api('GET', BASE + '/' + enc(p)); }

function run(args, extraEnv = {}) {
  return new Promise(res => {
    execFile(process.execPath, [TOOL, ...args, '--project', P], { env: { ...process.env, ...extraEnv }, maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
      res({ code: err ? err.code : 0, out: stdout + stderr });
    });
  });
}
const report = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const OUT = []; // פלט מצוטט לדוח
function show(title, r) { OUT.push('### ' + title + '\n' + r.out.trim()); console.log('# ---- ' + title + '\n' + r.out.trim().split('\n').map(l => '# ' + l).join('\n')); }

// ---- נתוני דמה ----
const S = v => ({ stringValue: v }), D = v => ({ doubleValue: v }), I = v => ({ integerValue: String(v) }), B = v => ({ booleanValue: v });
const TS = v => ({ timestampValue: v }), M = f => ({ mapValue: { fields: f } }), A = (...v) => ({ arrayValue: { values: v } });
const TYPES = {
  amountInt: D(120), amountFrac: D(99.9), negative: D(-45.5), credit: D(-0.01), big: I('9007199254740993'), small: I(7),
  nan: D('NaN'), inf: D('Infinity'), when: TS('2026-10-28T10:00:00.123456789Z'), whenMs: TS('2026-10-28T10:00:00.5Z'),
  geo: { geoPointValue: { latitude: 32.0853, longitude: 34.7818 } }, ref: { referenceValue: NAME + '/cfg/main' },
  bytes: { bytesValue: Buffer.from([0, 1, 2, 250, 255]).toString('base64') }, nul: { nullValue: null }, t: B(true), f: B(false),
  heb: S('קפה ומאפה – 12% הנחה'), empty: S(''), emptyMap: { mapValue: {} }, emptyArr: { arrayValue: {} },
  nested: M({ a: A(D(1), I(2), S('x'), M({ deep: A(TS('2026-01-01T00:00:00Z'), { nullValue: null }) })), z: B(false) }),
};
const ODD_IDS = ['עברית ורווח', 'a#b', 'p%20q', 'שאלה?', 'dots.in.id', 'x'.repeat(200)];

async function clearAll() {
  await fetch(`http://${EMU}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });
  const bk = storage();
  const [files] = await bk.getFiles();
  for (const f of files) await f.delete(); // ניקוי האמולטור בלבד
}
let bucketObj = null;
function storage() {
  if (bucketObj) return bucketObj;
  const { initializeApp } = rq('firebase-admin/app');
  const { getStorage } = rq('firebase-admin/storage');
  bucketObj = getStorage(initializeApp({ projectId: P, storageBucket: P + '.appspot.com' }, 'test')).bucket();
  return bucketObj;
}

async function seed() {
  const now = '2026-10-28T10:00:00.000Z';
  const w = [];
  w.push(['admins/u_mgr', { email: S('mgr@example.invalid') }]);
  w.push(['admins/u_mgr2', { email: S('mgr2@example.invalid') }]);
  const st = (uid, role, active) => w.push(['staff/' + uid, { name: S(uid), email: S(uid + '@example.invalid'), role: S(role), active: B(active), addedAt: S(now), addedBy: S('u_mgr'), pushTokens: A() }]);
  st('u_mgr', 'manager', true); st('u_emp', 'worker', true); st('u_emp2', 'worker', true); st('u_off', 'worker', false);
  w.push(['cfg/main', { data: S('{"cats":["מזון","שכירות"]}'), updatedAt: TS(now) }]);
  w.push(['cfg/types', TYPES]);
  w.push(['bk/2026-10', { data: S('gz-base64...'), n: I(3) }]);
  w.push(['chunks/c1', { d: S('abc'), i: I(0) }]);
  w.push(['chunks/fbhi_1', { d: S('img'), i: I(1) }]);
  for (let i = 0; i < 650; i++) w.push([`inbox/m${String(i).padStart(4, '0')}`, { from: S('u_emp'), amount: D(i * 1.5), t: TS(now), kind: S(i % 2 ? 'exp' : 'inv') }]);
  for (const id of ODD_IDS) w.push(['inbox/' + id, { odd: S(id) }]);
  w.push(['app_backup_status/u_mgr', { at: TS(now), ok: B(true) }]);
  w.push(['shelf/s1', { name: S('לחם'), price: D(12), promo: M({ pct: D(10) }) }]);
  w.push(['fb/f1', { stars: I(5), text: S('מעולה') }]);
  w.push(['tasks/t1', { title: S('לסדר מדף'), done: B(false), due: TS(now) }]);
  w.push(['tasks/t1/c/c1', { text: S('בוצע חלקית'), by: S('u_emp') }]);
  w.push(['tasks/orphan/c/c9', { text: S('תגובה שהאב שלה ריק') }]); // אב "חסר": קיים רק כאב של תת-אוסף
  w.push(['supinv/s1', { sup: S('ספק א'), amount: D(1000) }]);
  w.push(['supinv/s1/p/0', { img: S('...') }]);
  w.push(['appreq/r1', { text: S('באג'), status: S('open') }]);
  w.push(['appreq/r1/p/0', { img: S('...') }]);
  w.push(['closings/2026-10-28', { z: D(5321.5), cash: D(1200), by: S('u_emp') }]);
  w.push(['closings/2026-10-28/p/0', { img: S('...') }]);
  w.push(['cashout/co1', { amount: D(-200), reason: S('זיכוי') }]);
  w.push(['deposits/d1', { amount: D(3000) }]);
  w.push(['deposits/d1/p/0', { img: S('...') }]);
  w.push(['zlast/reg1', { z: I(1234) }]);
  w.push(['yemot_items/i1', { text: S('מבצע') }]);
  w.push(['yemot_lexicon/main', { words: M({ 'לארג': S('לַארְג') }) }]);
  w.push(['yemot_state/s', { on: B(true) }]);
  w.push(['voice_usage/2026-10-28', { chars: I(500) }]);
  w.push(['scan_usage/2026-10-28', { n: I(3) }]);
  w.push(['site_income_daily/2026-10-28', { sum: D(10) }]); // orders – נדחה
  w.push(['mystery/x', { a: S('לא ידוע') }]); // אוסף שלא במיפוי
  await putMany(w);
  const bk = storage();
  await bk.file('app_backups/u_mgr/2026-10-28.json.gz.enc').save(Buffer.alloc(2048, 7), { contentType: 'application/octet-stream' });
  await bk.file('app_backups/u_mgr/2026-10-29.json.gz.enc').save(Buffer.alloc(4096, 9), { contentType: 'application/octet-stream' });
  await bk.file('app_backups/u_emp/2026-10-29.json.gz.enc').save(Buffer.from('emp backup'), { contentType: 'application/octet-stream' });
  await bk.file('app_releases/latest/app.apk').save(Buffer.from('apk'), { contentType: 'application/vnd.android.package-archive' });
}

// סריקה עצמאית (בלי קוד הכלי) של כל השורש, להשוואה מלאה לפני ואחרי
async function snapshotRoot() {
  const out = {};
  async function coll(p) {
    let tok;
    do {
      const r = await api('GET', BASE + '/' + enc(p) + '?showMissing=true&pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
      for (const d of (r && r.documents) || []) {
        const rel = d.name.slice(NAME.length + 1);
        out[rel] = d.createTime ? JSON.stringify({ f: d.fields || {}, u: d.updateTime }) : 'MISSING';
        const s = await api('POST', BASE + '/' + enc(rel) + ':listCollectionIds', {});
        for (const c of (s && s.collectionIds) || []) await coll(rel + '/' + c);
      }
      tok = r && r.nextPageToken;
    } while (tok);
  }
  const top = await api('POST', BASE + ':listCollectionIds', {});
  for (const c of top.collectionIds.filter(c => c !== 'b' && c !== 'users')) await coll(c);
  return out;
}

describe('כלי העברה – באמולטור עם נתוני דמה', () => {
  let before0;
  before(async () => { await clearAll(); await seed(); before0 = await snapshotRoot(); });

  it('1. גיבוי: כל האוספים בשורש, סיבוב מלא בלי איבוד טיפוס, אוסף לא ידוע מסומן', async () => {
    const r = await run(['backup', '--out', F('backup1.json')]);
    show('backup', r);
    assert.equal(r.code, 0);
    const b = report(F('backup1.json'));
    assert.equal(b.collections.mystery.plan, 'unknown');
    assert.equal(b.collections.site_income_daily.plan, 'deferred');
    assert.equal(b.docs['tasks/orphan'].missing, true);
    assert.deepEqual(b.docs['cfg/types'].fields, (await get('cfg/types')).fields, 'הטיפוסים בקובץ הגיבוי זהים לגולמי');
    assert.match(r.out, /בדיקת סיבוב של קובץ הגיבוי: עברה/);
    const again = await run(['backup', '--out', F('backup1.json')]);
    assert.notEqual(again.code, 0, 'לא דורסים קובץ גיבוי קיים');
  });

  it('2. dry-run: סופר ולא כותב כלום (גם לא ליעד)', async () => {
    const r = await run(['dry-run', '--report', F('dry.json')]);
    show('dry-run', r);
    assert.equal(r.code, 0);
    const d = report(F('dry.json'));
    assert.equal(d.docs.create, 688, 'מספר המסמכים שייווצרו = כל מסמכי הדמה באוספים המועתקים (בלי האב החסר, הנדחה והלא ידוע)');
    assert.equal(d.users.create, 5);
    assert.equal(await get('b/' + BIZ), null);
    assert.equal(await get('users/u_emp'), null);
    const top = await api('POST', BASE + ':listCollectionIds', {});
    assert.ok(!top.collectionIds.includes('b') && !top.collectionIds.includes('users'), 'לא נוצר דבר');
    assert.match(r.out, /כתיבות: 0/);
  });

  it('3. copy בלי --mode write נדחה; כתיבה מחוץ ליעד נחסמת בקוד', async () => {
    const r = await run(['copy', '--state', F('state.json'), '--backup', F('backup1.json')]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /copy דורש --mode write/);
    const { FsRest } = require('../migrate/fsrest');
    const fsr = new FsRest({ project: P, mode: 'write', bizId: BIZ, token: async () => 'owner', emulatorHost: EMU });
    for (const p of ['cfg/main', 'admins/x', 'b/other-biz/cfg/main', 'b', 'staff/u_emp']) {
      await assert.rejects(fsr.writeDocs([{ path: p, kind: 'create', fields: {} }]), /מחוץ ליעד/);
    }
    await assert.rejects(fsr.writeDocs([{ path: 'users/u1', kind: 'update', updateTime: 'x', fields: {} }]), /מחוץ ליעד/, 'users: יצירה בלבד');
    const ro = new FsRest({ project: P, mode: 'readonly', bizId: BIZ, token: async () => 'owner', emulatorHost: EMU });
    await assert.rejects(ro.writeDocs([{ path: 'b/' + BIZ + '/cfg/x', kind: 'create', fields: {} }]), /קריאה בלבד/);
    await assert.rejects(fsr.req('DELETE', BASE + '/cfg/main'), /שיטה אסורה/);
    assert.ok(await get('cfg/main'));
  });

  it('4. העתקה: הספירה והגיבוב של כל אוסף במקור שווים ליעד; טיפוסים זהים; users ומסמך העסק', async () => {
    const r = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json'), '--report', F('copy1.json')]);
    show('copy (ראשונה)', r);
    assert.equal(r.code, 0, r.out);
    const v = await run(['verify', '--report', F('verify1.json')]);
    show('verify', v);
    assert.equal(v.code, 0, v.out);
    const vr = report(F('verify1.json'));
    for (const [c, x] of Object.entries(vr.collections)) {
      assert.equal(x.src.count, x.dst.count, c);
      assert.equal(x.src.hash, x.dst.hash, c);
    }
    assert.equal(vr.storage.srcCount, 3); assert.equal(vr.storage.dstCount, 3); assert.equal(vr.storage.srcBytes, vr.storage.dstBytes);
    // טיפוסים: הערכים הגולמיים ביעד זהים בדיוק למקור (doubleValue שלם נשאר doubleValue וכו')
    const src = await get('cfg/types'), dst = await get('b/' + BIZ + '/cfg/types');
    assert.deepEqual(dst.fields, src.fields);
    assert.deepEqual(dst.fields.amountInt, { doubleValue: 120 });
    assert.deepEqual(dst.fields.big, { integerValue: '9007199254740993' });
    for (const id of ODD_IDS) assert.ok(await get('b/' + BIZ + '/inbox/' + id), 'מזהה מיוחד: ' + id);
    // אב "חסר" נשאר חסר ביעד, והתת-אוסף שלו הועתק
    assert.equal(await get('b/' + BIZ + '/tasks/orphan'), null);
    assert.ok(await get('b/' + BIZ + '/tasks/orphan/c/c9'));
    // נדחה / לא ידוע – לא הועתקו
    assert.equal(await get('b/' + BIZ + '/site_income_daily/2026-10-28'), null);
    assert.equal(await get('b/' + BIZ + '/mystery/x'), null);
    // users
    const u = async id => { const d = await get('users/' + id); return d && Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, Object.values(v)[0]])); };
    assert.deepEqual({ ...(await u('u_mgr')), createdAt: 0 }, { bizId: BIZ, role: 'admin', email: 'mgr@example.invalid', active: true, bizStatus: 'active', createdAt: 0 });
    assert.equal((await u('u_mgr2')).role, 'admin');
    assert.equal((await u('u_emp')).role, 'worker');
    assert.equal((await u('u_off')).active, false);
    // מסמך העסק
    const b = (await get('b/' + BIZ)).fields;
    assert.equal(b.dataRoot.stringValue, 'legacy');
    assert.equal(b.status.stringValue, 'active');
    assert.equal(b.schemaVersion.integerValue, '1');
    assert.deepEqual(Object.keys(b.features.mapValue.fields).sort(), ['cashClose', 'feedback', 'orders', 'requests', 'scan', 'shelf', 'suppliers', 'tasks', 'yemot']);
    assert.ok(Object.values(b.features.mapValue.fields).every(x => x.booleanValue === true));
    assert.ok(!b.ownerEmail && !b.ownerPhone && !b.adv, 'אין private/adv במסמך העסק');
    assert.equal(await get('b/' + BIZ + '/private/info'), null);
    // Storage: תוכן זהה, app_releases לא הועתק
    const [x] = await storage().file('b/' + BIZ + '/app_backups/u_mgr/2026-10-29.json.gz.enc').download();
    assert.ok(x.equals(Buffer.alloc(4096, 9)));
    const [rel] = await storage().file('b/' + BIZ + '/app_releases/latest/app.apk').exists();
    assert.equal(rel, false);
  });

  it('5. המקור זהה לחלוטין לגיבוי ולמצב שלפני ההרצה', async () => {
    const r = await run(['compare-backup', '--backup', F('backup1.json')]);
    show('compare-backup', r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /המקור זהה לחלוטין לגיבוי/);
    assert.deepEqual(await snapshotRoot(), before0, 'השוואה עצמאית: כל מסמך בשורש, כולל updateTime, לא השתנה');
    const [f] = await storage().getFiles({ prefix: 'app_backups/' });
    assert.equal(f.length, 3);
  });

  it('6. הרצה שנייה לא משכפלת ולא משנה דבר', async () => {
    const t0 = (await get('b/' + BIZ + '/cfg/main')).updateTime;
    const u0 = (await get('users/u_emp')).updateTime;
    const r = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json'), '--report', F('copy2.json')]);
    show('copy (שנייה, בלי שינוי)', r);
    assert.equal(r.code, 0, r.out);
    const c = report(F('copy2.json'));
    assert.equal(c.writes, 0);
    assert.equal(c.docs.create, 0); assert.equal(c.docs.update, 0); assert.equal(c.docs.conflict, 0);
    assert.equal(c.users.create, 0); assert.equal(c.storage.create, 0);
    assert.equal((await get('b/' + BIZ + '/cfg/main')).updateTime, t0);
    assert.equal((await get('users/u_emp')).updateTime, u0);
  });

  it('7. השלמה: שינוי במקור מועתק; שינוי בשני הצדדים = התנגשות ולא נדרס; שינוי רק ביעד לא נדרס', async () => {
    await put('shelf/s1', { name: S('לחם'), price: D(13), promo: M({ pct: D(10) }) }); // רק מקור
    await put('inbox/new1', { from: S('u_emp'), amount: D(5) }); // חדש במקור
    await put('fb/f1', { stars: I(4), text: S('מקור') }); // שני הצדדים
    await put('b/' + BIZ + '/fb/f1', { stars: I(3), text: S('יעד') });
    await put('b/' + BIZ + '/tasks/t1', { title: S('שונה באפליקציה'), done: B(true) }); // רק יעד
    const r = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json'), '--report', F('copy3.json')]);
    show('copy (השלמה)', r);
    const c = report(F('copy3.json'));
    assert.equal(c.docs.update, 1); assert.equal(c.docs.create, 1); assert.equal(c.docs.conflict, 1); assert.equal(c.docs.targetOnlyChanged, 1);
    assert.equal(c.conflicts[0].rel, 'fb/f1');
    assert.ok(c.conflicts[0].src && c.conflicts[0].dst && c.conflicts[0].src !== c.conflicts[0].dst, 'שני הגיבובים מדווחים');
    assert.deepEqual((await get('b/' + BIZ + '/shelf/s1')).fields.price, { doubleValue: 13 });
    assert.ok(await get('b/' + BIZ + '/inbox/new1'));
    assert.equal((await get('b/' + BIZ + '/fb/f1')).fields.text.stringValue, 'יעד', 'ההתנגשות לא נדרסה');
    assert.equal((await get('fb/f1')).fields.text.stringValue, 'מקור', 'המקור לא נגע');
    assert.equal((await get('b/' + BIZ + '/tasks/t1')).fields.title.stringValue, 'שונה באפליקציה');
    // הרצה נוספת: ההתנגשות נשארת התנגשות, ושום דבר לא נכתב
    const r2 = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json'), '--report', F('copy4.json')]);
    const c2 = report(F('copy4.json'));
    assert.equal(c2.writes, 0); assert.equal(c2.docs.conflict, 1);
    show('copy (אחרי השלמה)', r2);
    // האימות מזהה הבדלים (בדיקת בקרה: הוא לא עובר "תמיד")
    const v = await run(['verify', '--report', F('verify-diff.json')]);
    show('verify (בקרה: אחרי שינויים ביעד)', v);
    assert.equal(v.code, 1);
    assert.deepEqual(report(F('verify-diff.json')).docDiffs.map(d => d.rel).sort(), ['fb/f1', 'tasks/t1']);
  });

  it('8. Storage: קובץ יעד שונה לא נדרס (התנגשות); קובץ חדש במקור מועתק', async () => {
    await storage().file('app_backups/u_emp/2026-10-30.json.gz.enc').save(Buffer.from('new'), { contentType: 'application/octet-stream' });
    await storage().file('b/' + BIZ + '/app_backups/u_emp/2026-10-29.json.gz.enc').save(Buffer.from('changed in target'));
    const r = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json'), '--report', F('copy5.json')]);
    const c = report(F('copy5.json'));
    assert.equal(c.storage.create, 1); assert.equal(c.storage.conflict, 1);
    const [x] = await storage().file('b/' + BIZ + '/app_backups/u_emp/2026-10-29.json.gz.enc').download();
    assert.equal(x.toString(), 'changed in target');
    show('copy (Storage)', r);
  });

  it('9. מסמך עסק ו-users קיימים לא נדרסים', async () => {
    await put('b/acme', { name: S('Acme'), status: S('active'), dataRoot: S('b') });
    await put('users/u_emp2', { bizId: S('acme'), role: S('worker') });
    const r = await run(['copy', '--mode', 'write', '--biz', 'acme', '--state', F('state-acme.json'), '--backup', F('backup1.json'), '--report', F('acme.json'), '--no-storage']);
    const c = report(F('acme.json'));
    assert.equal(c.bizDocExists, true);
    assert.equal((await get('b/acme')).fields.dataRoot.stringValue, 'b');
    assert.ok(!(await get('b/acme')).fields.features);
    assert.ok(c.userConflicts.length >= 1);
    // u_emp2 שייך ל-acme ולכן תואם; u_mgr וכו' כבר שייכים ל-largpeami – התנגשות, לא נדרסים
    assert.equal((await get('users/u_mgr')).fields.bizId.stringValue, BIZ);
    show('copy לעסק אחר (בדיקת אי-דריסה)', r);
  });

  it('10. נעילה: שתי העתקות במקביל אסורות', async () => {
    fs.writeFileSync(F('state.json') + '.lock', 'x');
    const r = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json')]);
    fs.unlinkSync(F('state.json') + '.lock');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /העתקה אחרת רצה/);
  });

  it('11. נסיון חזרה: מעבר ל-b ← כתיבה ב-b ← דוח ← חזרה ל-legacy ← השורש שלם וזהה לגיבוי', async () => {
    const steps = [];
    const st = async (title, args) => { const r = await run(args); steps.push(r); show('חזרה: ' + title, r); return r; };
    assert.equal((await st('גיבוי לפני המעבר', ['backup', '--out', F('backup-rb.json')])).code, 0);
    const rootBefore = await snapshotRoot();
    assert.equal((await st('מעבר ל-b', ['set-dataroot', '--to', 'b', '--mode', 'write'])).code, 0);
    assert.equal((await get('b/' + BIZ)).fields.dataRoot.stringValue, 'b');
    // האפליקציה כותבת עכשיו ל-b/ (דמה)
    await put('b/' + BIZ + '/inbox/after-switch', { from: S('u_emp'), amount: D(77) });
    await put('b/' + BIZ + '/cfg/main', { data: S('{"cats":["מזון","שכירות","חדש"]}') });
    const rep = await run(['report-since', '--state', F('state.json'), '--report', F('since.json')]);
    show('חזרה: דוח מה נכתב ב-b מאז ההעתקה', rep);
    const s = report(F('since.json'));
    assert.ok(s.added.some(x => x.rel === 'inbox/after-switch'));
    assert.ok(s.changed.some(x => x.rel === 'cfg/main'));
    assert.equal((await st('חזרה ל-legacy', ['set-dataroot', '--to', 'legacy', '--mode', 'write'])).code, 0);
    assert.equal((await get('b/' + BIZ)).fields.dataRoot.stringValue, 'legacy');
    const cmp = await st('בדיקה שהשורש שלם', ['compare-backup', '--backup', F('backup-rb.json')]);
    assert.equal(cmp.code, 0);
    assert.deepEqual(await snapshotRoot(), rootBefore);
    fs.writeFileSync(F('rollback-steps.txt'), OUT.join('\n\n'));
  });

  it('12. אין בקוד הכלי מחיקה או עדכון של השורש (חיפוש בקוד)', () => {
    const dir = path.join(ROOT, 'migrate');
    const code = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    for (const [f, c] of code) {
      const lines = c.split('\n').filter(l => !/^\s*\/\//.test(l));
      const bad = lines.filter(l => /\.delete\(|DELETE|\bdelete\s*:|deleteDocument|firebase-admin\/firestore|getFirestore|:commit|\.batch\(|\.save\(|createWriteStream|\.move\(|\.rename\(/.test(l) && !/'GET' && method !== 'POST'/.test(l));
      assert.deepEqual(bad, [], f + ': אין מחיקה, אין כתיבה דרך SDK של Firestore, ואין כתיבת Storage חוץ מ-copy');
    }
    const all = code.map(x => x[1]).join('\n');
    assert.equal((all.match(/:batchWrite/g) || []).length, 1, 'נקודת כתיבה אחת בלבד ל-Firestore');
    assert.equal((all.match(/\.copy\(/g) || []).length, 1, 'נקודת כתיבה אחת בלבד ל-Storage');
  });
});

describe('בדיקת השומר והתהליך הידני', () => {
  const good = { project: 'largpeami', confirm: 'largpeami', mode: 'readonly', saProject: 'largpeami' };
  it('קלט תקין עובר, וברירת המחדל קריאה בלבד', () => {
    assert.equal(checkGuard(good).ok, true);
    assert.equal(checkGuard({ ...good, mode: '' }).mode, 'readonly');
    assert.equal(checkGuard({ ...good, mode: 'write', writeConfirm: 'write-to-largpeami' }).mode, 'write');
  });
  const flips = {
    'מזהה לא הוקלד שוב': { confirm: '' },
    'אישור שונה': { confirm: 'largpeam' },
    'אישור עם תוספת': { confirm: 'largpeami-test-f4691' },
    'פרויקט חסר': { project: '', confirm: '' },
    'מצב לא מוכר': { mode: 'WRITE' },
    'כתיבה בלי אישור כתיבה': { mode: 'write' },
    'כתיבה עם אישור שגוי': { mode: 'write', writeConfirm: 'write-to-other' },
    'פרויקט test בלי אישור נפרד': { project: 'largpeami-test-f4691', confirm: 'largpeami-test-f4691', saProject: 'largpeami-test-f4691' },
    'פרויקט test עם אישור לא מפורש': { project: 'largpeami-test-f4691', confirm: 'largpeami-test-f4691', saProject: 'largpeami-test-f4691', allowTest: 'yes' },
    'חשבון שירות של פרויקט אחר': { saProject: 'largpeami-test-f4691' },
    'פרויקט דמו': { project: 'demo-largpeami', confirm: 'demo-largpeami', saProject: 'demo-largpeami' },
  };
  for (const [name, flip] of Object.entries(flips)) {
    it('הפיכת ההגנה ← השומר נכשל: ' + name, () => {
      const r = checkGuard({ ...good, ...flip });
      assert.equal(r.ok, false);
      assert.equal(r.mode, 'readonly');
      // גם כתהליך (כמו ב-GitHub): exit 1
      const env = { ...process.env, MIGRATE_PROJECT: r.project, MIGRATE_PROJECT_CONFIRM: flip.confirm ?? good.confirm, MIGRATE_MODE: flip.mode ?? good.mode, MIGRATE_WRITE_CONFIRM: flip.writeConfirm || '', MIGRATE_ALLOW_TEST_PROJECT: flip.allowTest || '', MIGRATE_SA_PROJECT: flip.saProject ?? good.saProject };
      env.MIGRATE_PROJECT = flip.project ?? good.project;
      assert.equal(spawnSync(process.execPath, [GUARD], { env }).status, 1);
    });
  }
  it('פרויקט test עם אישור מפורש עובר', () => {
    assert.equal(checkGuard({ project: 'largpeami-test-f4691', confirm: 'largpeami-test-f4691', saProject: 'largpeami-test-f4691', allowTest: 'true' }).ok, true);
  });
  it('הכלי עצמו, בלי אמולטור ובלי שומר, מסרב לרוץ (לא יוצא שום בקשה)', () => {
    const env = { ...process.env };
    for (const k of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST', 'MIGRATE_PROJECT_CONFIRM']) delete env[k];
    const r = spawnSync(process.execPath, [TOOL, 'dry-run', '--project', 'largpeami'], { env, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /השומר נכשל/);
  });
  it('קובץ התהליך: ידני בלבד, קלט מזהה פעמיים, ברירת מחדל readonly, שומר לפני הכול, בלי סודות בקובץ', () => {
    const yaml = require(require.resolve('js-yaml', { paths: [ROOT] }));
    const file = path.resolve(ROOT, '..', '.github', 'workflows', 'migrate-largpeami.yml');
    const txt = fs.readFileSync(file, 'utf8');
    const y = yaml.load(txt);
    const on = y.on || y[true];
    assert.deepEqual(Object.keys(on), ['workflow_dispatch']);
    const inp = on.workflow_dispatch.inputs;
    assert.equal(inp.project_id.required, true);
    assert.equal(inp.project_id_confirm.required, true);
    assert.equal(inp.mode.default, 'readonly');
    assert.deepEqual(inp.mode.options, ['readonly', 'write']);
    const steps = y.jobs.migrate.steps;
    const gi = steps.findIndex(s => /guard\.js/.test(s.run || ''));
    const firstSecret = steps.findIndex(s => /secrets\./.test(JSON.stringify(s)));
    assert.ok(gi >= 0 && gi < firstSecret, 'השומר רץ לפני כל שימוש בסוד');
    assert.ok(!/-----BEGIN|private_key"\s*:|AIza[0-9A-Za-z_-]{20,}/.test(txt), 'אין סוד בקובץ');
    assert.ok(y.concurrency && y.concurrency['cancel-in-progress'] === false);
  });
});
