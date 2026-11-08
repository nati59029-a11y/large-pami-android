'use strict';
// דף הפתיחה להזמנה (welcome.html, 2026-11-08): רשת מדומה (Playwright route). בודק: שם העסק והלוגו, קביעת סיסמה,
// קוד שפג, אימות בצד הלקוח, הסרת oobCode משורת הכתובת, קישור APK לפי apkTag, והעברת mode=signIn ל-continueUrl.
// שימוש: node ui-welcome.js <www-dir>
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
let fail = 0;
const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 300) : '')); };
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
(async () => {
  const www = process.argv[2];
  const html = fs.readFileSync(path.join(www, 'welcome.html'));
  const srv = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(html); }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}/welcome.html`;
  const br = await chromium.launch({ executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined });
  const calls = [];
  async function open(qs, opt) {
    const pg = await br.newPage({ viewport: { width: 380, height: 760 } });
    await pg.route('**/api/publicBrand**', (r) => r.fulfill({ status: opt.brand ? 200 : 404, contentType: 'application/json', body: JSON.stringify(opt.brand || { error: 'none' }) }));
    await pg.route('https://identitytoolkit.googleapis.com/**', async (r) => {
      const b = JSON.parse(r.request().postData() || '{}'); calls.push(b);
      if (opt.expired) return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":{"message":"EXPIRED_OOB_CODE"}}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'boss@example.invalid', requestType: 'PASSWORD_RESET' }) });
    });
    await pg.route('https://next.example/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>next</p>' }));
    await pg.route('https://largpeami-test-f4691.web.app/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>app</p>' }));
    await pg.goto(base + qs); await pg.waitForTimeout(500); return pg;
  }
  const cont = encodeURIComponent('https://demo.firebaseapp.com/?biz=biz-a');
  let pg = await open(`?mode=resetPassword&oobCode=CODE1&apiKey=K&continueUrl=${cont}&lang=he`, { brand: { name: 'מאפיית דוד', logo: LOGO, colors: { acc: '#3366cc' }, apkTag: 'biz-biz-a' } });
  check('כותרת עם שם העסק', (await pg.textContent('#h')) === 'ברוכים הבאים למאפיית דוד');
  check('לוגו מוצג', await pg.isVisible('#logo'));
  check('המייל מוצג', (await pg.textContent('#sub')).includes('boss@example.invalid'));
  check('oobCode הוסר משורת הכתובת', !pg.url().includes('CODE1'), pg.url());
  check('אין "איפוס סיסמה" בדף', !(await pg.content()).includes('איפוס'));
  await pg.fill('#p1', 'abc'); await pg.fill('#p2', 'abc'); await pg.click('#go');
  check('סיסמה קצרה נחסמת', (await pg.textContent('#msg')).includes('8'));
  await pg.fill('#p1', 'Secret123!'); await pg.fill('#p2', 'Secret124!'); await pg.click('#go');
  check('סיסמאות שונות נחסמות', (await pg.textContent('#msg')).includes('לא זהות'));
  await pg.fill('#p2', 'Secret123!'); await pg.click('#go'); await pg.waitForTimeout(300);
  check('קביעת סיסמה נשלחה עם הקוד', calls.some((c) => c.oobCode === 'CODE1' && c.newPassword === 'Secret123!'));
  check('אחרי הצלחה – כפתור הורדה', await pg.isVisible('#apk'));
  check('קישור APK של העסק', (await pg.getAttribute('#apk', 'href')).endsWith('/releases/download/biz-biz-a/biz-biz-a.apk'));
  check('הוראות התקנה עם המייל אחרי קביעת סיסמה', await pg.isVisible('#steps') && (await pg.textContent('#steps')).includes('boss@example.invalid') && (await pg.textContent('#steps')).includes('ממקור'));
  check('מסך טלפון בלי גלילה אופקית', await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pg.close();
  pg = await open(`?mode=resetPassword&oobCode=OLD&apiKey=K&continueUrl=${cont}`, { expired: true });
  check('בלי סיסמה – אין הוראות', !(await pg.isVisible('#steps')));
  check('קוד שפג – הודעה ברורה, בלי טופס', (await pg.textContent('#msg')).includes('פג תוקף') && !(await pg.isVisible('#f')));
  check('בלי מיתוג – APK כללי', (await pg.getAttribute('#apk', 'href')).endsWith('/latest/large-pami.apk'));
  await pg.close();
  pg = await open(`?mode=resetPassword&oobCode=C&apiKey=K&continueUrl=${encodeURIComponent('https://x/?biz=<script>')}`, {});
  check('bizId לא תקין – לא נשלחת בקשת מיתוג, הדף עובד (כללי)', (await pg.textContent('#h')) === 'קביעת סיסמה חדשה');
  await pg.close();
  pg = await open(`?mode=signIn&oobCode=S1&apiKey=K&continueUrl=${encodeURIComponent('https://largpeami-test-f4691.web.app/')}`, {});
  check('mode=signIn לאתר של הפרויקט – מועבר עם הקוד', pg.url().startsWith('https://largpeami-test-f4691.web.app/') && pg.url().includes('oobCode=S1'), pg.url());
  await pg.close();
  for (const bad of ['https://next.example/app', 'https://evil.web.app/', 'https://largpeami-test-f4691.web.app.evil.com/', 'javascript:alert(1)', 'http://largpeami-test-f4691.web.app/', 'https://u:p@largpeami-test-f4691.web.app/']) {
    pg = await open(`?mode=signIn&oobCode=S2&apiKey=K&continueUrl=${encodeURIComponent(bad)}`, {});
    check('הפניה ליעד זר נחסמת: ' + bad, pg.url().startsWith(base) && !pg.url().includes('S2') && (await pg.textContent('#sub')).includes('לא נתמך'), pg.url());
    await pg.close();
  }
  // "שכחתי סיסמה": אין continueUrl/biz שלנו – כותרת כללית, בלי "הוזמנתם", בלי הורדה/הוראות
  pg = await open('?mode=resetPassword&oobCode=F1&apiKey=K&lang=he', {});
  check('שכחתי סיסמה: כותרת "קביעת סיסמה חדשה", בלי "הוזמנתם"', (await pg.textContent('#h')) === 'קביעת סיסמה חדשה' && !(await pg.textContent('#sub')).includes('הוזמנתם'));
  await pg.fill('#p1', 'Secret123!'); await pg.fill('#p2', 'Secret123!'); await pg.click('#go'); await pg.waitForTimeout(300);
  check('שכחתי סיסמה: אחרי קביעה – הודעת הצלחה, בלי כפתור הורדה והוראות', (await pg.textContent('#msg')).includes('נקבעה') && !(await pg.isVisible('#apk')) && !(await pg.isVisible('#steps')));
  await pg.close();
  await br.close(); srv.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
