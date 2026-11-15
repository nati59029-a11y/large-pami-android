'use strict';
// סריקת חנות בתלת מימד – שלב 10 (14.11.2026): הלוגיקה הטהורה של "השרת הנלווה", בלי Firestore (נבדקת ב-Node בלי אמולטור).
// המקור המחייב: חוזה הנתונים, סעיפים 4.2 (משקלות), 4.8 (sum), 4.10 (sc, ovr), 4.11, 4.12, 4.13, 4.14, 4.16, 5.1 (שמירה), ע5 (סל מחזור).
//   weights(w)              – משקלות הציון מ-s3set.w: 4 מפתחות p/h/o/d, שלמים 0–100, סכום 100; אחרת ברירת המחדל 35/30/20/15.
//   hardIdx / effAi / effSt – בעיות "קשות" (לא אזהרה ולא מבוטלות בערעור ai.ovr) והמצב האפקטיבי של התוצאה אחרי ערעור.
//   scoreSlot(ai, w)        – ציון למקום צילום 0–100 לכל קטגוריה ובסך הכל. "לבדיקה" (review) ואזהרות לא מורידים ציון.
//   runSum(entries, run, w, prev) – סיכום סבב (srun.sum): ספירות, ציון לפי קטגוריה וציון כולל, השוואה לסבב הקודם.
//   shortList(entries, run) – רשימת חוסרים להזמנה (s3short): ai.miss + בעיות low/hole, בלי מבוטלות, בלי כפילויות, עד 200.
//   fixTasks(entries, run, runId, now, due) – משימות תיקון אוטומטיות (s3fix) למקומות עם בעיה קשה, לעובד שהמקטע שלו.
//   verifyResult(fix, origKinds, ai) – תוצאת צילום אימות: ok / rej / sent (לבדיקת מנהל) / null (תמונה לא שמישה – בלי שינוי).
//   perfAll(month, runs, fixes, appeals) – סיכומי ביצועי עובדים לחודש (s3perf), מחושבים מחדש מהנתונים (אידמפוטנטי).
//   keepPlan(files, now, keep, groupOf) – שמירת 3 סבבים אחרונים לכל מפה + מקום צילום (חנות ומחסן של אותו סניף בנפרד; דיווחים
//                             יזומים בשמירה נפרדת משלהם – תיקון סבב 1): אילו קבצים של סבבים ישנים יותר נמחקים.
//   binPurge(map, now)      – סל המחזור במפה: רק פריטים עם del:1 ש-delAt שלהם לפני 30 יום ומעלה. פריט חי לעולם לא נבחר.
//   texOrphans(files, refs, lastUse, now) – קובצי טקסטורה שאינם במפה הנוכחית, ו-30 יום ומעלה עברו מאז שהפסיקו להיות בשימוש
//                             (זמן הגרסה האחרונה שבה הופיעו; בלי גרסה – זמן יצירת הקובץ).
//   panoClean(files, docs, now) – שלב 18א: קובצי 360 של גרסאות קודמות ונקודות שנמחקו לפני 30 יום ומעלה.
//   monthRange(t)           – תחילת וסוף חודש לפי שעון ישראל, ומפתח החודש.
//   secLatest / secText     – שלב 13ב: סיכום קצר של סבבי הסריקה להקשר של המזכירה (secChat): הסבב האחרון שהסתיים בכל מפה
//                             (בסניפים המותרים בלבד), ציון ושינוי, בעיות, קטגוריות חלשות, חוסרים, ומשימות תיקון פתוחות.

const TK = require('./tk-time');

const D1 = 86400000;
const BIN_DAYS = 30, TEX_DAYS = 30, KEEP_RUNS = 3, YOUNG_MS = D1; // קובץ צעיר מיום לא נמחק (בקשה שעוד בדרך)
const W_DEF = Object.freeze({ p: 35, h: 30, o: 20, d: 15 });
const CAT = { noprice: 'p', pricepos: 'p', promoexp: 'p', hole: 'h', low: 'h', missing: 'h', face: 'o', order: 'o', misplaced: 'o', damaged: 'd', fallen: 'd', upside: 'd' };
const CATS = ['p', 'h', 'o', 'd'];
const SEV_PEN = [0, 15, 30, 50];       // הורדה לבעיה לפי חומרה 1/2/3 (הנחה – אפשר לכוונן)
const SCORED = ['ok', 'issue', 'review'];
const LOW_CONF = 0.6;
const LISTS = ['rooms', 'walls', 'cols', 'doors', 'fx', 'syms', 'tx'];
const RE_FIX = /^[A-Za-z0-9_-]{6,80}$/;

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const inR = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const clampI = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

