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
  $('upd').textContent = updTxt(s);
  $('today').textContent = todayTxt(s);
  $('prod').textContent = prodTxt(s);
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
// 0.1.19: העדכון השעתי של מכירות היום (todaySt) – עד עכשיו לא הוצג בשום מקום
function todayTxt(s) {
  if (s.capsToday === false) return 'כבוי – השרת עוד לא אישר (נבדק כל דקה)';
  const t = s.today;
  if (!t || !t.st) return 'עוד לא רץ';
  const at = new Date(t.at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const h = typeof t.slot === 'string' ? t.slot.slice(11) + ':00' : '';
  if (t.st === 'ok') return 'עודכן עד ' + (t.hm || h) + (t.n === 0 ? ' (אין מכירות היום)' : '') + ' · ' + at;
  if (t.st === 'run') return 'רץ עכשיו (' + h + ') · התחיל ' + at;
  return 'נכשל' + (h ? ' ב-' + h : '') + ': ' + self.CxPlan.msgOf(t.code) + (t.msg ? ' (' + t.msg + ')' : '') + ' · ' + at;
}
// 0.1.23: המוצרים (קטלוג, פריטים חדשים, מחירים, עדכוני פריטים) – נפרד מהמכירות. סונכרנו לאחרונה + ריצת 30 הדקות האחרונה
function prodTxt(s) {
  const f = (t) => new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ok = s.st && s.st.prodAt ? f(s.st.prodAt) : '—', p = s.prod;
  if (!p || !p.st || p.st === 'ok') return ok;
  if (p.st === 'run') return ok + ' · רץ עכשיו';
  if (p.st === 'skip') return ok + ' · ממתין לסנכרון קטלוג ראשון באפליקציה';
  return ok + ' · הניסיון האחרון (' + f(p.at) + ') נכשל: ' + self.CxPlan.msgOf(p.code);
}
// גרסה + מצב העדכון האוטומטי (upd.json שהסקריפט במחשב כותב)
function updTxt(s) {
  const u = s.upd && s.upd.upd, t = 'גרסה ' + s.ver;
  if (!u) return t + ' · עדכון אוטומטי לא מותקן';
  const at = new Date(u.at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (!u.ok) return t + ' · העדכון נכשל (' + at + ')' + (u.err ? ': ' + u.err : '');
  return t + (s.upd.disk && s.upd.disk !== s.ver ? ' · גרסה ' + s.upd.disk + ' הורדה וממתינה לטעינה' : ' · עדכון אוטומטי תקין') + ' (נבדק ' + at + ')';
}
load();
