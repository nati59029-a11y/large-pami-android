/* מסך "עוזר" (מנהל בלבד, שלב 3.8): שאלות נפוצות ומתכונים שהעוזר באתר עונה מהם, מצב העוזר ותקרותיו (קריאה),
   עדיפות מוצר להצעות העוזר, ושיחות אחרונות לבדיקה (בלי פרטי לקוח; השרת לא שומר אותם).
   כל כתיבה עוברת בפונקציות השרת (מנהל בלבד). המסך לא מחשב מחירים: מחיר מופיע באתר רק בכרטיס המוצר, מהמסד. */
import * as api from '../api.js';
import { esc, $, $$, toast, busy } from '../ui.js';

const needMgr = (root) => { if (api.isManager()) return true; root.innerHTML = '<div class="card"><p class="err">המסך הזה למנהל בלבד.</p></div>'; return false; };
const PRICE_WARN = 'תשובה זו תוצג כמו שהיא. המחיר המחייב הוא בכרטיס המוצר. ודאו שהיא מעודכנת';
// טקסט עם מחיר, אחוז, הנחה או מבצע – מציגים אזהרה (לא חוסמים: זה טקסט של המנהל)
const PRICE_RE = /₪|ש["״'']?ח|שקל|מחיר|עולה|עלות|מבצע|הנחה|קופון|חינם|במתנה|אחוז|\d\s*%|\d+[.,]\d{1,2}/;
export const hasPrice = (t) => PRICE_RE.test(String(t || ''));
const warnBox = (show) => `<div class="res warn" id="pw" role="alert" ${show ? '' : 'hidden'}>${esc(PRICE_WARN)}</div>`;
const when = (t) => { try { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };
// הפונקציות saveFaq ו-saveRecipe עוד לא קיימות בשרת של הגרסה הזו: שגיאת "לא נמצא" בלי פירוט = הפונקציה חסרה
// (באמולטור ובענן, פונקציה שלא קיימת מחזירה "not-found" או "internal" בלי פירוט)
const missingFn = (e) => /(not-found|internal)$/.test(String((e && e.code) || '')) && !(e.details && e.details.reason);
const MISSING = 'השמירה לא הצליחה. ייתכן שהפונקציה בשרת עוד לא נבנתה (בגרסת השרת הזו אין שמירה לשאלות ולמתכונים). הטקסט לא נשמר';
async function saveVia(btn, fn, okMsg) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = 'רגע…'; }
  try { const r = await fn(); toast(okMsg); return r; } catch (e) { toast(missingFn(e) ? MISSING : (e && e.message) || 'שגיאה', true); return undefined; } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
}
const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
const ils = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('he-IL', { maximumFractionDigits: 2 }) + ' ₪' : '—');

