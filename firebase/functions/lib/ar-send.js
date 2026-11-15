'use strict';
// שליחת מסמכים ללקוח (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 3 חלק א'): ווטסאפ (תבנית עם מסמך) ומייל (קובץ מצורף).
// ספרייה בלבד – בלי onCall. מי שקורא (ar.js, שלב 3 חלק ב') בודק הרשאות, מעביר את הסודות ורושם את התוצאה ב-ardoc.sent[].
//
//   sendWa(db, { to, tpl:{ name, lang, params[] }, link, fileName, auto, by, token, now, send? })
//     → { ch:'wa', to, at, ok, id?, why? }
//     - db = מסד העסק (T.tdb()). המספר העסקי והעצירה – sec_cfg/wa (של המזכירה).
//     - "עצור הכל" (stop.on) עוצר כל שליחה אוטומטית (auto !== false). שליחה בלחיצה (auto:false) – כמו secSend (החלטה 31).
//     - מונה היציאות היומי הקיים של העסק (sec_cfg/wa_use: od/odn, תקרה W.OUT_DAY) – אותו מונה של המזכירה.
//     - בלי תבנית מאושרת אי אפשר לשלוח מסמך מחוץ לחלון 24 השעות (סיכון 6). tpl חסר → why:'no-tpl'.
//   sendMail(biz, { to, subject, text, replyTo, fromName, pdf, fileName, by, now }, deps?)
//     → { ch:'mail', to, at, ok, why? }
//     - nodemailer, אותם סודות כמו מייל ההזמנה (MAIL_USER / MAIL_APP_PASSWORD, MAIL_HOST/PORT/FROM).
//     - מונה נפרד מ-mailRate: arMailRate/{b-<bizId>} – 30 לשעה ו-200 ליום לכל עסק (הנחה).
//     - Reply-To = מייל העסק (הנחת המתכנן). הסודות והתוכן לא נכתבים ליומן.
// אין כאן שליחה אמיתית בבדיקות: ווטסאפ – wa-mock (127.0.0.1), מייל – transport מדומה (deps.transport).

const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const W = require('./sec-wa');

const MAIL_USER = defineSecret('MAIL_USER');
const MAIL_APP_PASSWORD = defineSecret('MAIL_APP_PASSWORD');
const MAIL_HOST = defineString('MAIL_HOST', { default: 'smtp.gmail.com', description: 'שרת SMTP למייל ההזמנה (למשל smtp.resend.com)' });
const MAIL_PORT = defineString('MAIL_PORT', { default: '465', description: 'פורט SMTP: 465/2465 (SSL) או 587/2587 (STARTTLS)' });
const MAIL_FROM = defineString('MAIL_FROM', { default: '', description: 'כתובת השולח. ריק = MAIL_USER' });

const EMAIL_RE = /^[^\s@<>"',;:\\()[\]]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
const TPL_RE = /^[a-z0-9_]{1,100}$/;
const LANG_RE = /^[a-z]{2}(_[A-Z]{2})?$/;
const MAIL_LIMITS = [{ k: 'h', win: 3600e3, max: 30 }, { k: 'd', win: 864e5, max: 200 }]; // הנחה
const PDF_MAX = 10 * 1024 * 1024;
const TEXT_MAX = 4000;

const reasonOf = (e) => String((e && e.details && e.details.reason) || (e && typeof e.code === 'string' && e.code) || 'error').slice(0, 40);
const rec = (ch, to, at, ok, extra) => Object.assign({ ch, to: String(to || '').slice(0, 254), at, ok }, extra || {});
const logW = (by, act, extra) => Object.assign({ t: Date.now(), by: String(by || ''), who: 'ar', act, ch: 'wa' }, extra || {});

// מונה היציאות היומי של העסק – אותו מסמך ואותם שדות כמו countOut ב-secretary-wa.js
async function countOut(db, now) {
  const ref = db.doc('sec_cfg/wa_use');
  const d = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const n = s.exists && s.get('od') === d ? s.get('odn') || 0 : 0;
    if (n >= W.OUT_DAY) return false;
    tx.set(ref, { od: d, odn: n + 1 }, { merge: true });
    return true;
  });
}

