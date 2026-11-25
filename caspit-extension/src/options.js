// תוסף כספית – עמוד החיבור וההגדרות
'use strict';
const CODE_MSG = { 'bad-token': 'הקוד לא תקין. העתיקו אותו שוב מהאפליקציה, בשלמותו.', auth: 'הקוד לא התקבל – אולי כבר נוצר קוד חדש או שהחיבור בוטל. צרו קוד חדש באפליקציה.' };
async function load() {
  const s = await send({ t: 'status' });
  if (!s || !s.ok) return;
  const v = view(s);
  $('dot').className = 'dot ' + v.cls;
  $('stT').textContent = v.t;
  $('stN').textContent = v.n;
  $('connC').classList.toggle('hide', s.connected);
  $('discC').classList.toggle('hide', !s.connected);
  $('biz').textContent = (s.biz && s.biz.name) || '—';
  $('at').textContent = (s.sched && s.sched.at) || '03:00';
  $('next').textContent = when(s.next);
  $('last').textContent = s.st && s.st.lastOkDay ? dayHe(s.st.lastOkDay) : '—';
  $('ver').textContent = s.ver;
  $('be').textContent = s.backend === 'test' ? 'בדיקות' : s.backend === 'prod' ? 'רגיל' : s.backend;
}
$('connect').addEventListener('click', async () => {
  const b = $('connect');
  b.disabled = true; b.textContent = 'בודק…';
  const r = await send({ t: 'connect', token: $('tok').value });
  b.disabled = false; b.textContent = 'חבר';
  // קודם מרעננים את המסך (שם העסק, מצב החיבור) ורק אחר כך ההודעה – כדי ש"מחובר" לא יופיע ליד שם עסק ישן ("—")
  await load().catch(() => {});
  if (r.ok) { $('tok').value = ''; msg('✓ מחובר' + (r.biz ? ' ל' + r.biz : ''), 'ok'); } else msg(CODE_MSG[r.code] || self.CxPlan.msgOf(r.code), 'bad');
});
$('disconnect').addEventListener('click', async () => {
  if (!confirm('לנתק את המחשב הזה? הסנכרון האוטומטי ייפסק עד שתחברו שוב עם קוד חדש.')) return;
  const r = await send({ t: 'disconnect' });
  msg(r.ok ? 'המחשב נותק. כדאי לבטל את החיבור גם באפליקציה.' : 'הניתוק נכשל', r.ok ? 'ok' : 'bad');
  load();
});
load();
