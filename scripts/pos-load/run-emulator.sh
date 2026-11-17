#!/usr/bin/env bash
# מריץ את כל התהליך מול אמולטור Firestore מקומי בלבד (פרויקט demo-pos-load – לא פונה לשום שירות אמיתי):
#   יצירת נתוני דוגמה → כתיבה לאמולטור → בדיקות כפילות ועומס → דוח ביצועים (python).
# מעקף proxy (לקח מסשנים קודמים): בסביבת ענן JAVA_TOOL_OPTIONS ומשתני HTTP(S)_PROXY מפנים גם את 127.0.0.1 דרך המתווך,
# ולכן האמולטור (Java) והבדיקות (gRPC) רצים בלעדיהם, עם NO_PROXY ל-127.0.0.1.
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
PROJECT="${POS_EMU_PROJECT:-demo-pos-load}"
case "$PROJECT" in demo-*) ;; *) echo "סירוב: האמולטור רץ רק בפרויקט demo-*"; exit 1;; esac
export NO_PROXY="127.0.0.1,localhost,::1${NO_PROXY:+,$NO_PROXY}" no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
node gen-demo-data.js "$@"
set +e
env -u JAVA_TOOL_OPTIONS -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  npx firebase emulators:exec --only firestore --project "$PROJECT" \
  "node gen-demo-data.js --seed-emulator $* > out/seed.log && node loadtest.js"
rc=$?
set -e
python3 report.py || true
exit $rc
