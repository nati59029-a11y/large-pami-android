'use strict';
// טיוטת מפה – שאלון וסקיצה מבעל החנות (החלטת המשתמש 15.11.2026): לפני "בנו טיוטה" המנהל ממלא מידות, מספר חדרים ושורות,
// צד כניסה וקופה, ומשרטט באצבע פינות חדרים ושורות. הכול לא חובה (גרסת אפליקציה ישנה שולחת בלי השדות – עובד כמו קודם).
//   draftInput(input) – בדיקה קפדנית של input.info / input.sketch. מחזיר { info, sketch } (null כשלא נשלח) או זורק fail('bad-info').
//   shapeDraft(map, info, sketch) – אחרי תשובת ה-AI (אחרי cleanDraft): התאמה למידות החיצוניות, חדרים מהסקיצה, והצמדת גופים לשורות.
//     הטיוטה ממשיכה אחר כך לאותה בדיקה מלאה כמו s3SaveMap (fitDraft), כך שהשינוי כאן לא יכול לשמור מפה לא תקינה.
// יחידות: סנטימטרים שלמים במערכת הצירים של המפה: (0,0) = פינה שמאלית-עליונה בסקיצה, x ימינה (רוחב, info.w), y למטה (אורך, info.l).
const M = require('./store3d-map');

const SIDES = ['u', 'd', 'r', 'l'];          // למעלה / למטה / ימין / שמאל בסקיצה
const LIM = { dimMin: 200, dimMax: 10000, rooms: 6, rows: 30, corners: 20, rowMin: 50, note: 200, bytes: 12000, doors: 40, tills: 40 };
const INFO_KEYS = ['w', 'l', 'rooms', 'rows', 'ent', 'cash', 'note'];
const SK_KEYS = ['rooms', 'rows', 'rt', 'rk', 'ent', 'cash', 'doors', 'tills'];
// כמה כניסות וקופות (החלטת המשתמש 17.11.2026): doors = [{x,y,w,a,sw,hg}] – רוחב (ס"מ), זווית הקיר, sw = לאיזה צד של הקיר הדלת נפתחת
// (1/-1 ביחס לניצב של a), hg = באיזה קצה הציר (1 = הקצה בכיוון a). tills = [{x,y,w,d,a}] – קופה עם רוחב, עומק וזווית.
// ent/cash (נקודה אחת) נשארים לגרסאות ישנות של האפליקציה.
const DOOR_KEYS = ['x', 'y', 'w', 'a', 'sw', 'hg'], TILL_KEYS = ['x', 'y', 'w', 'd', 'a'];
const RT = ['s', 'w', 'x'];                  // סוג חדר: חנות / מחסן / חדר נוסף
const RK = ['gon', 'wall', 'fridge'];        // סוג שורה: גונדולה דו-צדדית / מדף קיר / מקררים
const RT_NAME = { s: 'אולם מכירות', w: 'מחסן', x: '' };
const SNAP = 200;                            // גוף שמרכזו עד 2 מטר משורה בסקיצה – מוצמד אליה
const ROW_K = ['gon', 'wall', 'fridge'];

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const inR = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const none = (v) => v === undefined || v === null;
function fail(msg) { const e = new Error(msg); e.code = 'bad-info'; return e; }

