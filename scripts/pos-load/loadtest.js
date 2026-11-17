#!/usr/bin/env node
'use strict';
// בדיקת כפילות ובדיקת עומס לקופה – רק מול אמולטור Firestore מקומי (דרך run-emulator.sh).
// דורש שנתוני הדוגמה כבר נכתבו לאמולטור (gen-demo-data.js --seed-emulator).
//
// הבדיקות:
//   1. כפילות – אותה מכירה (אותו reqId) נשלחת פעמיים ברצף: מכירה אחת, אותו מספר, מלאי ירד פעם אחת.
//   2. כפילות במקביל – אותו reqId נשלח 5 פעמים בבת אחת: מכירה אחת בדיוק.
//   3א/3ב. 100 מכירות במקביל באותו סניף: מספרים 1..100 בדיוק – בלי חורים ובלי כפילויות (5 ניסיונות + שליחה חוזרת / 20 ניסיונות).
//   4. תור אופליין: 40 מכירות שנצברו במכשיר נשלחות בבת אחת, ואז כל התור נשלח שוב (אישור שאבד) – 40 מכירות, רצף מלא.
//   5. יום מלא (דחוס בזמן): כל מכירות הדוגמה של כל הסניפים, לפי זמני ההגעה – זמן לכל מכירה, קריאות וכתיבות.
//
// אפשרויות סביבה: POS_COMPRESS (ברירת מחדל 720: 12 שעות → דקה), POS_PAR (100), POS_MAX_ATTEMPTS (ברירת מחדל 5 של ה-SDK).
// התוצאות נכתבות ל-out/results.json (קלט ל-report.py).

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { db, P, target } = require('./lib/env');
const { client, counter } = require('./lib/pos-client');

