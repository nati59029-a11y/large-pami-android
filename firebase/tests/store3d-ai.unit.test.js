'use strict';
// סריקת חנות בתלת מימד – שלב 8 (14.11.2026): בדיקות יחידה ל-lib/store3d-ai.js, בלי אמולטור ובלי רשת.
// כולל את קובצי הדוגמה של שלב 6 (tests/fixtures/store3d-*.json) מול checkShelfResponse / checkMapDraftResponse ומול הסינון של השרת.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const FN = path.join(__dirname, '..', 'functions');
const A = require(path.join(FN, 'lib', 'store3d-ai.js'));
const M = require(path.join(FN, 'lib', 'store3d-map.js'));
const PS = require(path.join(FN, 'lib', 'prompts-shelf.js'));
const PM = require(path.join(FN, 'lib', 'prompts-mapdraft.js'));

const FX = (n) => { const o = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'store3d-' + n + '.json'), 'utf8')); delete o._example; delete o._meta; return o; };
function jpeg(w, h, pad) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(pad || 0), Buffer.from([0xff, 0xd9])]);
}
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'OK'; };
const fx = (id, o) => Object.assign({ id, k: 'gon', x: 300, y: 300, w: 200, d: 60, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }, o);
const MAP = { fx: [fx('f1', { sides: 2, bays: 3 }), fx('f2', { hi: true }), fx('f3', { del: 1 })] };

describe('store3d-ai – תמונות ומקום צילום', () => {
  it('decodeJpeg: JPEG תקין עובר; PNG, קטן מדי, גדול מדי, מידות חורגות – נדחים', () => {
    const ok = A.decodeJpeg(jpeg(1200, 900, 2000).toString('base64'), A.IMG);
    assert.equal(A.decodeJpeg('data:image/jpeg;base64,' + jpeg(1200, 900, 2000).toString('base64'), A.IMG).w, 1200, 'עם התחילית ובלעדיה');
    assert.deepEqual([ok.w, ok.h], [1200, 900]);
    assert.equal(A.decodeJpeg('data:image/jpeg;base64,' + jpeg(512, 384, 600).toString('base64'), A.THUMB).w, 512);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000)]);
    assert.equal(code(() => A.decodeJpeg(png.toString('base64'), A.IMG)), 'bad-type');
    assert.equal(code(() => A.decodeJpeg(jpeg(1200, 900).toString('base64'), A.IMG)), 'bad-img', 'פחות מ-1000 בתים');
    assert.equal(code(() => A.decodeJpeg(jpeg(2000, 900, 2000).toString('base64'), A.IMG)), 'bad-size');
    assert.equal(code(() => A.decodeJpeg(jpeg(1024, 768, 2000).toString('base64'), A.THUMB)), 'bad-size', 'מוקטנת עד 512');
    assert.equal(code(() => A.decodeJpeg(jpeg(1200, 900, 1500001).toString('base64'), A.IMG)), 'too-big');
    assert.equal(code(() => A.decodeJpeg('***', A.IMG)), 'bad-img');
    assert.equal(code(() => A.decodeJpeg('', A.IMG)), 'bad-img');
  });
  it('checkSlot: צד, מספר מקטע, a / t+b לפי hi, גוף מחוק', () => {
    assert.deepEqual(A.checkSlot('f1-b-3_a', MAP), { bay: 'f1-b-3', fx: 'f1', lv: 'a', hi: false });
    assert.deepEqual(A.checkSlot('f2-a-1_t', MAP), { bay: 'f2-a-1', fx: 'f2', lv: 't', hi: true });
    for (const s of ['f1-a-4_a', 'f2-b-1_t', 'f2-a-1_a', 'f1-a-1_t', 'f3-a-1_a', 'f9-a-1_a', 'x']) assert.equal(code(() => A.checkSlot(s, MAP)), 'bad-slot', s);
  });
  it('draftImgs (15.11.2026): עד 100 תמונות עוברות, 101 נדחות; סך הכל מעל 13,000,000 בתים נדחה; אותה דחיסה לכל תמונה', () => {
    assert.deepEqual([A.DRAFT.maxImgs, A.DRAFT.maxTotal, A.DRAFT.img.max, A.DRAFT.img.longMax], [100, 13000000, 1500000, 1600]);
    const small = jpeg(1200, 900, 2000).toString('base64');
    assert.equal(A.draftImgs(Array(100).fill(small)).length, 100, '100 תמונות');
    assert.equal(code(() => A.draftImgs(Array(101).fill(small))), 'bad-img-count', '101 תמונות');
    assert.equal(code(() => A.draftImgs([])), 'bad-img-count');
    assert.equal(code(() => A.draftImgs('x')), 'bad-img-count');
    // 13,000,000 בתים בדיוק – עובר; בית אחד יותר – נדחה
    const big = jpeg(1200, 900, 1500000 - 45);
    const per = big.length, last = 13000000 - 8 * per;
    assert.ok(per <= 1500000 && last >= 1000 && last <= 1500000);
    const tail = jpeg(1200, 900, last - jpeg(1200, 900).length);
    assert.equal(tail.length, last);
    const B64 = big.toString('base64');
    assert.equal(A.draftImgs(Array(8).fill(B64).concat([tail.toString('base64')])).length, 9, 'בדיוק 13,000,000');
    const tail1 = jpeg(1200, 900, last + 1 - jpeg(1200, 900).length).toString('base64');
    assert.equal(code(() => A.draftImgs(Array(8).fill(B64).concat([tail1]))), 'too-big', '13,000,001 בתים');
    assert.equal(code(() => A.draftImgs([jpeg(1200, 900, 1500001).toString('base64')])), 'too-big', 'תמונה בודדת מעל 1.5MB – כמו קודם');
  });
});