// ---------- ציון ----------
function weights(w) {
  if (!isObj(w) || Object.keys(w).length !== 4 || !CATS.every((k) => inR(w[k], 0, 100))) return Object.assign({}, W_DEF);
  return CATS.reduce((s, k) => s + w[k], 0) === 100 ? { p: w.p, h: w.h, o: w.o, d: w.d } : Object.assign({}, W_DEF);
}
const issOf = (ai) => (isObj(ai) && Array.isArray(ai.iss) ? ai.iss : []);
// בעיה מבוטלת בהכרעת ערעור: ai.ovr[ik] == 'acc', או ai.ovr.all == 'acc' (כל התוצאה)
function overridden(ai, i) {
  const o = isObj(ai) && isObj(ai.ovr) ? ai.ovr : null;
  return !!o && (o.all === 'acc' || o[String(i)] === 'acc');
}
// אינדקסים של בעיות קשות: לא אזהרה (warn) ולא מבוטלות
const hardIdx = (ai) => issOf(ai).map((x, i) => (isObj(x) && x.warn !== true && CAT[x.k] && !overridden(ai, i) ? i : -1)).filter((i) => i >= 0);
// המצב אחרי ערעור: ok/issue/review מחושב מחדש; bad/person/skip נשארים
function effSt(ai) {
  if (!isObj(ai) || !SCORED.includes(ai.st)) return isObj(ai) ? ai.st : '';
  if (hardIdx(ai).length) return 'issue';
  if (ai.st === 'review') return 'review';
  return issOf(ai).some((x, i) => isObj(x) && !overridden(ai, i) && typeof x.conf === 'number' && x.conf < LOW_CONF) ? 'review' : 'ok';
}
// עותק של ai שבו בעיות מבוטלות מסומנות כאזהרה – לשימוש ב-sumEntry (צבע ומספר בעיות ב-s3sum)
function effAi(ai) {
  if (!isObj(ai)) return ai;
  return Object.assign({}, ai, { st: effSt(ai), iss: issOf(ai).map((x, i) => (overridden(ai, i) && isObj(x) ? Object.assign({}, x, { warn: true }) : x)) });
}
// ציון מקום צילום: לכל קטגוריה 100 פחות ההורדות של הבעיות הקשות שלה (לא פחות מ-0); all = ממוצע משוקלל. null = לא נבדק (bad/person/skip)
function scoreSlot(ai, w) {
  if (!isObj(ai) || !SCORED.includes(ai.st)) return null;
  const W = weights(w), sc = { p: 100, h: 100, o: 100, d: 100 };
  for (const i of hardIdx(ai)) {
    const x = ai.iss[i], c = CAT[x.k];
    sc[c] = Math.max(0, sc[c] - SEV_PEN[inR(x.sev, 1, 3) ? x.sev : 2]);
  }
  sc.all = clampI(CATS.reduce((s, k) => s + sc[k] * W[k], 0) / 100, 0, 100);
  return sc;
}

