'use strict';
// תרחיש קבוע (כניסה, הוצאה, שליחת מסמך מעובד, משימה, סגירת קופה) + קריאות מנהל.
// שימוש: node scenario.js <www-dir> <out.json> <variant>
//   variant: legacy-old (חוקים ישנים: users/b נחסמים), legacy-new (users חסר, b/largpeami במצב legacy), b (שני עסקים: acme, beta)
const fs = require('fs');
const H = require('./harness');

const BZ0 = ['larg', 'peami'].join('');
const VAR = {
  'legacy-old': { mode: 'old', admins: { '|m': 1 }, staff: { '|w': 1 } },
  'legacy-new': { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: { tasks: true, cashClose: true } } }, admins: { '|m': 1 }, staff: { '|w': 1 } },
  b: { mode: 'new', users: { ma: 'acme', wa: 'acme', mb: 'beta', wb: 'beta' }, biz: { acme: { dataRoot: 'b', features: { tasks: true, cashClose: true } }, beta: { dataRoot: 'b', features: { tasks: true, cashClose: true } } },
    admins: { 'b/acme/|ma': 1, 'b/beta/|mb': 1 }, staff: { 'b/acme/|wa': 1, 'b/beta/|wb': 1 } },
};

async function step(page, name, fn, arg) { page.__step = name; await page.evaluate(fn, arg); await H.settle(page, 1200); }

async function worker(browser, www, cfg, log, email) {
  const { ctx, page } = await H.newPage(browser, www, cfg, log, email);
  await H.login(page, email);
  // הוצאה מקופה (בלי צילום): chunks + inbox + cashout
  await step(page, 'expense', async () => { await pushItem({ id: 'wexp1', created: '2026-11-03T09:00:00.000Z', nopic: 1, data: { amt: '120', cat: 'c1', note: 'קניתי חלב', reg: 1, creg: 'i_yh', date: '2026-11-03', ctm: '08:55' } }); });
  // שליחת מסמך עם צילום
  await step(page, 'document', async () => { await fput('fdoc1', 'data:image/jpeg;base64,AAAA'); await pushItem({ id: 'wdoc1', created: '2026-11-03T09:01:00.000Z', fileId: 'fdoc1', data: { amt: '50', cat: 'c1' } }); });
  // משימה
  await step(page, 'task', async () => { const f = document.createElement('form'); f.innerHTML = '<input name="txt" value="לנקות את המדף"><button>שלח</button>'; document.body.append(f); await FRM.tkAdd(f); f.remove(); });
  // סגירת קופה: zlast + :commit עם docName
  await step(page, 'closing', async () => { try { await zcCommit('zc1', { uid: sv(SY.uid), by: sv(SY.uid), st: sv('new') }, 'i_yh', '2026-11-03', '09:02'); } catch (e) { console.warn(e.message); } });
  // הפקדה: :commit + :batchGet (deposits)
  await step(page, 'commit-batchget', async () => { try { await fsx(':batchGet', { method: 'POST', body: JSON.stringify({ documents: [docName('deposits/d1')] }) }); } catch (e) { console.warn(e.message); } });
  const errors = page.__errors; await ctx.close(); return errors;
}
async function manager(browser, www, cfg, log, email) {
  const { ctx, page } = await H.newPage(browser, www, cfg, log, email);
  await H.login(page, email);
  await step(page, 'pull', async () => { try { await pullInbox(); } catch (e) { console.warn(e.message); } });
  await step(page, 'backup-dir', async () => { window.__abk = abkDir(); });
  const dir = await page.evaluate(() => abkDir());
  const errors = page.__errors; await ctx.close(); return { errors, abkDir: dir };
}

(async () => {
  const [www, out, variant] = process.argv.slice(2);
  const cfg = VAR[variant]; const log = []; const browser = await H.launch();
  const res = { variant, errors: {} , abkDir: {} };
  const pairs = variant === 'b' ? [['ma@x.co', 'wa@x.co'], ['mb@x.co', 'wb@x.co']] : [['m@x.co', 'w@x.co']];
  for (const [m, w] of pairs) {
    const r = await manager(browser, www, cfg, log, m); res.errors[m] = r.errors; res.abkDir[m] = r.abkDir;
    res.errors[w] = await worker(browser, www, cfg, log, w);
  }
  await browser.close(); res.requests = log;
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(variant, 'requests:', log.length, 'errors:', JSON.stringify(res.errors));
})().catch((e) => { console.error(e); process.exit(1); });