describe('store3d-ai – מכסה', () => {
  const o = (x) => Object.assign({ k: 1, cap: 10, month: '2026-11', day: '2026-11-14', now: 5, userMax: 400 }, x);
  it('חודש חדש מתאפס; 80% – אזהרה פעם אחת בחודש; מכסה מלאה עוצרת; בלם יומי לעובד', () => {
    let r = A.quotaStep(null, null, o());
    assert.deepEqual([r.b, r.u, r.warn, r.usage], [{ m: '2026-11', n: 1, cap: 10, w80: '', upd: 5 }, { d: '2026-11-14', n: 1, upd: 5 }, false, { m: '2026-11', n: 1, cap: 10, w80: false }]);
    r = A.quotaStep({ m: '2026-11', n: 7, w80: '' }, null, o());
    assert.deepEqual([r.b.n, r.warn, r.b.w80, r.usage.w80], [8, true, '2026-11', true]);
    r = A.quotaStep(r.b, null, o());
    assert.deepEqual([r.b.n, r.warn, r.b.w80], [9, false, '2026-11'], 'אזהרה רק פעם אחת בחודש');
    assert.equal(code(() => A.quotaStep({ m: '2026-11', n: 10 }, null, o())), 's3-month-limit');
    assert.equal(code(() => A.quotaStep({ m: '2026-11', n: 8 }, null, o({ k: 3 }))), 's3-month-limit', 'k גדול מהיתרה (k = 3 כשנשארו 2)');
    assert.equal(A.quotaStep({ m: '2026-10', n: 10, w80: '2026-10' }, null, o()).b.n, 1, 'חודש חדש');
    assert.equal(code(() => A.quotaStep(null, { d: '2026-11-14', n: 400 }, o({ cap: 1000 }))), 's3-user-day');
    assert.equal(A.quotaStep(null, { d: '2026-11-13', n: 400 }, o()).u.n, 1, 'יום חדש');
    assert.equal(code(() => A.quotaStep(null, null, o({ cap: 0 }))), 's3-month-limit', 'תקרה 0 = חסום');
    // דיווח יזום של עובד (תיקון סבב 1): מונה יומי נפרד
    assert.deepEqual(A.quotaStep(null, null, o({ adhocMax: 20, a: { d: '2026-11-14', n: 19 } })).a, { d: '2026-11-14', n: 20, upd: 5 });
    assert.equal(code(() => A.quotaStep(null, null, o({ adhocMax: 20, a: { d: '2026-11-14', n: 20 } }))), 's3-adhoc-day');
    assert.equal(A.quotaStep(null, null, o({ adhocMax: 20, a: { d: '2026-11-13', n: 20 } })).a.n, 1, 'יום חדש');
    assert.equal(A.quotaStep(null, null, o({ a: { d: '2026-11-14', n: 99 } })).a, undefined, 'בלי adhocMax (מנהל / סבב) – אין מונה');
  });
  it('refundStep: רק באותו חודש, לא מתחת ל-0', () => {
    assert.deepEqual(A.refundStep({ m: '2026-11', n: 5 }, '2026-11', 2, 9), { n: 3, upd: 9 });
    assert.deepEqual(A.refundStep({ m: '2026-11', n: 1 }, '2026-11', 3, 9), { n: 0, upd: 9 });
    assert.equal(A.refundStep({ m: '2026-12', n: 5 }, '2026-11', 1, 9), null);
    assert.deepEqual(A.refundDay({ d: '2026-11-14', n: 5 }, '2026-11-14', 1, 9), { n: 4, upd: 9 });
    assert.equal(A.refundDay({ d: '2026-11-13', n: 5 }, '2026-11-14', 1, 9), null);
  });
  it('draftDayStep: עד 5 הקמות ביום לסניף, יום חדש מתאפס, החזרה לא מתחת ל-0', () => {
    const D = '2026-11-15';
    assert.equal(A.DRAFT_DAY_MAX, 5);
    assert.deepEqual(A.draftDayStep(null, D, 7), { d: D, n: 1, upd: 7 });
    assert.deepEqual(A.draftDayStep({ d: D, n: 4 }, D, 7), { d: D, n: 5, upd: 7 }, 'החמישית עוברת');
    let e = null;
    try { A.draftDayStep({ d: D, n: 5 }, D, 7); } catch (x) { e = x; }
    assert.equal(e && e.code, 'draft-daily', 'השישית נדחית');
    assert.match(e.message, /5 הקמות היום בסניף הזה/);
    assert.deepEqual(A.draftDayStep({ d: '2026-11-14', n: 5 }, D, 7), { d: D, n: 1, upd: 7 }, 'יום חדש');
    assert.equal(A.draftDayStep({ d: D, n: 'x' }, D, 7).n, 1, 'מסמך פגום = 0');
    assert.deepEqual(A.refundDay({ d: D, n: 0 }, D, 1, 9), { n: 0, upd: 9 }, 'לא מתחת ל-0');
  });
});

