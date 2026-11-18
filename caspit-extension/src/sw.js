// תוסף כספית – service worker: תזמון, ריצת סנכרון (מכונת מצבים שממשיכה אחרי הפסקה), מצב היכרות, והודעות מהחלון הקופץ.
// כל הבקשות לכספית רצות בתוך לשונית ייעודית של התוסף (מוצמדת, לא פעילה) – לא בלשונית של בעל העסק, ולא מהשרת.
// התוסף לעולם לא ממלא שם משתמש או סיסמה: אם כספית מבקשת התחברות – מדווחים "צריך התחברות" ומנסים שוב בבדיקה הבאה.
importScripts('config.js', 'lib/caspit-core.js', 'lib/xlsx.full.min.js', 'lib/days.js', 'lib/plan.js', 'lib/sanitize.js', 'lib/util.js', 'lib/api.js');
const P = self.CxPlan, D = self.CxDays, U = self.CxUtil, S = self.CxSanitize, C = self.CaspitCore, A = self.CxApi;
const VER = chrome.runtime.getManifest().version;
const CASPIT = 'https://caspit.valu.co.il/';
const CASPIT_APP = CASPIT + 'bo';
// שמירה (בעל העסק, 18.11): התוסף פועל רק במשרד האחורי (/bo). קופת המכירה (שורש האתר ושאר הנתיבים) – אסור לגעת:
// לפני כל צעד בודקים את כתובת הלשונית (וגם בתוך הדף – runSteps guard); אחרת עוצרים מיד ב-'wrong-page' (בלי ניסיון חוזר).
const BO_RE = /^https:\/\/caspit\.valu\.co\.il\/bo(?:[/?#]|$)/;
const GUARD = { origin: 'https://caspit.valu.co.il', path: '/bo' };
const HASH_RE = /^#\/[\w\-/?=&.%]*$/; // מערכת הניהול של כספית נמצאת ב-/bo (נבדק מול צילום מסך של בעל העסק, 18.11) – בכתובת אחרת האתר נתקע ב"טוען תוכנה"
const START_DELAY_MIN = 2; // המתנה אחרי הפעלה/התעוררות לפני ריצה (רשת, Chrome)
const TICK_MIN = 15;
const POLL_MIN = 1, POLL_SLOW_MIN = 15; // "סנכרן עכשיו" מהטלפון: בדיקה כל דקה (שרת ישן בלי poll – כל 15 דקות)

// האסימון ב-storage.local: מגבילים את האחסון להקשרים של התוסף בלבד (לא לסקריפטי התוכן בלשונית כספית), אם הדפדפן תומך
// (setAccessLevel נתמך בוודאות ב-storage.session; ב-local – לא מאומת, ולכן בניסיון בלבד). סקריפטי התוכן (bridge.js, selectors.js) לא קוראים אחסון בכלל.
for (const a of ['local', 'session']) { try { const p = chrome.storage[a].setAccessLevel && chrome.storage[a].setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* לא נתמך */ } }
const get = (k) => chrome.storage.local.get(k).then((o) => o[k]);
const set = (o) => chrome.storage.local.set(o);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let SEL = null;
async function sel() { if (!SEL) SEL = await (await fetch(chrome.runtime.getURL('selectors.json'))).json(); return SEL; }
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
async function api() {
  const token = await get('token');
  return A.client({ url: self.CX_CFG.api, token, ver: VER });
}

// ---------- תזמון ----------
async function sched() {
  const s = (await get('sched')) || {};
  return { at: /^\d{2}:\d{2}$/.test(s.at || '') ? s.at : D.AT, tz: typeof s.tz === 'string' && s.tz ? s.tz : D.TZ };
}
async function setupAlarms() {
  const s = await sched();
  await chrome.alarms.create('daily', { when: D.nextAt(Date.now(), s.at, s.tz) }); // נוצר מחדש אחרי כל הפעלה – נכון גם במעבר שעון
  if (!(await chrome.alarms.get('tick'))) await chrome.alarms.create('tick', { periodInMinutes: TICK_MIN, delayInMinutes: 1 });
  if (!(await chrome.alarms.get('poll'))) await chrome.alarms.create('poll', { periodInMinutes: POLL_MIN, delayInMinutes: POLL_MIN });
}
chrome.runtime.onInstalled.addListener(() => { setupAlarms(); trigger('install'); });
chrome.runtime.onStartup.addListener(() => { setupAlarms(); trigger('startup'); });
if (chrome.idle && chrome.idle.onStateChanged) chrome.idle.onStateChanged.addListener((s) => { if (s === 'active') trigger('idle'); });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'daily') { setupAlarms(); trigger('daily'); }
  else if (a.name === 'tick') tick().catch(() => {});
  else if (a.name === 'start') startAuto().catch(() => {});
  else if (a.name === 'retry') resume().catch(() => {});
  else if (a.name === 'poll') pollOnce().catch(() => {});
});
// "סנכרן עכשיו" מהטלפון: שואלים את השרת אם יש בקשה (בלי לפתוח את כספית). רק כשמחוברים, יש רשת ואין ריצה.
// שרת ישן (bad-op) → בדיקה כל 15 דקות, בלי להציג תקלה. החיבור בוטל (auth) → מפסיקים לבדוק עד חיבור מחדש / הפעלה של Chrome.
async function pollEvery(min) {
  const a = await chrome.alarms.get('poll');
  if (!a || a.periodInMinutes !== min) await chrome.alarms.create('poll', { periodInMinutes: min, delayInMinutes: min });
}
async function pollOnce() {
  if (busy || !navigator.onLine || !(await get('token'))) return null;
  let r;
  // ריצה שממתינה לניסיון חוזר: מדווחים מתי (wait) – הטלפון מציג "ינסה שוב ב-HH:MM" ולא "לא הגיב"
  const run0 = await get('run');
  const wait = run0 && run0.st === 'wait' && !P.isTerminal(run0) && +run0.retryAt > 0 ? +run0.retryAt : 0;
  try { r = await (await api()).call('poll', wait ? { wait } : {}); } catch (e) {
    // שרת ישן (bad-op) / העסק כבוי זמנית (403) → כל 15 דקות; האסימון בוטל (401) → מפסיקים עד חיבור מחדש / הפעלת Chrome
    if (e.code === 'bad-op' || (e.code === 'auth' && e.status === 403)) await pollEvery(POLL_SLOW_MIN);
    else if (e.code === 'auth') await chrome.alarms.clear('poll');
    return null; // רשת / שרת – הבדיקה הבאה תנסה שוב
  }
  await pollEvery(POLL_MIN);
  const [run, lastReq] = await Promise.all([get('run'), get('lastReq')]);
  const id = P.wantRemote(r, { busy, run, lastReq, now: Date.now() });
  if (!id || busy) return null; // עסוק – לא מסמנים את הבקשה; הבדיקה הבאה תיקח אותה
  const p = startRun({ manual: true, req: id }); // לוקח את הנעילה מיד (בלי await לפני כן)
  await set({ lastReq: id }); // גם אם ה-service worker נסגר באמצע – לא מתחילים פעמיים לאותה בקשה
  p.catch(() => {});
  return id;
}
async function tick() {
  if (!(await chrome.alarms.get('daily'))) await setupAlarms();
  const run = await get('run');
  if (P.canResume(run, Date.now())) return resume();
  return trigger('tick');
}
// בדיקה: צריך להריץ? אם כן – מתחילים בעוד 2 דקות (alarm 'start')
async function trigger(src) {
  if (!(await get('token')) || busy) return false;
  const run = await get('run');
  if (run && !P.isTerminal(run) && Date.now() - (run.touchedAt || 0) < P.STALE_MS) return false;
  const s = await sched(), st = (await get('st')) || {};
  if (!D.isDue(Date.now(), s.at, st.lastOkDay, s.tz)) return false;
  if (blockedSlot(st, s)) return false;
  if (await chrome.alarms.get('start')) return false;
  await chrome.alarms.create('start', { delayInMinutes: START_DELAY_MIN });
  await set({ st: Object.assign(st, { lastTrigger: { src, at: Date.now() } }) });
  return true;
}
// כישלון שאינו זמני (כפתור לא נמצא, מגבלה, גרסה…) – לא מנסים שוב אוטומטית עד מועד הסנכרון הבא (הודעה כבר נשלחה למנהל)
function blockedSlot(st, s) {
  const L = st.lastRun;
  return !!(L && L.st === 'fail' && !P.RETRY.has(L.code) && st.failSlot && st.failSlot === D.slotDay(Date.now(), s.at, s.tz));
}
// אחרי "צריך התחברות": בודקים בלשונית שלנו (טעינה מחדש, בלי לפנות לשרת) אם בעל העסק כבר התחבר
async function loggedInNow() {
  const tab = await ownTab(false);
  await chrome.tabs.reload(tab);
  await waitLoaded(tab);
  await ensurePage(tab);
  return !(await isLoginTab(tab));
}
async function startAuto() {
  if (!navigator.onLine || busy) return; // הבדיקה הבאה (15 דקות) תנסה שוב
  const s = await sched(), st = (await get('st')) || {};
  if (!D.isDue(Date.now(), s.at, st.lastOkDay, s.tz) || blockedSlot(st, s)) return;
  if (st.lastRun && st.lastRun.st === 'needs-login' && !(await loggedInNow().catch(() => false))) return;
  return startRun({ manual: false });
}

