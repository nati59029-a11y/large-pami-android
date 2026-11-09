'use strict';
// חבילות ניוד, הנחות ומבצעים (משימה 2026-11-09_חבילות-ניוד, שלב 2). פונקציה טהורה – בלי Firestore, כדי שהטופס יוכל להריץ אותה נוסחה.
// כל החישוב באגורות (שלמים). קלט כבר מאומת (השרת מנקה לפני כן).
//
// חבילה (lineplan): ship/sim = { amt (₪), pay: 'store' | 'carrier' }, monthly (₪, מוצג בלבד).
//   "לחנות" נוסף לסכום ההזמנה; "לחברה" ועלות חודשית – מוצגים בלבד, ההנחה לא נוגעת בהם.
// הגדרות (ordcfg/cell): disc[חברה] = {t:'amt'|'pct', v} הנחה קבועה לכל קו; cap[חברה] = {t,v} תקרה להנחה ידנית (אין = בלי הגבלה);
//   promos = [{ id, name, carriers:[..], min, kind:'line'|'once', disc:{t,v}, stack:'add'|'replace', on, from?, to? }]
// ידני (מההזמנה): lines[i] = {t,v} הנחה לקו; order = {t,v} הנחה להזמנה; promo = { id, off?:true, disc?:{t,v} } שינוי/ביטול מבצע.
//
// כללים (00-בקשה.md):
//   1. קבועה: לכל קו לפי החברה שלו. סכום – לקו; אחוז – מהתשלום לחנות של הקו.
//   2. מבצע פעיל כשמספר הקווים לכל החברות המשתתפות (יחד) >= min, והוא פעיל בתאריך (from/to כולל, אופציונלי).
//      'line' = ההנחה לכל קו משתתף; 'once' = הנחה אחת (אחוז – מסך התשלום לחנות של הקווים המשתתפים).
//      'add' = נוסף לקבועה; 'replace' = מבטל את הקבועה בקווים המשתתפים. כמה מבצעים – רק המשתלם ביותר.
//      מבצע באחוזים "פעם אחת" להזמנה – אסור (החלטה 9.11): השרת דוחה בשמירה, וכאן מבצע כזה (ישן) לא חל.
//   3. הנחה ידנית **מחליפה** ולא מתווספת (החלטה 9.11), גם כשאין מבצע. 0 = בלי הנחה.
//      להזמנה (order): מחליפה את כל ההנחות (קבועה + מבצע). לקו (lines[i]): מחליפה את הקבועה של הקו; כשיש מבצע – אסור (משנים/מבטלים את המבצע).
//      שינוי מבצע (promo.disc) מחליף את הנחת המבצע; ביטול (promo.off) מחזיר לקבועה. לא משלבים הנחה להזמנה עם הנחה לקו.
//   4. תקרה (רק לעובד שאינו מנהל) – לכל קו לפי החברה שלו ("עד 50 ₪ לכל קו"; אחוז – מהתשלום לחנות של הקו).
//      הנחה לקו – עד תקרת הקו; הנחה להזמנה/שינוי מבצע – עד סכום תקרות הקווים שהיא חלה עליהם. קו שלחברה שלו אין תקרה = בלי הגבלה.
//   5. ההנחה יורדת מכל הסכום לחנות (פריטים + משלוח/סים לחנות), ולא מתחת ל-0 (החלטה 9.11).

const ag = (x) => Math.round(Number(x || 0) * 100);
const val = (d, baseAg) => (!d ? 0 : d.t === 'pct' ? Math.round(baseAg * d.v / 100) : ag(d.v));
const fee = (f, pay) => (f && typeof f.amt === 'number' && f.amt > 0 && (f.pay || 'store') === pay ? ag(f.amt) : 0);
const promoLive = (p, today) => p && p.on !== false && !(p.kind === 'once' && p.disc && p.disc.t === 'pct') && Array.isArray(p.carriers) && p.carriers.length
  && Number.isInteger(p.min) && p.min >= 1 && (!p.from || today >= p.from) && (!p.to || today <= p.to);

class CalcErr extends Error { constructor(reason, message) { super(message); this.reason = reason; } }

