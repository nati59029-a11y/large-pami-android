'use strict';
// הקשחה של chunks ו-inbox (שלב 3), לפי הערה 2 של הבודק בשלב 2:
//  - inbox: החלק הראשון של הצילום (chunks/{id}_0) חייב להיות של אותו עובד, ורק השדות שהאפליקציה כותבת.
//  - chunks: רק owner ו-data; data עד 700,000 תווים (CH באפליקציה); חלק 1 ומעלה רק אם חלק 0 שלו.
// כל הבקשות נשלחות ב-REST בדיוק כמו ב-pushItem וב-fbPush באפליקציה (www/index.html, שורות 1358, 1360, 2049).

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { fsx, sv } = H;

const ME = 'u_emp';
const OTHER = H.OTHER;
let seq = 0;
const fresh = (p) => `${p}${Date.now().toString(36)}${++seq}`;
const postChunk = (uid, id, fields) => fsx(uid, '/chunks?documentId=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ fields }) });
const chunkFields = (uid, data) => ({ owner: sv(uid), data: sv(data) });
const inboxFields = (uid, n) => ({ owner: sv(uid), by: sv(uid), status: sv('new'), created: sv('2026-10-28T10:00:00.000Z'), data: sv('{"amt":1}'), parts: sv(n) });
const postInbox = (uid, id, fields) => fsx(uid, '/inbox?documentId=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ fields }) });

describe('הקשחה: chunks ו-inbox', () => {
  let env;
  before(async () => { env = await H.getEnv(); });
  beforeEach(async () => { await H.seed(env); });

  it('האפליקציה עדיין עובדת: שליחת הוצאה עם 3 חלקי צילום, וגם שליחה חוזרת (409 ולא 403)', async () => {
    const id = fresh('it');
    const file = 'x'.repeat(700000 * 2 + 10);
    const n = Math.ceil(file.length / 700000);
    for (let k = 0; k < n; k++) assert.equal((await postChunk(ME, `${id}_${k}`, chunkFields(ME, file.slice(k * 700000, (k + 1) * 700000)))).status, 200, 'חלק ' + k);
    assert.equal((await postInbox(ME, id, inboxFields(ME, n))).status, 200);
    // שליחה חוזרת (למשל אחרי ניתוק): האפליקציה מתייחסת ל-409 כהצלחה
    for (let k = 0; k < n; k++) assert.equal((await postChunk(ME, `${id}_${k}`, chunkFields(ME, file.slice(k * 700000, (k + 1) * 700000)))).status, 409, 'חזרה, חלק ' + k);
    assert.equal((await postInbox(ME, id, inboxFields(ME, n))).status, 409);
  });

  it('צילום משוב ברזולוציה גבוהה (fbhi_{id}_k) עדיין עובד, כולל כמה חלקים', async () => {
    const id = fresh('fb');
    for (let k = 0; k < 3; k++) assert.equal((await postChunk(ME, `fbhi_${id}_${k}`, chunkFields(ME, 'y'.repeat(1000)))).status, 200);
  });

  it('inbox שמצביע על חלק צילום של עובד אחר – נחסם', async () => {
    const id = fresh('it');
    assert.equal((await postChunk(OTHER, `${id}_0`, chunkFields(OTHER, 'z'))).status, 200);
    assert.equal((await postInbox(ME, id, inboxFields(ME, 1))).status, 403);
  });

  it('inbox עם שדה נוסף שהאפליקציה לא כותבת – נחסם', async () => {
    const id = fresh('it');
    await postChunk(ME, `${id}_0`, chunkFields(ME, 'z'));
    assert.equal((await postInbox(ME, id, Object.assign(inboxFields(ME, 1), { file: sv('data:...') }))).status, 403);
    assert.equal((await postInbox(ME, id, Object.assign(inboxFields(ME, 1), { admin: { booleanValue: true } }))).status, 403);
  });

  it('chunks: שדה נוסף, data שאינו טקסט, או data מעל 700,000 תווים – נחסמים; בדיוק 700,000 מותר', async () => {
    assert.equal((await postChunk(ME, fresh('c') + '_0', Object.assign(chunkFields(ME, 'a'), { extra: sv('1') }))).status, 403);
    assert.equal((await postChunk(ME, fresh('c') + '_0', { owner: sv(ME), data: { integerValue: '5' } })).status, 403);
    assert.equal((await postChunk(ME, fresh('c') + '_0', chunkFields(ME, 'a'.repeat(700001)))).status, 403);
    assert.equal((await postChunk(ME, fresh('c') + '_0', chunkFields(ME, 'a'.repeat(700000)))).status, 200);
  });

  it('chunks: חלק 1 ומעלה בלי חלק 0, או כשחלק 0 של עובד אחר – נחסם (אי אפשר "לשתול" חלק בפריט של אחר)', async () => {
    const a = fresh('it');
    assert.equal((await postChunk(ME, `${a}_1`, chunkFields(ME, 'q'))).status, 403);
    const b = fresh('it');
    await postChunk(OTHER, `${b}_0`, chunkFields(OTHER, 'q'));
    assert.equal((await postChunk(ME, `${b}_1`, chunkFields(ME, 'q'))).status, 403);
    const c = fresh('fb');
    await postChunk(OTHER, `fbhi_${c}_0`, chunkFields(OTHER, 'q'));
    assert.equal((await postChunk(ME, `fbhi_${c}_1`, chunkFields(ME, 'q'))).status, 403);
    // שם שאינו בתבנית {id}_{מספר} – נחסם
    assert.equal((await postChunk(ME, fresh('noindex'), chunkFields(ME, 'q'))).status, 403);
  });
});
