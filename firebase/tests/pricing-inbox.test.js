'use strict';
// חשבונית ספק של עובד → pinv בשרת (22.11.2026): piInbox / piInboxB (functions/pricing-inbox.js).
// הליבה (_core.onInbox) רצה בתוך תהליך הבדיקה מול אמולטור ה-Firestore (כמו 46-tasks-push.js), בלי לכתוב מסמך inbox –
// כדי שהטריגר באמולטור הפונקציות לא ירוץ במקביל. בדיקה אחת מקצה לקצה כותבת inbox ומחכה לטריגר האמיתי (רק כשאמולטור הפונקציות רץ).
// Gemini – דמה בלבד (gemini-mock, 127.0.0.1:9799). אין שום פנייה החוצה.
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.GEMINI_API_BASE = 'http://127.0.0.1:9799';
process.env.GEMINI_API_KEY = 'dummy-gemini-key-for-emulator';
process.env.SCAN_RETRY_WAIT_MS = '10';
process.env.SCAN_DAILY_LIMIT = '100'; // כמו functions/.env
process.env.SCAN_MAX_FILE_MB = '10';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');

const A = 'biz-pix', OFF = 'biz-pix-off', NOSCAN = 'biz-pix-nos', OTHER = 'biz-pix-oth';
const E1 = 'pix_e1', E2 = 'pix_e2', EOFF = 'pix_eoff', NOP = 'pix_nop', MGR = 'pix_mgr', FOR = 'pix_for', LE = 'pix_le';
const NONE = { incR: false, incW: false, expR: false, expW: false, sup: false, sal: false, rep: false, ord: false, trf: false, bal: false, ordP: false, prc: false };
const CATS = JSON.stringify({ cats: [{ id: 'c_sup', name: 'ספקים', beh: 'sup', subs: [{ id: 's_tv', name: 'תבניכל' }, { id: 's_off', name: 'בדק בית', prOff: 1 }] }, { id: 'c_simple', name: 'שונות', beh: 'simple', subs: [] }] });

// קבצים קטנים עם חתימה אמיתית (scanDocument בודק את התוכן)
const jpeg = (n, seed) => { const b = Buffer.alloc(n || 64, seed || 7); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; return 'data:image/jpeg;base64,' + b.toString('base64'); };
const pdf = () => 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%dummy pdf for tests\n').toString('base64');
const CH = 700000;

let env, X, seq = 0;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
const nid = () => 'ix' + Date.now().toString(36) + (seq++);
const pidOf = (id) => 'i' + X.rqOf('o' + id);
const invReqs = () => GM.state.requests.filter((r) => r.kind === 'invlines');

// מסמך inbox כמו pushItem (index.html): data = JSON של ההוצאה, parts כמחרוזת, וחלקי הצילום ב-chunks (נכתבים לפני ה-inbox)
async function stage(pfx, owner, data, file, over) {
  const id = nid();
  const parts = Math.max(1, Math.ceil((file || '').length / CH));
  await prep(async (d) => { for (let k = 0; k < parts; k++) await d.doc(`${pfx}chunks/${id}_${k}`).set({ owner, data: (file || '').slice(k * CH, (k + 1) * CH) }); });
  const doc = Object.assign({ owner, by: owner, status: 'new', created: new Date().toISOString(), data: JSON.stringify(data), parts: String(parts), t: Date.now() }, over || {});
  return { id, doc };
}
const EXP = (o) => Object.assign({ cat: 'c_sup', catName: 'ספקים', sub: 's_tv', subName: 'תבניכל', inv: '777', date: '2026-11-20', amt: 118, kind: 'inv' }, o || {});

