/* עזרים קטנים לממשק של לשונית "הזמנות אתר": בניית HTML בטוח, הודעות, חלון אישור, וכסף. */
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

// סכום בשקלים לתצוגה: ‏24.90 ₪
export const ils = (n) => (n == null || n === '' || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₪');
// מחיר עלות בלי מע"מ ← עם מע"מ, באגורות שלמות (כמו בשרת). vatRate באחוזים (למשל 18). null אם אין אחוז מע"מ בהגדרות.
export function withVat(cost, vatRate) {
  const c = Number(cost);
  if (cost === '' || cost == null || !Number.isFinite(c) || vatRate == null || !Number.isFinite(Number(vatRate))) return null;
  return Math.round(Math.round(c * 100) * (100 + Number(vatRate)) / 100) / 100;
}

export function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.setAttribute('role', bad ? 'alert' : 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 2800);
}

// חלון אישור בעברית (במקום confirm של הדפדפן)
let modalClose = null;
export const modalOpen = () => !!modalClose;
export function closeModal() { if (modalClose) modalClose(false); }
export function confirmBox(text, okLabel) {
  return new Promise((done) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><p>${esc(text)}</p><div class="row"><button class="btn" data-ok>${esc(okLabel || 'אישור')}</button><button class="btn g" data-no>ביטול</button></div></div>`;
    const end = (v) => { m.remove(); modalClose = null; done(v); };
    modalClose = end;
    m.querySelector('[data-ok]').onclick = () => end(true);
    m.querySelector('[data-no]').onclick = () => end(false);
    document.body.append(m);
  });
}

// מריץ פעולה עם כפתור "עסוק", ומציג שגיאה בעברית אם נכשלה. מחזיר את התוצאה, או undefined אם נכשלה.
export async function busy(btn, fn, okMsg) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = 'רגע…'; }
  try {
    const r = await fn();
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    return r;
  } catch (e) {
    toast(e && e.message ? e.message : 'שגיאה', true);
    return undefined;
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; }
  }
}

// קובץ ← base64 (בלי "data:...;base64,"). תמונה גדולה מוקטנת קודם (השרת מקבל עד 5MB).
export async function imageToB64(file, maxSide) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('הקובץ אינו תמונה שאפשר לקרוא')); i.src = url; });
    const k = Math.min(1, (maxSide || 2000) / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88).split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}

// שמירת קובץ: בטלפון דרך התוסף הקיים של האפליקציה (SaveFile), בדפדפן – הורדה רגילה
export async function saveFile(name, bytes, mime) {
  const C = window.Capacitor;
  if (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.SaveFile) {
    const u = new Uint8Array(bytes); let s = '';
    for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
    await C.Plugins.SaveFile.save({ filename: name, mime, data: btoa(s) });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ערך מטופס: טקסט מקוצץ. מספר נשאר טקסט – השרת בודק אותו ומחזיר הודעה בעברית אם הוא לא תקין.
export const val = (form, name) => { const e = form.elements[name]; if (!e) return undefined; if (e.type === 'checkbox') return e.checked; return String(e.value).trim(); };
// פסיק עשרוני שהוקלד בטופס ("24,90" או "12,5") הופך לנקודה. פסיק של אלפים ("1,250") נשאר, והשרת מטפל בו.
export const normDecimal = (v) => (typeof v === 'string' && /^-?\d+,\d{1,2}$/.test(v.trim()) ? v.trim().replace(',', '.') : v);
export const numOrText = (v0) => { const v = normDecimal(v0); return v === '' ? null : (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v); };
