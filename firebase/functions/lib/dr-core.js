'use strict';
// דיווח יומי (dailyRep, 16.11.2026) – פונקציות טהורות (בלי גישה למסד, ל-Storage או לרשת). השרת: daily-rep.js.
//   dayInfo(now)          – יום הדיווח לפי שעון ישראל (lib/tk-time.js): { day 'YYYY-MM-DD', key 'YYYYMMDD', wd (0=ראשון … 6=שבת), y, m, d }
//   cfgOf(data)           – drcfg/main מנורמל: { days, hr, off, req } עם ברירות המחדל של החוזה
//   dayStatus(cfg, info)  – '' = יום דיווח; 'sat' / 'off' (חופש) / 'not-day' (יום שלא הוגדר)
//   remindDue(cfg, now)   – האם הגיע זמן התזכורת היום (יום דיווח, אחרי hr). נשאר לתאימות; drRemind משתמש ב-remindPlan
//   remindPlan({ cfg, now, occs, att, rem, uid }) – "סיכום יום" (19.11.2026): { stage 0|1|2, why, at } – תזכורת ראשונה/שנייה לעובד
//   cfgIn(input)          – אימות קלט drSetCfg (חלקי). שבת (6) נדחית
//   submitIn(input, dep)  – אימות קלט drSubmit: טקסט, הקלטה (WAV, עד 120 שניות לפי הכותרת), עד 3 תמונות (data URL עד 500KB)
//   parseAi(text)         – פענוח JSON מה-AI: {tr, sum, sumW}, חיתוך אורך וניקוי תווי בקרה. לא תקין = null
//   splitTr(tr, n)        – חלוקת התמלול ל-n הקלטות (מופרדות ב"---")
//   capOf(snap), reserveAmt(left, max), RESERVE_USAGE, costOf(usage, audSec, costMc) – מונה העלות (תקציב נפרד drcfg/cap, ברירת מחדל 500 סנט)
//   notesIn(arr, old), tkIn(arr) – הערות המנהל ומזהי משימות
const { HttpsError } = require('firebase-functions/v2/https');
const TK = require('./tk-time');
const SC = require('./shifts-core');

const DAYS_DEF = Object.freeze([0, 1, 2, 3, 4]);
const HR_DEF = '18:00';
const OFF_MAX = 60;
const REQ_MAX = 500;
const MAX_SUB = 3;              // שליחות ליום לעובד
const TXT_MAX = 2000;           // תווים בטקסט של שליחה
const IMG_MAX = 3;              // תמונות בשליחה
const IMG_MAX_CHARS = 500 * 1024; // אורך ה-data URL (נשמר כמו שהוא ב-dr/{id}/p/{k}, בתוך מגבלת מסמך של Firestore)
const AUD_MAX_SEC = 120;
const AUD_SLACK = 1;            // שנייה סבילות (עיגול בהקלטה), כמו stt במזכירה
const AUD_MAX_BYTES = 10 * 1024 * 1024;
const CAP_DEF = 500;            // סנט לחודש (5$) – תקציב נפרד מהמזכירה
const CAP_MAX = 100000;
const DAY_CAP_DIV = 10;         // תקרה יומית = עשירית מהחודשית (כמו DAY_CAP_DIV במזכירה)
const NOTES_MAX = 30, NOTE_MAX = 1000, TK_MAX = 30; // TK_MAX: משימות להערה (בפיצול – משימה לכל שורה)
const TR_MAX = 8000, SUM_MAX = 4000, SUMW_MAX = 2000;
// שמירה מראש במונה (מילי־סנט לפי costMc): קלט מרבי משוער – 120 שניות אודיו (~32 טוקנים לשנייה) + 3 תמונות + טקסט, ופלט עד 4,096
const RESERVE_USAGE = Object.freeze({ in: 20000, aud: 4000, out: 4096 });
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,128}_[0-9]{8}$/;
const DAY_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const HR_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const clean = (v, max) => String(v == null ? '' : v).replace(CTRL, '').trim().slice(0, max);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function dayInfo(now) {
  const o = TK.ymdOf(now), day = TK.dayStr(o);
  return { day, key: day.replace(/-/g, ''), wd: new Date(Date.UTC(o.y, o.m, o.d)).getUTCDay(), y: o.y, m: o.m, d: o.d };
}
const validDay = (s) => {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number), x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};

