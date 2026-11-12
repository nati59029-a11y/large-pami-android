'use strict';
// מייל הזמנה עצמי (2026-11-08): בניית המייל (escape, שם עסק, קישור לדף), נפילה ל-fallback כשאין סודות / השליחה נכשלת,
// הגבלת קצב, ומי שאינו מנהל־על או כתובת שלא שייכת לעסק – לא נשלח. nodemailer מדומה (transport מוזרק) – אין שליחה אמיתית.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
let env, M;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const FB_LINK = 'https://demo.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=CODE_abcdefghij123&apiKey=AIzaKEY_0123456789&lang=en';
const LOGO = 'data:image/png;base64,' + Buffer.from('PNGDATA').toString('base64');

function fake(opt) {
  const o = Object.assign({ fail: false }, opt), sent = [], cfgs = [], links = [];
  return {
    sent, cfgs, links,
    deps: Object.assign({
      secrets: () => ({ user: 'invites@example.com', pass: 'abcdabcdabcdabcd' }),
      smtp: () => ({ host: '', port: '', from: '' }),
      site: () => 'my-desktop',
      projectId: () => 'demo-proj',
      link: async (email, s) => { links.push({ email, s }); return FB_LINK; },
      brand: async () => ({ name: 'עסק <b>"x"</b>\r\nBcc: evil@x.com', logo: LOGO }),
      transport: (cfg) => { cfgs.push(cfg); return { sendMail: async (m) => { if (o.fail) { const e = new Error('Invalid login: invites@example.com'); e.code = 'EAUTH'; throw e; } sent.push(m); }, close() {} }; },
      now: () => o.now || Date.now(),
    }, o.deps || {}),
  };
}
const req = (uid, data) => ({ auth: uid ? { uid } : null, data });
async function code(p) { try { await p; return 'OK'; } catch (e) { return (e.details && e.details.reason) || e.code || String(e); } }

before(async () => {
  env = await H.getEnv(); require('../functions/index.js'); M = require('../functions/invite-mail')._core;
});
after(async () => { try { env.cleanup(); } catch (e) { /* */ } });
beforeEach(async () => {
  await env.clearFirestore();
  await prep(async (db) => {
    await db.doc('superadmins/u_super').set({});
    await db.doc('b/im-a').set({ name: 'עסק א', status: 'active', dataRoot: 'b', brand: { name: 'א' } });
    await db.doc('b/im-a/private/info').set({ ownerEmail: 'owner@example.invalid' });
    await db.doc('b/im-a/staff/w1').set({ email: 'worker@example.invalid', active: true, name: 'דנה <b>' });
    await db.doc('b/im-a/admins/a_mgr').set({ email: 'mgr@example.invalid' });
    await db.doc('b/im-a/staff/w2').set({ email: 'Mixed.Case@Example.invalid', active: true });
    await db.doc('b/im-b').set({ name: 'ב', status: 'active', dataRoot: 'b', brand: {} });
    await db.doc('b/im-b/private/info').set({ ownerEmail: 'Big.Owner@Example.INVALID' });
    await db.doc('users/a_mgr').set({ bizId: 'im-a', role: 'admin', active: true, bizStatus: 'active' });
  });
});