// ---------- נעילה: ריצה אחת בכל רגע (ב-service worker יש מופע אחד בלבד) ----------
let busy = false;
let keepTimer = null;
function keepAlive(on) {
  if (on && !keepTimer) keepTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20e3);
  if (!on && keepTimer) { clearInterval(keepTimer); keepTimer = null; }
}

// ---------- לשונית כספית של התוסף ----------
async function ownTab(active) {
  const id = (await chrome.storage.session.get('tab')).tab;
  if (id) {
    try {
      const t = await chrome.tabs.get(id);
      if (t && BO_RE.test(String(t.url || t.pendingUrl || ''))) { if (active) await chrome.tabs.update(id, { active: true }); return t.id; }
    } catch (e) { /* הלשונית נסגרה */ }
  }
  const S0 = await sel();
  const t = await chrome.tabs.create({ url: CASPIT_APP + (S0.start || ''), pinned: true, active: !!active });
  await chrome.storage.session.set({ tab: t.id });
  await waitLoaded(t.id);
  await ensurePage(t.id);
  return t.id;
}
// דף שגיאה (למשל הרשת עוד לא עלתה אחרי התעוררות) → טוענים מחדש עד פעמיים, אחרת "אין רשת" (ניסיון חוזר)
async function ensurePage(tabId) {
  for (let i = 0; ; i++) {
    try { await chrome.scripting.executeScript({ target: { tabId }, func: () => 1 }); return; } catch (e) {
      if (!/error page/i.test(String(e && e.message)) || i >= 2) throw P.err('network', 'כספית לא נטענה – אין חיבור?');
    }
    await sleep(3000);
    await chrome.tabs.reload(tabId);
    await waitLoaded(tabId);
  }
}
async function waitLoaded(tabId, ms) {
  const end = Date.now() + (ms || 60e3);
  for (;;) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw P.err('selector-miss', 'הלשונית של כספית נסגרה');
    if (t.status === 'complete') break;
    if (Date.now() > end) throw P.err('timeout', 'כספית לא נטענה בזמן');
    await sleep(500);
  }
  await sleep(1500);
}
async function inIso(tabId, func, args) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/selectors.js'] });
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
  return r && r.result;
}
async function inMain(tabId, func, args) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args: args || [] });
  return r && r.result;
}
const peekIn = (p, guard) => (self.CxSel.onPath(window, guard) ? self.CxSel.peek(document, p, { win: window, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }) : { wrong: true });
const runFlowIn = (steps, vars, files, probe, guard) => self.CxSel.runSteps(steps, { doc: document, win: window, vars, files, probe, guard });
const wrongPage = () => P.err('wrong-page');
async function onBo(tabId) { const t = await chrome.tabs.get(tabId).catch(() => null); return !!t && BO_RE.test(String(t.url || '')) && !t.pendingUrl; }
async function guardBo(tabId) { if (!(await onBo(tabId))) throw wrongPage(); }
// מעבר מסך: תמיד בכתובת מלאה https://caspit.valu.co.il/bo#/<מסך> (tabs.update), ורק מלשונית שכבר במשרד האחורי
async function navTo(tabId, hash, fresh, ms) {
  if (!HASH_RE.test(String(hash || ''))) return false;
  await guardBo(tabId);
  const cur = String(((await chrome.tabs.get(tabId)) || {}).url || '');
  if (fresh && cur.endsWith(hash)) { await chrome.tabs.update(tabId, { url: CASPIT_APP + '#/' }); await sleep(ms || 1500); await guardBo(tabId); }
  await chrome.tabs.update(tabId, { url: CASPIT_APP + hash });
  const end = Date.now() + 30e3;
  for (;;) { const t = await chrome.tabs.get(tabId).catch(() => null); if (!t || t.status === 'complete' || Date.now() > end) break; await sleep(300); }
  await sleep(ms || 1500);
  await guardBo(tabId);
  return true;
}
// הצעדים רצים בדף בחלקים בין מעברי מסך (nav – מכאן, בכתובת מלאה); לפני כל חלק ואחרי הכול – בדיקת /bo
async function runFlow(tabId, name, vars, files, probe) {
  const steps = ((await sel()).flows || {})[name];
  if (!Array.isArray(steps)) throw P.err('selector-miss', 'אין הגדרה למסך ' + name);
  const out = { ok: true, steps: [], miss: null, text: '' };
  for (let i = 0; i < steps.length;) {
    const s = steps[i] || {};
    if (s.op === 'nav') {
      const ok = await navTo(tabId, s.hash, !!s.fresh, s.ms);
      out.steps.push({ i, op: 'nav', found: ok, done: ok });
      if (!ok) { out.ok = false; if (out.miss == null) out.miss = i; if (!probe) return out; }
      i++; continue;
    }
    let j = i;
    while (j < steps.length && (steps[j] || {}).op !== 'nav') j++;
    await guardBo(tabId);
    const r = await inIso(tabId, runFlowIn, [steps.slice(i, j), vars || {}, files || null, !!probe, GUARD]);
    if (!r) { out.ok = false; if (out.miss == null) out.miss = i; return out; }
    for (const x of r.steps || []) out.steps.push(Object.assign(x, { i: x.i + i }));
    if (r.text) out.text = r.text;
    if (r.wrong) throw wrongPage();
    if (r.code) out.code = r.code;
    if (r.hmax !== undefined) out.hmax = r.hmax;
    if (r.already) { out.already = r.already; return out; }
    if (!r.ok) { out.ok = false; if (out.miss == null && r.miss != null) out.miss = r.miss + i; if (!probe) return out; }
    i = j;
  }
  await guardBo(tabId);
  return out;
}
async function isLoginTab(tabId) {
  const L = (await sel()).login || {};
  return inIso(tabId, (cfg) => self.CxSel.isLogin(document, window, cfg), [L]);
}
// כספית היא אפליקציית דף אחד שמציירת את המסך אחרי הטעינה (במחשב איטי / רשת איטית – כמה שניות). מחכים עד שרואים
// דף התחברות או את המערכת המחוברת (login.shell), עד ms. בדיקה שנכשלה באמצע ניווט – ננסה שוב בסבב הבא. → { login, shell } או {} אם לא הוכרע
async function loginState(tabId, ms) {
  const L = (await sel()).login || {};
  const end = Date.now() + (ms || 20e3);
  for (;;) {
    const r = await inIso(tabId, (cfg) => ({ login: self.CxSel.isLogin(document, window, cfg), shell: !!(cfg.shell && self.CxSel.find(document, cfg.shell)) }), [L]).catch(() => null);
    if (r && (r.login || r.shell)) return r;
    if (Date.now() > end) return r || {};
    await sleep(1000);
  }
}