const OUT = path.join(__dirname, 'out');
const COMPRESS = Number(process.env.POS_COMPRESS || 720);
const PAR = Number(process.env.POS_PAR || 100);
const MAXA = Number(process.env.POS_MAX_ATTEMPTS || 5);
const SEND_TIMEOUT = Number(process.env.POS_SEND_TIMEOUT_MS || 90000);
let send = null;
const SETTLE = Number(process.env.POS_SETTLE_MS || 15000);
const RUN = Date.now().toString(36); // תחילית ייחודית להרצה – אפשר להריץ שוב על אותו אמולטור
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const products = JSON.parse(fs.readFileSync(path.join(OUT, 'demo-products.json'), 'utf8'));
const sales = JSON.parse(fs.readFileSync(path.join(OUT, 'demo-sales.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'demo-meta.json'), 'utf8'));

const results = { run: RUN, at: new Date().toISOString(), target: null, impl: null, compress: COMPRESS, maxAttempts: MAXA, meta, tests: [], day: null, env: { node: process.version } };
let failed = 0;

function mkSale(br, i, extra = {}) {
  const p = products[(i * 37) % products.length];
  const v = p.variants[0];
  return Object.assign({ reqId: `t-${RUN}-${br}-${i}`, br, dev: br + '-pos1', lines: [{ pid: p.id, vid: v.vid, qty: 1, price: v.price }], pay: { m: 'cash', amt: v.price }, at: Date.now(), demo: true }, extra);
}

async function numbersOf(fdb, br) {
  const q = await fdb.collection(P('pos')).where('br', '==', br).select('no', 'reqId').get();
  return q.docs.map((d) => ({ no: d.get('no'), reqId: d.get('reqId') }));
}
function gapsAndDups(nums) {
  const s = nums.slice().sort((a, b) => a - b);
  const dups = s.filter((x, i) => i && x === s[i - 1]);
  const gaps = [];
  for (let i = 1; i <= (s[s.length - 1] || 0); i++) if (!s.includes(i)) gaps.push(i);
  return { min: s[0], max: s[s.length - 1], count: s.length, dups, gaps };
}

const ONLY = (process.env.POS_ONLY || '').split(',').filter(Boolean); // למשל POS_ONLY=1,5
async function test(name, fn) {
  if (ONLY.length && !ONLY.some((k) => name.startsWith(k))) return;
  const t0 = Date.now();
  const rec = { name, ok: false, ms: 0 };
  try { Object.assign(rec, await fn() || {}); rec.ok = true; } catch (e) { rec.err = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); failed++; }
  rec.ms = Date.now() - t0;
  results.tests.push(rec);
  // האמולטור משחרר נעילות של טרנזקציות שבוטלו רק אחרי תקרת זמן. בלי הפסקה, בדיקת עומס אחת "מורישה" נעילות לבאה אחריה.
  if (SETTLE) await sleep(SETTLE);
  console.log(`${rec.ok ? '✔' : '✘'} ${name} (${rec.ms}ms)${rec.err ? '\n    ' + rec.err : ''}`);
}

const pct = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

async function main() {
  const fdb = db();
  results.target = target();
  const c = await client(fdb);
  // שליחה עם תקרת זמן: שליחה שנתקעה נחשבת כישלון (המכשיר ישלח שוב עם אותו reqId), ולא תוקעת את הבדיקה
  send = (sale, ops, opt) => Promise.race([c.send(sale, ops, opt), sleep(SEND_TIMEOUT).then(() => { throw new Error(`timeout ${SEND_TIMEOUT}ms`); })]);
  results.impl = c.kind;
  console.log(`יעד: ${results.target.mode} (${results.target.project}), מימוש: ${c.kind}${c.kind === 'ref' ? ' – מימוש ייחוס, לא הפונקציה האמיתית' : ''}`);
  const seeded = await fdb.doc(P('poscfg/demo')).get();
  if (!seeded.exists) throw new Error('אין נתוני דוגמה באמולטור. הריצו קודם: node gen-demo-data.js --seed-emulator');

  await test('1. אותה מכירה נשלחת פעמיים ברצף → מכירה אחת', async () => {
    const br = `dup-${RUN}`;
    const s = mkSale(br, 1);
    const st = fdb.doc(P(`stock/${br}_${s.lines[0].pid}_${s.lines[0].vid}`));
    const a = await send(s, counter(), { maxAttempts: MAXA });
    const b = await send(s, counter(), { maxAttempts: MAXA });
    assert.equal(a.dup, false); assert.equal(b.dup, true);
    assert.equal(a.no, b.no); assert.equal(a.id, b.id);
    const n = await numbersOf(fdb, br);
    assert.equal(n.length, 1, 'נשמרו ' + n.length + ' מכירות');
    if (c.kind === 'ref') assert.equal((await st.get()).get('q'), -1, 'המלאי ירד יותר מפעם אחת');
    return { first: a, second: b };
  });

  await test('2. אותו reqId נשלח 5 פעמים במקביל → מכירה אחת בדיוק', async () => {
    const br = `dup5-${RUN}`;
    const s = mkSale(br, 1);
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () => send(s, counter(), { maxAttempts: MAXA })));
    const ok = rs.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    assert.ok(ok.length >= 1, 'אף שליחה לא הצליחה');
    assert.equal(new Set(ok.map((x) => x.no)).size, 1, 'מספרים שונים לאותה מכירה');
    assert.equal(ok.filter((x) => !x.dup).length, 1, 'יותר משליחה אחת יצרה מכירה');
    const n = await numbersOf(fdb, br);
    assert.equal(n.length, 1);
    return { sent: 5, fulfilled: ok.length, rejected: rs.length - ok.length };
  });

  // 3א: ברירת המחדל של ה-SDK (5 ניסיונות) + המכשיר שולח שוב מה שנדחה, עם אותו reqId והמתנה אקראית.
  // 3ב: הפונקציה עצמה מנסה עד 20 פעמים (המלצה לסשן ז') – בלי שליחה חוזרת מהמכשיר.
  for (const [tag, ma, resend] of [['3א', MAXA, true], ['3ב', 20, false]]) {
    await test(`${tag}. ${PAR} מכירות במקביל באותו סניף (${ma} ניסיונות${resend ? ' + שליחה חוזרת מהמכשיר' : ''}) → מספור 1..${PAR} בלי חורים`, async () => {
      const br = `par${ma}-${RUN}`;
      const lat = [];
      const opsAll = [];
      const t0 = Date.now();
      const rs = await Promise.allSettled(Array.from({ length: PAR }, async (_, i) => {
        const ops = counter(); const s0 = Date.now(); opsAll.push(ops);
        const r = await send(mkSale(br, i), ops, { maxAttempts: ma });
        lat.push(Date.now() - s0); return r;
      }));
      const wall = Date.now() - t0;
      const rejected = rs.filter((r) => r.status === 'rejected');
      let retried = 0; let rounds = 0;
      for (; resend && rounds < 10; rounds++) {
        const left = rs.map((r, i) => (r.status === 'rejected' ? i : -1)).filter((i) => i >= 0);
        if (!left.length) break;
        await Promise.all(left.map(async (i) => {
          await sleep(Math.random() * 3000); // פיזור – כמו מכשירים שמנסים שוב בזמנים שונים
          const ops = counter(); opsAll.push(ops);
          try { rs[i] = { status: 'fulfilled', value: await send(mkSale(br, i), ops, { maxAttempts: ma }) }; retried++; } catch (e) { rs[i] = { status: 'rejected', reason: e }; }
        }));
      }
      const still = rs.filter((r) => r.status === 'rejected').length;
      const n = await numbersOf(fdb, br);
      const g = gapsAndDups(n.map((x) => x.no));
      const rec = { maxAttemptsUsed: ma, wallMs: wall, totalMs: Date.now() - t0, rejectedFirstTry: rejected.length, firstErr: rejected[0] ? String(rejected[0].reason).slice(0, 160) : null, retriedOk: retried, resendRounds: rounds,
        latMs: { p50: pct(lat, 50), p95: pct(lat, 95), max: pct(lat, 100) },
        attempts: { total: opsAll.reduce((a, o) => a + o.attempts, 0), max: Math.max(0, ...opsAll.map((o) => o.attempts)) },
        readsInclRetries: opsAll.reduce((a, o) => a + o.reads, 0), numbers: g };
      assert.equal(still, 0, `${still} מכירות לא נשמרו (${rec.firstErr})`);
      assert.equal(g.count, PAR); assert.equal(g.min, 1); assert.equal(g.max, PAR);
      assert.deepEqual(g.dups, []); assert.deepEqual(g.gaps, []);
      return rec;
    });
  }

  await test('4. תור אופליין: 40 מכירות בבת אחת, ואז כל התור נשלח שוב → 40 מכירות, רצף מלא', async () => {
    const br = `off-${RUN}`;
    const q = Array.from({ length: 40 }, (_, i) => mkSale(br, i, { at: Date.now() - (40 - i) * 60e3 }));
    const sendAll = async () => {
      const rs = await Promise.allSettled(q.map((s) => send(s, counter(), { maxAttempts: MAXA })));
      return rs;
    };
    let r1 = await sendAll();
    for (let k = 0; k < 5 && r1.some((r) => r.status === 'rejected'); k++) r1 = await sendAll(); // מה שנכשל – נשלח שוב (גם מה שהצליח, כמו מכשיר שלא קיבל אישור)
    const r2 = await sendAll(); // כל התור שוב
    assert.ok(r2.every((r) => r.status === 'fulfilled' && r.value.dup === true), 'שליחה חוזרת יצרה מכירה חדשה או נכשלה');
    const n = await numbersOf(fdb, br);
    const g = gapsAndDups(n.map((x) => x.no));
    assert.equal(g.count, 40); assert.deepEqual(g.gaps, []); assert.deepEqual(g.dups, []);
    return { numbers: g };
  });

  await test(`5. יום מלא דחוס ×${COMPRESS}: ${sales.length} מכירות ב-${meta.counts.branches} סניפים`, async () => {
    const t0 = sales[0].at;
    const start = Date.now();
    const per = [];
    let errs = 0; let resends = 0; let firstErr = null;
    const brOf = (b) => `${b}-${RUN}`; // סניף נפרד להרצה – המונה מתחיל מ-1
    // כל קופה (dev) שולחת את התור שלה לפי הסדר – מכירה אחת בכל רגע, כמו תור אופליין במכשיר.
    // כך המקביליות בסניף = מספר הקופות בו (2), ולא כל מכירה לחוד. qMs = כמה המכירה חיכתה בתור המכשיר.
    const byDev = new Map();
    for (const s of sales) { if (!byDev.has(s.dev)) byDev.set(s.dev, []); byDev.get(s.dev).push(s); }
    await Promise.all(Array.from(byDev.values()).map(async (queue) => {
      for (const s of queue) {
        const due = (s.at - t0) / COMPRESS;
        const wait = due - (Date.now() - start);
        if (wait > 0) await sleep(wait);
        const qMs = Math.max(0, Date.now() - start - due);
        const sale = Object.assign({}, s, { reqId: `${s.reqId}-${RUN}`, br: brOf(s.br) });
        for (let k = 0; k < 5; k++) { // נדחתה (עומס) – אותה מכירה נשלחת שוב עם אותו reqId
          const ops = counter(); const s0 = Date.now();
          try {
            const r = await send(sale, ops, { maxAttempts: MAXA });
            per.push({ br: s.br, dev: s.dev, hour: s.hour, lines: s.lines.length, ms: Date.now() - s0, qMs: Math.round(qMs), resend: k, reads: ops.reads, writes: ops.writes, attempts: ops.attempts, dup: r.dup });
            break;
          } catch (e) { firstErr = firstErr || String(e).slice(0, 160); if (k === 4) errs++; else resends++; }
        }
      }
    }));
    const wall = Date.now() - start;
    const gaps = {};
    for (const b of new Set(sales.map((s) => s.br))) gaps[b] = gapsAndDups((await numbersOf(fdb, brOf(b))).map((x) => x.no));
    results.day = { wallMs: wall, sales: per, errors: errs, resends, devices: byDev.size, firstErr, numbers: gaps, measuresOps: c.measuresOps };
    assert.equal(errs, 0, `${errs} מכירות נכשלו: ${firstErr}`);
    for (const [b, g] of Object.entries(gaps)) { assert.deepEqual(g.gaps, [], 'חורים בסניף ' + b); assert.deepEqual(g.dups, [], 'כפילות בסניף ' + b); }
    const ms = per.map((x) => x.ms);
    const qs = per.map((x) => x.qMs);
    return { wallMs: wall, devices: byDev.size, resends, firstErr, latMs: { p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: pct(ms, 100) }, queueMs: { p50: pct(qs, 50), p95: pct(qs, 95), max: pct(qs, 100) } };
  });

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results));
  console.log(`\n==== סיכום: ${results.tests.length - failed} עברו, ${failed} נכשלו ==== (out/results.json)`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
