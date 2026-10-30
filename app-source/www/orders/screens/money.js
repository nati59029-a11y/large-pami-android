/* עזרים משותפים למסכי המנהל ולכרטיס הלקוח (שלב 2.6ב): איך מציגים מספר חשבונית, מצב תשלום וחסימה.
   מקום אחד לכל התוויות, כדי שאותו מספר חשבונית ואותה יתרה יוצגו בדיוק אותו דבר בכל המסכים.
   הסכומים עצמם תמיד מהשרת (חשבוניות, wholesale_terms, getReports) – כאן אין שום חישוב כספי. */
import { esc } from '../ui.js';

export const DOC_LABEL = { tax_invoice_receipt: 'חשבונית מס/קבלה', tax_invoice: 'חשבונית מס (שוטף)', credit_invoice: 'חשבונית זיכוי', receipt: 'קבלה' };
export const PAY_LABEL = { open: 'פתוחה', to_collect: 'לגבות', paid: 'שולם', credited: 'זוכתה' };
// מספר חשבונית לתצוגה: "סוג מספר". המספר הוא inv.number; במסמך ישן בלי number – החלק האחרון של המזהה.
export const invNo = (v) => `${DOC_LABEL[v.docType] || v.docType || 'מסמך'} ${v.number != null ? v.number : String(v.id || '').split('_').pop()}`;
export const invNoById = (id) => { const m = /^(.*)_(\d+)$/.exec(String(id || '')); return m ? `${DOC_LABEL[m[1]] || m[1]} ${m[2]}` : String(id || ''); };
export const blockReason = { overdue_payment: 'תשלום באיחור', credit_limit: 'חריגה מתקרת החוב' };
// מצב החשבון של סיטונאי: "חסום" כשיש orderBlock פעיל, אחרת "תקין"
export const isBlocked = (c) => !!(c && c.orderBlock && c.orderBlock.active === true);
export const stateTag = (c) => (isBlocked(c)
  ? `<span class="tag bad">חסום${c.orderBlock.reason ? ' – ' + esc(blockReason[c.orderBlock.reason] || c.orderBlock.reason) : ''}</span>`
  : '<span class="tag ok">תקין</span>');
export const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL'); };
export const fmtTime = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); };
// קישור וואטסאפ לטלפון ישראלי (050-1234567 ← 972501234567). טלפון שלא נראה כמו מספר – אין קישור.
export function waLink(phone) {
  let d = String(phone || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('0')) d = '972' + d.slice(1);
  return /^\d{9,15}$/.test(d) ? 'https://wa.me/' + d : '';
}
