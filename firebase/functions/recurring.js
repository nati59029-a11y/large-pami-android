'use strict';
// משימות קבועות (12.11.2026): recurringTasks – פונקציה מתוזמנת, כל 5 דקות, שעון ישראל.
// לכל עסק שתוספת המשימות מופעלת אצלו (ולארג' פעמי במצב legacy – בשורש): עוברת על rtk (כללים פעילים, on == true),
// ולכל כלל שהגיע מועדו (lib/tk-time.js: decide) פותחת משימת מנהל ב-tasks של אותו עסק, עם מזהה קבוע r-<rid>-<YYYYMMDD>.
// בלי כפילויות: create נכשל אם המסמך כבר קיים (ריצה כפולה / שתי ריצות במקביל), והכלל מסמן last = התאריך של היום.
// נמענים: רק מי שב-staff/{uid} עם active == true (באותו עסק). אף אחד – לא נפתחת משימה, ונכתב err בכלל.
// השדות זהים למשימת מנהל חדשה מהאפליקציה (FRM.tkAdd), ובנוסף rc = מזהה הכלל. due = tkDue(now) – זהה לאפליקציה.
// אזור: us-central1 בלבד (מתוזמנת – אסור להריץ כפול; lib/region.js).

const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { LEGACY_REGION } = require('./lib/region');
const T = require('./lib/tenant');
const TK = require('./lib/tk-time');

if (!getApps().length) initializeApp();

const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);

// בונה את מסמך המשימה מהכלל ומהנמענים הפעילים (to/toN מסוננים). now = זמן הריצה.
function taskDoc(rid, r, to, toN, now) {
  const one = to.length === 1;
  const np = Number.isInteger(r.np) && r.np >= 0 && r.np <= 3 ? r.np : 0;
  return {
    owner: str(r.owner, 128), by: str(r.by, 100), role: 'a', txt: str(r.txt, 500), cr: now, due: TK.tkDue(now),
    st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '',
    to, toN, ow: one ? to[0] : '', owN: one ? toN[0] : '', clt: one ? now : 0, np, wp: 0, mi: 0, rc: rid,
  };
}

// כלל אחד. מחזיר 'created' / 'exists' / 'no-recipients' / 'bad' / סיבת הדילוג מ-decide
async function runRule(db, prefix, snap, now) {
  const r = snap.data() || {};
  const d = TK.decide(r, now);
  if (!d.go) return d.why;
  const rid = snap.id;
  if (typeof r.txt !== 'string' || !r.txt.trim() || !Array.isArray(r.to) || !r.to.length) {
    await snap.ref.update({ last: d.day, err: 'bad-rule' });
    return 'bad';
  }
  const names = Array.isArray(r.toN) ? r.toN : [];
  const pairs = r.to.slice(0, 30).map((u, i) => [String(u || ''), str(names[i], 100)]).filter(([u]) => /^[A-Za-z0-9_-]{1,128}$/.test(u));
  const snaps = pairs.length ? await db.getAll(...pairs.map(([u]) => db.doc(prefix + 'staff/' + u))) : [];
  const live = pairs.filter((p, i) => snaps[i].exists && snaps[i].get('active') === true);
  if (!live.length) {
    await snap.ref.update({ last: d.day, err: 'no-recipients' });
    return 'no-recipients';
  }
  const tref = db.doc(prefix + 'tasks/r-' + rid + '-' + d.key);
  const b = db.batch();
  b.create(tref, taskDoc(rid, r, live.map((p) => p[0]), live.map((p) => p[1]), now));
  b.update(snap.ref, { last: d.day, n: FieldValue.increment(1), err: '' });
  try {
    await b.commit();
    return 'created';
  } catch (e) {
    if (e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)))) {
      await snap.ref.update({ last: d.day });
      return 'exists';
    }
    throw e;
  }
}

// כל העסקים. opts.now – לבדיקות. מחזיר { [bizId]: { created, skipped..., error } }
async function runAll(opts) {
  const now = (opts && opts.now) || Date.now();
  const db = getFirestore();
  const out = {};
  for (const biz of await T.bizzesWith('tasks')) {
    const res = (out[biz.bizId] = {});
    if (biz.status !== 'active' || !biz.features.tasks) { res.skipped = 'inactive'; continue; }
    try {
      const prefix = T.bizPrefix(biz);
      const rules = await db.collection(prefix + 'rtk').where('on', '==', true).get();
      for (const s of rules.docs) {
        try { const k = await runRule(db, prefix, s, now); res[k] = (res[k] || 0) + 1; } catch (e) {
          logger.error('recurringTasks: rule failed', { biz: biz.bizId, rule: s.id, name: e && e.name, code: e && e.code });
          res.error = (res.error || 0) + 1;
        }
      }
    } catch (e) {
      logger.error('recurringTasks: biz failed', { biz: biz.bizId, name: e && e.name, code: e && e.code });
      res.error = (res.error || 0) + 1;
    }
  }
  return out;
}

exports.recurringTasks = onSchedule({ region: LEGACY_REGION, schedule: 'every 5 minutes', timeZone: TK.TZ, timeoutSeconds: 120, memory: '256MiB' }, async () => {
  const out = await runAll();
  if (Object.values(out).some((r) => r.created || r.error)) logger.info('recurringTasks', out);
});

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_core', { enumerable: false, value: { runAll, runRule, taskDoc } });
