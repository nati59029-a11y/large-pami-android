'use strict';
// המזכירה – שלב 3: הכלים של הצ'אט ל"מידע על העסק", למידע הרגיש וליומן (5.4, 5.5). נקרא מ-sec-tools.js (runTool).
// כלי קריאה מחזירים סיכום קצר + _at (נכון ל-) למקור. כלי "propose" לא משנים שום נתון קיים: הם יוצרים רק הצעה ממתינה
// (st: 'prop') ומחזירים כרטיס לאישור. עובדה/אירוע נכנסים לשימוש רק אחרי לחיצת "אשר" של המנהל (secFacts/secCal – approve).
// המידע הרגיש נמסר רק דרך ctx.sensRead, שקיים רק כשהמתג העסקי פעיל + למנהל יש הרשאה (secretary.js). אחרת הכלי לא מוצע בכלל.

const T = require('./tenant');
const K = require('./sec-know');

const S = (props, req) => ({ type: 'object', properties: props, required: req || [] });
const str = (d) => ({ type: 'string', description: d });
const DECL = {
  getBusinessFacts: { description: 'מידע על העסק שהמנהל אישר: שעות, כתובות, סניפים, ספקים, עובדים (תפקידים), מטרות, כללי תשובה, ומחירון. לשאלות על העסק עצמו.', parameters: S({ topic: { type: 'string', enum: Object.keys(K.TOPICS).concat(['price', 'all']), description: 'נושא (לא חובה)' }, query: str('מילת חיפוש (לא חובה), למשל שם ספק או פריט') }) },
  proposeFact: { description: 'להציע למנהל לשמור עובדה קבועה על העסק שעלתה בשיחה. לא נשמר – נוצר כרטיס, והמנהל מאשר או מבטל. אסור להציע כך מידע על בריאות, היריון, משפחה או מידע אישי רגיש אחר על עובד – אותו המנהל שומר במסך המידע הרגיש.', parameters: S({ topic: { type: 'string', enum: Object.keys(K.TOPICS) }, text: str('העובדה במשפט אחד'), expires: str('תאריך תפוגה YYYY-MM-DD, רק אם העובדה זמנית') }, ['topic', 'text']) },
  getCalendar: { description: 'אירועים ביומן: היומן האישי של המנהל ואירועי העסק המשותפים.', parameters: S({ from: str('מתאריך YYYY-MM-DD (ברירת מחדל: היום)'), to: str('עד תאריך YYYY-MM-DD (ברירת מחדל: עוד 30 יום)') }) },
  proposeCalendarEvent: { description: 'להציע אירוע ביומן. לא נוצר – נוצר כרטיס, והמנהל מאשר או מבטל.', parameters: S({ title: str('כותרת קצרה'), date: str('YYYY-MM-DD'), time: str('HH:MM (לא חובה)'), note: str('הערה (לא חובה)'), forBusiness: { type: 'boolean', description: 'אירוע של העסק (כל המנהלים רואים). ברירת מחדל: אישי' } }, ['title', 'date']) },
  getSensitiveInfo: { description: 'מידע רגיש ששמר המנהל על עובד מסוים (למשל בריאות או משפחה). רק להסבר נתונים, לעולם לא כבסיס להמלצה לפגוע בעובד.', parameters: S({ employee: str('שם העובד') }, ['employee']) },
};
const NAMES = Object.keys(DECL);
const SCREEN = { getBusinessFacts: 'facts', proposeFact: 'facts', getCalendar: 'cal', proposeCalendarEvent: 'cal', getSensitiveInfo: 'facts' };
const LABEL = {
  getBusinessFacts: (a) => 'מידע על העסק' + (a.topic && K.TOPICS[a.topic] ? ' – ' + K.TOPICS[a.topic] : a.topic === 'price' ? ' – מחירון' : ''),
  proposeFact: () => 'הצעה לשמירת עובדה (ממתינה לאישור)', getCalendar: () => 'יומן', proposeCalendarEvent: () => 'הצעה לאירוע ביומן (ממתינה לאישור)',
  getSensitiveInfo: () => 'מידע רגיש על עובד (מוצפן)',
};
const WHERE = { getBusinessFacts: 'מידע על העסק', getCalendar: 'יומן המזכירה', getSensitiveInfo: 'מידע רגיש', proposeFact: 'הצעה', proposeCalendarEvent: 'הצעה' };