// ---------- תפיסת קובץ שכספית מורידה ----------
const waiting = new Map();
function waitFile(nonce, tabId, ms) {
  return new Promise((resolve, reject) => {
    const tm = setTimeout(() => { waiting.delete(nonce); reject(P.err('timeout', 'הקובץ מכספית לא הגיע בזמן')); }, ms);
    waiting.set(nonce, { tabId, resolve: (v) => { clearTimeout(tm); waiting.delete(nonce); resolve(v); } });
  });
}
async function arm(tabId, nonce) {
  await inMain(tabId, (n) => !!(window.__cxHook && window.__cxHook.arm(n)), [nonce]);
  await chrome.tabs.sendMessage(tabId, { t: 'cx-arm', nonce });
}
async function disarm(tabId) {
  await inMain(tabId, () => window.__cxHook && window.__cxHook.disarm()).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { t: 'cx-disarm' }).catch(() => {});
}
const missErr = (name, r) => P.err('selector-miss', `לא נמצא רכיב במסך "${name}" (צעד ${(r.miss || 0) + 1})`, { miss: r.steps && r.steps[r.miss] });
// קובץ מכספית: קודם נקודת קצה (אם הוגדרה), ואם אין או נכשלה – דרך המסך
async function capture(tabId, name, vars, ms) {
  await guardBo(tabId);
  const ep = ((await sel()).endpoints || {})[name];
  if (ep && ep.pathTemplate) {
    const r = await inMain(tabId, (e, v) => window.__cxHook && window.__cxHook.call(e, v), [ep, vars]).catch(() => null);
    if (r && (r.st === 401 || r.st === 403)) throw P.err('needs-login');
    if (r && r.b64) return { name: r.name || name, mime: r.ct, bytes: U.fromB64(r.b64), via: 'endpoint' };
  }
  const nonce = U.rid('n') + U.rid('');
  const got = waitFile(nonce, tabId, ms);
  got.catch(() => {});
  await arm(tabId, nonce);
  try {
    const r = await runFlow(tabId, name, vars, null, false);
    if (!r || !r.ok) { if (await isLoginTab(tabId).catch(() => false)) throw P.err('needs-login'); throw missErr(name, r || {}); }
    const f = await got;
    return { name: f.name, mime: f.mime, bytes: U.fromB64(f.b64), via: f.via };
  } finally {
    waiting.delete(nonce);
    await disarm(tabId);
  }
}
function rowsOf(f) {
  try { return U.readRows(f.bytes, f.name, self.XLSX, C); } catch (e) { throw P.err('endpoint-changed', 'לא הצלחנו לקרוא את הקובץ מכספית'); }
}

