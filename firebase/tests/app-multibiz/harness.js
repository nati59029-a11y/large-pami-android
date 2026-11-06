'use strict';
// ריבוי עסקים, שלב 3: הרצת האפליקציה (www/) בדפדפן עם רשת מדומה, ותיעוד כל בקשה (שיטה, כתובת, גוף).
// לא נוגע באינטרנט ולא בפרויקט אמיתי: כל בקשה נענית כאן. דורש playwright (גלובלי) ו-google-chrome.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 8491; // כתובת מדומה בלבד (לא נפתח שרת), כדי שהאפליקציה תיכנס למצב emu=1
const ORIGIN = `http://127.0.0.1:${PORT}`;
const T0 = Date.UTC(2026, 10, 3, 9, 0, 0);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp' };

const doc = (name, fields) => ({ name, fields: fields || {}, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const S = (v) => ({ stringValue: v });

// cfg: { mode: 'old'|'new', users: {uid: bizId}, biz: {bizId: {dataRoot, status, features}}, admins: {'<prefix>|uid':1}, staff: {...}, sa: {uid:1} }
function firestoreReply(cfg, method, p, body) {
  const m = p.match(/\/documents(.*)$/); const rest = m ? m[1] : '';
  if (/:runQuery$/.test(rest)) { // cfg.betaDocs: כל שאילתה בעסק beta מחזירה מסמך עם סימון MARKER-BETA (לבדיקת ערבוב)
    if (cfg.betaDocs && /^\/b\/beta:/.test(rest)) { let c = 'x'; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      const F = { note: S('MARKER-BETA'), txt: S('MARKER-BETA'), text: S('MARKER-BETA'), why: S('MARKER-BETA'), owner: S('sa'), by: S('sa'), role: S('a'), st: S('open'), open: S('1'), d: S('2026-11-03'), reg: S('i_yh'), a: { integerValue: '5' }, t: { integerValue: '1793700000000' }, cr: { integerValue: '1793700000000' }, due: { integerValue: '1793900000000' } };
      return [200, [{ document: doc('projects/demo-largpeami/databases/(default)/documents/b/beta/' + c + '/mbx1', F), readTime: '2026-11-03T09:00:00Z' }]]; }
    return [200, [{ readTime: '2026-11-03T09:00:00Z' }]]; }
  if (rest === ':batchGet') return [200, []];
  if (rest === ':commit') return [200, { writeResults: [], commitTime: '2026-11-03T09:00:00Z' }];
  const segs = rest.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  if (method === 'GET') {
    if (segs[0] === 'users' && segs.length === 2) { if (cfg.mode === 'old') return [403, { error: { code: 403, message: 'PERMISSION_DENIED', status: 'PERMISSION_DENIED' } }]; const b = (cfg.users || {})[segs[1]]; return b ? [200, doc(p, { bizId: S(b), role: S('admin') })] : [404, { error: { code: 404, message: 'NOT_FOUND' } }]; }
    if (segs[0] === 'superadmins' && segs.length === 2) { if (cfg.mode === 'old') return [403, { error: { code: 403, message: 'PERMISSION_DENIED' } }]; return (cfg.sa || {})[segs[1]] ? [200, doc(p)] : [404, { error: { code: 404, message: 'NOT_FOUND' } }]; }
    if (segs[0] === 'b' && segs.length === 2) {
      if (cfg.mode === 'old') return [403, { error: { code: 403, message: 'PERMISSION_DENIED' } }];
      const d = (cfg.biz || {})[segs[1]]; if (!d) return [404, { error: { code: 404, message: 'NOT_FOUND' } }];
      const ft = { mapValue: { fields: Object.fromEntries(Object.entries(d.features || {}).map(([k, v]) => [k, { booleanValue: v }])) } };
      return [200, doc(p, { dataRoot: S(d.dataRoot), status: S(d.status || 'active'), name: S(d.name || segs[1]), features: ft, brand: { mapValue: { fields: { name: S(d.name || segs[1]) } } } })];
    }
    const pre = segs[0] === 'b' ? 'b/' + segs[1] + '/' : ''; const s2 = segs[0] === 'b' ? segs.slice(2) : segs;
    if (s2[0] === 'admins' && s2.length === 2) return (cfg.admins || {})[pre + '|' + s2[1]] ? [200, doc(p)] : [404, { error: { code: 404, message: 'NOT_FOUND' } }];
    if (s2[0] === 'staff' && s2.length === 2) return (cfg.staff || {})[pre + '|' + s2[1]] ? [200, doc(p, { active: { booleanValue: true } })] : [404, { error: { code: 404, message: 'NOT_FOUND' } }];
    return [404, { error: { code: 404, message: 'NOT_FOUND' } }];
  }
  if (method === 'DELETE') return [200, {}];
  let f = {}; try { f = JSON.parse(body || '{}').fields || {}; } catch (e) { /* */ }
  return [200, doc(p, f)];
}

async function newPage(browser, www, cfg, log, label) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const page = await ctx.newPage();
  page.__errors = []; page.__gen = 0; page.__cfg = cfg;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) page.__gen++; }); // דור הדף: כל טעינה מחדש = דף חדש
  page.on('pageerror', (e) => page.__errors.push(String(e && e.message || e)));
  if (!cfg.fwd) await page.clock.setFixedTime(T0); // מול האמולטור: זמן אמיתי (החוקים בודקים חותמת זמן)
  await page.addInitScript(() => {
    let s = 12345; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
    const g = crypto.getRandomValues.bind(crypto); crypto.getRandomValues = (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; }; void g;
  });
  await ctx.route('**/*', async (route) => {
    const req = route.request(); const u = new URL(req.url()); const method = req.method();
    if (u.origin === ORIGIN) {
      const f = path.join(www, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
      if (f.startsWith(www) && fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      return route.fulfill({ status: 404, body: '' });
    }
    const body = req.postData();
    const rec = { who: label, step: page.__step || 'boot', gen: page.__gen, method, url: u.href, body: body || '' }; log.push(rec);
    if (cfg.fwd && cfg.fwd[u.port]) { // העברה לאמולטור האמיתי בפורט של הסוכן הזה
      const t = new URL(u.href); t.port = String(cfg.fwd[u.port]);
      try { const resp = await route.fetch({ url: t.href }); rec.status = resp.status(); return route.fulfill({ response: resp }); } catch (e) { rec.status = 'ERR ' + e.message; return route.abort(); }
    }
    if (u.port === '9099' && /signInWithPassword/.test(u.pathname)) {
      const j = JSON.parse(body); const uid = j.email.split('@')[0];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ idToken: 'tok-' + uid, refreshToken: 'r-' + uid, expiresIn: '3600', localId: uid, email: j.email }) });
    }
    if (u.port === '9099') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id_token: 'tok-x', refresh_token: 'r-x', expires_in: '3600' }) });
    if (u.port === '8080' && cfg.delay && cfg.delay.test(u.pathname)) await new Promise((r) => setTimeout(r, cfg.delayMs || 4000)); // תגובה מעוכבת (רשת איטית)
    if (u.port === '8080') { const [st, js] = firestoreReply(cfg, method, u.pathname + u.search, body); return route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(js) }); }
    if (u.port === '5001') { if (/getBackupKey/.test(u.pathname)) await new Promise((r) => setTimeout(r, cfg.keyDelay || 0));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: /getBackupKey/.test(u.pathname) ? { key: Buffer.alloc(32, 7).toString('base64') } : {} }) }); }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  return { ctx, page };
}

