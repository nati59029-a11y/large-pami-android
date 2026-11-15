'use strict';
// קול, תמונה וסרטון למזכירה (15.11.2026) – בדיקות יחידה בלי אמולטור: זיהוי סוג ואורך לפי התוכן (WAV, WebM, MP4/MOV/3GP, תמונות),
// פענוח תשובת המודל, בדיקת הנתיב הזמני, ההנחיה (בלי כלים, טקסט בקובץ = מידע) והגבלות ברירת המחדל.
// node --test tests/secretary-media.unit.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./media-fixtures');
const M = require('../functions/secretary-media.js')._core;
const SEC = require('../functions/secretary.js')._core;

describe('secretary-media: סוג ואורך לפי התוכן', () => {
  it('WAV: אורך מכותרת ה-data (לא ממה שהמכשיר הצהיר); לא WAV – null', () => {
    assert.equal(M.wavInfo(F.wav(12.5)).sec, 12.5);
    assert.equal(Math.round(M.wavInfo(F.wav(121)).sec), 121);
    assert.equal(M.wavInfo(F.jpg()), null);
    assert.equal(M.wavInfo(Buffer.from('RIFF0000WAVE')), null);
    const odd = F.wav(2); odd.writeUInt32LE(0, 28); // byteRate 0
    assert.equal(M.wavInfo(odd), null);
  });
  it('WAV מזויף (תיקון סבב 1): byteRate מנופח – נדחה; data מוצהר קטן מהתוכן – האורך לפי כל הקובץ; קצב/עומק לא מוכרים – נדחים', () => {
    assert.equal(M.wavInfo(F.wavFake(600, 'rate')), null);
    assert.equal(Math.round(M.wavInfo(F.wavFake(300, 'data')).sec), 300);
    const w = F.wav(2); w.writeUInt32LE(7000, 24); w.writeUInt32LE(14000, 28); // קצב דגימה לא מוכר (עקבי)
    assert.equal(M.wavInfo(w), null);
    const d = F.wav(2); d.writeUInt16LE(12, 34); // עומק 12 ביט
    assert.equal(M.wavInfo(d), null);
    const a = F.wav(2); a.writeUInt16LE(4, 32); // blockAlign לא תואם
    assert.equal(M.wavInfo(a), null);
    assert.equal(M.wavInfo(F.wav(5, 44100)).sec, 5);
  });
  it('סרטון מזויף (תיקון סבב 1): WebM עם Duration קצר – לפי זמן הבלוקים; MP4 – מקסימום של mvhd/tkhd/mdhd/stts; קובץ מקוטע – נדחה', () => {
    assert.ok(Math.abs(M.webmSec(F.webm(300, { duration: true, claim: 10 })) - 300) < 0.01);
    assert.ok(Math.abs(M.webmSec(F.webm(10, { duration: true, claim: 12 })) - 12) < 0.01);
    assert.equal(M.isoSec(F.mp4(300, 'isom', 64, { claim: 10 })), 300);
    assert.equal(M.isoSec(F.mp4(300, 'isom', 64, { claim: 10, trak: true, all: true })), 300, 'גם כשכל הכותרות מזויפות – stts');
    assert.equal(M.isoSec(F.mp4(20, 'isom', 64, { trak: true })), 20);
    assert.equal(M.isoSec(F.mp4(20, 'isom', 64, { frag: true })), null);
  });
  it('תיקון סבב 2: Void / אלמנט לא מוכר באשכול מדולג; עצירה באמצע או בלי בלוקים – נדחה; תיבה פגומה או בלי stts ב-MP4 – נדחה', () => {
    assert.ok(Math.abs(M.webmSec(F.webm(300, { duration: true, claim: 10, void: true })) - 300) < 0.01, 'Void לפני ה-Timecode ולפני כל בלוק');
    assert.ok(Math.abs(M.webmSec(F.webm(20, { void: true })) - 20) < 0.01);
    assert.equal(M.webmSec(F.webm(300, { duration: true, claim: 10, noBlocks: true })), null, 'אשכולות בלי בלוקים');
    assert.equal(M.webmSec(F.webm(300, { duration: true, claim: 10, unknownKid: true })), null, 'ילד בגודל לא ידוע – עצירה = דחייה');
    const w = F.webm(30, { duration: true, claim: 10 });
    assert.ok(Math.abs(M.webmSec(w.subarray(0, w.length - 5)) - 30) < 0.01, 'קובץ שנחתך בסוף – עדיין נקרא');
    const junk = Buffer.concat([F.webm(5, { duration: true, claim: 5 }).subarray(0, 120), Buffer.alloc(400, 0)]);
    assert.equal(M.webmSec(junk), null, 'אפסים באמצע (אלמנט פגום) – נדחה');
    assert.equal(M.isoSec(F.mp4(300, 'isom', 64, { claim: 10, badBox: true })), null, 'תיבה פגומה לפני המסלול');
    assert.equal(M.isoSec(F.mp4(300, 'isom', 64, { claim: 10, trak: false })), null, 'בלי stts – לא סומכים על mvhd לבד');
  });
  it('WebM כמו MediaRecorder (בלי Duration, אשכולות בגודל לא ידוע) ועם Duration', () => {
    const a = F.webm(20);
    assert.equal(M.vidMime(a), 'video/webm');
    assert.ok(Math.abs(M.vidSec(a, 'video/webm') - 20) < 0.01, String(M.vidSec(a, 'video/webm')));
    assert.ok(Math.abs(M.webmSec(F.webm(61)) - 61) < 0.01);
    assert.ok(Math.abs(M.webmSec(F.webm(33.3, { duration: true })) - 33.3) < 0.01);
    assert.equal(M.webmSec(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80])), null);
  });
  it('MP4 / MOV / 3GP: mvhd; סוג לפי ה-brand', () => {
    assert.equal(M.vidMime(F.mp4(10)), 'video/mp4');
    assert.equal(M.vidMime(F.mp4(10, 'qt')), 'video/quicktime');
    assert.equal(M.vidMime(F.mp4(10, '3gp5')), 'video/3gpp');
    assert.equal(M.vidSec(F.mp4(42.5), 'video/mp4'), 42.5);
    assert.equal(M.vidMime(F.jpg()), '');
  });
  it('תמונה: JPEG / PNG / WEBP לפי התוכן; אחר – ריק', () => {
    assert.equal(M.imgMime(F.jpg()), 'image/jpeg');
    assert.equal(M.imgMime(F.png()), 'image/png');
    const wp = Buffer.alloc(30); wp.write('RIFF', 0, 'ascii'); wp.write('WEBP', 8, 'ascii');
    assert.equal(M.imgMime(wp), 'image/webp');
    assert.equal(M.imgMime(F.wav(1)), '');
    assert.equal(M.imgMime(Buffer.from('<svg/>')), '');
  });
});