describe('store3d-ai – תשובת בדיקת מדף (קובצי הדוגמה של שלב 6)', () => {
  const CTX = { recN: 3 };
  it('תקינות: shelf-ok / clean / unsure – checkShelfResponse נקי, ואחרי הסינון התוכן נשמר', () => {
    for (const n of ['shelf-ok', 'shelf-clean', 'shelf-unsure']) assert.deepEqual(PS.checkShelfResponse(FX(n), { recN: 3 }), [], n);
    const ok = A.cleanShelf(FX('shelf-ok'), CTX).ai;
    assert.equal(ok.st, 'issue');
    assert.deepEqual(ok.iss.map((i) => [i.k, i.sev, i.warn]), [['fallen', 3, false], ['face', 2, false], ['order', 1, false]]);
    assert.deepEqual(ok.iss[0].box, [150, 820, 130, 130]);
    assert.equal(ok.recs.length, 2);
    assert.deepEqual([ok.cat, ok.catConf], ['כלים חד-פעמיים וכלי הגשה', 0.75]);
    const un = A.cleanShelf(FX('shelf-unsure'), CTX).ai;
    assert.deepEqual([un.st, un.iss[0].warn], ['review', true], 'לא בטוח = לבדיקה, אזהרה בלבד');
    assert.deepEqual(A.cleanShelf(FX('shelf-clean'), CTX).ai, { st: 'ok', conf: 0.85, iss: [], cat: 'כוסות שקופות', catConf: 0.8 });
  });
  it('שבורה: shelf-broken – checkShelfResponse מוצא 8+ שגיאות, והשרת מסווג "שבורה" (נדחית, המכסה מוחזרת)', () => {
    const r = FX('shelf-broken');
    assert.ok(PS.checkShelfResponse(r).length >= 8);
    assert.equal(A.shelfBroken(r), true);
    assert.equal(A.shelfBroken(null), true);
    assert.equal(A.shelfBroken({ st: 'ok' }), true, 'בלי iss');
    assert.equal(A.shelfBroken({ st: 'person' }), false);
  });
  it('השרת מסנן גם תשובה תקינה במבנה: מחסן בלי מחירים (shelf-warehouse-prices), סוג לא מוכר, conf נמוך, pricepos, box חורג, מספר המלצות', () => {
    const w = FX('shelf-warehouse-prices');
    assert.equal(PS.checkShelfResponse(w).length, 0, 'כחנות – תקין');
    assert.deepEqual(PS.checkShelfResponse(w, { warehouse: true }), ['iss[0] בדיקת מחיר במחסן']);
    const wh = A.cleanShelf(w, { wh: true }).ai;
    assert.deepEqual([wh.st, wh.iss.map((i) => i.k)], ['issue', ['fallen']], 'noprice נמחק, fallen נשאר');
    assert.deepEqual(A.cleanShelf(w, {}).ai.iss.map((i) => i.k), ['noprice', 'fallen'], 'בחנות – נשאר');
    const mixed = A.cleanShelf({ st: 'issue', conf: 0.9, iss: [
      { k: 'dirty', sev: 2, conf: 0.9, t: 'x' }, { k: 'hole', sev: 7, conf: 0.4, t: 'אולי חור', box: [900, 900, 300, 300] },
      { k: 'pricepos', sev: 1, conf: 0.95, t: 'מחיר רחוק', warn: false }, { k: 'low', sev: 2, conf: 'גבוה', t: 'x' },
    ], recs: [{ t: 'א' }, { t: 'ב' }, { t: 'ג' }, { t: 'ד' }], prods: [{ n: 'כוסות 200', box: [1, 2, 3] }] }, { recN: 2 }).ai;
    assert.equal(mixed.st, 'review', 'אחרי הסינון אין בעיה ודאית');
    assert.deepEqual(mixed.iss.map((i) => [i.k, i.sev, i.warn]), [['hole', 3, true], ['pricepos', 1, true]]);
    assert.deepEqual(mixed.iss[0].box, [900, 900, 100, 100], 'box נחתך לתמונה');
    assert.equal(mixed.recs.length, 2);
    assert.deepEqual(mixed.prods, [{ n: 'כוסות 200', c: '' }]);
    assert.deepEqual(A.cleanShelf({ st: 'issue', conf: 1, iss: [], recs: [{ t: 'x' }] }, { recN: 0 }).ai, { st: 'ok', conf: 1, iss: [] }, 'recN 0');
    // קטגוריה ברשימה סגורה; אדם; תמונה לא קריאה; "לא המדף הזה"
    assert.equal(A.cleanShelf({ st: 'ok', conf: 1, iss: [], cat: 'משהו' }, { catMode: 'list', cats: ['מפיות'] }).ai.cat, undefined);
    assert.deepEqual(A.cleanShelf({ st: 'person' }, {}).ai, { st: 'person', conf: 1, iss: [] });
    assert.deepEqual(A.cleanShelf({ st: 'bad', t: 'מטושטש' }, {}).t, 'מטושטש');
    assert.equal(A.cleanShelf({ st: 'ok', conf: 1, iss: [], not_this_shelf: true }, {}).ask, true);
  });
  it('קישור לקטלוג: לפי "מה אמור להיות" או לפי שם זהה בקטלוג', () => {
    const exp = [{ n: 'כוסות קרטון 250 מ"ל', pid: 'p1' }];
    const catalog = new Map([[A.norm('מפיות לבנות'), 'p2']]);
    const ai = A.cleanShelf({ st: 'ok', conf: 1, iss: [], prods: [{ n: 'כוסות קרטון 250 מ״ל' }, { n: 'מפיות לבנות' }, { n: 'אחר' }], miss: [{ n: 'מפיות לבנות', why: 'exp' }, { n: 'x', why: 'zz' }] }, { exp, catalog }).ai;
    assert.deepEqual(ai.prods.map((p) => p.pid || ''), ['p1', 'p2', '']);
    assert.deepEqual(ai.miss, [{ n: 'מפיות לבנות', why: 'exp', pid: 'p2' }]);
  });
  it('s3sum: הגרוע מבין עליון/תחתון, מספר בעיות בלי אזהרות', () => {
    const e = A.sumEntry([{ st: 'ok', iss: [{ k: 'pricepos', warn: true }] }, { st: 'issue', iss: [{ k: 'hole' }, { k: 'low' }] }], 'r1_20261115', 7, 'a_t.jpg');
    assert.deepEqual(e, { s: 'iss', r: 'r1_20261115', t: 7, n: 2, th: 'a_t.jpg' });
    assert.equal(A.sumEntry([{ st: 'person', iss: [] }], 'x', 1, '', 'old.jpg').s, 'miss');
    assert.equal(A.sumEntry([{ st: 'person', iss: [] }], 'x', 1, '', 'old.jpg').th, 'old.jpg', 'אדם – נשארת המוקטנת הקודמת');
    assert.deepEqual(['ok', 'issue', 'review', 'bad', 'person'].map((st) => A.countsDone({ st })), [true, true, true, false, false]);
  });
});

