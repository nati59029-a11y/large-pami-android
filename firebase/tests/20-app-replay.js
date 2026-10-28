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
  // fbPush – עובד שולח משוב חדש (st: 'new')
  M16: { run: async (uid) => {
    const id = fresh('fb');
    return [await fsx(uid, '/fb/' + id, { method: 'PATCH', body: JSON.stringify({ fields: { data: sv('{"f":{}}'), img: sv('data:image/jpeg;base64,AAAA'), owner: sv(uid), at: sv(Date.now()), st: sv('new') } }) })];
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