function cfgOf(data) {
  const d = isObj(data) ? data : {};
  const days = Array.isArray(d.days) ? [...new Set(d.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 5))].sort() : DAYS_DEF.slice();
  const req = {};
  if (isObj(d.req)) for (const [u, v] of Object.entries(d.req)) if (v === true && UID_RE.test(u)) req[u] = true;
  return {
    days,
    hr: typeof d.hr === 'string' && HR_RE.test(d.hr) ? d.hr : HR_DEF,
    off: Array.isArray(d.off) ? d.off.filter(validDay).slice(0, OFF_MAX) : [],
    req,
  };
}

function dayStatus(cfg, info) {
  if (info.wd === 6) return 'sat';
  if (cfg.off.includes(info.day)) return 'off';
  if (!cfg.days.includes(info.wd)) return 'not-day';
  return '';
}

function remindDue(cfg, now) {
  const info = dayInfo(now);
  const why = dayStatus(cfg, info);
  if (why) return { go: false, why, day: info.day, key: info.key };
  const [hh, mm] = cfg.hr.split(':').map(Number);
  const at = TK.zoned(info.y, info.m, info.d, hh, mm);
  if (now < at) return { go: false, why: 'early', day: info.day, key: info.key, at };
  return { go: true, why: 'go', day: info.day, key: info.key, at };
}

// ---------- remindPlan: מתי לשלוח תזכורת "סיכום יום" לעובד אחד (טהורה) ----------
//   occs – מופעי משמרות (SC.expand); נלקחת המשמרת של uid שמתחילה היום ומסתיימת אחרונה. אין משמרת – השעה הקבועה hr.
//   att  – נוכחות במשמרת (shifts.js attLast): null = לא ידוע / לא נבדק; { open:true } = כניסה פתוחה; { out } = יציאה אחרונה (0 = אין).
//     יציאה נחשבת רק אם היא עד EARLY_OUT לפני הסוף המתוכנן (לפני כן – הפסקה); כניסה פתוחה – ממתינים עד OPEN_WAIT אחרי הסוף.
//   T1 (ראשונה) לא אחרי 23:30. rem – drcfg/rem_<key>: u = ראשונה נשלחה, u2 = שנייה נשלחה (מסמך ישן בלי u2 = {}).
//   שנייה – GAP2 אחרי שליחת הראשונה בפועל. לא בשבת / חופש / יום שלא הוגדר, ולא בחלון השקט של שבת וחג (SC.quiet).
const EARLY_OUT = 2 * 3600000;
const OPEN_WAIT = 3600000;
const GAP2 = 3600000;
const CAP_H = 23, CAP_M = 30;
function remindOcc(occs, uid, day) {
  let best = null;
  for (const o of occs || []) if (o && o.u === uid && o.day === day && (!best || o.end > best.end)) best = o;
  return best;
}
const capOfDay = (info) => TK.zoned(info.y, info.m, info.d, CAP_H, CAP_M);
// מאיזה רגע הנוכחות יכולה לשנות את T1 (לפני כן אין טעם לקרוא אותה)
const attNeedAt = (occ, info) => Math.min(occ.end - EARLY_OUT, capOfDay(info));
function remindAt1(cfg, info, occ, att) {
  let t;
  if (!occ) {
    const [hh, mm] = cfg.hr.split(':').map(Number);
    t = TK.zoned(info.y, info.m, info.d, hh, mm);
  } else if (att && att.open) t = occ.end + OPEN_WAIT;
  else if (att && Number.isFinite(att.out) && att.out >= occ.end - EARLY_OUT) t = att.out;
  else t = occ.end;
  return Math.min(t, capOfDay(info));
}
function remindPlan(o) {
  const { cfg, now, uid } = o;
  const info = dayInfo(now);
  const why = dayStatus(cfg, info);
  if (why) return { stage: 0, why };
  if (SC.quiet(now)) return { stage: 0, why: 'quiet' };
  const r = isObj(o.rem) ? o.rem : {};
  const u1 = isObj(r.u) && Number.isFinite(r.u[uid]) ? r.u[uid] : r.u && r.u[uid] ? 1 : 0;
  const u2 = isObj(r.u2) && r.u2[uid];
  if (u2) return { stage: 0, why: 'done' };
  if (u1) return now >= u1 + GAP2 ? { stage: 2, why: 'go2', at: u1 + GAP2 } : { stage: 0, why: 'wait2', at: u1 + GAP2 };
  const at = remindAt1(cfg, info, remindOcc(o.occs, uid, info.day), o.att);
  return now >= at ? { stage: 1, why: 'go1', at } : { stage: 0, why: 'early', at };
}

