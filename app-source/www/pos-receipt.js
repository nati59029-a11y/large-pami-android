/* POS:M2 – קופה גל 2, ש2: בניית הקבלה (17.11.2026). פונקציות טהורות – בלי DOM ובלי רשת, כדי שאפשר יהיה לבדוק בשרת (node) ולהדפיס בכל מתאם.
   PosReceipt.build(data, opt) → { width, cols, rows:[…], text, html }
     data = התשובה של posDoc({op:'get'}): { sale, pays, docs, hdr }.
     opt  = { fmt:'80'|'58'|'a4' (rcptWidth / rcptBizFmt), gift?:true (קבלת מתנה – בלי אף מחיר), copy?:true (הדפסה חוזרת),
              cashNo? (מספר הקופאי), cfg?:{ rcptCashier, rcptQr, rcptBarcode, rcptFooter, reprintMark, docShowSaleId } }
     rows – שורות מופשטות שמתאם ההדפסה (ש7, Devices.print) הופך לתמונה: { t:'c'|'b'|'lr'|'hr'|'qr'|'bc'|'sp', a?, b? }.
   כללים (אפיון ב מ3–מ14): מע"מ תמיד בנפרד; הנחה – גם בשורה נפרדת וגם במחיר; מספר קופאי בלבד; בלי מספר מכירה פנימי (רק מספר המסמך);
   ברקוד ו-QR של מספר המסמך; קבלת מתנה – הדפסה נוספת של אותו מסמך, בלי מחירים; הערה חופשית מודפסת. סכומים באגורות. */