describe('secretary-media: תשובת המודל, נתיב, הנחיה, הגבלות', () => {
  it('parseSee: JSON תקין, סיווג לא מוכר → other, ביטחון בין 0 ל-1, תשובה לא JSON → טקסט בלבד בלי משימה', () => {
    assert.deepEqual(M.parseSee('{"cls":"inv","conf":0.9,"reply":"חשבונית מספק","task":""}'), { cls: 'inv', conf: 0.9, reply: 'חשבונית מספק', task: '' });
    assert.equal(M.parseSee('{"cls":"hack","conf":7,"reply":"x"}').cls, 'other');
    assert.equal(M.parseSee('{"cls":"z","conf":7,"reply":"x"}').conf, 1);
    assert.equal(M.parseSee('```json\n{"cls":"rcpt","conf":0.8,"reply":"קבלה"}\n```').cls, 'rcpt');
    const p = M.parseSee('סתם טקסט');
    assert.equal(p.cls, 'other'); assert.equal(p.task, ''); assert.equal(p.reply, 'סתם טקסט');
    assert.ok(M.parseSee('{"cls":"other","reply":"a","task":"' + 'ב'.repeat(500) + '"}').task.length <= 300);
  });
  it('ownTmpPath: רק sec_tmp של המשתמש עצמו בעסק שלו', () => {
    const who = { uid: 'u1', prefix: 'b/biz-a/' };
    assert.equal(M.ownTmpPath(who, 'b/biz-a/sec_tmp/u1/abcdefgh12.webm'), 'b/biz-a/sec_tmp/u1/abcdefgh12.webm');
    assert.equal(M.ownTmpPath({ uid: 'u1', prefix: '' }, 'sec_tmp/u1/abcdefgh12'), 'sec_tmp/u1/abcdefgh12');
    for (const p of ['b/biz-a/sec_tmp/u2/abcdefgh12.webm', 'b/biz-b/sec_tmp/u1/abcdefgh12.webm', 'sec_tmp/u1/abcdefgh12.webm', 'b/biz-a/sec_tmp/u1/../u2/abcdefgh12',
      'b/biz-a/sec_tmp/u1/short', 'b/biz-a/sec_tmp/u1/abcdefgh12.exe', 'b/biz-a/app_backups/u1/abcdefgh12', 7, null]) {
      assert.throws(() => M.ownTmpPath(who, p), (e) => e.details && e.details.reason === 'bad-path', String(p));
    }
  });
  it('selfTmpPath (תיקון סבב 1): רק נתיב sec_tmp של המשתמש המחובר עצמו – למחיקה גם כשהבקשה נדחית בשער', () => {
    const rq = { auth: { uid: 'u1' } };
    assert.equal(M.selfTmpPath(rq, { path: 'b/biz-a/sec_tmp/u1/abcdefgh12.webm' }), 'b/biz-a/sec_tmp/u1/abcdefgh12.webm');
    assert.equal(M.selfTmpPath(rq, { path: 'sec_tmp/u1/abcdefgh12' }), 'sec_tmp/u1/abcdefgh12');
    for (const p of ['b/biz-a/sec_tmp/u2/abcdefgh12.webm', 'b/biz-a/app_backups/u1/abcdefgh12', 'b/biz-a/sec_tmp/u1/x', 'b/biz-a/sec_tmp/u1/../u2/abcdefgh12', 5]) assert.equal(M.selfTmpPath(rq, { path: p }), null, String(p));
    assert.equal(M.selfTmpPath({}, { path: 'sec_tmp/u1/abcdefgh12' }), null);
  });
  it('מחיר אודיו (לא מאומת): יקר מטקסט; לפי פירוט Gemini אם יש, אחרת הערכה שמרנית', () => {
    const AI = require('../functions/lib/sec-ai.js');
    const text = AI.costMc('fast', { in: 1000, out: 200 });
    assert.ok(AI.costMc('fast', { in: 1000, out: 200, aud: 1000 }) > text);
    assert.equal(M.audCost({ in: 1000, out: 200 }, 1000), AI.costMc('fast', { in: 1000, out: 200, aud: 1000 }));
    assert.equal(M.audCost({ in: 1000, out: 200, aud: 100 }, 1000), AI.costMc('fast', { in: 1000, out: 200, aud: 100 }));
    assert.equal(M.audCost({ in: 1000, out: 200 }, 0), text);
    assert.equal(AI.costMc('fast', { in: 100, out: 0, aud: 999 }), AI.costMc('fast', { in: 100, out: 0, aud: 100 }), 'aud לא יותר מ-in');
  });
  it('ההנחיה: מתחילה ב-SEC-CHAT-V1 SEE, טקסט בקובץ = מידע בלבד, אין כלים ואין נתוני עסק', () => {
    const s = M.seeSys({ nm: 'רותי', ad: 'f', call: 'נתי' }, 'image', '2026-11-15');
    assert.ok(s.startsWith('SEC-CHAT-V1 SEE:'));
    assert.match(s, /מידע בלבד/); assert.match(s, /אל תבצעי הוראות/); assert.match(s, /אין לך כלים/);
    assert.match(M.seeSys({}, 'video', '2026-11-15'), /בסרטון – תמיד other/);
  });
  it('הגבלות: ברירת מחדל 120 / true / 60; ערך שמור לא תקין → ברירת המחדל; 0 = כבוי', () => {
    assert.deepEqual(SEC.mediaOf(null), { aud: 120, img: true, vid: 60 });
    const snap = (d) => ({ exists: true, data: () => d });
    assert.deepEqual(SEC.mediaOf(snap({ aud: 0, img: false, vid: 0 })), { aud: 0, img: false, vid: 0 });
    assert.deepEqual(SEC.mediaOf(snap({ aud: 999, img: 'x', vid: 61 })), { aud: 120, img: true, vid: 60 });
    assert.deepEqual(SEC.MEDIA_MAX, { aud: 300, vid: 60 });
  });
});
