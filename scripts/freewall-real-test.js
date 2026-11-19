#!/usr/bin/env node
/* בדיקת "צילום חופשי של קיר" על תמונות אמיתיות, עם אותו קוד חיבור שבאפליקציה (app-source/www/store3d-freewall.js + opencv.js).
   התמונות לא נכנסות למאגר. דרוש: npm install @techstark/opencv-js@4.10.0-release.1 sharp בתיקייה זמנית, ו-NODE_PATH אליה.
   שימוש: NODE_PATH=/tmp/x/node_modules node scripts/freewall-real-test.js <תיקיית-תמונות> <שורות> <פלט.jpg>
   שורות: עליונה ראשונה, מופרדות ב-'/', טווחי מספרי קבצים: "16-20/1-15" = 16..20 למעלה, 1..15 למטה (כל שורה משמאל לימין).
   התמונות מוקטנות כמו באפליקציה (צלע ארוכה 1600, לפי כיוון EXIF). CROP=0 = בלי חיתוך שוליים. SEAM=0 = מיזוג ממוצע (בלי תפר חכם). */
const sharp = require('sharp'), cv0 = require('@techstark/opencv-js'), path = require('path'), FW = require('../app-source/www/store3d-freewall.js');
const [dir, rowsArg, out] = process.argv.slice(2);
if (!dir || !rowsArg || !out) { console.error('usage: freewall-real-test.js DIR "16-20/1-15" OUT.jpg'); process.exit(2); }
const rng = s => { const [a, b] = s.split('-').map(Number); const r = []; for (let i = a; i <= (b || a); i++) r.push(String(i).padStart(2, '0')); return r; };
(async () => {
  const cv = (await FW.cvReady(cv0)).cv, rows = rowsArg.split('/').map(rng), t0 = Date.now(), small = new Map();
  const load = async id => { if (!small.has(id)) small.set(id, await sharp(path.join(dir, id + '.jpg')).rotate().resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer()); return small.get(id); };
  const io = {
    gray: async id => { const b = await load(id), m = await sharp(b).metadata(), k = Math.min(1, FW.FEAT / Math.max(m.width, m.height)); const { data, info } = await sharp(b).resize(Math.round(m.width * k), Math.round(m.height * k)).grayscale().raw().toBuffer({ resolveWithObject: true }); return { w: info.width, h: info.height, g: new Uint8Array(data), W: m.width, H: m.height }; },
    color: async id => { const { data, info } = await sharp(await load(id)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { w: info.width, h: info.height, data: new Uint8Array(data) }; },
  };
  const pl = await FW.plan(cv, rows, io, {});
  const pairs = []; rows.forEach(r => { for (let j = 0; j + 1 < r.length; j++) pairs.push([r[j], r[j + 1]]); });
  const direct = pairs.filter(([a, b]) => pl.edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))).length;
  console.log('תמונות:', rows.flat().length, '| מוקמו:', pl.G.size, '| לא חוברו:', pl.unplaced.join(',') || 'אין');
  console.log('חיבורים שהתקבלו:', pl.edges.length, '(מתוך', pl.tried, 'זוגות שנבדקו) | שכנים בשורה עם חיבור ישיר:', direct, 'מתוך', pairs.length, '| הוסרו כסותרים:', pl.dropped.map(e => e.a + '-' + e.b).join(',') || 'אין');
  console.log('חיבורים:', pl.edges.map(e => `${e.a}-${e.b}(${e.dir},${e.inl})`).join(' '));
  const fr = FW.frame(cv, pl, 600), g = FW.gains(pl, pl.sm); io.gain = id => g.get(id);
  if (process.env.SEAM !== '0') { const t1 = Date.now(); pl.seam = FW.seams(cv, pl, fr, { gain: id => g.get(id) }); console.log('תפר חכם:', pl.seam ? 'כן' : 'לא', ((Date.now() - t1) / 1000).toFixed(1), 'שניות'); }
  const V = process.env.CROP === '0' ? { x0: fr.x0, y0: fr.y0, x1: fr.x1, y1: fr.y1 } : fr.crop, vw = V.x1 - V.x0, vh = V.y1 - V.y0, k = Math.min(1, Math.sqrt(FW.MAXA / (vw * vh)));
  const OW = Math.round(vw * k), OH = Math.round(vh * k), comp = [], cache = new Map(), col = io.color;
  io.color = async id => { if (!cache.has(id)) { if (cache.size >= 3) cache.delete(cache.keys().next().value); cache.set(id, await col(id)); } return cache.get(id); };
  for (let Y = 0; Y < OH; Y += FW.TILE) for (let X = 0; X < OW; X += FW.TILE) { const tw = Math.min(FW.TILE, OW - X), th = Math.min(FW.TILE, OH - Y), t = await FW.tile(cv, pl, fr, io, V, k, X, Y, tw, th); comp.push({ input: await sharp(Buffer.from(t.rgba.buffer), { raw: { width: tw, height: th, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer(), left: X, top: Y }); }
  const big = await sharp({ create: { width: OW, height: OH, channels: 4, background: '#000' }, limitInputPixels: false }).composite(comp).png({ compressionLevel: 1 }).toBuffer();
  await sharp(big, { limitInputPixels: false }).resize({ width: Math.min(OW, 4000) }).jpeg({ quality: 85 }).toFile(out);
  console.log('תוצאה', OW + '×' + OH, '| אזורים שלא צולמו:', fr.gaps.length, '| זמן', ((Date.now() - t0) / 1000).toFixed(1), 'שניות →', out);
})().catch(e => { console.error('ERR', String(e && e.stack || e).slice(0, 400)); process.exit(1); });
