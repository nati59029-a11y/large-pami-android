set -e
sed -i "s/versionCode 1/versionCode 2/;s/versionName \"1.0\"/versionName \"1.1\"/" android/app/build.gradle
M=android/app/src/main/AndroidManifest.xml
sed -i 's|<application|<uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n    <application|' $M
RES=android/app/src/main/res
rm -rf $RES/mipmap-anydpi-v26
for d in $RES/mipmap-*; do cp www/icon-192.png $d/ic_launcher.png; cp www/icon-192.png $d/ic_launcher_round.png; cp www/icon-192.png $d/ic_launcher_foreground.png; done