// ---------- סיכום סבב (4.8 sum) ----------
// entries = [[slot, ai], ...] של הסבב; run = מסמך הסבב; prev = { runId, score } של הסבב הקודם באותה מפה, או null
function runSum(entries, run, w, prev) {
  const c = { nOk: 0, nIss: 0, nRev: 0, nBad: 0 };
  const tot = { p: 0, h: 0, o: 0, d: 0 };
  let k = 0;
  for (const [, ai] of entries || []) {
    if (!isObj(ai)) continue;
    const st = effSt(ai);
    if (st === 'ok') c.nOk++; else if (st === 'issue') c.nIss++; else if (st === 'review') c.nRev++; else if (st === 'bad' || st === 'person') c.nBad++;
    const sc = scoreSlot(ai, w);
    if (sc) { k++; for (const x of CATS) tot[x] += sc[x]; }
  }
  const n = isObj(run) && inR(run.n, 0, 4000) ? run.n : 0;
  const W = weights(w);
  const cat = { p: 0, h: 0, o: 0, d: 0 };
  let score = 0;
  if (k) {
    for (const x of CATS) cat[x] = clampI(tot[x] / k, 0, 100);
    score = clampI(CATS.reduce((s, x) => s + (tot[x] / k) * W[x], 0) / 100, 0, 100);
  }
  const lim = (v) => Math.min(4000, v);
  const sum = { score, nOk: lim(c.nOk), nIss: lim(c.nIss), nRev: lim(c.nRev), nMiss: lim(Math.max(0, n - c.nOk - c.nIss - c.nRev - c.nBad)), nBad: lim(c.nBad), cat, prev: '', dScore: 0 };
  if (isObj(prev) && typeof prev.runId === 'string' && inR(prev.score, 0, 100)) { sum.prev = prev.runId; sum.dScore = clampI(score - prev.score, -100, 100); }
  return sum;
}
// הסבב הקודם באותה מפה: הסבב האחרון שהסתיים (done/closed) לפני שהסבב הזה נפתח, עם sum. סבבים יזומים לא נחשבים.
// list = [[runId, {st, k, doneAt, sum}], ...]
function prevRun(list, runId, openAt) {
  let best = null;
  for (const [id, r] of list || []) {
    if (id === runId || !isObj(r) || r.k === 'adhoc' || !['done', 'closed'].includes(r.st) || !Number.isInteger(r.doneAt) || r.doneAt > openAt) continue;
    if (!isObj(r.sum) || !inR(r.sum.score, 0, 100)) continue;
    if (!best || r.doneAt > best.doneAt) best = { runId: id, score: r.sum.score, doneAt: r.doneAt };
  }
  return best ? { runId: best.runId, score: best.score } : null;
}

// ---------- בעלי המקטעים ----------
const bayOf = (slot) => String(slot).split('_')[0];
function ownerOf(run, bay) {
  const a = isObj(run) && isObj(run.asg) ? run.asg : {};
  return Object.keys(a).find((u) => Array.isArray(a[u]) && a[u].includes(bay)) || '';
}

// ---------- רשימת חוסרים (4.14) ----------
const LOW_TXT = { low: 'מוצר שנגמר', hole: 'חור במדף' };
function shortList(entries) {
  const items = [], seen = new Set();
  const add = (it) => {
    if (items.length >= 200) return;
    const key = it.why + '|' + it.bay + '|' + it.n;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(it);
  };
  for (const [slot, ai] of entries || []) {
    if (!isObj(ai) || !SCORED.includes(ai.st) || (isObj(ai.ovr) && ai.ovr.all === 'acc')) continue;
    const bay = bayOf(slot), c = str(ai.cat, 30);
    for (const m of Array.isArray(ai.miss) ? ai.miss : []) {
      const n = isObj(m) ? str(m.n, 60) : '';
      if (!n) continue;
      const it = { n, c, bay, why: 'miss' };
      if (typeof m.pid === 'string' && m.pid) it.pid = m.pid.slice(0, 60);
      add(it);
    }
    for (const i of hardIdx(ai)) {
      const x = ai.iss[i];
      if (x.k !== 'low' && x.k !== 'hole') continue;
      add({ n: str(x.t, 60) || LOW_TXT[x.k], c, bay, why: x.k });
    }
  }
  return items;
}

// ---------- משימות תיקון (4.12) ----------
// מזהה דטרמיניסטי <runId>__<slot> ⇒ אין שתי משימות לאותה בעיה באותו סבב
const fixId = (runId, slot) => runId + '__' + slot;
function fixTasks(entries, run, runId, now, due) {
  const days = inR(due, 1, 14) ? due : 2;
  const out = [];
  for (const [slot, ai] of entries || []) {
    const iks = hardIdx(ai).filter((i) => i <= 29).slice(0, 30);
    if (!iks.length || effSt(ai) !== 'issue') continue;
    const u = ownerOf(run, bayOf(slot));
    const id = fixId(runId, slot);
    if (!u || !RE_FIX.test(id)) continue;
    out.push({ id, doc: { run: runId, slot, map: run.map, br: run.br, iks, by: 'ai', u, st: 'open', at: now, dueAt: now + days * D1 } });
  }
  return out;
}
// צילום אימות. fix = s3fix, origKinds = סוגי הבעיות המקוריות (לפי iks), ai = התוצאה החדשה (אחרי cleanShelf).
// מחזיר 'ok' / 'rej' / 'sent' (ממתין להכרעת מנהל), או null = התמונה לא שמישה (bad/person) – המשימה לא משתנה.
function verifyResult(fix, origKinds, ai) {
  if (!isObj(ai) || !SCORED.includes(ai.st)) return null;
  const manual = !isObj(fix) || !Array.isArray(fix.iks) || !fix.iks.length || !Array.isArray(origKinds) || !origKinds.length;
  if (manual) return 'sent'; // משימה ידנית: ה-AI לא יודע מה בדיוק התבקש – המנהל מכריע (s3Fix decide)
  const hard = new Set(hardIdx(ai).map((i) => ai.iss[i].k));
  if (origKinds.some((k) => hard.has(k))) return 'rej';
  return ai.st === 'review' ? 'sent' : 'ok';
}

