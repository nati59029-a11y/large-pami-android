/* שלב 2.8: אימות דו-שלבי (קוד מתחלף מאפליקציה, TOTP) לצוות – רק בגרסת הבדיקה (SITE_BACKEND=test).
   הקובץ לא נמצא ב-www/ ולא נטען בגרסה הרגילה. scripts/prepare.js מעתיק אותו ל-www/ ומחבר אותו ל-index.html רק בבנייה עם
   SITE_BACKEND=test (ה11). כך index.html של הגרסה הרגילה זהה בית-בבית לקודם.
   החיבור (3 החלפות ב-prepare.js): syLogin קורא ל-LP_MFA.signIn במקום signInWithPassword, ובפתיחה (boot) – LP_MFA.check().
   משתמש בפונקציות של index.html (jf, GAPI, FB, FSB, SY, syOut, showGate, tok) – הן מוגדרות בסקריפט הראשי, שנטען אחרי הקובץ הזה,
   ונקראות רק בזמן הכניסה.
   מה קורה:
   - כניסה של מי שכבר רשום לקוד: Firebase מחזיר "צריך גורם שני" ← חלון קוד ← mfaSignIn:finalize ← טוקן עם הגורם השני.
   - כניסה של עובד או מנהל ש-staff/{uid}.mfaRequired == true ועוד לא רשום: הרשמה (מפתח להקלדה באפליקציית האימות + קוד ראשון).
   - מייל שלא אומת: Firebase לא מאפשר הרשמה לקוד. שולחים מייל אימות (של Firebase) ומבקשים להתחבר שוב אחרי האישור.
   - בפתיחת האפליקציה: מי שמחובר בלי גורם שני ו-mfaRequired == true – מנותק, ומתבקש להתחבר שוב עם קוד.
   המפתח הסודי לא נשמר בשום מקום (רק מוצג פעם אחת על המסך). */
