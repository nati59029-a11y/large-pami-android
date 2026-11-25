// תוסף כספית – service worker: תזמון, ריצת סנכרון (מכונת מצבים שממשיכה אחרי הפסקה), מצב היכרות, והודעות מהחלון הקופץ.
// כל הבקשות לכספית רצות בתוך לשונית ייעודית של התוסף (מוצמדת, לא פעילה) – לא בלשונית של בעל העסק, ולא מהשרת.
// התוסף לעולם לא ממלא שם משתמש או סיסמה: אם כספית מבקשת התחברות – מדווחים "צריך התחברות" ומנסים שוב בבדיקה הבאה.
importScripts('config.js', 'lib/caspit-core.js', 'lib/xlsx.full.min.js', 'lib/days.js', 'lib/plan.js', 'lib/sanitize.js', 'lib/util.js', 'lib/api.js', 'lib/upd.js', 'lib/hours.js', 'lib/hk.js');
const P = self.CxPlan, D = self.CxDays, U = self.CxUtil, S = self.CxSanitize, C = self.CaspitCore, A = self.CxApi, UP = self.CxUpd, HR = self.CxHours;
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
const TODAY_FROM = 7, TODAY_TO = 23; // מכירות היום (0.1.10): כל שעה עגולה 07:00–23:00 לפי שעון העסק, לא בשבת וחג
const HRS_FROM = 7 * 60, HRS_TO = 23 * 60; // שעות העובדים במשך היום (0.1.15; ב-0.1.14 עד 11:00): כל 30 דקות 07:00–23:00 לפי שעון העסק, לא בשבת וחג – רק החודש הנוכחי

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
  await chrome.alarms.create('hour', { when: D.nextHour(Date.now()) + 5e3 }); // מכירות היום – בשעה העגולה הבאה (נוצר מחדש בכל הפעלה)
  await chrome.alarms.create('hrs', { when: D.nextHalf(Date.now()) + 10e3 }); // 0.1.14: שעות העובדים (0.1.15: 07:00–23:00) – בחצי השעה הבאה
}
chrome.runtime.onInstalled.addListener(() => { setupAlarms(); trigger('install'); });
chrome.runtime.onStartup.addListener(() => { setupAlarms(); trigger('startup'); });
if (chrome.idle && chrome.idle.onStateChanged) chrome.idle.onStateChanged.addListener((s) => { if (s === 'active') trigger('idle'); });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tick' || a.name === 'poll') updTick().catch(() => {});
  if (a.name === 'daily') { setupAlarms(); trigger('daily'); }
  // 0.1.15: בשעה עגולה שני ה-alarms (מכירות היום ושעות העובדים) באים יחד – כל אחד מריץ את שלו ואחריו את השני. הנעילה busy מונעת ריצה כפולה,
  // והמשבצת שנלקחה (todaySt / hrsSt) מונעת חזרה – כך השנייה רצה מיד אחרי הראשונה ולא מחכה ל-tick
  else if (a.name === 'hour') { chrome.alarms.create('hour', { when: D.nextHour(Date.now()) + 5e3 }); todayTick().then(() => hoursTick()).catch(() => {}); }
  else if (a.name === 'hrs') { chrome.alarms.create('hrs', { when: D.nextHalf(Date.now()) + 10e3 }); hoursTick().then(() => todayTick()).catch(() => {}); }
  else if (a.name === 'tick') tick().then(() => todayTick()).then(() => hoursTick()).catch(() => {}); // השלמה: שעה / חצי שעה שה-alarm שלה הוחמץ (מחשב ישן או ריצה אחרת) – פעם אחת
  else if (a.name === 'start') startAuto().catch(() => {});
  else if (a.name === 'retry') resume().catch(() => {});
  else if (a.name === 'poll') pollOnce().catch(() => {});
});
// ---------- עדכון אוטומטי (0.1.7) ----------
// הסקריפט במחשב החנות מחליף את קבצי התיקייה וכותב upd.json. כאן – רק קריאה מהדיסק והחלטה (lib/upd.js); אין הורדה מהתוסף.
async function diskFile(name) {
  try { const r = await fetch(chrome.runtime.getURL(name), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function updInfo() {
  const [m, u] = await Promise.all([diskFile('manifest.json'), diskFile('upd.json')]);
  return { disk: m && typeof m.version === 'string' ? m.version.slice(0, 20) : '', upd: UP.cleanUpd(u) };
}
async function updTick() {
  if (busy) return false;
  const d = await updInfo();
  await set({ upd: Object.assign({ cur: VER, chk: Date.now() }, d) });
  const last = await get('updReload');
  if (!UP.wantReload({ cur: VER, disk: d.disk, upd: d.upd, busy, last, now: Date.now() })) return false;
  const run = await get('run');
  if (run && !P.isTerminal(run) && Date.now() - (run.touchedAt || 0) < P.STALE_MS) return false; // ריצה באמצע (או ממתינה לניסיון חוזר) – אחרי שתסתיים
  await set({ updReload: { to: d.disk, at: Date.now() } });
  if (busy) return false;
  (self.__cxTest.reload || (() => chrome.runtime.reload()))(); // בבדיקות אפשר להחליף (Playwright לא טוען מחדש תוסף מהשורת פקודה)
  return true;
}
// "עדכון המחשב" מהטלפון (0.1.10, uq בתשובת poll): בודקים אם בדיסק יש גרסה חדשה שהמשימה ב-Windows סיימה להעתיק,
// מדווחים לשרת (poll עם ack) ונטענים מחדש רק כשבטוח (אין ריצה). ההורדה עצמה – רק מהמשימה ב-Windows (כל 10 דקות).
// st: reload (נטען עכשיו) · same (אין גרסה חדשה בדיסק) · copying (גרסה חדשה בדיסק, ההעתקה עוד לא אושרה) · busy (סנכרון רץ – ייטען אחריו) · none (אין upd.json)
async function updReq(id) {
  await set({ lastUq: id }); // פעם אחת לכל בקשה, גם אם ה-service worker נסגר באמצע
  const d = await updInfo();
  await set({ upd: Object.assign({ cur: VER, chk: Date.now() }, d) });
  const run = await get('run');
  const running = busy || !!(run && !P.isTerminal(run) && Date.now() - (run.touchedAt || 0) < P.STALE_MS);
  let st;
  if (!d.upd) st = 'none';
  else if (!UP.VER_RE.test(d.disk) || UP.cmpVer(d.disk, VER) <= 0) st = 'same';
  else if (!UP.wantReload({ cur: VER, disk: d.disk, upd: d.upd, busy: false, last: null, now: Date.now() })) st = 'copying';
  else st = running ? 'busy' : 'reload';
  try { await (await api()).call('poll', { ack: id, res: { st, cur: VER, disk: UP.VER_RE.test(d.disk) ? d.disk : '' } }); } catch (e) { /* הטלפון יראה "לא הגיב" */ }
  if (st === 'reload' && !busy) {
    await set({ updReload: { to: d.disk, at: Date.now() } });
    (self.__cxTest.reload || (() => chrome.runtime.reload()))();
  }
  return st;
}
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
  const body = wait ? { wait } : {};
  // 0.1.10: מצב העדכון האוטומטי (upd.json) – רק כשהשתנה (המשימה ב-Windows כותבת אותו כל 10 דקות), ורק לשרת שמכיר את השדה (caps.uq)
  const caps0 = (await get('caps')) || {};
  const ui = caps0.uq ? await updInfo().catch(() => null) : null;
  if (ui && ui.upd && (await get('updSent')) !== ui.upd.at + '|' + ui.upd.ok + '|' + ui.upd.ver) body.upd = ui.upd;
  // 0.1.19: העדכון השעתי של מכירות היום נכשל (או נתקע) – מדווחים לשרת, כדי שהטלפון יראה למה "חלקי – עד השעה" לא מתקדם.
  // רק לשרת שמכיר את השדה (caps.tf), ורק כשהשתנה. עד 0.1.18 הכישלון נשמר רק כאן (todaySt)
  const tf = caps0.tf ? P.tfOf(await get('todaySt'), Date.now()) : null;
  if (tf && (await get('tfSent')) !== tf.s + '|' + tf.c) body.tf = tf;
  try { r = await (await api()).call('poll', body); } catch (e) {
    // שרת ישן (bad-op) / העסק כבוי זמנית (403) → כל 15 דקות; האסימון בוטל (401) → מפסיקים עד חיבור מחדש / הפעלת Chrome
    if (e.code === 'bad-op' || (e.code === 'auth' && e.status === 403)) await pollEvery(POLL_SLOW_MIN);
    else if (e.code === 'auth') await chrome.alarms.clear('poll');
    return null; // רשת / שרת – הבדיקה הבאה תנסה שוב
  }
  await pollEvery(POLL_MIN);
  if (body.upd) await set({ updSent: body.upd.at + '|' + body.upd.ok + '|' + body.upd.ver });
  if (body.tf) await set({ tfSent: body.tf.s + '|' + body.tf.c });
  // יכולות השרת (0.1.10): today = מכירות היום כל שעה, uq = "עדכון המחשב" מהטלפון; 0.1.14: hours = שעות העובדים (upload kind:'hours'). שרת ישן (בלי caps) → כבויות
  const cl = Array.isArray(r.caps) ? r.caps : [];
  // 0.1.15: hours2 = השרת מקבל empty (עובדים שכל השעות שלהם בחודש נמחקו בכספית). שרת בלי hours2 – לא שולחים empty (שדה לא מוכר נדחה)
  // 0.1.19: tf = השרת מקבל ב-poll את העדכון השעתי שנכשל
  const caps = { today: cl.includes('today'), uq: cl.includes('uq'), hours: cl.includes('hours'), hours2: cl.includes('hours2'), tf: cl.includes('tf') };
  if (caps.today !== !!caps0.today || caps.uq !== !!caps0.uq || caps.hours !== !!caps0.hours || caps.hours2 !== !!caps0.hours2 || caps.tf !== !!caps0.tf) await set({ caps });
  if (caps.uq && typeof r.uq === 'string' && P.REQ_RE.test(r.uq) && r.uq !== (await get('lastUq'))) { await updReq(r.uq).catch(() => {}); return null; }
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
// ---------- מכירות היום כל שעה (0.1.10) ----------
// רק דוח המכירות של היום (בלי קטלוג ובלי קבצים לכספית), נשלח לשרת כ"חלקי – עד השעה HH:MM" (upload עם partial). לא hello ולא report:
// לא נספר כריצה, לא מקדם את היום האחרון שנקלט (lastSales), ולא נשמר ב-salesHash (הסנכרון הלילי שולח את היום המלא ודורס).
// לא מתחילים רק: בלי חיבור / רשת, כשריצה אחרת פעילה ממש עכשיו, מחוץ ל-07:00–23:00, בשבת וחג (שישי / ערב חג מ-14:00 עד מוצאי 21:00),
// כשהשעה הזו כבר נלקחה, ומול שרת ישן (caps.today). סנכרון לילי שנכשל / ממתין לניסיון חוזר / עוד לא הצליח – לא עוצר את מכירות היום
// (הנעילה busy מונעת שתי ריצות יחד; ניסיון חוזר שמתנגש נדחה ל-tick הבא). כישלון – רק בחלון התוסף (todaySt), בלי דיווח (השעה הבאה תנסה שוב).
async function todayTick(o) {
  const now = (o && o.now) || Date.now(); // now – לבדיקות בלבד
  if (busy || !navigator.onLine || !(await get('token'))) return null;
  if (!((await get('caps')) || {}).today) return null;
  const s = await sched();
  const slot = D.hourSlot(now, s.tz, TODAY_FROM, TODAY_TO);
  if (!slot || ((await get('todaySt')) || {}).slot === slot) return null;
  const run = await get('run');
  if (run && run.st === 'run' && Date.now() - (run.touchedAt || 0) < P.STALE_MS) return null; // ריצה פעילה (גם אם ה-service worker נסגר באמצעה – tick ימשיך אותה)
  return runToday(slot, now, s.tz);
}
async function runToday(slot, now, tz) {
  if (busy) return null;
  busy = true; // ריצה אחת בכל רגע (גם מול הסנכרון הלילי ו"סנכרן עכשיו")
  keepAlive(true);
  const t0 = Date.now(), day = D.dayStr(now, tz);
  let hm = D.hmOf(now, tz), out;
  try {
    await set({ todaySt: { slot, st: 'run', at: Date.now() } }); // השעה נלקחה – גם אם ה-service worker נסגר באמצע, לא חוזרים עליה
    const r0 = { flags: {} };
    await STEP.login(r0);
    const [y, m, d] = day.split('-');
    // 0.1.13: גם כאן – יהודה הנשיא, נחל לכיש וחזרה; העלאה חלקית אחת לשני הסניפים (בשרת: העלאה אחת ל-20 דקות, והיא מחליפה את כל מסמכי היום)
    const A = await salesAll(r0.tab, { day, dmy: `${d}/${m}/${y}` }, 300e3, { retry: false });
    hm = D.hmOf(now + (Date.now() - t0), tz); // "עד השעה" = מתי הדוח הורד מכספית
    const lines = A.list.flatMap((x) => x.p.lines.filter((l) => l.d === day));
    if (lines.length > 30000) throw P.err('limit', 'יותר מדי שורות מכירה היום לשליחה אחת');
    // 0.1.13 (תיקון בודק): נחל לכיש נכשל – לא מעלים בכלל. השרת מחליף את כל מסמכי היום (cxDayP), והעלאה של יהודה הנשיא בלבד
    // הייתה מוחקת את נחל לכיש מהשעה הקודמת. התמונה הקודמת נשארת; השעה הבאה תנסה שוב
    if (A.br) throw P.err(A.br.code, A.br.msg, { br: A.br });
    if (lines.length) await (await api()).call('upload', { run: U.rid('ct'), kind: 'sales', partial: true, day, hm, part: 0, parts: 1, lines });
    out = Object.assign({ slot, st: 'ok', at: Date.now(), day, hm, n: lines.length }, A.list.length > 1 ? { brs: A.list.map((x) => [x.br, x.p.lines.filter((l) => l.d === day).length]) } : {}, A.br ? { br: A.br } : {});
  } catch (e) {
    const code = e && typeof e.code === 'string' ? e.code : 'tab';
    // 0.1.13: לא הצלחנו להחזיר ליהודה הנשיא – מדווחים לשרת מיד (כמו ריצה שנכשלה), אלא אם סנכרון לילי ממתין (הוא יחזיר בתחילתו וידווח אם ייכשל)
    if (code === 'branch-restore') {
      const run = await get('run').catch(() => null);
      if (P.isTerminal(run)) await (await api()).call('report', { run: U.rid('ct'), kind: 'run', st: 'fail', err: { code, msg: String(e.message || '').slice(0, 300), step: 'today' }, steps: [], info: { today: day } }).catch(() => {});
    }
    // השרת דחה כי לפי השעון שלו זה עוד לא החלון (today-off) – השעה לא נחשבת "נלקחה", הבדיקה הבאה (tick) תנסה שוב
    out = Object.assign({ slot: code === 'today-off' ? null : slot, st: 'fail', at: Date.now(), day, hm, code, msg: String((e && e.message) || '').slice(0, 200) }, e && e.br ? { br: e.br } : {});
    // השרת לא מכיר את השדה – מכבים עד ה-poll הבא, שקובע את caps מחדש לפי מה שהשרת מודיע (שרת ישן לא מודיע today → נשאר כבוי)
    if (code === 'bad-field' || code === 'bad-op') await set({ caps: Object.assign((await get('caps')) || {}, { today: false }) });
  } finally { keepAlive(false); busy = false; }
  await set({ todaySt: out });
  return out;
}
// ---------- שעות העובדים במשך היום (0.1.14; 0.1.15 – עד 23:00) ----------
// כל 30 דקות 07:00–23:00 (שעון העסק), לא בשבת וחג: רק החודש הנוכחי, שני הסניפים (hoursAll) והעלאה (upload kind:'hours').
// כמו מכירות היום: לא hello ולא report, לא נספר כריצה, לא נוגע ב-lastSales / sd. לא מתחילים כשריצה אחרת פעילה, בלי חיבור / רשת,
// כשחצי השעה הזו כבר נלקחה, ומול שרת שלא מודיע caps.hours. כישלון – רק בחלון התוסף (hrsSt), חוץ מ-branch-restore (דיווח מיד, כמו בשעתי).
async function hoursTick(o) {
  const now = (o && o.now) || Date.now(); // now – לבדיקות בלבד
  if (busy || !navigator.onLine || !(await get('token'))) return null;
  if (!((await get('caps')) || {}).hours) return null;
  const s = await sched();
  const slot = D.halfSlot(now, s.tz, HRS_FROM, HRS_TO);
  if (!slot || ((await get('hrsSt')) || {}).slot === slot) return null;
  const run = await get('run');
  if (run && run.st === 'run' && Date.now() - (run.touchedAt || 0) < P.STALE_MS) return null;
  return runHours(slot, HR.monthsFor(D.dayStr(now, s.tz), true));
}
async function runHours(slot, months) {
  if (busy) return null;
  busy = true;
  keepAlive(true);
  let out;
  try {
    await set({ hrsSt: { slot, st: 'run', at: Date.now() } }); // חצי השעה נלקחה – גם אם ה-service worker נסגר באמצע
    const r0 = { flags: {} };
    await STEP.login(r0);
    const A = await hoursAll(r0.tab, months);
    await hoursSend(A.list, months, U.rid('ch'));
    out = Object.assign({ slot, st: A.br ? 'fail' : 'ok', at: Date.now() }, hoursInfo(A, months), A.br ? { code: A.br.code, msg: A.br.msg } : {});
  } catch (e) {
    const code = e && typeof e.code === 'string' ? e.code : 'tab';
    if (code === 'branch-restore') {
      const run = await get('run').catch(() => null);
      if (P.isTerminal(run)) await (await api()).call('report', { run: U.rid('ch'), kind: 'run', st: 'fail', err: { code, msg: String(e.message || '').slice(0, 300), step: 'hours' }, steps: [], info: { hrs: months } }).catch(() => {});
    }
    out = { slot, st: 'fail', at: Date.now(), m: months, code, msg: String((e && e.message) || '').slice(0, 200) };
    if (code === 'bad-field' || code === 'bad-kind') await set({ caps: Object.assign((await get('caps')) || {}, { hours: false }) }); // שרת שלא מכיר – עד ה-poll הבא
  } finally { keepAlive(false); busy = false; }
  await set({ hrsSt: out });
  return out;
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
    // בחירת קובץ (0.1.6): מתוך הדף עצמו (MAIN world), עם ניסיונות חלופיים ואבחון – ראו putFile
    if (s.op === 'setFile' && !probe) {
      const q = (steps[i + 1] || {}).op === 'queue' ? steps[i + 1] : null;
      const r = await putFile(tabId, s, q, vars || {}, files && files[s.file]);
      out.steps.push(Object.assign({ i, op: 'setFile' }, r.rec));
      if (!r.ok) { out.ok = false; if (out.miss == null) out.miss = i; out.diag = r.diag || ''; return out; }
      i++; continue;
    }
    let j = i;
    while (j < steps.length && (steps[j] || {}).op !== 'nav' && ((steps[j] || {}).op !== 'setFile' || probe || j === i)) j++;
    await guardBo(tabId);
    const r = await inIso(tabId, runFlowIn, [steps.slice(i, j), vars || {}, files || null, !!probe, GUARD]);
    if (!r) { out.ok = false; if (out.miss == null) out.miss = i; return out; }
    for (const x of r.steps || []) out.steps.push(Object.assign(x, { i: x.i + i }));
    if (r.text) out.text = r.text;
    if (r.wrong) throw wrongPage();
    if (r.code) out.code = r.code;
    if (r.qd) out.qd = String(r.qd);
    if (r.hmax !== undefined) out.hmax = r.hmax;
    if (r.already) { out.already = r.already; return out; }
    if (!r.ok) { out.ok = false; if (out.miss == null && r.miss != null) out.miss = r.miss + i; if (!probe) return out; }
    i = j;
  }
  await guardBo(tabId);
  return out;
}
// ---------- בחירת קובץ בשדה ההעלאה של כספית (0.1.6) ----------
// תקלה 19.11: מהעולם המבודד הקובץ לא נכנס ל"ממתין לטעינה" (ידנית – כן). עכשיו: (1) בתוך הדף (MAIN world) עם הבנאים של הדף,
// (2) אם לא נכנס – אירוע גרירה (dragenter/dragover/drop) על השדה, (3) אם עדיין לא – אותו קובץ בסוג application/vnd.ms-excel
// (כמו ש-Windows מסמן CSV בבחירה ידנית). ניסיון נוסף רק כשהתור עדיין ריק; כל שורה אחרת בתור עוצרת (צעד queue שאחרי).
// בכישלון: אבחון (כמה שדות קובץ, כמה קבצים נבחרו, accept, הודעות גלויות בדף – מסוננות) בהודעה לשרת ובחלון התוסף.
const FILE_TRIES = [['change', 'text/csv'], ['drop', 'text/csv'], ['change', 'application/vnd.ms-excel']];
// 0.1.13 (אבחון 22.11 מכספית האמיתית): יש שני שדות קובץ – #positive-file-uploader מוסתר (הקובץ נכנס אליו ולא לתור), ושדה גלוי ליד "בחר קובץ"
// (שבו בעל העסק בוחר ידנית ושם זה עובד). לכן pref 'vis': קודם שדה גלוי שליד "בחר קובץ", אחר כך גלוי לפי ה-css, אחר כך כל גלוי; בלי שום שדה גלוי – כמו קודם.
// pref 'hid' – חלופה אחרונה (רק כשהתור עדיין ריק): השדה המוסתר. לפני כל ניסיון – ניקוי הערך של כל שדות הקובץ (רק שדות קובץ) מהניסיון הקודם
const setFileMain = (t, f, mode, mime, guard, pref) => {
  try { const L = location, p = String(L.pathname || ''); if (L.origin !== guard.origin || !(p === guard.path || p.startsWith(guard.path + '/'))) return { wrong: true }; } catch (e) { return { wrong: true }; }
  const isF = (e) => String(e.type).toLowerCase() === 'file';
  const pick = (x) => { if (!x || !x.css) return []; try { return Array.from(document.querySelectorAll(x.css)).filter(isF); } catch (e) { return []; } };
  const vis = (e) => e.getClientRects().length > 0;
  const allF = Array.from(document.querySelectorAll('input[type=file]'));
  const prim = pick(t).concat(pick(t && t.alt).filter((e) => !pick(t).includes(e)));
  const near = (e) => {
    try { const lb = e.id && document.querySelector('label[for="' + e.id.replace(/["\\]/g, '') + '"]'); if (lb && /בחר\s*קובץ/.test(lb.textContent || '')) return true; } catch (x) { /* */ }
    for (let p = e.parentElement, k = 0; p && p !== document.body && k < 3; p = p.parentElement, k++) if (/בחר\s*קובץ/.test(p.textContent || '') && !p.querySelector('table')) return true;
    return false;
  };
  const visL = prim.filter(vis).concat(allF.filter((e) => vis(e) && !prim.includes(e)));
  const hidL = prim.filter((e) => !vis(e));
  let el;
  if (pref === 'hid') el = hidL[0];
  else el = visL.find(near) || visL[0] || prim[0];
  if (!el) return { found: false, n: 0 };
  for (const x of allF) { try { if (isF(x) && x.value) x.value = ''; } catch (e) { /* */ } }
  const idOf = (e) => (e.id ? '#' + e.id : 'input[type=file]:nth(' + allF.indexOf(e) + ')').slice(0, 60);
  const bin = atob(f.b64), u = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
  const dt = new DataTransfer();
  dt.items.add(new File([u], f.name, { type: mime }));
  if (mode === 'drop') {
    for (const ty of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(ty, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
  } else {
    try { el.focus(); } catch (e) { /* */ }
    el.files = dt.files;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
  return { found: true, n: allF.length, vis: vis(el), files: (el.files || []).length, id: idOf(el), alt: vis(el) && hidL.length > 0 };
};
// התור "ממתין לטעינה": null = אין כותרת; אחרת [[שם, סוג]]
const queueIn = (s, guard) => { const S = self.CxSel; if (!S.onPath(window, guard)) return { wrong: true }; const R = S.queueRows(document, s); return { rows: R ? R.map((r) => r.slice(0, 2)) : null }; };
// אבחון: רק מבנה ומספרים, והודעות גלויות (התראה / שגיאה) – קצרות, מסוננות לפני היציאה
const fileDiagIn = (t, guard) => {
  const S = self.CxSel;
  if (!S.onPath(window, guard)) return { wrong: true };
  const ins = Array.from(document.querySelectorAll('input[type=file]'));
  const el = S.find(document, t);
  const msgs = Array.from(document.querySelectorAll('[role=alert],.alert,.toast,.toasted,.v-toast,.swal2-popup,.invalid-feedback,.text-danger,.error,.el-message,.notification,.noty_body'))
    .filter((x) => x.getClientRects().length && !(x.closest && x.closest('table'))).map((x) => S.norm(x.textContent).slice(0, 80)).filter(Boolean).slice(0, 3);
  // 0.1.13: מזהה (css) של כל שדה קובץ ואם הוא גלוי – בלי ערכים
  const fids = ins.slice(0, 4).map((x) => S.cssPath(x).slice(0, 60) + (x.getClientRects().length ? '' : ' (מוסתר)'));
  return { fids, ins: ins.length, vis: ins.filter((x) => x.getClientRects().length).length, files: el ? (el.files || []).length : -1, val: el ? !!el.value : false, accept: el ? String(el.getAttribute('accept') || '').slice(0, 60) : '', multi: !!(el && el.multiple), msgs };
};
// 0.1.12: תמונה מסוננת של מסך הייבוא כשהצעד setFile / queue נכשל (selectors.js screen) – כותרות, כותרות טבלה ומספר שורות,
// מילות פעולה של כפתורים, מה שמסביב לשדה הקובץ, דיאלוג גלוי. נשלחת לשרת ב-info.scr של דיווח הריצה (לא בהודעה הקצרה), אחרי sanitize ועד ~4KB
const SCR_MAX = 4000;
const scrIn = (head, guard) => { const X = self.CxSel; if (!X.onPath(window, guard)) return { wrong: true }; return X.screen(document, { head }); };
async function scrOf(tabId, flow, res) {
  try {
    const fl = ((await sel()).flows || {})[flow] || [];
    const st = res && res.miss != null ? fl[res.miss] || {} : {};
    if (st.op !== 'setFile' && st.op !== 'queue' && st.op !== 'queueEmpty') return null; // 0.1.17: גם כשהעצירה לפני הבחירה (queueEmpty)
    const q = fl.find((x) => x && (x.op === 'queue' || x.op === 'queueEmpty')) || {};
    await guardBo(tabId);
    const r = await inIso(tabId, scrIn, [q.head || 'ממתין לטעינה', GUARD]);
    if (!r || r.wrong) return null;
    const rec = ((res.steps || []).filter((x) => x.i === res.miss).pop()) || {};
    return S.limit(S.sanitize(Object.assign({ v: 1, flow, op: st.op, err: String(rec.err || '').slice(0, 30) }, r)), SCR_MAX);
  } catch (e) { return null; }
}
async function putFile(tabId, s, q, vars, f) {
  const rec = { found: false, done: false };
  if (!f) return { ok: false, rec: Object.assign(rec, { err: 'no-file' }) };
  const tries = (q ? FILE_TRIES : FILE_TRIES.slice(0, 1)).map((x) => x.concat(['vis']));
  const log = [];
  for (let k = 0; k < tries.length; k++) {
    await guardBo(tabId);
    if (k) {
      const Q = await inIso(tabId, queueIn, [q, GUARD]);
      if (Q && Q.wrong) throw wrongPage();
      if (Q && Q.rows && Q.rows.length) break; // משהו כבר בתור – לא מוסיפים; הצעד queue יחליט
    }
    const [mode, mime, pref] = tries[k];
    const r = await inMain(tabId, setFileMain, [s.t, f, mode, mime, GUARD, pref]);
    if (r && r.wrong) throw wrongPage();
    if (!r || !r.found) { if (pref === 'hid') break; return { ok: false, rec: Object.assign(rec, { err: 'no-input' }), diag: 'לא נמצא שדה בחירת קובץ' }; }
    rec.found = true; rec.done = true; rec.n = r.n; rec.try = k + 1; rec.fid = r.id;
    log.push(mode + '/' + (mime === 'text/csv' ? 'csv' : 'xls') + ':' + r.files + (r.vis ? '' : '@' + (pref === 'hid' ? 'hid' : 'h')));
    // 0.1.13: אחרי כל הניסיונות בשדה הגלוי – חלופה אחרונה בשדה המוסתר (רק אם התור עדיין ריק – נבדק בתחילת הסבב הבא)
    const lastTry = k === tries.length - 1;
    if (q && lastTry && pref === 'vis' && r.alt) tries.push(['change', 'text/csv', 'hid']);
    if (!q) return { ok: true, rec };
    const end = Date.now() + (lastTry ? 8000 : 6000);
    for (;;) {
      await sleep(400);
      const Q = await inIso(tabId, queueIn, [q, GUARD]);
      if (Q && Q.wrong) throw wrongPage();
      const rows = (Q && Q.rows) || [];
      if (rows.length) { if (k) rec.via = mode + '/' + mime + (pref === 'hid' ? '/hid' : ''); return { ok: true, rec }; } // שלנו או לא – הצעד queue שאחרי בודק
      if (Date.now() > end) break;
    }
  }
  // לא נכנס לתור – אבחון. אם בינתיים משהו הופיע בתור – ממשיכים לצעד queue (הוא יאשר או יעצור)
  const Q = await inIso(tabId, queueIn, [q, GUARD]).catch(() => null);
  if (Q && Q.rows && Q.rows.length) return { ok: true, rec };
  const d = (await inIso(tabId, fileDiagIn, [s.t, GUARD]).catch(() => null)) || {};
  if (d.wrong) throw wrongPage();
  // כל חלק מסונן בנפרד (scrub חותך ל-200), וההודעות מהדף ראשונות – כדי שייכנסו גם אחרי הקיצור ל-290 בהודעה
  const diag = [
    (d.msgs || []).length ? 'הודעה בדף: ' + d.msgs.map((m) => S.scrub(m)).join(' | ') : '',
    `הקובץ לא נכנס ל"ממתין לטעינה" אחרי ${log.length} ניסיונות (${log.join(', ')})`,
    `שדות קובץ: ${d.ins} (גלויים ${d.vis})${(d.fids || []).length ? ' [' + d.fids.map((x) => S.scrub(x)).join(', ') + ']' : ''} · נבחרו: ${d.files}${d.val ? ' (יש ערך)' : ''}${Q && Q.rows === null ? ' · אין כותרת ממתין' : ''}${d.multi ? ' · multiple' : ''}`,
    'accept: ' + (S.scrub(d.accept || '') || '—'),
  ].filter(Boolean).join(' · ');
  return { ok: false, rec: Object.assign(rec, { err: 'no-queue' }), diag };
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

// ---------- סניפים (0.1.13, החלטה 14) ----------
// selectors.json branch: names (כל הסניפים), home ("יהודה הנשיא" – הסניף שכל השאר רץ בו), also (סניפים נוספים למכירות: "נחל לכיש"),
// switch (פקד הסניף: vue-multiselect ב-#store-switch-field). בלי switch / also – סניף אחד, כמו קודם.
// כלל: בסוף כל ריצה שהחליפה סניף (גם בכישלון) – חזרה ל-home ובדיקה; בתחילת כל ריצה (וכל שלב שנוגע בכספית) – אם הנבחר אינו home, מחזירים קודם.
async function brCfg() {
  const b = (await sel()).branch || {};
  if (!b.switch || !b.home || !Array.isArray(b.names)) return null;
  return Object.assign({ names: b.names, home: b.home, also: Array.isArray(b.also) ? b.also : [] }, b.switch);
}
const brCurIn = (cfg, guard) => { const X = self.CxSel; if (!X.onPath(window, guard)) return { wrong: true }; return X.branchCur(document, cfg); };
const brPickIn = (cfg, name, guard) => { const X = self.CxSel; if (!X.onPath(window, guard)) return { wrong: true }; return X.branchPick(document, cfg, name, { win: window, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }); };
// מצב הלשונית בזמן החלפה (כספית עשויה לטעון את הדף מחדש): bo / loading (טעינה בתוך /bo) / off (מחוץ למשרד האחורי → wrong-page)
async function boState(tab) {
  const t = await chrome.tabs.get(tab).catch(() => null);
  if (!t) return 'gone';
  const u = String(t.pendingUrl || t.url || '');
  if (!BO_RE.test(u)) return 'off';
  return t.status === 'complete' && !t.pendingUrl ? 'bo' : 'loading';
}
// קריאת הסניף הנבחר, עד ms (המסך עוד מצויר / נטען מחדש) → { found, cur } או null
async function brRead(tab, cfg, ms) {
  const end = Date.now() + (ms || 0);
  for (;;) {
    const st = await boState(tab);
    if (st === 'off') throw wrongPage();
    if (st === 'gone') throw P.err('selector-miss', 'הלשונית של כספית נסגרה');
    const r = st === 'bo' ? await inIso(tab, brCurIn, [cfg, GUARD]).catch(() => null) : null;
    if (r && r.wrong) throw wrongPage();
    if (r && r.found) return r;
    if (Date.now() > end) return r;
    await sleep(700);
  }
}
// סימון של הדף הנוכחי (בעולם המבודד – נעלם כשהדף נטען מחדש). → true אם הסימון tok עדיין שם (null = לא נקרא)
const brMarkIn = (tok, set) => { if (set) { self.__cxBrTok = tok; return true; } return self.__cxBrTok === tok; };
async function brSame(tab, tok) { try { return !!(await inIso(tab, brMarkIn, [tok, false])); } catch (e) { return null; } }
// בחירת סניף ובדיקה שנקלטה. כישלון → code (branch-switch / branch-restore), בלי לנחש.
// 0.1.22 (תקלה 25.11: הדוח של נחל לכיש יצא של יהודה הנשיא): כספית מציגה את השם החדש בפקד מיד, אבל הבחירה נשמרת רק כשכספית
// טוענת את הדף מחדש בעצמה. לכן: מחכים לטעינה מחדש של כספית (עד reloadMs); אם לא הגיעה – טוענים מחדש בעצמנו.
// רק אחרי טעינה מחדש בודקים שהשם נשאר. לא נשאר → בוחרים שוב (עד 2 ניסיונות), ואחר כך code.
async function brSet(tab, name, code) {
  const cfg = await brCfg();
  if (!cfg) throw P.err(code, 'אין הגדרה לפקד הסניף');
  let r = await brRead(tab, cfg, 15e3);
  if (!r || !r.found) throw P.err(code, `לא נמצא פקד הסניף במסך (רצינו "${name}")`);
  if (r.cur === name) return { same: true };
  for (let k = 0; k < 2; k++) {
    if ((await boState(tab)) === 'off') throw wrongPage();
    const tok = U.rid('b');
    await inIso(tab, brMarkIn, [tok, true]).catch(() => null);
    const p = await inIso(tab, brPickIn, [cfg, name, GUARD]).catch(() => null);
    if (p && p.wrong) throw wrongPage();
    if (p && p.why === 'no-opt') throw P.err(code, `האפשרות "${name}" לא נמצאה בפקד הסניף`);
    // 1) השם מופיע בפקד
    const end = Date.now() + (+cfg.ms || 30e3);
    let shown = false;
    while (Date.now() < end) {
      await sleep(700);
      r = await brRead(tab, cfg, 0);
      if (r && r.cur === name) { shown = true; break; }
    }
    if (!shown) continue;
    // 2) כספית טוענת את הדף מחדש (הסימון נעלם)
    const rEnd = Date.now() + (+cfg.reloadMs || 20e3);
    let reloaded = false;
    while (Date.now() < rEnd) {
      const st = await boState(tab);
      if (st === 'off') throw wrongPage();
      if (st === 'bo' && (await brSame(tab, tok)) === false) { reloaded = true; break; }
      await sleep(700);
    }
    if (!reloaded) { await chrome.tabs.reload(tab); await waitLoaded(tab); await ensurePage(tab); }
    if ((await boState(tab)) === 'off') throw wrongPage();
    // 3) אחרי הטעינה מחדש – השם עדיין נבחר
    await sleep(+cfg.settle || 2000);
    r = await brRead(tab, cfg, 15e3);
    if (r && r.cur === name && (await boState(tab)) === 'bo') return { ok: true, reloaded };
  }
  throw P.err(code, `הבחירה בסניף "${name}" לא נקלטה בכספית (מוצג: ${(r && r.cur) || 'לא ידוע'})`);
}
// לוודא שכספית בסניף הבית (תחילת ריצה / שלב). בלי הגדרת סניפים – כלום
async function brHome(tab) {
  const cfg = await brCfg();
  if (!cfg) return null;
  try { return await brSet(tab, cfg.home, 'branch-restore'); } catch (e) {
    if (e.code === 'wrong-page' || e.code === 'branch-restore') throw e;
    throw P.err('branch-restore', String(e.message || e).slice(0, 200));
  }
}
// הרצת fn בסניף name, וחזרה לבית תמיד (גם בכישלון). החזרה נכשלה → branch-restore (גובר, חוץ מ-wrong-page / needs-login שקרו קודם)
async function inBranch(tab, name, fn) {
  let res, err = null;
  try { await brSet(tab, name, 'branch-switch'); res = await fn(); } catch (e) { err = e; }
  try { await brHome(tab); } catch (e) {
    if (err && (err.code === 'wrong-page' || err.code === 'needs-login')) throw err;
    if (e.code === 'wrong-page') throw e;
    throw P.err('branch-restore', String(e.message || '').slice(0, 200));
  }
  if (err) throw err;
  return res;
}
// אימות הסניף הנוסף: בכל השורות "שם סניף" ו"מספר סניף" קיימים ושונים מאלה של הבית (ref). דוח ריק – תקין
function brCheck(ref, lines, name) {
  if (!lines.length) return null;
  const vals = (L) => ({ bn: [...new Set(L.map((l) => l.bn || '').slice(0, 2000))].slice(0, 3), bk: [...new Set(L.map((l) => (l.bkn ? '' : l.bk || '')))].slice(0, 3) });
  const v = vals(lines), vs = (x) => `שם: ${x.bn.map((t) => t || 'ריק').join('/') || '—'}, מספר: ${x.bk.map((t) => t || 'ריק').join('/') || '—'}`;
  if (!ref.bn.length && !ref.bk.length) return P.err('branch-same', `${name}: אין נתוני סניף של יהודה הנשיא להשוואה (${vs(v)}) – לא נשלח`, { vals: { [name]: v } });
  const bad = lines.some((l) => !l.bn || l.bkn || !/^\d+$/.test(String(l.bk || '')) || ref.bn.includes(l.bn) || ref.bk.includes(l.bk));
  return bad ? P.err('branch-same', `${name}: "שם סניף" / "מספר סניף" לא שונים מיהודה הנשיא או ריקים (${name} – ${vs(v)}; יהודה הנשיא – ${vs(ref)}) – לא נשלח`, { vals: { [name]: v, home: ref } }) : null;
}
// הסניף של הבית לפי הדוח (שם + מספר), עם מה שנשמר מריצות קודמות (יום בלי מכירות ביהודה הנשיא)
async function brRef(lines) {
  const old = (await get('brRef')) || { bn: [], bk: [] };
  const bn = [...new Set(lines.map((l) => l.bn).filter(Boolean))], bk = [...new Set(lines.filter((l) => !l.bkn).map((l) => l.bk).filter(Boolean))];
  if (bn.length || bk.length) { await set({ brRef: { bn: bn.slice(0, 5), bk: bk.slice(0, 5) } }); return { bn, bk }; }
  return { bn: (old.bn || []).slice(0, 5), bk: (old.bk || []).slice(0, 5) };
}
const salesOf = (f) => { const rows = rowsOf(f), det = C.detect(rows); if (det.kind !== 'sales') throw P.err('endpoint-changed', 'הקובץ שהתקבל אינו "דוח מכירות לפריטים"'); return C.parseSales(rows, det); };
// דוח המכירות לכל הסניפים: הבית כמו קודם, ואחר כך כל סניף נוסף – אותו דוח לאותו טווח, וחזרה לבית (inBranch).
// כישלון בסניף נוסף (מעבר, דוח, branch-same) – הבית נשלח בכל זאת, והשגיאה ב-br (מדווחת בסוף הריצה). retry: שגיאה זמנית בסניף הנוסף
// נזרקת (ניסיון חוזר של כל היום) כל עוד נשאר ניסיון. wrong-page / needs-login / branch-restore – תמיד נזרקות.
// → { list: [{ br, f, p }], br: null | { code, msg, vals? } }
async function salesAll(tab, vars, ms, o) {
  const B = await brCfg();
  if (B) await brHome(tab);
  const f0 = await capture(tab, 'sales', vars, ms);
  const p0 = salesOf(f0);
  const out = { list: [{ br: B ? B.home : '', f: f0, p: p0 }], br: null };
  if (!B || !B.also.length) return out;
  const ref = await brRef(p0.lines);
  for (const name of B.also) {
    try {
      const x = await inBranch(tab, name, async () => { const f = await capture(tab, 'sales', vars, ms); return { f, p: salesOf(f) }; });
      const bad = brCheck(ref, x.p.lines, name);
      if (bad) throw bad;
      out.list.push({ br: name, f: x.f, p: x.p });
    } catch (e) {
      const code = e && typeof e.code === 'string' ? e.code : 'tab';
      if (['wrong-page', 'needs-login', 'branch-restore'].includes(code)) throw e;
      if (o && o.retry && P.RETRY.has(code)) throw e;
      if (!out.br) {
        const c = code === 'branch-same' || code === 'branch-switch' ? code : 'branch-sales';
        out.br = Object.assign({ code: c, msg: (c === 'branch-sales' ? name + ': ' : '') + String((e && e.message) || P.msgOf(c)).slice(0, 260) }, e.vals ? { vals: e.vals } : {});
      }
    }
  }
  return out;
}

// ---------- שעות העובדים (0.1.14) ----------
// "עובדים" (#/employees) → "הצג רק עובדים פעילים" (רק אם לא מסומן) → לכל עובד "שעות לעובד" (#/employee-time-tracks/<מזהה>) → "יצוא לאקסל" של דף השעות.
// קריאה בלבד: הזרימות רצות במצב probe (רק צעדי safe, ובלי שום רכיב עם מילה אסורה – selectors.js denied); "עריכה", "עובד חדש",
// "הוספת כניסה ויציאה", "הצג רק מנהלים" ו"יצוא לאקסל" של הרשימה – לא נלחצים. רק /bo (navTo / guardBo / guard בתוך הדף).
// הרשימה עשויה להיות ag-grid עם שורות וירטואליות: גוללים עד הסוף (עד 300 גלילות / max שורות), כל שורה לפי row-index פעם אחת, וכל עובד (מזהה) פעם אחת.
// פרטיות: שמות ושעות רק בהעלאה לשרת – לא בהודעות, לא ב-hrsSt ולא בדיווח הריצה (שם רק מספרים).
const HRS_RE = /#\/employee-time-tracks\/(\d{1,12})(?:[/?]|$)/;
// בתוך הדף: סריקת הרשימה (clickK = null) או לחיצה על "שעות לעובד" בשורה clickK. → { rows:[{ k, id, nm }], grid, cnt, noCtl } | { clicked } | { miss }
const empIn = async (guard, max, clickK) => {
  const X = self.CxSel;
  if (!X.onPath(window, guard)) return { wrong: true };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const RE = /#\/employee-time-tracks\/(\d{1,12})(?:[/?]|$)/;
  const vis = (e) => e.getClientRects().length > 0, txt = (e) => X.norm(e.innerText || e.textContent);
  const ctlOf = (els) => {
    for (const r of els) {
      const c = Array.from(r.querySelectorAll('a,button,[role=button],input[type=button],span')).filter((e) => vis(e) && txt(e).length <= 30 && /שעות לעובד/.test(txt(e) || e.value || ''));
      const m = c.filter((e) => !c.some((o) => o !== e && e.contains(o)))[0];
      if (m) return (m.closest && m.closest('a[href],button,[role=button]')) || m;
    }
    return null;
  };
  const idOf = (els, ctl) => {
    const as = [ctl && ctl.closest && ctl.closest('a[href]')].concat(...els.map((r) => Array.from(r.querySelectorAll('a[href]')))).filter(Boolean);
    for (const a of as) { const m = RE.exec(a.getAttribute('href') || ''); if (m) return m[1]; }
    return '';
  };
  const grid = Array.from(document.querySelectorAll('.ag-root-wrapper,.ag-root')).find(vis) || null;
  const NM = /^(שם|שם עובד|שם העובד|שם מלא)$/;
  let nameOf = () => '', rowsNow;
  if (grid) {
    const hd = Array.from(grid.querySelectorAll('.ag-header-cell[col-id]')).map((h) => ({ id: h.getAttribute('col-id'), t: txt(h) }));
    let nc = hd.filter((h) => NM.test(h.t)).slice(0, 1).map((h) => h.id);
    if (!nc.length) nc = ['שם פרטי', 'שם משפחה'].map((t) => (hd.find((h) => h.t === t) || {}).id).filter(Boolean);
    nameOf = (els) => nc.map((c) => { for (const r of els) { const x = Array.from(r.querySelectorAll('[col-id]')).find((e) => e.getAttribute('col-id') === c); if (x) return txt(x); } return ''; }).filter(Boolean).join(' ').slice(0, 60);
    rowsNow = () => {
      const by = new Map();
      for (const r of grid.querySelectorAll('[row-index]')) { const k = r.getAttribute('row-index'); if (!/^\d+$/.test(k) || (r.closest && r.closest('.ag-floating-top,.ag-floating-bottom,.ag-header'))) continue; if (!by.has(+k)) by.set(+k, []); by.get(+k).push(r); }
      return by;
    };
  } else {
    const tb = Array.from(document.querySelectorAll('table')).find((t) => vis(t) && ctlOf([t]));
    const th = tb ? Array.from(tb.querySelectorAll('thead th, tr:first-child th')).map(txt) : [];
    const ni = th.findIndex((t) => NM.test(t));
    nameOf = (els) => (ni >= 0 ? txt((els[0].querySelectorAll('td')[ni]) || document.createElement('i')).slice(0, 60) : '');
    rowsNow = () => new Map((tb ? Array.from(tb.querySelectorAll('tbody tr')).filter((r) => r.querySelector('td')) : []).map((r, k) => [k, [r]]));
  }
  const vp = grid ? ['.ag-body-viewport', '.ag-body-vertical-scroll-viewport', '.ag-center-cols-viewport'].map((c) => grid.querySelector(c)).find((e) => e && e.scrollHeight > e.clientHeight + 2) : null;
  const scrollTo = async (y) => { vp.scrollTop = y; vp.dispatchEvent(new Event('scroll')); await sleep(450); };
  const got = new Map();
  let noCtl = 0;
  const take = () => {
    for (const [k, els] of rowsNow()) {
      if (got.has(k)) continue;
      const ctl = ctlOf(els);
      if (clickK != null) {
        if (k !== clickK) continue;
        if (!ctl || X.denied(ctl)) return { miss: true };
        ctl.click();
        return { clicked: true };
      }
      if (!ctl) { noCtl++; continue; }
      if (got.size < max) got.set(k, { k, id: idOf(els, ctl), nm: nameOf(els) });
    }
    return null;
  };
  if (vp) await scrollTo(0);
  let r = take();
  for (let it = 0; !r && vp && it < 300 && got.size < max; it++) {
    const y0 = vp.scrollTop;
    if (y0 + vp.clientHeight >= vp.scrollHeight - 2) break;
    await scrollTo(y0 + Math.max(30, Math.floor(vp.clientHeight * 0.7)));
    r = take();
    if (vp.scrollTop === y0) break;
  }
  if (!r && vp) r = take();
  if (r) return r;
  if (clickK != null) return { miss: true };
  const g = grid && (grid.matches('[role=grid],[role=treegrid]') ? grid : grid.querySelector('[role=grid],[role=treegrid]'));
  const pg = grid && Array.from(grid.querySelectorAll('.ag-paging-panel')).some(vis);
  return { rows: [...got.values()].sort((a, b) => a.k - b.k), grid: !!grid, cnt: g ? +g.getAttribute('aria-rowcount') || 0 : 0, noCtl, paged: !!pg };
};
// בתוך הדף: בחירת חודש בדף השעות ("בחר חודש": שדה טקסט MM/YYYY, type=month או select). לוח שנה / פורמט לא מוכר → לא נוגעים ({ ok:false, why })
const monthIn = async (ym, guard) => {
  const X = self.CxSel;
  if (!X.onPath(window, guard)) return { wrong: true };
  const vis = (e) => e.getClientRects().length > 0;
  const [y, m] = ym.split('-');
  let el = null;
  for (const l of Array.from(document.querySelectorAll('label,span,div,strong,b')).filter((e) => vis(e) && /^(בחר |בחירת )?חודש:?$/.test(X.norm(e.textContent)))) {
    el = l.control || (l.htmlFor && document.getElementById(l.htmlFor)) || (l.nextElementSibling && l.nextElementSibling.matches('input,select') ? l.nextElementSibling : null) || (l.parentElement && l.parentElement.querySelector('input:not([type=checkbox]):not([type=password]),select'));
    if (el) break;
  }
  if (!el) { const L = Array.from(document.querySelectorAll('input')).filter((e) => vis(e) && /^(\d{1,2}\/\d{4}|\d{4}-\d{2})$/.test(String(e.value).trim())); if (L.length === 1) el = L[0]; }
  if (!el) return { ok: false, why: 'no-ctl' };
  if (String(el.type).toLowerCase() === 'password') return { ok: false, why: 'bad' };
  if (el.readOnly || (el.closest && el.closest('.vdp-datepicker,.mx-datepicker,.v-calendar'))) return { ok: false, why: 'cal' };
  let v;
  if (String(el.tagName).toLowerCase() === 'select') {
    const o = Array.from(el.options || []).find((x) => { const t = X.norm(x.textContent) + ' ' + x.value, my = X.monthYear(t); return new RegExp('(^|\\D)0?' + +m + '\\/' + y + '(\\D|$)').test(t) || (my && my.y === +y && my.m === +m - 1) || x.value === ym; });
    if (!o) return { ok: false, why: 'no-opt' };
    v = o.value;
  } else if (String(el.type).toLowerCase() === 'month' || /^\d{4}-\d{2}$/.test(String(el.value).trim())) v = ym;
  else if (/^\d{2}\/\d{4}$/.test(String(el.value).trim())) v = m + '/' + y;
  else if (/^\d\/\d{4}$/.test(String(el.value).trim())) v = +m + '/' + y;
  else return { ok: false, why: 'fmt' };
  X.setValue(el, v, window);
  try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) { /* */ }
  await new Promise((r) => setTimeout(r, 2000));
  return String(el.value) === v ? { ok: true } : { ok: false, why: 'stuck' };
};
// כתובת דף השעות אחרי לחיצה על "שעות לעובד" (רק בתוך /bo) → המזהה, או '' אחרי ms
async function hrsWaitId(tab, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const t = await chrome.tabs.get(tab).catch(() => null);
    if (!t) throw P.err('selector-miss', 'הלשונית של כספית נסגרה');
    const u = String(t.pendingUrl || t.url || '');
    if (!BO_RE.test(u)) throw wrongPage();
    const m = HRS_RE.exec(u);
    if (m && t.status === 'complete') { await sleep(1500); await guardBo(tab); return m[1]; }
    if (Date.now() > end) return '';
    await sleep(400);
  }
}
// "יצוא לאקסל" של דף השעות (זרימה במצב probe: רק אם הכתובת היא דף שעות עובד, ובלי רכיב עם מילה אסורה) → הקובץ
async function hrsGrab(tab) {
  const nonce = U.rid('n') + U.rid('');
  const got = waitFile(nonce, tab, 120e3);
  got.catch(() => {});
  await arm(tab, nonce);
  try {
    const r = await runFlow(tab, 'hrsExport', {}, null, true);
    if (!(r.steps || []).some((x) => x.op === 'click' && x.done)) throw P.err('hours-fail', `לא נמצא "יצוא לאקסל" בדף השעות של עובד (${((r.steps || []).find((x) => x.err) || {}).err || 'לא נמצא'})`);
    const f = await got;
    return { name: f.name, bytes: U.fromB64(f.b64) };
  } finally { waiting.delete(nonce); await disarm(tab); }
}
// מבנה קובץ לא מוכר → hours-format: רק כותרות דרך הרשימה הלבנה, מספר שורות / עמודות וסוג תא (בלי שמות ובלי ערכים)
function hrsFmt(R) {
  const sh = S.fileShape(R, 5);
  return { rows: R.length, cols: Math.max(0, ...R.slice(0, 20).map((r) => (Array.isArray(r) ? r.length : 0))), hi: sh.hi, hdr: sh.hdr, kinds: sh.kinds };
}
// סניף אחד: כל העובדים מהרשימה, לכל עובד החודשים (הנוכחי תמיד; הקודם – בחירה ב"בחר חודש", ובסוף חזרה לנוכחי).
// → { emps:[{ id, nm, m:{ 'YYYY-MM': rows } }], seen, skip, out, pm:{ ok, bad, none, why } }
async function hoursBr(tab, months) {
  const H0 = (await sel()).hours || {}, max = Math.min(+H0.max || 300, 500), cur = months[months.length - 1];
  const list = async () => {
    const L = await runFlow(tab, 'hrsList', {}, null, true);
    if (!L.ok) throw P.err('hours-list', `רשימת העובדים לא נמצאה בכספית (צעד ${(L.miss || 0) + 1})`);
  };
  await list();
  await guardBo(tab);
  const sc = await inIso(tab, empIn, [GUARD, max, null]);
  if (sc && sc.wrong) throw wrongPage();
  if (!sc || !Array.isArray(sc.rows) || !sc.rows.length) throw P.err('hours-list', 'לא נמצאו עובדים עם "שעות לעובד" ברשימה');
  const out = { emps: [], seen: sc.rows.length, skip: 0, out: 0, pm: { ok: 0, bad: 0, none: 0, why: '' }, grid: !!sc.grid, cnt: sc.cnt || 0, noCtl: sc.noCtl || 0, paged: !!sc.paged };
  const ids = new Set();
  let inList = true;
  for (const row of sc.rows) {
    let id = row.id;
    if (id && ids.has(id)) continue;
    if (id) await navTo(tab, '#/employee-time-tracks/' + id, false, 2500);
    else {
      if (!inList) await list();
      await guardBo(tab);
      const c = await inIso(tab, empIn, [GUARD, max, row.k]);
      if (c && c.wrong) throw wrongPage();
      if (!c || !c.clicked) { out.skip++; inList = true; continue; }
      id = await hrsWaitId(tab, 20e3);
      if (!id) { out.skip++; inList = false; continue; }
    }
    inList = false;
    if (ids.has(id)) continue; // אותו עובד פעמיים ברשימה
    ids.add(id);
    const pg = await runFlow(tab, 'hrsPage', {}, null, true);
    if (!pg.ok) throw P.err('hours-fail', `דף השעות של עובד לא נטען (צעד ${(pg.miss || 0) + 1})`);
    const e = { id: String(id), nm: String(row.nm || '').slice(0, 60), m: {}, z: {} };
    let moved = false;
    for (const ym of [cur].concat(months.filter((x) => x !== cur))) {
      if (ym !== cur) {
        if (out.pm.none) continue; // אין דרך לבחור חודש – לא מנסים שוב בכל עובד
        await guardBo(tab);
        const r = await inIso(tab, monthIn, [ym, GUARD]);
        if (r && r.wrong) throw wrongPage();
        if (!r || !r.ok) { out.pm.none++; out.pm.why = (r && r.why) || 'fail'; continue; }
        moved = true;
      }
      const f = await hrsGrab(tab);
      const R = rowsOf(f);
      const p = HR.parse(R, ym);
      if (!p.ok) throw P.err('hours-format', `קובץ השעות מכספית במבנה לא מוכר (${R.length} שורות) – השעות לא נשלחו`, { fmt: hrsFmt(R) });
      if (!e.nm && p.nm) e.nm = p.nm.slice(0, 60);
      out.out += p.out;
      if (ym !== cur) { if (p.rows.length) out.pm.ok++; else if (p.out) out.pm.bad++; } // החודש לא התחלף (הקובץ מחודש אחר)
      if (p.rows.length) e.m[ym] = p.rows;
      // 0.1.15: היצוא הצליח ופוענח, ואין בו אף שורה – לא מחודש אחר (out) ולא שורה שלא פוענחה (bad) – כל השעות של העובד בחודש נמחקו בכספית → מועמד ל-empty.
      // רק החודש הנוכחי (ברירת המחדל של הדף); בחודש הקודם אי אפשר לוודא שהבחירה נקלטה כשהקובץ ריק. יצוא שנכשל / מבנה לא מוכר – נזרק למעלה, ולא מגיע לכאן
      else if (ym === cur && !p.out && !p.bad) e.z[ym] = 1;
    }
    // חזרה לחודש הנוכחי (אם כספית זוכרת את הבחירה). לא אושרה (הערך בפקד "בחר חודש" לא התחלף) – היצוא הבא עלול להיות מהחודש הקודם,
    // ולכן אין empty לאף עובד בסניף הזה בריצה הזו (zOff)
    if (moved) {
      const r = await inIso(tab, monthIn, [cur, GUARD]).catch(() => null);
      if (r && r.wrong) throw wrongPage();
      if (!(r && r.ok)) out.zOff = 'month';
    }
    out.emps.push(e);
  }
  return out;
}
// כל הסניפים: הבית, ואחר כך כל סניף נוסף (inBranch – חזרה לבית תמיד). כישלון בסניף נוסף – הבית נשלח בכל זאת, השגיאה ב-br.
// wrong-page / needs-login / branch-restore – תמיד נזרקות. → { list:[{ br, r }], br: null | { code, msg, fmt? } }
async function hoursAll(tab, months) {
  const B = await brCfg();
  if (B) await brHome(tab);
  const out = { list: [{ br: B ? B.home : 'main', r: await hoursBr(tab, months) }], br: null };
  if (!B || !B.also.length) return out;
  for (const name of B.also) {
    try { out.list.push({ br: name, r: await inBranch(tab, name, () => hoursBr(tab, months)) }); } catch (e) {
      const code = e && typeof e.code === 'string' ? e.code : 'tab';
      if (['wrong-page', 'needs-login', 'branch-restore'].includes(code)) throw e;
      if (!out.br) out.br = Object.assign({ code: code === 'hours-format' ? code : 'hours-branch', msg: (name + ': ' + String((e && e.message) || P.msgOf(code))).slice(0, 260) }, e.fmt ? { fmt: e.fmt } : {});
    }
  }
  return out;
}
// העלאה: לכל סניף ולכל חודש – העלאה אחת עם העובדים שיש להם לפחות שורת נוכחות אחת בחודש (השרת מחליף לכל סניף+חודש+עובד)
// 0.1.15: עם caps.hours2 – גם empty: עובדים שהיצוא שלהם הצליח בלי אף שורה בחודש, ושנשלחו בעבר עם שורות לאותו סניף+חודש (hrsSeen – רק להם יש מה למחוק).
// השרת מוחק רק את המסמכים שלהם באותו סניף+חודש. מעצור (HR.emptyPick): כל העובדים בסניף ריקים / יותר מ-2 → בלי empty, x.zw = 'hours-empty-many'.
// החזרה לחודש הנוכחי לא אושרה (zOff) → בלי empty לסניף, x.zw = 'hours-empty-month'
async function hoursSend(list, months, run, log) {
  let n = 0;
  const cl = await api(), h2 = !!((await get('caps')) || {}).hours2, seen = (await get('hrsSeen')) || {};
  for (const x of list) {
    for (const ym of months) {
      const emps = x.r.emps.filter((e) => e.m[ym] && e.m[ym].length).map((e) => ({ id: e.id, nm: e.nm, rows: e.m[ym] }));
      const key = x.br + '|' + ym;
      let empty = [];
      if (h2) {
        const pk = HR.emptyPick(x.r.emps, ym, seen[key], 2);
        if (pk.ids.length && x.r.zOff) x.zw = 'hours-empty-month';
        else if (pk.warn) x.zw = pk.warn;
        else empty = pk.ids;
      }
      if (!emps.length && !empty.length) continue;
      await cl.call('upload', Object.assign({ run, kind: 'hours', br: x.br, m: ym, emps }, empty.length ? { empty } : {}, log ? { log } : {}));
      const del = new Set(empty);
      seen[key] = [...new Set((seen[key] || []).filter((id) => !del.has(id)).concat(emps.map((e) => e.id)))].slice(-500);
      n++;
    }
  }
  const keep = Object.keys(seen).sort((a, b) => (a.slice(a.lastIndexOf('|') + 1) < b.slice(b.lastIndexOf('|') + 1) ? 1 : -1)).slice(0, 12); // סניפים × החודשים האחרונים
  await set({ hrsSeen: Object.fromEntries(keep.map((k) => [k, seen[k]])) });
  return n;
}
// מספרים בלבד (בלי שמות ושעות) – לחלון התוסף ולדיווח הריצה
function hoursInfo(A, months) {
  const pm = A.list.reduce((a, x) => ({ ok: a.ok + x.r.pm.ok, bad: a.bad + x.r.pm.bad, none: a.none + x.r.pm.none, why: a.why || x.r.pm.why }), { ok: 0, bad: 0, none: 0, why: '' });
  return Object.assign({ m: months, brs: A.list.map((x) => [x.br, x.r.seen, x.r.emps.filter((e) => Object.keys(e.m).length).length, x.r.emps.reduce((s0, e) => s0 + Object.values(e.m).reduce((a, r) => a + r.length, 0), 0)]) },
    months.length > 1 ? { pm } : {}, A.list.some((x) => x.zw) ? { warn: A.list.find((x) => x.zw).zw } : {}, A.list.some((x) => x.r.skip) ? { skip: A.list.reduce((a, x) => a + x.r.skip, 0) } : {}, A.list.some((x) => x.r.paged) ? { paged: true } : {});
}

// ---------- יתרות הקפה (0.1.21) ----------
// בריצה הלילית בלבד (לא בשעתית): "יצוא לאקסל" של #/hakafa-customers (capture: נקודת קצה אם הוגדרה, אחרת המסך – הזרימה hkSnap),
// פענוח (lib/hk.js) ושליחה לשרת: op 'hkSnap' { run, day, rows:[{ xc, tz, name, ph, addr, bal }] } – רק השדות האלה.
// הרשימה זהה בשני הסניפים → פעם אחת, בסניף הבית (brHome לפני). דגל: selectors.json hkSync:true.
// כישלון לא מפיל את הריצה: נרשם ב-flags.hk ({ code, msg }) ונשלח בדיווח (info.flags.hk, info.hk) – הריצה עצמה "הצליחה".
// נזרקות (כמו בשעות): wrong-page / needs-login / branch-restore / auth; תקלה זמנית (רשת, שרת, זמן) – ניסיון חוזר רגיל, ובניסיון האחרון – flags.hk.
const HK = self.CxHk;
const HK_STOP = ['wrong-page', 'needs-login', 'branch-restore', 'auth'];
async function hkStep(run) {
  if ((await sel()).hkSync !== true) return { skip: 'off' };
  const tab = await ownTab(false);
  let stage = 'get';
  try {
    await brHome(tab);
    const f = await capture(tab, 'hkSnap', {}, 120e3);
    stage = 'parse';
    let R;
    try { R = U.readRows(f.bytes, f.name, self.XLSX, C); } catch (e) { throw P.err('hk-format', 'לא הצלחנו לקרוא את קובץ לקוחות ההקפה מכספית'); }
    const X = HK.parse(R);
    if (!X.ok) { const sh = S.fileShape(R, 0); throw P.err('hk-format', undefined, { fmt: { rows: R.length, hi: sh.hi, hdr: sh.hdr, why: X.why } }); }
    if (!X.rows.length) throw P.err('hk-empty');
    if (X.rows.length > HK.MAX_ROWS) throw P.err('hk-limit', `${X.rows.length} לקוחות הקפה – מעל המגבלה (${HK.MAX_ROWS}). לא נשלח.`);
    stage = 'send';
    const day = D.dayStr(Date.now(), (await sched()).tz);
    await (await api()).call('hkSnap', { run: U.rid('hk'), day, rows: X.rows });
    return { n: X.rows.length, skip: X.skip, bad: X.bad, dup: X.dup, day, via: f.via };
  } catch (e) {
    const code = e && typeof e.code === 'string' ? e.code : 'tab';
    if (HK_STOP.includes(code)) throw e;
    if (P.RETRY.has(code) && (run.attempt || 0) < P.BACKOFF.length) throw e;
    const c = /^hk-/.test(code) ? code : stage === 'send' ? 'hk-server' : stage === 'get' ? 'hk-export' : 'hk-format';
    const msg = /^hk-/.test(code) ? String((e && e.message) || P.msgOf(c)) : P.msgOf(c) + ' (' + code + ': ' + String((e && e.message) || '').slice(0, 160) + ')';
    run.flags.hk = Object.assign({ code: c, msg: msg.slice(0, 260) }, e && e.fmt ? { fmt: e.fmt } : {});
    return { err: c };
  }
}

// ---------- שלבי הריצה ----------
const STEP = {
  async hello(run) {
    // העלאה לכספית (פריטים חדשים / מחירים) כבויה עד שנדע בוודאות איך מסך הייבוא מעלה קובץ – בלי export לשרת (לא מסמנים pd) ובלי ייבוא
    if ((await sel()).importEnabled !== true) run.flags.noImp = true;
    const cl = await api(), body = Object.assign({ mode: run.mode, manual: run.manual }, run.req ? { req: run.req } : {});
    // מצב העדכון האוטומטי (upd.json) – לשרת: התראה למנהל אם הסקריפט נכשל / הפסיק לרוץ / גרסה שהורדה לא נטענה. שרת ישן מתעלם מהשדה
    const ui = await updInfo().catch(() => null);
    if (ui && ui.upd) body.upd = ui.upd;
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
    await brHome(tab); // 0.1.13: אם כספית נשארה בסניף אחר (למשל ריצה שנקטעה) – מחזירים ליהודה הנשיא לפני כל דבר אחר
    run.tab = tab;
    return {};
  },
  async catalog(run) {
    const tab = await ownTab(false);
    await brHome(tab); // קטלוג – רק בסניף הבית
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
    // 0.1.13: יהודה הנשיא ואחר כך נחל לכיש (אותו יום), חזרה ליהודה הנשיא; העלאה אחת משולבת לשני הסניפים (השרת מפריד לפי מספר סניף)
    const A = await salesAll(tab, { day, dmy: `${d}/${m}/${y}` }, 300e3, { retry: (run.attempt || 0) < P.BACKOFF.length });
    if (A.br) { run.flags.br = run.flags.br || Object.assign({ day }, A.br); }
    const lines = [], hs = [];
    let bad = 0, other = 0;
    for (const x of A.list) {
      const L = x.p.lines.filter((l) => l.d === day);
      lines.push(...L); bad += x.p.bad.length; other += x.p.lines.length - L.length;
      hs.push(x.br + ':' + (await U.sha256(x.f.bytes)));
    }
    const hash = A.list.length === 1 ? hs[0].slice(hs[0].indexOf(':') + 1) : await U.sha256(new TextEncoder().encode(hs.join('|')));
    const nb = A.list.length > 1 ? { brs: A.list.map((x) => [x.br, x.p.lines.filter((l) => l.d === day).length]) } : {};
    const H = (await get('salesHash')) || {};
    if (H[day] === hash) return Object.assign({ n: lines.length, skip: 'same' }, nb, A.br ? { br: A.br.code } : {}); // אותם קבצים בדיוק כבר נקלטו
    if (lines.length) {
      const sRun = U.rid('cs'), parts = C.parts(lines, 1000), cl = await api();
      for (let k = 0; k < parts.length; k++) await cl.call('upload', { run: sRun, log: run.srv, kind: 'sales', day, part: k, parts: parts.length, lines: parts[k] });
      await cl.call('preview', { run: sRun, log: run.srv });
      await applyLoop(sRun, run.srv);
    }
    if (!A.br) { // יום שהסניף הנוסף נכשל בו – לא נרשם כ"אותו קובץ" (ריצה חוזרת של היום תנסה שוב את שני הסניפים)
      H[day] = hash;
      const keep = Object.keys(H).sort().slice(-30);
      await set({ salesHash: Object.fromEntries(keep.map((k) => [k, H[k]])) });
    }
    return Object.assign({ n: lines.length, bad, other }, nb, A.br ? { br: A.br.code } : {});
  },
  // 0.1.14: שעות העובדים – אחרי המכירות, לפני ההעלאות לכספית. כישלון לא מפיל את המכירות / ההעלאות: נרשם ב-flags.hrs ומדווח בסוף (report).
  // נזרקות רק wrong-page / needs-login / branch-restore (עוצרות את כל הריצה, כמו במכירות). שרת בלי caps.hours – מדלגים
  async hours(run) {
    if (!((await get('caps')) || {}).hours) return { skip: 'caps' };
    const months = HR.monthsFor(D.dayStr(Date.now(), (await sched()).tz));
    const tab = await ownTab(false);
    try {
      const A = await hoursAll(tab, months);
      await hoursSend(A.list, months, U.rid('ch'), run.srv);
      const info = hoursInfo(A, months);
      if (A.br) run.flags.hrs = A.br;
      else if (info.pm && info.pm.bad && !info.pm.ok) run.flags.hrs = { code: 'hours-month', msg: P.msgOf('hours-month') };
      return info;
    } catch (e) {
      const code = e && typeof e.code === 'string' ? e.code : 'tab';
      if (['wrong-page', 'needs-login', 'branch-restore'].includes(code)) throw e;
      run.flags.hrs = Object.assign({ code: /^hours-/.test(code) ? code : 'hours-fail', msg: String((e && e.message) || P.msgOf(code)).slice(0, 260) }, e && e.fmt ? { fmt: e.fmt } : {});
      return { err: run.flags.hrs.code };
    }
  },
  hk: (run) => hkStep(run), // 0.1.21: יתרות הקפה – כישלון לא מפיל את הריצה
  exportNew: (run) => exportImport(run, 'new'),
  exportPrice: (run) => exportImport(run, 'price'),
  async report(run) {
    // 0.1.13: הסניף הנוסף נכשל (מעבר / דוח / branch-same) – הכול נשלח כרגיל, והריצה מסתיימת "נכשלה" עם הקוד (דיווח ב-finalize, בלי ניסיון חוזר)
    if (run.flags && run.flags.br) throw P.err(run.flags.br.code, run.flags.br.msg);
    if (run.flags && run.flags.hrs) throw P.err(run.flags.hrs.code, run.flags.hrs.msg); // 0.1.14: שעות העובדים נכשלו – כל השאר נשלח
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
  await brHome(tab); // העלאה לכספית – רק בסניף הבית
  // שם ייחודי לריצה – כך מוצאים את השורה שלנו בטבלת "טעינות קודמות" (וניסיון חוזר של אותה ריצה לא מעלה פעמיים)
  const name = 'lp-' + kind + '-' + String(run.srv || run.id).replace(/[^\w-]/g, '').slice(0, 40) + '.csv';
  const res = await runFlow(tab, kind === 'new' ? 'importNew' : 'importPrice', { fname: name }, { csv: { name, mime: 'text/csv', b64: U.toB64(bytes) } }, false);
  // 0.1.16: עם פירוט התור (מסונן) – ההחלטה לא משתנה
  // 0.1.17: ועם "פירוט מסך הייבוא" (info.scr) – רק אבחון
  if (res && res.code === 'import-queue-not-empty') {
    const scr = await scrOf(tab, kind === 'new' ? 'importNew' : 'importPrice', res);
    throw P.err('import-queue-not-empty', res.qd ? (P.msgOf('import-queue-not-empty') + ' · ' + S.scrub(res.qd)).slice(0, 290) : undefined, scr ? { scr } : undefined);
  }
  if (!res || (!res.ok && !res.already)) {
    if (await isLoginTab(tab).catch(() => false)) throw P.err('needs-login');
    const scr = await scrOf(tab, kind === 'new' ? 'importNew' : 'importPrice', res); // 0.1.12: רק אבחון – ההחלטה (selector-miss) לא משתנה
    const x = scr ? { scr } : undefined;
    if (res && res.diag) throw P.err('selector-miss', ((kind === 'new' ? 'טעינת פריטים חדשים' : 'עדכון מחירים') + ': ' + res.diag).slice(0, 290), x);
    throw Object.assign(missErr(kind === 'new' ? 'טעינת פריטים חדשים' : 'עדכון מחירים', res || {}), x || {});
  }
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
  return { days: run.days, cat: i.catalog ? { codes: i.catalog.codes } : null, first: i.catApply && i.catApply.first, sales: i.sales || {}, hrs: i.hours || null, hk: i.hk || null, nw: i.exportNew || null, price: i.exportPrice || null, imp: run.flags && run.flags.noImp ? 'off' : 'on', flags: run.flags, ...(i.scr ? { scr: i.scr } : {}) };
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
        if (run.info && run.info.scr) delete run.info.scr; // 0.1.12: ניסיון חוזר שהצליח – בלי אבחון ישן בדיווח
      } catch (e) {
        // שגיאה בלי קוד (למשל של chrome.tabs / scripting – הלשונית נסגרה או נטענה מחדש באמצע) → תקלה זמנית, ניסיון חוזר
        run = P.fail(run, Date.now(), e && typeof e.code === 'string' ? e : P.err('tab', String((e && e.message) || e).slice(0, 200)));
        if (e && e.scr) run.info.scr = e.scr; // 0.1.12: תמונת מסך הייבוא (מסוננת) – נשלחת בדיווח (summary)
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
  // 0.1.12: לכל קישור – תחת איזו כותרת תפריט הוא נחשף (u): קישור שהופיע (או נעשה גלוי) אחרי המעבר על הכותרת, או שנמצא בתוך הפריט שלה
  const visA = () => new Set(Array.from(document.querySelectorAll('a[href]')).filter((a) => a.getClientRects().length));
  const under = new Map();
  for (const t of heads || []) {
    const el = S.find(document, { text: t }) || S.find(document, { textAny: [t] });
    if (!el) continue;
    const before = visA();
    for (const ty of ['mouseover', 'mouseenter']) el.dispatchEvent(new MouseEvent(ty, { bubbles: ty === 'mouseover' }));
    await new Promise((r) => setTimeout(r, 700));
    const box = el.closest && el.closest('li,.dropdown,.nav-item,.menu-item,.submenu');
    for (const a of visA()) if (!under.has(a) && (!before.has(a) || (box && box !== document.body && box.contains(a)))) under.set(a, t);
  }
  const out = [], seen = new Set();
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    if (out.length >= (max || 200)) break;
    const h = String(a.getAttribute('href') || '');
    if (!/^#\//.test(h) || (a.closest && a.closest('table,tbody,tr,td,[role=grid],[role=row],[role=gridcell],[role=cell],[role=listbox],[role=option]'))) continue;
    const t = S.norm(a.textContent).slice(0, 40);
    if (!t || seen.has(t + '|' + h)) continue;
    seen.add(t + '|' + h);
    // bad: קישור עם מילה אסורה (שמירה / מחיקה / הוספה / ייבוא / טעינה…), "הגדר" (הגדרות) – בהיכרות לא נפתח בשום מקרה
    out.push(Object.assign({ t, h: h.slice(0, 80) }, under.has(a) ? { u: under.get(a) } : {}, S.deniedLink([S.norm(a.textContent), a.getAttribute('aria-label') || ''].join(' ')) || /הגדר|ייבוא|יבוא/.test(t) ? { bad: true } : {}));
  }
  return { links: out };
};
// מסך לקריאה בלבד: כתובת, כותרת, פקדים וכותרות הטבלאות (בלי תוכן השורות) – בקריאה אחת, רק אם הדף ב-/bo
const roIn = (guard, btn, priv, scr) => {
  const S = self.CxSel;
  if (!S.onPath(window, guard)) return { wrong: true };
  // 0.1.12 (מסך הייבוא, imp): גם תמונת המסך – כותרות, אזורים / לשוניות, כותרות טבלה ומספר שורות, שדות הקובץ (accept, multiple, נראות)
  const sc = scr ? S.screen(document, { marks: true }) : undefined;
  const heads = Array.from(document.querySelectorAll('table,[role=grid]')).slice(0, 6).map((t) => Array.from(t.querySelectorAll('th,[role=columnheader]')).filter((th) => !th.closest('tfoot')).slice(0, 30).map((th) => S.norm(th.textContent).slice(0, 40))).filter((x) => x.length);
  // פרטיות: בדף לקריאה בלבד (למשל נוכחות) – בלי טקסט של פקדים ובלי אפשרויות של רשימות בחירה (שמות עובדים); רק תגית/סוג/מזהה ומספר אפשרויות
  return { hash: location.hash, title: document.title, controls: S.controls(document, 400, { noText: true, btn: !!btn, priv: !!priv }), heads, scr: sc };
};
// דף priv (0.1.11): בכתובת נשאר רק המסך עצמו – כל מה שאחרי (מזהה לקוח / עובד) → {id}, ובפרמטרים רק השמות (הערכים → {v})
function privHash(h) {
  const m = /^(#\/[\w-]+)(\/[^?]*)?(\?.*)?$/.exec(String(h || ''));
  if (!m) return h ? '#/{?}' : '';
  const q = m[3] ? '?' + m[3].slice(1).split('&').map((kv) => kv.split('=')[0].replace(/[^\w-]/g, '').slice(0, 20) + '={v}').join('&') : '';
  return m[1] + (m[2] && m[2] !== '/' ? '/{id}' : '') + q;
}
// כותרות טבלה בדף priv – רק דרך הרשימה הלבנה (תא לא מוכר → '?'), כמו כותרות הקובץ
// פקד בחירת הסניף במשרד האחורי (0.1.12) – קריאה בלבד. פקד: select / רשימה נפתחת / קישור / כפתור שהטקסט שלו (או אחת מאפשרויות ה-select)
// כולל שם סניף מ-cfg.names; האפשרויות רק אם כבר קיימות ב-DOM (option, או פריטי תפריט נפתח שכבר מצוירים), בלי לפתוח. מחוץ לטבלאות.
// store: שם הסניף שכתוב ליד "חנות:" בדף (הסניף הנוכחי). מכל טקסט – רק שם סניף מ-cfg.names, אף פעם לא הטקסט המלא
const brIn = (cfg, priv, guard) => {
  const X = self.CxSel;
  if (!X.onPath(window, guard)) return { wrong: true };
  // 0.1.12 (תיקון בודק): מכל טקסט יוצא רק שם הסניף שזוהה מתוך cfg.names (nm) – לא הטקסט המלא (למשל "נחל לכיש: ₪12,345.00" → "נחל לכיש")
  const N = (cfg.names || []).map(X.norm).filter(Boolean), nm = (t) => N.find((n) => X.norm(t).includes(n)) || '', has = (t) => !!nm(t);
  const uniq = (a) => [...new Set(a.filter(Boolean))], aria = (e) => String(e.getAttribute('aria-label') || '').replace(/[\d₪]+/g, '').slice(0, 60);
  const DATA = 'table,tbody,tr,td,[role=grid],[role=row],[role=gridcell],[role=cell]';
  const vis = (e) => e.getClientRects().length > 0, txt = (e) => X.norm(e.innerText || e.textContent);
  const ok = (e) => !(e.closest && e.closest(DATA));
  const out = [];
  for (const e of Array.from(document.querySelectorAll('select'))) {
    if (!ok(e)) continue;
    const op = Array.from(e.options || []).map((o) => X.norm(o.textContent));
    if (!op.some(has)) continue;
    out.push({ kind: 'select', css: X.cssPath(e), id: e.id || '', aria: aria(e), vis: vis(e), n: op.length, opts: uniq(op.map(nm)), cur: e.selectedIndex >= 0 ? nm(op[e.selectedIndex]) : '' });
  }
  const C = 'button,a,[role=combobox],[role=button],[role=listbox],.dropdown-toggle,.multiselect,.v-select,.navbar-text,.store-name,span,div';
  const cand = Array.from(document.querySelectorAll(C)).filter((e) => ok(e) && vis(e) && txt(e).length <= 60 && has(txt(e)) && !(e.closest && e.closest('select')));
  for (const e of cand.filter((e) => !cand.some((o) => o !== e && e.contains(o))).slice(0, 4)) {
    const tag = String(e.tagName).toLowerCase(), role = String(e.getAttribute('role') || '');
    const box = e.closest('.dropdown,.multiselect,.v-select,[role=combobox],li,.nav-item') || e.parentElement;
    const items = box ? uniq(Array.from(box.querySelectorAll('.dropdown-item,.multiselect__option,[role=option],[role=menuitem],li a')).filter((x) => x !== e).slice(0, 30).map((x) => nm(txt(x)))) : [];
    const kind = tag === 'a' ? 'link' : role === 'combobox' || /multiselect|v-select|dropdown/.test(String(e.className) + ' ' + String(box && box.className)) ? 'dropdown' : tag === 'button' || role === 'button' ? 'button' : 'text';
    const h = tag === 'a' ? String(e.getAttribute('href') || '') : '';
    out.push(Object.assign({ kind, tag, css: X.cssPath(e), aria: aria(e), t: nm(txt(e)), opts: items }, /^#\//.test(h) ? { h: h.slice(0, 80).replace(/\d+/g, '{n}') } : h ? { h: '(ext)' } : {}));
  }
  const st = Array.from(document.querySelectorAll('body *')).filter((e) => ok(e) && vis(e) && /חנות\s*:/.test(e.textContent || '') && X.norm(e.textContent).length <= 120);
  const store = uniq(st.filter((e) => !st.some((o) => o !== e && e.contains(o))).slice(0, 3).map((e) => nm(txt(e)))); // רק שם הסניף שכתוב ליד "חנות:"
  return { picks: out.slice(0, 6), store };
};
async function branchAdd(tab, acc, pg, cfg) {
  if (!cfg || !Array.isArray(cfg.names)) return;
  const r = await inIso(tab, brIn, [cfg, !!pg.priv, GUARD]).catch(() => null);
  if (r && r.wrong) throw wrongPage();
  if (!r) return;
  acc.pages++;
  for (const p of r.picks || []) {
    const k = p.kind + '|' + p.css, old = acc.picks.find((x) => x.k === k);
    if (old) { if (old.on.length < 30) old.on.push(pg.name); continue; }
    if (acc.picks.length < 10) acc.picks.push(Object.assign({ k, on: [pg.name] }, p));
  }
  for (const t of r.store || []) if (!acc.store.includes(t) && acc.store.length < 5) acc.store.push(t);
}
const privHeads = (heads) => (Array.isArray(heads) ? heads.map((row) => S.hdrSafe(row) || []) : []);
// מבצעים / אמצעי תשלום (0.1.12): כמו privHeads, ובנוסף כל תא עם ספרה או ₪ → '?' (סכום, מספר, שם קופאי בכותרת לא יוצאים)
const safeHeads = (heads) => (Array.isArray(heads) ? heads.map((row) => S.hdrStrict(row) || []) : []);
// מהדף הפרטי הראשון ועד סוף ההיכרות – כל בקשת רשת מסומנת pv (גם בקשות שמסתיימות אחרי המעבר למסך הבא)
const privNet = (tab) => inMain(tab, () => window.__cxHook && window.__cxHook.privMark && window.__cxHook.privMark(true)).catch(() => {});
// מסמכי הקפה (0.1.13): חלון שגיאה של כספית – הטקסט, וסגירה ב"אישור" (הלחיצה היחידה על חלון); אחרי "הצג" – טבלאות והודעות (מסוננות)
const MSG_OK = /שגיאה|תקלה|נכשל|אין נתונים|אין תוצאות|לא נמצא|error|failed|no data/i;
const dlgIn = (close, guard) => { const X = self.CxSel; if (!X.onPath(window, guard)) return { wrong: true }; return { d: X.errDialogs(document, close) }; };
const rowsIn = (guard) => { const X = self.CxSel; if (!X.onPath(window, guard)) return { wrong: true }; return X.rowScan(document); };
async function dlgClose(tab, ms) {
  const out = [], end = Date.now() + (ms || 0);
  for (;;) {
    await guardBo(tab);
    const r = await inIso(tab, dlgIn, [true, GUARD]).catch(() => null);
    if (r && r.wrong) throw wrongPage();
    for (const x of (r && r.d) || []) if (out.length < 4) out.push({ t: S.scrub(x.t).slice(0, 120), closed: !!x.closed });
    if ((r && r.d && r.d.length) || Date.now() > end) break;
    await sleep(700);
  }
  if (out.length) await sleep(800);
  return out;
}
// טבלאות אחרי "הצג": כותרות דרך הרשימה הלבנה (hdrStrict), מספר שורות, קישורים / כפתורים בשורות (רק hash ומילות פעולה); מחכים עד ms לשורות או להודעה
async function docRows(tab, ms) {
  const end = Date.now() + (ms || 0);
  let r = null;
  for (;;) {
    await guardBo(tab);
    r = await inIso(tab, rowsIn, [GUARD]).catch(() => null);
    if (r && r.wrong) throw wrongPage();
    if ((r && ((r.tables || []).some((t) => t.rows) || (r.msgs || []).length)) || Date.now() > end) break;
    await sleep(1000);
  }
  r = r || {};
  return {
    tables: (r.tables || []).map((t) => ({ th: S.hdrStrict(t.th) || [], rows: t.rows, links: t.links, hrefs: t.hrefs, btns: t.btns, bw: t.bw })),
    msgs: (r.msgs || []).filter((m) => MSG_OK.test(m)).map((m) => S.scrub(m).slice(0, 80)),
  };
}
// היכרות לקוחות לפי סניף (0.1.13, discBranch): בנחל לכיש – יצוא hk-customers / hk-reports, רק כותרות (רשימה לבנה) ומספר שורות.
// המעבר והחזרה – inBranch (חזרה ליהודה הנשיא תמיד); בסוף ההיכרות נבדק שוב שהנבחר הוא יהודה הנשיא
async function discBranch(tab, S0, day) {
  const B = S0.discBranch, cfg = await brCfg();
  if (!B || !cfg || !B.br) return null;
  const out = { br: B.br, pages: [] };
  try {
    await inBranch(tab, B.br, async () => {
      for (const name of B.pages || []) {
        const pg = (S0.disc || []).find((x) => x.name === name);
        if (!pg || !pg.hash) continue;
        await navTo(tab, pg.hash, true, 3000);
        await guardBo(tab);
        await privNet(tab);
        const nonce = U.rid('n') + U.rid('');
        const got = waitFile(nonce, tab, 120e3);
        got.catch(() => {});
        await arm(tab, nonce);
        let f = null, probe = null;
        try {
          probe = await runFlow(tab, 'hkExport', { day, hash: pg.hash }, null, true);
          const capDone = (probe.steps || []).some((x) => x.op === 'click' && x.done);
          f = capDone ? await got.catch(() => null) : null;
        } finally { waiting.delete(nonce); await disarm(tab); }
        const t = await docRows(tab, 0);
        const rec = { name, tables: t.tables.map((x) => ({ th: x.th, rows: x.rows })) };
        if (!t.tables.length) throw P.err('selector-miss', `${B.br}: לא נמצאה טבלה במסך ${name}`);
        if (f) {
          try { const R = U.readRows(U.fromB64(f.b64), f.name, self.XLSX, C), sh = S.fileShape(R, 0); rec.file = { rows: R.length, hi: sh.hi, hdr: sh.hdr }; } catch (e) { rec.file = { kind: 'unreadable' }; }
        } else rec.file = { none: true };
        out.pages.push(rec);
      }
    });
    out.ok = true;
  } catch (e) {
    if (e.code === 'wrong-page') throw e;
    out.err = { code: e.code || 'fail', msg: S.scrub(String(e.message || '')).slice(0, 200) };
  }
  return out;
}
async function runDisc() {
  if (busy) return { ok: false, code: 'busy' };
  busy = true;
  keepAlive(true);
  const S0 = await sel(), day = D.addDays(D.dayStr(Date.now(), (await sched()).tz), -1);
  // מסמכי הקפה (0.1.13): החודש הקודם המלא (לפי היום של אתמול באזור הזמן של העסק)
  const pm = (() => { const [y, m] = day.split('-').map(Number), py = m === 1 ? y - 1 : y, pmn = m === 1 ? 12 : m - 1, mm = String(pmn).padStart(2, '0'); return { from: `${py}-${mm}-01`, to: D.addDays(`${y}-${String(m).padStart(2, '0')}-01`, -1) }; })();
  const rep = { v: 1, kind: 'disc', ver: VER, sel: S0.v, at: new Date().toISOString(), ua: (/Chrome\/(\d+)/.exec(navigator.userAgent) || [])[1] || '', pages: [], files: [], net: [] };
  let tab, brUsed = false;
  try {
    await set({ discSt: { st: 'run', at: Date.now() } });
    tab = await ownTab(true);
    await waitLoaded(tab);
    await ensurePage(tab);
    await inMain(tab, () => window.__cxHook && window.__cxHook.discover(true));
    if (await isLoginTab(tab)) { rep.login = true; throw P.err('needs-login'); }
    await guardBo(tab);
    // 0.1.13 (תיקון בודק): אם ריצה קודמת נקטעה בסניף אחר – מחזירים ליהודה הנשיא לפני שקוראים משהו; לא הצליח → branch-restore, עוצרים
    brUsed = true;
    await brHome(tab);
    rep.brStart = 'ok';
    // קישורי התפריט – גם אם הניווט למסך מסוים ייכשל, לומדים מהם את הכתובות
    const heads = [...new Set((S0.disc || []).flatMap((p) => (Array.isArray(p.menu) ? p.menu : [])).map(String))];
    const mr = await inIso(tab, menuIn, [heads, 200, GUARD]);
    if (mr && mr.wrong) throw wrongPage();
    const links = (mr && mr.links) || [];
    rep.menu = links.map((l) => Object.assign({ t: l.t, h: l.h.replace(/\d+/g, '{n}') }, l.u ? { u: l.u } : {}, l.bad ? { bad: true } : {}));
    // findAll (0.1.12, דוחות אמצעי תשלום): רק קישורים שנחשפו תחת כותרות התפריט של הדף (menu: "דוחות" / "קופות"), בלי מילה אסורה / "הגדר" / "ייבוא",
    // שהטקסט שלהם כולל ביטוי דוח מפורש (U.menuAll) → דף משלו (hash מהקישור), עד max. מסך שכבר בהגדרה – לא שוב. בלי אף קישור – שורה אחת not-found
    const known = (S0.disc || []).map((p) => p.hash).filter(Boolean), pages = [];
    for (const pg of S0.disc || []) {
      if (!Array.isArray(pg.findAll)) { pages.push(pg); continue; }
      const L = U.menuAll(links, pg.findAll, pg.menu, known, +pg.max || 8, HASH_RE);
      L.forEach((ln, k) => { known.push(ln.h); pages.push(Object.assign({}, pg, { findAll: undefined, name: pg.name + '-' + (k + 1), hash: ln.h, src: ln.t })); });
      if (!L.length) pages.push({ name: pg.name, none: true, find: pg.findAll.join(',') });
    }
    rep.branch = { picks: [], store: [], pages: 0 };
    for (const pg of pages) {
      if (pg.none) { rep.pages.push({ name: pg.name, ok: false, nav: 'not-found', find: String(pg.find).slice(0, 120) }); continue; }
      // מסך בלי hash קבוע (למשל נוכחות תחת "עובדים"): הכתובת מקישור התפריט לפי הטקסט. רק #/... בתוך /bo (navTo + guardBo)
      // find: מחרוזת או רשימה לפי סדר עדיפות (0.1.12 מבצעים: רק "מבצעים" מדויק). רק התאמה מדויקת ולא קישור bad (U.menuPick); הקישור – גם ל-{hash} של הזרימה
      let l = null;
      if (pg.find) {
        l = (Array.isArray(pg.find) ? pg.find : [pg.find]).map((f) => U.menuPick(links, f)).find(Boolean) || null;
        if (!l || !(await navTo(tab, l.h, false, 3000))) { rep.pages.push({ name: pg.name, ok: false, nav: l ? 'bad-hash' : 'not-found', find: String(pg.find).slice(0, 40) }); continue; }
      } else if (pg.hash) await navTo(tab, pg.hash, false, 3000);
      await guardBo(tab);
      // בחירת סניף (0.1.12): בכל מסך, לפני כל צעד – רק קריאה (בלי select, בלי click, בלי פוקוס על הפקד)
      await branchAdd(tab, rep.branch, pg, S0.branch);
      if (!pg.flow) {
        // מסך לקריאה בלבד: בלי צעדים ובלי שום לחיצה – רק פקדים, כותרות טבלה, כתובת וכותרת
        if (pg.priv) await privNet(tab);
        // imp (0.1.12, מסך הייבוא): בלי שום לחיצה, בלי בחירת סוג ובלי קובץ – רק קריאה
        const r = (await inIso(tab, roIn, [GUARD, !!pg.btn, !!pg.priv, !!pg.imp && !pg.priv])) || {};
        if (r.wrong) throw wrongPage();
        await guardBo(tab);
        // priv (לקוחות הקפה, 0.1.11): בלי כותרת הדף, כתובת בלי מזהים, כותרות טבלה רק מהרשימה הלבנה
        if (pg.priv) rep.pages.push({ name: pg.name, ok: true, ro: true, priv: true, hash: privHash(r.hash).replace(/\d+/g, '{n}').slice(0, 80), controls: r.controls || [], heads: privHeads(r.heads) });
        else rep.pages.push(Object.assign({ name: pg.name, ok: true, ro: true, hash: String(r.hash || '').replace(/\d+/g, '{n}').slice(0, 80), title: String(r.title || '').slice(0, 60), controls: r.controls || [], heads: r.heads || [] }, r.scr ? { scr: r.scr } : {}));
        continue;
      }
      // מסמכי הקפה (0.1.13): חלון שגיאה שכספית הקפיצה – הטקסט, וסגירה ב"אישור", לפני הצעדים
      const dlg = pg.docs ? await dlgClose(tab, 3000) : null;
      // היכרות v2: פותחים רשימות / לוח שנה רק כדי לראות אותם (בלי לבחור), לפני הצעדים
      const pk = [];
      for (const p of Array.isArray(pg.peek) ? pg.peek : []) { await guardBo(tab); const r = await inIso(tab, peekIn, [p, GUARD]); if (r && r.wrong) throw wrongPage(); pk.push(Object.assign({ name: String(p.name || '') }, r || {})); }
      const nonce = U.rid('n') + U.rid('');
      const got = waitFile(nonce, tab, 120e3);
      got.catch(() => {});
      await arm(tab, nonce);
      if (pg.priv) await privNet(tab);
      // hash: למסך עם hash קבוע – צעד עם at "{hash}" (hkExport) רץ רק אם באמת הגענו למסך
      const probe = await runFlow(tab, pg.flow, { day, from: pm.from, to: pm.to, hash: pg.hash || (l && l.h) || '' }, null, true).catch((e) => ({ ok: false, err: String(e.message || e) }));
      // priv (0.1.11): מהרכיב שנמצא / נחסם – רק תגית ו-css, בלי הטקסט (למשל "יצוא לאקסל – כרטסת <שם לקוח>")
      const elOf = (e) => (e && pg.priv ? { tag: e.tag, css: String(e.css || '').replace(/\d/g, '?') } : e);
      const page = { name: pg.name, flow: pg.flow, probe: (probe.steps || []).map((x) => ({ i: x.i, op: x.op, found: x.found, done: x.done, el: elOf(x.el), err: x.err })), ok: !!probe.ok };
      if (pk.length) page.peek = pk;
      if (pg.docs) {
        // אחרי "הצג" (אם נלחץ): טבלאות / הודעות, ושוב חלון שגיאה אם קפץ
        const t = await docRows(tab, 10e3);
        const dlg2 = await dlgClose(tab, 0);
        // 0.1.13 (תיקון בודק): בדף priv – מחלון השגיאה ומההודעות רק סיווג (err / nodata), בלי הטקסט (עלול לכלול שם לקוח)
        const cls = (t) => (/אין נתונים|אין תוצאות|לא נמצא|no data/i.test(t) ? 'nodata' : 'err');
        if (pg.priv) { dlg2.forEach((x, i) => { dlg2[i] = { k: cls(x.t), closed: x.closed }; }); (dlg || []).forEach((x, i) => { dlg[i] = { k: cls(x.t), closed: x.closed }; }); t.msgs = t.msgs.map(cls); }
        page.docs = { month: pm.to.slice(5, 7) + '/' + pm.to.slice(0, 4), d1: +pm.from.slice(8), d2: +pm.to.slice(8), dlg: (dlg || []).concat(dlg2), show: (probe.steps || []).filter((x) => x.op === 'click' && !(S0.flows[pg.flow][x.i] || {}).capture).map((x) => ({ found: x.found, done: x.done, err: x.err }))[0] || null, tables: t.tables, msgs: t.msgs };
      }
      const capI = (S0.flows[pg.flow] || []).findIndex((x) => x.capture), hasCap = capI >= 0;
      // 0.1.11: אם כפתור היצוא לא נלחץ (לא נמצא / נחסם) – לא מחכים לקובץ (אחרת כל מסך בלי יצוא מעכב 2 דקות)
      const capDone = (probe.steps || []).some((x) => x.i === capI && x.op === 'click' && x.done);
      if (hasCap) {
        const f = capDone ? await got.catch(() => null) : null;
        if (f) {
          const bytes = U.fromB64(f.b64);
          let hdr = null, kind = null, rows = 0, cols = 0, shape = null;
          try {
            const R = U.readRows(bytes, f.name, self.XLSX, C); const det = C.detect(R); kind = det.kind; rows = R.length; cols = Math.max(0, ...R.slice(0, 20).map((r) => r.length));
            // קובץ של דף priv (שעות עובד 0.1.10, לקוחות הקפה 0.1.11): שורת הכותרות רק דרך רשימה לבנה (תא לא מוכר → '?'),
            // ומ-5 השורות הראשונות רק סוג התא – בלי שמות, טלפונים, סכומים או שעות. גם אם הקובץ נראה כמו קטלוג/מכירות
            if (pg.priv || pg.flow === 'empHours') shape = S.fileShape(R, 5);
            else if (pg.promo || pg.pay) shape = S.hdrRaw(R, 5); // מבצעים / אמצעי תשלום (0.1.12): כותרות כמו שהן + סוג תא, בלי ערכים
            else if (det.kind) hdr = R[det.hi].map((x) => String(x).slice(0, 40));
          } catch (e) { kind = 'unreadable'; }
          rep.files.push(Object.assign({ flow: pg.flow, page: pg.name, ext: (/\.(\w{1,5})$/.exec(f.name || '') || [])[1] || '', mime: f.mime, size: f.size, via: f.via, kind, rows, cols, hdr: shape ? shape.hdr : hdr }, shape ? { hi: shape.hi, kinds: shape.kinds } : {}));
        } else rep.files.push({ flow: pg.flow, page: pg.name, none: true });
      }
      waiting.delete(nonce);
      await disarm(tab);
      await guardBo(tab); // היכרות – לא יוצאים מהמשרד האחורי
      // priv (שעות עובד, לקוחות הקפה): בלי כותרת הדף, ובכתובת – כל מזהה אחרי המסך (לא רק ספרות) → {id} (privHash)
      const h0 = String(await inIso(tab, () => location.hash) || '');
      page.hash = (pg.priv ? privHash(h0) : h0).replace(/\d+/g, '{n}').slice(0, 80);
      if (!pg.priv) page.title = String(await inIso(tab, () => document.title) || '').slice(0, 60);
      if (pg.priv) {
        // priv: פקדים כמו בדף לקריאה בלבד – בלי טקסט (רק מילות פעולה של כפתורים), בלי אפשרויות בחירה; כותרות טבלה רק מהרשימה הלבנה
        const r = (await inIso(tab, roIn, [GUARD, true, true])) || {};
        if (r.wrong) throw wrongPage();
        page.controls = r.controls || [];
        page.heads = privHeads(r.heads);
      } else page.controls = await inIso(tab, () => self.CxSel.controls(document, 400));
      if (pg.src) page.src = String(pg.src).slice(0, 40); // findAll: טקסט הקישור בתפריט
      if ((pg.promo || pg.pay) && !pg.priv) {
        // מבצעים / אמצעי תשלום (0.1.12): פקדים בלי טקסט חופשי (noText – רק מילות פעולה של כפתורים, בלי אפשרויות select; פקד הסניף – ב-rep.branch),
        // כותרות טבלה רק דרך הרשימה הלבנה (ספרה / ₪ → '?'), ותמונת המסך – כותרות, לשוניות, ומה שקיים לייבוא / מבצע חדש (marks) – בלי ללחוץ
        const r = (await inIso(tab, roIn, [GUARD, true, false, true])) || {};
        if (r.wrong) throw wrongPage();
        page.controls = r.controls || [];
        page.heads = safeHeads(r.heads);
        if (r.scr && Array.isArray(r.scr.tables)) r.scr.tables = r.scr.tables.map((t) => Object.assign({}, t, { th: safeHeads([t.th])[0] || [] }));
        page.scr = r.scr;
        if (pg.pay) {
          // 0.1.13: רשימות בחירה קצרות (סוג דוח, קופה, סניף, אמצעי תשלום…) – רק תווית מוכרת ולא של אנשים / לקוחות; בלי לפתוח (sanitize.js listSafe)
          const L = (await inIso(tab, (g) => (self.CxSel.onPath(window, g) ? self.CxSel.lists(document) : { wrong: true }), [GUARD])) || [];
          if (L.wrong) throw wrongPage();
          page.lists = (Array.isArray(L) ? L : []).map((x) => { const v = S.listSafe(x.lbl, x.opts, (S0.branch || {}).names); return v ? Object.assign({ kind: x.kind, n: x.n }, v, x.opts ? {} : { opts: [] }) : { kind: x.kind, n: x.n, lbl: '?' }; });
        }
      }
      rep.pages.push(page);
    }
    // בקשות שנרשמו מאז הדף הפרטי הראשון (pv): כל מקטע נתיב עם ספרה → '?' (מזהי לקוח/עובד)
    rep.net = ((await inMain(tab, () => window.__cxHook && window.__cxHook.netLog())) || []).map((e) => (e && e.pv ? Object.assign({}, e, { p: String(e.p || '').split('/').map((x) => (/\d/.test(x) ? '?' : x)).join('/') }) : e));
    // 0.1.13: לקוחות הקפה בנחל לכיש (החלפת סניף רק כאן – אחרי כל הדפים ואחרי יומן הרשת, כי כספית טוענת את הדף מחדש; לא בדפי pay), וחזרה ליהודה הנשיא
    if (S0.discBranch) { brUsed = true; rep.brDisc = await discBranch(tab, S0, day); }
    rep.ok = true;
  } catch (e) {
    rep.err = { code: e.code || 'fail', msg: String(e.message || '').slice(0, 200) };
  } finally {
    // 0.1.13: אחרי החלפת סניף בהיכרות – בדיקה אחרונה שכספית ביהודה הנשיא (ואם לא – החזרה); כישלון → branch-restore בדוח
    if (tab && brUsed) {
      try { await brHome(tab); rep.brEnd = 'ok'; } catch (e) { rep.brEnd = e.code || 'branch-restore'; rep.ok = false; if (!rep.err) rep.err = { code: 'branch-restore', msg: String(e.message || '').slice(0, 200) }; }
    }
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
      disc: disc ? { at: disc.at, size: disc.size, ok: !!(disc.rep && disc.rep.ok), login: !!(disc.rep && disc.rep.login) } : null, discSt: discSt || null, imp: (await sel()).importEnabled === true, upd: (await get('upd')) || null, today: (await get('todaySt')) || null, capsToday: !!((await get('caps')) || {}).today, hrs: (await get('hrsSt')) || null };
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
// discBr (0.1.13): היכרות הלקוחות בנחל לכיש לבד (בלי כל ההיכרות) + הסניף הנבחר אחרי
const discBrTest = async () => { const tab = await ownTab(false); const out = await discBranch(tab, await sel(), D.addDays(D.dayStr(Date.now(), (await sched()).tz), -1)); const r = await brRead(tab, await brCfg(), 5e3); return { out, cur: r && r.cur }; };
// hrsRun (0.1.14): שעות העובדים מיד, בלי חלון הבוקר – full: גם החודש הקודם אם now בימים 1–5 (כמו בלילה)
const hrsRunTest = async (o) => { const x = o || {}, now = x.now || Date.now(); return runHours('t' + Date.now(), HR.monthsFor(D.dayStr(now, (await sched()).tz), !x.full)); };
self.__cxTest = { discBr: discBrTest, sel, trigger, tick, startAuto, resume, setupAlarms, startRun, pollOnce, updInfo, updTick, todayTick, hoursTick, hrsRun: hrsRunTest, updReq, reload: null, isBusy: () => busy };