// ---------- חודש לפי שעון ישראל ----------
function monthRange(t) {
  const o = TK.ymdOf(t);
  const y2 = o.m === 11 ? o.y + 1 : o.y, m2 = (o.m + 1) % 12;
  return { key: o.y + '-' + String(o.m + 1).padStart(2, '0'), start: TK.zoned(o.y, o.m, 1, 0, 0), end: TK.zoned(y2, m2, 1, 0, 0) };
}
const inMonth = (t, r) => Number.isInteger(t) && t >= r.start && t < r.end;

// ---------- ביצועי עובדים (4.16) ----------
// runs = [{ id, d: srun, ph: [{ by, rt, person }] }] – סבבים שהסתיימו (doneAt בחודש); fixes = [s3fix]; appeals = [s3appeal].
// מחזיר { uid: מסמך } – מחושב מחדש מהנתונים בכל ריצה, לכן ריצה כפולה לא סופרת פעמיים. עובד שעזב נשאר (לא מסננים לפי פעיל).
const ZERO = () => ({ runs: 0, onTime: 0, late: 0, work: 0, pause: 0, pauses: 0, photos: 0, retakes: 0, fixOk: 0, fixRej: 0, appeals: 0, appAcc: 0 });
const MAXP = { runs: 1000, onTime: 1000, late: 1000, work: 100000, pause: 100000, pauses: 10000, photos: 100000, retakes: 100000, fixOk: 10000, fixRej: 10000, appeals: 10000, appAcc: 10000 };
const RE_UID = /^[A-Za-z0-9_-]{6,128}$/;
function perfAll(range, runs, fixes, appeals) {
  const out = {};
  const me = (u) => (RE_UID.test(String(u)) ? (out[u] = out[u] || ZERO()) : null);
  for (const r of runs || []) {
    const d = r && r.d;
    if (!isObj(d) || !['done', 'closed'].includes(d.st) || !inMonth(d.doneAt, range)) continue;
    if (d.k !== 'adhoc') {
      for (const u of Object.keys(isObj(d.nUid) ? d.nUid : {})) {
        const x = d.nUid[u];
        if (!isObj(x) || !(x.n > 0)) continue;
        const p = me(u);
        if (!p) continue;
        p.runs++;
        const l = isObj(d.tlog) && Array.isArray(d.tlog[u]) ? d.tlog[u] : [];
        const end = [...l].reverse().find((e) => isObj(e) && e.k === 'e');
        // בזמן: העובד רשם סיום עד המועד, או (בלי רישום סיום) הסבב הסתיים בזמן
        if (end ? Number.isInteger(end.t) && end.t <= d.dueAt : d.st === 'done') p.onTime++; else p.late++;
        if (isObj(d.work) && Number.isInteger(d.work[u])) p.work += d.work[u];
        if (isObj(d.pause) && Number.isInteger(d.pause[u])) p.pause += d.pause[u];
        p.pauses += l.filter((e) => isObj(e) && e.k === 'p').length;
      }
    }
    for (const ph of Array.isArray(r.ph) ? r.ph : []) {
      const p = isObj(ph) ? me(ph.by) : null;
      if (!p) continue;
      p.photos++;
      if (Number.isInteger(ph.rt) && ph.rt > 0) p.retakes += ph.rt;
    }
  }
  for (const f of fixes || []) {
    if (!isObj(f) || !inMonth(f.doneAt, range)) continue;
    const p = me(f.u);
    if (!p) continue;
    if (f.st === 'ok') p.fixOk++; else if (f.st === 'rej') p.fixRej++;
  }
  for (const a of appeals || []) {
    if (!isObj(a) || !inMonth(a.at, range)) continue;
    const p = me(a.by);
    if (!p) continue;
    p.appeals++;
    if (a.st === 'acc') p.appAcc++;
  }
  for (const u of Object.keys(out)) for (const k of Object.keys(MAXP)) out[u][k] = Math.min(MAXP[k], out[u][k]);
  return out;
}

