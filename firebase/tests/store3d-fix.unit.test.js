'use strict';
// סריקת חנות בתלת מימד – שלב 20ג, חלק השרת (15.11.2026): בדיקות יחידה ל-lib/store3d-fix.js (mapFix), בלי אמולטור ובלי רשת.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const FN = path.join(__dirname, '..', 'functions');
const F = require(path.join(FN, 'lib', 'store3d-fix.js'));
const A = require(path.join(FN, 'lib', 'store3d-ai.js'));

const FXJ = (n) => { const o = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'store3d-' + n + '.json'), 'utf8')); delete o._example; delete o._meta; return o; };
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'OK'; };
const CTX = { br: 'main', kind: 's', numDir: 'rtl', bizId: 'biz-x', uid: 'u1', now: 1763200000000 };
const draft = () => A.evalDraft(FXJ('mapdraft-ok'), 'STOP', CTX).d.map;
const inp = (o) => Object.assign({ qid: 'qabcdefgh-000000000001', br: 'main', kind: 's', txt: 'המקררים על הקיר השמאלי', m: draft() }, o);

describe('store3d-fix – קלט', () => {
  it('fixInput: תקין עובר; טקסט מנוקה מתווי בקרה; שדות חסרים / לא תקינים נדחים', () => {
    const x = F.fixInput(inp({ txt: '  המקררים\n\tעל הקיר   השמאלי ' }));
    assert.equal(x.txt, 'המקררים על הקיר השמאלי');
    assert.deepEqual([x.sk, x.from], [null, null]);
    assert.equal(code(() => F.fixInput(null)), 'bad-input');
    assert.equal(code(() => F.fixInput(inp({ qid: 'x' }))), 'bad-qid');
    assert.equal(code(() => F.fixInput(inp({ br: 'A B' }))), 'bad-br');
    assert.equal(code(() => F.fixInput(inp({ kind: 'x' }))), 'bad-kind');
    assert.equal(code(() => F.fixInput(inp({ txt: undefined }))), 'bad-txt');
    assert.equal(code(() => F.fixInput(inp({ txt: ' א ' }))), 'bad-txt', 'תו אחד');
    assert.equal(code(() => F.fixInput(inp({ txt: 'א'.repeat(1001) }))), 'bad-txt');
    assert.equal(F.fixInput(inp({ txt: 'א'.repeat(1000) })).txt.length, 1000);
    assert.equal(code(() => F.fixInput(inp({ m: [] }))), 'bad-map');
    assert.equal(code(() => F.fixInput(inp({ m: { rooms: [], pad: 'x'.repeat(800001) } }))), 'too-big');
  });

  it('fixInput: סקיצה (sk) – כל JSON עד 50KB, בלי מבנה קבוע; from – מזהה טיוטה', () => {
    assert.equal(F.fixInput(inp({ sk: { lines: [[0, 0, 100, 0]], any: 'x' } })).sk, '{"lines":[[0,0,100,0]],"any":"x"}');
    assert.equal(F.fixInput(inp({ sk: [1, 2] })).sk, '[1,2]');
    assert.equal(code(() => F.fixInput(inp({ sk: 'טקסט' }))), 'bad-sk');
    assert.equal(code(() => F.fixInput(inp({ sk: { a: 'x'.repeat(50001) } }))), 'bad-sk');
    assert.equal(F.fixInput(inp({ from: 'qprev0000-000000000001' })).from, 'qprev0000-000000000001');
    assert.equal(code(() => F.fixInput(inp({ from: 'bad id' }))), 'bad-from');
  });

  it('userDayStep: +1 לבלם היומי; יום חדש מתחיל מ-0; מעל התקרה – s3-user-day', () => {
    assert.deepEqual(F.userDayStep(null, '2026-11-15', 5, 400), { d: '2026-11-15', n: 1, upd: 5 });
    assert.deepEqual(F.userDayStep({ d: '2026-11-14', n: 400 }, '2026-11-15', 5, 400).n, 1);
    assert.equal(F.userDayStep({ d: '2026-11-15', n: 399 }, '2026-11-15', 5, 400).n, 400);
    assert.equal(code(() => F.userDayStep({ d: '2026-11-15', n: 400 }, '2026-11-15', 5, 400)), 's3-user-day');
  });
});

describe('store3d-fix – המרה והנחיה', () => {
  it('toModel: הטיוטה ← מבנה התשובה של המודל; חזרה דרך evalDraft נותנת את אותה מפה (בלי שינוי = בלי שינוי)', () => {
    const m = draft();
    const cur = F.toModel(m);
    assert.ok(cur.fx.every((f) => f.room === 'אולם מכירות' && !('id' in f) && !('num' in f)));
    const back = A.evalDraft(Object.assign({ conf: 0.5, scale: { ref: '', conf: 0 } }, cur), 'STOP', CTX);
    assert.equal(back.why, undefined);
    assert.deepEqual(back.d.map, m);
    assert.equal(back.d.drop, 0);
  });

  it('toModel: פריטים מחוקים (del) לא נשלחים; שמות חדרים כפולים מקבלים מספר, וכל גוף נשאר בחדר שלו', () => {
    const m = draft();
    m.rooms = [m.rooms[0], { id: 'r2', name: m.rooms[0].name, p: [800, 0, 1200, 0, 1200, 400, 800, 400], h: 300 }];
    m.fx = m.fx.slice(0, 2).concat([Object.assign({}, m.fx[0], { id: 'f9', room: 'r2', x: 1000, y: 200, w: 200, a: 0 }), Object.assign({}, m.fx[1], { id: 'f8', del: 1, delAt: 1, delBy: 'u1' })]);
    const cur = F.toModel(m);
    assert.deepEqual(cur.rooms.map((r) => r.name), ['אולם מכירות', 'אולם מכירות 2']);
    assert.equal(cur.fx.length, 3, 'המחוק לא נשלח');
    assert.equal(cur.fx[2].room, 'אולם מכירות 2');
  });

  it('buildFixPrompt: מתחילה בזיהוי הקבוע; הטיוטה, הטקסט (כ-JSON, כולל מרכאות) והסקיצה בפנים; בלי סקיצה – בלי השורה', () => {
    const cur = F.toModel(draft());
    const txt = 'הזיזו את "המקררים" לקיר השמאלי';
    const p = F.buildFixPrompt({ kind: 's', storeType: 'כלים חד-פעמיים', cur, txt, sk: '{"a":1}' });
    assert.ok(p.startsWith('אתה מקבל טיוטת מפה של חנות'));
    assert.ok(p.includes(JSON.stringify(cur)));
    assert.ok(p.endsWith(JSON.stringify(txt)));
    assert.match(p, /סקיצה שהמשתמש שרטט/);
    assert.match(p, /סוג החנות: "כלים חד-פעמיים"/);
    const p2 = F.buildFixPrompt({ kind: 'w', cur, txt: 'אבג' });
    assert.doesNotMatch(p2, /סקיצה שהמשתמש/);
    assert.match(p2, /זה מחסן/);
  });

  it('fixMsg: הודעה לכל סיבה, עם "הטיוטה הקודמת נשארה", בלי משפט על מכסה', () => {
    for (const w of ['cut', 'parse', 'not-obj', 'no-rooms', 'map', 'too-big', 'אחר']) {
      assert.match(F.fixMsg(w), /הטיוטה הקודמת נשארה בלי שינוי/);
      assert.doesNotMatch(F.fixMsg(w), /מכסה/);
    }
  });
});
