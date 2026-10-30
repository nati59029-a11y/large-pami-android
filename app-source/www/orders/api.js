/* כל הפניות לשרת של לשונית "הזמנות אתר" נמצאות כאן, במקום אחד:
   - קריאה למסד (Firestore, קריאה בלבד – הכללים קובעים מה מותר),
   - קריאה לפונקציות השרת (כל כתיבה עוברת דרכן: הן בודקות תפקיד וקלט, ורושמות ביומן),
   - העלאת צילום מקורי ל-Storage (product_photos_raw/), והצגת תמונות.
   אם שם או מבנה של פונקציה בשרת משתנה – מתקנים רק בקובץ הזה.
   הספרייה הרשמית של Firebase ארוזה בתיקייה vendor/ ולא נטענת מהאינטרנט. */
import { initializeApp } from './vendor/firebase-app.js';
import { initializeAuth, connectAuthEmulator, signOut, onAuthStateChanged } from './vendor/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, query, where, orderBy, limit } from './vendor/firebase-firestore-lite.js';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from './vendor/firebase-functions.js';

// שמות הפונקציות בשרת (מאגר האתר, firebase/functions/index.js, שלב 1.4)
export const FN = {
  saveProduct: 'saveProduct', saveCategory: 'saveCategory', setProductCost: 'setProductCost',
  setWholesalePrices: 'setWholesalePrices', setVariantSoldOut: 'setVariantSoldOut', importProducts: 'importProducts',
  processProductPhoto: 'processProductPhoto', assignProductPhoto: 'assignProductPhoto',
  updateSiteSettings: 'updateSiteSettings', createWholesaleCustomer: 'createWholesaleCustomer',
  // שלב 1.10א (מאגר האתר 8bb7dc0, functions/lib/staffOrders.js)
  setOrderPricing: 'setOrderPricing', createOrderForCustomer: 'createOrderForCustomer', markDeferredPaid: 'markDeferredPaid', setPaymentTerms: 'setPaymentTerms',
  // שלב 2.6א – מסכי העובד (מאגר האתר d499b85: functions/lib/orderFlow.js, orderMoney.js, index.js)
  claimOrder: 'claimOrder', markItem: 'markItem', changeStatus: 'changeStatus', getMyHistory: 'getMyHistory',
  confirmStock: 'confirmStock', confirmPhoneApproval: 'confirmPhoneApproval', registerPushToken: 'registerPushToken',
  // שלב 2.6ב – מסכי המנהל (אותו מאגר, d499b85: orderMoney.js, invoices.js, reports.js, orderFlow.js). addRequestedItemToOrder – ענף 2.7 (עוד לא מוזג)
  cancelOrder: 'cancelOrder', refundOrder: 'refundOrder', sendPaymentLink: 'sendPaymentLink', setCustomerActive: 'setCustomerActive',
  setAllocationNumber: 'setAllocationNumber', resendInvoice: 'resendInvoice', exportInvoices: 'exportInvoices', getReports: 'getReports',
  addRequestedItemToOrder: 'addRequestedItemToOrder',
};
// סטטוסים של הזמנה "פתוחה" – כמו openStatuses() בכללים. עובד קורא רק הזמנות במצבים האלה.
export const OPEN_STATUSES = ['pending_payment', 'received', 'stock_check', 'awaiting_packing', 'packing', 'ready', 'out_for_delivery', 'delivered'];
// מתי מותר לשנות מחיר בהזמנה (כמו EDITABLE בשרת): לפני החיוב
export const EDITABLE_STATUSES = ['pending_payment', 'received', 'stock_check'];
// הזוויות שהשרת מקבל בשיוך תמונה (functions/lib/photos.js, ANGLES)
export const ANGLES = [['front', 'מקדימה'], ['side', 'מהצד'], ['top', 'מלמעלה'], ['angle45', 'בזווית'], ['open', 'פתוח'], ['turntable', 'סיבוב'], ['pack', 'חבילה']];

