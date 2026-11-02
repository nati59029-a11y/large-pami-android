'use strict';
// "לא שוברים את הקיים": כל פעולה של האפליקציה מול Firestore (app-operations.json) משוחזרת כאן
// בדיוק כפי שהיא בקוד – אותה כתובת REST, אותה שיטה (GET/POST/PATCH/DELETE), אותם שדות ואותם תנאי שאילתה.
// התפקיד שמבצע אותה באפליקציה חייב להצליח. מחובר שאינו ב-staff ועובד מושבת חייבים להיחסם (403).

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const ops = require('./app-operations.json');
const H = require('./helpers');
const { fsx, sv } = H;

let seq = 0;
const fresh = (p) => `${p}${Date.now()}x${++seq}`;
const now = () => new Date().toISOString();
const bypass = (env, fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const iv = (v) => ({ integerValue: String(Math.round(+v || 0)) });
const TKF = ['owner', 'by', 'role', 'txt', 'cr', 'due', 'st', 'open', 'pr', 'sub', 'doneBy', 'note', 'ok', 'late', 'cAt', 'cBy', 'nc', 'rt'];
const TKSF = ['cr', 'due', 'st', 'sub', 'late', 'doneBy']; // סיכום המשימות באפליקציה
// tkQ(where) באפליקציה
const tkRunQ = (uid, where) => {
  const sq = { from: [{ collectionId: 'tasks' }], select: { fields: TKF.map((f) => ({ fieldPath: f })) }, limit: 1000 };
  if (where) sq.where = { fieldFilter: { field: { fieldPath: where }, op: 'EQUAL', value: { stringValue: '1' } } };
  return fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: sq }) });
};
// tkPatch(id, o) באפליקציה
const tkPatch = (uid, id, o) => {
  const fields = {}; const mask = [];
  for (const k in o) { fields[k] = typeof o[k] === 'number' ? iv(o[k]) : sv(o[k]); mask.push('updateMask.fieldPaths=' + k); }
  return fsx(uid, '/tasks/' + id + '?' + mask.join('&') + '&currentDocument.exists=true', { method: 'PATCH', body: JSON.stringify({ fields }) });
};

// FRM.zcSend: שדות הסגירה כמו באפליקציה (data = JSON של שדות הטופס)
const zcFields = (uid, role, np) => ({ uid: sv(uid), by: sv(uid), t: iv(Date.now()), st: sv(role === 'manager' || role === 'managerAdminsOnly' ? 'ok' : 'new'), np: iv(np), reg: sv('i_yh'), d: sv('2026-10-20'), no: sv('777'),
  data: sv(JSON.stringify({ v: 1, f: { d: '2026-10-20', tm: '09:02', no: '777', credit: '4313.95', cash: '3260', vissue: '-169.8', round: '-0.02', total: '7404.15', drawer: '1564', oD: '2026-10-20', oTot: '1560' }, rs: 'auto', ack: 1, why: '', ai: { z: 1, o: 1 } })) });
// ---- שלב 2: הוצאות מקופה והפקדות – כמו באפליקציה ----
const dv = (v) => ({ doubleValue: +v });
const docName = (p) => 'projects/' + H.PROJECT_ID + '/databases/(default)/documents/' + p;
const coEq = (k, v) => ({ fieldFilter: { field: { fieldPath: k }, op: 'EQUAL', value: { stringValue: v } } });
const coRunQ = (uid, where, limit) => fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'cashout' }], where, limit } }) });
// coPush / coSync: השדות של המראה
const coFields = (uid, src, o) => { o = Object.assign({ why: 'קניתי חלב', dep: '', zc: '', dp: '' }, o);
  return { uid: sv(uid), by: sv(uid), t: iv(Date.now()), reg: sv('i_yh'), d: sv('2026-10-20'), a: dv(120), why: sv(o.why), dep: sv(o.dep), src: sv(src), zc: sv(o.zc), dp: sv(o.dp) }; };