// ---------- שלבי הריצה ----------
const STEP = {
  async hello(run) {
    // העלאה לכספית (פריטים חדשים / מחירים) כבויה עד שנדע בוודאות איך מסך הייבוא מעלה קובץ – בלי export לשרת (לא מסמנים pd) ובלי ייבוא
    if ((await sel()).importEnabled !== true) run.flags.noImp = true;
    const cl = await api(), body = Object.assign({ mode: run.mode, manual: run.manual }, run.req ? { req: run.req } : {});
    let r;
    try { r = await cl.call('hello', body); } catch (e) {
      // ניסיון חוזר אחרי שהבקשה כבר נלקחה (התשובה הקודמת לא הגיעה) – ממשיכים כסנכרון ידני רגיל
      if (e.code !== 'req-gone' || !run.attempt) throw e;
      run.req = null; delete body.req;
      r = await cl.call('hello', body);
    }
    if (r.minVer && cmpVer(VER, r.minVer) < 0) throw P.err('min-ver');
    if (r.enabled === false && !run.manual) throw P.err('disabled');
    if (r.schedule && typeof r.schedule === 'object') {
      const old = await sched();
      const nw = { at: /^\d{2}:\d{2}$/.test(r.schedule.at || '') ? r.schedule.at : old.at, tz: typeof r.schedule.tz === 'string' ? r.schedule.tz.slice(0, 40) : old.tz };
      try { D.dayStr(Date.now(), nw.tz); } catch (e) { nw.tz = old.tz; }
      if (nw.at !== old.at || nw.tz !== old.tz) { await set({ sched: nw }); await setupAlarms(); }
    }
    const s = await sched(), today = D.dayStr(Date.now(), s.tz);
    run.days = D.safeDays(Array.isArray(r.days) ? r.days : D.daysToFetch(r.lastSales, today), today);
    const L = r.limits || {};
    run.limits = { price: Math.min(U.LIMITS.price, +L.price > 0 ? +L.price : U.LIMITS.price), newMax: Math.min(U.LIMITS.newMax, Number.isFinite(+L.newMax) && L.newMax != null ? Math.max(0, +L.newMax) : U.LIMITS.newMax) };
    run.srv = typeof r.runId === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(r.runId) ? r.runId : run.id;
    await set({ biz: { name: String((r.biz && r.biz.name) || '').slice(0, 60) } });
    return { days: run.days.length };
  },
  async login(run) {
    const tab = await ownTab(false);
    await waitLoaded(tab);
    await ensurePage(tab);
    // לא במשרד האחורי (למשל כספית העבירה לקופה): דף התחברות → "צריך התחברות"; אחרת עוצרים בלי לגעת
    if (!(await onBo(tab))) { if ((await loginState(tab, 10e3)).login) throw P.err('needs-login'); throw wrongPage(); }
    const ok = await chrome.tabs.sendMessage(tab, { t: 'cx-ping' }).catch(() => null);
    // דף התחברות או לשונית בלי הגשר → טוענים מחדש פעם אחת (אולי בעל העסק כבר התחבר בלשונית אחרת).
    // מחכים שהמסך יצויר (loginState) – בדיקה מיידית במחשב איטי ראתה דף ריק והמשיכה כאילו מחוברים
    if (!ok || (await loginState(tab)).login) { await chrome.tabs.reload(tab); await waitLoaded(tab); await ensurePage(tab); if ((await loginState(tab)).login) throw P.err('needs-login'); await guardBo(tab); }
    run.tab = tab;
    return {};
  },
  async catalog(run) {
    const tab = await ownTab(false);
    const f = await capture(tab, 'catalog', {}, 600e3); // כספית מפיקה את הקובץ כ"משימה" (job) – בקטלוג גדול זה לוקח זמן
    const rows = rowsOf(f), det = C.detect(rows);
    if (det.kind !== 'cat') throw P.err('endpoint-changed', 'הקובץ שהתקבל אינו "קטלוג פריטים"');
    const g = C.groupCat(rows, det), parts = C.parts(g.items);
    run.catRun = U.rid('cx');
    const cl = await api();
    for (let k = 0; k < parts.length; k++) await cl.call('upload', { run: run.catRun, log: run.srv, part: k, parts: parts.length, items: parts[k] });
    return { codes: g.items.length, rows: g.rows, via: f.via };
  },
  async catPreview(run) {
    const r = await (await api()).call('preview', { run: run.catRun, log: run.srv });
    return { cnt: r.cnt || null };
  },
  async catApply(run) {
    try { return await applyLoop(run.catRun, run.srv); } catch (e) {
      if (e.code === 'first-manual') { run.flags.noCat = true; return { first: 'manual' }; }
      throw e;
    }
  },
  async sales(run) {
    const day = run.days[run.day];
    if (!day) return { skip: 'none' };
    const tab = await ownTab(false);
    const [y, m, d] = day.split('-');
    const f = await capture(tab, 'sales', { day, dmy: `${d}/${m}/${y}` }, 300e3);
    const rows = rowsOf(f), det = C.detect(rows);
    if (det.kind !== 'sales') throw P.err('endpoint-changed', 'הקובץ שהתקבל אינו "דוח מכירות לפריטים"');
    const p = C.parseSales(rows, det), lines = p.lines.filter((l) => l.d === day);
    const hash = await U.sha256(f.bytes);
    const H = (await get('salesHash')) || {};
    if (H[day] === hash) return { n: lines.length, skip: 'same' }; // אותו קובץ בדיוק כבר נקלט
    if (lines.length) {
      const sRun = U.rid('cs'), parts = C.parts(lines, 1000), cl = await api();
      for (let k = 0; k < parts.length; k++) await cl.call('upload', { run: sRun, log: run.srv, kind: 'sales', day, part: k, parts: parts.length, lines: parts[k] });
      await cl.call('preview', { run: sRun, log: run.srv });
      await applyLoop(sRun, run.srv);
    }
    H[day] = hash;
    const keep = Object.keys(H).sort().slice(-30);
    await set({ salesHash: Object.fromEntries(keep.map((k) => [k, H[k]])) });
    return { n: lines.length, bad: p.bad.length, other: p.lines.length - lines.length };
  },
  exportNew: (run) => exportImport(run, 'new'),
  exportPrice: (run) => exportImport(run, 'price'),
  async report(run) {
    await (await api()).call('report', { run: run.srv, kind: 'run', st: 'ok', steps: run.log, info: summary(run) });
    return {};
  },
};
// אישור (apply) עד שהשרת מסיים; "התצוגה התיישנה" → תצוגה מקדימה מחדש, עד פעמיים
async function applyLoop(sub, log) {
  const cl = await api();
  let re = 0;
  for (let i = 0; i < 20; i++) {
    try {
      const r = await cl.call('apply', { run: sub, log });
      if (r.done) return { res: r.res || null };
    } catch (e) {
      if (e.code === 'stale' && re < 2) { re++; await cl.call('preview', { run: sub, log }); continue; }
      throw e;
    }
  }
  throw P.err('server', 'השמירה בשרת לא הסתיימה');
}
async function exportImport(run, kind) {
  const L = run.limits || U.LIMITS;
  const max = kind === 'new' ? Math.min(L.newMax, U.LIMITS.newMax) : Math.min(L.price, U.LIMITS.price);
  const cl = await api();
  const r = await cl.call('export', { kind, max, log: run.srv });
  const n = +r.n || 0;
  if (!n) return { n: 0 };
  if (n > max || (Array.isArray(r.rows) && r.rows.length > max)) throw P.err('limit', `${n} שורות ${kind === 'new' ? 'פריטים חדשים' : 'מחירים'} – מעל המגבלה (${max}). לא נשלח לכספית.`);
  if (typeof r.csv !== 'string' || !r.csv || r.csv.length > 5e6) throw P.err('fail', 'קובץ לא תקין מהשרת');
  const bytes = new TextEncoder().encode(r.csv), hash = await U.sha256(bytes);
  const today = D.dayStr(Date.now(), (await sched()).tz);
  const done = (await get('impHash')) || {};
  if (done[hash] === today) return { n, skip: 'same' };
  const tab = await ownTab(false);
  // שם ייחודי לריצה – כך מוצאים את השורה שלנו בטבלת "טעינות קודמות" (וניסיון חוזר של אותה ריצה לא מעלה פעמיים)
  const name = 'lp-' + kind + '-' + String(run.srv || run.id).replace(/[^\w-]/g, '').slice(0, 40) + '.csv';
  const res = await runFlow(tab, kind === 'new' ? 'importNew' : 'importPrice', { fname: name }, { csv: { name, mime: 'text/csv', b64: U.toB64(bytes) } }, false);
  if (res && res.code === 'import-queue-not-empty') throw P.err('import-queue-not-empty');
  if (!res || (!res.ok && !res.already)) { if (await isLoginTab(tab).catch(() => false)) throw P.err('needs-login'); throw missErr(kind === 'new' ? 'טעינת פריטים חדשים' : 'עדכון מחירים', res || {}); }
  // אחרי "העלה קבצים והרץ טעינה": שורה חדשה (מזהה גדול מהקודם) עם השם שלנו, עד סטטוס סופי. קריאה בלבד, כל 3 שניות
  const r2 = await waitImport(tab, name, res.already ? res.already - 1 : res.hmax || 0, (await sel()).importWaitMs || 600e3);
  const text = `מזהה ${r2.id || '—'} · ${r2.st || ''} · נטענו ${r2.ok == null ? '?' : r2.ok} · שגויים ${r2.err == null ? '?' : r2.err}`;
  const out = { run: run.srv, kind, n, ok: r2.fin === 'ok' && !r2.err, text, hash, id: r2.id || 0, status: String(r2.st || '').slice(0, 40), errors: r2.err == null ? -1 : r2.err, loaded: r2.ok == null ? -1 : r2.ok };
  await cl.call('importResult', out);
  done[hash] = today;
  const keep = Object.entries(done).sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 20);
  await set({ impHash: Object.fromEntries(keep) });
  if (r2.fin === 'timeout') throw P.err('import-timeout', `כספית לא סיימה את הטעינה (מזהה ${r2.id || '—'}, ${r2.st || 'לא נמצאה שורה'}) תוך ${Math.round(((await sel()).importWaitMs || 600e3) / 60e3)} דקות`);
  if (r2.fin === 'fail' || r2.err) throw P.err('import-errors', `טעינה ${r2.id} בכספית: ${r2.st} · נטענו ${r2.ok == null ? '?' : r2.ok} · שגויים ${r2.err == null ? '?' : r2.err}`);
  return { n, id: r2.id, loaded: r2.ok, errors: r2.err };
}
const histIn = (head) => { const H = self.CxSel.histRows(document, head); return H ? { rows: H.rows.slice(0, 200), maxId: H.maxId } : null; };
async function waitImport(tab, name, after, ms) {
  const end = Date.now() + ms;
  let last = null;
  for (;;) {
    await guardBo(tab);
    const H = await inIso(tab, histIn, ['טעינות קודמות']).catch(() => null);
    const row = H && H.rows.filter((r) => r.id > after && r.name === name).sort((a, b) => b.id - a.id)[0];
    if (row) {
      last = row;
      if (/בוצע/.test(row.st)) return Object.assign({ fin: 'ok' }, row);
      if (/שגיא|נכשל|בוטל/.test(row.st)) return Object.assign({ fin: 'fail' }, row);
    }
    if (Date.now() > end) return Object.assign({ fin: 'timeout' }, last || {});
    await sleep(3000);
  }
}
function summary(run) {
  const i = run.info || {};
  return { days: run.days, cat: i.catalog ? { codes: i.catalog.codes } : null, first: i.catApply && i.catApply.first, sales: i.sales || {}, nw: i.exportNew || null, price: i.exportPrice || null, imp: run.flags && run.flags.noImp ? 'off' : 'on', flags: run.flags };
}