// ---------- המסך הראשי ----------
async function render(root, ctx) {
  if (!needMgr(root)) return;
  const [st, usage, faqs, recipes] = await Promise.all([api.getAssistantSettings(), api.getAssistantUsage().catch(() => null), api.listFaqs(), api.listRecipes()]);
  const on = st.enabled !== false;
  const spent = usage && Number.isFinite(usage.costIls) ? usage.costIls : 0;
  const cap = typeof st.monthlyBudgetIls === 'number' ? st.monthlyBudgetIls : 50;
  const row = (l, v) => `<div class="sum"><span>${esc(l)}</span><b>${esc(v)}</b></div>`;
  root.innerHTML = `<h2>העוזר באתר</h2>
    <div class="card"><h3 style="margin-top:0">מצב ותקרות</h3>
    <p>${on ? '<span class="tag ok">פעיל</span>' : '<span class="tag bad">כבוי ידנית</span>'}${usage && usage.disabledAt ? ' <span class="tag bad">נכבה בתקרה החודשית</span>' : ''}</p>
    ${row('הוצאה החודש / תקרה חודשית', `${ils(spent)} / ${ils(cap)}`)}
    ${row('הודעות למבקר בשעה / ביום', `${st.maxMessagesPerVisitorPerHour || 15} / ${st.maxMessagesPerVisitorPerDay || 40}`)}
    ${row('הודעות בשיחה', st.maxMessagesPerConversation || 20)}
    ${row('אורך הודעה מרבי (תווים)', st.maxMessageChars || 500)}
    ${row('שמירת שיחות (ימים)', st.retentionDays || 30)}
    ${row('הצעות מוצרים בתשובה', st.maxSuggestions || 6)}
    ${row('ביטויים חסומים נוספים', (st.blockedPhrases || []).length)}
    <p class="note">התקרה הכללית לאתר בשעה: ${esc(st.maxMessagesSitePerHour || 100)}.</p>
    <button class="btn w" id="cfg">עריכת הגדרות העוזר</button></div>
    <div class="row" style="margin:10px 0"><button class="btn grow" id="faq">שאלות ותשובות (${faqs.length})</button><button class="btn g grow" id="rec">מתכונים (${recipes.length})</button></div>
    <div class="row"><button class="btn g grow" id="prio">עדיפות מוצרים</button><button class="btn g grow" id="cv">שיחות אחרונות</button></div>
    <p class="note">העוזר עונה רק ממה שכתוב כאן ומהמוצרים באתר. מחיר מוצג תמיד בכרטיס המוצר, ולא מתוך טקסט.</p>`;
  $('#cfg').onclick = () => ctx.open((r) => settingsForm(r, ctx));
  $('#faq').onclick = () => ctx.open((r) => faqList(r, ctx));
  $('#rec').onclick = () => ctx.open((r) => recipeList(r, ctx));
  $('#prio').onclick = () => ctx.open((r) => priority(r, ctx));
  $('#cv').onclick = () => ctx.open((r) => conversations(r, ctx));
}