async function seed() {
  await env.clearFirestore();
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('b/' + A), { name: 'א', status: 'active', dataRoot: 'b', schemaVersion: 1, features: { scan: true, shelf: true, orders: true } });
    b.set(d.doc('b/' + OFF), { name: 'ב', status: 'active', dataRoot: 'b', schemaVersion: 1, features: { scan: true } }); // בלי מדף והזמנות
    b.set(d.doc('b/' + NOSCAN), { name: 'ג', status: 'active', dataRoot: 'b', schemaVersion: 1, features: { shelf: true } }); // בלי זיהוי חכם
    b.set(d.doc('b/' + OTHER), { name: 'ד', status: 'active', dataRoot: 'b', schemaVersion: 1, features: { scan: true, shelf: true } });
    for (const z of [A, OFF, NOSCAN, OTHER]) {
      b.set(d.doc(`b/${z}/cfg/main`), { data: CATS });
      b.set(d.doc(`b/${z}/staff/${E1}`), { name: 'דני העובד', active: true });
    }
    b.set(d.doc(`b/${A}/ordcfg/main`), { vat: 18 });
    b.set(d.doc(`b/${A}/staff/${E2}`), { name: 'רותי', active: true });
    b.set(d.doc(`b/${A}/staff/${EOFF}`), { name: 'מושבת', active: false });
    b.set(d.doc(`b/${A}/staff/${NOP}`), { name: 'בלי הרשאה', active: true, perms: NONE });
    b.set(d.doc(`b/${A}/admins/${MGR}`), { email: 'm@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${MGR}`), { name: 'המנהל', active: true });
    b.set(d.doc(`b/${A}/staff/${FOR}`), { name: 'זר', active: true }); // רשומת עובד, אבל המשתמש שייך לעסק אחר
    for (const [u, z] of [[E1, A], [E2, A], [EOFF, A], [NOP, A], [MGR, A], [FOR, OTHER]]) b.set(d.doc('users/' + u), { bizId: z, role: u === MGR ? 'admin' : 'worker', active: true, bizStatus: 'active' });
    // לארג' פעמי במצב legacy (בלי b/largpeami): הכול בשורש
    b.set(d.doc('staff/' + LE), { name: 'עובד ותיק', active: true });
    b.set(d.doc('cfg/main'), { data: CATS });
    await b.commit();
  });
}

const run = (biz, s, o) => X.onInbox(biz, s.id, s.doc, o);

before(async () => {
  env = await H.getEnv(); await GM.start();
  require('../functions/index.js');
  X = require('../functions/pricing-inbox.js')._core;
});
after(async () => { await GM.stop(); });
beforeEach(async () => { GM.reset(); await seed(); });

