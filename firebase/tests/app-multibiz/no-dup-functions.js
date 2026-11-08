// בודק שאין שתי פונקציות באותו שם ב-index.html (פונקציה כפולה דורסת את הקודמת בשקט – כך נשבר ייצוא PDF בסבב 2).
// עם acorn (אם מותקן): רק הצהרות function ברמה העליונה של כל <script>, כמו שהדפדפן רואה – פונקציה פנימית באותו שם בהיקף אחר לא נחשבת כפולה.
// בלי acorn: נסיגה ל-regex על כל הקובץ (מחמיר יותר: גם פונקציות פנימיות, הערות ומחרוזות – עלול לתת כשל שווא, לא החמצה).
const fs=require('fs'),p=process.argv[2]||'../app-source/www/index.html';
const h=fs.readFileSync(p,'utf8'),seen={},dup=[];let acorn=null,mode='regex';
try{acorn=require('acorn')}catch(e){}
if(acorn){mode='acorn';const seenS={};
 for(const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g)){const ast=acorn.parse(m[1],{ecmaVersion:'latest'});
  for(const n of ast.body)if(n.type==='FunctionDeclaration'&&n.id){const k=n.id.name;if(seenS[k])dup.push(k);seenS[k]=1;seen[k]=1}}}
else for(const m of h.matchAll(/(?:^|[;}\s])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)){const n=m[1];if(seen[n])dup.push(n);seen[n]=1}
if(dup.length){console.error('פונקציות כפולות ('+mode+'):',[...new Set(dup)].join(', '));process.exit(1)}
console.log('OK ('+mode+'): אין פונקציות כפולות ('+Object.keys(seen).length+')');