describe('store3d-ai – טיוטת מפה (קובצי הדוגמה של שלב 6)', () => {
  const ctx = { br: 'main', kind: 's', numDir: 'rtl' };
  const passesSave = (map) => { const c = M.cleanMap(map, { bizId: 'biz-x', mapId: 's-main' }); M.finalCheck(M.mergeDel(null, c.map, { mgr: true, uid: 'u_mgr1', now: 1 }), null); return c; };
  it('mapdraft-ok: מבנה תקין → מפה במבנה 4.3 שעוברת את בדיקת השמירה; אזורים לא בטוחים ב-uz עם ok:false', () => {
    const r = FX('mapdraft-ok');
    assert.deepEqual(PM.checkMapDraftResponse(r), []);
    const d = A.cleanDraft(r, ctx);
    assert.equal(d.drop, 0);
    assert.deepEqual(d.map.rooms.map((x) => x.id), ['r1']);
    assert.deepEqual(d.map.fx.map((f) => [f.id, f.k, f.sides, f.hi, f.room, f.num]), [['f1', 'wall', 1, false, 'r1', 1], ['f2', 'gon', 2, true, 'r1', 2], ['f3', 'gon', 2, true, 'r1', 3], ['f4', 'wall', 1, false, 'r1', 4], ['f5', 'stand', 1, false, 'r1', 5]]);
    assert.equal(d.map.uz.length, 3);
    assert.ok(d.map.uz.every((u) => u.ok === false && u.txt));
    assert.deepEqual([d.map.src, d.map.seq, d.conf, d.scale.conf], ['draft', 5, 0.55, 0.35]);
    assert.deepEqual(passesSave(d.map).dropped, []);
  });
  it('mapdraft-unsure: כמעט הכל ב-uz – נשמר כטיוטה עם conf נמוך', () => {
    const r = FX('mapdraft-unsure');
    assert.deepEqual(PM.checkMapDraftResponse(r), []);
    const d = A.cleanDraft(r, ctx);
    assert.deepEqual([d.map.fx.length, d.map.uz.length, d.conf], [0, 1, 0.3]);
    passesSave(d.map);
  });
  it('mapdraft-broken: checkMapDraftResponse מוצא 10+ שגיאות, והשרת דוחה (אין חדר תקין)', () => {
    const r = FX('mapdraft-broken');
    assert.ok(PM.checkMapDraftResponse(r).length >= 10);
    assert.equal(code(() => A.cleanDraft(r, ctx)), 'bad-answer');
    assert.equal(code(() => A.cleanDraft(null, ctx)), 'bad-answer');
  });
  it('סינון פריטים: מספרים לא שלמים מעוגלים, סוג לא מוכר נשמט, מקרר דו-צדדי הופך לחד-צדדי, חדר לפי שם, דלת כניסה = ent', () => {
    const r = FX('mapdraft-ok');
    r.rooms.push({ name: 'מחסן', p: [800, 0, 1200, 0, 1200, 400, 800, 400] });
    r.fx.push({ k: 'shelf', x: 1, y: 1, w: 100, d: 50, h: 100, a: 0, sides: 1, bays: 1, lvl: 1, room: 'x' });
    r.fx.push({ k: 'fridge', x: 900.4, y: 200.6, w: 120, d: 70, h: 200, a: -90, sides: 2, bays: 2, lvl: 5, glass: true, room: 'מחסן' });
    r.doors = [{ x: 350, y: 1400, w: 120, a: 0, k: 'ent' }];
    const d = A.cleanDraft(r, ctx);
    assert.equal(d.drop, 1);
    const f = d.map.fx[d.map.fx.length - 1];
    assert.deepEqual([f.k, f.x, f.y, f.a, f.sides, f.room, f.glass], ['fridge', 900, 201, 270, 1, 'r2', true]);
    assert.equal(d.map.ent, 'd1');
    passesSave(d.map);
  });
});

