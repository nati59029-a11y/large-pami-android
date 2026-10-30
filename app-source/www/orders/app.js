/* לשונית "הזמנות אתר" (שלב 1.6, גרסת בדיקה; כניסה אחת – שלב 1.10ב): פתיחה, כניסה, תפקיד, וניווט בין המסכים.
   מנהל רואה את כל המסכים. עובד רואה מוצרים (בלי מחירי עלות ובלי מחיר סיטונאי), העלאת צילומים,
   ולקוחות סיטונאים (כרטיס, הזמנות פתוחות, חשבוניות והזמנה חדשה) – בלי עלות ובלי רווח בשום מקום. */
import { backend } from './backend.js';
import * as api from './api.js';
import { esc, $, modalOpen, closeModal } from './ui.js';
import products from './screens/products.js';
import importer from './screens/import.js';
import photos from './screens/photos.js';
import categories from './screens/categories.js';
import settings from './screens/settings.js';
import customers from './screens/customers.js';
import work from './screens/work.js';
import admin from './screens/admin.js';
import inspirations from './screens/inspirations.js';

const SCREENS = [products, importer, photos, categories, settings, customers, ...work, ...admin, inspirations];
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
  // כל ציור מקבל תיבה חדשה. מסך ישן שעוד רץ ברקע (אחרי await) כותב לתיבה שכבר לא במסך (isConnected=false) ולא דורס את המסך החדש
  const box = document.createElement('div');
  box.innerHTML = '<p class="note">טוען…</p>';
  main.replaceChildren(box);
  try { await r(box, ctx); } catch (e) { if (!box.isConnected) return; main.innerHTML = `<div class="card"><p class="err">${esc(e.message || e)}</p><button class="btn g" id="retry">נסה שוב</button></div>`; $('#retry').onclick = draw; }
}
function tabs() {
  const list = SCREENS.filter((s) => s.roles.includes(api.role()));
  const nav = $('#tabs');
  nav.hidden = false;
  nav.innerHTML = list.map((s) => `<button data-id="${s.id}" ${NAV.screen === s ? 'aria-current="page"' : ''}>${esc(s.title)}</button>`).join('');
  nav.querySelectorAll('button').forEach((b) => { b.onclick = () => go(list.find((s) => s.id === b.dataset.id)); });
}
function go(screen) {
  // ניווט ישיר למסך שאינו של התפקיד נחסם (שלב 2.6ב); בנוסף כל מסך מנהל בודק לבד, והכללים בשרת חוסמים
  if (!screen || !screen.roles.includes(api.role())) return;
  // שלב 2.11: הודעה קצרה (toast) של המסך הקודם לא נשארת על המסך החדש
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  NAV.screen = screen; NAV.stack = []; tabs(); draw(); }

// כפתור "חזור" של אנדרואיד: סוגר חלון, חוזר מתת-מסך, ובסוף חוזר לאפליקציה
try {
  const C = window.Capacitor;
  if (C && C.Plugins && C.Plugins.App) C.Plugins.App.addListener('backButton', () => { if (modalOpen()) closeModal(); else if (!ctx.back()) backToApp(); });
} catch (e) { /* בדפדפן אין תוסף */ }

// כניסה אחת (שלב 1.10ב): הלשונית לא מבקשת סיסמה. היא פועלת רק בשם המשתמש שמחובר עכשיו לאפליקציה הראשית (lp-sync),
// עם הכניסה שלו. כך במכשיר משותף: מי שנכנס לאפליקציה אחרי מישהו אחר מקבל את הלשונית בשמו שלו בלבד,
// ואחרי "התנתק" באפליקציה (syOut מוחק את lp-sync) הלשונית לא נפתחת. הלשונית לא שומרת כניסה משלה במכשיר.
function appSession() {
  try {
    const y = JSON.parse(localStorage.getItem('lp-sync')) || {};
    return y.refresh && y.uid && (y.role === 'admin' || y.role === 'worker') ? { uid: y.uid, email: y.email || '', refresh: y.refresh, idToken: y.idToken, exp: y.exp } : null;
  } catch (e) { return null; }
}
const NO_APP = 'קודם צריך להתחבר לאפליקציה עצמה. הלשונית נפתחת עם אותה כניסה, בלי סיסמה נוספת.';
function blocked(msg) {
  $('#tabs').hidden = true; $('#who').textContent = '';
  NAV.screen = null; NAV.stack = [];
  main.innerHTML = `<div class="card" id="gate"><h2>הזמנות אתר</h2><p class="err" id="lerr" role="alert">${esc(msg)}</p>
    <button class="btn w" id="bk2">חזרה לאפליקציה</button></div>`;
  $('#bk2').onclick = backToApp;
}
async function enter() {
  try { await api.detectRole(); } catch (e) { blocked(e.message); return; }
  const u = api.currentUser();
  $('#who').textContent = (api.isManager() ? 'מנהל' : 'עובד') + ' · ' + (u.email || '');
  go(SCREENS[0]); // מסך הפתיחה לא השתנה (מוצרים). מסכי העובד (שלב 2.6א) נוספו בסוף הרשימה
  api.registerPush(); // שלב 2.6א: רק אם יש בטלפון תוסף Push; אחרת לא קורה כלום
}

(async function boot() {
  const be = backend();
  if (!be.ok) { main.innerHTML = `<div class="card"><p>${esc(be.msg)}</p><button class="btn g" id="bk2">חזרה לאפליקציה</button></div>`; $('#bk2').onclick = backToApp; return; }
  $('#demo').hidden = !be.demo;
  const au = appSession();
  if (!au) { blocked(NO_APP); return; }
  api.init(be, au);
  const u = await api.waitForUser();
  // הכניסה של האפליקציה לא תקפה (פגה, בוטלה, או משתמש שנמחק): לא נכנסים, ולא מציגים טופס סיסמה
  if (!u) { blocked('הכניסה לאפליקציה לא בתוקף. חזור לאפליקציה, התנתק והתחבר מחדש.'); return; }
  // הטוקן שייך למשתמש אחר מזה שהאפליקציה רשמה: לא פותחים כלום
  if (u.uid !== au.uid) { await api.logout(); blocked('הכניסה לא תואמת למשתמש שמחובר עכשיו לאפליקציה. חזור לאפליקציה, התנתק והתחבר מחדש.'); return; }
  await enter(); // התפקיד נבדק מחדש מהמסד בכל פתיחה
})();