// ---------- שמירת תמונות: 3 סבבים אחרונים לכל מקום צילום (5.1, תשובה 53) ----------
// files = [{ name, t }] – כל הקבצים תחת b/{biz}/store3d/{br}/run/ (t = זמן יצירה במילישניות). שם: .../run/{runId}/{slot}_{n}(_t).jpg
// מחזיר { drop: [{ runId, slot, names: [...] }] } – הקבצים של כל סבב שמעבר ל-3 האחרונים (לפי הקובץ החדש ביותר שלו) לאותו מקום.
// קובץ שנוצר ביום האחרון לא נבחר. קבצים בשם לא מוכר – לא נוגעים.
const RE_RUNFILE = /\/run\/([A-Za-z0-9_-]{6,60})\/(f[0-9]{1,4}-[ab]-[0-9]{1,2}_[atb])_([0-9]{1,2})(_t)?\.jpg$/;
function parseRunFile(name) {
  const m = RE_RUNFILE.exec(String(name));
  return m ? { runId: m[1], slot: m[2], n: +m[3], thumb: !!m[4] } : null;
}
// הקבוצה של סבב (תיקון סבב 1): המפה שלו (חנות s-<br> ומחסן w-<br> משתפים את תיקיית run/ של הסניף, ושמות המקומות חוזרים בשתיהן),
// ובנפרד סבבים רגילים ודיווחים יזומים (ad_), כדי שדיווחים יזומים לא ידחקו החוצה תמונות של סבבים.
// runMap = { runId: mapId } (מ-srun.map). סבב בלי מפה ידועה – null: הקבצים שלו לא נבחרים למחיקה.
function runGroup(runId, runMap) {
  const m = runMap && typeof runMap[runId] === 'string' ? runMap[runId] : '';
  if (!/^[sw]-[a-z0-9_]{2,20}$/.test(m)) return null;
  return m + '|' + (/^ad_/.test(runId) ? 'ad' : 'run');
}
function keepPlan(files, now, keep, runMap) {
  const K = inR(keep, 1, 50) ? keep : KEEP_RUNS;
  const byKey = new Map();
  for (const f of files || []) {
    const p = parseRunFile(f && f.name);
    if (!p || !Number.isFinite(f.t)) continue;
    const g = runGroup(p.runId, runMap);
    if (!g) continue;
    const key = g + '|' + p.slot;
    if (!byKey.has(key)) byKey.set(key, new Map());
    const runs = byKey.get(key);
    const r = runs.get(p.runId) || { t: 0, names: [] };
    r.t = Math.max(r.t, f.t);
    r.names.push({ name: f.name, t: f.t });
    runs.set(p.runId, r);
  }
  const drop = [];
  for (const [key, runs] of byKey) {
    const slot = key.split('|')[2];
    const L = [...runs.entries()].sort((a, b) => b[1].t - a[1].t || (a[0] < b[0] ? 1 : -1));
    for (const [runId, r] of L.slice(K)) {
      const names = r.names.filter((x) => x.t <= now - YOUNG_MS).map((x) => x.name).sort();
      if (names.length) drop.push({ runId, slot, names });
    }
  }
  return { drop };
}
// קבצים "יתומים" בסבב שנשמר: קבצים של מקום צילום שאינם ph.p / ph.th שלו (למשל שמירה שנכשלה באמצע), ישנים מיום.
// files = [{ name, t }] של סבב ומקום אחד; ph = מסמך ph (או null)
function strayFiles(files, ph, now) {
  // שלב 14 (החלטה): מסמך ph חסר = לא מוחקים. אי אפשר להבחין בין שמירה שנכשלה לבין מסמך שאבד (ושעשוי לחזור מגיבוי);
  // קובץ יתום כזה יימחק ממילא כשהסבב ייצא מ-3 הסבבים האחרונים (keepPlan)
  if (!isObj(ph)) return [];
  const keep = new Set(isObj(ph) ? [ph.p, ph.th].filter((x) => typeof x === 'string') : []);
  return (files || []).filter((f) => f && !keep.has(f.name) && Number.isFinite(f.t) && f.t <= now - YOUNG_MS).map((f) => f.name);
}