describe('store3d-ai – טיוטת מפה: סיבת כשל, השמטה חלקית (תיקון 15.11.2026)', () => {
  const ectx = { br: 'main', kind: 's', numDir: 'rtl', bizId: 'biz-x', uid: 'u_mgr1', now: 1 };
  const cc = { bizId: 'biz-x', mapId: 's-main', uid: 'u_mgr1', now: 1 };
  it('evalDraft: לא JSON = parse; לא JSON עם MAX_TOKENS = cut; לא אובייקט = not-obj; בלי חדר = no-rooms; תקינה = d', () => {
    assert.deepEqual(A.evalDraft(null, 'STOP', ectx), { why: 'parse' });
    assert.deepEqual(A.evalDraft(null, 'MAX_TOKENS', ectx), { why: 'cut' });
    assert.deepEqual(A.evalDraft(null, '', ectx), { why: 'parse' });
    assert.equal(A.evalDraft(['a', 'b'], 'STOP', ectx).why, 'not-obj');
    assert.equal(A.evalDraft(FX('mapdraft-broken'), 'STOP', ectx).why, 'no-rooms');
    const v = A.evalDraft(FX('mapdraft-ok'), 'STOP', ectx);
    assert.deepEqual([v.why, v.d.drop, v.d.map.fx.length, v.fit], [undefined, 0, 5, 0]);
    // מודל שעטף את התשובה במערך של אובייקט אחד – מתקבל
    assert.equal(A.evalDraft([FX('mapdraft-ok')], 'STOP', ectx).d.map.rooms.length, 1);
  });
  it('draftMsg: הודעה בעברית לכל סיבה, ותמיד "לא נספרה במכסה"; סיבה לא מוכרת – נוסח כללי', () => {
    for (const w of Object.keys(A.DRAFT_WHY)) { const m = A.draftMsg(w); assert.match(m, /לא נספרה במכסה/); assert.match(m, /[\u0590-\u05FF]/); assert.doesNotMatch(m, /JSON|MAX_TOKENS|finish/i); }
    assert.match(A.draftMsg('cut'), /נקטעה/);
    assert.equal(A.draftMsg('zzz'), A.draftMsg('map'));
  });
  it('fitDraft: גופים וחדר שלא עוברים את בדיקת השמירה מושמטים (drop), גוף של חדר שהושמט עובר לחדר הראשון; התוצאה עוברת את draftCheck', () => {
    const d = A.cleanDraft(FX('mapdraft-ok'), ectx);
    const m = JSON.parse(JSON.stringify(d.map));
    // חדר עם קירות חוצים (נכשל ב-finalCheck), גוף לא תקין ל-cleanMap (sides 3), גוף תקין בחדר הפסול, ואזור עם txt ארוך מדי
    m.rooms.push({ id: 'r2', name: 'פסול', p: [0, 0, 500, 500, 500, 0, 0, 500], h: 300 });
    m.fx.push(Object.assign({}, m.fx[0], { id: 'f6', num: 6, sides: 3 }));
    m.fx.push(Object.assign({}, m.fx[0], { id: 'f7', num: 7, room: 'r2' }));
    m.uz.push({ x: 1, y: 1, w: 100, d: 100, txt: 'א'.repeat(81), ok: false });
    assert.throws(() => A.draftCheck(m, cc));
    const f = A.fitDraft(m, cc);
    assert.equal(f.drop, 3, 'חדר + גוף + אזור');
    assert.deepEqual(f.map.rooms.map((r) => r.id), ['r1']);
    assert.deepEqual(f.map.fx.map((x) => [x.id, x.num, x.room]), [1, 2, 3, 4, 5, 6].map((i) => ['f' + i, i, 'r1']), 'מספור מחדש, f7 עבר ל-r1');
    assert.deepEqual([f.map.seq, f.map.uz.length], [6, 3]);
    A.draftCheck(f.map, cc);
    // טיוטה תקינה – בלי שינוי
    const ok = A.fitDraft(d.map, cc);
    assert.deepEqual([ok.drop, ok.map === d.map], [0, true]);
  });
  it('fitDraft / evalDraft: כשלא נשאר אף חדר תקין – no-rooms (הטיוטה נדחית)', () => {
    const d = A.cleanDraft(FX('mapdraft-ok'), ectx);
    const m = Object.assign({}, d.map, { name: '' });   // שם המפה לא תקין – כל פריט נכשל
    assert.equal(code(() => A.fitDraft(m, cc)), 'no-rooms');
  });
});