// ---------- בדיקת קלט ----------
function cleanInfo(o) {
  if (none(o)) return null;
  if (!isObj(o)) throw fail('פרטי החנות לא תקינים');
  for (const k of Object.keys(o)) if (!INFO_KEYS.includes(k)) throw fail('פרטי החנות לא תקינים');
  const out = {};
  const int = (k, a, b, msg) => { if (none(o[k])) return; if (!inR(o[k], a, b)) throw fail(msg); out[k] = o[k]; };
  int('w', LIM.dimMin, LIM.dimMax, 'הרוחב צריך להיות בין 2 ל-100 מטר');
  int('l', LIM.dimMin, LIM.dimMax, 'האורך צריך להיות בין 2 ל-100 מטר');
  int('rooms', 1, LIM.rooms, `מספר החדרים צריך להיות בין 1 ל-${LIM.rooms}`);
  int('rows', 0, LIM.rows, `מספר השורות צריך להיות בין 0 ל-${LIM.rows}`);
  for (const k of ['ent', 'cash']) {
    if (none(o[k]) || o[k] === '') continue;
    if (!SIDES.includes(o[k])) throw fail('הצד שנבחר לא תקין');
    out[k] = o[k];
  }
  if (!none(o.note)) {
    if (typeof o.note !== 'string' || o.note.length > LIM.note) throw fail(`ההערה ארוכה מדי (עד ${LIM.note} תווים)`);
    const t = o.note.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t) out.note = t;
  }
  return Object.keys(out).length ? out : null;
}
function cleanSketch(o, info) {
  if (none(o)) return null;
  if (!isObj(o)) throw fail('השרטוט לא תקין');
  for (const k of Object.keys(o)) if (!SK_KEYS.includes(k)) throw fail('השרטוט לא תקין');
  if (!info || !info.w || !info.l) throw fail('לשרטוט צריך רוחב ואורך');
  const inBox = (L) => L.every((v, i) => inR(v, 0, i % 2 ? info.l : info.w));
  const rooms = none(o.rooms) ? [] : o.rooms, rows = none(o.rows) ? [] : o.rows;
  if (!Array.isArray(rooms) || rooms.length > LIM.rooms) throw fail(`בשרטוט אפשר עד ${LIM.rooms} חדרים`);
  if (!Array.isArray(rows) || rows.length > LIM.rows) throw fail(`בשרטוט אפשר עד ${LIM.rows} שורות`);
  rooms.forEach((p, i) => {
    if (!Array.isArray(p) || p.length < 6 || p.length > LIM.corners * 2 || p.length % 2 || !inBox(p)) throw fail(`חדר ${i + 1} בשרטוט לא תקין`);
    if (M.polyErr(p)) throw fail(`חדר ${i + 1} בשרטוט: ${M.polyErr(p)}`);
  });
  rows.forEach((s, i) => {
    if (!Array.isArray(s) || s.length !== 4 || !inBox(s)) throw fail(`שורה ${i + 1} בשרטוט לא תקינה`);
    if (Math.hypot(s[2] - s[0], s[3] - s[1]) < LIM.rowMin) throw fail(`שורה ${i + 1} בשרטוט קצרה מדי`);
  });
  // סוגי חדרים / שורות (שאלות ההמשך על הסקיצה) – רשימה באורך של החדרים / השורות; נקודת כניסה וקופה [x,y] בתוך המידות
  const types = (k, L, ok) => { if (none(o[k])) return null; if (!Array.isArray(o[k]) || o[k].length !== L.length || !o[k].every((v) => ok.includes(v))) throw fail('סוגי החדרים או השורות בשרטוט לא תקינים'); return o[k].slice(); };
  const rt = types('rt', rooms, RT), rk = types('rk', rows, RK);
  const pt = (k) => { if (none(o[k])) return null; if (!Array.isArray(o[k]) || o[k].length !== 2 || !inBox(o[k])) throw fail('מיקום הכניסה או הקופה בשרטוט לא תקין'); return o[k].slice(); };
  const ent = pt('ent'), cash = pt('cash');
  const objs = (k, max, keys, ok, msg) => {
    if (none(o[k])) return [];
    if (!Array.isArray(o[k]) || o[k].length > max) throw fail(`בשרטוט אפשר עד ${max} ${msg}`);
    return o[k].map((v, i) => {
      if (!isObj(v) || Object.keys(v).some((x) => !keys.includes(x)) || !keys.every((x) => x in v) || !inBox([v.x, v.y]) || !ok(v)) throw fail(`${msg} ${i + 1} בשרטוט לא תקינה`);
      const c = {}; for (const x of keys) c[x] = v[x]; return c;
    });
  };
  const pm = (v) => v === 1 || v === -1;
  const doors = objs('doors', LIM.doors, DOOR_KEYS, (v) => inR(v.w, 60, 500) && inR(v.a, 0, 359) && pm(v.sw) && pm(v.hg), 'כניסות');
  const tills = objs('tills', LIM.tills, TILL_KEYS, (v) => inR(v.w, 30, 1000) && inR(v.d, 30, 1000) && inR(v.a, 0, 359), 'קופות');
  if (!rooms.length && !rows.length && !ent && !cash && !doors.length && !tills.length) return null;
  const out = { rooms: rooms.map((p) => p.slice()), rows: rows.map((s) => s.slice()) };
  if (rt) out.rt = rt;
  if (rk) out.rk = rk;
  if (ent) out.ent = ent;
  if (cash) out.cash = cash;
  if (doors.length) out.doors = doors;
  if (tills.length) out.tills = tills;
  return out;
}
// input = גוף הבקשה של mapDraft. גודל: info + sketch יחד עד LIM.bytes תווים של JSON (לפני כל בדיקה אחרת)
function draftInput(input) {
  const i = isObj(input) ? input : {};
  if (none(i.info) && none(i.sketch)) return { info: null, sketch: null };
  let n;
  try { n = JSON.stringify([i.info === undefined ? null : i.info, i.sketch === undefined ? null : i.sketch]).length; } catch (e) { throw fail('פרטי החנות לא תקינים'); }
  if (n > LIM.bytes) throw fail('פרטי החנות והשרטוט גדולים מדי');
  const info = cleanInfo(i.info);
  return { info, sketch: cleanSketch(i.sketch, info) };
}