describe('piInbox – חשבונית ספק של עובד נכנסת לתמחור בשרת', { skip: !process.env.FIRESTORE_EMULATOR_HOST && 'אמולטור Firestore לא רץ' }, () => {
  it('lib/pricing-lines.js זהה תו-בתו ל-www/pricing-lines.js', () => {
    const a = fs.readFileSync(path.join(__dirname, '../../app-source/www/pricing-lines.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../functions/lib/pricing-lines.js'), 'utf8');
    assert.equal(a, b);
  });

  it('rqOf – כמו באפליקציה: אותו מזהה כמו בטלפון (pinv/i + reqId)', () => {
    assert.equal(X.rqOf('oabc'), 'pioabc00');
    assert.equal(X.rqOf('o' + 'x'.repeat(50)), ('pio' + 'x'.repeat(50)).slice(0, 40));
    assert.equal(X.rqOf('o12.3!x'), 'pio123x0');
  });

  it('b/{bizId}: נוצרת חשבונית לתמחור עם השורות, הכותרת מההוצאה, הצילום, והזיהוי נספר במכסה של העובד', async () => {
    const f = jpeg(200);
    const s = await stage(`b/${A}/`, E1, EXP(), f);
    const r = await run(A, s);
    assert.equal(r.r, 'created', JSON.stringify(r));
    const pid = pidOf(s.id);
    const p = await get(`b/${A}/pinv/${pid}`);
    assert.ok(p, 'pinv נוצר');
    assert.equal(p.st, 'new'); assert.equal(p.src, 'worker'); assert.equal(p.by, E1); assert.equal(p.byName, 'דני העובד');
    assert.equal(p.sup, 'תבניכל'); assert.equal(p.supId, 's_tv'); assert.equal(p.inv, '777'); assert.equal(p.date, '2026-11-20');
    assert.equal(p.n, 3); assert.equal(p.lines.length, 3);
    assert.equal(p.lines[0].bc, '7290000000011');
    for (const l of p.lines) for (const k of Object.keys(l)) assert.ok(['n', 'bc', 'sku', 'qty', 'unit', 'pk', 'ct', 'cost', 'raw', 'chk'].includes(k), 'שדה זיהוי בלבד: ' + k);
    assert.equal(p.np, 1); assert.equal(typeof p.img, 'number');
    assert.equal((await get(`b/${A}/pinv/${pid}/p/0`)).data, f);
    const q = invReqs();
    assert.equal(q.length, 1);
    assert.equal(q[0].body.generationConfig.temperature, 0);
    assert.equal(q[0].body.contents[0].parts.filter((x) => x.inline_data).length, 1);
    const u = await get(`b/${A}/scan_usage/${E1}`);
    assert.equal(u.count, 1);
    assert.equal((await get(`b/${A}/scan_usage/_biz`)).count, 1, 'מונה העסק – דף אחד');
    assert.equal(await get(`scan_usage/${E1}`), null, 'לא בשורש');
  });

  it('legacy (inbox בשורש): נוצר pinv בשורש', async () => {
    const s = await stage('', LE, EXP(), jpeg());
    const r = await run(null, s);
    assert.equal(r.r, 'created', JSON.stringify(r));
    const p = await get('pinv/' + pidOf(s.id));
    assert.ok(p); assert.equal(p.by, LE); assert.equal(p.byName, 'עובד ותיק'); assert.equal(p.n, 3);
    assert.equal((await get('scan_usage/' + LE)).count, 1);
  });

  it('כותרת חסרה בהוצאה – ספק, מספר ותאריך מהזיהוי; sub לא תקין – בלי supId', async () => {
    const s = await stage(`b/${A}/`, E1, EXP({ sub: 'bad id!', subName: '', inv: '', date: 'אתמול' }), jpeg());
    assert.equal((await run(A, s)).r, 'created');
    const p = await get(`b/${A}/pinv/${pidOf(s.id)}`);
    assert.equal(p.sup, 'תבניכל בע"מ'); assert.equal(p.inv, '50123'); assert.equal(p.date, '2026-11-10');
    assert.equal(p.supId, undefined);
  });

  it('תנאים: קטגוריה שאינה ספק, צ\'ק, צילום חלופי, ספק כבוי לתמחור, סכום 0, בלי צילום – אין pinv ואין זיהוי', async () => {
    const C = [
      [EXP({ cat: 'c_simple' }), jpeg(), null, 'not-sup'],
      [EXP({ cat: 'c_missing' }), jpeg(), null, 'not-sup'],
      [EXP({ kind: 'check' }), jpeg(), { k: 'check' }, 'check'],
      [EXP({ repl: 'abc123' }), jpeg(), null, 'repl'],
      [EXP({ sub: 's_off', subName: 'בדק בית' }), jpeg(), null, 'sup-off'],
      [EXP({ reg: 'r1', sub: 's_off', subName: 'בדק בית' }), jpeg(), null, 'sup-off'],
      [EXP({ amt: 0 }), jpeg(), null, 'amt'],
      [EXP({ amt: '' }), jpeg(), null, 'amt'],
      [EXP(), '', null, 'no-photo'], // nopic: חלק אחד ריק
    ];
    for (const [data, file, over, want] of C) {
      const s = await stage(`b/${A}/`, E1, data, file, over);
      const r = await run(A, s);
      assert.equal(r.r, want, JSON.stringify(data));
      assert.equal(await get(`b/${A}/pinv/${pidOf(s.id)}`), null);
    }
    assert.equal(invReqs().length, 0);
    assert.equal(await get(`b/${A}/scan_usage/${E1}`), null);
  });

  it('הוצאה מקופה של ספק דלוק לתמחור (ברירת מחדל) – נוצר pinv', async () => {
    const s = await stage(`b/${A}/`, E1, EXP({ reg: 'r1' }), jpeg());
    assert.equal((await run(A, s)).r, 'created');
    assert.ok(await get(`b/${A}/pinv/${pidOf(s.id)}`));
  });

  it('תוספות כבויות (בלי מדף והזמנות / בלי זיהוי חכם) – אין pinv', async () => {
    for (const [z, want] of [[OFF, 'feature-off'], [NOSCAN, 'scan-off']]) {
      await prep((d) => d.doc('users/' + E1).set({ bizId: z, role: 'worker', active: true, bizStatus: 'active' }));
      const s = await stage(`b/${z}/`, E1, EXP(), jpeg());
      assert.equal((await run(z, s)).r, want);
      assert.equal(await get(`b/${z}/pinv/${pidOf(s.id)}`), null);
    }
    assert.equal(invReqs().length, 0);
  });

  it('השולח: מנהל, עובד מושבת, עובד בלי expW/prc, משתמש של עסק אחר – אין pinv', async () => {
    for (const [u, want] of [[MGR, 'not-staff'], [EOFF, 'not-staff'], [NOP, 'no-perm'], [FOR, 'not-member'], ['pix_nobody', 'not-member']]) {
      const s = await stage(`b/${A}/`, u, EXP(), jpeg());
      assert.equal((await run(A, s)).r, want, u);
      assert.equal(await get(`b/${A}/pinv/${pidOf(s.id)}`), null);
    }
    assert.equal(invReqs().length, 0);
  });

  it('חלק בצילום של עובד אחר / חלק חסר – no-chunk, בלי זיהוי', async () => {
    const s = await stage(`b/${A}/`, E1, EXP(), jpeg());
    await prep((d) => d.doc(`b/${A}/chunks/${s.id}_0`).set({ owner: E2, data: jpeg() }));
    assert.equal((await run(A, s)).r, 'no-chunk');
    const s2 = await stage(`b/${A}/`, E1, EXP(), jpeg());
    await prep((d) => d.doc(`b/${A}/chunks/${s2.id}_0`).delete()); // המנהל כבר מחק
    assert.equal((await run(A, s2)).r, 'no-chunk');
    assert.equal(invReqs().length, 0);
  });

  it('כפילות: pinv קיים (הטלפון כבר יצר) – בלי זיהוי ובלי שינוי', async () => {
    const s = await stage(`b/${A}/`, E1, EXP(), jpeg());
    const pid = pidOf(s.id);
    await prep((d) => d.doc(`b/${A}/pinv/${pid}`).set({ st: 'new', src: 'worker', by: E1, byName: 'x', at: 1, upd: 1, n: 0, lines: [], sup: 'מהטלפון', inv: '', date: '' }));
    const r = await run(A, s);
    assert.equal(r.r, 'dup');
    assert.equal((await get(`b/${A}/pinv/${pid}`)).sup, 'מהטלפון');
    assert.equal(invReqs().length, 0);
    assert.equal(await get(`b/${A}/scan_usage/${E1}`), null, 'לא נספר במכסה');
    // וגם הפוך: אחרי שהשרת יצר, הרצה נוספת (אותו אירוע פעמיים) לא יוצרת שוב
    const s2 = await stage(`b/${A}/`, E1, EXP(), jpeg());
    assert.equal((await run(A, s2)).r, 'created');
    assert.equal((await run(A, s2)).r, 'dup');
    assert.equal(invReqs().length, 1);
  });

  it('Gemini נכשל אחרי שהבקשה יצאה – אין pinv (הטלפון ממשיך לנסות), הזיהוי נספר במכסה', async () => {
    GM.state.mode = 'badkey';
    const s = await stage(`b/${A}/`, E1, EXP(), jpeg());
    const r = await run(A, s);
    assert.equal(r.r, 'scan');
    assert.equal(await get(`b/${A}/pinv/${pidOf(s.id)}`), null);
    assert.ok(invReqs().length >= 1);
    assert.equal((await get(`b/${A}/scan_usage/${E1}`)).count, 1);
  });

  it('אין חיבור ל-Gemini (שום בקשה לא יצאה) – המכסה מוחזרת', async () => {
    const s = await stage(`b/${A}/`, E1, EXP(), jpeg());
    const r = await run(A, s, { base: 'http://127.0.0.1:9798' }); // אף שרת לא מאזין שם
    assert.equal(r.r, 'scan');
    assert.equal(await get(`b/${A}/pinv/${pidOf(s.id)}`), null);
    assert.equal((await get(`b/${A}/scan_usage/${E1}`)).count, 0);
  });

  it('המכסה היומית של העובד נגמרה – אין זיהוי ואין pinv', async () => {
    const S = require('../functions/lib/scan.js');
    await prep((d) => d.doc(`b/${A}/scan_usage/${E1}`).set({ day: S.israelDay(), count: 100 }));
    const s = await stage(`b/${A}/`, E1, EXP(), jpeg());
    const r = await run(A, s);
    assert.equal(r.r, 'scan'); assert.equal(r.reason, 'daily-limit');
    assert.equal(invReqs().length, 0);
    assert.equal(await get(`b/${A}/pinv/${pidOf(s.id)}`), null);
  });

  it('זיהוי בלי שורות (תשובה לא תקינה) – נוצרת חשבונית עם 0 שורות, כמו בטלפון', async () => {
    GM.state.mode = 'garbage';
    const s = await stage(`b/${A}/`, E1, EXP(), jpeg());
    assert.equal((await run(A, s)).r, 'created');
    const p = await get(`b/${A}/pinv/${pidOf(s.id)}`);
    assert.equal(p.n, 0); assert.deepEqual(p.lines, []); assert.equal(p.sup, 'תבניכל');
  });

  it('צילום גדול (2 חלקים ב-chunks) – נשמר ב-pinv/{id}/p בשני חלקים, np = 2', async () => {
    const f = jpeg(600000, 9); // ~800,000 תווים
    const s = await stage(`b/${A}/`, E1, EXP(), f);
    assert.equal(s.doc.parts, '2');
    assert.equal((await run(A, s)).r, 'created');
    const pid = pidOf(s.id);
    const p = await get(`b/${A}/pinv/${pid}`);
    assert.equal(p.np, 2);
    const parts = (await coll(`b/${A}/pinv/${pid}/p`)).sort((a, b) => a.id.localeCompare(b.id));
    assert.equal(parts.length, 2);
    assert.equal(parts[0].data + parts[1].data, f);
  });

  it('כמה עמודים (PAGES:) – עד 4 לזיהוי; PDF – לבד ועוצרים', async () => {
    const pg = ['a', 'b', 'c', 'd', 'e'].map((x, i) => jpeg(80, 10 + i));
    const s = await stage(`b/${A}/`, E1, EXP(), 'PAGES:' + JSON.stringify(pg));
    assert.equal((await run(A, s)).r, 'created');
    assert.equal(invReqs()[0].body.contents[0].parts.filter((x) => x.inline_data).length, 4);
    assert.equal((await get(`b/${A}/pinv/${pidOf(s.id)}/p/0`)).data, 'PAGES:' + JSON.stringify(pg.slice(0, 4)));
    assert.equal((await get(`b/${A}/scan_usage/_biz`)).count, 4, 'מונה העסק – 4 דפים');
    GM.reset();
    const pd = pdf();
    const s2 = await stage(`b/${A}/`, E1, EXP(), 'PAGES:' + JSON.stringify([pd, jpeg()]));
    assert.equal((await run(A, s2)).r, 'created');
    const parts = invReqs()[0].body.contents[0].parts.filter((x) => x.inline_data);
    assert.equal(parts.length, 1); assert.equal(parts[0].inline_data.mime_type, 'application/pdf');
    assert.equal((await get(`b/${A}/pinv/${pidOf(s2.id)}/p/0`)).data, pd);
  });

  it('מזהה עסק לא תקין / מסמך פגום – בלי שגיאה', async () => {
    assert.equal((await X.onInbox('BAD!', 'x1', {})).r, 'bad');
    assert.equal((await X.onInbox(A, 'x1', null)).r, 'bad-doc');
    assert.equal((await X.onInbox(A, 'x1', { owner: E1, status: 'new', data: 'not json', parts: '1' })).r, 'bad-data');
    assert.equal((await X.onInbox(A, 'x1', { owner: E1, status: 'new', data: JSON.stringify(EXP()), parts: '13' })).r, 'parts');
    await X.run(A, { params: { id: 'x2' }, data: { data: () => { throw new Error('boom'); } } }); // run לא זורק
  });

  it('מקצה לקצה: inbox חדש ב-b/{bizId} → הטריגר באמולטור יוצר pinv', async (t) => {
    const FN = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
    try { await fetch(`http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN.host}:${FN.port}`}/`); } catch (e) { t.skip('אמולטור הפונקציות לא רץ'); return; }
    const s = await stage(`b/${A}/`, E1, EXP(), jpeg());
    await prep((d) => d.doc(`b/${A}/inbox/${s.id}`).set(s.doc));
    const pid = pidOf(s.id);
    let p = null;
    for (let i = 0; i < 60 && !p; i++) { await new Promise((z) => setTimeout(z, 500)); p = await get(`b/${A}/pinv/${pid}`); }
    assert.ok(p, 'pinv נוצר על ידי הטריגר');
    assert.equal(p.by, E1); assert.equal(p.src, 'worker');
  });
});
