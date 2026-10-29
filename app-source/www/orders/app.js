/* לשונית "הזמנות אתר" (שלב 1.6, גרסת בדיקה): פתיחה, כניסה, תפקיד, וניווט בין המסכים.
   מנהל רואה את כל המסכים. עובד רואה רק את רשימת המוצרים (בלי מחירי עלות ובלי מחיר סיטונאי) והעלאת צילומים. */
import { backend } from './backend.js';
import * as api from './api.js';
import { esc, $, toast, modalOpen, closeModal } from './ui.js';
import products from './screens/products.js';
import importer from './screens/import.js';
import photos from './screens/photos.js';
import categories from './screens/categories.js';
import settings from './screens/settings.js';
import customers from './screens/customers.js';

const SCREENS = [products, importer, photos, categories, settings, customers];
const main = $('#main');
const backToApp = () => { location.href = '../index.html' + location.search; };
$('#toApp').onclick = backToApp;

// מחסנית של תת-מסכים בתוך מסך (למשל: רשימת מוצרים ← עריכת מוצר)
const NAV = { screen: null, stack: [] };
const ctx = {
  main,
  open(render) { NAV.stack.push(render); draw(); },
  back() { if (NAV.stack.length) { NAV.stack.pop(); draw(); return true; } return false; },
  replace(render) { NAV.stack.pop(); NAV.stack.push(render); draw(); },
  refresh() { draw(); },
};
async function draw() {
  window.scrollTo(0, 0);
  const r = NAV.stack.length ? NAV.stack[NAV.stack.length - 1] : (root) => NAV.screen.render(root, ctx);
  main.innerHTML = '<p class="note">טוען…</p>';
  try { await r(main, ctx); } catch (e) { main.innerHTML = `<div class="card"><p class="err">${esc(e.message || e)}</p><button class="btn g" id="retry">נסה שוב</button></div>`; $('#retry').onclick = draw; }
}
function tabs() {
  const list = SCREENS.filter((s) => s.roles.includes(api.role()));
  const nav = $('#tabs');
  nav.hidden = false;
  nav.innerHTML = list.map((s) => `<button data-id="${s.id}" ${NAV.screen === s ? 'aria-current="page"' : ''}>${esc(s.title)}</button>`).join('');
  nav.querySelectorAll('button').forEach((b) => { b.onclick = () => go(list.find((s) => s.id === b.dataset.id)); });
}
function go(screen) { NAV.screen = screen; NAV.stack = []; tabs(); draw(); }

// כפתור "חזור" של אנדרואיד: סוגר חלון, חוזר מתת-מסך, ובסוף חוזר לאפליקציה
try {
  const C = window.Capacitor;
  if (C && C.Plugins && C.Plugins.App) C.Plugins.App.addListener('backButton', () => { if (modalOpen()) closeModal(); else if (!ctx.back()) backToApp(); });
} catch (e) { /* בדפדפן אין תוסף */ }

// המשתמש שמחובר עכשיו באפליקציה הראשית (lp-sync). הלשונית פועלת רק בשמו – כך במכשיר משותף
// מי שנכנס לאפליקציה אחרי מישהו אחר לא יקבל את הכניסה הקודמת של הלשונית.
function appUser() {
  try { const y = JSON.parse(localStorage.getItem('lp-sync')) || {}; return y.refresh && y.uid && (y.role === 'admin' || y.role === 'worker') ? { uid: y.uid, email: y.email || '' } : null; } catch (e) { return null; }
}
function loginForm(msg) {
  $('#tabs').hidden = true; $('#out').hidden = true; $('#who').textContent = '';
  NAV.screen = null; NAV.stack = [];
  const au = appUser();
  const email = au ? au.email : '';
  main.innerHTML = `<div class="card"><h2>כניסה ללשונית</h2>
    <p class="note">הלשונית מתחברת לשרת של האתר. נכנסים פעם אחת עם אותו אימייל וסיסמה של האפליקציה.</p>
    <form id="lf"><label class="f"><span>אימייל</span><input name="email" type="email" autocomplete="username" required value="${esc(email)}" dir="ltr"></label>
    <label class="f"><span>סיסמה</span><input name="pw" type="password" autocomplete="current-password" required dir="ltr"></label>
    <p class="err" id="lerr" role="alert">${esc(msg || '')}</p><button class="btn w" id="lbtn">כניסה</button></form></div>`;
  $('#lf').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target; const b = $('#lbtn'); b.disabled = true; $('#lerr').textContent = '';
    try {
      await api.login(f.email.value.trim(), f.pw.value);
      const now = appUser();
      if (!now || now.uid !== api.currentUser().uid) { await api.logout(); throw new Error(now ? `יש להיכנס עם המשתמש שמחובר עכשיו לאפליקציה (${now.email}).` : 'קודם צריך להתחבר לאפליקציה עצמה, ורק אחר כך ללשונית.'); }
      await enter();
    } catch (e) { $('#lerr').textContent = e.message; } finally { if (b.isConnected) b.disabled = false; }
  };
}
async function enter() {
  try { await api.detectRole(); } catch (e) { loginForm(e.message); return; }
  const u = api.currentUser();
  $('#who').textContent = (api.isManager() ? 'מנהל' : 'עובד') + ' · ' + (u.email || '');
  $('#out').hidden = false;
  go(SCREENS[0]);
}
$('#out').onclick = async () => { await api.logout(); toast('התנתקת מהלשונית'); loginForm(); };

(async function boot() {
  const be = backend();
  if (!be.ok) { main.innerHTML = `<div class="card"><p>${esc(be.msg)}</p><button class="btn g" id="bk2">חזרה לאפליקציה</button></div>`; $('#bk2').onclick = backToApp; return; }
  $('#demo').hidden = !be.demo;
  api.init(be);
  const u = await api.waitForUser();
  const au = appUser();
  // אין משתמש באפליקציה, או שהוא משתמש אחר: מנתקים את הלשונית ומציגים כניסה. התפקיד נבדק מחדש מהמסד בכל כניסה (enter).
  if (u && (!au || au.uid !== u.uid)) { await api.logout(); loginForm(au ? '' : 'קודם צריך להתחבר לאפליקציה עצמה, ורק אחר כך ללשונית.'); return; }
  if (u) await enter(); else loginForm(au ? '' : 'קודם צריך להתחבר לאפליקציה עצמה, ורק אחר כך ללשונית.');
})();
