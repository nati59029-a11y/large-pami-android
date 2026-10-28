set -e
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
sed -i 's|<application|<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n    <application|' $M
# Silent self-update (Android 12+): lets the app ask PackageInstaller for USER_ACTION_NOT_REQUIRED
sed -i 's|<application|<uses-permission android:name="android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION" />\n    <application|' $M
grep -q 'fileprovider' $M || echo "::warning::FileProvider not found in manifest"
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

J=android/app/src/main/java/com/largepami/finance
cp android-plugin/SaveFilePlugin.java $J/SaveFilePlugin.java
cp android-plugin/AppUpdatePlugin.java $J/AppUpdatePlugin.java
cp android-plugin/PdfPrintPlugin.java $J/PdfPrintPlugin.java
cp android-plugin/LiveUpdateCore.java $J/LiveUpdateCore.java
cp android-plugin/LiveUpdatePlugin.java $J/LiveUpdatePlugin.java
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
        // Live update: choose the version of the screens before Capacitor loads them
        LiveUpdatePlugin.beforeLoad(this);
        super.onCreate(savedInstanceState);
    }
}
JAVA