// ערך מבצע על סט קווים (L = [{c, store, fix}]) → { amt, total } או null אם לא עומד במינימום
function promoValue(p, L, disc) {
  const part = L.filter((l) => p.carriers.includes(l.c));
  if (part.length < p.min) return null;
  const pStore = part.reduce((s, l) => s + l.store, 0);
  const d = disc || p.disc;
  let amt = p.kind === 'once' ? val(d, pStore) : part.reduce((s, l) => s + val(d, l.store), 0);
  if (amt < 0) amt = 0;
  const fixAll = L.reduce((s, l) => s + l.fix, 0);
  const fixPart = part.reduce((s, l) => s + l.fix, 0);
  const total = (p.stack === 'replace' ? fixAll - fixPart : fixAll) + amt;
  return { amt, total, part: part.length, pStore, carriers: [...new Set(part.map((l) => l.c))] };
}
function bestPromo(promos, L) {
  let best = null;
  for (const p of promos) {
    const v = promoValue(p, L);
    if (v && v.amt > 0 && (!best || v.total > best.v.total)) best = { p, v };
  }
  return best;
}

// lines: [{ carrier?, plan? }] ; plans: Map id→lineplan ; cfg: { disc, cap, promos } ; man: { lines?, order?, promo? }
// opt: { itemsAg (סכום הפריטים באגורות), today 'YYYY-MM-DD', capped (true = עובד; תקרה חלה) }
function calcCell(lines, plans, cfg, man, opt) {
  cfg = cfg || {}; man = man || {}; opt = opt || {};
  const discCfg = cfg.disc || {}, capCfg = cfg.cap || {};
  const promos = (Array.isArray(cfg.promos) ? cfg.promos : []).filter((p) => promoLive(p, opt.today || ''));
  const L = lines.map((l) => {
    const pl = (l.plan && plans.get(l.plan)) || null;
    const c = (pl && pl.carrier) || l.carrier || '';
    const store = fee(pl && pl.ship, 'store') + fee(pl && pl.sim, 'store');
    const ext = fee(pl && pl.ship, 'carrier') + fee(pl && pl.sim, 'carrier');
    const monthly = pl && typeof pl.monthly === 'number' ? ag(pl.monthly) : 0;
    const fix = Math.max(0, val(c && discCfg[c], store)); // סכום – מלא לכל קו (יורד מכל ההזמנה); אחוז – מהתשלום לחנות של הקו
    return { c, store, ext, monthly, fix };
  });
  const storeAg = L.reduce((s, l) => s + l.store, 0);
  const room = Math.max(0, (opt.itemsAg || 0) + storeAg);
  const lineCap = (l) => (capCfg[l.c] ? val(capCfg[l.c], l.store) : null); // אגורות; null = בלי הגבלה
  const capSum = (ls) => { let m = 0; for (const l of ls) { const a = lineCap(l); if (a == null) return null; m += a; } return m; };
  const overCap = (msg, a, cap) => { if (opt.capped && cap != null && a > cap) throw new CalcErr('over-cap', `${msg} עוברת את התקרה (₪${cap / 100}).`); };
  const best = bestPromo(promos, L);
  const manLines = Array.isArray(man.lines) ? man.lines : [];
  const hasLines = manLines.some((d) => d);
  if (hasLines && man.order) throw new CalcErr('bad-manual', 'הנחה ידנית: להזמנה או לקווים, לא שתיהן.');
  if (man.order && man.promo) throw new CalcErr('bad-manual', 'הנחה ידנית להזמנה מחליפה את המבצע – אין צורך לשנות אותו.');
  let promo = null, disc;
  if (man.order) { // מחליפה הכול (קבועה + מבצע)
    disc = Math.max(0, val(man.order, room));
    overCap('הנחה ידנית להזמנה', disc, capSum(L));
    if (best) promo = { id: best.p.id, name: best.p.name, amt: 0, off: true, carriers: best.v.carriers };
  } else if (best) {
    if (hasLines) throw new CalcErr('promo-active', `יש מבצע פעיל ("${best.p.name}") – הנחה ידנית לקו לא נוספת עליו. אפשר לשנות את המבצע, לבטל אותו או לתת הנחה להזמנה.`);
    const ed = man.promo && man.promo.id === best.p.id ? man.promo : null;
    if (man.promo && !ed) throw new CalcErr('bad-promo', 'המבצע שנבחר כבר לא חל על ההזמנה. רעננו את הטופס.');
    if (ed && ed.off) {
      disc = L.reduce((s, l) => s + l.fix, 0);
      promo = { id: best.p.id, name: best.p.name, amt: 0, off: true, carriers: best.v.carriers };
    } else {
      let v = best.v;
      if (ed && ed.disc) {
        if (best.p.kind === 'once' && ed.disc.t === 'pct') throw new CalcErr('bad-promo', 'מבצע פעם אחת להזמנה – הנחה בסכום בלבד, לא באחוזים.');
        v = promoValue(best.p, L, ed.disc);
        overCap('שינוי המבצע', v.amt, capSum(L.filter((l) => best.p.carriers.includes(l.c))));
      }
      disc = v.total;
      promo = { id: best.p.id, name: best.p.name, amt: v.amt, carriers: v.carriers };
      if (ed && ed.disc) promo.edit = Object.assign({}, ed.disc);
    }
  } else {
    if (man.promo) throw new CalcErr('bad-promo', 'אין מבצע פעיל להזמנה הזו. רעננו את הטופס.');
    L.forEach((l, i) => { // ידנית לקו מחליפה את הקבועה של הקו
      const d = manLines[i]; if (!d) return;
      l.man = Math.max(0, val(d, l.store));
      overCap('הנחה ידנית לקו ' + (i + 1), l.man, lineCap(l));
    });
    disc = L.reduce((s, l) => s + (l.man != null ? l.man : l.fix), 0);
  }
  // לא מתחת ל-0: ההנחה מוגבלת לסכום לחנות (פריטים + ניוד)
  if (disc > room) disc = room;
  const out = {
    store: storeAg / 100, disc: disc / 100, net: (room - disc) / 100, ext: L.reduce((s, l) => s + l.ext, 0) / 100,
    monthly: L.reduce((s, l) => s + l.monthly, 0) / 100,
    lines: L.map((l) => ({ c: l.c, store: l.store / 100, fix: l.fix / 100, man: l.man != null ? l.man / 100 : null, ext: l.ext / 100, monthly: l.monthly / 100 })),
    promo, hint: hintOf(promos, L, disc),
  };
  return out;
}

