// תוסף כספית – מריץ צעדי מסך (selectors.json) בתוך הלשונית של כספית, בעולם המבודד של התוסף (לא נגיש לדף).
// סט צעדים קבוע בלבד: nav | waitFor | click | select | setDate | setFile | text. אין הרצת קוד מהקובץ.
// מטרה (t): { css, text, textAny:[], aria, tag, nth, alt:{מטרה חלופית} } – קודם css/aria, אחר כך טקסט מדויק, ואז טקסט מוכל. רק רכיבים גלויים.
// מצב probe (היכרות): מבצע רק nav וצעדים שמסומנים safe; צעד submit לעולם לא מבוצע; מדווח לכל צעד אם נמצא.
// לעולם לא ממלא סיסמה או שם משתמש: setDate/setFile מסרבים לשדות סיסמה, ואין צעד "הקלדה" כללי.
(function (root) {
'use strict';
const OPS = new Set(['nav', 'waitFor', 'click', 'select', 'setDate', 'setFile', 'text']);
const CLICKABLE = 'button,a,[role=button],[role=menuitem],[role=tab],[role=option],li,input[type=button],input[type=submit],label,span,div';
const norm = (s) => String(s == null ? '' : s).replace(/[‎‏]/g, '').replace(/[”“״"]/g, '"').replace(/\s+/g, ' ').trim();
const own = (el) => norm(el.innerText != null && el.innerText !== '' ? el.innerText : el.textContent);
function visible(el) {
  if (!el) return false;
  if (typeof el.getClientRects === 'function') { const r = el.getClientRects(); if (r && r.length === 0) return false; }
  if (el.hidden) return false;
  return true;
}
const isPass = (el) => el && String(el.tagName).toLowerCase() === 'input' && String(el.type || el.getAttribute && el.getAttribute('type') || '').toLowerCase() === 'password';
function all(doc, css) { try { return Array.from(doc.querySelectorAll(css)); } catch (e) { return []; } }
// הרכיב הקטן ביותר שהטקסט שלו מתאים (כדי ללחוץ על הכפתור ולא על כל התפריט)
function byText(doc, texts, tag, exact) {
  const T = texts.map(norm).filter(Boolean);
  if (!T.length) return [];
  const cand = all(doc, tag || CLICKABLE).filter(visible).filter((el) => {
    const t = own(el);
    if (!t || t.length > 200) return false;
    return T.some((x) => (exact ? t === x : t.includes(x)));
  });
  return cand.filter((el) => !cand.some((o) => o !== el && el.contains && el.contains(o)));
}
function find(doc, t) {
  if (!t || typeof t !== 'object') return null;
  const nth = Number.isInteger(t.nth) ? t.nth : 0;
  let list = [];
  if (t.css) list = all(doc, t.css).filter(visible);
  if (!list.length && t.aria) list = all(doc, '[aria-label]').filter((el) => norm(el.getAttribute('aria-label')).includes(norm(t.aria))).filter(visible);
  const texts = t.text ? [t.text] : Array.isArray(t.textAny) ? t.textAny : [];
  if (!list.length && texts.length) { list = byText(doc, texts, t.tag, true); if (!list.length) list = byText(doc, texts, t.tag, false); }
  if (!list.length && !t.css && !t.aria && !texts.length && t.tag) list = all(doc, t.tag).filter(visible);
  return list[nth] || (t.alt ? find(doc, t.alt) : null);
}
function fire(el, type, win) {
  const W = win || (el.ownerDocument && el.ownerDocument.defaultView) || root;
  const E = type === 'click' ? (W.MouseEvent || W.Event) : W.Event;
  el.dispatchEvent(new E(type, { bubbles: true, cancelable: true }));
}
// כותבים ערך דרך ה-setter המקורי כדי שגם React/Angular יראו את השינוי
function setValue(el, v, win) {
  const W = win || (el.ownerDocument && el.ownerDocument.defaultView) || root;
  const proto = W.HTMLInputElement && el instanceof W.HTMLInputElement ? W.HTMLInputElement.prototype : W.HTMLSelectElement && el instanceof W.HTMLSelectElement ? W.HTMLSelectElement.prototype : null;
  const d = proto && Object.getOwnPropertyDescriptor(proto, 'value');
  if (d && d.set) d.set.call(el, v); else el.value = v;
  fire(el, 'input', W); fire(el, 'change', W);
}
// תאריך YYYY-MM-DD לפי הפורמט של השדה: date → YYYY-MM-DD, אחרת DD/MM/YYYY (או fmt מפורש)
function dateFor(el, day, fmt) {
  const [y, m, d] = String(day).split('-');
  const f = fmt || (String(el.type || '').toLowerCase() === 'date' ? 'yyyy-mm-dd' : 'dd/mm/yyyy');
  return f.replace('yyyy', y).replace('mm', m).replace('dd', d);
}
const fill = (s, vars) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
function b64bytes(b64) {
  const bin = (typeof atob === 'function' ? atob : (s) => Buffer.from(s, 'base64').toString('binary'))(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function cssPath(el) {
  const out = [];
  let e = el;
  for (let i = 0; e && e.tagName && i < 5; i++, e = e.parentElement) {
    let s = String(e.tagName).toLowerCase();
    if (e.id && /^[A-Za-z][\w-]{0,40}$/.test(e.id) && !/\d{3,}/.test(e.id)) { out.unshift(s + '#' + e.id); break; }
    const cls = String(e.className && typeof e.className === 'string' ? e.className : '').split(/\s+/).filter((c) => c && !/^ng-|\d{3,}/.test(c)).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    out.unshift(s);
  }
  return out.join('>');
}
const desc = (el) => (el ? { tag: String(el.tagName).toLowerCase(), css: cssPath(el), text: own(el).slice(0, 40) } : null);

async function waitFind(doc, t, ms, sleep, now) {
  const end = now() + (ms || 15000);
  for (;;) {
    const el = find(doc, t);
    if (el) return el;
    if (now() >= end) return null;
    await sleep(250);
  }
}
// בחירת אפשרות: <select> אמיתי לפי טקסט האפשרות, או רשימה נפתחת: לוחצים על השדה ואז על האפשרות
async function choose(doc, el, option, ctx) {
  const want = norm(option);
  if (String(el.tagName).toLowerCase() === 'select') {
    const opts = Array.from(el.options || el.querySelectorAll('option'));
    const o = opts.find((x) => norm(x.textContent) === want) || opts.find((x) => norm(x.textContent).includes(want));
    if (!o) return false;
    setValue(el, o.value, ctx.win);
    return true;
  }
  el.click();
  await ctx.sleep(300);
  const o = await waitFind(doc, { text: option, tag: '[role=option],li,a,button,span,div,mat-option' }, 4000, ctx.sleep, ctx.now);
  if (!o) return false;
  o.click();
  return true;
}
// מריץ את הצעדים. ctx: { doc, win, vars, files:{name:{name,mime,b64}}, probe, sleep, now, onCapture(i) }
// → { ok, steps:[{ i, op, found, done, el }], miss: i | null, text }
async function runSteps(steps, ctx) {
  const doc = ctx.doc, sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))), now = ctx.now || (() => Date.now());
  const C = Object.assign({}, ctx, { sleep, now });
  const res = { ok: true, steps: [], miss: null, text: '' };
  if (!Array.isArray(steps)) return { ok: false, steps: [], miss: 0, err: 'bad-steps' };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] || {};
    const rec = { i, op: s.op, found: false, done: false };
    res.steps.push(rec);
    if (!OPS.has(s.op)) { rec.err = 'bad-op'; res.ok = false; res.miss = i; break; }
    if (s.op === 'nav') {
      const h = fill(s.hash || '', ctx.vars);
      if (!/^#\/[\w\-/?=&.%]*$/.test(h)) { rec.err = 'bad-hash'; res.ok = false; res.miss = i; break; }
      // fresh: גם אם כבר נמצאים במסך – יוצאים ונכנסים, כדי שתוצאה ישנה לא תיראה כמו תוצאה חדשה
      if (ctx.win && ctx.win.location.hash === h && s.fresh) { ctx.win.location.hash = '#/'; await sleep(s.ms || 1500); }
      if (ctx.win && ctx.win.location.hash !== h) ctx.win.location.hash = h;
      rec.found = rec.done = true;
      await sleep(s.ms || 1500);
      continue;
    }
    const el = await waitFind(doc, s.t, ctx.probe ? Math.min(s.ms || 6000, 6000) : s.ms || 15000, sleep, now);
    rec.found = !!el;
    rec.el = desc(el);
    if (!el) { if (s.optional) continue; res.ok = false; if (res.miss == null) res.miss = i; if (ctx.probe) continue; break; }
    if (s.op === 'waitFor') { rec.done = true; continue; }
    if (s.op === 'text') { res.text = own(el).slice(0, 500); rec.done = true; continue; }
    if (ctx.probe && (s.submit || !s.safe)) continue; // היכרות: לא משנים כלום בכספית
    if (isPass(el)) { rec.err = 'password-field'; res.ok = false; res.miss = i; break; }
    if (s.op === 'click') {
      if (s.capture && typeof ctx.onCapture === 'function') await ctx.onCapture(i);
      el.click();
    } else if (s.op === 'select') {
      if (!(await choose(doc, el, fill(s.option, ctx.vars), C))) { rec.err = 'no-option'; res.ok = false; res.miss = i; break; }
    } else if (s.op === 'setDate') {
      setValue(el, dateFor(el, fill(s.value, ctx.vars), s.fmt), ctx.win);
    } else if (s.op === 'setFile') {
      const f = ctx.files && ctx.files[s.file];
      const W = ctx.win;
      if (!f || !W || !W.DataTransfer || String(el.type).toLowerCase() !== 'file') { rec.err = 'no-file'; res.ok = false; res.miss = i; break; }
      const dt = new W.DataTransfer();
      dt.items.add(new W.File([b64bytes(f.b64)], f.name, { type: f.mime || 'text/csv' }));
      el.files = dt.files;
      fire(el, 'input', W); fire(el, 'change', W);
    }
    rec.done = true;
    await sleep(s.wait || 600);
  }
  return res;
}
// היכרות: רשימת הפקדים בדף – בלי ערכים, בלי שדות סיסמה
function controls(doc, max) {
  const out = [];
  const els = all(doc, 'button,a,input,select,textarea,[role=button],[role=menuitem],[role=tab],[role=link],label').filter(visible);
  for (const el of els) {
    if (out.length >= (max || 400)) break;
    if (isPass(el)) continue;
    const tag = String(el.tagName).toLowerCase(), g = (k) => (el.getAttribute ? el.getAttribute(k) : null);
    const c = { tag, css: cssPath(el) };
    const type = g('type'); if (type) c.type = type;
    for (const k of ['name', 'id', 'aria-label', 'placeholder', 'role', 'href']) { const v = g(k); if (v) c[k === 'aria-label' ? 'aria' : k] = String(v).slice(0, 80); }
    if (c.href && !/^#/.test(c.href)) c.href = '(ext)';
    // פרטיות (בדיקת אבטחה סבב 1): טקסט רק לכפתורים ולקישורים שמחוץ לטבלאות ולרשימות נתונים (שם יש שמות פריטים ולקוחות);
    // אפשרויות של רשימת בחירה – רק ברשימה קצרה (עד 30, כמו "סוג ייבוא"), אחרת רק המספר. הכול עובר גם את הסינון (sanitize) לפני היציאה
    const inData = el.closest && el.closest('table,tbody,tr,td,[role=grid],[role=row],[role=gridcell],[role=cell],[role=listbox],[role=option]');
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') { const t = inData ? '' : own(el).slice(0, 40); if (t) c.text = t; else if (inData) c.inData = true; }
    if (tag === 'select') { const op = Array.from(el.options || []); if (op.length <= 30) c.options = op.map((o) => norm(o.textContent).slice(0, 60)); else c.optN = op.length; }
    out.push(c);
  }
  return out;
}
// דף התחברות? נתיב התחברות, או שדה סיסמה גלוי בלי סימן של המערכת המחוברת (shell, למשל התפריט "ממשקים").
// כך שדה סיסמה בתוך המערכת (למשל "סיסמת מנהל") לא נחשב לדף התחברות.
function isLogin(doc, win, cfg) {
  const L = cfg || {};
  const h = win && win.location ? String(win.location.hash || '') + String(win.location.pathname || '') : '';
  if ((L.hash || []).some((x) => h.toLowerCase().includes(String(x).toLowerCase()))) return true;
  if (!all(doc, L.css || 'input[type=password]').some(visible)) return false;
  return !(L.shell && find(doc, L.shell));
}
const api = { OPS, norm, find, runSteps, controls, isLogin, dateFor, fill, cssPath, b64bytes };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxSel = api;
})(typeof self !== 'undefined' ? self : this);
