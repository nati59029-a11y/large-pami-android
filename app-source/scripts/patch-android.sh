set -e
# הורדת Gradle: זמן המתנה 2 דקות במקום 10 שניות (תקלות רשת זמניות הכשילו בנייה)
W=android/gradle/wrapper/gradle-wrapper.properties
if [ -f "$W" ]; then if grep -q '^networkTimeout=' "$W"; then sed -i 's/^networkTimeout=.*/networkTimeout=120000/' "$W"; else echo 'networkTimeout=120000' >> "$W"; fi; fi
sed -i "s/versionCode 1/versionCode 4/;s/versionName \"1.0\"/versionName \"2.0\"/" android/app/build.gradle
# Force the committed signing key (Gradle was generating a random debug key on every build)
test -f keystore/debug.keystore || { echo "::error::keystore missing"; exit 1; }
cat >> android/app/build.gradle <<'GRADLE'

android {
    signingConfigs {
        debug {
            storeFile file("../../keystore/debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
}
GRADLE
M=android/app/src/main/AndroidManifest.xml
sed -i 's|<application|<uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n    <application|' $M
# Microphone (voice recording for the phone line, screen "yemot-line.js"): without this getUserMedia({audio}) is denied in the WebView
sed -i 's|<application|<uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n    <application|' $M
sed -i 's|<application|<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n    <application|' $M
# Silent self-update (Android 12+): lets the app ask PackageInstaller for USER_ACTION_NOT_REQUIRED
sed -i 's|<application|<uses-permission android:name="android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION" />\n    <application|' $M
# App lock for managers (BiometricLock plugin): fingerprint/face through the system BiometricPrompt, screen lock as fallback
sed -i 's|<application|<uses-permission android:name="android.permission.USE_BIOMETRIC" />\n    <application|' $M
# Push notifications (12.11.2026): Android 13+ asks the user before showing notifications (the push plugin declares it too; listed here so it is never missing)
grep -q 'android.permission.POST_NOTIFICATIONS' $M || sed -i 's|<application|<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <application|' $M
grep -q 'fileprovider' $M || echo "::warning::FileProvider not found in manifest"
# --- SHARE-TARGET BEGIN ---
# "Share" menu of Android (WhatsApp, bank app, gallery): images and PDF, one file or many.
# Adds ONE intent-filter to MainActivity (running twice does not add it twice) and keeps launchMode="singleTask",
# so a share while the app is open reaches the running app (onNewIntent -> ShareInPlugin) instead of a second copy.
python3 - "$M" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
m = re.search(r'<activity\b[^>]*?android:name="(?:\.|com\.largepami\.finance\.)MainActivity"[^>]*>', s, re.S)
if not m or m.group(0).endswith("/>"):
    sys.exit("::error::share target: MainActivity not found in AndroidManifest.xml")
tag = m.group(0)
lm = re.search(r'android:launchMode="([^"]*)"', tag)
if not lm:
    new = tag.replace("<activity", '<activity android:launchMode="singleTask"', 1)
elif lm.group(1) != "singleTask":
    new = tag.replace(lm.group(0), 'android:launchMode="singleTask"')
else:
    new = tag
s = s[:m.start()] + new + s[m.end():]
start = m.start() + len(new)
end = s.find("</activity>", start)
if end < 0:
    sys.exit("::error::share target: </activity> not found")
if "android.intent.action.SEND_MULTIPLE" not in s[start:end]:
    f = ('    <intent-filter>\n'
         '                <action android:name="android.intent.action.SEND" />\n'
         '                <action android:name="android.intent.action.SEND_MULTIPLE" />\n'
         '                <category android:name="android.intent.category.DEFAULT" />\n'
         '                <data android:mimeType="image/*" />\n'
         '                <data android:mimeType="application/pdf" />\n'
         '            </intent-filter>\n\n        ')
    s = s[:end] + f + s[end:]
open(p, "w", encoding="utf-8").write(s)
n = s.count("android.intent.action.SEND_MULTIPLE")
if n != 1:
    sys.exit("::error::share target: expected 1 SEND_MULTIPLE filter, found %d" % n)
print("share target: OK (launchMode=singleTask, SEND + SEND_MULTIPLE, image/* + application/pdf)")
PY
# --- SHARE-TARGET END ---
mkdir -p android/app/src/main/res/xml
cat > android/app/src/main/res/xml/file_paths.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="my_images" path="." />
    <cache-path name="my_cache_images" path="." />
</paths>
XML
RES=android/app/src/main/res
rm -rf $RES/mipmap-anydpi-v26
for d in android-icons/mipmap-*; do n=$(basename $d); cp $d/ic_launcher.png $RES/$n/ic_launcher.png; cp $d/ic_launcher.png $RES/$n/ic_launcher_round.png; cp $d/ic_launcher.png $RES/$n/ic_launcher_foreground.png; done
# --- NOTIF-ICON BEGIN ---
# Push notifications (12.11.2026): the small icon in the status bar is always a one-colour silhouette on Android.
# Default = a bell (vector). scripts/notif-icon.py replaces it with a silhouette of the app's logo when the logo has a clear shape,
# and sets the accent colour from the logo (make-biz-app.sh runs it again with the business logo). Used by Firebase for
# notifications shown by the system and by the push plugin (both read these two meta-data entries).
mkdir -p $RES/drawable
cat > $RES/drawable/ic_stat_notify.xml <<'XML'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.89,2 2,2zM18,16v-5c0,-3.07 -1.64,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.63,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>
XML
python3 scripts/notif-icon.py android-icons/mipmap-xxxhdpi/ic_launcher.png $RES --preview notif-preview.png || true
test -f $RES/values/notif_color.xml || printf '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="notif_accent">#1C5A49</color>\n</resources>\n' > $RES/values/notif_color.xml
python3 - "$M" <<'PY2'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "default_notification_icon" not in s:
    i = s.find("<application")
    j = s.find(">", i)
    if i < 0 or j < 0:
        sys.exit("::error::notif icon: <application> not found")
    meta = ('\n        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_notify" />'
            '\n        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/notif_accent" />')
    s = s[:j + 1] + meta + s[j + 1:]
    open(p, "w", encoding="utf-8").write(s)
assert s.count("default_notification_icon") == 1
print("notif icon meta-data: OK")
PY2
# --- NOTIF-ICON END ---

J=android/app/src/main/java/com/largepami/finance
cp android-plugin/SaveFilePlugin.java $J/SaveFilePlugin.java
cp android-plugin/AppUpdatePlugin.java $J/AppUpdatePlugin.java
cp android-plugin/PdfPrintPlugin.java $J/PdfPrintPlugin.java
cp android-plugin/LiveUpdateCore.java $J/LiveUpdateCore.java
cp android-plugin/LiveUpdatePlugin.java $J/LiveUpdatePlugin.java
cp android-plugin/ShareInPlugin.java $J/ShareInPlugin.java
cp android-plugin/BiometricLockPlugin.java $J/BiometricLockPlugin.java
cp android-plugin/PayBrowserPlugin.java $J/PayBrowserPlugin.java
cp android-plugin/PushGatePlugin.java $J/PushGatePlugin.java
cat > $J/MainActivity.java <<'JAVA'
package com.largepami.finance;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SaveFilePlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(PdfPrintPlugin.class);
        registerPlugin(LiveUpdatePlugin.class);
        registerPlugin(ShareInPlugin.class);
        registerPlugin(BiometricLockPlugin.class);
        registerPlugin(PayBrowserPlugin.class);
        // Push: tells the screens whether this APK was built with google-services.json (without it push stays off)
        registerPlugin(PushGatePlugin.class);
        // Share menu: a re-created screen gets the same share intent again - do not take it twice
        ShareInPlugin.recreated = savedInstanceState != null;
        // Live update: choose the version of the screens before Capacitor loads them
        LiveUpdatePlugin.beforeLoad(this);
        // App lock: FLAG_SECURE before the first frame, so no app content shows in "recent apps"
        BiometricLockPlugin.applyEarly(this);
        super.onCreate(savedInstanceState);
    }
}
JAVA
