set -e
# 6ה: APK נפרד לעסק אחד (build-biz-apks.yml מריץ אחרי patch-android.sh, בתוך app/ – העותק של app-source).
# שימוש: bash scripts/make-biz-app.sh <bizId>
# משנה רק את העותק של הבנייה: applicationId (com.largepami.finance.b.<bizId>), השם מתחת לסמל, הסמלים (מתוך brands/<bizId>/logo.png),
# העסק והלוגו של מסך הכניסה לפני הכניסה הראשונה (www/biz-default.js), וערוץ העדכונים (app_releases/biz-<bizId>/, ו-GitHub release biz-<bizId>).
# עדכון חי כבוי ב-APK כזה (חבילת המסכים הכללית הייתה מוחקת את העסק והלוגו); העדכון מגיע כ-APK.
# namespace, החבילה של Java והתוספים נשארים com.largepami.finance (כמו make-test-app.sh). אותו מפתח חתימה.
B="$1"
# 9.11: "business" = האפליקציה הכללית "ניהול עסק" לכל העסקים החדשים: applicationId com.largepami.business, סמל כללי,
# בלי עסק ברירת מחדל (בלי biz-default.js – המשתמש רואה את העסק שלו לפי ההרשאות אחרי הכניסה), release business-latest / business.apk.
if [ "$B" = "business" ]; then
python3 scripts/biz-icons.py --generic android/app/src/main/res "${TMPDIR:-/tmp}/business-icon.png"
node -e '
const fs=require("fs"),nm="ניהול עסק",pkg="com.largepami.business",old=JSON.parse(fs.readFileSync("capacitor.config.json","utf8")).appName;
const sub=(f,from,to)=>{const t=fs.readFileSync(f,"utf8"),n=t.split(from).length-1;if(n!==1){console.error("::error::business app: expected 1 match in "+f+", found "+n+": "+from);process.exit(1)}fs.writeFileSync(f,t.replace(from,()=>to))};
sub("android/app/build.gradle","applicationId \"com.largepami.finance\"","applicationId \""+pkg+"\"");
const S="android/app/src/main/res/values/strings.xml";
sub(S,"<string name=\"app_name\">"+old+"</string>","<string name=\"app_name\">"+nm+"</string>");
sub(S,"<string name=\"title_activity_main\">"+old+"</string>","<string name=\"title_activity_main\">"+nm+"</string>");
for(const W of ["www","android/app/src/main/assets/public"]){if(!fs.existsSync(W+"/index.html"))continue;
 sub(W+"/index.html","const UPD_DIR=\x27app_releases/latest/\x27;","const UPD_DIR=\x27app_releases/business/\x27;");
 sub(W+"/index.html","/releases/tags/latest`","/releases/tags/business-latest`");
 sub(W+"/index.html","/releases/download/latest/large-pami.apk`","/releases/download/business-latest/business.apk`")}
console.log("BUSINESS APP:",pkg,nm);
'
else
echo "$B" | grep -Eq '^[a-z0-9-]{3,30}$' || { echo "::error::biz app: bad bizId '$B'"; exit 1; }
[ "$B" != "largpeami" ] || { echo "::error::biz app: largpeami is the regular app"; exit 1; }
[ -f "brands/$B/logo.png" ] || { echo "::error::biz app: brands/$B/logo.png is missing"; exit 1; }
python3 scripts/biz-icons.py "brands/$B/logo.png" android/app/src/main/res www/biz-logo.png
node -e '
const fs=require("fs"),B=process.argv[1],cfg=JSON.parse(fs.readFileSync("brands/build-biz.json","utf8"));
const e=(cfg.businesses||[]).find(x=>x&&x.bizId===B);if(!e){console.error("::error::biz app: "+B+" is not in brands/build-biz.json");process.exit(1)}
const nm=String(e.appName||"").replace(/[<>&"\x27\u0000-\u001f]/g,"").trim().slice(0,30);if(!nm){console.error("::error::biz app: appName is required");process.exit(1)}
const pkg="com.largepami.finance.b."+B.replace(/-/g,"_"),old=JSON.parse(fs.readFileSync("capacitor.config.json","utf8")).appName;
const sub=(f,from,to)=>{const t=fs.readFileSync(f,"utf8"),n=t.split(from).length-1;if(n!==1){console.error("::error::biz app: expected 1 match in "+f+", found "+n+": "+from);process.exit(1)}fs.writeFileSync(f,t.replace(from,()=>to))};
sub("android/app/build.gradle","applicationId \"com.largepami.finance\"","applicationId \""+pkg+"\"");
const S="android/app/src/main/res/values/strings.xml";
sub(S,"<string name=\"app_name\">"+old+"</string>","<string name=\"app_name\">"+nm+"</string>");
sub(S,"<string name=\"title_activity_main\">"+old+"</string>","<string name=\"title_activity_main\">"+nm+"</string>");
const logo="data:image/png;base64,"+fs.readFileSync("www/biz-logo.png").toString("base64");
fs.writeFileSync("www/biz-default.js","/* נכתב בבנייה (scripts/make-biz-app.sh) */\nwindow.LP_BIZ="+JSON.stringify({id:B,name:nm,logo})+";\n");
for(const W of ["www","android/app/src/main/assets/public"]){if(!fs.existsSync(W+"/index.html"))continue;
 if(W!=="www")fs.copyFileSync("www/biz-default.js",W+"/biz-default.js");
 sub(W+"/index.html","<script src=\"orders/site-backend.js\"></script>\n","<script src=\"orders/site-backend.js\"></script>\n<script src=\"biz-default.js\"></script>\n");
 sub(W+"/index.html","const UPD_DIR=\x27app_releases/latest/\x27;","const UPD_DIR=\x27app_releases/biz-"+B+"/\x27;");
 sub(W+"/index.html","/releases/tags/latest`","/releases/tags/biz-"+B+"`")}
console.log("BIZ APP:",pkg,nm);
' "$B"
fi
rm -f android/app/src/main/assets/live-update.properties
grep -q 'namespace "com.largepami.finance"$' android/app/build.gradle || { echo "::error::biz app: namespace changed"; exit 1; }
if grep -o 'android:authorities="[^"]*"' android/app/src/main/AndroidManifest.xml | grep -v 'android:authorities="${applicationId}\.'; then echo "::error::biz app: fixed provider authority"; exit 1; fi
grep -n 'applicationId' android/app/build.gradle
