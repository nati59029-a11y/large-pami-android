// בדיקה/השלמה חד-פעמית: חשבוניות ספק של עובדים שנשלחו בחלון המעבר (22.11.2026) ולא נכנסו לתמחור.
// MODE=check – קריאה בלבד. MODE=fix – יוצר pinv דרך אותו קוד של piInbox (onInbox).
const path = require("path");
const FN0 = path.resolve(process.argv[2]);
const rq = require("module").createRequire(FN0 + "/index.js");
const { initializeApp, cert } = rq("firebase-admin/app");

const FN = FN0;
initializeApp({ credential: cert(require(process.env.SA)) });
const { getFirestore } = rq("firebase-admin/firestore");
const fs = getFirestore();
const PIM = require(FN + '/pricing-inbox.js')._core;
const FROM = Date.parse('2026-11-21T22:00:00Z'), TO = Date.parse('2026-11-22T13:30:00Z');
(async () => {
  const qs = await fs.collectionGroup('inbox').get();
  for (const s of qs.docs) {
    const x = s.data(); const t = Number(x.t) || (s.createTime && s.createTime.toMillis()) || 0;
    if (t < FROM || t > TO) continue;
    let d = {}; try { d = JSON.parse(x.data || '{}'); } catch (e) {}
    const m = s.ref.path.match(/^b\/([^/]+)\/inbox\//); const bizId = m ? m[1] : null; const pfx = bizId ? 'b/' + bizId + '/' : '';
    const pid = 'i' + PIM.rqOf('o' + s.id);
    const pinv = (await fs.doc(pfx + 'pinv/' + pid).get()).exists;
    const np = Number(x.parts) || 0; let ch = 0;
    for (let k = 0; k < np; k++) if ((await fs.doc(pfx + 'chunks/' + s.id + '_' + k).get()).exists) ch++;
    const el = PIM.eligible(Object.assign({}, x, { status: 'new' }));
    console.log([new Date(t).toISOString(), bizId || 'root', d.subName || '-', d.amt, 'status=' + x.status, 'elig=' + (el.r || 'ok'), 'pinv=' + pinv, 'chunks=' + ch + '/' + np].join(' | '));
    if (process.env.MODE === 'fix' && !pinv && !el.r && ch === np) {
      const r = await PIM.onInbox(bizId, s.id, Object.assign({}, x, { status: 'new' }), {});
      console.log('  -> ' + JSON.stringify(r));
    }
  }
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
