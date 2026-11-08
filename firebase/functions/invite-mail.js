'use strict';
// מייל הזמנה עצמי (2026-11-08). עריכת תבניות המייל חסומה בפרויקט, ולכן המערכת שולחת את מייל ההזמנה בעצמה:
//   sendInviteMail({ bizId, email })  →  { ok: true, status: 'sent' }  או  { ok: true, status: 'fallback', why }
//   - מי מורשה: רק מנהל־על (כמו createBusiness / inviteBusinessAdmin / addStaff – רק הוא מזמין היום).
//   - למי: רק לכתובת ששייכת לעסק (ownerEmail ב-private/info, או מסמך admins/staff של העסק עם המייל הזה).
//     כך אי אפשר להשתמש בפונקציה לשליחת מייל לכתובת זרה.
//   - הקישור נוצר בשרת (generatePasswordResetLink) ומומר לקישור לדף שלנו:
//       https://<INVITE_SITE>.web.app/welcome.html?mode=resetPassword&oobCode=…&apiKey=…&continueUrl=…&biz=<bizId>
//   - השליחה: nodemailer דרך smtp.gmail.com:465 (SSL) עם הסודות MAIL_USER / MAIL_APP_PASSWORD (Secret Manager).
//     הסודות לא נכתבים ללוג ולא חוזרים בתשובה. גם הקישור לא נכתב ללוג.
//   - אם הסודות חסרים / לא תקינים, אין אתר מוגדר, או השליחה נכשלה – status 'fallback' (האפליקציה שולחת את המייל
//     המובנה של Firebase, כמו קודם). הזמנה לעולם לא נשברת בגלל המייל.
//   - הגבלת קצב (Firestore, mailRate/*): 10 מיילים לשעה לכל עסק, 40 ביום לכל שולח. חריגה – status 'fallback', why 'rate'.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const T = require('./lib/tenant');
const R = require('./lib/roles');

const MAIL_USER = defineSecret('MAIL_USER');
const MAIL_APP_PASSWORD = defineSecret('MAIL_APP_PASSWORD');
const INVITE_SITE = defineString('INVITE_SITE', { default: '', description: 'שם אתר גרסת המחשב (בלי .web.app) – שם נמצא welcome.html' });

