'use strict';
// מבנה השלוחות בקו (משימה 2026-11-17, "שלוחה אחת"): לאיזו שלוחה עולה כל סוג תוכן.
//   yemot_state/layout { single, ext:'1' } – מסמך הגדרה אחד (המנהל משנה דרך setLineLayout ב-yemot-line.js).
//   אין מסמך / single !== true = ההתנהגות של היום בדיוק: מתכונים 1, מבצעים YEMOT_EXT (ברירת מחדל 2), עדכונים 3, שעות 4.
//   single:true = מתכונים, מבצעים, עדכונים ושעות – כולם בשלוחה ext ('1'). הודעת הפתיחה תמיד בשורש (לא משתנה).
// מונה המספרים לכל שלוחה (counterDoc): שלוחת המבצעים ← yemot_state/line (כמו היום), כל שלוחה אחרת ← yemot_state/ext-N.
//   כך כשכמה סוגים חולקים שלוחה – הם חולקים גם את המונה, ושתי העלאות במקביל לא מקבלות אותו מספר.
// מחיקה/הורדה/החזרה – תמיד לפי הנתיב השמור ברשומה (dirOf), לא לפי ההגדרה הנוכחית. רק מסמכים חדשים, בלי מיגרציה.

const LAYOUT_DOC = 'yemot_state/layout';
const CONTENT_SLOTS = ['recipes', 'promos', 'updates', 'hours'];
const DEFAULT_EXT = { recipes: '1', updates: '3', hours: '4', opening: '' }; // promos = YEMOT_EXT
const SINGLE_EXTS = ['1']; // היום: רק שלוחה 1 (בקשת המשתמש 17.11)
const DEFAULT_LAYOUT = Object.freeze({ single: false, ext: '1' });

// קריאת ההגדרה. כשל קריאה / ערך לא תקין ← ברירת המחדל (ההתנהגות של היום).
async function loadLayout(db) {
  const s = await db.doc(LAYOUT_DOC).get();
  if (!s.exists) return Object.assign({}, DEFAULT_LAYOUT);
  const ext = SINGLE_EXTS.includes(s.get('ext')) ? s.get('ext') : '1';
  return { single: s.get('single') === true, ext };
}

// השלוחה שאליה עולה סוג תוכן עכשיו. promoExt = YEMOT_EXT (readCfg().ext).
function extOf(slot, layout, promoExt) {
  if (slot === 'opening') return '';
  const L = layout || DEFAULT_LAYOUT;
  if (L.single && CONTENT_SLOTS.includes(slot)) return String(L.ext);
  if (slot === 'promos') return String(promoExt);
  return DEFAULT_EXT[slot];
}

// הסוגים שעולים עכשיו לשלוחה ext (לפי הסדר הקבוע). שלוחה שאף סוג לא עולה אליה – הסוג שהיה בה במבנה הרגיל.
function slotsOfExt(ext, layout, promoExt) {
  const e = String(ext);
  if (e === '') return ['opening'];
  const now = CONTENT_SLOTS.filter((s) => extOf(s, layout, promoExt) === e);
  if (now.length) return now;
  return CONTENT_SLOTS.filter((s) => extOf(s, DEFAULT_LAYOUT, promoExt) === e);
}

// מסמך המונה (nextNum/recent) של שלוחה. שלוחת המבצעים – yemot_state/line, כמו היום.
function counterDoc(ext, promoExt) {
  const e = String(ext);
  return e === String(promoExt) ? 'yemot_state/line' : `yemot_state/ext-${e.replace(/[^0-9A-Za-z]/g, '-')}`;
}

// השלוחה שבנתיב שמור: 'ivr2:1/005.<סיומת>' → '1', 'ivr2:2/1/005.<סיומת>' → '2/1', 'ivr2:/M1000.<סיומת>' → ''. נתיב לא תקין → null.
function dirOf(path) {
  const m = /^ivr2:((?:[0-9A-Za-z]+(?:\/[0-9A-Za-z]+)*)?)\/[^/]+$/.exec(String(path || ''));
  return m ? m[1] : null;
}

// השלוחות שבהן מבצע יכול לשבת (שלוחת המבצעים הרגילה, ושלוחת "שלוחה אחת"). מחיקת מבצע – רק שם.
function promoExts(layout, promoExt) {
  const L = layout || DEFAULT_LAYOUT;
  return [...new Set([String(promoExt), String(L.ext)])];
}

// מספרי הקבצים (001-999) שרשומה כלשהי של האפליקציה מחזיקה בשלוחה ext – פריטים (yemot_items) ומבצעים (yemot_promos),
// כולל העלאה שמצבה לא ודאי, וגם רשומה שנכשלה ושומרת נתיב (ניסיון חוזר שלה יעלה לאותו נתיב – keepPath ב-yemot-line.js).
// משמש את מילוי החורים במבצעים (מעל 999), כדי לא לדרוס קובץ של סוג אחר.
const HOLD_STATUS = ['live', 'remove-failed', 'uploading', 'failed'];
async function heldNums(db, ext) {
  const nums = new Set();
  const add = (x) => {
    if (dirOf(x.path) !== String(ext)) return;
    const m = /\/(\d{3})\.[A-Za-z0-9]+$/.exec(String(x.path));
    if (m) nums.add(Number(m[1]));
  };
  for (const col of ['yemot_items', 'yemot_promos']) {
    for (const d of (await db.collection(col).where('status', 'in', HOLD_STATUS).get()).docs) add(d.data());
  }
  return nums;
}

module.exports = { LAYOUT_DOC, CONTENT_SLOTS, DEFAULT_EXT, SINGLE_EXTS, DEFAULT_LAYOUT, loadLayout, extOf, slotsOfExt, counterDoc, dirOf, promoExts, heldNums, HOLD_STATUS };
