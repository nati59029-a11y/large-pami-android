// תוסף כספית – החלון הקופץ
'use strict';
let timer = null;
async function load() {
  const s = await send({ t: 'status' });
  if (!s || !s.ok) { $('stT').textContent = 'שגיאה בטעינה'; return; }
  const v = view(s);
  $('dot').className = 'dot ' + v.cls;
  $('stT').textContent = v.t;
  $('stN').textContent = v.n;
  $('biz').textContent = (s.biz && s.biz.name) || '—';
  $('last').textContent = s.st && s.st.lastOkDay ? dayHe(s.st.lastOkDay) : '—';
  $('next').textContent = s.connected ? when(s.next) : '—';
  $('impN').classList.toggle('hide', s.imp !== false);
  $('sync').disabled = !s.connected || s.busy;
  $('disc').disabled = s.busy;
  $('dl').classList.toggle('hide', !s.disc);
  $('send').classList.toggle('hide', !s.disc || !s.connected);
  if (s.disc && s.discSt && s.discSt.st !== 'run' && !$('msg').textContent) {
    msg(s.disc.login ? 'כספית ביקשה התחברות. התחברו בלשונית של כספית ולחצו שוב "מצב היכרות".' : 'דוח היכרות מוכן (' + Math.ceil(s.disc.size / 1024) + ' KB). אפשר להוריד ולבדוק לפני שליחה.', s.disc.login ? 'bad' : 'ok');
  }
  clearTimeout(timer);
  if (s.busy) timer = setTimeout(load, 2000);
}
$('sync').addEventListener('click', async () => {
  const r = await send({ t: 'syncNow' });
  msg(r.ok ? 'הסנכרון התחיל. אפשר לסגור את החלון – הוא ימשיך ברקע.' : self.CxPlan.msgOf(r.code), r.ok ? 'ok' : 'bad');
  setTimeout(load, 600);
});
$('disc').addEventListener('click', async () => {
  const r = await send({ t: 'disc' });
  msg(r.ok ? 'מצב היכרות התחיל: נפתחת לשונית של כספית, והתוסף עובר על המסכים בלי לשנות כלום.' : self.CxPlan.msgOf(r.code), r.ok ? 'ok' : 'bad');
  setTimeout(load, 600);
});
$('dl').addEventListener('click', downloadDisc);
$('send').addEventListener('click', async () => {
  $('send').disabled = true;
  const r = await send({ t: 'sendDisc' });
  $('send').disabled = false;
  msg(r.ok ? 'הדוח נשלח לאפליקציה' : 'השליחה נכשלה: ' + self.CxPlan.msgOf(r.code), r.ok ? 'ok' : 'bad');
});
$('opt').addEventListener('click', () => chrome.runtime.openOptionsPage());
load();
