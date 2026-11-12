#!/bin/bash
# 12.11.2026: התראות לטלפון – google-services.json לחבילה של הבנייה הזו (רץ בתוך app/, אחרי patch-android.sh וקובצי make-*-app.sh).
# עם הסוד FIREBASE_SERVICE_ACCOUNT: מוצא/יוצר את אפליקציית ה-Android ב-Firebase ומוריד את ההגדרות (scripts/fcm-config.py).
# בלי הסוד, בבניית בדיקה, או בכל כשל – הבנייה ממשיכה בלי התראות (לא נכשלת), וסיכום הריצה אומר זאת.
# הקובץ נכתב רק לעותק של הבנייה (app/android/app/google-services.json) – אף פעם לא למאגר.
set -u
OUT=android/app/google-services.json
SUM=${GITHUB_STEP_SUMMARY:-/dev/null}
rm -f "$OUT"
say() { echo "$1"; echo "$1" >> "$SUM"; }
off() { say "### התראות לטלפון: כבויות ב-APK הזה – $1"; echo "::notice::push OFF: $1"; exit 0; }
PKG=$(sed -n 's/^[[:space:]]*applicationId "\([^"]*\)".*/\1/p' android/app/build.gradle | head -1)
[ -n "$PKG" ] || off "לא נמצא applicationId"
[ "${SITE_BACKEND:-}" != "test" ] || off "גרסת בדיקה (פרויקט הבדיקה)"
[ -n "${FIREBASE_SERVICE_ACCOUNT:-}" ] || off "הסוד FIREBASE_SERVICE_ACCOUNT לא מוגדר"
grep -q "com.google.gms.google-services" android/app/build.gradle || off "תבנית Capacitor בלי google-services (לא צפוי)"
umask 077
SA="$RUNNER_TEMP/fcm-sa.json"
printf '%s' "$FIREBASE_SERVICE_ACCOUNT" > "$SA"
trap 'rm -f "$SA"' EXIT
LOG=$(python3 ../scripts/fcm-config.py "$SA" "$PKG" "$OUT" 2>&1); RC=$?
echo "$LOG"
if [ $RC -eq 2 ] || [ $RC -eq 3 ]; then
  rm -f "$OUT"
  [ $RC -eq 2 ] && say "### התראות לטלפון: כבויות – לחשבון השירות אין הרשאה ליצור/לקרוא אפליקציות ב-Firebase" \
    || say "### התראות לטלפון: כבויות – הגעתם למכסת האפליקציות בפרויקט Firebase ($PKG לא נוצרה)"
  echo "$LOG" | sed -n 's/^NEEDS: /מה לעשות: /p' >> "$SUM"
  echo "::warning::push OFF ($PKG): $(echo "$LOG" | sed -n 's/^NEEDS: //p' | head -1)"
  exit 0
fi
if [ $RC -ne 0 ] || [ ! -s "$OUT" ]; then rm -f "$OUT"; off "כשל בהורדת ההגדרות מ-Firebase (פרטים ביומן השלב)"; fi
python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$OUT" || { rm -f "$OUT"; off "קובץ הגדרות לא תקין"; }
say "### התראות לטלפון: פעילות ב-APK הזה ($PKG)"