// המלצה: האם העברת קו אחד (שאינו משתתף) לחברה משתתפת הייתה נותנת הנחה גדולה יותר? הסכום לחנות של הקו נשאר (הערכה – החבילה תשתנה).
function hintOf(promos, L, curDisc) {
  let best = null;
  for (const p of promos) {
    L.forEach((l, i) => {
      if (p.carriers.includes(l.c)) return;
      for (const c of p.carriers) {
        const L2 = L.map((x, j) => (j === i ? Object.assign({}, x, { c, fix: 0 }) : x));
        const v = promoValue(p, L2);
        if (!v || v.amt <= 0) continue;
        const gain = v.total - curDisc;
        if (gain > 0 && (!best || gain > best.gain)) best = { gain, line: i, promo: p, total: v.total };
      }
    });
  }
  if (!best) return null;
  const p = best.promo;
  const disc = best.total / 100;
  // הערכה (החבילה בחברה החדשה תשתנה) – לכן "עד" (החלטה 9.11)
  const msg = `העברת קו ${best.line + 1} ל${p.carriers.join(' / ')} תזכה במבצע "${p.name}" (${p.min} קווים ומעלה): הנחה של עד ₪${disc}`;
  return { line: best.line, promo: p.id, name: p.name, carriers: p.carriers.slice(), min: p.min, kind: p.kind, pdisc: Object.assign({}, p.disc), disc, gain: best.gain / 100, upTo: true, msg };
}

module.exports = { calcCell, CalcErr, promoLive, _t: { val, fee, promoValue, bestPromo, hintOf } };