// שאלון וסקיצה מבעל החנות (15.11.2026): בדיקת קלט, הנחיה, והתאמת הטיוטה למידות ולסקיצה
describe('store3d-draftin – שאלון וסקיצה לטיוטת מפה', () => {
  const DI = require(path.join(FN, 'lib', 'store3d-draftin.js'));
  const ectx = { br: 'main', kind: 's', numDir: 'rtl', bizId: 'biz-x', uid: 'u_mgr1', now: 1 };
  const cc = { bizId: 'biz-x', mapId: 's-main', uid: 'u_mgr1', now: 1 };
  const INFO = { w: 1400, l: 1500, rooms: 2, rows: 3, ent: 'd', cash: 'r', note: 'קופה ליד הכניסה' };
  const SK = { rooms: [[0, 0, 1400, 0, 1400, 1000, 0, 1000], [0, 1000, 1400, 1000, 1400, 1500, 0, 1500]], rows: [[600, 300, 600, 1100], [1100, 300, 1100, 900], [200, 1250, 1200, 1250]] };
  it('draftInput: בלי שדות (גרסה ישנה) = null; קלט תקין עובר; ריק = null', () => {
    assert.deepEqual(DI.draftInput({ qid: 'x' }), { info: null, sketch: null });
    assert.deepEqual(DI.draftInput({ info: null, sketch: null }), { info: null, sketch: null });
    const v = DI.draftInput({ info: INFO, sketch: SK });
    assert.deepEqual(v.info, INFO); assert.deepEqual(v.sketch, SK);
    assert.deepEqual(DI.draftInput({ info: { ent: '', note: '   ' } }), { info: null, sketch: null });
    assert.deepEqual(DI.draftInput({ info: { rows: 0 } }).info, { rows: 0 });
    assert.deepEqual(DI.draftInput({ info: { w: 1400, l: 1500 }, sketch: { rooms: [], rows: [] } }).sketch, null);
  });
  it('draftInput: זבל נדחה ב-bad-info (סוגים, טווחים, מפתחות זרים, מחוץ למידות, מצולע חוצה, גודל, סקיצה בלי מידות)', () => {
    const bad = (inp) => code(() => DI.draftInput(inp));
    for (const info of ['x', [1], { w: 150 }, { w: 10001 }, { l: 1500.5 }, { w: '1400' }, { rooms: 0 }, { rooms: 7 }, { rows: 31 }, { rows: -1 }, { ent: 'n' }, { cash: 3 }, { note: 'א'.repeat(201) }, { note: 5 }, { zz: 1 }, { __proto__x: 1 }])
      assert.equal(bad({ info }), 'bad-info', JSON.stringify(info));
    const I = { w: 1400, l: 1500 };
    for (const sketch of ['x', { rooms: 'x' }, { zz: [] }, { rooms: [[0, 0, 100, 0]] }, { rooms: [[0, 0, 1500, 0, 1500, 900, 0, 900]] }, { rooms: [[0, 0, 500, 500, 500, 0, 0, 500]] },
      { rooms: Array(7).fill([0, 0, 500, 0, 500, 500]) }, { rows: [[0, 0, 10, 10]] }, { rows: [[0, 0, 100]] }, { rows: [[0, 0, 100, 1600]] }, { rows: Array(31).fill([0, 0, 100, 0]) }, { rows: [[0, 0, 100.5, 0]] }])
      assert.equal(bad({ info: I, sketch }), 'bad-info', JSON.stringify(sketch).slice(0, 80));
    assert.equal(bad({ sketch: SK }), 'bad-info', 'סקיצה בלי מידות');
    assert.equal(bad({ info: { rooms: 2 }, sketch: SK }), 'bad-info', 'סקיצה בלי רוחב ואורך');
    assert.equal(bad({ info: I, sketch: { rows: Array(30).fill([0, 0, 1000, 1000]), rooms: Array(6).fill(Array(40).fill(1000)) } }), 'bad-info', 'מעל 4000 תווים');
    assert.equal(bad({ info: Object.assign({}, I, { note: 'x' }), sketch: { rows: [[0, 0, 0, 0]] } }), 'bad-info', 'שורה באורך 0');
  });
  it('buildMapDraftPrompt: בלי שאלון – זהה לגרסה הקודמת; עם שאלון – מידות, חדרים, שורות, כניסה וקופה כמחייבים; ההערה מנוקה', () => {
    const base = PM.buildMapDraftPrompt({ kind: 's', n: 3 });
    assert.equal(PM.buildMapDraftPrompt({ kind: 's', n: 3, info: null, sketch: null }), base);
    assert.doesNotMatch(base, /מבעל החנות/);
    const p = PM.buildMapDraftPrompt({ kind: 's', n: 3, info: Object.assign({}, INFO, { note: 'הערה "}{ עם\nשורה' }), sketch: SK });
    assert.ok(p.startsWith(PM.mapdraft), 'אותה התחלה (המודל המדומה מזהה לפיה)');
    assert.match(p, /מחייבים/); assert.match(p, /רוחב 14 מטר/); assert.match(p, /אורך 15 מטר/); assert.match(p, /בדיוק 2/);
    assert.match(p, /חדר 2: \[0,1000,1400,1000,1400,1500,0,1500\]/); assert.match(p, /\[200,1250,1200,1250\]/);
    assert.match(p, /הכניסה הראשית למטה/); assert.match(p, /הקופה בצד ימין/);
    assert.doesNotMatch(p.split('הערת בעל החנות')[1], /["{}\n]/);
    const q = PM.buildMapDraftPrompt({ kind: 's', info: { rows: 8, w: 2000, l: 1000 } });
    assert.match(q, /בערך 8/); assert.match(q, /רוחב 20 מטר/); assert.doesNotMatch(q, /הכניסה הראשית/);
  });
  it('evalDraft עם שאלון: הטיוטה נמתחת למידות, החדרים מהסקיצה, גופים מוצמדים לשורות, שורה בלי גוף = גונדולה + uz; עוברת draftCheck', () => {
    const plain = A.evalDraft(FX('mapdraft-ok'), 'STOP', ectx).d;
    const v = A.evalDraft(FX('mapdraft-ok'), 'STOP', Object.assign({}, ectx, { info: INFO, sketch: SK }));
    assert.ok(v.d, JSON.stringify(v));
    const m = v.d.map;
    assert.deepEqual(m.rooms.map((r) => r.p), SK.rooms);
    assert.deepEqual(m.rooms.map((r) => r.id), ['r1', 'r2']);
    assert.equal(m.walls.length, 0);
    assert.deepEqual([v.d.snap, v.d.add], [2, 1]);
    const g = m.fx.find((f) => f.name === 'גונדולה מרכזית');
    assert.deepEqual([g.x, g.y, g.w, g.a % 180], [600, 700, 800, 90]);
    const added = m.fx[m.fx.length - 1];
    assert.deepEqual([added.k, added.sides, added.x, added.y, added.w, added.bays, added.room], ['gon', 2, 700, 1250, 1000, 10, 'r2']);
    assert.equal(m.fx.length, plain.map.fx.length + 1);
    assert.deepEqual(m.fx.map((f) => f.num), m.fx.map((f, i) => i + 1));
    assert.equal(m.seq, m.fx.length);
    assert.match(m.uz[m.uz.length - 1].txt, /שורה מהשרטוט/);
    for (const f of m.fx) assert.ok(f.x >= 0 && f.x <= 1400 && f.y >= 0 && f.y <= 1500, f.id);
    A.draftCheck(m, cc);
  });
  it('שאלות ההמשך על הסקיצה: סוג חדר, סוג שורה, נקודת כניסה וקופה – נבדקים, נכנסים להנחיה וגוברים בטיוטה', () => {
    const sk = Object.assign({}, SK, { rt: ['s', 'w'], rk: ['gon', 'gon', 'fridge'], ent: [700, 1500], cash: [1200, 1400] });
    const v = DI.draftInput({ info: { w: 1400, l: 1500 }, sketch: sk });
    assert.deepEqual(v.sketch, sk);
    const I = { w: 1400, l: 1500 }, bad = (x) => code(() => DI.draftInput({ info: I, sketch: Object.assign({}, SK, x) }));
    for (const x of [{ rt: ['s'] }, { rt: ['s', 'q'] }, { rk: ['gon', 'gon'] }, { rk: ['gon', 'gon', 'bin'] }, { ent: [1, 2, 3] }, { ent: [1500, 0] }, { cash: ['1', 2] }, { rt: 's' }]) assert.equal(bad(x), 'bad-info', JSON.stringify(x));
    assert.deepEqual(DI.draftInput({ info: I, sketch: { ent: [0, 0] } }).sketch, { rooms: [], rows: [], ent: [0, 0] }, 'רק כניסה');
    const p = PM.buildMapDraftPrompt({ kind: 's', info: I, sketch: sk });
    assert.match(p, /חדר 2 \(מחסן\)/); assert.match(p, /\[200,1250,1200,1250\] fridge/); assert.match(p, /הכניסה הראשית בנקודה \(700,1500\)/); assert.match(p, /הקופה בנקודה \(1200,1400\)/);
    const m = A.evalDraft(FX('mapdraft-ok'), 'STOP', Object.assign({}, ectx, { info: I, sketch: sk })).d.map;
    assert.deepEqual(m.rooms.map((r) => r.name), ['אולם מכירות', 'מחסן']);
    const fr = m.fx[m.fx.length - 1];
    assert.deepEqual([fr.k, fr.sides, fr.glass, fr.d], ['fridge', 1, true, 80]);
    assert.deepEqual(m.syms.filter((y) => y.k === 'ent').map((y) => [y.x, y.y]), [[700, 1500]]);
    assert.deepEqual(m.syms.filter((y) => y.k === 'cash').map((y) => [y.x, y.y]), [[1200, 1400]]);
    A.draftCheck(m, cc);
    // שורה שה-AI זיהה כגונדולה ובעל החנות אמר "מדף קיר" – הופכת למדף קיר חד-צדדי
    const m2 = A.evalDraft(FX('mapdraft-ok'), 'STOP', Object.assign({}, ectx, { info: I, sketch: Object.assign({}, SK, { rk: ['wall', 'gon', 'gon'] }) })).d.map;
    const g = m2.fx.find((f) => f.name === 'גונדולה מרכזית');
    assert.deepEqual([g.k, g.sides], ['wall', 1]);
    A.draftCheck(m2, cc);
  });
  it('shapeDraft: רק מידות (בלי סקיצה) – החדרים ממלאים בדיוק את המלבן; הטיוטה המקורית לא משתנה', () => {
    const d = A.cleanDraft(FX('mapdraft-ok'), ectx), before = JSON.stringify(d.map);
    const s = DI.shapeDraft(d.map, { w: 2100, l: 700 }, null);
    assert.equal(JSON.stringify(d.map), before);
    assert.deepEqual(s.map.rooms[0].p, [0, 0, 2100, 0, 2100, 700, 0, 700]);
    const wl = s.map.fx.find((f) => f.name === 'קיר אחורי');   // a=0 – האורך לאורך x, פי 3
    assert.deepEqual([wl.x, wl.y, wl.w, wl.d], [1050, 15, 1800, 40]);
    A.draftCheck(s.map, cc);
    const v = A.evalDraft(FX('mapdraft-ok'), 'STOP', Object.assign({}, ectx, { info: { rows: 3 } }));
    assert.deepEqual(v.d.map.rooms[0].p, [0, 0, 700, 0, 700, 1400, 0, 1400], 'בלי מידות – בלי מתיחה');
  });
});