// ---------- ריצה ----------
// נעילה: busy נקבע מיד אחרי הבדיקה, לפני כל await – כך בדיקת בקשה מהטלפון והתחלה אוטומטית שמגיעות יחד לא מתחילות שתי ריצות
async function startRun(o) {
  if (busy) return { ok: false, code: 'busy' };
  busy = true;
  try {
    if (!(await get('token'))) return { ok: false, code: 'auth' };
    const s = await sched();
    const run = P.newRun({ id: U.rid('r'), now: Date.now(), manual: !!o.manual, req: o.req || null, slot: D.slotDay(Date.now(), s.at, s.tz) });
    await chrome.alarms.clear('start');
    await loop(run);
    return { ok: true };
  } finally { busy = false; }
}
async function resume() {
  if (busy) return;
  busy = true;
  try {
    let run = await get('run');
    if (!P.canResume(run, Date.now())) return;
    if (!navigator.onLine && run.st === 'wait') { await chrome.alarms.create('retry', { delayInMinutes: 5 }); return; }
    run = P.resumeFrom(run); await loop(run);
  } finally { busy = false; }
}
async function loop(run0) {
  let run = run0;
  keepAlive(true);
  try {
    while (run.st === 'run') {
      await set({ run });
      const step = run.step;
      try {
        if (!navigator.onLine) throw P.err('offline');
        const info = await STEP[step](run);
        run = P.advance(run, Date.now(), info);
      } catch (e) {
        // שגיאה בלי קוד (למשל של chrome.tabs / scripting – הלשונית נסגרה או נטענה מחדש באמצע) → תקלה זמנית, ניסיון חוזר
        run = P.fail(run, Date.now(), e && typeof e.code === 'string' ? e : P.err('tab', String((e && e.message) || e).slice(0, 200)));
      }
    }
    await set({ run });
    if (run.st === 'wait') await chrome.alarms.create('retry', { when: run.retryAt });
    else await finalize(run);
  } finally { keepAlive(false); }
}
async function finalize(run) {
  const st = (await get('st')) || {};
  const s = await sched(), today = D.dayStr(Date.now(), s.tz);
  const code = run.err && run.err.code;
  st.lastRun = { id: run.id, at: Date.now(), st: run.st, manual: run.manual, req: !!run.req, code, msg: run.err && run.err.msg, step: run.err && run.err.step, sum: summary(run) };
  if (run.st === 'ok') { if (!st.lastOkDay || run.slot > st.lastOkDay) st.lastOkDay = run.slot; st.loginDay = null; st.failSlot = null; }
  else if (run.st === 'fail' && code !== 'req-gone') st.failSlot = run.slot; // בקשה מהטלפון שכבר טופלה – לא חוסמת את הסנכרון האוטומטי
  await set({ st });
  if (run.st === 'ok') return;
  if (code === 'auth' || code === 'req-gone') return; // החיבור בוטל – אין למי לדווח; בקשה שכבר טופלה – אין מה לדווח
  if (code === 'needs-login') { if (st.loginDay === today) return; st.loginDay = today; await set({ st }); } // הודעה אחת ביום
  try { await (await api()).call('report', { run: run.srv || run.id, kind: 'run', st: run.st, err: run.err, steps: run.log, info: summary(run) }); } catch (e) { /* ננסה בריצה הבאה */ }
}

