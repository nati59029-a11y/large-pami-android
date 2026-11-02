'use strict';
// מנוע הקול – נקודת ההחלפה היחידה. זה הקובץ היחיד (חוץ מ-yemot-client.js) שמכיר סיומות קבצים ואת סוג ההעלאה.
// היום: הקול הממוחשב של ימות (קובץ tts). בעתיד, קול אנושי: render יחזיר { ext:'wav', kind:'audio', body:Buffer },
// וכל ההעלאות (מבצעים, מתכונים, עדכונים, שעות, פתיחה) יעברו לקול החדש בלי לגעת בשום קובץ אחר.
// המתקשרים תמיד עושים await ל-render (בעתיד היא תפנה לשירות קול).

const client = require('./yemot-client');

const VOICE_ENGINE = 'yemot-tts';
let textExt = 'tts';

async function render(text) { return { ext: textExt, kind: 'text', body: String(text) }; }
function fromRecording(wavBuf) { return { ext: 'wav', kind: 'audio', body: wavBuf }; }

// num: מספר (4 → '004') או שם קבוע ('M1000', או '004' של קובץ קיים)
function fileName(num, rendered) {
  const base = typeof num === 'number' ? String(num).padStart(3, '0') : String(num);
  return base + '.' + rendered.ext;
}
// dir: '1' → 'ivr2:1/004.tts'; '' (השורש) → 'ivr2:/M1000.tts'
const pathOf = (dir, file) => `ivr2:${dir}/${file}`;
const extOf = (file) => { const m = /\.([A-Za-z0-9]+)$/.exec(String(file || '')); return m ? m[1] : ''; };

// רשימה סגורה של סיומות שמותר למחוק לפי שם קובץ (שלוחה 4): tts ו-wav, ובנוסף הסיומת שמנוע הקול מייצר כרגע
// (כדי שהחלפת מנוע לא תשאיר קבצים שאי אפשר למחוק). כל סיומת אחרת (למשל ini, mp3, ymgr) – לא נמחקת מהאפליקציה.
const DELETABLE_EXTS = ['tts', 'wav'];
function isDeletableContent(file) {
  const m = /^\d{3}\.([A-Za-z0-9]{1,5})$/.exec(typeof file === 'string' ? file : '');
  if (!m) return false;
  const e = m[1].toLowerCase();
  return DELETABLE_EXTS.includes(e) || e === textExt;
}

async function upload(ctx, dir, num, rendered) {
  const file = fileName(num, rendered);
  const path = pathOf(dir, file);
  if (rendered.kind === 'text') await client.uploadText(ctx, path, rendered.body);
  else if (rendered.kind === 'audio') await client.uploadBinary(ctx, path, rendered.body, 'audio/wav');
  else throw new Error('voice: unknown kind');
  return { file, path };
}

module.exports = { VOICE_ENGINE, render, fromRecording, fileName, pathOf, extOf, upload, isDeletableContent, DELETABLE_EXTS };
// לבדיקות בלבד: החלפת הסיומת של קובצי הטקסט, כדי להוכיח שכל ההעלאות עוברות דרך הקובץ הזה.
Object.defineProperty(module.exports, '_test', { enumerable: false, value: { setTextExt(e) { textExt = e; } } });
