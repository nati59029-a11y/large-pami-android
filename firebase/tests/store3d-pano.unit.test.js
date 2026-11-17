'use strict';
// סריקת חנות בתלת מימד – שלב 18א (15.11.2026): בדיקות יחידה בלי אמולטור לסיור 360 – הפונקציות הטהורות ב-functions/lib/store3d-map.js
// (תמונות, נקודה, גבולות, קיר בין נקודות, שכנות אוטומטיות וקישור דו-כיווני, בלם יומי) וב-functions/lib/store3d-extra.js (panoClean).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const M = require(path.join(__dirname, '..', 'functions', 'lib', 'store3d-map.js'));
const X = require(path.join(__dirname, '..', 'functions', 'lib', 'store3d-extra.js'));
const D1 = 86400000, NOW = 1800000000000;
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'OK'; };
// JPEG מינימלי עם כותרת SOF0 (מידות) ו-pad בתים של ריפוד
function jpeg(w, h, pad) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(pad || 0), Buffer.from([0xff, 0xd9])]);
}
const b64 = (b) => b.toString('base64');
const FULL = b64(jpeg(4096, 2048)), SM = b64(jpeg(1024, 512));
// שני חדרים 10×10 מ' זה לצד זה, וקיר ביניהם ב-x=1000 עם דלת באמצע (y=500, רוחב 100)
const MAP = (o) => Object.assign({
  rooms: [{ id: 'r1', p: [0, 0, 1000, 0, 1000, 1000, 0, 1000] }, { id: 'r2', p: [1000, 0, 2000, 0, 2000, 1000, 1000, 1000] }, { id: 'r3', p: [3000, 0, 4000, 0, 4000, 1000, 3000, 1000], del: 1 }],
  walls: [{ id: 'w1', p: [1000, 0, 1000, 1000], t: 10 }], doors: [{ id: 'd1', x: 1000, y: 500, w: 100, a: 90, k: 'in' }],
}, o);

describe('store3d-pano: תמונות (decodePano)', () => {
  it('4096×2048 ו-2048×1024 עם קטנה 1024×512 – עוברות (גם עם התחילית data:)', () => {
    const r = M.decodePano(FULL, SM);
    assert.deepEqual([r.full.w, r.full.h, r.sm.w, r.sm.h], [4096, 2048, 1024, 512]);
    assert.equal(M.decodePano('data:image/jpeg;base64,' + b64(jpeg(2048, 1024)), SM).full.w, 2048);
  });
  it('לא 2:1 / רוחב אחר / קטנה במידה אחרת / לא JPEG / גדולה מדי / חסרה – נדחות', () => {
    assert.equal(code(() => M.decodePano(b64(jpeg(4096, 2000)), SM)), 'bad-ratio');
    assert.equal(code(() => M.decodePano(b64(jpeg(4096, 4096)), SM)), 'bad-ratio');
    assert.equal(code(() => M.decodePano(b64(jpeg(3000, 1500)), SM)), 'bad-size');
    assert.equal(code(() => M.decodePano(b64(jpeg(16384, 8192)), SM)), 'bad-size', 'שלב 21ו: 8192 הוא הרוחב המרבי');
    assert.equal(code(() => M.decodePano(b64(jpeg(8192, 4000)), SM)), 'bad-ratio');
    assert.equal(code(() => M.decodePano(FULL, b64(jpeg(512, 256)))), 'bad-size');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
    assert.equal(code(() => M.decodePano(b64(png), SM)), 'bad-type');
    assert.equal(code(() => M.decodePano(b64(jpeg(4096, 2048, M.PANO_MAX)), SM)), 'too-big');
    assert.equal(code(() => M.decodePano(FULL, b64(jpeg(1024, 512, M.PANO_SM_MAX)))), 'too-big');
    assert.equal(code(() => M.decodePano(FULL, null)), 'bad-img');
    assert.equal(code(() => M.decodePano('@@@@', SM)), 'bad-img');
    assert.equal(code(() => M.decodePano(b64(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), SM)), 'bad-img', 'בלי כותרת מידות');
  });
  it('גבול הגודל (שלב 21ו): מלאה בדיוק 8,000,000 בתים – עוברת; בית אחד יותר – נדחית', () => {
    assert.equal(M.PANO_MAX, 8000000);
    const base = jpeg(4096, 2048).length;
    assert.equal(M.decodePano(b64(jpeg(4096, 2048, M.PANO_MAX - base)), SM).full.buf.length, M.PANO_MAX);
    assert.equal(code(() => M.decodePano(b64(jpeg(4096, 2048, M.PANO_MAX - base + 1)), SM)), 'too-big');
  });
  it('שלב 21ו: 8192×4096 – עוברת (גם 6.5MB, גודל אופייני של חנות עמוסה); 2048 ו-4096 – עדיין עוברות', () => {
    assert.deepEqual(M.PANO_W, [2048, 4096, 8192]);
    const r = M.decodePano(b64(jpeg(8192, 4096, 6500000)), SM);
    assert.deepEqual([r.full.w, r.full.h, r.sm.w, r.sm.h], [8192, 4096, 1024, 512]);
    for (const w of [2048, 4096]) assert.equal(M.decodePano(b64(jpeg(w, w / 2)), SM).full.w, w);
  });
});