// ---------- עריכת הגדרות העוזר (שלב 3.8ג) ----------
// השדות והגבולות זהים לרשימה המותרת בשרת (lib/settings.js, מסמך private): מחוץ לטווח השרת דוחה.
// נשלחים רק שדות ששונו. הטופס נבנה ב-DOM עם textContent (בלי innerHTML).
export const ASSISTANT_FIELDS = [
  { k: 'monthlyBudgetIls', label: 'תקרה חודשית (₪)', min: 0, max: 100000, money: true, def: 50 },
  { k: 'budgetAlertPercent', label: 'התראה בהגעה לאחוז מהתקרה', min: 1, max: 100, def: 80 },
  { k: 'maxMessagesPerVisitorPerHour', label: 'הודעות למבקר בשעה', min: 1, max: 10000, def: 15 },
  { k: 'maxMessagesPerVisitorPerDay', label: 'הודעות למבקר ביום', min: 1, max: 100000, def: 40 },
  { k: 'maxMessagesSitePerHour', label: 'הודעות לכל האתר בשעה', min: 1, max: 100000, def: 100 },
  { k: 'maxMessagesPerConversation', label: 'הודעות בשיחה אחת', min: 1, max: 200, def: 20 },
  { k: 'maxMessageChars', label: 'אורך הודעה מרבי (תווים)', min: 20, max: 2000, def: 500 },
  { k: 'retentionDays', label: 'שמירת שיחות (ימים)', min: 1, max: 365, def: 30 },
];
// בדיקת ערך שהוקלד: מחזיר { v } או { err }
export function parseAssistantField(f, raw) {
  const t = String(raw == null ? '' : raw).trim();
  if (!t) return { err: f.label + ': חסר ערך' };
  if (!/^\d+(\.\d+)?$/.test(t)) return { err: f.label + ': צריך להיות מספר' };
  const n = Number(t);
  if (f.money) { if (!/^\d+(\.\d{1,2})?$/.test(t)) return { err: f.label + ': עד 2 ספרות אחרי הנקודה' }; } else if (!Number.isInteger(n)) return { err: f.label + ': מספר שלם' };
  if (n < f.min || n > f.max) return { err: f.label + ': בין ' + f.min + ' ל-' + f.max };
  return { v: n };
}
function mk(tag, props, text) { const e = document.createElement(tag); if (props) Object.assign(e, props); if (text != null) e.textContent = text; return e; }
async function settingsForm(root, ctx) {
  if (!needMgr(root)) return;
  const st = await api.getAssistantSettings();
  root.textContent = '';
  const bk = mk('button', { className: 'btn g s', id: 'bk' }, '‹ חזרה'); bk.onclick = () => ctx.back();
  root.append(bk, mk('h2', null, 'הגדרות העוזר'));
  const card = mk('form', { className: 'card', id: 'f' }); card.onsubmit = () => false;
  const ckLabel = mk('label', { className: 'ck' }); const ck = mk('input', { type: 'checkbox', name: 'enabled', checked: st.enabled !== false });
  ckLabel.append(ck, document.createTextNode('העוזר פעיל באתר')); card.append(ckLabel);
  const inputs = {};
  ASSISTANT_FIELDS.forEach((f) => {
    const cur = typeof st[f.k] === 'number' ? st[f.k] : f.def;
    const lab = mk('label', { className: 'f' }); const inp = mk('input', { name: f.k, value: String(cur), dir: 'ltr' });
    inp.setAttribute('inputmode', f.money ? 'decimal' : 'numeric'); inputs[f.k] = { f, inp, cur };
    lab.append(mk('span', null, f.label + ' (' + f.min + ' עד ' + f.max + ')'), inp); card.append(lab);
  });
  const save = mk('button', { className: 'btn w', id: 'save', type: 'button' }, 'שמור הגדרות');
  root.append(card, save, mk('p', { className: 'note' }, 'ערך שלא השתנה לא נשלח. הגדרות שלא מופיעות כאן (מודל, ביטויים חסומים) אינן ניתנות לשינוי מהאפליקציה.'));
  save.onclick = async () => {
    const values = {};
    if (ck.checked !== (st.enabled !== false)) values['assistant.enabled'] = ck.checked;
    for (const k of Object.keys(inputs)) {
      const { f, inp, cur } = inputs[k]; const r = parseAssistantField(f, inp.value);
      if (r.err) { toast(r.err, true); inp.focus(); return; }
      if (r.v !== cur) values['assistant.' + k] = r.v;
    }
    if (!Object.keys(values).length) { toast('לא שונה כלום'); return; }
    const r = await saveVia(save, () => api.updateSiteSettings('private', values), 'ההגדרות נשמרו');
    if (r) ctx.back();
  };
}