// drSetCfg – רק השדות שנשלחו. req: { uid: true|false } (false = הסרה)
function cfgIn(input) {
  const o = isObj(input) ? input : {};
  const keys = Object.keys(o);
  if (!keys.length || keys.some((k) => !['days', 'hr', 'off', 'req'].includes(k))) throw bad('bad-cfg', 'הגדרות לא תקינות');
  const out = {};
  if ('days' in o) {
    if (!Array.isArray(o.days) || o.days.length > 7 || o.days.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) throw bad('bad-days', 'ימי הסיכום לא תקינים');
    if (o.days.includes(6)) throw bad('sat', 'אי אפשר לקבוע סיכום יום בשבת');
    out.days = [...new Set(o.days)].sort();
  }
  if ('hr' in o) {
    if (typeof o.hr !== 'string' || !HR_RE.test(o.hr)) throw bad('bad-hr', 'שעת התזכורת לא תקינה (HH:MM)');
    out.hr = o.hr;
  }
  if ('off' in o) {
    if (!Array.isArray(o.off) || o.off.length > OFF_MAX || o.off.some((x) => !validDay(x))) throw bad('bad-off', 'ימי החופש לא תקינים (עד ' + OFF_MAX + ' תאריכים)');
    out.off = [...new Set(o.off)].sort();
  }
  if ('req' in o) {
    if (!isObj(o.req) || Object.keys(o.req).length > REQ_MAX || Object.entries(o.req).some(([u, v]) => !UID_RE.test(u) || typeof v !== 'boolean')) throw bad('bad-req', 'רשימת העובדים לא תקינה');
    out.req = Object.assign({}, o.req);
  }
  return out;
}