describe('store3d-pano: נקודה (cleanPt) וגבולות המפה', () => {
  it('נקודה תקינה; yaw מעוגל ל-0.1 ו-360 → 0; x/y מעוגלים; nb בלי כפילויות ובלי עצמה', () => {
    assert.deepEqual(M.cleanPt({ x: 100.4, y: 200, yaw: 360 }), { id: null, x: 100, y: 200, yaw: 0, nb: null });
    assert.deepEqual(M.cleanPt({ id: 'p3', x: 0, y: 10000, yaw: 12.345, nb: ['p1', 'p1', 'p3'] }), { id: 'p3', x: 0, y: 10000, yaw: 12.3, nb: ['p1'] });
  });
  it('מזהה / מיקום / כיוון / nb לא תקינים – נדחים', () => {
    assert.equal(code(() => M.cleanPt({ id: 'x1', x: 1, y: 1, yaw: 0 })), 'bad-pt');
    assert.equal(code(() => M.cleanPt({ x: -1, y: 1, yaw: 0 })), 'bad-pt');
    assert.equal(code(() => M.cleanPt({ x: 1, y: 10001, yaw: 0 })), 'bad-pt');
    assert.equal(code(() => M.cleanPt({ x: '1', y: 1, yaw: 0 })), 'bad-pt');
    assert.equal(code(() => M.cleanPt({ x: 1, y: 1, yaw: 361 })), 'bad-pt');
    assert.equal(code(() => M.cleanPt({ x: 1, y: 1, yaw: NaN })), 'bad-pt');
    assert.equal(code(() => M.cleanPt({ x: 1, y: 1, yaw: 0, nb: 'p1' })), 'bad-nb');
    assert.equal(code(() => M.cleanPt({ x: 1, y: 1, yaw: 0, nb: ['../x'] })), 'bad-nb');
    assert.equal(code(() => M.cleanPt({ x: 1, y: 1, yaw: 0, nb: Array.from({ length: 13 }, (_, i) => 'p' + (i + 1)) })), 'bad-nb');
  });
  it('inMap: בתוך חדר חי (כולל הקיר) – כן; מחוץ לחדרים / בחדר מחוק – לא', () => {
    assert.equal(M.inMap(MAP(), 500, 500), true);
    assert.equal(M.inMap(MAP(), 1000, 300), true, 'על הקיר המשותף');
    assert.equal(M.inMap(MAP(), 0, 0), true, 'בפינה');
    assert.equal(M.inMap(MAP(), 2500, 500), false);
    assert.equal(M.inMap(MAP(), 3500, 500), false, 'חדר מחוק');
    assert.equal(M.inMap(null, 1, 1), false);
  });
});