// ---------- שאלות ותשובות ----------
async function faqList(root, ctx) {
  if (!needMgr(root)) return;
  const list = (await api.listFaqs()).sort((a, b) => (Number.isFinite(a.order) ? a.order : 1e9) - (Number.isFinite(b.order) ? b.order : 1e9) || String(a.question).localeCompare(String(b.question), 'he'));
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>שאלות ותשובות <small class="note">(${list.length})</small></h2>
    <button class="btn w" id="add" style="margin-bottom:10px">＋ שאלה חדשה</button>
    <div id="lst">${list.map((f) => `<button class="li" data-id="${esc(f.id)}"><div class="m"><b>${esc(f.question || f.id)}</b><small>${esc(String(f.answer || '').slice(0, 90))}</small></div>
      <div>${f.active === false ? '<span class="tag">כבויה</span>' : '<span class="tag ok">פעילה</span>'}${hasPrice(f.answer) ? ' <span class="tag bad">מחיר/מבצע</span>' : ''}${f.isDemo ? ' <span class="tag">דמו</span>' : ''}</div></button>`).join('') || '<p class="note">אין שאלות.</p>'}</div>`;
  $('#bk').onclick = () => ctx.back();
  $('#add').onclick = () => ctx.open((r) => faqEdit(r, ctx, null));
  $$('#lst [data-id]').forEach((b) => { b.onclick = () => ctx.open((r) => faqEdit(r, ctx, list.find((x) => x.id === b.dataset.id))); });
}
async function faqEdit(root, ctx, f) {
  if (!needMgr(root)) return;
  const n = f || { active: true };
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${f ? 'עריכת שאלה' : 'שאלה חדשה'}</h2>
    <form id="f" class="card" onsubmit="return false">
    <label class="f"><span>השאלה (כמו שלקוח ישאל)</span><input name="question" maxlength="300" value="${esc(n.question || '')}" required></label>
    <label class="f"><span>התשובה</span><textarea name="answer" rows="5" maxlength="1000" required>${esc(n.answer || '')}</textarea></label>
    ${warnBox(hasPrice(n.answer))}
    <label class="f"><span>סדר (מספר קטן = קודם; לא חובה)</span><input name="order" inputmode="numeric" dir="ltr" value="${esc(Number.isFinite(n.order) ? n.order : '')}"></label>
    <label class="ck"><input type="checkbox" name="active" ${n.active !== false ? 'checked' : ''}>השאלה פעילה</label>
    </form><button class="btn w" id="save">${f ? 'שמור שינויים' : 'הוסף שאלה'}</button>`;
  $('#bk').onclick = () => ctx.back();
  const fm = $('#f');
  fm.answer.addEventListener('input', () => { $('#pw').hidden = !hasPrice(fm.answer.value); });
  $('#save').onclick = async (ev) => {
    const question = fm.question.value.trim(); const answer = fm.answer.value.trim();
    if (!question || !answer) { toast('כתבו שאלה ותשובה', true); return; }
    const o = fm.order.value.trim();
    if (o && !/^-?\d{1,6}$/.test(o)) { toast('הסדר צריך להיות מספר שלם', true); return; }
    const faq = { question, answer, active: fm.active.checked }; if (o) faq.order = Number(o);
    const r = await saveVia(ev.target, () => api.saveFaq(Object.assign({ faq }, f ? { faqId: f.id } : {})), 'נשמר');
    if (r) ctx.back();
  };
}