// 6ג-2: בדפדפן, מנהל ומנהל־על במחשב חדש צריכים גם קישור כניסה במייל. כאן מדמים "מחשב מוכר" (lp-trust עם ה-uid של החשבון),
// כדי שהבדיקות הקיימות יבדקו את מה שהן בודקות. השלב הנוסף עצמו נבדק ב-ui-e2e.js (opts.trust=false). ב-main המפתח לא בשימוש.
async function trustUid(page, email) {
  const fwd = page.__cfg && page.__cfg.fwd;
  if (!fwd) return email.split('@')[0]; // רשת מדומה: ה-uid הוא החלק שלפני @
  try { const r = await fetch(`http://127.0.0.1:${fwd[9099]}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }) }); return (await r.json()).localId || ''; } catch (e) { return ''; }
}
async function login(page, email, opts) {
  await page.goto(ORIGIN + '/?emu=1');
  await page.waitForSelector('#gform', { timeout: 15000 });
  if (!(opts && opts.trust === false)) { const u = await trustUid(page, email); if (u) await page.evaluate((x) => localStorage.setItem('lp-trust', JSON.stringify({ uid: x, exp: Date.now() + 864e5 })), u); }
  await page.fill('#gform input[name=email]', email);
  await page.fill('#gform input[name=pw]', (opts && opts.pw) || 'pw-123456');
  page.__step = 'login';
  await Promise.all([page.waitForLoadState('load'), page.click('#gbtn')]);
  await settle(page);
}
const settle = async (page, ms) => { await page.waitForTimeout(ms || 2500); };

function launch() { return chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }); }

module.exports = { launch, newPage, login, settle, ORIGIN, T0 };
