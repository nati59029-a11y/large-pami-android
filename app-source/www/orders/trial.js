/* דף ניסיון (שלב 1.2): האם ספריית Firebase הרשמית, ארוזה בתוך האפליקציה, עובדת מול האמולטור.
   פועל רק בדפדפן מקומי עם ?emu=1 (אותו תנאי כמו EMU ב-index.html הראשי). בכל מצב אחר הוא נעצר ולא פונה לשום שרת.
   פורטים ברירת מחדל כמו באפליקציה: Auth 9099, Firestore 8080, פונקציות 5001. אפשר לשנות: ?emu=1&auth=16099&fs=16080&fn=16001
   הקבצים ב-vendor/ הם הקבצים הרשמיים של firebase@12.19.0 (npm), בשינוי יחיד: הייבוא מכתובת gstatic הוחלף ב-./firebase-app.js,
   כדי שלא ייטען דבר מהאינטרנט. */
import { initializeApp } from './vendor/firebase-app.js';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from './vendor/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from './vendor/firebase-firestore-lite.js';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from './vendor/firebase-functions.js';

const out = document.getElementById('out');
const log = (m) => { out.textContent += '\n' + m; };
const q = new URLSearchParams(location.search);
const host = location.hostname;
const EMU = location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(host) && !!location.port && q.get('emu') === '1';

if (!EMU) {
  out.textContent = 'הדף פועל רק מול האמולטור (כתובת מקומית עם ?emu=1). לא בוצעה שום פנייה לשרת.';
  document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
} else {
  const PID = 'demo-largpeami';
  const app = initializeApp({ apiKey: 'demo-key', projectId: PID, appId: '1:1:web:demo' });
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${host}:${q.get('auth') || 9099}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, Number(q.get('fs') || 8080));
  const fns = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(fns, host, Number(q.get('fn') || 5001));
  const $ = (id) => document.getElementById(id);
  const fail = (e) => log('שגיאה: ' + (e && e.code ? e.code + ' – ' : '') + (e && e.message ? e.message : e));

  $('bLogin').onclick = async () => {
    try {
      const c = await signInWithEmailAndPassword(auth, $('email').value.trim(), $('pass').value);
      log('LOGIN OK uid=' + c.user.uid);
      $('bRead').disabled = $('bCall').disabled = false;
    } catch (e) { fail(e); }
  };
  $('bRead').onclick = async () => {
    try {
      const s = await getDoc(doc(db, 'staff', auth.currentUser.uid));
      log('READ ' + (s.exists() ? 'OK ' + JSON.stringify(s.data()) : 'מסמך לא קיים'));
    } catch (e) { fail(e); }
  };
  $('bCall').onclick = async () => {
    try {
      const r = await httpsCallable(fns, 'registerPushToken')({ token: 'trial-token-' + 'x'.repeat(24) });
      log('CALL OK ' + JSON.stringify(r.data));
    } catch (e) { fail(e); }
  };
}