const dpResetW = (c) => ({ update: { name: docName('cashout/' + c), fields: { dp: sv('') } }, updateMask: { fieldPaths: ['dp'] }, currentDocument: { exists: true } });
// FRM.dpSend: commit אחד – ההפקדה (exists=false) וסימון dp בכל הוצאה (mask dp, exists=true)
const depCommit = (uid, id, items, np) => {
  const fields = { uid: sv(uid), by: sv(uid), t: iv(Date.now()), d: sv('2026-10-21'), items: { arrayValue: { values: items.map(sv) } }, a: dv(1000), st: sv('new'), why: sv(''), np: iv(np || 1) };
  const writes = [{ update: { name: docName('deposits/' + id), fields }, currentDocument: { exists: false } }]
    .concat(items.map((c) => ({ update: { name: docName('cashout/' + c), fields: { dp: sv(id) } }, updateMask: { fieldPaths: ['dp'] }, currentDocument: { exists: true } })));
  return fsx(uid, ':commit', { method: 'POST', body: JSON.stringify({ writes }) });
};
// כל פונקציה מחזירה רשימת תשובות (status). A = הסטטוסים שנחשבים "הצליח" לתפקיד מורשה.
const REPLAY = {
  // syLogin: GET /admins/{uid}. מנהל – 200; עובד – 404 (אין מסמך), והאפליקציה מסיקה "עובד".
  M01: { allowed: (role) => (role === 'manager' || role === 'managerAdminsOnly' ? [200] : [404]),
    run: async (uid) => [await fsx(uid, '/admins/' + uid)] },

  // pushItem: חלקי הצילום ל-chunks
  M02: { run: async (uid) => {
    const id = fresh('w'); const file = 'data:image/jpeg;base64,AAAA';
    return [await fsx(uid, '/chunks?documentId=' + encodeURIComponent(id + '_0'), { method: 'POST', body: JSON.stringify({ fields: { owner: sv(uid), data: sv(file.slice(0, 700000)) } }) })];
  } },

  // pushItem: ההוצאה עצמה ל-inbox, אחרי החלקים
  M03: { run: async (uid) => {
    const id = fresh('w');
    const c = await fsx(uid, '/chunks?documentId=' + encodeURIComponent(id + '_0'), { method: 'POST', body: JSON.stringify({ fields: { owner: sv(uid), data: sv('AAAA') } }) });
    const body = { fields: { owner: sv(uid), by: sv(uid), status: sv('new'), created: sv(now()), data: sv(JSON.stringify({ amt: '10', cat: 'c1' })), parts: sv(1) } };
    const i = await fsx(uid, '/inbox?documentId=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(body) });
    return [c, i];
  } },

  // pubCfg: PATCH /cfg/main בלי updateMask – פעם ראשונה (אין מסמך) ופעם שנייה (יש)
  M04: { run: async (uid, env) => {
    await bypass(env, (db) => db.doc('cfg/main').delete());
    const body = () => JSON.stringify({ fields: { data: sv(JSON.stringify({ cats: [{ id: 'c1', name: 'ספקים', beh: 'sup', subs: [] }], gk: '', th: 'paper', at: now() })) } });
    const a = await fsx(uid, '/cfg/main', { method: 'PATCH', body: body() });
    const b = await fsx(uid, '/cfg/main', { method: 'PATCH', body: body() });
    return [a, b];
  } },

  // getCfg
  M05: { run: async (uid) => [await fsx(uid, '/cfg/main')] },

  // runQ('owner', SY.uid) – "ההוצאות ששלחתי"
  M06: { run: async (uid) => {
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'inbox' }], where: { fieldFilter: { field: { fieldPath: 'owner' }, op: 'EQUAL', value: { stringValue: uid } } }, limit: 300 } }) });
    if (r.status === 200) {
      const docs = (r.json || []).filter((x) => x.document);
      assert.ok(docs.length >= 1, 'העובד צריך לראות לפחות את ההוצאה שלו');
      assert.ok(docs.every((x) => x.document.fields.owner.stringValue === uid), 'חזרו הוצאות של מישהו אחר');
    }
    return [r];
  } },

  // runQ('status', 'new') – המנהל מושך הוצאות חדשות
  M07: { run: async (uid) => {
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'inbox' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'new' } } }, limit: 300 } }) });
    if (r.status === 200) assert.ok((r.json || []).filter((x) => x.document).length >= 5, 'המנהל צריך לקבל את כל ההוצאות החדשות');
    return [r];
  } },

  M08: { run: async (uid) => [await fsx(uid, '/chunks/' + `c_${H.OTHER}` + '_' + 0)] },
  M09: { run: async (uid) => [await fsx(uid, '/chunks/' + `c_${H.OTHER}` + '_' + 0, { method: 'DELETE' })] },
  M10: { run: async (uid) => [await fsx(uid, '/inbox/' + `i_${H.OTHER}` + '?updateMask.fieldPaths=status', { method: 'PATCH', body: JSON.stringify({ fields: { status: sv('imported') } }) })] },

  // shPush: PATCH /shelf/{k} – מסמך חדש ומסמך קיים
  M11: { run: async (uid) => {
    const SHK = ['price', 'p8', 'p2', 'p1', 'imp']; const out = [];
    for (const k of SHK) out.push(await fsx(uid, '/shelf/' + k, { method: 'PATCH', body: JSON.stringify({ fields: { data: sv(JSON.stringify({ items: [], next: 0, at: Date.now() })), at: sv(Date.now()) } }) }));
    return out;
  } },
  // shSync: GET /shelf/{k} – מסמך קיים (200) ומסמך שעוד לא נוצר (404, והאפליקציה מדלגת)
  M12: { allowed: () => [200, 404], run: async (uid) => [await fsx(uid, '/shelf/price'), await fsx(uid, '/shelf/p1')],
    check: (role, res) => { if (res[0].status !== 403) assert.equal(res[0].status, 200); } },
  M13: { run: async (uid) => {
    const put = () => fsx(uid, '/shelf/bc', { method: 'PATCH', body: JSON.stringify({ fields: { data: sv(JSON.stringify({ '7290000000001': { n: 'מוצר', d: '', t: Date.now() } })), at: sv(Date.now()) } }) });
    return [await put(), await put()];
  } },
  M14: { allowed: () => [200, 404], run: async (uid, env) => {
    const missing = await fsx(uid, '/shelf/bc');
    await bypass(env, (db) => db.doc('shelf/bc').set({ data: '{}', at: '1' }));
    const present = await fsx(uid, '/shelf/bc');
    return [missing, present];
  }, check: (role, res) => { if (res[1].status !== 403) assert.equal(res[1].status, 200); } },

  // fbPush (r.upd) – מנהל מאשר משוב שעובד שלח
  M15: { run: async (uid) => [await fsx(uid, '/fb/fb_new?updateMask.fieldPaths=data&updateMask.fieldPaths=st', { method: 'PATCH', body: JSON.stringify({ fields: { data: sv('{"f":{}}'), st: sv('ok') } }) })] },
  // fbPush – עובד שולח משוב חדש (st: 'new'), רק כמסמך חדש (currentDocument.exists=false).
  // ניסיון חוזר על אותו דף (התשובה הראשונה אבדה): 409 = "כבר נשלח" – האפליקציה מחשיבה אותו כהצלחה, ולא 403.
  M16: { allowed: () => [200, 409], run: async (uid) => {
    const id = fresh('fb');
    const body = () => JSON.stringify({ fields: { data: sv('{"f":{},"by":"dani","at":1,"hi":1,"man":0,"hp":0,"wq":0}'), img: sv('data:image/jpeg;base64,AAAA'), owner: sv(uid), at: sv(Date.now()), st: sv('new') } });
    const p = '/fb/' + id + '?currentDocument.exists=false';
    return [await fsx(uid, p, { method: 'PATCH', body: body() }), await fsx(uid, p, { method: 'PATCH', body: body() })];
  }, check: (role, res) => { assert.equal(res[0].status, 200, 'שליחה ראשונה'); assert.equal(res[1].status, 409, 'ניסיון חוזר: צריך 409 (כבר קיים), לא 403'); } },
  // fbWSent – עובד בודק שהוא עדיין פעיל (אחרי 403 בשליחה)
  M49: { run: async (uid) => [await fsx(uid, '/staff/' + uid)] },
  // fbPush – חלק צילום שכבר הועלה: העובד קורא את החלק של עצמו
  M50: { run: async (uid) => {
    const id = 'fbhi_' + fresh('fb') + '_0';
    const c = await fsx(uid, '/chunks?documentId=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ fields: { owner: sv(uid), data: sv('AAAA') } }) });
    return [c, await fsx(uid, '/chunks/' + id)];
  } },
  // fbPush – מנהל שומר משוב מאושר (st: 'ok'), פעם ראשונה ופעם שנייה
  M17: { run: async (uid) => {
    const id = fresh('fb');
    const body = () => JSON.stringify({ fields: { data: sv('{"f":{}}'), img: sv(''), owner: sv(uid), at: sv(Date.now()), st: sv('ok') } });
    return [await fsx(uid, '/fb/' + id, { method: 'PATCH', body: body() }), await fsx(uid, '/fb/' + id, { method: 'PATCH', body: body() })];
  } },
  // fbLoad – עובד: רק משוב מאושר
  M18: { run: async (uid) => {
    const sq = { from: [{ collectionId: 'fb' }], select: { fields: [{ fieldPath: 'data' }, { fieldPath: 'st' }] }, limit: 3000 };
    sq.where = { fieldFilter: { field: { fieldPath: 'st' }, op: 'EQUAL', value: { stringValue: 'ok' } } };
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: sq }) });
    if (r.status === 200) assert.ok((r.json || []).filter((x) => x.document).length >= 1);
    return [r];
  } },
  // fbLoad – מנהל: הכול
  M19: { run: async (uid) => {
    const sq = { from: [{ collectionId: 'fb' }], select: { fields: [{ fieldPath: 'data' }, { fieldPath: 'st' }] }, limit: 3000 };
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: sq }) });
    if (r.status === 200) assert.ok((r.json || []).filter((x) => x.document).length >= 2);
    return [r];
  } },
  // fbInbox
  M20: { run: async (uid) => [await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'fb' }], where: { fieldFilter: { field: { fieldPath: 'st' }, op: 'EQUAL', value: { stringValue: 'new' } } }, select: { fields: [{ fieldPath: 'data' }] }, limit: 300 } }) })] },
  M21: { run: async (uid) => [await fsx(uid, '/fb/fb_new')] },
  // fbImg – עובד: משוב מאושר; מנהל: כל משוב
  M22: { run: async (uid, env, role) => [await fsx(uid, role === 'employee' ? '/fb/fb_ok' : '/fb/fb_new')] },
  M23: { run: async (uid) => [await fsx(uid, '/fb/fb_new', { method: 'DELETE' })] },
  M24: { run: async (uid) => [await fsx(uid, '/fb/fb_ok?updateMask.fieldPaths=data', { method: 'PATCH', body: JSON.stringify({ fields: { data: sv('{"f":{"name":"x"}}') } }) })] },
  M25: { run: async (uid) => [await fsx(uid, '/fb/fb_ok', { method: 'DELETE' })] },
  // bkNames() / bkNames('fb')
  M26: { run: async (uid) => [await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'bk' }], select: { fields: [{ fieldPath: '__name__' }] }, limit: 20000 } }) })] },
  M27: { run: async (uid) => [await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'fb' }], select: { fields: [{ fieldPath: '__name__' }] }, limit: 20000 } }) })] },
  // bkPut – מסמך חדש ומסמך קיים
  M28: { run: async (uid) => {
    const put = (id, data) => fsx(uid, '/bk/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ fields: { data: sv(data), owner: sv(uid) } }) });
    return [await put('da_0', '{"app":"large-pami"}'), await put('meta', JSON.stringify({ date: now(), gen: 'a', np: 1, files: {}, counts: {} }))];
  } },
  M29: { run: async (uid) => [await fsx(uid, '/bk/' + encodeURIComponent('meta'), { method: 'DELETE' })] },
  M36: { run: async (uid) => [await fsx(uid, '/staff/' + uid)] },
  M30: { run: async (uid) => [await fsx(uid, '/bk/meta')] },
  M31: { run: async (uid, env) => { await bypass(env, (db) => db.doc('bk/da_0').set({ data: '{}', owner: 'u_mgr' })); return [await fsx(uid, '/bk/d' + 'a' + '_' + 0)]; } },
  // fbPush (חדש ב-feature/feedback-scan): עובד מעלה צילום משוב ברזולוציה גבוהה ל-chunks, בחלקים
  M33: { run: async (uid) => {
    const id = fresh('fb'); const out = [];
    for (let k = 0; k < 2; k++) out.push(await fsx(uid, '/chunks?documentId=' + encodeURIComponent('fbhi_' + id + '_' + k), { method: 'POST', body: JSON.stringify({ fields: { owner: sv(uid), data: sv('AAAA') } }) }));
    return out;
  } },
  // fbInbox: המנהל קורא את החלקים, ואחר כך מוחק אותם
  M34: { run: async (uid, env) => { await bypass(env, (db) => db.doc('chunks/fbhi_fb_new_0').set({ owner: H.OTHER, data: 'AAAA' })); return [await fsx(uid, '/chunks/fbhi_' + 'fb_new' + '_' + 0)]; } },
  M35: { run: async (uid, env) => { await bypass(env, (db) => db.doc('chunks/fbhi_fb_new_0').set({ owner: H.OTHER, data: 'AAAA' })); return [await fsx(uid, '/chunks/fbhi_' + 'fb_new' + '_' + 0, { method: 'DELETE' })]; } },
  M32: { run: async (uid, env) => { await bypass(env, (db) => db.doc('bk/f_x_0').set({ data: 'AAAA', owner: 'u_mgr' })); return [await fsx(uid, '/bk/' + 'f_x' + '_' + 0)]; } },

  // ---- משימות ותגובות (www/index.html, מודול המשימות) ----
  // tkQ('open') + tkQ('late') – עובד
  M37: { run: async (uid) => {
    const out = [];
    for (const w of ['open', 'late']) {
      const r = await tkRunQ(uid, w);
      if (r.status === 200) {
        const ids = (r.json || []).filter((x) => x.document).map((x) => x.document.name.split('/').pop());
        assert.ok(ids.length >= 1, 'העובד צריך לראות משימות (' + w + ')');
        assert.ok(!ids.includes('t_done'), 'עובד קיבל משימה שבוצעה בזמן');
      }
      out.push(r);
    }
    return out;
  } },
  // tkQ() – מנהל, כל המשימות
  M38: { run: async (uid) => {
    const r = await tkRunQ(uid, '');
    if (r.status === 200) assert.ok((r.json || []).some((x) => x.document && x.document.name.endsWith('/t_done')), 'המנהל צריך לראות גם משימות שבוצעו');
    return [r];
  } },
  // ACT.tkDone: סימון בוצע (משימה שלא נדרשת בה תמונה)
  M39: { run: async (uid) => { const n = Date.now(); return [await tkPatch(uid, 't_open', { st: 'done', open: '', sub: n, ok: n, doneBy: uid, late: '' })]; } },
  // CHG.tkimg: צירוף תמונה למשימה שנדרשת בה תמונה
  M40: { run: async (uid) => [await tkPatch(uid, 't_pr', { st: 'wait', img: 'data:image/jpeg;base64,' + 'A'.repeat(500), sub: Date.now(), doneBy: uid })] },
  // מנהל: בקשת תמונה, אישור, דחייה
  M41: { run: async (uid) => [
    await tkPatch(uid, 't_open', { pr: '1' }),
    await tkPatch(uid, 't_wait', { st: 'done', open: '', ok: Date.now(), late: '', note: '' }),
    await tkPatch(uid, 't_pr', { st: 'open', img: '', sub: 0, doneBy: '', note: 'לא ברור' }),
  ] },
  // FRM.tkCm: סימון "תגובה חדשה" על המשימה
  M42: { run: async (uid) => [await tkPatch(uid, 't_open', { cAt: Date.now(), cBy: uid })] },
  // FRM.tkAdd: משימה חדשה, בדיוק השדות של האפליקציה
  M43: { run: async (uid, env, role) => {
    const now = Date.now(); const adm = role === 'manager' || role === 'managerAdminsOnly';
    const fields = { owner: sv(uid), by: sv(uid), role: sv(adm ? 'a' : 'w'), txt: sv('לנקות את המחסן'), cr: iv(now), due: iv(now + 4 * 86400000), st: sv('open'), open: sv('1'),
      pr: sv(adm ? '1' : ''), img: sv(''), sub: iv(0), doneBy: sv(''), note: sv(''), ok: iv(0), late: sv('') };
    return [await fsx(uid, '/tasks?documentId=' + encodeURIComponent(fresh('t')), { method: 'POST', body: JSON.stringify({ fields }) })];
  } },
  M44: { run: async (uid) => [await fsx(uid, '/tasks/' + 't_open', { method: 'DELETE' })] },
  M45: { run: async (uid) => [await fsx(uid, '/tasks/' + 't_wait')] },
  // tkCmLoad: שרשור התגובות
  M46: { run: async (uid) => {
    const r = await fsx(uid, '/tasks/' + 't_open' + '/c?pageSize=300');
    if (r.status === 200) assert.ok(((r.json && r.json.documents) || []).length >= 1, 'השרשור צריך לכלול את התגובה הקיימת');
    return [r];
  } },
  // FRM.tkCm: תגובה חדשה. עובד – קודם tkPatch({nc:'1'}) (M61), כמו באפליקציה; מנהל – בלי
  M47: { run: async (uid, env, role) => {
    const out = [];
    if (role === 'employee' || role === 'signedIn' || role === 'disabledEmployee') out.push(await tkPatch(uid, 't_open', { nc: '1' }));
    const fields = { uid: sv(uid), by: sv(uid), txt: sv('סיימתי חצי'), t: iv(Date.now()) };
    out.push(await fsx(uid, '/tasks/' + 't_open' + '/c?documentId=' + encodeURIComponent(fresh('c')), { method: 'POST', body: JSON.stringify({ fields }) }));
    return out;
  } },
  M48: { run: async (uid) => [await fsx(uid, '/tasks/' + 't_open' + '/c/' + 'c1', { method: 'DELETE' })] },
  // tkSumLoad – עובד: משימות שהוא ביצע (where doneBy IN [fbBy(), fbBy().toLowerCase()], בלי כפילות), רק השדות של הסיכום.
  // פעמיים: כמו שהוקלד באותיות קטנות (ערך אחד), וכמו שהוקלד באותיות גדולות (שני ערכים)
  M51: { run: async (uid, env) => {
    const T = Date.now();
    const task = (id, doneBy) => bypass(env, (db) => db.doc('tasks/' + id).set({ owner: H.OTHER, by: H.OTHER, role: 'w', txt: 'סיכום', cr: T - 3600000, due: T + 86400000,
      st: 'done', open: '', pr: '', img: 'data:image/jpeg;base64,AAAA', sub: T - 1000, doneBy, note: '', ok: T - 1000, late: '' }));
    await task('t_sum_' + uid, uid);
    await task('t_sumU_' + uid, uid.toUpperCase());
    const out = [];
    for (const me of [uid, uid.toUpperCase()]) {
      const vals = [...new Set([me, me.toLowerCase()])];
      const sq = { from: [{ collectionId: 'tasks' }], select: { fields: TKSF.map((f) => ({ fieldPath: f })) }, limit: 10000,
        where: { fieldFilter: { field: { fieldPath: 'doneBy' }, op: 'IN', value: { arrayValue: { values: vals.map((v) => ({ stringValue: v })) } } } } };
      const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: sq }) });
      if (r.status === 200) {
        const docs = (r.json || []).filter((x) => x.document);
        const ids = docs.map((x) => x.document.name.split('/').pop());
        assert.ok(ids.includes('t_sum_' + uid), 'העובד צריך לראות משימה שהוא ביצע בזמן (' + me + ')');
        if (vals.length > 1) assert.ok(ids.includes('t_sumU_' + uid), 'עם שני ערכים: גם המשימה שנרשמה באותיות גדולות');
        assert.ok(docs.every((x) => vals.includes(x.document.fields.doneBy.stringValue)), 'חזרה משימה שמישהו אחר ביצע');
        assert.ok(docs.every((x) => !x.document.fields.img), 'השדה img לא אמור לחזור');
      }
      out.push(r);
    }
    return out;
  } },
  // tkSumLoad – מנהל: כל המשימות שנכתבו בטווח (cr >= from AND cr < to)
  M52: { run: async (uid) => {
    const T = Date.now();
    const f = (op, v) => ({ fieldFilter: { field: { fieldPath: 'cr' }, op, value: iv(v) } });
    const sq = { from: [{ collectionId: 'tasks' }], select: { fields: TKSF.map((x) => ({ fieldPath: x })) }, limit: 10000,
      where: { compositeFilter: { op: 'AND', filters: [f('GREATER_THAN_OR_EQUAL', T - 2 * 86400000), f('LESS_THAN', T + 86400000)] } } };
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: sq }) });
    if (r.status === 200) {
      const ids = (r.json || []).filter((x) => x.document).map((x) => x.document.name.split('/').pop());
      assert.ok(ids.includes('t_done') && !ids.includes('t_done_late'), 'המנהל צריך לקבל בדיוק את המשימות שנכתבו בטווח');
    }
    return [r];
  } },

  // ---- חשבוניות ספקים לעובד (supinv) ----
  // supSync: המנהל קורא מה כבר בענן (רק טביעות, בלי תמונה)
  M53: { run: async (uid) => {
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'supinv' }], select: { fields: [{ fieldPath: 'h' }, { fieldPath: 'fh' }, { fieldPath: 'np' }] }, limit: 5000 } }) });
    if (r.status === 200) assert.ok((r.json || []).some((x) => x.document && x.document.name.endsWith('/supinv/s1')));
    return [r];
  } },
  // supSync: חלק צילום – פעם ראשונה ופעם שנייה
  M54: { run: async (uid) => {
    const put = () => fsx(uid, '/supinv/' + 's1' + '/p/' + 1, { method: 'PATCH', body: JSON.stringify({ fields: { data: sv('data:image/jpeg;base64,' + 'A'.repeat(1000)) } }) });
    return [await put(), await put()];
  } },
  // supSync: המסמך עצמו, בדיוק השדות של האפליקציה – חדש ועדכון
  M55: { run: async (uid) => {
    const f = { c: 'sup', n: 'אריזות פלוס', d: '2026-11-02', at: '2026-11-02', a: '-300', inv: '77', by: 'dani', pend: '1', src: 'w123', m: '2026-11', np: '1', h: 'abc', fh: 'def' };
    const fields = {}; for (const k in f) fields[k] = sv(f[k]);
    const id = fresh('s');
    return [await fsx(uid, '/supinv/' + id, { method: 'PATCH', body: JSON.stringify({ fields }) }), await fsx(uid, '/supinv/' + id, { method: 'PATCH', body: JSON.stringify({ fields }) })];
  } },
  M56: { run: async (uid) => [await fsx(uid, '/supinv/' + 's1' + '/p/' + 0, { method: 'DELETE' })] },
  M57: { run: async (uid) => [await fsx(uid, '/supinv/' + 's1', { method: 'DELETE' })] },
  // supLoad: העובד – החודש, בלי תמונה
  M58: { run: async (uid) => {
    const F = ['c', 'n', 'd', 'at', 'a', 'inv', 'by', 'pend', 'src', 'np'];
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'supinv' }], where: { fieldFilter: { field: { fieldPath: 'm' }, op: 'EQUAL', value: { stringValue: '2026-11' } } }, select: { fields: F.map((f) => ({ fieldPath: f })) }, limit: 2000 } }) });
    if (r.status === 200) {
      const docs = (r.json || []).filter((x) => x.document);
      assert.equal(docs.length, 1, 'העובד צריך לראות את החשבונית של החודש');
      assert.ok(!('h' in docs[0].document.fields) && !('data' in docs[0].document.fields), 'חזרו שדות שלא ביקשנו');
    }
    return [r];
  } },
  // supImg: צילום של הוצאה שהעובד עצמו שלח
  M59: { run: async (uid) => [await fsx(uid, '/chunks/' + `c_${uid}` + '_' + 0)] },
  // supImg: צילום מהענן
  M60: { run: async (uid) => [await fsx(uid, '/supinv/' + 's1' + '/p/' + 0)] },

  // ---- הערות במשימות (nc) והחזרה לעובד ----
  // FRM.tkCm (עובד): סימון "יש הערת עובד" לפני התגובה
  M61: { run: async (uid) => [await tkPatch(uid, 't_open', { nc: '1' })] },
  // ACT.tkDone (עובד, משימה עם nc): ממתינה לאישור המנהל
  M62: { run: async (uid) => [await tkPatch(uid, 't_nc', { st: 'wait', sub: Date.now(), doneBy: uid })] },
  // FRM.tkCm (מנהל, "להחזיר לעובד"): משימה שבוצעה חוזרת ל-open
  M63: { run: async (uid) => {
    const now = Date.now();
    const r = await tkPatch(uid, 't_done', { cAt: now, cBy: uid, st: 'open', open: '1', img: '', sub: 0, doneBy: '', ok: 0, late: '', note: 'חסר עוד מדף', rt: '1' });
    if (r.status === 200) { assert.equal(r.json.fields.st.stringValue, 'open'); assert.ok(r.json.fields.due && +r.json.fields.due.integerValue > 0, 'היעד (due) חייב להישמר'); }
    return [r];
  } },

  // ---- בקשות לעדכון האפליקציה (appreq) ----
  // arLoad: כל הבקשות, בלי תמונות
  M64: { run: async (uid) => {
    const F = ['uid', 'by', 'txt', 't', 'st', 'stBy', 'stAt', 'note', 'np'];
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'appreq' }], select: { fields: F.map((f) => ({ fieldPath: f })) }, limit: 1000 } }) });
    if (r.status === 200) {
      const docs = (r.json || []).filter((x) => x.document);
      assert.ok(docs.some((x) => x.document.name.endsWith('/appreq/r1')), 'הצוות צריך לראות גם בקשה של עובד אחר');
    }
    return [r];
  } },
  // FRM.arAdd: הבקשה, ואחריה חלקי התמונות (POST עם documentId, כמו באפליקציה)
  M65: { run: async (uid) => {
    const fields = { uid: sv(uid), by: sv(uid), txt: sv('בדוח החודשי חסר סינון לפי ספק'), t: iv(Date.now()), st: sv('new'), np: iv(0) };
    return [await fsx(uid, '/appreq?documentId=' + encodeURIComponent(fresh('r')), { method: 'POST', body: JSON.stringify({ fields }) })];
  } },
  M66: { run: async (uid) => {
    const id = fresh('r'); const all = 'PAGES:' + JSON.stringify(['data:image/jpeg;base64,' + 'A'.repeat(900000)]); const CH = 700000; const np = Math.ceil(all.length / CH);
    const fields = { uid: sv(uid), by: sv(uid), txt: sv('צילום מסך מצורף'), t: iv(Date.now()), st: sv('new'), np: iv(np) };
    const out = [await fsx(uid, '/appreq?documentId=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ fields }) })];
    for (let k = 0; k < np; k++) out.push(await fsx(uid, '/appreq/' + id + '/p?documentId=' + k, { method: 'POST', body: JSON.stringify({ fields: { data: sv(all.slice(k * CH, (k + 1) * CH)) } }) }));
    return out;
  } },
  // ACT.arImg
  M67: { run: async (uid) => [await fsx(uid, '/appreq/' + 'r1' + '/p/' + 0)] },
  // FRM.arSt: שינוי סטטוס (רק שדות הסטטוס, updateMask)
  M68: { run: async (uid) => {
    const o = { st: 'done', stBy: uid, stAt: Date.now(), note: 'תוקן בגרסה הבאה' }; const fields = {}; const mask = [];
    for (const k in o) { fields[k] = typeof o[k] === 'number' ? iv(o[k]) : sv(o[k]); mask.push('updateMask.fieldPaths=' + k); }
    return [await fsx(uid, '/appreq/' + 'r1' + '?' + mask.join('&') + '&currentDocument.exists=true', { method: 'PATCH', body: JSON.stringify({ fields }) })];
  } },
  // ACT.arDel: החלקים ואז הבקשה
  M69: { run: async (uid) => [await fsx(uid, '/appreq/' + 'r1' + '/p/' + 0, { method: 'DELETE' })] },
  M70: { run: async (uid) => [await fsx(uid, '/appreq/' + 'r1', { method: 'DELETE' })] },

  // ---- סגירת קופה (closings) ----
  // zcPull: סגירות חדשות (st == 'new'), בדיוק כמו באפליקציה
  M71: { run: async (uid) => {
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'closings' }], where: { fieldFilter: { field: { fieldPath: 'st' }, op: 'EQUAL', value: { stringValue: 'new' } } }, limit: 300 } }) });
    if (r.status === 200) assert.ok((r.json || []).some((x) => x.document && x.document.name.endsWith('/closings/z1')), 'המנהל צריך לראות סגירה חדשה של עובד');
    return [r];
  } },
  // zcMark: שינוי סטטוס (רק שדות הסטטוס, updateMask)
  M72: { run: async (uid) => {
    const o = { st: 'ok', stBy: uid, stAt: Date.now(), note: '' }; const fields = {}; const mask = [];
    for (const k in o) { fields[k] = typeof o[k] === 'number' ? iv(o[k]) : sv(o[k]); mask.push('updateMask.fieldPaths=' + k); }
    return [await fsx(uid, '/closings/' + 'z1' + '?' + mask.join('&') + '&currentDocument.exists=true', { method: 'PATCH', body: JSON.stringify({ fields }) })];
  } },
  // FRM.zcSend: הסגירה (עובד – 'new', מנהל – 'ok'), ואחריה חלקי הצילומים
  M73: { run: async (uid, env, role) => {
    const fields = zcFields(uid, role, 1);
    return [await fsx(uid, '/closings?documentId=' + encodeURIComponent(fresh('z')), { method: 'POST', body: JSON.stringify({ fields }) })];
  } },
  M74: { run: async (uid, env, role) => {
    const id = fresh('z'); const all = 'PAGES:' + JSON.stringify(['data:image/jpeg;base64,' + 'A'.repeat(900000), 'data:image/jpeg;base64,AAAA']); const CH = 700000; const np = Math.ceil(all.length / CH);
    const out = [await fsx(uid, '/closings?documentId=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ fields: zcFields(uid, role, np) }) })];
    for (let k = 0; k < np; k++) out.push(await fsx(uid, '/closings/' + id + '/p?documentId=' + k, { method: 'POST', body: JSON.stringify({ fields: { data: sv(all.slice(k * CH, (k + 1) * CH)) } }) }));
    return out;
  } },
  // ACT.zcImg
  M75: { run: async (uid) => [await fsx(uid, '/closings/' + 'z1' + '/p/' + 0)] },
  // zcHasPics: קיום חלק צילום בלי התוכן (mask)
  M76: { run: async (uid) => { const r = await fsx(uid, '/closings/' + 'z1' + '/p/' + 0 + '?mask.fieldPaths=x'); if (r.status === 200) assert.ok(!r.json.fields || !r.json.fields.data, 'mask: התוכן לא צריך לרדת'); return [r]; } },

  // ---- הוצאות מקופה (cashout) והפקדות (deposits) – שלב 2 ----
  // coQ(where, limit): אותה שאילתה לארבעה שימושים
  M77: { run: async (uid) => { const r = await coRunQ(uid, coEq('zc', ''), 500); if (r.status === 200) assert.ok(r.json.some((x) => x.document && x.document.name.endsWith('/cashout/co1')), 'צריך לראות הוצאה מקופה של עובד אחר'); return [r]; } },
  M78: { run: async (uid) => [await coRunQ(uid, coEq('uid', uid), 2000)] },
  M79: { run: async (uid) => { const r = await coRunQ(uid, { compositeFilter: { op: 'AND', filters: [coEq('dep', '1'), coEq('dp', '')] } }, 500); if (r.status === 200) { const n = r.json.filter((x) => x.document).map((x) => x.document.name.split('/').pop()); assert.deepEqual(n, ['co2'], 'רק co2 פתוחה להפקדה: ' + n); } return [r]; } },
  M80: { run: async (uid) => { const r = await coRunQ(uid, coEq('dp', 'dp1'), 50); if (r.status === 200) assert.deepEqual(r.json.filter((x) => x.document).map((x) => x.document.name.split('/').pop()), ['co3']); return [r]; } },
  // pushItem → coPush: חלק הצילום, ההוצאה ב-inbox, ואז המראה באותו מזהה
  M81: { run: async (uid) => {
    const id = fresh('w');
    const c = await fsx(uid, '/chunks?documentId=' + encodeURIComponent(id + '_0'), { method: 'POST', body: JSON.stringify({ fields: { owner: sv(uid), data: sv('') } }) });
    const body = { fields: { owner: sv(uid), by: sv(uid), status: sv('new'), created: sv(now()), data: sv(JSON.stringify({ amt: 120, date: '2026-10-20', note: 'להפקדה', reg: true, creg: 'i_yh' })), parts: sv(1) } };
    const i = await fsx(uid, '/inbox?documentId=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(body) });
    const co = await fsx(uid, '/cashout?documentId=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ fields: coFields(uid, id, { why: 'להפקדה', dep: '1' }) }) });
    return [c, i, co];
  } },
  M82: { run: async (uid) => [await fsx(uid, '/cashout/' + 'co1', { method: 'DELETE' })] },
  M83: { run: async (uid) => [await fsx(uid, '/cashout/' + 'co1')] },
  M84: { run: async (uid) => [await fsx(uid, '/cashout/' + 'co1', { method: 'DELETE' })] },
  // coSync: יצירה (חדשה, וגם יצירה מחדש עם zc/dp שנשמרו)
  M85: { run: async (uid) => [
    await fsx(uid, '/cashout?documentId=' + encodeURIComponent('m' + fresh('t')), { method: 'POST', body: JSON.stringify({ fields: coFields(uid, 'tx1') }) }),
    await fsx(uid, '/cashout?documentId=' + encodeURIComponent('m' + fresh('t')), { method: 'POST', body: JSON.stringify({ fields: coFields(uid, 'tx2', { zc: 'z1', dp: 'dp1' }) }) }),
  ] },
  M86: { run: async (uid) => [await fsx(uid, '/cashout/' + 'co1' + '?updateMask.fieldPaths=zc&currentDocument.exists=true', { method: 'PATCH', body: JSON.stringify({ fields: { zc: sv('z1') } }) })] },
  // FRM.dpSend: הפקדה + סימון dp ב-commit אחד, ואחריו חלקי הצילומים
  M87: { run: async (uid) => [await depCommit(uid, fresh('d'), ['co2'])] },
  M88: { run: async (uid) => {
    const id = fresh('d'); const all = 'PAGES:' + JSON.stringify(['data:image/jpeg;base64,' + 'A'.repeat(900000)]); const CH = 700000; const np = Math.ceil(all.length / CH);
    const out = [await depCommit(uid, id, ['co2'], np)];
    for (let k = 0; k < np; k++) out.push(await fsx(uid, '/deposits/' + id + '/p?documentId=' + k, { method: 'POST', body: JSON.stringify({ fields: { data: sv(all.slice(k * CH, (k + 1) * CH)) } }) }));
    return out;
  } },
  M89: { run: async (uid) => { const r = await fsx(uid, '/deposits/' + 'dp1' + '/p/' + 0 + '?mask.fieldPaths=x'); if (r.status === 200) assert.ok(!r.json.fields || !r.json.fields.data); return [r]; } },
  M90: { run: async (uid) => {
    const o = { st: 'ok', stBy: uid, stAt: Date.now(), note: '' }; const fields = {}; const mask = [];
    for (const k in o) { fields[k] = typeof o[k] === 'number' ? iv(o[k]) : sv(o[k]); mask.push('updateMask.fieldPaths=' + k); }
    return [await fsx(uid, '/deposits/' + 'dp1' + '?' + mask.join('&') + '&currentDocument.exists=true', { method: 'PATCH', body: JSON.stringify({ fields }) })];
  } },
  M91: { run: async (uid) => {
    const r = await fsx(uid, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'deposits' }], where: { fieldFilter: { field: { fieldPath: 'st' }, op: 'EQUAL', value: { stringValue: 'new' } } }, limit: 300 } }) });
    if (r.status === 200) assert.ok(r.json.some((x) => x.document && x.document.name.endsWith('/deposits/dp1')));
    return [r];
  } },
  M92: { run: async (uid) => [await fsx(uid, '/deposits/' + 'dp1' + '/p/' + 0)] },
  // FRM.dqNo: דחייה + dp חוזר לריק
  M93: { run: async (uid) => {
    const fields = { st: sv('rej'), stBy: sv(uid), stAt: iv(Date.now()), note: sv('לא תואם') };
    return [await fsx(uid, ':commit', { method: 'POST', body: JSON.stringify({ writes: [{ update: { name: docName('deposits/dp1'), fields }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { exists: true } }, dpResetW('co3')] }) })];
  } },
  // ACT.dqDel: מחיקה + dp חוזר לריק, ואז חלקי הצילומים
  M94: { run: async (uid) => [await fsx(uid, ':commit', { method: 'POST', body: JSON.stringify({ writes: [{ delete: docName('deposits/dp1') }, dpResetW('co3')] }) })] },
  M95: { run: async (uid) => [await fsx(uid, '/deposits/' + 'dp1' + '/p/' + 0, { method: 'DELETE' })] },
};

