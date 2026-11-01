const fs=require('fs'),path=require('path');
fs.copyFileSync('node_modules/xlsx/dist/xlsx.full.min.js','www/xlsx.full.min.js');
// לשונית "הזמנות אתר" (שלב 1): לאיזה שרת היא מחוברת. ברירת המחדל וכל בנייה מ-main: כבויה ('off').
{const v=process.env.SITE_BACKEND||'',isMain=process.env.GITHUB_REF==='refs/heads/main',sb=!isMain&&['emulator','test'].includes(v)?v:'off';
 if(sb==='test'&&/[\\/]app-source$/.test(process.cwd()))throw new Error('SITE_BACKEND=test: run prepare.js in the build copy (app/), not in app-source');
 fs.writeFileSync('www/orders/site-backend.js',"/* נכתב בבנייה (scripts/prepare.js). 'off' = הלשונית כבויה */\nwindow.LP_SITE_BACKEND = '"+sb+"';\n");console.log('SITE_BACKEND:',sb)
 // רק בבנייה עם SITE_BACKEND=test (ולעולם לא מ-main): גם האפליקציה וגם הלשונית מחוברות לפרויקט הבדיקה, כדי שתהיה כניסה אחת.
 // הקוד שבמאגר (app-source/www) לא משתנה: מחליפים כאן, בעותק של הבנייה, שורות שלמות. בכל בנייה אחרת שום דבר לא מוחלף.
 if(sb==='test'){
  const T={apiKey:'AIzaSyBHsEw1IvucT5gh1sv5jfSpd5UKqnPwsXU',authDomain:'largpeami-test-f4691.firebaseapp.com',projectId:'largpeami-test-f4691',storageBucket:'largpeami-test-f4691.firebasestorage.app',messagingSenderId:'633529912370',appId:'1:633529912370:web:2ecb51363efd597c19002b'};
  if(/^largpeami$/i.test(T.projectId))throw new Error('SITE_BACKEND=test: refusing the real project');
  const sub=(f,from,to)=>{const t=fs.readFileSync(f,'utf8'),n=t.split(from).length-1;if(n!==1)throw new Error('SITE_BACKEND=test: expected 1 match in '+f+', found '+n);fs.writeFileSync(f,t.replace(from,()=>to))};
  sub('www/index.html',"const FB={apiKey:'AIzaSyAoYfIJUwFeFDyvJha0GYw0sOtiTrlf2fo',projectId:EMU?'demo-largpeami':'largpeami'};","const FB={apiKey:'"+T.apiKey+"',projectId:EMU?'demo-largpeami':'"+T.projectId+"'};");
  sub('www/index.html',"const ST_BUCKET='largpeami.appspot.com';","const ST_BUCKET='"+T.storageBucket+"';");
  sub('www/orders/backend.js',"const TEST = { projectId: '', apiKey: '', appId: '', storageBucket: '' };","const TEST = "+JSON.stringify(T)+";");
  // גרסת הבדיקה היא אפליקציה נפרדת (com.largepami.finance.test, ב-patch-android.sh): עדכון ה-APK מתוך האפליקציה כבוי בה,
  // כדי שלא תציע להוריד ולהתקין את הגרסה הרגילה (GitHub release latest או app_releases/ ב-Storage).
  sub('www/index.html',"async function checkUpdate(man){\n","async function checkUpdate(man){if(man)toast('גרסת בדיקה: עדכון האפליקציה כבוי');return;\n");
  sub('www/index.html',"async function updSt(){","async function updSt(){return false;");
  // שלב 2.8: אימות דו-שלבי (קוד מתחלף מאפליקציה, TOTP) לצוות – רק בגרסת הבדיקה (ה11). בגרסה הרגילה index.html לא משתנה.
  fs.copyFileSync('scripts/mfa-login.js','www/mfa-login.js');
  sub('www/index.html','<script src="orders/site-backend.js"></script>\n','<script src="orders/site-backend.js"></script>\n<script src="mfa-login.js"></script>\n');
  sub('www/index.html',"const j=await jf(`${GAPI('identitytoolkit.googleapis.com')}/v1/accounts:signInWithPassword?key=${FB.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw,returnSecureToken:true})});","const j=await LP_MFA.signIn(email,pw);");
  sub('www/index.html',"enterApp(false);syCheck()}","enterApp(false);syCheck();LP_MFA.check()}");
  const left=fs.readFileSync('www/index.html','utf8').match(/'largpeami'|largpeami\.appspot\.com/g);
  if(left)throw new Error('SITE_BACKEND=test: index.html still points at largpeami: '+left.join(','));
  // אף קובץ ב-www לא מפנה לפרויקט האמיתי: לא המפתח שלו, לא ה-bucket שלו ולא המזהה שלו בגרשיים.
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
  for(const f of walk('www').filter(f=>/\.(html|js|json|css)$/.test(f))){const m=fs.readFileSync(f,'utf8').match(/AIzaSyAoYfIJUwFeFDyvJha0GYw0sOtiTrlf2fo|largpeami\.appspot\.com|largpeami\.firebaseapp\.com|largpeami\.firebasestorage\.app|['"`]largpeami['"`]/g);
   if(m)throw new Error('SITE_BACKEND=test: '+f+' still points at largpeami: '+m.join(','))}
  console.log('SITE_BACKEND=test: app + tab ->',T.projectId)}}
// barcode decoder (ZXing)
try{const zd='node_modules/@zxing/library/umd';const zf=fs.existsSync(zd+'/index.min.js')?'index.min.js':fs.readdirSync(zd).find(f=>/\.min\.js$/.test(f));fs.copyFileSync(zd+'/'+zf,'www/zxing.min.js');console.log('zxing ok',zf)}catch(e){console.log('zxing missing, continuing',e.message)}
// OCR engine (Tesseract) -> www/tess
fs.mkdirSync('www/tess',{recursive:true});
fs.copyFileSync('node_modules/tesseract.js/dist/tesseract.min.js','www/tess/tesseract.min.js');
fs.copyFileSync('node_modules/tesseract.js/dist/worker.min.js','www/tess/worker.min.js');
const cd='node_modules/tesseract.js-core';
const core=fs.readdirSync(cd).filter(f=>/^tesseract-core.*lstm.*\.(js|wasm)$/.test(f));
if(core.length<2)throw new Error('tesseract core files not found: '+fs.readdirSync(cd).join(','));
core.forEach(f=>fs.copyFileSync(path.join(cd,f),path.join('www/tess',f)));
(async()=>{
  for(const l of ['heb','eng']){
    const repo=l==='heb'?'tessdata_best':'tessdata_fast';
    const r=await fetch('https://github.com/tesseract-ocr/'+repo+'/raw/main/'+l+'.traineddata');
    if(!r.ok)throw new Error('language data '+l+' http '+r.status);
    const b=Buffer.from(await r.arrayBuffer());
    if(b.length<500000)throw new Error('language data '+l+' too small: '+b.length);
    fs.writeFileSync('www/tess/'+l+'.traineddata',b);
  }
  console.log('OCR files:',fs.readdirSync('www/tess').join(' '));
})().catch(e=>{console.error(e);process.exit(1)});
