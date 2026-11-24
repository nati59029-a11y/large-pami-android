'use strict';
// גיטי – מרכז תקשורת (23.11.2026, "גיטי מנהלת עסק", סבב 3 חלק א, החלטות 1–2). קריאה בלבד – לא כותב שום דבר.
//   secComm({ op:'feed', ch?: 'all'|'mail'|'wa'|'grp', st?: 'all'|'open', before?: ms, limit?: 1..50 })
//     פיד אחד, מהחדש לישן: מייל (sec_in ch:'mail'), ווצאפ עסקי (sec_in ch:'wa', בלי הודעות אישיות של מנהל – own:'mgr', כמו בלשונית ווצאפ)
//     והודעות מקבוצות פנימיות שהמנהל פתח לגיטי בלבד (sec_cfg/main.grp, נקרא מחדש בכל קריאה – כיבוי עוצר מיד).
//     דפים: before = הזמן של הפריט האחרון שהוצג. פריטים עם אותו זמן בדיוק נכנסים כולם לאותו דף (כדי שלא יידלגו).
//     מצב: מייל – "טופל" (hd / נענה); ווצאפ – נענה / סומן טופל; קבוצה – "לא נקרא" לפי מצב הקריאה של המנהל (grp/{gid}/r/{uid}). st:'open' = רק מה שפתוח.
//     התראות מהטלפון לא כאן: הן נשמרות רק במכשיר ומתמזגות בפיד באפליקציה (sec-comm.js), בלי לעלות לשרת.
//   secComm({ op:'groups' }) – קבוצות העסק עם מצב ההרשאה, למסך ההגדרות. השינוי עצמו – secPrefs op:'grp' (secretary.js).
//   secComm({ op:'cmts' }) – 24.11.2026 (סבב 3 חלק ב): הצעות התחייבות שממתינות לאישור (sec_cmt st:'pend'/'act', עד 30, מהחדשה לישנה) – למרכז האישורים.
//   secComm({ op:'src', cid }) – לאן מוביל הקישור "ההודעה המקורית" של הצעה (גם אחרי שאושרה – מתפריט המשימה): { ch, ref } כמו בפיד.
//     מנהל עם הגבלת סניפים – רק הצעות מקבוצות פנימיות (מייל וווצאפ הם ערוצים של כל העסק). השינוי עצמו – secPrefs op:'cmt'.
// הרשאה: אותו שער כמו כל המזכירה (gate + הסכמה). מייל וווצאפ – כמו secMail list / secInbox list. קבוצות – רק כשתוספת הקבוצות פעילה.

const { onCall } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const GRP = require('./lib/sec-grp');
const PERM = require('./lib/sec-perm'); // 24.11.2026 (סבב 4 חלק א): הרשאות לפי סוג פעולה, לכל מנהל
const C = require('./secretary')._core;
const { gate, bad, wrap } = C;

const PAGE = 50, PREV = 160;
const CHS = ['all', 'mail', 'wa', 'grp'];
const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const lowOf = (s, f) => (s.size ? +s.docs[s.size - 1].get(f) || 0 : 0); // הזמן של המסמך הישן ביותר שנקרא
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function mailItem(id, x) {
  const fl = Array.isArray(x.flags) ? x.flags : [];
  const done = x.hd === true || x.st === 'replied';
  const subj = clean(x.subj, 120), body = clean(x.text || x.sum || '', 400);
  const it = { id: 'mail:' + id, ch: 'mail', t: +x.t || +x.rt || 0, from: clean(x.name, 60) || clean(x.from, 80) || 'שולח לא ידוע', prev: cut([subj, body].filter(Boolean).join(' – '), PREV), done, ref: { id } };
  it.open = !done && x.st !== 'sus' && !fl.some((f) => f === 'hist' || f === 'promo' || f === 'spam');
  if (x.st === 'sus' || fl.includes('sus')) it.sus = true;
  if (fl.includes('file')) it.file = true;
  return it;
}
function waItem(id, x) {
  const done = x.st === 'replied' || x.st === 'handled';
  const txt = clean(x.text || x.tr || '', 400);
  const prev = txt || (x.type === 'audio' ? '[הודעה קולית]' : x.type === 'other' ? '[קובץ / מדיה]' : '');
  const it = { id: 'wa:' + id, ch: 'wa', t: +x.rt || +x.t || 0, from: clean(x.name, 60) || clean(x.from, 30) || 'שולח לא ידוע', prev: cut(prev, PREV), done, open: !done, ref: { wa: clean(x.from, 30) } };
  if (x.st === 'sus' || (Array.isArray(x.flags) && x.flags.includes('sus'))) it.sus = true;
  return it;
}
function grpItem(g, id, x, uid, rt) {
  const kind = GRP.KIND[x.k] || '';
  const txt = clean(x.txt, 400);
  const t = +x.t || 0;
  const unread = x.by !== uid && t > rt;
  return { id: 'grp:' + g.gid + ':' + id, ch: 'grp', t, from: clean(x.byN, 60) || 'משתמש', grp: g.name, prev: cut((kind ? '[' + kind + '] ' : '') + txt, PREV), unread, open: unread, done: null, ref: { gid: g.gid, mid: id } };
}

