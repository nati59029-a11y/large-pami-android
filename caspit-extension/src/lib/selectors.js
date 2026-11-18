// תוסף כספית – מריץ צעדי מסך (selectors.json) בתוך הלשונית של כספית, בעולם המבודד של התוסף (לא נגיש לדף).
// סט צעדים קבוע בלבד: nav | waitFor | click | select | setDate | setFile | text. אין הרצת קוד מהקובץ.
// מטרה (t): { css, text, textAny:[], aria, tag, nth, hidden, alt:{מטרה חלופית} } (hidden: גם רכיב מוסתר – רק לשדה קובץ) – קודם css/aria, אחר כך טקסט מדויק, ואז טקסט מוכל. רק רכיבים גלויים.
// מצב probe (היכרות): מבצע רק nav וצעדים שמסומנים safe; צעד submit לעולם לא מבוצע; מדווח לכל צעד אם נמצא.
// לעולם לא ממלא סיסמה או שם משתמש: setDate/setFile מסרבים לשדות סיסמה, ואין צעד "הקלדה" כללי.
(function (root) {
'use strict';
const OPS = new Set(['nav', 'waitFor', 'click', 'select', 'setDate', 'setFile', 'text', 'queue', 'queueGone', 'queueEmpty', 'histMark']);
const CLICKABLE = 'button,a,[role=button],[role=menuitem],[role=tab],[role=option],li,input[type=button],input[type=submit],label,span,div';
const norm = (s) => String(s == null ? '' : s).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\u00a0/g, ' ').replace(/[”“״"]/g, '"').replace(/\s+/g, ' ').trim();
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
  if (t.css) list = all(doc, t.css).filter(t.hidden ? Boolean : visible);
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
  // רשימה נפתחת (למשל vue-multiselect בכספית – נפתחת ב-focus, לא בלחיצה): לוחצים, מפקסים, ומחכים שהאפשרויות יצוירו
  el.click();
  try { el.focus(); } catch (e) { /* */ }
  fire(el, 'focus', ctx.win);
  await ctx.sleep(300);
  const box = (el.closest && el.closest('.multiselect,[role=combobox],[role=listbox]')) || doc;
  const T = { text: option, tag: '.multiselect__option,[role=option]' };
  let o = await waitFind(box, T, 3000, ctx.sleep, ctx.now);
  if (!o) o = await waitFind(doc, { text: option, tag: '.multiselect__option,[role=option],li,a,button,span,div,mat-option' }, 2000, ctx.sleep, ctx.now);
  if (!o) return false;
  // vue-multiselect: הבחירה ב-span.multiselect__option (לחיצה על פנימי עולה אליו); mousedown לפני – כמו עכבר אמיתי
  const tgt = (o.closest && o.closest('.multiselect__option')) || o;
  fire(tgt, 'mousedown', ctx.win);
  tgt.click();
  await ctx.sleep(300);
  return true;
}
// טבלת "ממתין לטעינה" במסך הייבוא של כספית: הטבלה הראשונה אחרי הכותרת (head). → שורות [[שם, סוג]] או null אם אין כותרת
function queueRows(doc, s) {
  const h = byText(doc, [s.head || 'ממתין לטעינה'], 'h1,h2,h3,h4,h5,h6,legend,label,div,span,p,strong,b', true)[0];
  if (!h) return null;
  const F = 4; // Node.DOCUMENT_POSITION_FOLLOWING
  const tb = all(doc, 'table').find((t) => h.compareDocumentPosition(t) & F) || (h.closest && h.closest('section,div') && h.closest('section,div').querySelector('table'));
  if (!tb) return [];
  return all(tb, 'tr').filter((r) => visible(r) && r.querySelectorAll('td').length).map((r) => Array.from(r.querySelectorAll('td')).map((td) => own(td)));
}
// טבלת "טעינות קודמות" (קריאה בלבד – לעולם לא לוחצים בה, גם לא על "ביטול טעינה" או על קישור): עמודות לפי הכותרות.
// → { rows:[{ id, name, type, st, err, ok }], maxId } או null אם אין טבלה
function histRows(doc, head) {
  const h = byText(doc, [head || 'טעינות קודמות'], 'h1,h2,h3,h4,h5,h6,legend,label,div,span,p,strong,b', true)[0];
  if (!h) return null;
  const tb = all(doc, 'table').find((t) => h.compareDocumentPosition(t) & 4);
  if (!tb) return null;
  const H = all(tb, 'thead th, tr:first-child th').map((x) => own(x));
  const col = (f) => H.findIndex(f);
  const ci = { id: col((t) => t === 'מזהה'), name: col((t) => t === 'שם'), type: col((t) => t === 'סוג קובץ'), st: col((t) => t === 'סטטוס'), cnt: col((t) => /שגויים/.test(t) && /שורות|נטענו|סה"?כ/.test(t)) };
  if (ci.id < 0 || ci.name < 0 || ci.st < 0) return { rows: [], maxId: 0, bad: true };
  const rows = all(tb, 'tr').filter((r) => r.querySelectorAll('td').length).map((r) => {
    const td = Array.from(r.querySelectorAll('td')).map((x) => own(x));
    const c = ci.cnt >= 0 ? td[ci.cnt] || '' : '';
    const num = (re) => { const m = re.exec(c); return m ? +m[1] : null; };
    return { id: +(String(td[ci.id] || '').replace(/\D/g, '')) || 0, name: td[ci.name] || '', type: ci.type >= 0 ? td[ci.type] || '' : '', st: td[ci.st] || '', err: num(/שגויים\s*:?\s*(\d+)/), ok: num(/נטענו\s*:?\s*(\d+)/) };
  });
  return { rows, maxId: rows.reduce((m, r) => Math.max(m, r.id), 0) };
}
// שמירה לפני "העלה קבצים והרץ טעינה": בטבלה רק השורות שלנו (שם הקובץ + סוג). שורה של מישהו אחר – עוצרים, לא מסירים ולא מעלים
async function queueCheck(doc, s, C) {
  const name = norm(fill(s.name, C.vars)), type = norm(s.type || '');
  const end = C.now() + (s.ms || 15000);
  for (;;) {
    const R = queueRows(doc, s);
    if (R && R.length) {
      const mine = (r) => norm(r[0]) === name && (!type || norm(r[1]) === type);
      // רק שורה אחת בדיוק, והיא שלנו (שתי שורות "שלנו" = שארית מניסיון קודם → לא מעלים)
      if (R.some(mine)) return R.length === 1 ? { ok: true, n: 1 } : { ok: false, code: 'import-queue-not-empty', n: R.length };
    }
    if (C.now() >= end) return { ok: false, code: R ? (R.length ? 'import-queue-not-empty' : 'no-row') : 'no-queue' };
    await C.sleep(300);
  }
}
// לפני setFile: התור "ממתין לטעינה" חייב להיות ריק (אין טבלה / אין שורות). אחרת עוצרים לפני שמוסיפים את הקובץ שלנו
function queueEmpty(doc, s) {
  const R = queueRows(doc, s);
  return !R || !R.length ? { ok: true } : { ok: false, code: 'import-queue-not-empty', n: R.length };
}
// "טעינות קודמות" חייבת להיות קריאה לפני העלאה (בלי זה אי אפשר לדעת אם הקובץ כבר הועלה): מחכים לה, ואם לא – null
async function histWait(doc, s, C) {
  const end = C.now() + (s.ms || 15000);
  for (;;) {
    const H = histRows(doc, s.head);
    if (H && !H.bad) return H;
    if (C.now() >= end) return null;
    await C.sleep(300);
  }
}
async function queueGone(doc, s, C) {
  const name = norm(fill(s.name, C.vars)), end = C.now() + (s.ms || 300000);
  for (;;) {
    const R = queueRows(doc, s);
    if (!R || !R.some((r) => norm(r[0]) === name)) return true;
    if (C.now() >= end) return false;
    await C.sleep(500);
  }
}
// guard = { origin, path }: הדף חייב להיות באותו מקור, ובנתיב path (או מתחתיו)
function onPath(win, g) {
  try { const L = win.location, p = String(L.pathname || ''); return L.origin === g.origin && (p === g.path || p.startsWith(g.path + '/')); } catch (e) { return false; }
}
// לוח שנה (vuejs-datepicker, כמו בדוח המכירות של כספית): השדה לקריאה בלבד – פותחים את הלוח, עוברים לחודש הנכון ולוחצים על היום.
// הכותרת "נובמבר 2026" / "November 2026" / "11/2026". כפתורי החודש (prev/next) מתהפכים ב-RTL – לכן בודקים אחרי כל לחיצה לאן הלכנו.
// שמות מלאים או מקוצרים ("נוב 2026" בכספית, עם/בלי גרש): מילה של 3 אותיות לפחות שהיא תחילת שם החודש
const MONTHS = [['ינואר', 'january'], ['פברואר', 'february'], ['מרץ', 'march'], ['אפריל', 'april'], ['מאי', 'may'], ['יוני', 'june'], ['יולי', 'july'], ['אוגוסט', 'august'], ['ספטמבר', 'september'], ['אוקטובר', 'october'], ['נובמבר', 'november'], ['דצמבר', 'december']];
function monthYear(txt) {
  const t = norm(txt).toLowerCase().replace(/[׳'`"״.]/g, ''), y = /(\d{4})/.exec(t);
  if (!y) return null;
  const words = t.split(/[^a-z\u05d0-\u05ea]+/).filter((w) => w.length >= 3);
  let m = MONTHS.findIndex((names) => words.some((w) => names.some((nm) => nm.startsWith(w))));
  if (m < 0) { const n = /(\d{1,2})\s*[/.-]\s*\d{4}/.exec(t); m = n ? +n[1] - 1 : -1; }
  return m >= 0 && m < 12 ? { y: +y[1], m } : null;
}
const CAL = { root: '.vdp-datepicker', cal: '.vdp-datepicker__calendar', head: 'header .day__month_btn,header span:not(.prev):not(.next)', prev: '.prev', next: '.next', day: '.cell.day' };
async function pickCal(doc, el, day, cfg, C) {
  const K = Object.assign({}, CAL, cfg || {});
  const [Y, M, D] = String(day).split('-').map(Number);
  const box = (el.closest && el.closest(K.root)) || doc;
  el.click(); fire(el, 'focus', C.win);
  const calOf = () => all(box, K.cal).find(visible);
  let c = null;
  for (let k = 0; k < 20 && !c; k++) { c = calOf(); if (!c) await C.sleep(150); }
  if (!c) return false;
  const head = () => { const h = c.querySelector(K.head); return h ? monthYear(own(h)) : null; };
  const want = Y * 12 + (M - 1);
  let btn = null;
  for (let k = 0; k < 30; k++) {
    const h = head();
    if (!h) return false;
    const diff = want - (h.y * 12 + h.m);
    if (!diff) break;
    if (!btn) btn = diff < 0 ? K.prev : K.next;
    const b = c.querySelector(btn);
    if (!b) return false;
    b.click(); await C.sleep(200);
    const h2 = head();
    if (h2 && Math.abs(want - (h2.y * 12 + h2.m)) > Math.abs(diff)) btn = btn === K.prev ? K.next : K.prev; // הכיוון הפוך (RTL)
  }
  const h = head();
  if (!h || h.y * 12 + h.m !== want) return false;
  const cells = all(c, K.day).filter((x) => visible(x) && !/\b(blank|disabled)\b/.test(String(x.className)) && own(x) === String(D));
  if (cells.length !== 1) return false;
  cells[0].click(); await C.sleep(300);
  // אימות: היום והשנה בשדה, והחודש – כמספר או כשם ("17 נוב 2026")
  const v = String(el.value || ''), n = (v.match(/\d+/g) || []).map(Number), my = monthYear(v);
  return n.includes(D) && n.includes(Y) && (n.includes(M) || !!(my && my.m === M - 1));
}
async function setDateAny(doc, el, day, s, C) {
  if (el.readOnly || (el.closest && el.closest((s.cal && s.cal.root) || CAL.root))) return pickCal(doc, el, day, s.cal, C);
  setValue(el, dateFor(el, day, s.fmt), C.win);
  return true;
}
// היכרות: פותחים רכיב (רשימה נפתחת / לוח שנה) רק כדי לראות מה יש בו, רושמים טקסטים ומבנה, וסוגרים (Escape + לחיצה ריקה על הרקע). לא בוחרים כלום.
async function peek(doc, p, C) {
  const out = { found: false };
  const el = find(doc, p.open);
  if (!el || isPass(el)) return out;
  out.found = true; out.el = desc(el);
  el.click(); fire(el, 'focus', C.win);
  await C.sleep(p.ms || 600);
  const box = p.within ? (el.closest && el.closest(p.within)) || doc : doc;
  out.items = all(box, p.items || '[role=option],li').filter(visible).slice(0, p.max || 40).map((x) => own(x).slice(0, 60)).filter(Boolean);
  if (p.struct) {
    const s = all(box, p.struct).find(visible);
    if (s) out.struct = { css: cssPath(s), cls: String(s.className || '').slice(0, 80), kids: Array.from(s.querySelectorAll('*')).slice(0, 30).map((k) => String(k.tagName).toLowerCase() + (k.className && typeof k.className === 'string' ? '.' + k.className.trim().split(/\s+/).slice(0, 3).join('.') : '') + (k.children.length ? '' : ':' + own(k).slice(0, 20))) };
  }
  try { el.dispatchEvent(new (C.win.KeyboardEvent || C.win.Event)('keydown', { key: 'Escape', bubbles: true })); el.blur && el.blur(); } catch (e) { /* */ }
  fire(doc.body, 'mousedown', C.win); fire(doc.body, 'click', C.win);
  await C.sleep(200);
  return out;
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
    // שמירה (בעל העסק, 18.11): רק במערכת הניהול של כספית (/bo). קופת המכירה (שורש האתר) – לא נוגעים בכלל
    if (ctx.guard && !onPath(ctx.win, ctx.guard)) { rec.err = 'wrong-page'; res.ok = false; res.wrong = true; res.miss = i; break; }
    if (s.op === 'histMark') {
      // לפני ההעלאה: המזהה הגבוה בטבלת "טעינות קודמות"; ואם הקובץ שלנו (שם ייחודי לריצה) כבר שם – הועלה בניסיון קודם: לא מעלים שוב
      const H = ctx.probe ? histRows(doc, s.head) : await histWait(doc, s, C);
      if (!H || H.bad) {
        if (ctx.probe) continue;
        // לא קוראים את הטבלה → לא יודעים אם כבר הועלה → לא מעלים (selector-miss)
        rec.err = H ? 'hist-cols' : 'no-hist'; res.ok = false; res.miss = i; break;
      }
      const name = norm(fill(s.name, C.vars));
      res.hmax = H.maxId;
      const prev = H.rows.find((r) => norm(r.name) === name);
      rec.found = rec.done = true;
      if (prev) { res.already = prev.id; break; }
      continue;
    }
    if (s.op === 'queue' || s.op === 'queueGone' || s.op === 'queueEmpty') {
      if (ctx.probe) continue; // היכרות: אין קובץ בתור
      if (s.op === 'queueEmpty') {
        const q = queueEmpty(doc, s);
        rec.found = q.ok; rec.n = q.n;
        if (!q.ok) { rec.err = q.code; res.ok = false; res.miss = i; res.code = q.code; break; }
      } else if (s.op === 'queue') {
        const q = await queueCheck(doc, s, C);
        rec.found = q.ok; rec.n = q.n;
        if (!q.ok) { rec.err = q.code; res.ok = false; res.miss = i; if (q.code === 'import-queue-not-empty') res.code = q.code; break; }
      } else if (!(await queueGone(doc, s, C))) { rec.err = 'queue-stuck'; res.ok = false; res.miss = i; break; }
      rec.found = rec.done = true;
      continue;
    }
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
      if (!(await setDateAny(doc, el, fill(s.value, ctx.vars), s, C))) { rec.err = 'no-date'; res.ok = false; res.miss = i; break; }
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
// היכרות: רשימת הפקדים בדף – בלי ערכים, בלי שדות סיסמה. o.noText (דף לקריאה בלבד): בלי טקסט, בלי aria, בלי אפשרויות בחירה
// (רק מספרן), ו-href רק כסימן לקישור פנימי – כדי ששמות (למשל עובדים במסך הנוכחות) לא ייכנסו לדוח
// מילות פעולה של כפתורים (היכרות מסך לקריאה בלבד, o.btn)
const ACT = new Set(['הצג', 'חפש', 'חיפוש', 'יצוא', 'ייצוא', 'יצא', 'אקסל', 'לאקסל', 'excel', 'pdf', 'csv', 'הדפס', 'הדפסה', 'רענן', 'סנן', 'סינון', 'צור', 'הפק', 'נקה', 'אפס', 'קובץ', 'דוח', 'היום', 'אתמול', 'שבוע', 'חודש', 'תאריך', 'טווח', 'search', 'export', 'print', 'show', 'filter']);
const DATA = 'table,tbody,tr,td,[role=grid],[role=row],[role=gridcell],[role=cell],[role=listbox],[role=option]';
function controls(doc, max, o) {
  const noText = !!(o && o.noText);
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
    if (noText) {
      delete c.aria; delete c.placeholder;
      if (c.href && c.href !== '(ext)') c.href = '(int)';
      if (tag === 'select') c.optN = (el.options || []).length;
      // o.btn: גם טקסט של כפתורים שמחוץ לטבלאות ולרשימות (למשל "הצג", "יצוא לאקסל") – לא תוויות, לא אפשרויות, לא שדות
      if (o.btn && (tag === 'button' || g('role') === 'button' || (tag === 'input' && /^(button|submit)$/i.test(type || ''))) && !(el.closest && el.closest(DATA))) {
        // רק המילים שהן מילות פעולה (התאמה מלאה של מילה) – שם עובד, שעה או מספר על הכפתור לא נכנסים
        const w = [...new Set((tag === 'input' ? norm(el.value) : own(el)).toLowerCase().split(/[^a-z\u05d0-\u05ea]+/).filter((x) => ACT.has(x)))];
        if (w.length) c.text = w.join(' ').slice(0, 40);
      }
      out.push(c);
      continue;
    }
    // פרטיות (בדיקת אבטחה סבב 1): טקסט רק לכפתורים ולקישורים שמחוץ לטבלאות ולרשימות נתונים (שם יש שמות פריטים ולקוחות);
    // אפשרויות של רשימת בחירה – רק ברשימה קצרה (עד 30, כמו "סוג ייבוא"), אחרת רק המספר. הכול עובר גם את הסינון (sanitize) לפני היציאה
    const inData = el.closest && el.closest(DATA);
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
const api = { OPS, norm, find, onPath, runSteps, peek, monthYear, pickCal, histRows, queueRows, controls, isLogin, dateFor, fill, cssPath, b64bytes };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxSel = api;
})(typeof self !== 'undefined' ? self : this);