// ---------- סל המחזור במפה (ע5): מחיקה סופית רק של מה שסומן כמחוק לפני 30 יום ומעלה ----------
// מחזיר { map, purged: { list: [ids] }, n } – map בלי הפריטים שנמחקו סופית (או null כשאין מה למחוק)
const expired = (o, now, days) => isObj(o) && o.del === 1 && Number.isInteger(o.delAt) && o.delAt <= now - (days || BIN_DAYS) * D1;
function binPurge(map, now) {
  if (!isObj(map)) return { map: null, purged: {}, n: 0 };
  const out = Object.assign({}, map), purged = {};
  let n = 0;
  // תיקון סבב 1: טקסטורה שחדר שנשאר במפה (חי, או בסל ועוד לא נמחק סופית) מפנה אליה – לא נמחקת
  const keepRooms = (Array.isArray(map.rooms) ? map.rooms : []).filter((r) => !expired(r, now));
  const usedTex = new Set();
  for (const r of keepRooms) if (isObj(r) && isObj(r.tex)) for (const k of ['w', 'f', 'c']) if (typeof r.tex[k] === 'string') usedTex.add(r.tex[k]);
  for (const list of LISTS) {
    if (!Array.isArray(map[list])) continue;
    const gone = map[list].filter((o) => expired(o, now) && !(list === 'tx' && usedTex.has(o.id)));
    if (!gone.length) continue;
    const g = new Set(gone);
    out[list] = map[list].filter((o) => !g.has(o));
    purged[list] = gone.map((o) => o.id);
    n += gone.length;
  }
  // הכניסה הראשית לא יכולה להצביע על דלת שנמחקה סופית (ממילא דלת מחוקה לא נשמרת כ-ent)
  if (n && out.ent && !(out.doors || []).some((d) => d.id === out.ent)) delete out.ent;
  return { map: n ? out : null, purged, n };
}