async function feed(who, db, input) {
  const ch = input.ch === undefined ? 'all' : input.ch;
  if (!CHS.includes(ch)) throw bad('bad-ch', 'ערוץ לא מוכר');
  const st = input.st === undefined ? 'all' : input.st;
  if (!['all', 'open'].includes(st)) throw bad('bad-st', 'מצב לא מוכר');
  const lim = input.limit === undefined ? PAGE : input.limit;
  if (!Number.isInteger(lim) || lim < 1 || lim > PAGE) throw bad('bad-limit', 'מספר פריטים: 1 עד ' + PAGE);
  if (input.before !== undefined && !(Number.isInteger(input.before) && input.before > 0)) throw bad('bad-before', 'ערך לא תקין');
  const before = input.before;
  const grpOn = GRP.grpOn(who);
  const jobs = [];
  if (ch === 'all' || ch === 'mail') {
    let q = db.collection('sec_in').where('ch', '==', 'mail');
    if (before) q = q.where('t', '<', before);
    jobs.push(q.orderBy('t', 'desc').limit(lim).get().then((s) => ({ full: s.size >= lim, low: lowOf(s, 't'), items: s.docs.map((d) => mailItem(d.id, d.data())) })));
  }
  if (ch === 'all' || ch === 'wa') {
    let q = db.collection('sec_in').where('ch', '==', 'wa');
    if (before) q = q.where('rt', '<', before);
    // הודעות אישיות של מנהל (own:'mgr') לא מוצגות – כמו בלשונית ווצאפ. הן תופסות מקום בדף, ולכן "full" ו-low לפי מה שנקרא (לא לפי מה שמוצג)
    jobs.push(q.orderBy('rt', 'desc').limit(lim).get().then((s) => ({ full: s.size >= lim, low: lowOf(s, 'rt'), items: s.docs.filter((d) => d.get('own') !== 'mgr').map((d) => waItem(d.id, d.data())) })));
  }
  let groups = [];
  if (grpOn && (ch === 'all' || ch === 'grp')) {
    // ההרשאה נקראת עכשיו – קבוצה שכובתה לא נקראת, גם אם הלשונית הייתה פתוחה
    groups = await GRP.allowedGroups(db, await GRP.readAllowed(db));
    for (const g of groups) {
      let q = db.collection('grp/' + g.gid + '/m').orderBy('t', 'desc');
      if (before) q = q.where('t', '<', before);
      jobs.push(Promise.all([q.limit(lim).get(), db.doc('grp/' + g.gid + '/r/' + who.uid).get()]).then(([s, r]) => {
        const rt = r.exists && Number.isInteger(r.get('t')) ? r.get('t') : 0;
        return { full: s.size >= lim, low: lowOf(s, 't'), items: s.docs.map((d) => grpItem(g, d.id, d.data(), who.uid, rt)) };
      }));
    }
  }
  const res = await Promise.all(jobs);
  // רצפה: מקור שהגיע לתקרה (full) אולי לא קרא את כל מה שמתחת למסמך הישן ביותר שקרא – ולכן שום פריט (מאף מקור) מתחת לרצפה
  // לא נכנס לדף הזה; הוא יגיע בדף הבא (before = הרצפה). כך הודעה לא נדלגת גם כשמסמכים שנקראו סוננו (own:'mgr')
  const floor = Math.max(0, ...res.filter((r) => r.full).map((r) => r.low || 0));
  const raw = [].concat(...res.map((r) => r.items)).filter((x) => x.t > 0).sort((a, b) => b.t - a.t);
  const all = raw.filter((x) => x.t >= floor);
  // חיתוך הדף: lim פריטים, ועוד כל מה שבאותו זמן בדיוק כמו האחרון (הדף הבא מתחיל ב-before = הזמן הזה)
  let page = all.slice(0, lim), next = null;
  if (all.length > lim) { const tl = page[page.length - 1].t; page = all.filter((x) => x.t >= tl); }
  if (all.length > page.length) next = page[page.length - 1].t;
  else if (floor > 0) next = floor;
  const more = next !== null;
  const items = st === 'open' ? page.filter((x) => x.open) : page;
  return { ok: true, items, more, next, grpOn, groups: groups.map((g) => ({ gid: g.gid, name: g.name })), now: Date.now() };
}

