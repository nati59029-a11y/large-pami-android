/* כל הפניות לשרת של לשונית "הזמנות אתר" נמצאות כאן, במקום אחד:
   - קריאה למסד (Firestore, קריאה בלבד – הכללים קובעים מה מותר),
   - קריאה לפונקציות השרת (כל כתיבה עוברת דרכן: הן בודקות תפקיד וקלט, ורושמות ביומן),
   - העלאת צילום מקורי ל-Storage (product_photos_raw/), והצגת תמונות.
   אם שם או מבנה של פונקציה בשרת משתנה – מתקנים רק בקובץ הזה.
   הספרייה הרשמית של Firebase ארוזה בתיקייה vendor/ ולא נטענת מהאינטרנט. */
import { initializeApp } from './vendor/firebase-app.js';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut, onAuthStateChanged } from './vendor/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, query, where } from './vendor/firebase-firestore-lite.js';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from './vendor/firebase-functions.js';

// שמות הפונקציות בשרת (מאגר האתר, firebase/functions/index.js, שלב 1.4)
export const FN = {
  saveProduct: 'saveProduct', saveCategory: 'saveCategory', setProductCost: 'setProductCost',
  setWholesalePrices: 'setWholesalePrices', setVariantSoldOut: 'setVariantSoldOut', importProducts: 'importProducts',
  processProductPhoto: 'processProductPhoto', assignProductPhoto: 'assignProductPhoto',
  updateSiteSettings: 'updateSiteSettings', createWholesaleCustomer: 'createWholesaleCustomer',
};
// הזוויות שהשרת מקבל בשיוך תמונה (functions/lib/photos.js, ANGLES)
export const ANGLES = [['front', 'מקדימה'], ['side', 'מהצד'], ['top', 'מלמעלה'], ['angle45', 'בזווית'], ['open', 'פתוח'], ['turntable', 'סיבוב'], ['pack', 'חבילה']];

let BE = null; let app = null; let auth = null; let db = null; let fns = null;
let ROLE = null; // 'manager' | 'employee'

export function init(be) {
  BE = be;
  app = initializeApp(be.config);
  auth = getAuth(app);
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
export const login = (email, pw) => wrap(() => signInWithEmailAndPassword(auth, email, pw));
export async function logout() { ROLE = null; await signOut(auth); }
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
export const listWholesaleCustomers = () => { needManager(); return wrap(async () => rows(await getDocs(query(collection(db, 'customers'), where('type', '==', 'customer_wholesale'))))); };
export const getTerms = (uid) => { needManager(); return getDocData('wholesale_terms/' + uid); };
export const listPersonalPrices = (uid) => { needManager(); return wrap(async () => rows(await getDocs(collection(db, 'wholesale_terms', uid, 'prices')))); };

// ---------- פונקציות השרת ----------
async function call(name, data, timeoutMs) {
  return wrap(async () => (await httpsCallable(fns, name, { timeout: timeoutMs || 70000 })(data)).data);
}
export const saveProduct = (productId, product, variants) => call(FN.saveProduct, Object.assign({ product }, productId ? { productId } : {}, variants && variants.length ? { variants } : {}));
export const saveCategory = (categoryId, category, imageB64) => call(FN.saveCategory, Object.assign({ category }, categoryId ? { categoryId } : {}, imageB64 ? { image: { data: imageB64 } } : {}));
export const setProductCost = (productId, cost, assistantPriority) => call(FN.setProductCost, Object.assign({ productId, cost }, assistantPriority === undefined ? {} : { assistantPriority }));
export const setWholesalePrices = (prices, customerUid) => call(FN.setWholesalePrices, Object.assign({ prices }, customerUid ? { customerUid } : {}));
export const setVariantSoldOut = (productId, variantId, soldOut) => call(FN.setVariantSoldOut, { productId, variantId, soldOut });
export const importPreview = (rowsIn) => call(FN.importProducts, { mode: 'preview', rows: rowsIn }, 300000);
export const importCommit = (rowsIn, previewHash) => call(FN.importProducts, { mode: 'commit', rows: rowsIn, previewHash }, 300000);
export const processProductPhoto = (rawPath, fileName) => call(FN.processProductPhoto, { rawPath, fileName }, 120000);
export const assignProductPhoto = (input) => call(FN.assignProductPhoto, input, 120000);
export const updateSiteSettings = (docName, values, bannerB64) => call(FN.updateSiteSettings, Object.assign({ doc: docName }, values ? { values } : {}, bannerB64 ? { bannerImage: { data: bannerB64 } } : {}));
export const createWholesaleCustomer = (input) => call(FN.createWholesaleCustomer, input);

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
// תמונה פנימית (product_photos_raw/processed/…) – רק צוות קורא, ולכן נטענת עם הזיהוי של המשתמש
export async function privateImageUrl(path) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch(objUrl(path) + '?alt=media', { headers: { Authorization: 'Firebase ' + token } });
  if (!r.ok) throw new Error('התמונה לא נטענה');
  return URL.createObjectURL(await r.blob());
}
