#!/usr/bin/env bash
# גרסת המחשב: מסך הכניסה מציג "ניהול עסק" כללי (שם, סמל וכותרת בדפדפן), כמו האפליקציה הכללית לטלפון.
# אחרי הכניסה כל עסק רואה את המיתוג שלו (window.LP_BIZ נקרא רק לפני הכניסה).
# שימוש: bash scripts/web-generic-brand.sh <תיקיית www שנבנתה>   (דורש python3 עם pillow)
set -euo pipefail
W="$1"
[ -f "$W/index.html" ] || { echo "::error::$W/index.html לא נמצא"; exit 1; }
TMP=$(mktemp -d)
python3 app-source/scripts/biz-icons.py --generic "$TMP/res" "$W/biz-logo.png"
node -e '
const fs=require("fs"),W=process.argv[1],nm="ניהול עסק";
const sub=(f,from,to)=>{const t=fs.readFileSync(f,"utf8"),n=t.split(from).length-1;if(n!==1){console.error("::error::web generic brand: expected 1 match in "+f+", found "+n+": "+from);process.exit(1)}fs.writeFileSync(f,t.replace(from,()=>to))};
const logo="data:image/png;base64,"+fs.readFileSync(W+"/biz-logo.png").toString("base64");
fs.writeFileSync(W+"/biz-default.js","/* נכתב בבנייה (scripts/web-generic-brand.sh) */\nwindow.LP_BIZ="+JSON.stringify({id:"business",name:nm,logo})+";\n");
sub(W+"/index.html","<script src=\"orders/site-backend.js\"></script>\n","<script src=\"orders/site-backend.js\"></script>\n<script src=\"biz-default.js\"></script>\n");
sub(W+"/index.html","<title>לארג׳ פעמי</title>","<title>"+nm+"</title>");
' "$W"
rm -rf "$TMP"
echo "גרסת המחשב: מיתוג כללי \"ניהול עסק\" במסך הכניסה"
