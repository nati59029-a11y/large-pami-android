/* לאיזה שרת הלשונית מתחברת – נקבע כאן בלבד.
   1. בדפדפן מקומי עם ?emu=1 (אותו תנאי כמו EMU ב-index.html הראשי): האמולטור, בפרויקט הדמה demo-largpeami.
      אפשר לשנות פורטים: ?emu=1&auth=16099&fs=16080&fn=16001&st=16199
   2. אחרת: לפי window.LP_SITE_BACKEND, שנכתב בבנייה (site-backend.js). 'off' = כבוי.
   לעולם לא מתחברים לפרויקט האמיתי largpeami מכאן: גם אם מישהו יכתוב אותו בהגדרות, הלשונית מסרבת. */
const q = new URLSearchParams(location.search);
const host = location.hostname;
const LOCAL = location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(host) && !!location.port;
const EMU = LOCAL && q.get('emu') === '1';

// פרויקט הבדיקה (largpeami-test): הפרטים ימולאו כשהפרויקט יוקם (לא מאומת – הפרויקט עוד לא קיים).
const TEST = { projectId: '', apiKey: '', appId: '', storageBucket: '' };

export function backend() {
  const mode = EMU ? 'emulator' : (window.LP_SITE_BACKEND || 'off');
  if (mode === 'emulator') {
    if (!EMU) return { ok: false, msg: 'מצב אמולטור עובד רק בדפדפן במחשב (כתובת מקומית עם ?emu=1).' };
    const port = (k, d) => Number(q.get(k) || d);
    return {
      ok: true, mode, demo: true,
      config: { apiKey: 'demo-key', projectId: 'demo-largpeami', appId: '1:1:web:demo', storageBucket: 'demo-largpeami' },
      emu: { host, auth: port('auth', 9099), fs: port('fs', 8080), fn: port('fn', 5001), st: port('st', 9199) },
      storageBase: `http://${host}:${port('st', 9199)}`,
    };
  }
  if (mode === 'test') {
    if (!TEST.projectId || !TEST.apiKey) return { ok: false, msg: 'פרויקט הבדיקה עוד לא הוגדר באפליקציה. הלשונית תיפתח אחרי שהוא יוקם.' };
    if (/^largpeami$/i.test(TEST.projectId)) return { ok: false, msg: 'הלשונית בגרסת בדיקה, ולא מתחברת לפרויקט האמיתי.' };
    return { ok: true, mode, demo: true, config: TEST, emu: null, storageBase: 'https://firebasestorage.googleapis.com' };
  }
  return { ok: false, msg: 'הלשונית "הזמנות אתר" כבויה בגרסה הזו של האפליקציה.' };
}