// הצעת התחייבות לתצוגה. ref – אותו מבנה כמו בפיד (mail: { id }, wa: { wa }, grp: { gid, mid })
function cmtItem(id, x) {
  const s = x.src && typeof x.src === 'object' ? x.src : {};
  const ref = x.ch === 'grp' ? { gid: clean(s.gid, 128), mid: clean(s.mid, 128) } : x.ch === 'wa' ? { wa: clean(s.wa, 30) } : { id: clean(s.id, 200) };
  const it = { cid: id, ch: x.ch, t: +x.t || 0, from: clean(x.from, 60), who: x.who === 'me' ? 'me' : 'them', what: clean(x.what, 200), d: typeof x.d === 'string' ? x.d : '', prev: clean(x.prev, PREV), st: x.st, ref };
  if (x.grp) it.grp = clean(x.grp, 60);
  return it;
}
const CMT_MAX = 30;
async function cmts(db, brLimited) {
  // בלי אינדקס מורכב: לפי מצב בלבד, ומיון בזיכרון
  // ממתינות (pend) ובאמצע אישור (act – אם האישור נתקע, אפשר להמשיך). מנהל עם הגבלת סניפים – רק מקבוצות, כבר בשאילתה
  // (הגבלת סניפים: שתי שאילתות של שוויון בלבד – בלי אינדקס מורכב)
  const col = db.collection('sec_cmt');
  const qs = brLimited ? ['pend', 'act'].map((st) => col.where('st', '==', st).where('ch', '==', 'grp').limit(CMT_MAX * 3).get()) : [col.where('st', 'in', ['pend', 'act']).limit(CMT_MAX * 3).get()];
  const docs = [].concat(...(await Promise.all(qs)).map((s) => s.docs));
  const L = docs.map((d) => cmtItem(d.id, d.data())).sort((a, b) => b.t - a.t);
  return { ok: true, items: L.slice(0, CMT_MAX), n: L.length };
}

async function secComm(request) {
  const input = inputObject(request);
  const g = await gate(request, { consent: true });
  const { who, db, brLimited } = g;
  if (input.op === 'feed') return feed(who, db, input);
  if (input.op === 'groups') {
    const on = GRP.grpOn(who);
    if (!on) return { ok: true, on: false, edit: false, groups: [], max: GRP.MAX_ALLOWED };
    return { ok: true, on: true, edit: !!who.superadmin, groups: await GRP.listGroups(db, await GRP.readAllowed(db)), max: GRP.MAX_ALLOWED };
  }
  if (input.op === 'cmts') {
    // 24.11.2026 (גיטי, סבב 4 חלק א): ההרשאות של המנהל המחובר – "אישור התחייבות" אסור → בלי הצעות אצלו. טרם הוגדר ויש הצעות → שאלה בפעם הראשונה
    // החלטות המשתמש 1–2: "לבד" (ו"עצור הכל" כבוי) – auto:true, והאפליקציה מאשרת לבד הצעות עם תאריך (כתזכורת למנהל); השרת בודק שוב בכל שלב
    const ws = await db.doc('sec_cfg/wa').get();
    const pd = PERM.decide(await PERM.readRec(db, who.uid), 'cmt', { stop: !!(ws.exists && ws.get('stop') && ws.get('stop').on === true) });
    if (pd.d === 'deny') return { ok: true, items: [], n: 0, perm: 'deny' };
    const r = await cmts(db, brLimited);
    if (pd.d === 'ask' && r.n) await PERM.ask(db, who.uid, 'cmt', 'הצעת התחייבות ממתינה', { k: 'cmt' });
    if (pd.d === 'auto') r.auto = true;
    return r;
  }
  if (input.op === 'src') {
    const cid = typeof input.cid === 'string' && /^cm[0-9a-f]{16}$/.test(input.cid) ? input.cid : null;
    if (!cid) throw bad('bad-input', 'ערך לא תקין');
    const s = await db.doc('sec_cmt/' + cid).get();
    if (!s.exists || (brLimited && s.get('ch') !== 'grp')) throw C.pre('not-found', 'ההודעה המקורית לא נמצאה');
    const it = cmtItem(s.id, s.data());
    return { ok: true, ch: it.ch, ref: it.ref, from: it.from, prev: it.prev, grp: it.grp || '' };
  }
  throw bad('bad-op', 'פעולה לא מוכרת');
}

exports.secComm = onCall(wrap('secComm', secComm));

Object.defineProperty(exports, '_core', { enumerable: false, value: { mailItem, waItem, grpItem, cmtItem, PAGE } });