// ---------- מתכונים ----------
async function recipeList(root, ctx) {
  if (!needMgr(root)) return;
  const list = (await api.listRecipes()).sort((a, b) => String(a.title).localeCompare(String(b.title), 'he'));
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>מתכונים <small class="note">(${list.length})</small></h2>
    <button class="btn w" id="add" style="margin-bottom:10px">＋ מתכון חדש</button>
    <div id="lst">${list.map((r) => `<button class="li" data-id="${esc(r.id)}"><div class="m"><b>${esc(r.title || r.id)}</b><small>${esc((r.ingredients || []).length)} מרכיבים · ${esc((r.steps || []).length)} שלבים${Number.isInteger(r.servings) ? ' · ל-' + esc(r.servings) : ''}</small></div>
      <div>${r.active === false ? '<span class="tag">כבוי</span>' : '<span class="tag ok">פעיל</span>'}${r.isDemo ? ' <span class="tag">דמו</span>' : ''}</div></button>`).join('') || '<p class="note">אין מתכונים.</p>'}</div>`;
  $('#bk').onclick = () => ctx.back();
  $('#add').onclick = () => ctx.open((r) => recipeEdit(r, ctx, null));
  $$('#lst [data-id]').forEach((b) => { b.onclick = () => ctx.open((r) => recipeEdit(r, ctx, list.find((x) => x.id === b.dataset.id))); });
}
async function recipeEdit(root, ctx, rc) {
  if (!needMgr(root)) return;
  const prods = (await api.listProducts()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  const n = rc || { active: true, relatedProductIds: [] };
  const sel = new Set(n.relatedProductIds || []);
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>${rc ? 'עריכת מתכון' : 'מתכון חדש'}</h2>
    <form id="f" class="card" onsubmit="return false">
    <label class="f"><span>שם המתכון</span><input name="title" maxlength="120" value="${esc(n.title || '')}" required></label>
    <label class="f"><span>מרכיבים (שורה לכל מרכיב, עד 25)</span><textarea name="ingredients" rows="5">${esc((n.ingredients || []).join('\n'))}</textarea></label>
    <label class="f"><span>שלבי ההכנה (שורה לכל שלב, עד 25)</span><textarea name="steps" rows="5">${esc((n.steps || []).join('\n'))}</textarea></label>
    ${warnBox(hasPrice([n.title, ...(n.ingredients || []), ...(n.steps || [])].join(' ')))}
    <label class="f"><span>לכמה מנות (לא חובה)</span><input name="servings" inputmode="numeric" dir="ltr" value="${esc(Number.isInteger(n.servings) ? n.servings : '')}"></label>
    <label class="f"><span>מוצרים קשורים (עד 5; לחיצה ארוכה לבחירה של כמה)</span><select name="rel" multiple size="6">${prods.map((p) => `<option value="${esc(p.id)}" ${sel.has(p.id) ? 'selected' : ''}>${esc(p.name)} · ${esc(p.sku || '')}</option>`).join('')}</select></label>
    <label class="ck"><input type="checkbox" name="active" ${n.active !== false ? 'checked' : ''}>המתכון פעיל</label>
    </form><button class="btn w" id="save">${rc ? 'שמור שינויים' : 'הוסף מתכון'}</button>`;
  $('#bk').onclick = () => ctx.back();
  const fm = $('#f');
  const upd = () => { $('#pw').hidden = !hasPrice([fm.title.value, fm.ingredients.value, fm.steps.value].join(' ')); };
  ['title', 'ingredients', 'steps'].forEach((k) => fm[k].addEventListener('input', upd));
  $('#save').onclick = async (ev) => {
    const title = fm.title.value.trim(); const ing = lines(fm.ingredients.value); const steps = lines(fm.steps.value);
    const rel = [...fm.rel.selectedOptions].map((o) => o.value); const sv = fm.servings.value.trim();
    if (!title) { toast('כתבו שם למתכון', true); return; }
    if (ing.length > 25 || steps.length > 25) { toast('עד 25 מרכיבים ועד 25 שלבים', true); return; }
    if (rel.length > 5) { toast('אפשר לקשור עד 5 מוצרים', true); return; }
    if (sv && !/^\d{1,3}$/.test(sv)) { toast('מספר המנות צריך להיות מספר שלם', true); return; }
    if (sv && Number(sv) <= 0) { toast('מספר המנות חייב להיות 1 או יותר. 0 מנות אינו תקין', true); return; }
    const recipe = { title, ingredients: ing, steps, relatedProductIds: rel, active: fm.active.checked }; if (sv) recipe.servings = Number(sv);
    const r = await saveVia(ev.target, () => api.saveRecipe(Object.assign({ recipe }, rc ? { recipeId: rc.id } : {})), 'נשמר');
    if (r) ctx.back();
  };
}