// dep: { wavInfo(buf) → { sec } | null, imgMime(buf) → mime | '' } (מ-secretary-media.js – אותה בדיקת תוכן כמו במזכירה)
function submitIn(input, dep) {
  const o = isObj(input) ? input : {};
  if (Object.keys(o).some((k) => !['txt', 'audio', 'imgs'].includes(k))) throw bad('bad-input', 'קלט לא תקין');
  let txt = '';
  if (o.txt !== undefined && o.txt !== null) {
    if (typeof o.txt !== 'string') throw bad('bad-text', 'טקסט לא תקין');
    if (o.txt.length > TXT_MAX) throw bad('too-long', 'הטקסט ארוך מדי (עד ' + TXT_MAX + ' תווים)');
    txt = clean(o.txt, TXT_MAX);
  }
  let audio = null;
  if (o.audio !== undefined && o.audio !== null) {
    const a = o.audio;
    if (!isObj(a) || a.mime !== 'audio/wav' || typeof a.b64 !== 'string' || !a.b64) throw bad('bad-audio', 'ההקלטה לא תקינה');
    if (a.sec !== undefined && !(typeof a.sec === 'number' && a.sec >= 0 && a.sec <= AUD_MAX_SEC)) throw bad('too-long', 'ההקלטה ארוכה מהמותר (עד ' + AUD_MAX_SEC + ' שניות)');
    const s = a.b64.replace(/^data:[a-z0-9.+/-]+(;[a-z0-9=.+-]+)*;base64,/i, '');
    if (s.length > Math.ceil(AUD_MAX_BYTES / 3) * 4 + 4) throw bad('too-big', 'ההקלטה גדולה מדי');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw bad('bad-audio', 'ההקלטה לא תקינה');
    const buf = Buffer.from(s, 'base64');
    const info = buf.length ? dep.wavInfo(buf) : null;
    if (!info) throw bad('bad-audio', 'ההקלטה לא בפורמט הנתמך');
    if (info.sec > AUD_MAX_SEC + AUD_SLACK) throw bad('too-long', 'ההקלטה ארוכה מהמותר (עד ' + AUD_MAX_SEC + ' שניות)');
    if (info.sec < 0.3) throw bad('too-short', 'ההקלטה קצרה מדי');
    audio = { buf, sec: Math.round(info.sec) };
  }
  const imgs = [];
  if (o.imgs !== undefined && o.imgs !== null) {
    if (!Array.isArray(o.imgs)) throw bad('bad-image', 'התמונות לא תקינות');
    if (o.imgs.length > IMG_MAX) throw bad('too-many', 'אפשר לצרף עד ' + IMG_MAX + ' תמונות');
    for (const u of o.imgs) {
      if (typeof u !== 'string') throw bad('bad-image', 'תמונה לא תקינה');
      if (u.length > IMG_MAX_CHARS) throw bad('too-big', 'תמונה גדולה מדי (עד 500KB)');
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(u);
      if (!m) throw bad('bad-image', 'תמונה לא תקינה');
      const head = Buffer.from(m[2].slice(0, 64), 'base64');
      if (dep.imgMime(head) !== m[1]) throw bad('bad-image', 'תמונה לא תקינה');
      imgs.push({ url: u, mime: m[1], b64: m[2] });
    }
  }
  if (!txt && !audio && !imgs.length) throw bad('empty', 'הסיכום ריק');
  return { txt, audio, imgs };
}

function parseAi(text) {
  if (typeof text !== 'string' || !text || text.length > 200000) return null;
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let j;
  try { j = JSON.parse(s); } catch (e) {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { j = JSON.parse(s.slice(a, b + 1)); } catch (e2) { return null; }
  }
  if (!isObj(j)) return null;
  const str = (v, max) => (typeof v === 'string' ? clean(v.replace(/\r\n?/g, '\n'), max) : '');
  const out = { tr: str(j.tr, TR_MAX), sum: str(j.sum, SUM_MAX), sumW: str(j.sumW, SUMW_MAX) };
  if (!out.sum && !out.sumW) return null;
  return out;
}

// n הקלטות: התמלול מופרד בשורה "---". מספר חלקים שונה – הקלטה אחת מקבלת את כולו, יותר מאחת – לא מנחשים (ריק)
function splitTr(tr, n) {
  if (!n) return [];
  if (n === 1) return [tr || ''];
  const parts = String(tr || '').split(/\n?^\s*-{3,}\s*$\n?/m).map((x) => x.trim());
  return parts.length === n ? parts : new Array(n).fill('');
}