// ---------- מצב היכרות ----------
// קישורי התפריט (טקסט + hash), גם של תפריטים סגורים: קודם "מעבר עכבר" (mouseover, בלי לחיצה) על כותרות התפריט שבהגדרה.
// רק קישורים פנימיים (#/...) מחוץ לטבלאות ולרשימות נתונים. רץ בעולם המבודד של התוסף (selectors.js כבר בדף); בודק /bo לפני הכול.
const menuIn = async (heads, max, guard) => {
  const S = self.CxSel;
  if (!S.onPath(window, guard)) return { wrong: true };
  for (const t of heads || []) {
    const el = S.find(document, { text: t }) || S.find(document, { textAny: [t] });
    if (!el) continue;
    for (const ty of ['mouseover', 'mouseenter']) el.dispatchEvent(new MouseEvent(ty, { bubbles: ty === 'mouseover' }));
    await new Promise((r) => setTimeout(r, 700));
  }
  const out = [], seen = new Set();
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    if (out.length >= (max || 200)) break;
    const h = String(a.getAttribute('href') || '');
    if (!/^#\//.test(h) || (a.closest && a.closest('table,tbody,tr,td,[role=grid],[role=row],[role=gridcell],[role=cell],[role=listbox],[role=option]'))) continue;
    const t = S.norm(a.textContent).slice(0, 40);
    if (!t || seen.has(t + '|' + h)) continue;
    seen.add(t + '|' + h);
    out.push({ t, h: h.slice(0, 80) });
  }
  return { links: out };
};
// מסך לקריאה בלבד: כתובת, כותרת, פקדים וכותרות הטבלאות (בלי תוכן השורות) – בקריאה אחת, רק אם הדף ב-/bo
const roIn = (guard) => {
  const S = self.CxSel;
  if (!S.onPath(window, guard)) return { wrong: true };
  const heads = Array.from(document.querySelectorAll('table,[role=grid]')).slice(0, 6).map((t) => Array.from(t.querySelectorAll('th,[role=columnheader]')).slice(0, 30).map((th) => S.norm(th.textContent).slice(0, 40))).filter((x) => x.length);
  // פרטיות: בדף לקריאה בלבד (למשל נוכחות) – בלי טקסט של פקדים ובלי אפשרויות של רשימות בחירה (שמות עובדים); רק תגית/סוג/מזהה ומספר אפשרויות
  return { hash: location.hash, title: document.title, controls: S.controls(document, 400, { noText: true }), heads };
};
// הקישור שמתאים לדף: טקסט מדויק, ואחרת מוכל
function menuPick(links, find) {
  const f = String(find || '').trim();
  if (!f) return null;
  return links.find((l) => l.t === f) || links.find((l) => l.t.includes(f)) || null;
}
async function runDisc() {
  if (busy) return { ok: false, code: 'busy' };
  busy = true;
  keepAlive(true);
  const S0 = await sel(), day = D.addDays(D.dayStr(Date.now(), (await sched()).tz), -1);
  const rep = { v: 1, kind: 'disc', ver: VER, sel: S0.v, at: new Date().toISOString(), ua: (/Chrome\/(\d+)/.exec(navigator.userAgent) || [])[1] || '', pages: [], files: [], net: [] };
  let tab;
  try {
    await set({ discSt: { st: 'run', at: Date.now() } });
    tab = await ownTab(true);
    await waitLoaded(tab);
    await ensurePage(tab);
    await inMain(tab, () => window.__cxHook && window.__cxHook.discover(true));
    if (await isLoginTab(tab)) { rep.login = true; throw P.err('needs-login'); }
    await guardBo(tab);
    // קישורי התפריט – גם אם הניווט למסך מסוים ייכשל, לומדים מהם את הכתובות
    const heads = [...new Set((S0.disc || []).flatMap((p) => (Array.isArray(p.menu) ? p.menu : [])).map(String))];
    const mr = await inIso(tab, menuIn, [heads, 200, GUARD]);
    if (mr && mr.wrong) throw wrongPage();
    const links = (mr && mr.links) || [];
    rep.menu = links.map((l) => ({ t: l.t, h: l.h.replace(/\d+/g, '{n}') }));
    for (const pg of S0.disc || []) {
      // מסך בלי hash קבוע (למשל נוכחות תחת "עובדים"): הכתובת מקישור התפריט לפי הטקסט. רק #/... בתוך /bo (navTo + guardBo)
      if (pg.find) {
        const l = menuPick(links, pg.find);
        if (!l || !(await navTo(tab, l.h, false, 3000))) { rep.pages.push({ name: pg.name, ok: false, nav: l ? 'bad-hash' : 'not-found', find: String(pg.find).slice(0, 40) }); continue; }
      } else if (pg.hash) await navTo(tab, pg.hash, false, 3000);
      await guardBo(tab);
      if (!pg.flow) {
        // מסך לקריאה בלבד: בלי צעדים ובלי שום לחיצה – רק פקדים, כותרות טבלה, כתובת וכותרת
        const r = (await inIso(tab, roIn, [GUARD])) || {};
        if (r.wrong) throw wrongPage();
        await guardBo(tab);
        rep.pages.push({ name: pg.name, ok: true, ro: true, hash: String(r.hash || '').replace(/\d+/g, '{n}').slice(0, 80), title: String(r.title || '').slice(0, 60), controls: r.controls || [], heads: r.heads || [] });
        continue;
      }
      // היכרות v2: פותחים רשימות / לוח שנה רק כדי לראות אותם (בלי לבחור), לפני הצעדים
      const pk = [];
      for (const p of Array.isArray(pg.peek) ? pg.peek : []) { await guardBo(tab); const r = await inIso(tab, peekIn, [p, GUARD]); if (r && r.wrong) throw wrongPage(); pk.push(Object.assign({ name: String(p.name || '') }, r || {})); }
      const nonce = U.rid('n') + U.rid('');
      const got = waitFile(nonce, tab, 120e3);
      got.catch(() => {});
      await arm(tab, nonce);
      const probe = await runFlow(tab, pg.flow, { day }, null, true).catch((e) => ({ ok: false, err: String(e.message || e) }));
      const page = { name: pg.name, flow: pg.flow, probe: (probe.steps || []).map((x) => ({ i: x.i, op: x.op, found: x.found, done: x.done, el: x.el, err: x.err })), ok: !!probe.ok };
      if (pk.length) page.peek = pk;
      const hasCap = (S0.flows[pg.flow] || []).some((x) => x.capture);
      if (hasCap) {
        const f = await got.catch(() => null);
        if (f) {
          const bytes = U.fromB64(f.b64);
          let hdr = null, kind = null, rows = 0, cols = 0;
          try { const R = U.readRows(bytes, f.name, self.XLSX, C); const det = C.detect(R); kind = det.kind; rows = R.length; cols = Math.max(0, ...R.slice(0, 20).map((r) => r.length)); if (det.kind) hdr = R[det.hi].map((x) => String(x).slice(0, 40)); } catch (e) { kind = 'unreadable'; }
          rep.files.push({ flow: pg.flow, ext: (/\.(\w{1,5})$/.exec(f.name || '') || [])[1] || '', mime: f.mime, size: f.size, via: f.via, kind, rows, cols, hdr });
        } else rep.files.push({ flow: pg.flow, none: true });
      }
      waiting.delete(nonce);
      await disarm(tab);
      await guardBo(tab); // היכרות – לא יוצאים מהמשרד האחורי
      page.hash = String(await inIso(tab, () => location.hash) || '').replace(/\d+/g, '{n}').slice(0, 80);
      page.title = String(await inIso(tab, () => document.title) || '').slice(0, 60);
      page.controls = await inIso(tab, () => self.CxSel.controls(document, 400));
      rep.pages.push(page);
    }
    rep.net = (await inMain(tab, () => window.__cxHook && window.__cxHook.netLog())) || [];
    rep.ok = true;
  } catch (e) {
    rep.err = { code: e.code || 'fail', msg: String(e.message || '').slice(0, 200) };
  } finally {
    if (tab) await inMain(tab, () => window.__cxHook && window.__cxHook.discover(false)).catch(() => {});
    keepAlive(false);
    busy = false;
  }
  const clean = S.clean(rep);
  const out = { at: Date.now(), size: S.size(clean), rep: clean };
  await set({ disc: out, discSt: { st: rep.ok ? 'ok' : 'fail', at: Date.now(), code: rep.err && rep.err.code } });
  return { ok: !!rep.ok, code: rep.err && rep.err.code };
}