// ---------- עדיפות מוצר (setProductCost עם assistantPriority; העלות נשלחת כמו שהיא, בלי שינוי) ----------
const PRIO = ['0 – רגיל', '1 – מועדף קצת', '2 – מועדף', '3 – מועדף מאוד'];
async function priority(root, ctx) {
  if (!needMgr(root)) return;
  const prods = (await api.listProducts()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>עדיפות מוצרים</h2>
    <p class="note">מוצר בעדיפות גבוהה יופיע ראשון בהצעות העוזר. העדיפות לא משנה מחיר.</p>
    <label class="f"><span>חיפוש מוצר (שם או מק"ט)</span><input id="q" autocomplete="off"></label>
    <div id="pl"></div><div id="pe"></div>`;
  $('#bk').onclick = () => ctx.back();
  const draw = () => {
    const t = $('#q').value.trim().toLowerCase();
    const l = prods.filter((p) => !t || String(p.name).toLowerCase().includes(t) || String(p.sku).toLowerCase().includes(t)).slice(0, 12);
    $('#pl').innerHTML = l.map((p) => `<button class="li" data-id="${esc(p.id)}"><div class="m"><b>${esc(p.name)}</b><small>${esc(p.sku || '')}</small></div></button>`).join('') || '<p class="note">לא נמצא.</p>';
    $$('#pl [data-id]').forEach((b) => { b.onclick = () => pick(prods.find((x) => x.id === b.dataset.id)); });
  };
  const pick = async (p) => {
    const c = await api.getCost(p.id);
    const cur = c && Number.isInteger(c.assistantPriority) ? c.assistantPriority : 0;
    $('#pe').innerHTML = `<div class="card"><h3 style="margin-top:0">${esc(p.name)}</h3><label class="f"><span>עדיפות</span><select id="pv">${PRIO.map((l, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn w" id="ps">שמור עדיפות</button></div>`;
    $('#pe').scrollIntoView({ block: 'nearest' });
    $('#ps').onclick = async (ev) => {
      const v = Number($('#pv').value);
      // העלות נשלחת כפי שנשמרה (או null אם אין), כדי שלא תשתנה
      const r = await busy(ev.target, () => api.setProductCost(p.id, c && c.cost != null ? c.cost : null, v), 'נשמר');
      if (r) pick(p);
    };
  };
  $('#q').oninput = draw; draw();
}

// ---------- שיחות אחרונות (קריאה בלבד) ----------
async function conversations(root, ctx) {
  if (!needMgr(root)) return;
  const list = await api.listConversations(30);
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>שיחות אחרונות <small class="note">(${list.length})</small></h2>
    <p class="note">השיחות לא מקושרות ללקוח (בלי שם, טלפון או כתובת), ופרטים אישיים שנכתבו בהן הוסרו. הן נמחקות מעצמן אחרי תקופת השמירה.</p>
    <div id="lst">${list.map((c) => { const m = Array.isArray(c.messages) ? c.messages : []; const first = m.find((x) => x.role === 'customer'); return `<button class="li" data-id="${esc(c.id)}"><div class="m"><b>${esc(String((first && first.text) || '—').slice(0, 70))}</b><small>${esc(when(c.startedAt))} · ${m.length} הודעות</small></div>
      <div>${c.flagged ? '<span class="tag bad">סומנה</span>' : ''}${c.isDemo ? ' <span class="tag">דמו</span>' : ''}</div></button>`; }).join('') || '<p class="note">אין שיחות.</p>'}</div>`;
  $('#bk').onclick = () => ctx.back();
  $$('#lst [data-id]').forEach((b) => { b.onclick = () => ctx.open((r) => conversation(r, ctx, list.find((x) => x.id === b.dataset.id))); });
}
function conversation(root, ctx, c) {
  const m = Array.isArray(c.messages) ? c.messages : [];
  root.innerHTML = `<button class="btn g s" id="bk">‹ חזרה</button><h2>שיחה</h2>
    <p class="note">${esc(when(c.startedAt))} · עלות ${esc(ils(c.costIls))}${c.flagged ? ' · סומנה לבדיקה' : ''}</p>
    ${m.map((x) => `<div class="card" style="${x.role === 'assistant' ? 'border-color:var(--gold)' : ''}"><small class="note">${x.role === 'assistant' ? 'העוזר' : 'לקוח'} · ${esc(when(x.at))}</small><p style="white-space:pre-wrap;margin:4px 0 0">${esc(x.text)}</p></div>`).join('') || '<p class="note">אין הודעות.</p>'}`;
  $('#bk').onclick = () => ctx.back();
}

export default { id: 'assistant', title: 'עוזר', roles: ['manager'], render };
