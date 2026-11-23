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
// MIGRATE_DIR / MIGRATE_WORKFLOW: להרצת אותן בדיקות על גרסה ישנה של הכלי (הוכחה שהבדיקה נכשלת לפני התיקון)
const MDIR = process.env.MIGRATE_DIR || path.join(ROOT, 'migrate');
const WF = process.env.MIGRATE_WORKFLOW || path.resolve(ROOT, '..', '.github', 'workflows', 'migrate-largpeami.yml');
const TOOL = path.join(MDIR, 'migrate.js');
const GUARD = path.join(MDIR, 'guard.js');
const P = 'demo-largpeami';
const BIZ = 'largpeami';
const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const BASE = `http://${EMU}/v1/projects/${P}/databases/(default)/documents`;
const NAME = `projects/${P}/databases/(default)/documents`;
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'migrate-test-'));
const F = n => path.join(TMP, n);
const rq = createRequire(path.join(ROOT, 'functions', 'package.json'));
const { hashFields } = require(path.join(MDIR, 'fsrest'));
const { checkGuard } = require(path.join(MDIR, 'guard'));

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
  // השלמת הרשימה (15.11.2026): אוספי עסק שנוספו ל-COPY, כולל תתי-אוספים ואב חסר – 19 מסמכים
  w.push(['ptk/p1', { title: S('משימה פרטית'), st: S('open') }]);
  w.push(['rq/r1', { text: S('בקשה'), amount: D(-12.5) }]);
  w.push(['rq/r1/c/c1', { text: S('תגובה') }]);
  w.push(['cust/x', { name: S('לקוח'), phone: S('0500000000') }]);
  w.push(['cust/x/p/card1', { enc: S('מוצפן...'), last4: S('4242') }]);
  w.push(['custBak/k1', { at: I(1), st: S('done'), n: I(1) }]);
  w.push(['custBak/k1/items/i1', { d: M({ name: S('לקוח שנמחק') }) }]);
  w.push(['sec_cfg/main', { on: B(true) }]);
  w.push(['sec_chat/u_mgr/m/m1', { text: S('שלום') }]); // האב sec_chat/u_mgr חסר
  w.push(['sec_ord/o1', { thr: S('t1'), st: S('new') }]);
  w.push(['lineplan/p1', { name: S('תוכנית'), price: D(49.9) }]);
  w.push(['lineLog/o_1_0', { phone: S('0500000001'), ord: S('1') }]);
  w.push(['wv/inc_2026-10', { data: S('[]') }]);
  w.push(['push_tokens/u_mgr', { pushTokens: A(S('tok')) }]);
  w.push(['cardQ/u_emp', { m: I(1), d: S('2026-10-28') }]);
  w.push(['fn_rate/cashoutTotal_u_emp', { n: I(1) }]);
  w.push(['impJobs/j1', { t: I(1), st: S('done') }]);
  w.push(['pinv/i1', { sup: S('ספק'), total: D(100) }]);
  w.push(['pinv/i1/p/0', { img: S('...') }]);
  // טבלאות שרת משותפות (SHARED): נשארות בשורש, מגובות ולא מועתקות
  w.push(['sec_waq/largpeami__m1', { biz: S(BIZ), id: S('m1') }]);
  w.push(['impQ/largpeami_j1/c/c1', { biz: S(BIZ), st: S('done') }]); // האב impQ/largpeami_j1 חסר
  w.push(['mailRate/h_largpeami', { n: I(2) }]);
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
    for (const c of ['sec_waq', 'impQ', 'mailRate']) assert.equal(b.collections[c].plan, 'shared', c);
    for (const c of ['cust', 'custBak', 'sec_chat', 'sec_ord', 'wv', 'push_tokens', 'pinv']) assert.equal(b.collections[c].plan, 'copy', c);
    assert.ok(b.docs['impQ/largpeami_j1/c/c1'], 'טבלה משותפת מגובה, כולל תת-אוסף');
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
    assert.equal(d.docs.create, 707, 'מספר המסמכים שייווצרו = כל מסמכי הדמה באוספים המועתקים (בלי האב החסר, הנדחה והלא ידוע)');
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
    const { FsRest } = require(path.join(MDIR, 'fsrest'));
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
    // סבב 2, ליקוי 1: אוסף לא ידוע שלא הועתק מכשיל את האימות, עד החלטה מפורשת (--ack-unknown)
    const v0 = await run(['verify', '--report', F('verify0.json')]);
    show('verify (בלי אישור לאוסף הלא ידוע)', v0);
    assert.equal(v0.code, 1, 'אוסף לא ידוע עם מסמכים מכשיל את האימות');
    assert.match(v0.out, /mystery/);
    const v = await run(['verify', '--ack-unknown', 'mystery', '--report', F('verify1.json')]);
    show('verify', v);
    assert.equal(v.code, 0, v.out);
    assert.match(v.out, /site_income_daily – 1 מסמכים/, 'אוסף נדחה מוצג עם ספירה');
    assert.match(v.out, /משותף לכל העסקים \(מגובה, נשאר בשורש\): sec_waq – 1 מסמכים/, 'טבלה משותפת מוצגת ולא מכשילה');
    assert.doesNotMatch(v.out, /לא ידוע[^\n]*(sec_waq|impQ|mailRate)/);
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
    // אוספי העסק החדשים ברשימה הועתקו ואומתו, כולל תתי-אוספים
    for (const c of ['ptk', 'rq', 'cust', 'custBak', 'sec_cfg', 'sec_chat', 'sec_ord', 'lineplan', 'lineLog', 'wv', 'push_tokens', 'cardQ', 'fn_rate', 'impJobs', 'pinv']) {
      assert.ok(vr.collections[c] && vr.collections[c].src.count > 0, 'נבדק באימות: ' + c);
    }
    for (const p of ['cust/x/p/card1', 'custBak/k1/items/i1', 'rq/r1/c/c1', 'sec_chat/u_mgr/m/m1', 'pinv/i1/p/0', 'wv/inc_2026-10']) {
      assert.deepEqual((await get('b/' + BIZ + '/' + p)).fields, (await get(p)).fields, p);
    }
    // טבלאות משותפות – לא הועתקו ולא נבדקו כאוסף להעתקה
    for (const p of ['sec_waq/largpeami__m1', 'impQ/largpeami_j1/c/c1', 'mailRate/h_largpeami']) assert.equal(await get('b/' + BIZ + '/' + p), null, p);
    for (const c of ['sec_waq', 'impQ', 'mailRate']) assert.equal(vr.collections[c], undefined, c);
    assert.deepEqual(vr.problems, []);
    // נדחה / לא ידוע – לא הועתקו
    assert.equal(await get('b/' + BIZ + '/site_income_daily/2026-10-28'), null);
    assert.equal(await get('b/' + BIZ + '/mystery/x'), null);
    // users
    const u = async id => { const d = await get('users/' + id); return d && Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, Object.values(v)[0]])); };
    assert.deepEqual({ ...(await u('u_mgr')), createdAt: 0 }, { bizId: BIZ, role: 'admin', email: 'mgr@example.invalid', active: true, bizStatus: 'active', createdAt: 0 });
    assert.equal((await u('u_mgr2')).role, 'admin');
    assert.equal((await u('u_emp')).role, 'worker');
    assert.equal((await u('u_off')).active, false);
    // סבב 3 (חוזה 8א): אותו מבנה ש-syncLegacyMember בשרת כותב – בדיוק השדות האלה, createdAt במילישניות (integerValue)
    for (const id of ['u_mgr', 'u_mgr2', 'u_emp', 'u_emp2', 'u_off']) {
      const d = await get('users/' + id);
      assert.deepEqual(Object.keys(d.fields).sort(), ['active', 'bizId', 'bizStatus', 'createdAt', 'email', 'role'], id);
      assert.match(d.fields.createdAt.integerValue, /^\d{13}$/, id + ': createdAt במילישניות');
      assert.equal(d.fields.bizStatus.stringValue, 'active');
    }
    assert.equal((await u('u_mgr')).role, 'admin', 'u_mgr גם ב-staff וגם ב-admins = admin');
    assert.equal((await u('u_emp2')).active, true);
    assert.match(v.out, /users: 5\/5 תואמים ל-admins\/staff/);
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

  it('6א. (סבב 3) verify בודק שלכל admins/staff בשורש יש users/{uid} תואם', async () => {
    const orig = { off: (await get('users/u_off')).fields, emp: (await get('users/u_emp')).fields };
    await put('users/u_off', { ...orig.off, active: B(true) }); // עובד מושבת שמסומן פעיל
    await put('users/u_emp', { ...orig.emp, role: S('admin') }); // עובד שמסומן מנהל
    const v = await run(['verify', '--ack-unknown', 'mystery']);
    show('verify (users לא תואמים)', v);
    assert.equal(v.code, 1);
    assert.match(v.out, /u_off: active=true \(צפוי false\)/);
    assert.match(v.out, /u_emp: role=admin \(צפוי worker\)/);
    await put('users/u_off', orig.off); await put('users/u_emp', orig.emp); // החזרה (קוד בדיקה)
    await api('DELETE', BASE + '/users/u_emp2'); // users חסר (מחיקה באמולטור, בקוד הבדיקה בלבד)
    const v2 = await run(['verify', '--ack-unknown', 'mystery']);
    assert.equal(v2.code, 1);
    assert.match(v2.out, /u_emp2: חסר/);
    // ההשלמה יוצרת אותו מחדש, והאימות עובר
    const c = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json'), '--report', F('copy-u.json')]);
    assert.equal(report(F('copy-u.json')).users.create, 1);
    const v3 = await run(['verify', '--ack-unknown', 'mystery']);
    show('verify (אחרי השלמת users)', v3);
    assert.equal(v3.code, 0, v3.out);
  });

  it('7. השלמה: שינוי במקור מועתק; שינוי בשני הצדדים = התנגשות ולא נדרס; שינוי רק ביעד לא נדרס', async () => {
    await put('shelf/s1', { name: S('לחם'), price: D(13), promo: M({ pct: D(10) }) }); // רק מקור
    await put('inbox/new1', { from: S('u_emp'), amount: D(5) }); // חדש במקור
    await put('fb/f1', { stars: I(4), text: S('מקור') }); // שני הצדדים
    await put('b/' + BIZ + '/fb/f1', { stars: I(3), text: S('יעד') });
    await put('b/' + BIZ + '/tasks/t1', { title: S('שונה באפליקציה'), done: B(true) }); // רק יעד
    await put('staff/u_new', { name: S('u_new'), email: S('u_new@example.invalid'), role: S('worker'), active: B(true) }); // עובד חדש
    await put('users/u_new', { bizId: S('acme'), role: S('worker') }); // ...שכבר רשום בעסק אחר
    const r = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json'), '--report', F('copy3.json')]);
    show('copy (השלמה)', r);
    const c = report(F('copy3.json'));
    assert.equal(c.docs.update, 1); assert.equal(c.docs.create, 2); assert.equal(c.docs.conflict, 1); assert.equal(c.docs.targetOnlyChanged, 1);
    assert.deepEqual(c.userConflicts.map(u => u.uid), ['u_new'], 'users קיים של עסק אחר – התנגשות');
    assert.equal((await get('users/u_new')).fields.bizId.stringValue, 'acme', 'users קיים לא נדרס');
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
    const v = await run(['verify', '--ack-unknown', 'mystery', '--report', F('verify-diff.json')]);
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

  it('9. (סבב 2, ליקוי 2) העתקה לעסק אחר, או לעסק שלא נוצר על ידי הכלי, או אחרי מעבר ל-b – נחסמת', async () => {
    await put('b/acme', { name: S('Acme'), status: S('active'), dataRoot: S('b') });
    const r = await run(['copy', '--mode', 'write', '--biz', 'acme', '--state', F('state-acme.json'), '--backup', F('backup1.json'), '--report', F('acme.json'), '--no-storage']);
    show('copy לעסק אחר (acme) – סירוב', r);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /רק לעסק ההעברה/);
    const sub = await api('POST', BASE + '/b/acme:listCollectionIds', {});
    assert.deepEqual((sub && sub.collectionIds) || [], [], 'לא נכתב דבר ב-b/acme');
    const sd = await run(['set-dataroot', '--to', 'legacy', '--mode', 'write', '--biz', 'acme']);
    assert.notEqual(sd.code, 0);
    assert.equal((await get('b/acme')).fields.dataRoot.stringValue, 'b');
    // מסמך העסק של largpeami בלי סימון יעד ההעברה (כאילו נוצר על ידי מישהו אחר)
    const orig = (await get('b/' + BIZ)).fields;
    const { migrationTarget, ...noMark } = orig;
    assert.ok(migrationTarget && migrationTarget.booleanValue === true, 'הכלי מסמן את מסמך העסק כיעד ההעברה');
    await put('b/' + BIZ, noMark);
    const r2 = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json')]);
    assert.notEqual(r2.code, 0);
    assert.match(r2.out, /לא נוצר על ידי כלי ההעברה/);
    assert.notEqual((await run(['set-dataroot', '--to', 'b', '--mode', 'write'])).code, 0);
    // אחרי מעבר ל-b: אין העתקה/השלמה
    await put('b/' + BIZ, { ...orig, dataRoot: S('b') });
    const r3 = await run(['copy', '--mode', 'write', '--state', F('state.json'), '--backup', F('backup1.json')]);
    assert.notEqual(r3.code, 0);
    assert.match(r3.out, /לא legacy/);
    await put('b/' + BIZ, orig); // החזרה (קוד בדיקה)
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
    assert.equal((await st('גיבוי לפני המעבר (נשמר ב-bucket)', ['backup', '--out', F('backup-rb.json'), '--upload', '--upload-tag', 'test', '--report', F('rb.json')])).code, 0);
    const gcs = report(F('rb.json')).uploaded;
    assert.match(gcs, /^gs:\/\/demo-largpeami\.appspot\.com\/migrate_backups\/.+_test\/backup\.json$/);
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
    const cmp = await st('בדיקה שהשורש שלם (מול הגיבוי שב-bucket)', ['compare-backup', '--backup-gcs', gcs]);
    assert.equal(cmp.code, 0);
    assert.deepEqual(await snapshotRoot(), rootBefore);
    fs.writeFileSync(F('rollback-steps.txt'), OUT.join('\n\n'));
  });

  it('12. אין בקוד הכלי מחיקה או עדכון של השורש (חיפוש בקוד) – חוץ מנקודת המחיקה היחידה של purge-root', () => {
    const dir = MDIR;
    const code = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    // 23.11.2026: נקודת מחיקה אחת בלבד – deleteDocs ב-fsrest.js (purge-root), עם תנאי updateTime. נבדקת בנפרד בבלוק purge-root
    const PURGE_LINE = "writes: chunk.map(d => ({ delete: this.prefix + '/' + d.path, currentDocument: { updateTime: d.updateTime } })),";
    for (const [f, c] of code) {
      const lines = c.split('\n').filter(l => !/^\s*\/\//.test(l)).filter(l => !(f === 'fsrest.js' && l.trim() === PURGE_LINE));
      const bad = lines.filter(l => /\.delete\(|DELETE|\bdelete\s*:|deleteDocument|firebase-admin\/firestore|getFirestore|:commit|\.batch\(|createWriteStream|\.move\(|\.rename\(/.test(l) && !/'GET' && method !== 'POST'/.test(l));
      assert.deepEqual(bad, [], f + ': אין מחיקה, אין כתיבה דרך SDK של Firestore, ואין כתיבת Storage חוץ מ-copy');
    }
    const all = code.map(x => x[1]).join('\n');
    assert.equal(all.split(PURGE_LINE).length - 1, 1, 'נקודת מחיקה אחת בלבד');
    assert.match(all, /deleteDocs = async function[\s\S]{0,200}this\.assertDeletable\(d\.path\)/, 'כל מחיקה עוברת את assertDeletable');
    assert.equal((all.match(/\.deleteDocs\(/g) || []).length, 1, 'רק purge-root קורא ל-deleteDocs');
    assert.equal((all.match(/\.enablePurge\(/g) || []).length, 1, 'רק purge-root מפעיל מחיקה');
    assert.equal((all.match(/:batchWrite/g) || []).length, 2, 'שתי נקודות בלבד ל-Firestore: כתיבה (writeDocs) ומחיקה (deleteDocs)');
    assert.equal((all.match(/\.copy\(/g) || []).length, 1, 'העתקה אחת בלבד ל-Storage (אל b/<bizId>/app_backups)');
    assert.equal((all.match(/\.save\(/g) || []).length, 1, 'שמירה אחת בלבד ל-Storage (קובץ הגיבוי, תחת migrate_backups/)');
  });

  it('13. (15.11.2026) הרשימות מכסות את כל אוספי העסק: כללי b/{bizId} ו-SEC_COLLS במלואם ב-COPY; הרשימות לא חופפות', () => {
    const { COPY, DEFERRED, SHARED } = require(TOOL);
    const all = [...COPY, ...DEFERRED, ...SHARED];
    assert.equal(new Set(all).size, all.length, 'אוסף לא מופיע בשתי רשימות');
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const inBiz = rules.slice(rules.indexOf('match /b/{bizId} {'));
    const B_ONLY = ['audit']; // נכתב תמיד ישירות ל-b/{bizId}/audit (גם ב-legacy), אין לו מקור בשורש
    B_ONLY.push('dr', 'drcfg'); // 16.11.2026 דיווח יומי: קיים רק ב-b/{bizId} (התוספת חסומה ב-legacy), אין לו מקור בשורש
    const names = [...new Set([...inBiz.matchAll(/^ {6}match \/([A-Za-z_0-9]+)\//gm)].map(m => m[1]))];
    assert.ok(names.length > 50, 'נמצאו כללי b/{bizId}');
    assert.deepEqual(names.filter(n => !COPY.includes(n) && !B_ONLY.includes(n)), [], 'כל אוסף עם כלל ב-b/{bizId} מועתק');
    const sec = fs.readFileSync(path.join(ROOT, 'functions', 'secretary.js'), 'utf8').match(/const SEC_COLLS = Object\.freeze\(\[([^\]]*)\]/)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
    assert.ok(sec.length >= 18);
    assert.deepEqual(sec.filter(c => !COPY.includes(c)), [], 'כל SEC_COLLS מועתקים');
    const secRoot = fs.readFileSync(path.join(ROOT, 'functions', 'secretary.js'), 'utf8').match(/const SEC_ROOT_COLLS = Object\.freeze\(\[([^\]]*)\]/)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
    assert.deepEqual(secRoot.filter(c => !SHARED.includes(c)), [], 'טבלאות הניתוב בשורש הן SHARED');
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
    'bucket של פרויקט אחר': { bucket: 'largpeami-test-f4691.firebasestorage.app' },
    'bucket של הייצור לפרויקט הבדיקה': { project: 'largpeami-test-f4691', confirm: 'largpeami-test-f4691', saProject: 'largpeami-test-f4691', allowTest: 'true', bucket: 'largpeami.firebasestorage.app' },
  };
  for (const [name, flip] of Object.entries(flips)) {
    it('הפיכת ההגנה ← השומר נכשל: ' + name, () => {
      const r = checkGuard({ ...good, ...flip });
      assert.equal(r.ok, false);
      assert.equal(r.mode, 'readonly');
      // גם כתהליך (כמו ב-GitHub): exit 1
      const env = { ...process.env, MIGRATE_PROJECT: r.project, MIGRATE_PROJECT_CONFIRM: flip.confirm ?? good.confirm, MIGRATE_MODE: flip.mode ?? good.mode, MIGRATE_WRITE_CONFIRM: flip.writeConfirm || '', MIGRATE_ALLOW_TEST_PROJECT: flip.allowTest || '', MIGRATE_SA_PROJECT: flip.saProject ?? good.saProject, MIGRATE_BUCKET: flip.bucket || '' };
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
    const r = spawnSync(process.execPath, [TOOL, 'dry-run', '--project', 'largpeami', '--bucket', 'largpeami.firebasestorage.app'], { env, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /השומר נכשל/);
  });
  it('קובץ התהליך: ידני בלבד, קלט מזהה פעמיים, ברירת מחדל קריאה בלבד, שומר לפני הכול, בלי סודות בקובץ', () => {
    const yaml = require(require.resolve('js-yaml', { paths: [ROOT] }));
    const txt = fs.readFileSync(WF, 'utf8');
    const y = yaml.load(txt);
    const on = y.on || y[true];
    assert.deepEqual(Object.keys(on), ['workflow_dispatch']);
    const inp = on.workflow_dispatch.inputs;
    assert.equal(inp.project_id.required, true);
    assert.equal(inp.project_id_confirm.required, true);
    assert.equal(inp.action.default, 'check');
    const cfg = y.jobs.migrate.steps.find(s => s.id === 'cfg');
    assert.match(cfg.run, /check\|report-since\|compare-backup\) echo "mode=readonly"/, 'check = קריאה בלבד');
    const steps = y.jobs.migrate.steps;
    const gi = steps.findIndex(s => /guard\.js/.test(s.run || ''));
    const firstSecret = steps.findIndex(s => /secrets\./.test(JSON.stringify(s)));
    assert.ok(gi >= 0 && gi < firstSecret, 'השומר רץ לפני כל שימוש בסוד');
    assert.ok(!/-----BEGIN|private_key"\s*:|AIza[0-9A-Za-z_-]{20,}/.test(txt), 'אין סוד בקובץ');
    assert.ok(y.concurrency && y.concurrency['cancel-in-progress'] === false);
  });
});

describe('סבב 2: תיקוני הבדיקה העצמאית', () => {
  const yaml = () => yaml.m || (yaml.m = require(require.resolve('js-yaml', { paths: [ROOT] })));
  const wf = () => yaml().load(fs.readFileSync(WF, 'utf8'));

  it('ליקוי 1: verify נכשל על מסד ריק, ועל מסד שיש בו רק אוסף לא ידוע; dry-run מציג אותו', async () => {
    await clearAll();
    const v = await run(['verify', '--no-storage']);
    show('verify על מסד ריק', v);
    assert.equal(v.code, 1);
    assert.match(v.out, /0 מסמכים במקור|לא נמצא במקור אף אוסף/);
    // (15.11.2026) push_tokens הפך לאוסף עסק מועתק; הדוגמה לאוסף לא ידוע היא עכשיו שם שלא קיים באף רשימה
    await put('mystery_tokens/t1', { tok: S('x') });
    const v2 = await run(['verify', '--no-storage']);
    show('verify כשבשורש רק אוסף לא ידוע', v2);
    assert.equal(v2.code, 1);
    assert.match(v2.out, /mystery_tokens/);
    const d = await run(['dry-run', '--no-storage']);
    assert.match(d.out, /אוסף לא ידוע.*mystery_tokens – 1 מסמכים/);
  });

  it('ליקוי 3: במצב אמולטור בלי אמולטור Storage, או עם bucket אמיתי – הכלי מסרב', async () => {
    // בלי אמולטור Storage. ליתר ביטחון חוסמים כל יציאה לרשת (proxy לא קיים) ובלי הרשאות Google
    const noSt = { FIREBASE_STORAGE_EMULATOR_HOST: '', STORAGE_EMULATOR_HOST: '', HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', http_proxy: 'http://127.0.0.1:9', NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1', GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/sa.json' };
    const r = await run(['dry-run'], noSt);
    show('dry-run בלי FIREBASE_STORAGE_EMULATOR_HOST', r);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /FIREBASE_STORAGE_EMULATOR_HOST/);
    const r2 = await run(['copy', '--mode', 'write', '--bucket', 'largpeami.firebasestorage.app', '--state', F('s3.json'), '--backup', F('backup1.json')]);
    assert.notEqual(r2.code, 0);
    assert.match(r2.out, /bucket חייב להיות של פרויקט הדמו/);
    assert.equal((await run(['dry-run', '--no-storage'], noSt)).code, 0, 'עם --no-storage מותר');
  });

  it('ליקוי 4: ה-bucket בתהליך נקבע לפי הפרויקט שהוקלד (או vars של אותו פרויקט), לא מ-index.html', () => {
    const txt = fs.readFileSync(WF, 'utf8');
    assert.ok(!/index\.html|ST_BUCKET/.test(txt), 'לא נלקח מ-index.html');
    assert.match(txt, /vars\.FIREBASE_STORAGE_BUCKET/);
    const cfg = wf().jobs.migrate.steps.find(s => s.id === 'cfg');
    const go = (env) => {
      const out = F('gh-out-' + Math.random().toString(36).slice(2));
      fs.writeFileSync(out, '');
      const r = spawnSync('bash', ['-e', '-c', cfg.run], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '/dev/null', ACTION: 'check', ...env }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').map(l => l.split('=')));
    };
    assert.equal(go({ PROJECT: 'largpeami-test-f4691', VAR_BUCKET: 'largpeami.firebasestorage.app' }).bucket, 'largpeami-test-f4691.firebasestorage.app');
    assert.equal(go({ PROJECT: 'largpeami', VAR_BUCKET: 'largpeami.appspot.com' }).bucket, 'largpeami.appspot.com');
    assert.equal(go({ PROJECT: 'largpeami', VAR_BUCKET: '' }).bucket, 'largpeami.firebasestorage.app');
    assert.equal(go({ PROJECT: 'largpeami', ACTION: 'copy' }).mode, 'write');
    // השומר מקבל את ה-bucket ובודק שהוא של אותו פרויקט
    const g = wf().jobs.migrate.steps.find(s => s.run === 'node firebase/migrate/guard.js');
    assert.equal(g.env.MIGRATE_BUCKET, '${{ steps.cfg.outputs.bucket }}');
    assert.equal(checkGuard({ project: 'largpeami-test-f4691', confirm: 'largpeami-test-f4691', allowTest: 'true', bucket: 'largpeami.firebasestorage.app' }).ok, false);
  });

  it('ליקוי 5: הכלי מסרב לכתוב גיבוי/מצב/דוח בתוך מאגר git; .gitignore מחריג אותם', async () => {
    const inRepo = path.join(ROOT, 'migrate', 'leak-backup.json');
    const r = await run(['backup', '--out', inRepo, '--no-storage']);
    show('backup לתוך המאגר – סירוב', r);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /בתוך מאגר git/);
    assert.equal(fs.existsSync(inRepo), false);
    assert.notEqual((await run(['dry-run', '--no-storage', '--report', path.join(ROOT, 'r.json')])).code, 0);
    for (const f of ['firebase/migrate/x.json', 'lp-migrate/backup.json', 'backup-before-switch.json']) {
      assert.equal(spawnSync('git', ['-C', path.resolve(ROOT, '..'), 'check-ignore', '-q', f]).status, 0, f + ' מוחרג ב-.gitignore');
    }
    for (const doc of ['README.md', 'ROLLBACK.md']) {
      const t = fs.readFileSync(path.join(MDIR, doc), 'utf8');
      const rel = [...t.matchAll(/--(?:out|state|report|backup) +([^\s`]+)/g)].map(m => m[1]).filter(p => !p.startsWith('/tmp/') && !p.startsWith('"$O') && !p.startsWith('$O'));
      assert.deepEqual(rel, [], doc + ': כל נתיב בדוגמאות מחוץ למאגר');
    }
  });

  it('ליקוי 6: נוהל החזרה ניתן לביצוע מהתהליך; הגיבוי נשמר כברירת מחדל ב-bucket ולא ב-GitHub', () => {
    const y = wf();
    const inp = (y.on || y[true]).workflow_dispatch.inputs;
    for (const a of ['check', 'copy', 'report-since', 'compare-backup', 'switch-to-b', 'rollback-to-legacy']) assert.ok(inp.action.options.includes(a), a);
    assert.equal(inp.upload_backup.default, 'true');
    assert.ok(inp.backup_path && inp.state_run_id);
    const runStep = y.jobs.migrate.steps.find(s => s.name === 'Run').run;
    assert.match(runStep, /report-since --state/);
    assert.match(runStep, /set-dataroot --to legacy --mode write/);
    assert.match(runStep, /set-dataroot --to b --mode write/);
    assert.match(runStep, /compare-backup --backup-gcs/);
    assert.match(runStep, /--upload --upload-tag/);
    const uploads = y.jobs.migrate.steps.filter(s => /upload-artifact/.test(s.uses || ''));
    assert.ok(uploads.every(s => !/backup\.json/.test(s.with.path)), 'קובץ הגיבוי לא עולה ל-GitHub');
    const readme = fs.readFileSync(path.join(MDIR, 'README.md'), 'utf8');
    for (const v of ['MIGRATE_PROJECT_CONFIRM', 'MIGRATE_WRITE_CONFIRM', 'MIGRATE_ALLOW_TEST_PROJECT', 'MIGRATE_BUCKET', 'GOOGLE_APPLICATION_CREDENTIALS']) assert.match(readme, new RegExp(v), 'README מתעד ' + v);
    assert.match(fs.readFileSync(path.join(MDIR, 'ROLLBACK.md'), 'utf8'), /migrate_backups\//, 'ROLLBACK כותב איפה נשמר הגיבוי');
  });
});

// 16.11.2026: העתקה ממוקדת (copy-docs) של מסמכים שמכשיר ישן כתב לשורש אחרי המעבר ל-b.
describe('copy-docs: העתקה ממוקדת של מסמכים בודדים אחרי המעבר', () => {
  const LP = 'b/' + BIZ;
  const IDS = ['cashout/wdck2033h85', 'chunks/wdck2033h85_0', 'inbox/wdck2033h85', 'tasks/km8j0hu2ee'];
  const bizFields = (dataRoot) => ({ name: S("לארג' פעמי"), status: S('active'), dataRoot: S(dataRoot), schemaVersion: I(1), createdAt: TS('2026-11-15T10:00:00Z'), createdBy: S('migrate'), migrationTarget: B(true) });
  const sub = async (p) => { const r = await api('POST', BASE + '/' + enc(p) + ':listCollectionIds', {}); return (r && r.collectionIds) || []; };
  const cd = (paths, extra = []) => run(['copy-docs', '--mode', 'write', '--no-storage', '--backup', F('cd-backup.json'), '--paths', paths, ...extra]);
  before(async () => {
    await clearAll();
    await putMany([
      [LP, bizFields('b')],
      [LP + '/cfg/main', { data: S('{}') }],
      ['cashout/wdck2033h85', { uid: S('u_emp'), a: D(50), neg: D(-12.5), big: I('9007199254740993'), t: I(Date.now()), when: TS('2026-11-15T12:00:00.123456789Z'), geo: TYPES.geo, nested: TYPES.nested, heb: TYPES.heb }],
      ['chunks/wdck2033h85_0', { owner: S('u_emp'), data: S('x'.repeat(1000)) }],
      ['inbox/wdck2033h85', { owner: S('u_emp'), by: S('u_emp'), status: S('new'), data: S('{}'), parts: S('1') }],
      ['tasks/km8j0hu2ee', { txt: S('משימה'), st: S('open'), due: I(1) }],
      ['tasks/km8j0hu2ee/c/c1', { txt: S('תגובה – לא מועתקת') }],
      ['tasks/km8j0hu2ee/c/c1/x/x1', { n: I(1) }],
      ['tasks/km8j0hu2ee/p/w1', { img: S('...') }],
      ['cashout/conf1', { a: D(10) }],
      [LP + '/cashout/conf1', { a: D(11) }], // ביעד עם תוכן אחר
      ['orders/o1', { x: I(1) }],
    ]);
    const b = await run(['backup', '--out', F('cd-backup.json'), '--no-storage']);
    assert.equal(b.code, 0, b.out);
  });

  it('dataRoot b: 4 המסמכים מועתקים, הטיפוסים זהים לגולמי, בלי תת-אוספים; השורש ומסמך העסק לא משתנים', async () => {
    const root0 = await snapshotRoot();
    const r = await cd(IDS.join(','), ['--report', F('cd1.json')]);
    show('copy-docs (dataRoot b)', r);
    assert.equal(r.code, 0, r.out);
    const rep = report(F('cd1.json'));
    assert.equal(rep.copied, 4);
    assert.equal(rep.dataRoot, 'b');
    assert.ok(rep.docs.every(d => d.fields === undefined), 'הדוח בלי נתונים, רק נתיבים וגיבובים');
    for (const p of IDS) assert.deepEqual((await get(LP + '/' + p)).fields, (await get(p)).fields, p);
    assert.equal((await get(LP + '/cashout/wdck2033h85')).fields.a.doubleValue, 50, 'double נשאר double');
    assert.equal((await get(LP + '/cashout/wdck2033h85')).fields.big.integerValue, '9007199254740993');
    assert.deepEqual(await sub(LP + '/tasks/km8j0hu2ee'), [], 'תת-אוסף לא הועתק');
    // אזהרה על תתי-אוספים שלא הועתקו, עם נתיבי המסמכים (גם בעומק 2), בלי להכשיל את ההרצה
    const tk = rep.docs.find(d => d.rel === 'tasks/km8j0hu2ee');
    assert.deepEqual(tk.subDocs, ['tasks/km8j0hu2ee/c/c1', 'tasks/km8j0hu2ee/c/c1/x/x1', 'tasks/km8j0hu2ee/p/w1']);
    assert.equal(rep.subDocWarnings, 1);
    assert.ok(rep.docs.filter(d => d.rel !== 'tasks/km8j0hu2ee').every(d => !d.subDocs), 'אין אזהרה למסמך בלי תת-אוספים');
    assert.match(r.out, /אזהרה: ל-tasks\/km8j0hu2ee יש 3 מסמכים בתתי-אוספים/);
    assert.match(r.out, /^ {4}tasks\/km8j0hu2ee\/p\/w1$/m);
    assert.deepEqual(await snapshotRoot(), root0, 'השורש לא השתנה');
    assert.equal((await get(LP)).fields.dataRoot.stringValue, 'b');
    assert.match(r.out, /הועתקו 4/);
  });

  it('הרצה שנייה: הכול "כבר קיים וזהה", לא נכתב כלום, יוצא 0', async () => {
    const r = await cd(IDS.join(','));
    show('copy-docs שוב', r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /כבר קיימים וזהים 4/);
    assert.match(r.out, /כתיבות: 0/);
  });

  it('יצירה בלבד: יעד שונה = התנגשות ולא נדרס; מסמך שחסר בשורש מדווח; יוצא 1; מסמך תקין באותה הרצה כן מועתק', async () => {
    await put('rq/okdoc', { text: S('בקשה') });
    const r = await cd('cashout/conf1,inbox/nosuchdoc,rq/okdoc', ['--report', F('cd2.json')]);
    show('copy-docs עם התנגשות וחסר', r);
    assert.equal(r.code, 1);
    const rep = report(F('cd2.json'));
    assert.deepEqual([rep.copied, rep.conflict, rep.missing], [1, 1, 1]);
    assert.equal((await get(LP + '/cashout/conf1')).fields.a.doubleValue, 11, 'היעד לא נדרס');
    assert.equal(await get(LP + '/inbox/nosuchdoc'), null);
    assert.ok(await get(LP + '/rq/okdoc'));
    assert.match(r.out, /התנגשות/);
    assert.match(r.out, /לא נמצא בשורש/);
  });

  it('נתיב לא תקין או אוסף שלא ב-COPY – נדחה לפני כל כתיבה', async () => {
    const before1 = JSON.stringify(await sub(LP));
    const bad = ['cashout', 'cashout/a/c', 'cashout/../x', 'cashout/a b', 'cashout/a.b', 'cashout/%2e', 'cashout/__x__', '/cashout/a',
      'orders/o1', 'mystery/x', 'sec_route/x', 'users/u_emp', 'b/largpeami', 'admins/x/y', 'cashout/a,cashout/a',
      Array.from({ length: 51 }, (_, i) => 'inbox/m' + i).join(',')];
    for (const p of bad) {
      const r = await cd(p);
      assert.notEqual(r.code, 0, p);
      assert.match(r.out, /נתיבים לא תקינים|יותר מדי נתיבים/, p);
    }
    assert.match((await cd('orders/o1')).out, /לא ברשימת האוספים המועתקים/);
    // אוספי הרשאות וזהות – אסורים גם אם הם ב-COPY
    for (const p of ['admins/u_new', 'staff/u_emp', 'private/info', 'push_tokens/u_mgr', 'staff/u_emp/x/y']) {
      const r = await cd(p);
      assert.notEqual(r.code, 0, p);
      assert.match(r.out, /אוסף הרשאות\/זהות/, p);
    }
    assert.equal(await get(LP + '/admins/u_new'), null);
    const none = await run(['copy-docs', '--mode', 'write', '--no-storage', '--backup', F('cd-backup.json')]);
    assert.notEqual(none.code, 0);
    assert.match(none.out, /חסר --paths/);
    assert.equal(JSON.stringify(await sub(LP)), before1, 'לא נוצר אוסף חדש ביעד');
    assert.equal(await get(LP + '/orders/o1'), null);
    const { parseDocPaths } = require(TOOL);
    assert.deepEqual(parseDocPaths(' cashout/a , tasks/b/c/d '), ['cashout/a', 'tasks/b/c/d'], 'נתיב עמוק (מספר זוגי של קטעים) מותר');
  });

  it('שומרים: בלי --mode write, בלי גיבוי, לעסק אחר, או למסמך עסק שלא נוצר על ידי הכלי – סירוב', async () => {
    const ro = await run(['copy-docs', '--no-storage', '--backup', F('cd-backup.json'), '--paths', 'cashout/wdck2033h85']);
    assert.notEqual(ro.code, 0);
    assert.match(ro.out, /copy-docs דורש --mode write/);
    const nb = await run(['copy-docs', '--mode', 'write', '--no-storage', '--paths', 'cashout/wdck2033h85']);
    assert.notEqual(nb.code, 0);
    assert.match(nb.out, /--backup/);
    await put('b/acme', { ...bizFields('b') });
    const other = await cd('cashout/wdck2033h85', ['--biz', 'acme']);
    assert.notEqual(other.code, 0);
    assert.match(other.out, /רק לעסק ההעברה/);
    assert.deepEqual(await sub('b/acme'), []);
    const orig = (await get(LP)).fields;
    const { createdBy, ...noMark } = orig;
    assert.ok(createdBy);
    await put(LP, noMark);
    const r = await cd('rq/okdoc');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /לא נוצר על ידי כלי ההעברה/);
    await put(LP, orig); // החזרה (קוד בדיקה)
  });

  it('עובד גם כש-dataRoot עדיין legacy', async () => {
    await put(LP, bizFields('legacy'));
    await put('deposits/dl1', { a: D(300) });
    const r = await cd('deposits/dl1');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual((await get(LP + '/deposits/dl1')).fields, (await get('deposits/dl1')).fields);
    await put(LP, bizFields('b'));
  });

  it('קובץ התהליך: פעולת copy-docs = מצב כתיבה, קלט doc_paths, בדיקת נתיבים לפני הגיבוי', () => {
    const yaml = require(require.resolve('js-yaml', { paths: [ROOT] }));
    const y = yaml.load(fs.readFileSync(WF, 'utf8'));
    const inp = (y.on || y[true]).workflow_dispatch.inputs;
    assert.ok(inp.action.options.includes('copy-docs'));
    assert.equal(inp.doc_paths.required, false);
    assert.ok(Object.keys(inp).length <= 10, 'עד 10 קלטים בתהליך ידני');
    const cfg = y.jobs.migrate.steps.find(s => s.id === 'cfg');
    assert.match(cfg.run, /copy\|copy-docs\|switch-to-b\|rollback-to-legacy\) echo "mode=write"/);
    const runStep = y.jobs.migrate.steps.find(s => s.name === 'Run');
    assert.equal(runStep.env.DOC_PATHS, '${{ inputs.doc_paths }}', 'הנתיבים עוברים דרך משתנה סביבה, לא ישירות לפקודה');
    assert.ok(!/inputs\.doc_paths/.test(runStep.run), 'אין הצבה ישירה של הקלט בתוך הסקריפט');
    const block = runStep.run.split('copy-docs)')[1].split(';;')[0];
    assert.ok(block.indexOf('parseDocPaths') < block.indexOf('backup') && block.indexOf('backup') < block.indexOf('copy-docs --mode write'), 'בדיקת נתיבים ← גיבוי ← העתקה');
  });
});

// 23.11.2026: purge-root – מחיקת העותק הישן בשורש אחרי המעבר ל-b (בבקשת הבעלים).
describe('purge-root: מחיקת העותק הישן בשורש אחרי המעבר', () => {
  const LP = 'b/' + BIZ;
  const CONFIRM = 'delete-root-copy-of-' + BIZ + '-in-' + P;
  const bizFields = (dataRoot) => ({ name: S("לארג' פעמי"), status: S('active'), dataRoot: S(dataRoot), schemaVersion: I(1), createdAt: TS('2026-11-15T10:00:00Z'), createdBy: S('migrate'), migrationTarget: B(true) });
  // בשורש ובעותק ב-b (התוכן ב-b חדש יותר ושונה – מותר)
  const BOTH = ['cashout/a', 'tasks/t1', 'tasks/t1/c/c1', 'tasks/orphan/c/c9', 'fb/old', 'inbox/chg', 'cust/x', 'cust/x/p/card1'];
  // רק בשורש: נשארים ומדווחים "חסר ב-b"
  const ROOT_ONLY = ['cashout/onlyroot', 'tasks/t1/c/c2', 'fb/new'];
  // מחוץ לתחום – לא נמחקים גם כשיש להם עותק ב-b
  const NEVER = ['admins/u_mgr', 'staff/u_emp', 'private/pay', 'orders/o1', 'site_income_daily/2026-11-20', 'sec_waq/largpeami__m1',
    'impQ/largpeami_j1', 'mailRate/h', 'users/u_emp', 'superadmins/sa1', 'pact/x', 'push_dev/x', 'dev_cur/x', 'mystery/x'];
  const T0 = { t: S('root'), n: D(1.5) };
  const pr = (extra = [], env = {}) => run(['purge-root', ...extra], env);
  const W = (extra = []) => pr(['--mode', 'write', ...extra], { MIGRATE_PURGE_CONFIRM: CONFIRM });
  async function rootState() { const o = {}; for (const p of [...BOTH, ...ROOT_ONLY, ...NEVER]) { const d = await get(p); o[p] = d ? d.updateTime : null; } return o; }
  let uploaded = '';
  before(async () => {
    await clearAll();
    const w = [[LP, bizFields('b')]];
    for (const p of BOTH) w.push([p, T0], [LP + '/' + p, { t: S('b – חדש יותר') }]);
    for (const p of ROOT_ONLY) w.push([p, T0]);
    for (const p of NEVER) { w.push([p, T0]); if (!/^(users|superadmins)\//.test(p)) w.push([LP + '/' + p, T0]); }
    await putMany(w);
    const bk = storage();
    await bk.file('app_backups/u_mgr/1.enc').save(Buffer.alloc(100, 1), { contentType: 'application/octet-stream' });
    await bk.file(LP + '/app_backups/u_mgr/1.enc').save(Buffer.alloc(100, 1), { contentType: 'application/octet-stream' });
    await bk.file('app_backups/u_emp/2.enc').save(Buffer.alloc(50, 2), { contentType: 'application/octet-stream' });
  });

  it('ספירה (בלי --mode write): לא נמחק כלום, ספירות לפי אוסף, חסרים ב-b מדווחים, יוצא 1', async () => {
    const s0 = await rootState();
    const r = await pr(['--report', F('pr-dry.json')]);
    show('purge-root (ספירה)', r);
    assert.equal(r.code, 1, 'יש מסמכים שחסרים ב-b');
    const rep = report(F('pr-dry.json'));
    assert.equal(rep.write, false);
    assert.equal(rep.candidates, BOTH.length);
    assert.equal(rep.deleted, 0);
    assert.deepEqual(rep.missingInBPaths.sort(), [...ROOT_ONLY].sort());
    assert.equal(rep.collections.tasks.candidates, 3);
    assert.equal(rep.collections.fb.missingInB, 1);
    for (const c of ['admins', 'staff', 'private', 'orders', 'sec_waq', 'users', 'superadmins', 'pact', 'mystery']) {
      assert.ok(!rep.scope.includes(c), c);
      assert.ok(rep.outOfScope.find(o => o.coll === c), 'מדווח כמחוץ לתחום: ' + c);
    }
    assert.deepEqual(await rootState(), s0, 'שום מסמך לא השתנה');
    assert.match(r.out, /ספירה בלבד \(לא נמחק כלום\)/);
    assert.match(r.out, /לא נוגעים: admins \(זהות והרשאות/);
    assert.match(r.out, /Storage \(app_backups\/ בשורש, לא נמחק\): 2 קבצים \/ 150 בתים\. זהים ב-b: 1/);
    assert.doesNotMatch(r.out, /b – חדש יותר|"root"/, 'בלי תוכן מסמכים בפלט');
    assert.match(r.out, /כתיבות: 0/);
  });

  it('סירוב: בלי אישור, אישור שגוי, בלי גיבוי, גיבוי שלא נשמר ב-bucket, גיבוי ישן, dataRoot legacy, מסמך עסק שלא נוצר בכלי, עסק אחר', async () => {
    const s0 = await rootState();
    const b = await run(['backup', '--out', F('pr-bk0.json'), '--upload', '--upload-tag', 'pr0', '--report', F('pr-bk0-r.json')]);
    assert.equal(b.code, 0, b.out);
    const gcs = report(F('pr-bk0-r.json')).uploaded;
    assert.match(gcs, /migrate_backups\//);
    const cases = [
      ['בלי אישור מחיקה', pr(['--mode', 'write', '--backup', F('pr-bk0.json'), '--backup-gcs', gcs]), /חסר אישור מחיקה/],
      ['אישור שגוי', pr(['--mode', 'write', '--backup', F('pr-bk0.json'), '--backup-gcs', gcs], { MIGRATE_PURGE_CONFIRM: 'delete-root-copy-of-largpeami-in-largpeami' }), /חסר אישור מחיקה/],
      ['בלי גיבוי', W(), /--backup/],
      ['גיבוי לא שמור ב-bucket', W(['--backup', F('pr-bk0.json')]), /--backup-gcs/],
      ['נתיב גיבוי מחוץ ל-migrate_backups', W(['--backup', F('pr-bk0.json'), '--backup-gcs', 'app_backups/u_mgr/1.enc']), /--backup-gcs/],
      ['קובץ גיבוי שלא קיים ב-bucket', W(['--backup', F('pr-bk0.json'), '--backup-gcs', 'migrate_backups/nope/backup.json']), /לא נמצא ב-bucket/],
    ];
    for (const [name, p, re] of cases) { const r = await p; assert.notEqual(r.code, 0, name); assert.match(r.out, re, name); }
    // גיבוי ישן (takenAt לפני 7 שעות) – נדחה
    const old = report(F('pr-bk0.json')); old.takenAt = new Date(Date.now() - 7 * 3600e3).toISOString();
    fs.writeFileSync(F('pr-bk-old.json'), JSON.stringify(old));
    const ro = await W(['--backup', F('pr-bk-old.json'), '--backup-gcs', gcs]);
    assert.notEqual(ro.code, 0); assert.match(ro.out, /לא טרי/);
    // קובץ מקומי ששונה אחרי השמירה ב-bucket – נדחה
    const ed = report(F('pr-bk0.json')); ed.x = 1; fs.writeFileSync(F('pr-bk-ed.json'), JSON.stringify(ed));
    const re2 = await W(['--backup', F('pr-bk-ed.json'), '--backup-gcs', gcs]);
    assert.notEqual(re2.code, 0); assert.match(re2.out, /לא זהה לקובץ המקומי/);
    // dataRoot legacy – נדחה גם בספירה
    await put(LP, bizFields('legacy'));
    for (const r of [await pr(), await W(['--backup', F('pr-bk0.json'), '--backup-gcs', gcs])]) { assert.notEqual(r.code, 0); assert.match(r.out, /לא b/); }
    const { createdBy, ...noMark } = bizFields('b');
    assert.ok(createdBy);
    await put(LP, noMark);
    const nm = await W(['--backup', F('pr-bk0.json'), '--backup-gcs', gcs]);
    assert.notEqual(nm.code, 0); assert.match(nm.out, /לא נוצר על ידי כלי ההעברה/);
    await put(LP, bizFields('b'));
    await put('b/acme', bizFields('b'));
    const ob = await W(['--biz', 'acme', '--backup', F('pr-bk0.json'), '--backup-gcs', gcs]);
    assert.notEqual(ob.code, 0); assert.match(ob.out, /רק לעסק ההעברה/);
    const s1 = await rootState();
    for (const k of Object.keys(s0)) assert.equal(s1[k], s0[k], 'לא השתנה: ' + k);
  });

  it('מחיקה: רק מסמכים שיש להם עותק ב-b (כולל תתי-אוספים), חסר ב-b נשאר, שינוי אחרי הגיבוי מדלג, מחוץ לתחום לא נוגעים, Storage לא נמחק', async () => {
    const b = await run(['backup', '--out', F('pr-bk1.json'), '--upload', '--upload-tag', 'pr1', '--report', F('pr-bk1-r.json')]);
    assert.equal(b.code, 0, b.out);
    uploaded = report(F('pr-bk1-r.json')).uploaded;
    await put('inbox/chg', { t: S('שונה אחרי הגיבוי') }); // "האפליקציה" שינתה אחרי הגיבוי
    const never0 = {}; for (const p of NEVER) never0[p] = (await get(p)).updateTime;
    const bCopy0 = {}; for (const p of [...BOTH, ...NEVER]) { const d = await get(LP + '/' + p); bCopy0[p] = d ? d.updateTime : null; }
    const r = await W(['--backup', F('pr-bk1.json'), '--backup-gcs', uploaded, '--report', F('pr-w.json')]);
    show('purge-root (מחיקה)', r);
    assert.equal(r.code, 1, 'יש חסרים ב-b ומסמך שהשתנה – קוד 1');
    const rep = report(F('pr-w.json'));
    assert.equal(rep.backup, uploaded.startsWith('gs://') ? uploaded : rep.backup);
    assert.match(r.out, /גיבוי טרי לפני המחיקה: gs:\/\/.*migrate_backups\//);
    const deleted = BOTH.filter(p => p !== 'inbox/chg');
    assert.equal(rep.deleted, deleted.length);
    for (const p of deleted) assert.equal(await get(p), null, 'נמחק: ' + p);
    for (const p of ROOT_ONLY) assert.ok(await get(p), 'חסר ב-b – נשאר: ' + p);
    assert.ok(await get('inbox/chg'), 'השתנה אחרי הגיבוי – נשאר');
    assert.deepEqual(rep.changedPaths, ['inbox/chg']);
    for (const p of NEVER) assert.equal((await get(p)).updateTime, never0[p], 'מחוץ לתחום, לא השתנה: ' + p);
    for (const p of Object.keys(bCopy0)) { const d = await get(LP + '/' + p); assert.equal(d ? d.updateTime : null, bCopy0[p], 'העותק ב-b לא השתנה: ' + p); }
    assert.ok(await get(LP), 'מסמך העסק קיים');
    // תת-אוסף: המסמך שחסר ב-b נשאר גם כשהאב נמחק
    assert.ok(await get('tasks/t1/c/c2'));
    const [files] = await storage().getFiles({ prefix: 'app_backups/' });
    assert.equal(files.length, 2, 'Storage לא נמחק');
    assert.match(r.out, /cashout: נמחקו 1 \| נשארו \(חסרים ב-b\) 1/);
    assert.match(r.out, /חסר ב-b, לא נמחק: fb\/new/);
    assert.match(r.out, /מחיקות: 7/);
    // הרצה חוזרת: אין מה למחוק, החסרים עדיין מדווחים
    const b2 = await run(['backup', '--out', F('pr-bk2.json'), '--upload', '--upload-tag', 'pr2', '--report', F('pr-bk2-r.json')]);
    const again = await W(['--backup', F('pr-bk2.json'), '--backup-gcs', report(F('pr-bk2-r.json')).uploaded, '--report', F('pr-w2.json')]);
    assert.equal(b2.code, 0);
    assert.equal(report(F('pr-w2.json')).deleted, 1, 'inbox/chg נמחק עכשיו (בגיבוי החדש ויש לו עותק ב-b)');
    assert.equal(report(F('pr-w2.json')).missingInB, ROOT_ONLY.length);
  });

  it('שינוי בזמן הריצה: מחיקה עם updateTime ישן נכשלת והמסמך נשאר; מחיקה חסומה מחוץ לתחום ובלי הפעלה', async () => {
    const { FsRest } = require(path.join(MDIR, 'fsrest'));
    await put('cashout/race', { a: D(1) });
    const before1 = await get('cashout/race');
    await put('cashout/race', { a: D(2) }); // שינוי אחרי הקריאה
    const fsr = new FsRest({ project: P, mode: 'write', bizId: BIZ, token: async () => 'owner', emulatorHost: EMU });
    await assert.rejects(fsr.deleteDocs([{ path: 'cashout/race', updateTime: before1.updateTime }]), /מחיקה לא מופעלת/, 'בלי enablePurge אין מחיקה');
    fsr.enablePurge(['cashout', 'tasks']);
    const [res] = await fsr.deleteDocs([{ path: 'cashout/race', updateTime: before1.updateTime }]);
    assert.equal(res.ok, false);
    assert.equal((await get('cashout/race')).fields.a.doubleValue, 2, 'המסמך ששונה לא נמחק');
    for (const p of ['b/largpeami/cashout/a', 'b/largpeami', 'users/u_emp', 'admins/u_mgr', 'staff/u_emp', 'private/pay', 'orders/o1', 'sec_waq/x', 'cashout', 'cashout/a/c'])
      await assert.rejects(fsr.deleteDocs([{ path: p, updateTime: before1.updateTime }]), /מחוץ לתחום|לא תקין/, p);
    await assert.rejects(fsr.deleteDocs([{ path: 'cashout/race' }]), /בלי updateTime/);
    for (const bad of [['admins'], ['b'], ['users'], ['private']]) assert.throws(() => fsr.enablePurge(bad), /אסורים למחיקה/);
    const ro = new FsRest({ project: P, mode: 'readonly', bizId: BIZ, token: async () => 'owner', emulatorHost: EMU });
    assert.throws(() => ro.enablePurge(['cashout']), /קריאה בלבד/);
    // writeDocs לעולם לא מוחק בשורש
    await assert.rejects(fsr.writeDocs([{ path: 'cashout/race', kind: 'update', updateTime: before1.updateTime, fields: {} }]), /מחוץ ליעד/);
    const { purgeScope, PURGE_KEEP, DEFERRED: DEF, SHARED: SH, NEW_ROOT } = require(TOOL);
    const sc = purgeScope(['cashout', 'admins', 'staff', 'private', ...DEF, ...SH, ...NEW_ROOT, 'b', 'pact', 'push_dev', 'dev_cur']);
    assert.deepEqual(sc, ['cashout']);
    assert.deepEqual(PURGE_KEEP, ['admins', 'staff', 'private']);
  });

  it('קובץ התהליך: purge-root = כתיבה עם אישור נפרד וגיבוי שנשמר לפני; purge-root-dry-run = קריאה בלבד', () => {
    const yaml = require(require.resolve('js-yaml', { paths: [ROOT] }));
    const y = yaml.load(fs.readFileSync(WF, 'utf8'));
    const inp = (y.on || y[true]).workflow_dispatch.inputs;
    assert.ok(inp.action.options.includes('purge-root') && inp.action.options.includes('purge-root-dry-run'));
    assert.equal(inp.action.default, 'check');
    assert.ok(Object.keys(inp).length <= 10, 'עד 10 קלטים בתהליך ידני');
    const cfg = y.jobs.migrate.steps.find(s => s.id === 'cfg');
    assert.match(cfg.run, /\n\s*purge-root-dry-run\) echo "mode=readonly"/);
    assert.match(cfg.run, /\n\s*purge-root\) echo "mode=write"/);
    const runStep = y.jobs.migrate.steps.find(s => s.name === 'Run');
    assert.equal(runStep.env.MIGRATE_PURGE_CONFIRM, "${{ inputs.action == 'purge-root' && inputs.doc_paths || '' }}");
    const block = runStep.run.split(/\n\s*purge-root\)/)[1].split(';;')[0];
    const iC = block.indexOf('delete-root-copy-of-largpeami-in-'), iU = block.indexOf('upload_backup=true'), iB = block.indexOf('backup\n'), iR = block.indexOf('r.uploaded'), iP = block.indexOf('purge-root --mode write');
    assert.ok(iC >= 0 && iC < iU && iU < iB && iB < iR && iR < iP, 'אישור ← חובת שמירה ב-bucket ← גיבוי ← בדיקה שנשמר ← מחיקה');
    assert.match(block, /--backup-gcs "\$BK"/);
    const dry = runStep.run.split('purge-root-dry-run)')[1].split(';;')[0];
    assert.doesNotMatch(dry, /--mode write/);
  });
});

// 23.11.2026: תהליך מדיניות הניקוי לעותקי הפונקציות (בדיקה סטטית של הקובץ, לא מריץ אותו)
describe('set-artifacts-cleanup.yml: ידני, רק מ-main, פרויקט פעמיים, אישור, שני האזורים', () => {
  it('מבנה הקובץ וההגנות', () => {
    const yaml = require(require.resolve('js-yaml', { paths: [ROOT] }));
    const file = path.resolve(ROOT, '..', '.github', 'workflows', 'set-artifacts-cleanup.yml');
    const txt = fs.readFileSync(file, 'utf8');
    const y = yaml.load(txt);
    const on = y.on || y[true];
    assert.deepEqual(Object.keys(on), ['workflow_dispatch'], 'ידני בלבד');
    const inp = on.workflow_dispatch.inputs;
    assert.deepEqual(inp.project.options, ['largpeami', 'largpeami-test-f4691']);
    assert.equal(inp.project_confirm.required, true);
    assert.deepEqual(inp.location.options, ['both', 'europe-west1', 'us-central1']);
    const steps = y.jobs.setpolicy.steps;
    const g = steps[0].run;
    assert.match(g, /refs\/heads\/main/);
    assert.match(g, /\[ "\$P" = "\$PC" \]/, 'מזהה הפרויקט פעמיים');
    assert.match(g, /setpolicy-\$L-\$P/, 'קלט אישור');
    const firstSecret = steps.findIndex(s => /secrets\./.test(JSON.stringify(s)));
    assert.ok(firstSecret > 0, 'השומר רץ לפני הסוד');
    const deploy = fs.readFileSync(path.resolve(ROOT, '..', '.github', 'workflows', 'deploy-firebase-manual.yml'), 'utf8');
    const ver = t => (t.match(/firebase-tools@([0-9.]+)/) || [])[1];
    assert.equal(ver(txt), ver(deploy), 'אותה גרסת firebase-tools כמו בפרסום הידני');
    const set = steps.find(s => s.name === 'Set cleanup policy').run;
    assert.match(set, /functions:artifacts:setpolicy --location "\$R" --days "\$D" --force --project "\$P" --non-interactive/);
    assert.match(set, /europe-west1 us-central1/);
    assert.match(set, /permission\|denied/i, 'הודעה ברורה על חוסר הרשאה');
    assert.match(set, /exit \$FAIL/);
    assert.equal(steps[steps.length - 1].if, 'always()', 'קובץ חשבון השירות נמחק תמיד');
    assert.ok(!/-----BEGIN|private_key"\s*:/.test(txt), 'אין סוד בקובץ');
  });
});