const DEFAULT_NAME = 'ניהול העסק';
const EMAIL_RE = /^[^\s@<>"',;:\\()[\]]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
const SITE_RE = /^[a-z0-9-]{1,63}$/;
const LIMITS = [
  { key: (bizId) => 'b-' + bizId, win: 3600000, max: 10 },
  { key: (bizId, uid) => 'u-' + uid, win: 86400000, max: 40 },
];

// ---------- ניקוי ו-escape ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"'`=]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' }[c]));
// שם לכותרת From / Subject: בלי תווי שליטה (CR/LF = header injection), בלי תווי כיווניות מסוכנים, בלי <>"\ , עד 60 תווים
function headerSafe(s) {
  // eslint-disable-next-line no-control-regex
  const v = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/[<>"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return v || DEFAULT_NAME;
}
function secretsOk(user, pass) {
  const u = String(user || '').trim(), p = String(pass || '').replace(/\s+/g, '');
  return EMAIL_RE.test(u) && p.length >= 12 && p.length <= 64 && /^[A-Za-z0-9]+$/.test(p) ? { user: u, pass: p } : null;
}

// ---------- הקישור: מהקישור של Firebase לדף שלנו ----------
function welcomeLink(fbLink, site, bizId, projectId) {
  if (!SITE_RE.test(String(site || ''))) return '';
  let u;
  try { u = new URL(fbLink); } catch (e) { return ''; }
  const oob = u.searchParams.get('oobCode') || '', key = u.searchParams.get('apiKey') || '';
  if (!/^[A-Za-z0-9_-]{10,2048}$/.test(oob) || !/^[A-Za-z0-9_-]{10,200}$/.test(key)) return '';
  const w = new URL(`https://${site}.web.app/welcome.html`);
  w.searchParams.set('mode', 'resetPassword');
  w.searchParams.set('oobCode', oob);
  w.searchParams.set('apiKey', key);
  if (T.BIZ_RE.test(bizId)) {
    w.searchParams.set('continueUrl', `https://${projectId}.firebaseapp.com/?biz=${bizId}`);
    w.searchParams.set('biz', bizId);
  }
  return w.href;
}

const STEPS = (email) => [
  'לחצו על הכפתור "קביעת סיסמה" במייל הזה.',
  'בדף שנפתח בחרו סיסמה, הקלידו אותה שוב ולחצו "קביעת סיסמה".',
  'לחצו "הורד את האפליקציה".',
  'כשההורדה מסתיימת, פתחו את הקובץ שירד (מההתראה למעלה או מתיקיית "הורדות").',
  'אם מופיעה הודעה שההתקנה חסומה: לחצו "הגדרות", הפעילו "אפשר ממקור זה" (התקנה ממקור לא ידוע) וחזרו אחורה.',
  'לחצו "התקן" ואחר כך "פתח".',
  `התחברו עם המייל ${email} והסיסמה שקבעתם.`,
];

// ---------- בניית המייל (טהור, נבדק ביחידה) ----------
// brand: { name, logo } – logo הוא data:image/(png|jpeg|webp);base64,… או ''. הלוגו מוטמע כקובץ מצורף (cid), לא כ-data URI.
function buildMail({ to, from, brand, link }) {
  const name = headerSafe(brand && brand.name);
  const html1 = esc(name);
  const mailTo = String(to || '');
  const att = [];
  let logoHtml = '';
  const m = brand && typeof brand.logo === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(brand.logo);
  if (m) {
    att.push({ filename: 'logo.' + (m[1] === 'jpeg' ? 'jpg' : m[1]), content: Buffer.from(m[2], 'base64'), contentType: 'image/' + m[1], cid: 'bizlogo@invite' });
    logoHtml = `<img src="cid:bizlogo@invite" alt="${html1}" width="96" style="display:block;margin:0 auto 12px;max-width:96px;height:auto;border-radius:12px">`;
  }
  const steps = STEPS(mailTo);
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html1}</title></head>`
    + `<body dir="rtl" style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#1f2937">`
    + `<div dir="rtl" style="max-width:560px;margin:0 auto;padding:24px 16px;text-align:right">`
    + `<div style="background:#ffffff;border-radius:16px;padding:24px">${logoHtml}`
    + `<h1 style="font-size:22px;margin:0 0 12px;text-align:center">הוזמנת לאפליקציית ${html1}</h1>`
    + `<p style="font-size:16px;line-height:1.6;margin:0 0 20px">שלום,<br>הוזמנת להצטרף לאפליקציית ${html1} עם החשבון <bdi dir="ltr">${esc(mailTo)}</bdi>.</p>`
    + `<p style="text-align:center;margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#b8860b;color:#ffffff;text-decoration:none;font-size:18px;font-weight:bold;padding:14px 28px;border-radius:10px">קביעת סיסמה</a></p>`
    + `<p style="font-size:16px;font-weight:bold;margin:0 0 8px">איך מתחילים (בטלפון אנדרואיד):</p>`
    + `<ol style="font-size:15px;line-height:1.7;margin:0 0 20px;padding-right:20px;padding-left:0">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
    + `<p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">הקישור תקף לזמן מוגבל. אם פג תוקפו, בקשו מהמנהל לשלוח מייל חדש.<br>אם לא ציפיתם להזמנה, אפשר להתעלם מהמייל.</p>`
    + `<p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:16px 0 0">אם הכפתור לא עובד, העתיקו את הקישור לדפדפן:<br><span dir="ltr" style="word-break:break-all">${esc(link)}</span></p>`
    + `</div><p style="font-size:13px;color:#6b7280;text-align:center;margin:16px 0 0">${html1}</p></div></body></html>`;
  const text = [
    'שלום,', '',
    `הוזמנת להצטרף לאפליקציית ${name} עם החשבון ${mailTo}.`, '',
    'קישור לקביעת סיסמה:', link, '',
    'איך מתחילים (בטלפון אנדרואיד):',
    ...steps.map((s, i) => `${i + 1}. ${i === 0 ? 'פתחו את הקישור שלמעלה.' : s}`), '',
    'הקישור תקף לזמן מוגבל. אם פג תוקפו, בקשו מהמנהל לשלוח מייל חדש.',
    'אם לא ציפיתם להזמנה, אפשר להתעלם מהמייל.', '', name,
  ].join('\n');
  return {
    from: { name, address: from },
    to: mailTo,
    subject: `הזמנה לאפליקציית ${name}`,
    text, html, attachments: att,
    headers: { 'Content-Language': 'he' },
    disableUrlAccess: true, disableFileAccess: true,
  };
}

// ---------- בדיקות הרשאה, שייכות, קצב ----------
async function belongs(biz, email) {
  const db = getFirestore();
  if (biz.exists) {
    const info = await db.doc(`b/${biz.bizId}/private/info`).get();
    if (info.exists && String(info.get('ownerEmail') || '').toLowerCase() === email) return true;
  }
  for (const c of ['admins', 'staff']) {
    const s = await db.collection(T.bizRef(biz, c)).where('email', '==', email).limit(1).get();
    if (!s.empty) return true;
  }
  return false;
}
async function takeRate(bizId, uid, now) {
  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const refs = LIMITS.map((l) => db.doc('mailRate/' + l.key(bizId, uid)));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const next = [];
    for (let i = 0; i < LIMITS.length; i++) {
      const d = snaps[i].exists ? snaps[i].data() : {};
      const fresh = !(typeof d.t === 'number' && now - d.t < LIMITS[i].win);
      const n = fresh ? 0 : (+d.n || 0);
      if (n >= LIMITS[i].max) return false;
      next.push(fresh ? { t: now, n: 1 } : { t: d.t, n: n + 1 });
    }
    refs.forEach((r, i) => tx.set(r, next[i]));
    return true;
  });
}