// טקסט של העובד בתוך ההנחיה ל-AI: מנטרלים רצפים של < או > (2 ומעלה), כדי שאי אפשר לזייף את המפרידים <<< … >>> של "תוכן הדיווח"
const safeTxt = (v) => String(v == null ? '' : v).replace(/<{2,}/g, (m) => '‹'.repeat(m.length)).replace(/>{2,}/g, (m) => '›'.repeat(m.length));
// שמירה מראש לפי מספר ההקלטות והתמונות שנשלחות (resum יכול לשלוח עד 3 הקלטות ו-9 תמונות). אחת או פחות – RESERVE_USAGE
function reserveUsage(nAud, nImg) {
  const a = Math.max(1, nAud | 0), extraImg = Math.max(0, (nImg | 0) - IMG_MAX);
  return { in: RESERVE_USAGE.in + (a - 1) * 4000 + extraImg * 1500, aud: RESERVE_USAGE.aud * a, out: RESERVE_USAGE.out };
}
const capOf = (snap) => (snap && snap.exists && Number.isInteger(snap.get('capCents')) ? snap.get('capCents') : CAP_DEF);
// כמה לשמור מראש: עד העלות המרבית, ולא יותר ממה שנשאר (כמו meter במזכירה)
const reserveAmt = (left, max) => Math.max(1, Math.min(max, Math.floor(left)));
// עלות בפועל. Gemini לא תמיד מחזיר פירוט אודיו – אז מעריכים 32 טוקנים לשנייה (כמו audCost במזכירה)
function costOf(usage, audSec, costMc) {
  const u = Object.assign({}, usage || {});
  if (!Number.isFinite(+u.aud) && audSec > 0) u.aud = Math.min(+u.in || 0, Math.ceil(audSec * 32));
  return costMc('fast', u);
}

function notesIn(arr, old) {
  if (!Array.isArray(arr) || arr.length > NOTES_MAX) throw bad('bad-notes', 'ההערות לא תקינות (עד ' + NOTES_MAX + ')');
  const prev = Array.isArray(old) ? old : [];
  const out = arr.map((x, i) => {
    if (!isObj(x) || typeof x.txt !== 'string' || x.txt.length > NOTE_MAX) throw bad('bad-notes', 'הערה לא תקינה (עד ' + NOTE_MAX + ' תווים)');
    const tk = prev[i] && Array.isArray(prev[i].tk) ? prev[i].tk.filter((t) => typeof t === 'string' && UID_RE.test(t)).slice(0, TK_MAX) : [];
    return { txt: clean(x.txt, NOTE_MAX), tk };
  });
  // רק הערות ריקות (בלי משימות) בסוף הרשימה נשמטות – באמצע לא, כדי שהאינדקסים (ו-tk לפיהם) לא יזוזו
  while (out.length && !out[out.length - 1].txt && !out[out.length - 1].tk.length) out.pop();
  return out;
}
function tkIn(arr) {
  if (!Array.isArray(arr) || arr.length > TK_MAX || arr.some((t) => typeof t !== 'string' || !UID_RE.test(t))) throw bad('bad-tk', 'מזהי משימות לא תקינים');
  return [...new Set(arr)];
}
// op 'tk' מצרף (לא מחליף): הקיימים + החדשים, בלי כפילויות; מעל TK_MAX – נשמרים האחרונים
const tkAdd = (old, add) => [...new Set((Array.isArray(old) ? old.filter((t) => typeof t === 'string' && UID_RE.test(t)) : []).concat(add))].slice(-TK_MAX);

module.exports = {
  DAYS_DEF, HR_DEF, OFF_MAX, REQ_MAX, MAX_SUB, TXT_MAX, IMG_MAX, IMG_MAX_CHARS, AUD_MAX_SEC, AUD_MAX_BYTES, CAP_DEF, CAP_MAX, DAY_CAP_DIV,
  NOTES_MAX, NOTE_MAX, TK_MAX, TR_MAX, SUM_MAX, SUMW_MAX, RESERVE_USAGE, UID_RE, ID_RE,
  EARLY_OUT, OPEN_WAIT, GAP2, remindOcc, attNeedAt, remindAt1, remindPlan,
  clean, dayInfo, validDay, cfgOf, dayStatus, remindDue, cfgIn, submitIn, parseAi, splitTr, capOf, reserveAmt, costOf, notesIn, tkIn, tkAdd, safeTxt, reserveUsage,
};
