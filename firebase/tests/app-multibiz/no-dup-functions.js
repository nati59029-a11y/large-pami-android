// בודק שאין שתי פונקציות באותו שם ב-index.html (פונקציה כפולה דורסת את הקודמת בשקט – כך נשבר ייצוא PDF בסבב 2).
const fs=require('fs'),p=process.argv[2]||'../app-source/www/index.html';
const h=fs.readFileSync(p,'utf8'),seen={},dup=[];
for(const m of h.matchAll(/(?:^|[;}\s])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)){const n=m[1];if(seen[n])dup.push(n);seen[n]=1}
if(dup.length){console.error('פונקציות כפולות:',[...new Set(dup)].join(', '));process.exit(1)}
console.log('OK: אין פונקציות כפולות ('+Object.keys(seen).length+')');