// deps ניתנים להחלפה בבדיקות: { secrets(), site(), projectId, link(email, settings), brand(bizId), transport(cfg), now() }
function defaultDeps() {
  return {
    secrets: () => { try { return secretsOk(MAIL_USER.value(), MAIL_APP_PASSWORD.value()); } catch (e) { return null; } },
    site: () => { try { return INVITE_SITE.value(); } catch (e) { return ''; } },
    projectId: () => process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || '',
    link: (email, settings) => getAuth().generatePasswordResetLink(email, settings),
    brand: async (bizId) => { try { return await require('./public-brand')._core.brandOf(bizId); } catch (e) { return null; } },
    transport: (cfg) => require('nodemailer').createTransport(cfg),
    now: () => Date.now(),
  };
}

async function sendInvite(request, deps) {
  const D = Object.assign(defaultDeps(), deps || {});
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'צריך להתחבר לאפליקציה', { reason: 'not-signed-in' });
  if (!(await T.isSuper(uid))) throw new HttpsError('permission-denied', 'הפעולה מותרת למנהל המערכת בלבד', { reason: 'not-superadmin' });
  const input = R.inputObject(request);
  const bizId = typeof input.bizId === 'string' ? input.bizId : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!T.BIZ_RE.test(bizId)) throw new HttpsError('invalid-argument', 'מזהה העסק לא תקין', { reason: 'bad-biz' });
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpsError('invalid-argument', 'כתובת המייל לא תקינה', { reason: 'bad-email' });
  const biz = await T.loadBiz(bizId);
  if (!biz) throw new HttpsError('not-found', 'העסק לא נמצא', { reason: 'no-biz' });
  if (!(await belongs(biz, email))) throw new HttpsError('permission-denied', 'המייל לא שייך לעסק', { reason: 'not-member' });

  const sec = D.secrets();
  if (!sec) return { ok: true, status: 'fallback', why: 'no-secrets' };
  const site = String(D.site() || '');
  if (!SITE_RE.test(site)) return { ok: true, status: 'fallback', why: 'no-site' };
  if (!(await takeRate(bizId, uid, D.now()))) return { ok: true, status: 'fallback', why: 'rate' };
  const projectId = D.projectId();
  let link = '';
  try {
    const fb = await D.link(email, { url: `https://${projectId}.firebaseapp.com/?biz=${bizId}` });
    link = welcomeLink(fb, site, bizId, projectId);
  } catch (e) {
    logger.warn('inviteMail: link failed', { reason: 'link', code: e && e.code });
    return { ok: true, status: 'fallback', why: 'link' };
  }
  if (!link) return { ok: true, status: 'fallback', why: 'link' };
  const br = (await D.brand(bizId)) || {};
  const mail = buildMail({ to: email, from: sec.user, brand: br, link });
  try {
    const tr = D.transport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: sec.user, pass: sec.pass }, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000, logger: false, debug: false });
    await tr.sendMail(mail);
    if (typeof tr.close === 'function') tr.close();
  } catch (e) {
    // רק קוד השגיאה – לא ההודעה (עלולה לכלול את שם המשתמש) ולא הקישור
    logger.warn('inviteMail: send failed', { reason: 'send', code: e && typeof e.code === 'string' ? e.code.slice(0, 40) : '' });
    return { ok: true, status: 'fallback', why: 'send' };
  }
  try {
    await getFirestore().collection(`b/${bizId}/audit`).doc().set({ by: uid, t: Date.now(), act: 'sendInviteMail', note: email });
  } catch (e) { /* audit לא חוסם */ }
  return { ok: true, status: 'sent' };
}

exports.sendInviteMail = onCall({ secrets: [MAIL_USER, MAIL_APP_PASSWORD], maxInstances: 3, timeoutSeconds: 60 }, T.scoped(async (request) => {
  try { return await sendInvite(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('inviteMail failed', { reason: 'internal', name: e && e.name });
    return { ok: true, status: 'fallback', why: 'internal' };
  }
}));
Object.defineProperty(exports, '_core', { enumerable: false, value: { buildMail, welcomeLink, headerSafe, secretsOk, esc, sendInvite, takeRate, belongs, LIMITS, DEFAULT_NAME } });