async function sendWa(db, a) {
  const now = a.now || Date.now();
  const to = W.waNum(a.to);
  if (!to) return rec('wa', a.to, now, false, { why: 'bad-to' });
  const tpl = a.tpl && TPL_RE.test(String(a.tpl.name || '')) ? a.tpl : null;
  if (!tpl) return rec('wa', to, now, false, { why: 'no-tpl' });
  if (!W.docLinkOk(a.link)) return rec('wa', to, now, false, { why: 'bad-link' });
  const cs = await db.doc('sec_cfg/wa').get();
  const cfg = cs.exists ? cs.data() || {} : {};
  if (!cfg.pnid) return rec('wa', to, now, false, { why: 'no-wa' });
  const stop = cfg.stop && typeof cfg.stop === 'object' ? cfg.stop : {};
  const auto = a.auto !== false;
  if (stop.on === true && auto) {
    await db.collection('sec_log').doc().set(logW(a.by, 'arStopped', { tgt: to }));
    return rec('wa', to, now, false, { why: 'stopped' });
  }
  if (!(await countOut(db, now))) {
    await db.collection('sec_log').doc().set(logW(a.by, 'outLimit', { note: 'ar' }));
    return rec('wa', to, now, false, { why: 'limit' });
  }
  try {
    const payload = { tpl: { name: tpl.name, lang: LANG_RE.test(String(tpl.lang || '')) ? tpl.lang : 'he', params: Array.isArray(tpl.params) ? tpl.params : [], doc: { link: a.link, filename: a.fileName || 'document.pdf' } } };
    const r = await (a.send || W.send)(a.token, cfg.pnid, to, payload);
    await db.collection('sec_log').doc().set(logW(a.by, 'arSend', { tgt: to, note: auto ? 'auto' : 'click' }));
    return rec('wa', to, now, true, { id: r && r.wamid ? String(r.wamid).slice(0, 300) : '' });
  } catch (e) {
    await db.collection('sec_log').doc().set(logW(a.by, 'sendFail', { tgt: to, note: 'ar:' + reasonOf(e) }));
    return rec('wa', to, now, false, { why: reasonOf(e) });
  }
}

// ---------- מייל ----------
async function takeMailRate(bizId, now) {
  const db = getFirestore();
  const ref = db.doc('arMailRate/b-' + bizId);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() || {} : {};
    const next = {};
    for (const l of MAIL_LIMITS) {
      const c = d[l.k] && typeof d[l.k].t === 'number' && now - d[l.k].t < l.win ? d[l.k] : { t: now, n: 0 };
      if ((+c.n || 0) >= l.max) return false;
      next[l.k] = { t: c.t, n: (+c.n || 0) + 1 };
    }
    tx.set(ref, next);
    return true;
  });
}
function mailDeps() {
  const IM = require('../invite-mail')._core;
  return {
    secrets: () => { try { return IM.secretsOk(MAIL_USER.value(), MAIL_APP_PASSWORD.value()); } catch (e) { return null; } },
    smtp: () => { try { return { host: MAIL_HOST.value(), port: MAIL_PORT.value(), from: MAIL_FROM.value() }; } catch (e) { return {}; } },
    transport: (cfg) => require('nodemailer').createTransport(cfg),
  };
}
async function sendMail(bizId, a, deps) {
  const now = a.now || Date.now();
  const IM = require('../invite-mail')._core;
  const D = Object.assign(mailDeps(), deps || {});
  const to = String(a.to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to) || to.length > 254) return rec('mail', to, now, false, { why: 'bad-to' });
  if (!Buffer.isBuffer(a.pdf) || !a.pdf.length || a.pdf.length > PDF_MAX) return rec('mail', to, now, false, { why: 'bad-pdf' });
  const sec = D.secrets();
  if (!sec) return rec('mail', to, now, false, { why: 'no-secrets' });
  const sm = D.smtp() || {};
  const smtp = IM.smtpOk(sm.host, sm.port, sm.from, sec.user);
  if (!smtp) return rec('mail', to, now, false, { why: 'no-smtp' });
  if (!(await takeMailRate(bizId, now))) return rec('mail', to, now, false, { why: 'rate' });
  const fromName = IM.headerSafe(a.fromName);
  const replyTo = typeof a.replyTo === 'string' && EMAIL_RE.test(a.replyTo.trim()) ? a.replyTo.trim() : undefined;
  const text = String(a.text || '').slice(0, TEXT_MAX);
  const mail = {
    from: { name: fromName, address: smtp.from }, to, subject: IM.headerSafe(a.subject), text,
    html: '<div dir="rtl" style="font-family:Arial,sans-serif;white-space:pre-wrap">' + IM.esc(text) + '</div>',
    attachments: [{ filename: String(a.fileName || 'document.pdf').replace(/[\\/"\r\n]/g, '-').slice(0, 100), content: a.pdf, contentType: 'application/pdf' }],
  };
  if (replyTo) mail.replyTo = replyTo;
  try {
    const tr = D.transport({ host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: !smtp.secure, auth: { user: sec.user, pass: sec.pass }, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000, logger: false, debug: false });
    await tr.sendMail(mail);
    if (typeof tr.close === 'function') tr.close();
  } catch (e) {
    logger.warn('arSendMail failed', { reason: 'send', code: e && typeof e.code === 'string' ? e.code.slice(0, 40) : '' });
    return rec('mail', to, now, false, { why: 'send' });
  }
  return rec('mail', to, now, true);
}

module.exports = { sendWa, sendMail, countOut, takeMailRate, MAIL_LIMITS, MAIL_SECRETS: [MAIL_USER, MAIL_APP_PASSWORD], EMAIL_RE };
