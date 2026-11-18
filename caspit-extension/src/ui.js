// תוסף כספית – עזרים משותפים לחלון הקופץ ולעמוד ההגדרות
'use strict';
const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m).catch((e) => ({ ok: false, code: 'fail', msg: String(e && e.message || '') }));
const when = (ms) => (ms ? new Date(ms).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const dayHe = (d) => (d ? d.split('-').reverse().join('/') : '—');
function msg(t, kind) { const el = $('msg'); if (!el) return; el.textContent = t || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
// מצב לתצוגה: { cls, t, n }
function view(s) {
  const M = self.CxPlan.MSG;
  if (!s.connected) return { cls: 'warn', t: 'לא מחובר לאפליקציה', n: 'פתחו "חיבור לאפליקציה והגדרות" והדביקו את הקוד מהאפליקציה (סנכרון כספית → רובוט).' };
  if (s.busy && s.discSt && s.discSt.st === 'run') return { cls: 'run', t: 'מצב היכרות רץ', n: 'אל תסגרו את הלשונית של כספית עד הסיום.' };
  const r = s.run;
  if (r && r.st === 'run' && s.busy) return { cls: 'run', t: M.run, n: r.day ? 'מכירות של ' + dayHe(r.day) : '' };
  if (r && r.st === 'wait') return { cls: 'warn', t: M.wait, n: 'ניסיון חוזר: ' + when(r.retryAt) + (r.err ? ' · ' + r.err.msg : '') };
  const L = s.st && s.st.lastRun;
  if (L && L.st === 'needs-login') return { cls: 'bad', t: 'צריך להתחבר לכספית', n: M['needs-login'] };
  if (L && L.st === 'fail') return { cls: 'bad', t: 'הסנכרון האחרון נכשל', n: L.msg || M.fail };
  if (L && L.st === 'ok') return { cls: 'ok', t: M.ok, n: when(L.at) };
  return { cls: '', t: 'עוד לא היה סנכרון', n: 'הסנכרון הראשון ירוץ בשעה ' + (s.sched && s.sched.at || '03:00') + ', או לחצו "סנכרן עכשיו".' };
}
async function downloadDisc() {
  const r = await send({ t: 'getDisc' });
  if (!r.ok || !r.rep) return msg('אין עדיין דוח היכרות', 'bad');
  const url = URL.createObjectURL(new Blob([JSON.stringify(r.rep, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'caspit-discovery-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  msg('הדוח נשמר בתיקיית ההורדות', 'ok');
}