describe('buildMail – escape, שם העסק, קישור', () => {
  it('שם עסק עם HTML ו-CRLF: בלי header injection, escape ב-HTML, נושא ושולח לפי השם', () => {
    const m = M.buildMail({ to: 'a@example.invalid', from: 'invites@example.com', brand: { name: 'עסק <img src=x onerror=alert(1)>\r\nBcc: e@x.com' }, link: 'https://s.web.app/welcome.html?a=1&b="2"' });
    assert.ok(!/[\r\n]/.test(m.subject) && !/[\r\n]/.test(m.from.name));
    assert.ok(!/[<>"]/.test(m.from.name));
    assert.ok(m.subject.startsWith('הזמנה לאפליקציית עסק'));
    assert.ok(!m.html.includes('<img src=x'), 'אין תגית מוזרקת');
    assert.ok(m.html.includes('href="https://s.web.app/welcome.html?a&#61;1&amp;b&#61;&quot;2&quot;"'));
    assert.equal(m.from.address, 'invites@example.com');
    assert.ok(m.html.includes('dir="rtl"') && m.html.includes('lang="he"'));
    assert.ok(m.text.includes('https://s.web.app/welcome.html?a=1&b="2"'));
  });
  it('בלי שם – "ניהול העסק"; 7 צעדים; לוגו מוטמע כ-cid', () => {
    const m = M.buildMail({ to: 'a@example.invalid', from: 'i@example.com', brand: { name: '', logo: LOGO }, link: 'https://x' });
    assert.equal(m.subject, 'הזמנה לאפליקציית ניהול העסק');
    assert.equal(m.from.name, 'ניהול העסק');
    assert.equal((m.html.match(/<li>/g) || []).length, 7);
    assert.equal(m.attachments.length, 1);
    assert.equal(m.attachments[0].cid, 'bizlogo@invite');
    assert.ok(m.html.includes('cid:bizlogo@invite'));
    assert.ok(/7\. התחברו עם המייל a@example.invalid/.test(m.text));
  });
  it('לוגו שאינו data:image מותר – לא מצורף', () => {
    assert.equal(M.buildMail({ to: 'a@b.co', from: 'i@b.co', brand: { name: 'x', logo: 'https://evil/x.png' }, link: 'https://x' }).attachments.length, 0);
  });
  it('welcomeLink: הקישור לדף שלנו עם mode/oobCode/apiKey/biz; אתר לא תקין – ריק', () => {
    const u = new URL(M.welcomeLink(FB_LINK, 'my-desktop', 'im-a', 'demo-proj'));
    assert.equal(u.origin + u.pathname, 'https://my-desktop.web.app/welcome.html');
    assert.equal(u.searchParams.get('mode'), 'resetPassword');
    assert.equal(u.searchParams.get('oobCode'), 'CODE_abcdefghij123');
    assert.equal(u.searchParams.get('apiKey'), 'AIzaKEY_0123456789');
    assert.equal(u.searchParams.get('biz'), 'im-a');
    assert.equal(new URL(u.searchParams.get('continueUrl')).searchParams.get('biz'), 'im-a');
    assert.equal(M.welcomeLink(FB_LINK, 'evil.com/x', 'im-a', 'p'), '');
    assert.equal(M.welcomeLink('https://x/?oobCode=a b', 'my-desktop', 'im-a', 'p'), '');
  });
  it('secretsOk: חסר / לא תקין → null; רווחים בסיסמת אפליקציה מוסרים', () => {
    assert.equal(M.secretsOk('', ''), null);
    assert.equal(M.secretsOk('dummy-not-an-email', 'dummy'), null);
    assert.deepEqual(M.secretsOk('resend', 're_AbC123_xyz'), { user: 'resend', pass: 're_AbC123_xyz' });
    assert.deepEqual(M.secretsOk('a@gmail.com', 'abcd efgh ijkl mnop'), { user: 'a@gmail.com', pass: 'abcdefghijklmnop' });
  });
});

describe('smtpOk – שרת גמיש', () => {
  it('ברירת מחדל Gmail 465 SSL; Resend 587 STARTTLS עם MAIL_FROM; ערכים לא תקינים → null', () => {
    assert.deepEqual(M.smtpOk('', '', '', 'a@gmail.com'), { host: 'smtp.gmail.com', port: 465, secure: true, from: 'a@gmail.com' });
    assert.deepEqual(M.smtpOk('smtp.resend.com', '587', 'invite@biz.co.il', 'resend'), { host: 'smtp.resend.com', port: 587, secure: false, from: 'invite@biz.co.il' });
    assert.equal(M.smtpOk('smtp.resend.com', '587', '', 'resend'), null, 'משתמש שאינו מייל בלי MAIL_FROM');
    assert.equal(M.smtpOk('evil host\r\n', '465', '', 'a@b.co'), null);
    assert.equal(M.smtpOk('smtp.x.com', '25', '', 'a@b.co'), null);
    assert.equal(M.smtpOk('smtp.x.com', '465', 'a@b.co\r\nBcc: x@y.z', 'a@b.co'), null);
  });
});

describe('sendInvite – הרשאות, שייכות, נפילה, קצב', () => {
  it('מנהל־על: נשלח דרך smtp.gmail.com:465 SSL, לכתובת של העסק, עם קישור לדף', async () => {
    const f = fake();
    const r = await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'Owner@Example.invalid' }), f.deps);
    assert.deepEqual(r, { ok: true, status: 'sent' });
    assert.equal(f.cfgs[0].host, 'smtp.gmail.com'); assert.equal(f.cfgs[0].port, 465); assert.equal(f.cfgs[0].secure, true);
    assert.equal(f.sent[0].to, 'owner@example.invalid');
    assert.ok(f.sent[0].text.includes('https://my-desktop.web.app/welcome.html?mode=resetPassword'));
    assert.ok(!/[\r\n]/.test(f.sent[0].subject));
    assert.equal(f.links[0].s.url, 'https://demo-proj.firebaseapp.com/?biz=im-a');
    assert.ok(!JSON.stringify(r).includes('abcd'), 'סוד לא בתשובה');
  });
  it('עובד שנוסף (staff) – גם נשלח', async () => {
    assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'worker@example.invalid' }), fake().deps)).status, 'sent');
  });
  it('12.11: מייל לעובד – שם העובד, פרטי הכניסה, לוגו העסק, קישור הורדה של העסק וקישור למחשב', async () => {
    const f = fake();
    assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'worker@example.invalid' }), f.deps)).status, 'sent');
    const m = f.sent[0];
    assert.ok(m.text.startsWith('שלום דנה b,'), 'פנייה בשם (בלי תגיות)');
    assert.ok(m.text.includes('מייל לכניסה: worker@example.invalid'));
    assert.ok(m.text.includes('https://my-desktop.web.app/'), 'גם לעובד – קישור למחשב');
    assert.ok(m.text.includes('https://github.com/nati59029-a11y/large-pami-android/releases/download/business-latest/business.apk'));
    assert.ok(!m.html.includes('<b>"x"</b>') && !m.html.includes('דנה <b>'), 'escape');
    assert.equal(m.attachments.length, 1); assert.equal(m.attachments[0].cid, 'bizlogo@invite');
    assert.ok(m.html.includes('src="cid:bizlogo@invite"'), 'הלוגו של העסק במייל');
  });
  it('12.11: עסק עם APK משלו (apkTag) – הקישור ל-APK של העסק; לארג\' פעמי – latest; ערך זר – הכללי', async () => {
    assert.equal(M.apkUrl('im-a', 'biz-im-a'), 'https://github.com/nati59029-a11y/large-pami-android/releases/download/biz-im-a/biz-im-a.apk');
    assert.equal(M.apkUrl('im-a', 'biz-other'), 'https://github.com/nati59029-a11y/large-pami-android/releases/download/business-latest/business.apk');
    assert.equal(M.apkUrl('largpeami', 'latest'), 'https://github.com/nati59029-a11y/large-pami-android/releases/download/latest/large-pami.apk');
    const f = fake({ deps: { brand: async () => ({ name: 'א', logo: '', apkTag: 'biz-im-a' }) } });
    await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'owner@example.invalid' }), f.deps);
    assert.ok(f.sent[0].text.includes('/releases/download/biz-im-a/biz-im-a.apk'));
    assert.ok(f.sent[0].text.startsWith('שלום,'), 'בלי שם – פנייה כללית');
    assert.equal(M.buildMail({ to: 'a@b.co', from: 'x@y.co', brand: {}, link: 'https://s.web.app/w', apk: 'https://evil.example/x.apk' }).text.includes('evil'), false);
  });
  it('השוואת מייל בלי תלות באותיות: מייל שנשמר באותיות גדולות (staff ו-ownerEmail) – נשלח', async () => {
    assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'mixed.case@example.invalid' }), fake().deps)).status, 'sent');
    assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-b', email: 'BIG.owner@example.invalid' }), fake().deps)).status, 'sent');
  });
  it('לא מנהל־על (מנהל עסק / לא מחובר) – נדחה ולא נשלח', async () => {
    const f = fake();
    assert.equal(await code(M.sendInvite(req('a_mgr', { bizId: 'im-a', email: 'owner@example.invalid' }), f.deps)), 'not-superadmin');
    assert.equal(await code(M.sendInvite(req(null, { bizId: 'im-a', email: 'owner@example.invalid' }), f.deps)), 'not-signed-in');
    assert.equal(f.sent.length + f.links.length, 0);
  });
  it('כתובת שלא שייכת לעסק – נדחה (לא כלי ספאם)', async () => {
    const f = fake();
    assert.equal(await code(M.sendInvite(req('u_super', { bizId: 'im-a', email: 'stranger@example.invalid' }), f.deps)), 'not-member');
    assert.equal(await code(M.sendInvite(req('u_super', { bizId: 'im-a', email: 'a@b.co\r\nBcc: x@y.z' }), f.deps)), 'bad-email');
    assert.equal(f.sent.length, 0);
  });
  it('אין סודות – fallback בלי ליצור קישור', async () => {
    const f = fake({ deps: { secrets: () => null } });
    assert.deepEqual(await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'owner@example.invalid' }), f.deps), { ok: true, status: 'fallback', why: 'no-secrets' });
    assert.equal(f.links.length, 0);
  });
  it('שרת אחר (Resend) – הגדרות התעבורה והשולח לפי MAIL_HOST/PORT/FROM', async () => {
    const f = fake({ deps: { secrets: () => ({ user: 'resend', pass: 're_key_12345678' }), smtp: () => ({ host: 'smtp.resend.com', port: '587', from: 'invite@biz.co.il' }) } });
    assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'owner@example.invalid' }), f.deps)).status, 'sent');
    assert.equal(f.cfgs[0].host, 'smtp.resend.com'); assert.equal(f.cfgs[0].port, 587); assert.equal(f.cfgs[0].secure, false); assert.equal(f.cfgs[0].requireTLS, true);
    assert.equal(f.sent[0].from.address, 'invite@biz.co.il');
    const g = fake({ deps: { smtp: () => ({ host: 'smtp.x.com', port: '25' }) } });
    assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'owner@example.invalid' }), g.deps)).why, 'no-smtp');
  });
  it('בלי אתר מוגדר – fallback', async () => {
    assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'owner@example.invalid' }), fake({ deps: { site: () => '' } }).deps)).why, 'no-site');
  });
  it('השליחה נכשלה – fallback, בלי הודעת השגיאה בתשובה', async () => {
    const r = await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'owner@example.invalid' }), fake({ fail: true }).deps);
    assert.deepEqual(r, { ok: true, status: 'fallback', why: 'send' });
  });
  it('הגבלת קצב: 10 לשעה לעסק, ואז fallback', async () => {
    const f = fake({ now: 1e12 });
    for (let i = 0; i < 10; i++) assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'owner@example.invalid' }), f.deps)).status, 'sent');
    assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'owner@example.invalid' }), f.deps)).why, 'rate');
    assert.equal(f.sent.length, 10);
    const later = fake({ now: 1e12 + 3600001 });
    assert.equal((await M.sendInvite(req('u_super', { bizId: 'im-a', email: 'owner@example.invalid' }), later.deps)).status, 'sent');
  });
});