const ROLE_UID = { employee: H.UID.employee, manager: H.UID.manager, managerAdminsOnly: H.MANAGER_ONLY_ADMINS,
  signedIn: H.UID.signedIn, disabledEmployee: H.UID.disabledEmployee };
const ROLE_NAME = { employee: 'עובד פעיל', manager: 'מנהל', managerAdminsOnly: 'מנהל כמו היום (רק admins, בלי staff)',
  signedIn: 'מחובר שאינו ב-staff', disabledEmployee: 'עובד מושבת' };

describe('האפליקציה הקיימת – כל פעולה מול Firestore, בדיוק כמו בקוד (REST)', () => {
  let env;
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); });

  for (const row of ops.rows) {
    const R = REPLAY[row.id];
    if (!R) throw new Error('חסר שחזור לשורה ' + row.id);
    const allowedRoles = row.who.slice();
    if (row.who.includes('manager')) allowedRoles.push('managerAdminsOnly');
    for (const role of allowedRoles) {
      it(`${row.id} (שורה ${row.line}, ${row.fn}) | ${ROLE_NAME[role]} → מותר`, async () => {
        const res = await R.run(ROLE_UID[role], env, role);
        const okStatuses = R.allowed ? R.allowed(role) : [200];
        for (const r of res) assert.ok(okStatuses.includes(r.status), `סטטוס ${r.status} (ציפינו ל-${okStatuses.join('/')}): ${JSON.stringify(r.json)}`);
        if (R.check) R.check(role, res);
        H.record('app', { id: row.id, role, result: 'allow' });
      });
    }
    for (const role of ['signedIn', 'disabledEmployee']) {
      it(`${row.id} (שורה ${row.line}, ${row.fn}) | ${ROLE_NAME[role]} → נחסם`, async () => {
        const res = await R.run(ROLE_UID[role], env, role);
        // M01: כל מחובר רשאי לקרוא את מסמך admins של עצמו; אין לו מסמך, ולכן 404 (וזה "לא מנהל")
        const want = row.id === 'M01' ? 404 : 403;
        for (const r of res) assert.equal(r.status, want, `ציפינו ל-${want}, התקבל ${r.status}`);
        H.record('app', { id: row.id, role, result: 'deny' });
      });
    }
  }
});

module.exports = { REPLAY };
