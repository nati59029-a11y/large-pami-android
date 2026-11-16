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
# --- NOTIF-BUTTONS BEGIN ---
# Notification buttons (16.11.2026): "טופל" / "הזכר לי מחר" / "הזכר לי בעוד שעה" straight from the notification.
# Our service (LpMessagingService, extends the push plugin's service, so the screens keep their events) replaces the plugin's
# service: exactly ONE app service may receive FCM messages, otherwise Firebase picks one of them at random.
# Running twice adds nothing twice. A gradle check (end of this script) verifies the MERGED manifest too.
grep -q 'android.permission.RECEIVE_BOOT_COMPLETED' $M || sed -i 's|<application|<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />\n    <application|' $M
python3 - "$M" <<'PY3'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
m = re.search(r'<manifest\b[^>]*>', s)
if not m:
    sys.exit("::error::notif buttons: <manifest> not found")
if 'xmlns:tools=' not in m.group(0):
    s = s[:m.start()] + m.group(0).replace('<manifest', '<manifest xmlns:tools="http://schemas.android.com/tools"', 1) + s[m.end():]
if "LpMessagingService" not in s:
    P = "com.largepami.finance."
    add = ('\n        <!-- Notification buttons (patch-android.sh) -->'
           '\n        <service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService" tools:node="remove" />'
           '\n        <service android:name="' + P + 'LpMessagingService" android:exported="false">'
           '\n            <intent-filter>'
           '\n                <action android:name="com.google.firebase.MESSAGING_EVENT" />'
           '\n            </intent-filter>'
           '\n        </service>'
           '\n        <receiver android:name="' + P + 'LpActReceiver" android:exported="false" />'
           '\n        <receiver android:name="' + P + 'LpBootReceiver" android:exported="false">'
           '\n            <intent-filter>'
           '\n                <action android:name="android.intent.action.BOOT_COMPLETED" />'
           '\n                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />'
           '\n            </intent-filter>'
           '\n        </receiver>'
           '\n        <activity android:name="' + P + 'LpActActivity" android:exported="false" android:excludeFromRecents="true"'
           ' android:noHistory="true" android:taskAffinity="" android:theme="@android:style/Theme.Translucent.NoTitleBar" />'
           '\n    ')
    i = s.rfind("</application>")
    if i < 0:
        sys.exit("::error::notif buttons: </application> not found")
    s = s[:i] + add + s[i:]
    open(p, "w", encoding="utf-8").write(s)
assert s.count("com.google.firebase.MESSAGING_EVENT") == 1, "notif buttons: expected exactly 1 MESSAGING_EVENT service in the app manifest"
assert s.count("LpMessagingService") == 1 and s.count('tools:node="remove"') >= 1
assert s.count("LpActReceiver") == 1 and s.count("LpActActivity") == 1 and s.count("LpBootReceiver") == 1
print("notif buttons manifest: OK (LpMessagingService, plugin service removed)")
PY3
# Android backup (16.11.2026): the button tokens of local snoozes (lp_notif_snz) and the cached FCM token (lp_notif_tok) are not
# backed up / moved to a new phone. Exclude-only rules = everything else is backed up exactly as before.
# Skipped (with a warning) if the manifest already has its own backup rules.
mkdir -p android/app/src/main/res/xml
cat > android/app/src/main/res/xml/lp_backup_rules.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="sharedpref" path="lp_notif_snz.xml" />
    <exclude domain="sharedpref" path="lp_notif_tok.xml" />
</full-backup-content>
XML
cat > android/app/src/main/res/xml/lp_data_extraction_rules.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="sharedpref" path="lp_notif_snz.xml" />
        <exclude domain="sharedpref" path="lp_notif_tok.xml" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="sharedpref" path="lp_notif_snz.xml" />
        <exclude domain="sharedpref" path="lp_notif_tok.xml" />
    </device-transfer>
</data-extraction-rules>
XML
python3 - "$M" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
m = re.search(r'<application\b[^>]*>', s, re.S)
if not m:
    sys.exit("::error::backup rules: <application> not found")
tag = m.group(0)
if "lp_backup_rules" in tag:
    print("backup rules: already set")
elif "fullBackupContent" in tag or "dataExtractionRules" in tag:
    print("::warning::backup rules: the manifest has its own rules - lp_notif_* not excluded")
else:
    new = tag.replace("<application", '<application android:fullBackupContent="@xml/lp_backup_rules" android:dataExtractionRules="@xml/lp_data_extraction_rules"', 1)
    s = s[:m.start()] + new + s[m.end():]
    open(p, "w", encoding="utf-8").write(s)
    print("backup rules: OK (lp_notif_snz, lp_notif_tok excluded)")
PY4
# The app module compiles against FirebaseMessagingService (the push plugin keeps firebase-messaging to itself).
# Same version as the push plugin's default, so nothing new is downloaded. Plus the merged-manifest check.
grep -q 'lp-notif-buttons' android/app/build.gradle || cat >> android/app/build.gradle <<'GRADLE'

// lp-notif-buttons (patch-android.sh)
dependencies {
    implementation "com.google.firebase:firebase-messaging:${rootProject.ext.has('firebaseMessagingVersion') ? rootProject.ext.firebaseMessagingVersion : '23.3.1'}"
}
// Exactly one app service may receive FCM messages (ours). Firebase's own fallback service (priority -500) is ignored.
tasks.configureEach { t ->
    if (t.name ==~ /^process[A-Z]\w*MainManifest$/) {
        t.doLast {
            def files = t.outputs.files.asFileTree.matching { include '**/AndroidManifest.xml' }.files
            if (files.isEmpty()) throw new GradleException("lp-notif: merged AndroidManifest.xml not found (" + t.name + ")")
            files.each { f ->
                def txt = f.getText('UTF-8')
                def names = []
                def m = (txt =~ /(?s)<service\b[^>]*?(?:\/>|>.*?<\/service>)/)
                m.each { block ->
                    def b = block instanceof List ? block[0] : block
                    if (b.contains('com.google.firebase.MESSAGING_EVENT')) {
                        def n = (b =~ /android:name="([^"]+)"/)
                        names << (n.find() ? n.group(1) : '?')
                    }
                }
                names.removeAll { it == 'com.google.firebase.messaging.FirebaseMessagingService' }
                if (names != ['com.largepami.finance.LpMessagingService']) {
                    throw new GradleException("lp-notif: expected exactly one MESSAGING_EVENT service (LpMessagingService), found " + names + " in " + f)
                }
                println "lp-notif: merged manifest OK (" + f.name + ": " + names + ")"
            }
        }
    }
}
GRADLE
grep -q 'lp-notif-buttons' android/app/build.gradle || { echo "::error::notif buttons: gradle block missing"; exit 1; }
# --- NOTIF-BUTTONS END ---

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
# Notification buttons (16.11.2026): our FCM service + builder, button receiver, unlock screen (Android 8-11), restore after reboot
for f in LpNotif LpMessagingService LpActReceiver LpActActivity LpBootReceiver; do cp android-plugin/$f.java $J/$f.java; done
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