let BE = null; let app = null; let auth = null; let db = null; let fns = null;
let ROLE = null; // 'manager' | 'employee'

/* כניסה אחת (שלב 1.10ב): הלשונית לא מבקשת סיסמה. היא מקבלת את הכניסה של האפליקציה (lp-sync: uid ו-refresh token)
   ושמה אותה בזיכרון בלבד – בלי לשמור כלום במכשיר. ספריית Firebase טוענת את המשתמש מהזיכרון הזה, מחדשת את הטוקן מול השרת,
   ומאמתת אותו (accounts:lookup). אם הטוקן לא תקף – אין משתמש. כל פתיחה של הלשונית מתחילה מאפס, לפי מי שמחובר עכשיו לאפליקציה.
   (הצורה של המשתמש השמור היא זו של firebase-auth 12.19.0 שארוזה ב-vendor/: uid ו-stsTokenManager.) */
let SEED = null;
class AppSessionPersistence {
  constructor() { this.type = 'NONE'; this.storage = {}; }
  async _isAvailable() { return true; }
  async _set(k, v) { this.storage[k] = v; }
  async _get(k) { if (Object.prototype.hasOwnProperty.call(this.storage, k)) return this.storage[k]; return /^firebase:authUser:/.test(k) ? SEED : null; }
  async _remove(k) { this.storage[k] = null; SEED = null; }
  _addListener() {}
  _removeListener() {}
}
AppSessionPersistence.type = 'NONE';
function seedFrom(au) {
  if (!au || typeof au.refresh !== 'string' || !au.refresh || typeof au.uid !== 'string' || !au.uid) return null;
  const fresh = typeof au.idToken === 'string' && au.idToken && Number(au.exp) > Date.now() + 60000;
  return {
    uid: au.uid, email: au.email || undefined, emailVerified: false, isAnonymous: false, providerData: [],
    stsTokenManager: fresh ? { refreshToken: au.refresh, accessToken: au.idToken, expirationTime: Number(au.exp) } : { refreshToken: au.refresh },
  };
}
export function init(be, appSession) {
  BE = be;
  SEED = seedFrom(appSession);
  app = initializeApp(be.config);
  auth = initializeAuth(app, { persistence: AppSessionPersistence });
  db = getFirestore(app);
  fns = getFunctions(app, 'us-central1');
  if (be.emu) {
    connectAuthEmulator(auth, `http://${be.emu.host}:${be.emu.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(db, be.emu.host, be.emu.fs);
    connectFunctionsEmulator(fns, be.emu.host, be.emu.fn);
  }
}

// ---------- הודעות שגיאה בעברית ----------
const HEB = /[֐-׿]/;
export function hebError(e) {
  const code = String((e && e.code) || '');
  // בהודעות מסוימות מהשרת מצורף קוד מספרי בסוף (למשל " [429]"). למשתמש מציגים רק את הטקסט.
  const msg = String((e && e.message) || '').replace(/\s*\[\d{3}\]\s*$/, '');
  const details = e && e.details;
  if (/auth\/(invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login-credentials)/.test(code)) return 'אימייל או סיסמה לא נכונים';
  if (/auth\/too-many-requests/.test(code)) return 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות';
  if (/auth\/user-disabled/.test(code)) return 'המשתמש הושבת. פנה למנהל העסק';
  if (/network|unavailable|failed to fetch/i.test(code + ' ' + msg)) return 'אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב';
  if (/deadline-exceeded/.test(code)) return 'השרת לא ענה בזמן. נסה שוב';
  // שגיאות מפורטות מהשרת (רשימה של שדות) – כבר בעברית
  if (details && Array.isArray(details.errors) && details.errors.length) return details.errors.join('\n');
  if (HEB.test(msg)) return msg;
  if (/permission-denied|PERMISSION_DENIED|insufficient permissions/i.test(code + ' ' + msg)) return 'אין לך הרשאה לפעולה הזו';
  if (/not-found/.test(code)) return 'הפריט לא נמצא';
  if (/unauthenticated/.test(code)) return 'צריך להתחבר מחדש';
  return 'שגיאה לא צפויה בשרת. נסה שוב' + (code ? ` (${code.replace(/^\w+\//, '')})` : '');
}
const wrap = async (fn) => { try { return await fn(); } catch (e) { const x = new Error(hebError(e)); x.code = e && e.code; x.details = e && e.details; throw x; } };

// ---------- כניסה ותפקיד ----------
export const currentUser = () => auth && auth.currentUser;
export const role = () => ROLE;
export const isManager = () => ROLE === 'manager';
export function waitForUser() { return new Promise((ok) => { const off = onAuthStateChanged(auth, (u) => { off(); ok(u); }); }); }
export async function logout() { ROLE = null; SEED = null; await signOut(auth); }
// מנהל = מסמך admins/{uid} (כמו באפליקציה). עובד = staff/{uid} עם active == true. אחרת – אין הרשאה, וניתוק.
export async function detectRole() {
  const uid = auth.currentUser.uid;
  ROLE = null;
  try { if ((await getDoc(doc(db, 'admins', uid))).exists()) { ROLE = 'manager'; return ROLE; } } catch (e) { if (!/permission/i.test(String(e.code))) throw new Error(hebError(e)); }
  try { const s = await getDoc(doc(db, 'staff', uid)); if (s.exists() && s.get('active') === true) { ROLE = 'employee'; return ROLE; } } catch (e) { if (!/permission/i.test(String(e.code))) throw new Error(hebError(e)); }
  await signOut(auth);
  throw new Error('אין לך הרשאה ללשונית הזו. פנה למנהל העסק.');
}

// ---------- קריאה מהמסד ----------
const rows = (snap) => snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
const needManager = () => { if (ROLE !== 'manager') throw new Error('רק מנהל רואה את המידע הזה'); };
export const getDocData = (path) => wrap(async () => { const s = await getDoc(doc(db, path)); return s.exists() ? Object.assign({ id: s.id }, s.data()) : null; });
export const listProducts = () => wrap(async () => rows(await getDocs(collection(db, 'products'))));
export const getProduct = (id) => getDocData('products/' + id);
export const listVariants = (pid) => wrap(async () => rows(await getDocs(collection(db, 'products', pid, 'product_variants'))));
// עובד: הכלל מתיר לו רק קטגוריות פעילות, ולכן השאילתה שלו כוללת active == true
export const listCategories = () => wrap(async () => rows(await getDocs(ROLE === 'manager' ? collection(db, 'categories') : query(collection(db, 'categories'), where('active', '==', true)))));
export const getSettings = (name) => getDocData('settings/' + name);
// מחיר עלות ומחיר סיטונאי – רק מנהל. לעובד הלשונית לא מבקשת אותם בכלל (והכללים חוסמים גם בקשה ישירה).
export const getCost = (pid) => { needManager(); return getDocData('product_costs/' + pid); };
export const getWholesalePrice = (pid) => { needManager(); return getDocData('wholesale_prices/' + pid); };
export const listPhotoJobs = () => wrap(async () => {
  if (ROLE === 'manager') return rows(await getDocs(query(collection(db, 'photo_jobs'), where('status', '==', 'ready_for_review'))));
  return rows(await getDocs(query(collection(db, 'photo_jobs'), where('uploadedBy', '==', auth.currentUser.uid))));
});
// לקוחות סיטונאים: מנהל ועובד פעיל (הכלל מתיר לעובד רק כרטיסי סיטונאי, ולכן השאילתה כוללת type)
export const listWholesaleCustomers = () => wrap(async () => rows(await getDocs(query(collection(db, 'customers'), where('type', '==', 'customer_wholesale')))));
export const getCustomer = (uid) => getDocData('customers/' + uid);
// הזמנות של לקוח. עובד: רק הזמנות פתוחות (הכלל דורש status בתוך openStatuses, ולכן השאילתה מסננת לפיו).
export const listCustomerOrders = (uid) => wrap(async () => rows(await getDocs(ROLE === 'manager'
  ? query(collection(db, 'orders'), where('customerUid', '==', uid))
  : query(collection(db, 'orders'), where('customerUid', '==', uid), where('status', 'in', OPEN_STATUSES)))));
// חשבוניות של לקוח (רשימה בלבד; החשבוניות עצמן נבנות בשלב 2)
export const listCustomerInvoices = (uid) => wrap(async () => rows(await getDocs(query(collection(db, 'invoices'), where('buyerUid', '==', uid)))));
// הזמנה: המסמך, השורות והמחירים. עלות ורווח (order_costs) – רק מנהל, ולעובד לא מבקשים אותם בכלל.
export const getOrder = (id) => wrap(async () => {
  const [o, items, pricing] = await Promise.all([getDoc(doc(db, 'orders', id)), getDocs(collection(db, 'orders', id, 'order_items')), getDoc(doc(db, 'orders', id, 'order_pricing', 'main'))]);
  if (!o.exists()) return null;
  return Object.assign({ id: o.id }, o.data(), { items: rows(items), pricing: pricing.exists() ? pricing.data() : null });
});
// הזמנות לפי סטטוס (מסכי העובד). עובד: הכלל דורש סטטוס פתוח, ולכן השאילתה תמיד מסננת לפיו.
export const listOrdersByStatus = (statuses) => wrap(async () => rows(await getDocs(query(collection(db, 'orders'),
  statuses.length === 1 ? where('status', '==', statuses[0]) : where('status', 'in', statuses)))));
export const getOrderPricing = (id) => getDocData(`orders/${id}/order_pricing/main`);
export const getOrderCosts = (id) => { needManager(); return getDocData(`orders/${id}/order_costs/main`); };
export const getTerms = (uid) => { needManager(); return getDocData('wholesale_terms/' + uid); };
export const listPersonalPrices = (uid) => { needManager(); return wrap(async () => rows(await getDocs(collection(db, 'wholesale_terms', uid, 'prices')))); };

// ---------- שלב 2.6ב: קריאות של מסכי המנהל (הכללים מתירים אותן רק למנהל; needManager היא שכבה נוספת, לא במקום הכללים) ----------
const dayAgo = (n) => { const d = new Date(Date.now() - n * 86400000); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const listAllOrders = (n) => { needManager(); return wrap(async () => rows(await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(n || 300))))); };
export const listOrdersByNumber = (num) => { needManager(); return wrap(async () => rows(await getDocs(query(collection(db, 'orders'), where('orderNumber', '==', num))))); };
export const listOrderEvents = (id) => { needManager(); return wrap(async () => rows(await getDocs(collection(db, 'orders', id, 'order_events')))); };
export const listAllInvoices = (n) => { needManager(); return wrap(async () => rows(await getDocs(query(collection(db, 'invoices'), orderBy('issuedAt', 'desc'), limit(n || 500))))); };
export const getInvoice = (id) => { needManager(); return getDocData('invoices/' + id); };
export const listIncomeDays = (days) => { needManager(); return wrap(async () => rows(await getDocs(query(collection(db, 'site_income_daily'), where('date', '>=', dayAgo(days || 7)))))); };
export const listAuthorizedPayments = () => { needManager(); return wrap(async () => rows(await getDocs(query(collection(db, 'payments'), where('status', '==', 'authorized'))))); };
export const listSecurityAlerts = () => { needManager(); return wrap(async () => rows(await getDocs(query(collection(db, 'notifications'), where('kind', '==', 'security_alert'), limit(100))))); };
export const listProductRequests = () => { needManager(); return wrap(async () => rows(await getDocs(query(collection(db, 'product_requests'), orderBy('createdAt', 'desc'), limit(200))))); };

// ---------- פונקציות השרת ----------
async function call(name, data, timeoutMs) {
  return wrap(async () => (await httpsCallable(fns, name, { timeout: timeoutMs || 70000 })(data)).data);
}
export const saveProduct = (productId, product, variants) => call(FN.saveProduct, Object.assign({ product }, productId ? { productId } : {}, variants && variants.length ? { variants } : {}));
export const saveCategory = (categoryId, category, imageB64) => call(FN.saveCategory, Object.assign({ category }, categoryId ? { categoryId } : {}, imageB64 ? { image: { data: imageB64 } } : {}));
export const setProductCost = (productId, cost, assistantPriority) => call(FN.setProductCost, Object.assign({ productId, cost }, assistantPriority === undefined ? {} : { assistantPriority }));
export const setWholesalePrices = (prices, customerUid) => call(FN.setWholesalePrices, Object.assign({ prices }, customerUid ? { customerUid } : {}));
// שינוי כללי של מחיר סיטונאי, בשני שלבים: preview מחזיר את הלקוחות עם מחיר קבוע למוצר; commit עם ההחלטה לכל אחד
export const previewWholesalePrices = (prices) => call(FN.setWholesalePrices, { prices, preview: true });
export const commitWholesalePrices = (prices, fixedPrices) => call(FN.setWholesalePrices, Object.assign({ prices }, fixedPrices && fixedPrices.length ? { fixedPrices } : {}));
export const setOrderPricing = (input) => call(FN.setOrderPricing, input);
export const createOrderForCustomer = (input) => call(FN.createOrderForCustomer, input);
export const markDeferredPaid = (input) => call(FN.markDeferredPaid, input);
export const setPaymentTerms = (input) => call(FN.setPaymentTerms, input);
export const setVariantSoldOut = (productId, variantId, soldOut) => call(FN.setVariantSoldOut, { productId, variantId, soldOut });
export const importPreview = (rowsIn) => call(FN.importProducts, { mode: 'preview', rows: rowsIn }, 300000);
export const importCommit = (rowsIn, previewHash) => call(FN.importProducts, { mode: 'commit', rows: rowsIn, previewHash }, 300000);
export const processProductPhoto = (rawPath, fileName) => call(FN.processProductPhoto, { rawPath, fileName }, 120000);
export const assignProductPhoto = (input) => call(FN.assignProductPhoto, input, 120000);
export const updateSiteSettings = (docName, values, bannerB64) => call(FN.updateSiteSettings, Object.assign({ doc: docName }, values ? { values } : {}, bannerB64 ? { bannerImage: { data: bannerB64 } } : {}));
export const createWholesaleCustomer = (input) => call(FN.createWholesaleCustomer, input);

// ---------- שלב 2.6א: פעולות העובד בהזמנה. כל חישוב, חיוב והחלטה – בשרת; כאן רק קריאות ----------
export const claimOrder = (input) => call(FN.claimOrder, input);
export const markItem = (input) => call(FN.markItem, input);
export const changeStatus = (input) => call(FN.changeStatus, input);
export const confirmStock = (input) => call(FN.confirmStock, input, 120000);
export const confirmPhoneApproval = (input) => call(FN.confirmPhoneApproval, input);
export const cancelOrder = (input) => call(FN.cancelOrder, input, 120000);
export const refundOrder = (input) => call(FN.refundOrder, input, 120000);
export const sendPaymentLink = (input) => call(FN.sendPaymentLink, input);
export const setCustomerActive = (input) => call(FN.setCustomerActive, input);
export const setAllocationNumber = (input) => call(FN.setAllocationNumber, input, 120000);
export const resendInvoice = (input) => call(FN.resendInvoice, input, 120000);
export const exportInvoices = (input) => call(FN.exportInvoices, input, 300000);
export const getReports = (input) => call(FN.getReports, input, 120000);
export const addRequestedItemToOrder = (input) => call(FN.addRequestedItemToOrder, input);
export const getMyHistory = (limit) => call(FN.getMyHistory, limit ? { limit } : {});
/* רישום ל-Push (שלב 2.6א): רק אם בטלפון כבר יש תוסף PushNotifications. לא מוסיפים תוסף חדש (דורש התקנה והחלטה).
   אין תוסף ← לא קורה כלום והמסכים עובדים כרגיל. הכישלון בשקט – ההתראות הן תוספת ולא תנאי לעבודה. */
export async function registerPush() {
  try {
    const C = window.Capacitor; const P = C && C.Plugins && C.Plugins.PushNotifications;
    if (!P) return 'no-plugin';
    const perm = await P.requestPermissions();
    if (!perm || perm.receive !== 'granted') return 'denied';
    P.addListener('registration', (t) => { if (t && t.value) call(FN.registerPushToken, { token: t.value }).catch(() => {}); });
    await P.register();
    return 'requested';
  } catch (e) { return 'error'; }
}

// ---------- Storage (בלי ספרייה נוספת: אותה כתובת REST שהאפליקציה כבר משתמשת בה לגיבוי) ----------
const objUrl = (path) => `${BE.storageBase}/v0/b/${encodeURIComponent(BE.config.storageBucket)}/o/${encodeURIComponent(path)}`;
// תמונות ציבוריות (products/, categories/, site/banners/) – הכללים מתירים קריאה לכולם
export const publicImageUrl = (path) => (path ? objUrl(path) + '?alt=media' : '');
// העלאת צילום מקורי: product_photos_raw/{uid}/{זמן}_{מספר}.{סיומת}. הכללים: רק צוות, רק תמונה, עד 15MB, בלי דריסה.
export async function uploadRawPhoto(file, n) {
  const uid = auth.currentUser.uid;
  const ext = (/\.(jpe?g|png|webp)$/i.exec(file.name || '') || [, 'jpg'])[1].toLowerCase();
  const path = `product_photos_raw/${uid}/${Date.now()}_${n}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  if (file.size > 15 * 1024 * 1024) throw new Error('הצילום גדול מ-15MB');
  const token = await auth.currentUser.getIdToken();
  let r;
  try {
    r = await fetch(`${BE.storageBase}/v0/b/${encodeURIComponent(BE.config.storageBucket)}/o?name=${encodeURIComponent(path)}&uploadType=media`, {
      method: 'POST', headers: { Authorization: 'Firebase ' + token, 'Content-Type': file.type || 'image/jpeg' }, body: file,
    });
  } catch (e) { throw new Error('אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב'); }
  if (!r.ok) throw new Error(r.status === 403 ? 'אין הרשאה להעלות את הקובץ (רק תמונה, עד 15MB)' : 'ההעלאה נכשלה (' + r.status + ')');
  return path;
}
// צילום מסירה: orders/{הזמנה}/delivery/{קובץ}. הכללים: צוות בלבד, תמונה, עד 5MB, בלי דריסה. ואז changeStatus עם photoPath.
export async function uploadDeliveryPhoto(orderId, blob) {
  if (blob.size > 5 * 1024 * 1024) throw new Error('הצילום גדול מ-5MB');
  const path = `orders/${orderId}/delivery/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const token = await auth.currentUser.getIdToken();
  let r;
  try {
    r = await fetch(`${BE.storageBase}/v0/b/${encodeURIComponent(BE.config.storageBucket)}/o?name=${encodeURIComponent(path)}&uploadType=media`, {
      method: 'POST', headers: { Authorization: 'Firebase ' + token, 'Content-Type': 'image/jpeg' }, body: blob,
    });
  } catch (e) { throw new Error('אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב'); }
  if (!r.ok) throw new Error(r.status === 403 ? 'אין הרשאה להעלות את הצילום (רק תמונה, עד 5MB)' : 'העלאת הצילום נכשלה (' + r.status + ')');
  return path;
}
// תמונה פנימית (product_photos_raw/processed/…) – רק צוות קורא, ולכן נטענת עם הזיהוי של המשתמש
export async function privateImageUrl(path) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch(objUrl(path) + '?alt=media', { headers: { Authorization: 'Firebase ' + token } });
  if (!r.ok) throw new Error('התמונה לא נטענה');
  return URL.createObjectURL(await r.blob());
}