(function (root) {
'use strict';
const DOC_N = { ir: 'חשבונית מס קבלה', inv: 'חשבונית מס', rc: 'קבלה', cr: 'חשבונית זיכוי' };
const PAY_N = { cash: 'מזומן', card: 'אשראי', check: 'צ\'ק', transfer: 'העברה בנקאית', bit: 'ביט', paybox: 'פייבוקס', gift: 'כרטיס מתנה', voucher: 'פתק זיכוי', extGift: 'כרטיס מתנה חיצוני', link: 'תשלום בקישור' };
const sh = (ag) => { const n = Math.round(Number(ag) || 0); const s = n < 0 ? '-' : ''; const a = Math.abs(n); return s + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0'); };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qtyTxt = (q) => (Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000));
const dt = (t) => { const d = new Date(t); const f = (o) => d.toLocaleString('he-IL', Object.assign({ timeZone: 'Asia/Jerusalem' }, o)); return f({ day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + f({ hour: '2-digit', minute: '2-digit', hour12: false }); };

function build(data, opt) {
  opt = opt || {};
  const cfg = opt.cfg || {};
  const s = (data && data.sale) || {}, hdr = (data && data.hdr) || {}, docs = (data && data.docs) || [], pays = (data && data.pays) || [];
  const fmt = opt.fmt === 'a4' ? 'a4' : opt.fmt === '58' || opt.fmt === 58 ? '58' : '80';
  const cols = fmt === '58' ? 32 : fmt === 'a4' ? 90 : 48;
  const gift = opt.gift === true;
  const rows = [];
  const add = (t, a, b) => rows.push(b === undefined ? { t, a } : { t, a, b });
  // ---- ראש ----
  if (hdr.name) add('b', hdr.name);
  if (hdr.brand && hdr.brand !== hdr.name) add('c', hdr.brand);
  if (hdr.brName) add('c', hdr.brName);
  if (hdr.addr) add('c', hdr.addr);
  if (hdr.phone) add('c', 'טל\' ' + hdr.phone);
  if (hdr.bn) add('c', 'עוסק מורשה ' + hdr.bn);
  if (hdr.rcptHdr) add('c', hdr.rcptHdr);
  add('hr');
  const main = docs[0];
  if (gift) add('b', 'קבלת מתנה');
  for (const d of docs) add('b', (DOC_N[d.t] || d.t) + ' ' + d.no + (d.ser === 'D' ? ' (טיוטה)' : ''));
  if (!docs.length) add('b', 'ממתין למסמך');
  if (opt.copy && cfg.reprintMark === true) add('c', 'העתק');
  if (cfg.docShowSaleId === true && s.id) add('c', 'מכירה ' + s.id);
  add('lr', dt(s.soldAt || s.at), cfg.rcptCashier === 'none' ? '' : 'קופאי ' + (opt.cashNo != null ? opt.cashNo : '—'));
  const cs = main && main.custSnap;
  if (cs && cs.name) { add('lr', 'לקוח', cs.name); if (cs.bn) add('lr', 'ע.מ', cs.bn); if (cs.addr) add('lr', 'כתובת', cs.addr); }
  if (main && main.alloc) add('lr', 'מספר הקצאה', main.alloc);
  add('hr');
  // ---- שורות ----
  for (const l of s.lines || []) {
    if (gift) { add('lr', l.n, '× ' + qtyTxt(l.qty)); continue; }
    add('lr', l.n, sh(Math.round(l.unit * l.qty)));
    if (l.qty !== 1) add('lr', '  ' + qtyTxt(l.qty) + ' × ' + sh(l.unit), '');
    if (l.disc > 0) add('lr', '  הנחה' + (l.promo ? ' (מבצע)' : l.cpn ? ' (קופון)' : ''), '-' + sh(l.disc));
  }
  add('hr');
  if (!gift) {
    const md = s.manDisc && s.manDisc.amt;
    if (md > 0) add('lr', 'הנחה על החשבון', '-' + sh(md));
    add('lr', 'סה"כ לפני מע"מ', sh(s.net));
    add('lr', 'מע"מ ' + (s.rate != null ? s.rate : '') + '%', sh(s.vat));
    add('b', 'סה"כ לתשלום ' + sh(s.gross) + ' ₪');
    add('hr');
    for (const p of pays) {
      let x = PAY_N[p.m] || p.m;
      if (p.m === 'card' && p.last4) x += ' ' + p.last4 + (p.inst > 1 ? ' (' + p.inst + ' תשלומים)' : '');
      if (p.m === 'check' && p.chk) x += ' ' + p.chk.no + (p.due ? ' לפירעון ' + p.due : '');
      if (p.ref && p.m !== 'card') x += ' אסמ\' ' + p.ref;
      add('lr', x, sh(p.amt));
    }
    if (s.chg > 0) add('lr', 'עודף', sh(s.chg));
    if (s.debt > 0) add('lr', 'יתרה בהקפה', sh(s.debt));
  }
  if (s.note) { add('sp'); add('c', s.note); }
  // ---- תחתית ----
  if (main && cfg.rcptBarcode !== false) add('bc', main.id);
  if (main && cfg.rcptQr !== false) add('qr', main.id); // הקישור להורדה – גל 3 (posDocPdf); עד אז מזהה המסמך
  if (cfg.rcptFooter) add('c', cfg.rcptFooter);
  return { width: fmt === 'a4' ? 210 : Number(fmt), cols, rows, text: toText(rows, cols), html: toHtml(rows, fmt) };
}
// טקסט (תצוגה מקדימה / מדפסת טקסט): שורת lr – ימין ושמאל באותה שורה
function toText(rows, cols) {
  const pad = (a, b) => { a = String(a || ''); b = String(b || ''); const n = Math.max(1, cols - a.length - b.length); return (a + ' '.repeat(n) + b).slice(0, Math.max(cols, a.length + b.length + 1)); };
  const ctr = (a) => { a = String(a || ''); const n = Math.max(0, Math.floor((cols - a.length) / 2)); return ' '.repeat(n) + a; };
  return rows.map((r) => (r.t === 'hr' ? '-'.repeat(cols) : r.t === 'sp' ? '' : r.t === 'lr' ? pad(r.a, r.b) : r.t === 'qr' ? ctr('[QR ' + r.a + ']') : r.t === 'bc' ? ctr('|| ' + r.a + ' ||') : ctr(r.a))).join('\n');
}
function toHtml(rows, fmt) {
  const w = fmt === 'a4' ? '190mm' : fmt === '58' ? '54mm' : '76mm';
  const body = rows.map((r) => {
    if (r.t === 'hr') return '<hr>';
    if (r.t === 'sp') return '<div style="height:6px"></div>';
    if (r.t === 'lr') return `<div class="lr"><span>${esc(r.a)}</span><span dir="ltr">${esc(r.b)}</span></div>`;
    if (r.t === 'qr') return `<div class="c qr" data-qr="${esc(r.a)}">[QR]</div>`;
    if (r.t === 'bc') return `<div class="c bc" data-bc="${esc(r.a)}" dir="ltr">${esc(r.a)}</div>`;
    return `<div class="${r.t === 'b' ? 'c b' : 'c'}">${esc(r.a)}</div>`;
  }).join('');
  return `<div class="rcpt" dir="rtl" style="width:${w};font-family:monospace;font-size:${fmt === 'a4' ? '12pt' : '10pt'}"><style>.rcpt .lr{display:flex;justify-content:space-between;gap:8px}.rcpt .c{text-align:center}.rcpt .b{font-weight:700}.rcpt hr{border:0;border-top:1px dashed currentColor}</style>${body}</div>`;
}
const api = { build, toText, toHtml, sh, DOC_N, PAY_N };
if (typeof module === 'object' && module.exports) module.exports = api; else root.PosReceipt = api;
})(typeof self !== 'undefined' ? self : this);