async function factsOf(db) {
  const s = await db.collection('sec_facts').limit(K.FACTS_MAX + K.PROP_MAX + 10).get();
  return s.docs.filter((d) => d.id !== 'price').map((d) => K.factOut(d.id, d.data()));
}

async function run(name, a, ctx) {
  const db = T.tdb();
  const today = K.dayOf(ctx.now);
  switch (name) {
    case 'getBusinessFacts': {
      const q = K.normHe(a.query || '');
      const topic = typeof a.topic === 'string' ? a.topic : 'all';
      const all = await factsOf(db);
      const live = all.filter((f) => f.st === 'ok' && !K.expired(f, today));
      const hit = (s) => !q || K.tokens(q).every((w) => K.tokens(s).some((v) => K.tokMatch(v, w) || v.includes(w)));
      let L = topic === 'price' ? [] : live.filter((f) => (topic === 'all' || f.topic === topic) && hit(f.text + ' ' + (f.fx ? K.FIXED[f.fx] || '' : '')));
      // עובדות סותרות (49) – מסומנות זוגות, כדי שהמזכירה תציג את שתיהן ותשאל
      const conflicts = [];
      for (const f of L) for (const c of K.conflictsOf(f, L)) if (f.id < c.id) conflicts.push([f.id, c.id]);
      L = L.slice(0, 50);
      const out = { count: L.length, facts: L.map((f) => Object.assign({ id: f.id, topic: K.TOPICS[f.topic], text: (f.fx ? K.FIXED[f.fx] + ': ' : '') + f.text, updated: K.dayOf(f.t || ctx.now) }, f.exp ? { expires: f.exp } : {})) };
      if (conflicts.length) { out.conflicts = conflicts.slice(0, 10); out.conflictNote = 'יש עובדות שנראות סותרות. הציגי את שתיהן ושאלי את המנהל איזו נכונה – אל תבחרי בעצמך.'; }
      let at = L.reduce((m, f) => Math.max(m, f.t || 0), 0);
      if (topic === 'price' || topic === 'all' || q) {
        const ps = await db.doc('sec_facts/price').get();
        if (ps.exists && Array.isArray(ps.get('rows'))) {
          const rows = ps.get('rows').filter((r) => !q || hit(r.n)).slice(0, 50);
          if (rows.length || topic === 'price') { out.priceList = { name: ps.get('name') || 'מחירון', updated: K.dayOf(ps.get('at') || ctx.now), rows: rows.map((r) => (r.u ? { item: r.n, price: r.p, unit: r.u } : { item: r.n, price: r.p })) }; at = Math.max(at, ps.get('at') || 0); }
        }
      }
      if (!out.count && !out.priceList) out.note = 'אין במידע על העסק עובדה שמתאימה. אפשר לשאול את המנהל ולהציע לשמור (proposeFact).';
      out._at = at || ctx.now;
      return out;
    }
    case 'proposeFact': {
      const topic = K.TOPICS[a.topic] ? a.topic : 'general';
      const text = K.clean(a.text, K.FACT_MAX);
      if (!text || text.length > K.FACT_MAX) return { error: 'bad-input', note: 'עובדה ריקה או ארוכה מדי (עד 500 תווים)' };
      const exp = typeof a.expires === 'string' && K.validDay(a.expires) && a.expires >= today ? a.expires : '';
      const all = await factsOf(db);
      if (all.filter((f) => f.st === 'prop').length >= K.PROP_MAX) return { error: 'too-many', note: 'יש כבר הרבה הצעות שממתינות לאישור. בקשי מהמנהל לעבור עליהן במסך "מידע על העסק".' };
      const conflict = K.conflictsOf({ id: '', topic, text }, all);
      const ref = db.collection('sec_facts').doc();
      const doc = { topic, text, st: 'prop', src: 'chat', by: ctx.uid, t: ctx.now };
      if (exp) doc.exp = exp;
      await ref.set(doc);
      ctx.cards.push(Object.assign({ k: 'fact', id: ref.id, topic, text }, exp ? { exp } : {}, conflict.length ? { conflict } : {}));
      return Object.assign({ proposed: true, needsApproval: true, note: 'נוצר כרטיס לאישור. העובדה לא נשמרה עד שהמנהל יאשר.' }, conflict.length ? { conflictsWith: conflict.map((c) => c.text) } : {});
    }
    case 'getCalendar': {
      const from = K.validDay(a.from) ? a.from : today;
      const to = K.validDay(a.to) && a.to >= from ? a.to : K.addDays(from, 30);
      const s = await db.collection('sec_cal').where('uid', 'in', ['', ctx.uid]).limit(K.CAL_MAX).get();
      const L = s.docs.map((d) => K.calOut(d.id, d.data(), ctx.uid)).filter((e) => e.st === 'ok' && e.d >= from && e.d <= to)
        .sort((x, y) => (x.d + (x.tm || '')).localeCompare(y.d + (y.tm || ''))).slice(0, 50);
      return { from, to, count: L.length, events: L.map((e) => Object.assign({ date: e.d, title: e.title, whose: e.biz ? 'של העסק' : 'אישי' }, e.tm ? { time: e.tm } : {})), _at: ctx.now };
    }
    case 'proposeCalendarEvent': {
      const ev = K.cleanEvent({ title: a.title, d: a.date, tm: a.time || '', note: a.note || '' });
      if (!ev) return { error: 'bad-input', note: 'חסרה כותרת או שהתאריך/השעה לא תקינים (YYYY-MM-DD, HH:MM)' };
      if (ev.d < today) return { error: 'past', note: 'התאריך כבר עבר' };
      const pend = await db.collection('sec_cal').where('uid', '==', ctx.uid).where('st', '==', 'prop').limit(K.CAL_PROP_MAX).get();
      if (pend.size >= K.CAL_PROP_MAX) return { error: 'too-many', note: 'יש כבר הרבה הצעות שממתינות לאישור ביומן.' };
      const to = a.forBusiness === true ? 'biz' : 'me';
      const ref = db.collection('sec_cal').doc();
      await ref.set(Object.assign({ uid: ctx.uid, to, st: 'prop', src: 'sec', by: ctx.uid, t: ctx.now }, ev));
      const off = K.offKind(ev.d);
      const card = Object.assign({ k: 'cal', id: ref.id, to }, ev);
      // שישי/שבת/חג (72): לפי הגדרת המנהל – להזהיר ולהציע יום אחר (ברירת מחדל) או לקבל בלי הערה
      if (off && ctx.we !== 'accept') card.warn = { kind: off, next: K.nextBizDay(ev.d) };
      ctx.cards.push(card);
      return Object.assign({ proposed: true, needsApproval: true, note: 'נוצר כרטיס לאישור. האירוע לא נוצר עד שהמנהל יאשר.' }, card.warn ? { warning: 'התאריך נופל ב' + off + '. הציעי את ' + card.warn.next + ' כחלופה.' } : {});
    }
    case 'getSensitiveInfo': {
      if (typeof ctx.sensRead !== 'function') return { error: 'not-available', note: 'הכלי לא זמין' }; // הגנה כפולה: הכלי גם לא מוצע
      const r = await ctx.sensRead(a.employee);
      return Object.assign(r, { rule: 'מידע רגיש – רק להסבר נתונים. לעולם לא כבסיס להמלצה לפגוע בעובד (פיטורים, קידום, שכר, משמרות).' });
    }
    default: return { error: 'unknown-tool' };
  }
}

module.exports = { DECL, NAMES, SCREEN, LABEL, WHERE, run, factsOf };
