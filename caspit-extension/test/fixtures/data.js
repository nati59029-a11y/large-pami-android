'use strict';
// נתוני דוגמה לבדיקות בלבד (לא נתוני העסק): קטלוג ודוח מכירות במבנה של כספית
const CAT_HDR = ['קוד פריט', 'שם פריט', 'ברקוד', 'צבע', 'מידה', 'ספק', 'קטגוריה ראשית', 'קטגוריה משנית', 'מחיר עלות', 'מחיר לצרכן', 'פריט ללא מעמ'];
const CAT_ROWS = [
  ['101', 'בלון לבן', '7290000000101', '', '', 'ספק א', 'בלונים', '', '2', '5', 'לא'],
  ['102', 'צלחת נייר', '7290000000102', '', '', 'ספק א', 'כלים', '', '4.5', '9.9', 'לא'],
  ['103', 'מפית חג', '7290000000103', '', '', 'ספק ב', 'כלים', '', '', '6.9', 'לא'],
];
const SAL_HDR = ['תאריך מכירה', 'שם פריט', 'מספר ברקוד', 'מספר עסקה', 'שם סניף', 'מספר סניף', 'משקל', 'הנחה', 'פדיון'];
// br (0.1.13): סניף בדוח – ברירת מחדל "סניף א" / 1 (יהודה הנשיא); לנחל לכיש: { bn: 'סניף ב', bno: '2' }; rows: false – רק כותרות (אין מכירות)
function salesRows(day, br) {
  const [y, m, d] = day.split('-');
  const dt = `${d}/${m}/${y}`, b = br || {}, bn = b.bn == null ? 'סניף א' : b.bn, bno = b.bno == null ? '1' : b.bno;
  if (b.rows === false) return [SAL_HDR];
  if (b.bno != null) return [SAL_HDR, [dt, 'בלון לבן', '101', '7001', bn, bno, '', '0', '20'], [dt, 'מפית חג', '103', '7002', bn, bno, '', '0', '6.9']];
  return [SAL_HDR, [dt, 'בלון לבן', '101', '5001', bn, bno, '', '0', '10'], [dt, 'צלחת נייר', '102', '5001', bn, bno, '', '0', '9.9'], [dt, 'מפית חג', '103', '5002', bn, bno, '', '0', '6.9']];
}
const csvOf = (rows) => rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
const salesCsv = (day, br) => csvOf(salesRows(day, br));
// קידוד windows-1255 (עברית + ASCII) – כמו קובץ CSV שכספית מורידה
function win1255(s) {
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c >= 0x5d0 && c <= 0x5ea) out.push(0xe0 + c - 0x5d0);
    else out.push(0x3f);
  }
  return new Uint8Array(out);
}
// noBc: כמו "יצוא לאקסל" בכספית האמיתית – בלי ברקוד, צבע ומידה
function catalogXlsx(X, noBc) {
  const wb = X.utils.book_new();
  const drop = noBc ? [2, 3, 4] : [];
  const cut = (r) => r.filter((_, i) => !drop.includes(i));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([cut(CAT_HDR)].concat(CAT_ROWS.map(cut))), 'catalog');
  return new Uint8Array(X.write(wb, { bookType: 'xlsx', type: 'array' }));
}
module.exports = { CAT_HDR, CAT_ROWS, SAL_HDR, salesRows, salesCsv, win1255, catalogXlsx, csvOf };
