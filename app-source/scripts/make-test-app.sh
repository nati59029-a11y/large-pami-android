set -e
# Test build only (main.yml runs this after patch-android.sh, only when SITE_BACKEND=test; never from main):
# a SEPARATE app "לארג’ פעמי – בדיקה" (com.largepami.finance.test) installed next to the regular one.
# Only applicationId changes: namespace, Java package and the plugins stay com.largepami.finance, and the
# FileProvider authority is ${applicationId}.fileprovider, so it becomes unique too. Same signing key.
# Every replacement must match exactly once, otherwise the build stops. The regular build never runs this file,
# so its output and its live-update fingerprint (scripts/live-update.py native-id) stay exactly as before.
[ "$GITHUB_REF" != "refs/heads/main" ] || { echo "::error::test app is not allowed from main"; exit 1; }
grep -qx "window.LP_SITE_BACKEND = 'test';" www/orders/site-backend.js || { echo "::error::test app: prepare.js did not make a test build"; exit 1; }
M=android/app/src/main/AndroidManifest.xml
node -e '
const fs=require("fs"),name=JSON.parse(fs.readFileSync("capacitor.config.json","utf8")).appName,T="לארג’ פעמי – בדיקה";
const sub=(f,from,to)=>{const t=fs.readFileSync(f,"utf8"),n=t.split(from).length-1;if(n!==1){console.error("::error::test app: expected 1 match in "+f+", found "+n+": "+from);process.exit(1)}fs.writeFileSync(f,t.replace(from,()=>to))};
sub("android/app/build.gradle","applicationId \"com.largepami.finance\"","applicationId \"com.largepami.finance.test\"");
const S="android/app/src/main/res/values/strings.xml";
sub(S,"<string name=\"app_name\">"+name+"</string>","<string name=\"app_name\">"+T+"</string>");
sub(S,"<string name=\"title_activity_main\">"+name+"</string>","<string name=\"title_activity_main\">"+T+"</string>");
'
grep -q 'namespace "com.largepami.finance"$' android/app/build.gradle || { echo "::error::test app: namespace changed"; exit 1; }
# Every content provider authority must come from ${applicationId}, or Android refuses to install it next to the regular app.
if grep -o 'android:authorities="[^"]*"' $M | grep -v 'android:authorities="${applicationId}\.'; then echo "::error::test app: fixed provider authority in the manifest"; exit 1; fi
grep -n 'applicationId' android/app/build.gradle
grep -n 'app_name\|title_activity_main' android/app/src/main/res/values/strings.xml
echo "TEST APP: com.largepami.finance.test (separate app, same signing key)"