describe('store3d-pano: קיר בין נקודות ושכנות', () => {
  it('wallBlocks: קיר באמצע – חוסם; דרך הדלת – לא; קיר מחוק – לא חוסם', () => {
    assert.equal(M.wallBlocks(MAP(), { x: 800, y: 200 }, { x: 1200, y: 200 }), true);
    assert.equal(M.wallBlocks(MAP(), { x: 800, y: 500 }, { x: 1200, y: 500 }), false, 'דרך הדלת');
    assert.equal(M.wallBlocks(MAP(), { x: 800, y: 200 }, { x: 900, y: 200 }), false, 'באותו חדר');
    assert.equal(M.wallBlocks(MAP({ walls: [{ id: 'w1', p: [1000, 0, 1000, 1000], del: 1 }] }), { x: 800, y: 200 }, { x: 1200, y: 200 }), false);
    assert.equal(M.wallBlocks(MAP({ doors: [] }), { x: 800, y: 500 }, { x: 1200, y: 500 }), true, 'בלי דלת');
  });
  it('autoNb: עד 8 מ\', בלי קיר באמצע, הקרובות קודם, עד 8', () => {
    const pts = [{ id: 'p1', x: 300, y: 300 }, { id: 'p2', x: 900, y: 300 }, { id: 'p3', x: 1200, y: 300 }, { id: 'p4', x: 1100, y: 500 }, { id: 'p5', x: 100, y: 100 }];
    // מ-(500,500): p1 – 283 ס"מ; p2 – 447; p5 – 566; p4 – 600 (דרך הדלת); p3 – מעבר לקיר
    assert.deepEqual(M.autoNb({ id: 'p9', x: 500, y: 500 }, pts, MAP()), ['p1', 'p2', 'p5', 'p4']);
    assert.deepEqual(M.autoNb({ id: 'p9', x: 500, y: 500 }, [{ id: 'p1', x: 500, y: 1301 }], MAP({ rooms: [{ id: 'r', p: [0, 0, 2000, 0, 2000, 2000, 0, 2000] }], walls: [] })), [], 'יותר מ-8 מ\'');
    assert.deepEqual(M.autoNb({ id: 'p9', x: 500, y: 500 }, [{ id: 'p1', x: 500, y: 1300 }], MAP({ walls: [] })), ['p1'], 'בדיוק 8 מ\'');
    const many = Array.from({ length: 12 }, (_, i) => ({ id: 'p' + (i + 1), x: 100 + i * 10, y: 100 }));
    assert.equal(M.autoNb({ id: 'p99', x: 500, y: 500 }, many, MAP()).length, M.NB_AUTO);
  });
  it('linkNb: מוסיף קישור חוזר, מסיר כשכבר לא שכנה, לא נוגע במי שלא השתנה; שכנה מלאה לא מקבלת', () => {
    const pts = [{ id: 'p1', nb: [] }, { id: 'p2', nb: ['p9'] }, { id: 'p3', nb: ['p9', 'p1'] }, { id: 'p4', nb: ['p1'] }];
    assert.deepEqual(M.linkNb('p9', ['p1', 'p2'], pts), { p1: ['p9'], p3: ['p1'] });
    assert.deepEqual(M.linkNb('p9', [], pts), { p2: [], p3: ['p1'] }, 'מחיקה – יוצאת מכל הרשימות');
    const full = Array.from({ length: M.NB_MAX }, (_, i) => 'p' + (i + 20));
    assert.deepEqual(M.linkNb('p9', ['p1'], [{ id: 'p1', nb: full }]), {});
  });
  it('nextPid / panoPath / panoDayStep', () => {
    assert.equal(M.nextPid([]), 1);
    assert.equal(M.nextPid(['p3', 'p12', 'zz']), 13);
    assert.equal(M.panoPath('biz', 'main', 's-main', 'p2', 3), 'b/biz/store3d/main/pano/s-main/p2_3.jpg');
    assert.equal(M.panoPath('biz', 'main', 's-main', 'p2', 3, true), 'b/biz/store3d/main/pano/s-main/p2_3_s.jpg');
    assert.deepEqual(M.panoDayStep(null, '2026-11-15', NOW), { d: '2026-11-15', n: 1, upd: NOW });
    assert.deepEqual(M.panoDayStep({ d: '2026-11-14', n: 60 }, '2026-11-15', NOW), { d: '2026-11-15', n: 1, upd: NOW }, 'יום חדש מתחיל מ-0');
    assert.equal(M.panoDayStep({ d: '2026-11-15', n: 59 }, '2026-11-15', NOW).n, 60);
    assert.equal(code(() => M.panoDayStep({ d: '2026-11-15', n: 60 }, '2026-11-15', NOW)), 'pano-day');
    assert.equal(code(() => M.panoDayStep({ d: '2026-11-15', n: 2 }, '2026-11-15', NOW, 2)), 'pano-day');
  });
});

describe('store3d-pano: ניקוי (panoClean)', () => {
  const P = 'b/biz/store3d/main/pano/s-main/';
  const f = (n, days) => ({ name: P + n, t: NOW - days * D1 });
  it('גרסה נוכחית – נשארת תמיד; קודמת – 30 יום אחרי ההחלפה; נקודה מחוקה לפני 30+ יום – הכול והמסמך; בלי מסמך – לפי זמן יצירה', () => {
    const docs = new Map([
      ['p1', { ver: 2, at: NOW - 31 * D1 }],                       // הוחלפה לפני 31 יום
      ['p2', { ver: 2, at: NOW - 10 * D1 }],                       // הוחלפה לפני 10 ימים
      ['p3', { ver: 1, at: NOW - 90 * D1, del: 1, delAt: NOW - 31 * D1 }],
      ['p4', { ver: 1, at: NOW - 90 * D1, del: 1, delAt: NOW - 29 * D1 }],
    ]);
    const files = [f('p1_1.jpg', 60), f('p1_1_s.jpg', 60), f('p1_2.jpg', 31), f('p1_2_s.jpg', 31),
      f('p2_1.jpg', 60), f('p2_2.jpg', 10),
      f('p3_1.jpg', 90), f('p3_1_s.jpg', 90),
      f('p4_1.jpg', 90),
      f('p5_1.jpg', 31), f('p6_1.jpg', 5), f('p1_3.jpg', 31), f('p2_3.jpg', 0.5), { name: P + 'x.jpg', t: 1 }];
    const r = X.panoClean(files, docs, NOW);
    assert.deepEqual(r.files.map((x) => x.slice(P.length)), ['p1_1.jpg', 'p1_1_s.jpg', 'p3_1.jpg', 'p3_1_s.jpg', 'p5_1.jpg', 'p1_3.jpg']);
    assert.deepEqual(r.docs, ['p3']);
  });
  it('נקודה פעילה בלי זמן החלפה – הגרסאות הקודמות לא נמחקות', () => {
    const r = X.panoClean([f('p1_1.jpg', 400)], new Map([['p1', { ver: 2 }]]), NOW);
    assert.deepEqual(r, { files: [], docs: [] });
  });
});