// ---------- הודעות ----------
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || sender.id !== chrome.runtime.id) return;
  if (m.t === 'cx-file') {
    const w = waiting.get(m.nonce);
    if (w && sender.tab && sender.tab.id === w.tabId && BO_RE.test(String(sender.url || ''))) w.resolve(m);
    return;
  }
  if (!String(sender.url || '').startsWith(chrome.runtime.getURL(''))) return; // רק מהחלון הקופץ / עמוד ההגדרות
  handle(m).then(reply, (e) => reply({ ok: false, code: e.code || 'fail', msg: String(e.message || '') }));
  return true;
});
async function handle(m) {
  if (m.t === 'status') {
    const [token, st, run, biz, disc, discSt, d] = await Promise.all([get('token'), get('st'), get('run'), get('biz'), get('disc'), get('discSt'), chrome.alarms.get('daily')]);
    return { ok: true, connected: !!token, backend: self.CX_CFG.backend, ver: VER, biz: biz || null, st: st || {}, sched: await sched(), next: d ? d.scheduledTime : null, busy,
      run: run ? { st: run.st, step: run.step, day: run.days && run.days[run.day], days: (run.days || []).length, err: run.err, retryAt: run.retryAt, manual: run.manual, req: !!run.req } : null,
      disc: disc ? { at: disc.at, size: disc.size, ok: !!(disc.rep && disc.rep.ok), login: !!(disc.rep && disc.rep.login) } : null, discSt: discSt || null, imp: (await sel()).importEnabled === true };
  }
  if (m.t === 'syncNow') { if (busy) return { ok: false, code: 'busy' }; startRun({ manual: true }).catch(() => {}); return { ok: true }; }
  if (m.t === 'disc') { if (busy) return { ok: false, code: 'busy' }; runDisc().catch(() => {}); return { ok: true }; }
  if (m.t === 'getDisc') { const d = await get('disc'); return { ok: !!d, rep: d ? d.rep : null }; }
  if (m.t === 'sendDisc') {
    const d = await get('disc');
    if (!d) return { ok: false, code: 'none' };
    await (await api()).call('report', { kind: 'disc', data: d.rep });
    return { ok: true };
  }
  if (m.t === 'connect') {
    const token = String(m.token || '').trim();
    if (!A.TOKEN_RE.test(token)) return { ok: false, code: 'bad-token' };
    const r = await A.client({ url: self.CX_CFG.api, token, ver: VER }).call('hello', { mode: 'connect' });
    await set({ token, biz: { name: String((r.biz && r.biz.name) || '').slice(0, 60) } });
    await setupAlarms();
    return { ok: true, biz: String((r.biz && r.biz.name) || '') };
  }
  if (m.t === 'disconnect') {
    await chrome.storage.local.remove(['token', 'biz', 'run']);
    await chrome.alarms.clear('start'); await chrome.alarms.clear('retry');
    return { ok: true };
  }
  return { ok: false, code: 'bad-msg' };
}
// לבדיקות (Playwright): הפעלת טריגר ידנית
self.__cxTest = { sel, trigger, tick, startAuto, resume, setupAlarms, startRun, pollOnce, isBusy: () => busy };