// ---------- התאמת הטיוטה ----------
const clampI = (v, a, b) => Math.min(b, Math.max(a, Math.round(v)));
const deg = (v) => ((Math.round(v) % 360) + 360) % 360;
function segDist(px, py, s) {
  const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / L2)) : 0;
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}
const roomAt = (rooms, x, y) => (rooms.find((r) => M.inMap({ rooms: [r] }, x, y)) || rooms[0]).id;
const bayCount = (L) => L.reduce((a, f) => a + (f.sides === 2 ? 2 : 1) * f.bays, 0);

// map = הטיוטה אחרי cleanDraft (חדרים תקינים, מזהים f1…). מחזיר { map, add, snap } – עותק חדש; map המקורי לא משתנה.
function shapeDraft(map0, info, sketch) {
  const map = JSON.parse(JSON.stringify(map0));
  const W = info && info.w, L = info && info.l;
  let add = 0, snap = 0;
  if (!W || !L || !Array.isArray(map.rooms) || !map.rooms.length) return { map, add, snap };
  // 1. מידות חיצוניות: מותחים/מכווצים את כל הטיוטה כך שהחדרים יתפסו בדיוק W×L (פי 0.1 עד 10 לכל ציר)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of map.rooms) for (let i = 0; i < r.p.length; i += 2) { x0 = Math.min(x0, r.p[i]); x1 = Math.max(x1, r.p[i]); y0 = Math.min(y0, r.p[i + 1]); y1 = Math.max(y1, r.p[i + 1]); }
  const sx = Math.min(10, Math.max(0.1, W / Math.max(1, x1 - x0))), sy = Math.min(10, Math.max(0.1, L / Math.max(1, y1 - y0)));
  const X = (v) => clampI((v - x0) * sx, 0, W), Y = (v) => clampI((v - y0) * sy, 0, L);
  for (const r of map.rooms) r.p = r.p.map((v, i) => (i % 2 ? Y(v) : X(v)));
  for (const w of map.walls || []) w.p = [X(w.p[0]), Y(w.p[1]), X(w.p[2]), Y(w.p[3])];
  for (const o of [].concat(map.cols || [], map.doors || [], map.syms || [])) { o.x = X(o.x); o.y = Y(o.y); }
  for (const f of map.fx || []) {
    const a = (f.a * Math.PI) / 180, k = Math.abs(Math.cos(a)) * sx + Math.abs(Math.sin(a)) * sy;
    f.x = X(f.x); f.y = Y(f.y); f.w = clampI(f.w * k, 30, 2000);
  }
  for (const z of map.uz || []) { z.x = X(z.x); z.y = Y(z.y); z.w = clampI(z.w * sx, 50, 10000); z.d = clampI(z.d * sy, 50, 10000); }
  // 2. חדרים מהסקיצה גוברים על החדרים של ה-AI (שמות וגובה – מה-AI לפי הסדר). קירות פנימיים של ה-AI לא נשמרים: הקירות = קווי החדרים
  if (sketch && sketch.rooms && sketch.rooms.length) {
    const ai = map.rooms;
    const rt = sketch.rt || [];
    map.rooms = sketch.rooms.map((p, i) => ({ id: 'r' + (i + 1), name: RT_NAME[rt[i]] || (ai[i] && ai[i].name) || (i ? 'חדר ' + (i + 1) : 'אולם מכירות'), p: p.slice(), h: (ai[i] && ai[i].h) || 300 }));
    map.walls = [];
    for (const f of map.fx || []) f.room = roomAt(map.rooms, f.x, f.y);
  }
  // 3. שורות מהסקיצה: הגוף הקרוב ביותר (מדף, גונדולה, מקרר, עד 2 מטר) מוצמד לכל שורה – מרכז, כיוון ואורך מהסקיצה.
  //    שורה בלי גוף קרוב – נוספת גונדולה, עם אזור לא ודאי (uz) כדי שהמנהל יבדוק את הסוג והפרטים
  const rows = (sketch && sketch.rows) || [];
  if (rows.length) {
    const fx = map.fx || (map.fx = []);
    const pairs = [];
    rows.forEach((s, ri) => fx.forEach((f, fi) => { if (ROW_K.includes(f.k)) { const d = segDist(f.x, f.y, s); if (d <= SNAP) pairs.push([d, ri, fi]); } }));
    pairs.sort((a, b) => a[0] - b[0]);
    const usedR = new Set(), usedF = new Set();
    for (const [, ri, fi] of pairs) {
      if (usedR.has(ri) || usedF.has(fi)) continue;
      usedR.add(ri); usedF.add(fi);
      const s = rows[ri], f = fx[fi], a = deg((Math.atan2(s[3] - s[1], s[2] - s[0]) * 180) / Math.PI);
      const alt = (a + 180) % 360, near = (b) => Math.min(Math.abs(b - f.a), 360 - Math.abs(b - f.a));
      f.x = Math.round((s[0] + s[2]) / 2); f.y = Math.round((s[1] + s[3]) / 2);
      f.a = near(a) <= near(alt) ? a : alt;   // שומרים לאיזה צד המדף פונה
      f.w = clampI(Math.hypot(s[2] - s[0], s[3] - s[1]), 30, 2000);
      const k = sketch.rk && sketch.rk[ri];
      if (k && k !== f.k) { f.k = k; f.sides = k === 'gon' ? 2 : 1; if (k !== 'fridge') delete f.glass; }   // בעל החנות אמר מה זה
      if (map.rooms.length) f.room = roomAt(map.rooms, f.x, f.y);
      snap++;
    }
    rows.forEach((s, ri) => {
      if (usedR.has(ri) || fx.length >= 400 || (map.uz || []).length >= 50) return;
      const len = clampI(Math.hypot(s[2] - s[0], s[3] - s[1]), 30, 2000), bays = clampI(len / 100, 1, 30);
      const k = (sketch.rk && sketch.rk[ri]) || 'gon', sides = k === 'gon' ? 2 : 1;
      if (bayCount(fx) + sides * bays > M.MAX_BAYS) return;
      const x = Math.round((s[0] + s[2]) / 2), y = Math.round((s[1] + s[3]) / 2);
      const f = { id: '', k, x, y, w: len, d: k === 'gon' ? 90 : k === 'fridge' ? 80 : 40, h: 180, a: deg((Math.atan2(s[3] - s[1], s[2] - s[0]) * 180) / Math.PI), sides, bays, lvl: 5, hi: false, room: roomAt(map.rooms, x, y), num: 0 };
      if (k === 'fridge') f.glass = true;
      fx.push(f);
      const zx = Math.max(0, Math.min(s[0], s[2]) - 60), zy = Math.max(0, Math.min(s[1], s[3]) - 60);
      (map.uz || (map.uz = [])).push({ x: zx, y: zy, w: clampI(Math.abs(s[2] - s[0]) + 120, 50, 10000), d: clampI(Math.abs(s[3] - s[1]) + 120, 50, 10000), txt: 'שורה מהשרטוט – ה-AI לא זיהה כאן מדף. בדקו סוג ופרטים', ok: false });
      add++;
    });
    map.fx = fx.map((f, i) => Object.assign(f, { id: 'f' + (i + 1), num: i + 1 }));
    map.seq = map.fx.length;
  }
  // 4א. כניסות מהסקיצה (דלתות אמיתיות עם רוחב וכיוון פתיחה) במקום כניסות ה-AI; שאר הדלתות של ה-AI נשארות עד 40
  if (sketch && sketch.doors && sketch.doors.length) {
    const L = sketch.doors.map((d) => ({ id: '', x: d.x, y: d.y, w: d.w, a: d.a, k: 'ent', sw: d.sw, hg: d.hg }))
      .concat((map.doors || []).filter((d) => d.k !== 'ent' && d.del !== 1)).slice(0, 40);
    map.doors = L.map((d, i) => Object.assign(d, { id: 'd' + (i + 1) }));
    map.ent = 'd1';
  }
  // 4ב. קופות מהסקיצה (עם גודל) במקום הקופות של ה-AI; הקופות קודמות לשאר הסמלים כשיש יותר מ-40
  if (sketch && sketch.tills && sketch.tills.length) {
    const L = sketch.tills.map((t) => ({ id: '', k: 'cash', x: t.x, y: t.y, a: t.a, w: t.w, d: t.d }))
      .concat((map.syms || []).filter((y) => y.k !== 'cash')).slice(0, 40);
    map.syms = L.map((y, i) => Object.assign(y, { id: 'y' + (i + 1) }));
  }
  // 4. כניסה וקופה שסומנו על הסקיצה: הסמל מהסקיצה במקום הסמל של ה-AI מאותו סוג (קופות עם גודל כבר נכנסו למעלה)
  for (const k of ['ent', 'cash']) {
    if (k === 'cash' && sketch && sketch.tills && sketch.tills.length) continue;
    const pt = sketch && sketch[k];
    if (!pt) continue;
    const L = (map.syms || []).filter((y) => y.k !== k);
    if (L.length >= 40) continue;
    L.push({ id: '', k, x: pt[0], y: pt[1], a: 0 });
    map.syms = L.map((y, i) => Object.assign(y, { id: 'y' + (i + 1) }));
  }
  return { map, add, snap };
}

module.exports = { RT, RK, SIDES, LIM, SNAP, draftInput, cleanInfo, cleanSketch, shapeDraft, segDist };