(function () {
  'use strict';
  const ISSUER = 'LargePami';
  const errMsg = (m) => { const e = new Error(m); e.noAccess = true; return e; };
  const b64json = (s) => { try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } };
  const claims = (t) => (typeof t === 'string' && t.split('.').length >= 2 ? b64json(t.split('.')[1]) : null) || {};
  const factorOf = (t) => ((claims(t).firebase || {}).sign_in_second_factor) || null;
  const expiresIn = (t) => String(Math.max(60, (Number(claims(t).exp) || 0) - Math.floor(Date.now() / 1000)));
  const idt = (v) => `${GAPI('identitytoolkit.googleapis.com')}/${v}`;
  const post = (url, body) => jf(url + (url.includes('?') ? '&' : '?') + 'key=' + FB.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const code6 = (s) => String(s || '').replace(/\D/g, '');

  // ---- חלון קוד (בלי innerHTML עם נתונים: הכול textContent) ----
  function ask(o) {
    return new Promise((done) => {
      const old = document.getElementById('mfaDlg'); if (old) old.remove();
      const w = document.createElement('div'); w.id = 'mfaDlg'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.dir = 'rtl';
      w.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px';
      const c = document.createElement('div');
      c.style.cssText = 'background:var(--card,#1b2023);color:var(--ink,#ece9e1);border:1px solid var(--acc,#c9a227);border-radius:16px;max-width:420px;width:100%;padding:18px;font-size:1rem;line-height:1.5;box-sizing:border-box';
      const h = document.createElement('h2'); h.style.cssText = 'margin:0 0 8px;font-size:1.2rem;color:var(--acc,#c9a227)'; h.textContent = o.title; c.append(h);
      for (const t of o.lines || []) { const p = document.createElement('p'); p.style.margin = '0 0 8px'; p.textContent = t; c.append(p); }
      if (o.secret) {
        const k = document.createElement('div'); k.id = 'mfaSecret'; k.dir = 'ltr';
        k.style.cssText = 'font-family:monospace;font-size:1.1rem;letter-spacing:.08em;background:var(--bg,#121516);border-radius:10px;padding:10px;margin:0 0 8px;text-align:center;user-select:all;word-break:break-all';
        k.textContent = o.secret.replace(/(.{4})/g, '$1 ').trim(); c.append(k);
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin:0 0 10px;flex-wrap:wrap';
        const cp = document.createElement('button'); cp.type = 'button'; cp.textContent = 'העתק מפתח';
        cp.style.cssText = 'flex:1;min-height:44px;border-radius:10px;border:1px solid var(--line,#313a3d);background:transparent;color:inherit';
        cp.onclick = () => { try { navigator.clipboard.writeText(o.secret).then(() => { cp.textContent = 'הועתק'; }, () => {}); } catch (e) { /* */ } };
        const a = document.createElement('a'); a.href = o.uri; a.textContent = 'פתח באפליקציית האימות'; a.id = 'mfaUri';
        a.style.cssText = 'flex:1;min-height:44px;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--acc,#c9a227);color:var(--acc,#c9a227);text-decoration:none';
        row.append(cp, a); c.append(row);
      }
      const inp = document.createElement('input'); inp.id = 'mfaCode'; inp.type = 'text'; inp.inputMode = 'numeric'; inp.autocomplete = 'one-time-code'; inp.maxLength = 8; inp.dir = 'ltr';
      inp.setAttribute('aria-label', 'קוד מאפליקציית האימות');
      inp.style.cssText = 'width:100%;box-sizing:border-box;min-height:48px;font-size:1.4rem;letter-spacing:.3em;text-align:center;border-radius:10px;border:1px solid var(--line,#313a3d);background:var(--bg,#121516);color:inherit;margin:0 0 6px';
      if (o.code !== false) c.append(inp);
      const er = document.createElement('p'); er.id = 'mfaErr'; er.setAttribute('role', 'alert'); er.style.cssText = 'min-height:1.4em;margin:0 0 8px;color:var(--bad,#ff8c80)'; er.textContent = o.error || ''; c.append(er);
      const bs = document.createElement('div'); bs.style.cssText = 'display:flex;gap:8px';
      const ok = document.createElement('button'); ok.type = 'button'; ok.id = 'mfaOk'; ok.textContent = o.okText || 'אישור';
      ok.style.cssText = 'flex:2;min-height:48px;border-radius:12px;border:0;background:var(--acc,#c9a227);color:var(--onacc,#111);font-weight:700;font-size:1rem';
      const no = document.createElement('button'); no.type = 'button'; no.id = 'mfaCancel'; no.textContent = 'ביטול';
      no.style.cssText = 'flex:1;min-height:48px;border-radius:12px;border:1px solid var(--line,#313a3d);background:transparent;color:inherit;font-size:1rem';
      bs.append(ok); if (o.cancel !== false) bs.append(no); c.append(bs);
      w.append(c); document.body.append(w);
      const close = (v) => { w.remove(); done(v); };
      ok.onclick = () => {
        if (o.code === false) { close(''); return; }
        const v = code6(inp.value);
        if (v.length < 6) { er.textContent = 'יש להקליד את הקוד בן 6 הספרות מאפליקציית האימות'; return; }
        close(v);
      };
      no.onclick = () => close(null);
      inp.onkeydown = (e) => { if (e.key === 'Enter') ok.onclick(); };
      setTimeout(() => { try { (o.code === false ? ok : inp).focus(); } catch (e) { /* */ } }, 50);
    });
  }
  const cancelled = () => errMsg('הכניסה בוטלה. כדי להיכנס צריך את הקוד מאפליקציית האימות.');
  const done = (j, localId) => {
    if (factorOf(j.idToken) !== 'totp') throw errMsg('ההרשמה לקוד הושלמה. התחבר שוב – הפעם עם קוד חדש מאפליקציית האימות.');
    return { idToken: j.idToken, refreshToken: j.refreshToken, expiresIn: expiresIn(j.idToken), localId };
  };

  // ---- כניסה של מי שכבר רשום לקוד ----
  async function finishSignIn(r) {
    const f = (r.mfaInfo || []).find((x) => x && x.totpInfo !== undefined);
    if (!f) throw errMsg('בחשבון הזה רשום אימות דו-שלבי שאינו קוד מאפליקציה. פנה למנהל העסק.');
    let error = '';
    for (;;) {
      const code = await ask({ title: 'אימות דו-שלבי', lines: ['הקלד את הקוד בן 6 הספרות שמופיע עכשיו באפליקציית האימות (למשל Google Authenticator).'], error, okText: 'כניסה' });
      if (code === null) throw cancelled();
      try {
        const j = await post(idt('v2/accounts/mfaSignIn:finalize'), { mfaPendingCredential: r.mfaPendingCredential, mfaEnrollmentId: f.mfaEnrollmentId, totpVerificationInfo: { verificationCode: code } });
        return done(j, r.localId);
      } catch (e) {
        const m = String(e.message || '');
        if (e.offline) throw e;
        if (/MFA_PENDING_CREDENTIAL|EXPIRED|SESSION/i.test(m)) throw errMsg('עבר יותר מדי זמן. התחבר שוב.');
        if (/TOO_MANY/i.test(m)) throw errMsg('יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.');
        error = 'הקוד לא נכון או שפג תוקפו. נסה את הקוד שמופיע עכשיו.';
      }
    }
  }

  // ---- האם צריך להירשם: staff/{uid}.mfaRequired == true (העובד קורא את המסמך של עצמו גם בלי גורם שני) ----
  async function mfaRequired(idToken, uid) {
    let r;
    try { r = await fetch(FSB() + '/staff/' + encodeURIComponent(uid), { headers: { Authorization: 'Bearer ' + idToken } }); } catch (e) { const x = new Error('אין חיבור לאינטרנט'); x.offline = true; throw x; }
    if (!r.ok) return false; // לא עובד (או מנהל בלי מסמך staff) – ההמשך של syLogin מטפל כמו קודם
    const d = await r.json().catch(() => null);
    return !!(d && d.fields && d.fields.mfaRequired && d.fields.mfaRequired.booleanValue === true);
  }

  // ---- הרשמה ראשונה לקוד ----
  async function enroll(r, email) {
    let s;
    try {
      s = (await post(idt('v2/accounts/mfaEnrollment:start'), { idToken: r.idToken, totpEnrollmentInfo: {} })).totpSessionInfo;
    } catch (e) {
      const m = String(e.message || '');
      if (e.offline) throw e;
      if (/UNVERIFIED_EMAIL/i.test(m)) {
        let sent = true;
        try { await post(idt('v1/accounts:sendOobCode'), { requestType: 'VERIFY_EMAIL', idToken: r.idToken }); } catch (x) { sent = false; }
        throw errMsg(sent ? `לפני ההרשמה לקוד צריך לאמת את כתובת המייל. שלחנו מייל אימות אל ${email}. לחץ על הקישור שבמייל, ואז התחבר שוב.` : 'צריך לאמת את כתובת המייל לפני ההרשמה לקוד, ושליחת מייל האימות נכשלה. פנה למנהל העסק.');
      }
      throw errMsg('אימות דו-שלבי עוד לא הופעל בשרת, ולכן אי אפשר להירשם לקוד. פנה למנהל העסק. (' + m.slice(0, 80) + ')');
    }
    if (!s || !s.sharedSecretKey || !s.sessionInfo) throw errMsg('תשובה לא צפויה מהשרת בהרשמה לקוד. נסה שוב.');
    const digits = Number(s.verificationCodeLength) || 6, period = Number(s.periodSec) || 30, alg = String(s.hashingAlgorithm || 'SHA1').replace(/^HMAC_?/i, '').replace(/-/g, '');
    const uri = `otpauth://totp/${encodeURIComponent(ISSUER + ':' + email)}?secret=${encodeURIComponent(s.sharedSecretKey)}&issuer=${encodeURIComponent(ISSUER)}&algorithm=${encodeURIComponent(alg)}&digits=${digits}&period=${period}`;
    let error = '';
    for (;;) {
      const code = await ask({
        title: 'הרשמה לאימות דו-שלבי',
        lines: ['בגרסת הבדיקה הכניסה של הצוות דורשת גם קוד מתחלף מאפליקציית אימות (כמו Google Authenticator).',
          '1. פתח את אפליקציית האימות ובחר "הוספה" ← "הזנת מפתח". 2. הקלד את המפתח שלמטה (או לחץ "פתח באפליקציית האימות"). 3. הקלד כאן את הקוד שמופיע באפליקציה.',
          'המפתח מוצג רק עכשיו. אל תשלח אותו לאף אחד.'],
        secret: s.sharedSecretKey, uri, error, okText: 'סיום הרשמה',
      });
      if (code === null) throw cancelled();
      try {
        const j = await post(idt('v2/accounts/mfaEnrollment:finalize'), { idToken: r.idToken, displayName: 'אפליקציית אימות', totpVerificationInfo: { sessionInfo: s.sessionInfo, verificationCode: code } });
        return done(j, r.localId);
      } catch (e) {
        if (e.offline) throw e;
        const m = String(e.message || '');
        if (/SESSION|EXPIRED/i.test(m)) throw errMsg('עבר יותר מדי זמן מאז שהמפתח הוצג. התחבר שוב כדי לקבל מפתח חדש.');
        error = 'הקוד לא נכון. בדוק שהמפתח הוקלד נכון, ונסה את הקוד שמופיע עכשיו.';
      }
    }
  }

  async function signIn(email, pw) {
    const r = await post(idt('v1/accounts:signInWithPassword'), { email, password: pw, returnSecureToken: true });
    if (r.mfaPendingCredential) return finishSignIn(r);
    if (!r.idToken) throw errMsg('תשובה לא צפויה מהשרת. נסה שוב.');
    if (await mfaRequired(r.idToken, r.localId)) return enroll(r, email);
    return r;
  }

  // ---- בפתיחה: מחובר בלי גורם שני, ו-mfaRequired == true ← ניתוק וכניסה מחדש ----
  async function check() {
    try {
      if (!SY || !SY.refresh || !SY.uid) return;
      const t = await tok();
      if (factorOf(t) === 'totp') return;
      if (!(await mfaRequired(t, SY.uid))) return;
      syOut(); document.body.classList.remove('wk');
      showGate('נדרש אימות דו-שלבי. התחבר שוב, עם הקוד מאפליקציית האימות.');
    } catch (e) { /* בלי חיבור – ממשיכים; השרת והכללים חוסמים בכל מקרה */ }
  }

  window.LP_MFA = { signIn, check, _ask: ask };
})();