// ---------- טקסטורות יתומות ----------
// files = [{ name, t }] בתיקיית tex/{mapId}/; refs = Set של נתיבים שמופיעים ב-tx של המפה (כולל סל המחזור) ושל כל גרסה שמורה.
// refs = נתיבים במפה הנוכחית (כולל סל המחזור) – לא נמחקים. lastUse = Map(נתיב → זמן הגרסה האחרונה שבה הופיע, ver.at = הרגע שבו
// הגרסה הזו הוחלפה). "30 יום" נספרים מהרגע שהטקסטורה הפסיקה להיות בשימוש (תיקון סבב 1); בלי גרסה – מזמן יצירת הקובץ.
function texOrphans(files, refs, lastUse, now) {
  const R = refs instanceof Set ? refs : new Set(refs || []);
  const U = lastUse instanceof Map ? lastUse : new Map();
  return (files || []).filter((f) => {
    if (!f || !/\/tex\/[sw]-[a-z0-9_]{2,20}\/t[0-9]{1,4}_[0-9]{1,2}\.jpg$/.test(f.name) || R.has(f.name) || !Number.isFinite(f.t)) return false;
    const t = Math.max(f.t, U.has(f.name) ? U.get(f.name) : 0);
    return t <= now - TEX_DAYS * D1;
  }).map((f) => f.name);
}
// שלב 18א – סיור 360. files = [{ name, t }] בתיקייה pano/{mapId}/; docs = Map(pid → מסמך הנקודה). מחזיר { files: [שמות], docs: [pid] }:
//   קובץ של הגרסה הנוכחית של נקודה פעילה – לא נמחק לעולם. גרסה קודמת – 30 יום אחרי ההחלפה (at של הגרסה הנוכחית).
//   נקודה שנמחקה (del:1) לפני 30 יום ומעלה – כל הקבצים שלה, והמסמך (רק אחרי שכל הקבצים נמחקו – ב-s3Clean).
//   קובץ בלי מסמך, או של גרסה שלא נכנסה (העלאה שנכשלה) – 30 יום אחרי שנוצר. קובץ צעיר מיום – לא נמחק.
const RE_PANO_F = /\/pano\/[sw]-[a-z0-9_]{2,20}\/(p[0-9]{1,4})_([0-9]{1,4})(_s)?\.jpg$/;
function panoClean(files, docs, now) {
  const D = docs instanceof Map ? docs : new Map();
  const old = now - BIN_DAYS * D1;
  const gone = (d) => isObj(d) && d.del === 1 && Number.isInteger(d.delAt) && d.delAt <= old;
  const out = [];
  for (const f of files || []) {
    const m = f && RE_PANO_F.exec(f.name);
    if (!m || !Number.isFinite(f.t) || f.t > now - YOUNG_MS) continue;
    const d = D.get(m[1]), ver = +m[2];
    if (!isObj(d)) { if (f.t <= old) out.push(f.name); continue; }
    if (gone(d)) { out.push(f.name); continue; }
    if (d.del === 1 || ver === d.ver) continue;
    const t = ver < d.ver && Number.isInteger(d.at) ? Math.max(f.t, d.at) : (ver < d.ver ? now : f.t);
    if (t <= old) out.push(f.name);
  }
  return { files: out, docs: [...D.keys()].filter((k) => gone(D.get(k))) };
}
// רשומות audit: שורות היומן מחולקות לחלקים של עד max תווים, בלי לחתוך שורה (שורה ארוכה מדי לבדה – מתפצלת לחתיכות). תיקון סבב 1
function splitNote(lines, max) {
  const M = inR(max, 50, 100000) ? max : 1500, out = [];
  let cur = '';
  for (const l0 of lines || []) {
    for (let l = String(l0); l.length;) {
      const piece = l.slice(0, M); l = l.slice(M);
      if (cur && cur.length + 3 + piece.length > M) { out.push(cur); cur = ''; }
      cur = cur ? cur + ' | ' + piece : piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}
const txPaths = (m) => (isObj(m) && Array.isArray(m.tx) ? m.tx.filter((t) => isObj(t) && typeof t.path === 'string').map((t) => t.path) : []);

// ---------- שלב 13ב: סיכום למזכירה ----------
const SEC_DAYS = 60;      // כמה ימים אחורה מחפשים את הסבב האחרון שהסתיים (הנחה)
const SEC_MAPS = 6;       // עד כמה מפות בסיכום – כדי לא להגדיל את ההקשר
const SEC_WEAK = 70;      // קטגוריה "חלשה" = ציון מתחת ל-70 (הנחה)
const SEC_FIX = ['open', 'sent', 'rej'];
const CAT_HE = { p: 'מחירים', h: 'חורים וחוסרים', o: 'סדר וחזית', d: 'נזק' };
const RE_BR = /^[a-z0-9_]{2,20}$/;
const brOk = (br, brs) => typeof br === 'string' && RE_BR.test(br) && (!Array.isArray(brs) || brs.includes(br));
// list = [[runId, {st, k, br, map, doneAt, sum}], ...]; brs = הסניפים המותרים (null = כל העסק). מחזיר [[runId, run], ...], החדש קודם
function secLatest(list, brs) {
  const best = {};
  for (const [id, r] of list || []) {
    if (!isObj(r) || r.k === 'adhoc' || !['done', 'closed'].includes(r.st) || !Number.isInteger(r.doneAt)) continue;
    if (!isObj(r.sum) || !inR(r.sum.score, 0, 100) || typeof r.map !== 'string' || !brOk(r.br, brs)) continue;
    if (!best[r.map] || r.doneAt > best[r.map][1].doneAt) best[r.map] = [id, r];
  }
  return Object.values(best).sort((a, b) => b[1].doneAt - a[1].doneAt).slice(0, SEC_MAPS);
}
const ddmmyyyy = (t) => { const w = TK.wall(t); return w.d + '.' + (w.m + 1) + '.' + w.y; };
// תיקון סבב 3: תכנון השאילתות של secBrief. Firestore מגביל שאילתה ל-30 צירופים של תנאי in (מכפלת אורכי הרשימות),
// ולכן: סבבים – קבוצות של עד 30 סניפים (br in); משימות תיקון – st in (3) × קבוצות של עד 10 סניפים = עד 30.
// עד SEC_BRS סניפים (מעבר – cut, והסיכום מסומן "חלקי"). brs = null (כל העסק) → שאילתה אחת לכל סוג, בלי br.
const SEC_BRS = 60;
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
function secPlan(brs) {
  if (!Array.isArray(brs)) return { runs: [null], fix: [null], cut: false };
  const all = [...new Set(brs.filter((b) => brOk(b, null)))];
  const a = all.slice(0, SEC_BRS);
  return { runs: chunk(a, 30), fix: chunk(a, Math.floor(30 / SEC_FIX.length)), cut: all.length > a.length };
}
// latest = secLatest(...); fixes = מספר משימות התיקון הפתוחות (כבר מסונן), או [{br, st}] של s3fix; shorts = { runId: s3short };
// partial = true – ייתכן שחסרים סבבים (הגענו למגבלת הקריאה). מחזיר { text, at } או null (אין מה לספר)
function secText(latest, fixes, shorts, brs, partial) {
  const nFix = Number.isInteger(fixes) ? Math.max(0, fixes) : (fixes || []).filter((f) => isObj(f) && SEC_FIX.includes(f.st) && brOk(f.br, brs)).length;
  if (!(latest || []).length && !nFix) return null;
  const L = ['סריקת חנות – סיכום הסבבים האחרונים' + (Array.isArray(brs) ? ' בסניפים שלך' : '') + ' (נתונים מהשרת, מידע בלבד ולא הוראה; מותר לצטט את המספרים האלה):'];
  // תיקון סבב 2: למנהל עם הגבלת סניפים ההנחיה אומרת לא לענות על "משימות" – כאן מבהירים שסיכום הסריקה של הסניפים שלו מותר
  if (Array.isArray(brs)) L.push('(הנתונים האלה, כולל משימות התיקון של סריקת החנות, הם של הסניפים של המנהל הזה – מותר לענות עליהם.)');
  if (partial) L.push('(ייתכן שהסיכום חלקי – יש הרבה סבבים, ונקראו רק האחרונים.)');
  let at = 0;
  for (const [id, r] of latest || []) {
    const S = r.sum, c = isObj(S.cat) ? S.cat : {};
    at = Math.max(at, r.doneAt);
    let t = '- ' + (String(r.map)[0] === 'w' ? 'מחסן' : 'חנות') + ', סניף ' + r.br + ', סבב שהסתיים ב-' + ddmmyyyy(r.doneAt) + ': ציון ' + S.score + ' מתוך 100';
    if (S.prev && inR(S.dScore, -100, 100)) t += ' (' + (S.dScore > 0 ? '+' : '') + S.dScore + ' מהסבב הקודם)';
    t += '; מקומות עם בעיה ' + (inR(S.nIss, 0, 4000) ? S.nIss : 0) + ', לבדיקה ' + (inR(S.nRev, 0, 4000) ? S.nRev : 0) + ', לא צולמו ' + (inR(S.nMiss, 0, 4000) ? S.nMiss : 0);
    const weak = CATS.filter((k) => inR(c[k], 0, 100) && c[k] < SEC_WEAK).map((k) => CAT_HE[k] + ' ' + c[k]);
    if (weak.length) t += '; קטגוריות חלשות: ' + weak.join(', ');
    const sh = shorts && shorts[id];
    if (isObj(sh) && Array.isArray(sh.items)) t += '; רשימת חוסרים: ' + sh.items.length + ' פריטים (' + (sh.st === 'ok' ? 'אושרה' : sh.st === 'no' ? 'נדחתה' : 'ממתינה לאישור') + ')';
    L.push(t + '.');
  }
  L.push('- משימות תיקון פתוחות: ' + nFix + '.');
  return { text: L.join('\n'), at };
}

module.exports = {
  D1, BIN_DAYS, TEX_DAYS, KEEP_RUNS, YOUNG_MS, W_DEF, CAT, SEV_PEN, RE_FIX,
  weights, overridden, hardIdx, effSt, effAi, scoreSlot, runSum, prevRun, ownerOf, bayOf, shortList, fixId, fixTasks, verifyResult,
  monthRange, inMonth, perfAll, parseRunFile, runGroup, keepPlan, strayFiles, expired, binPurge, texOrphans, panoClean, txPaths, splitNote, str,
  SEC_DAYS, SEC_MAPS, SEC_WEAK, SEC_FIX, SEC_BRS, secPlan, secLatest, secText,
};
