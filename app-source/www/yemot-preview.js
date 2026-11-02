/* רכיב "שמע קודם". שלב 9: קודם מנסה את הקול האמיתי (הקול המשוכפל, פונקציית השרת previewVoice). אם הוא לא זמין –
   נופל להקראה בטלפון עצמו (speechSynthesis), אחרי החלת מילון ההגייה – קירוב בלבד. זו תצוגה בלבד: שום דבר לא נשלח לקו.
   השמע של התצוגה נשמר בשרת, כך ששליחה של אותו נוסח לא משלמת שוב.
   בנוסף: ypIsVoiceErr / ypChoice – החלון "הקול האנושי לא זמין": "שלח בקול הממוחשב" או "נסה שוב מאוחר יותר" (בלי מעבר אוטומטי).
   קובץ עצמאי וניתן לשימוש חוזר (חלון "שמור ושלח" ומשבצת "שלוחות הקו"). ממשק לפי חוזה 5.8 (פ1 = טלפון, לכן אין ypPhone):
     ypLexicon(text)       שומר את טקסט המילון (מ-getLineState). מחזיר מספר ערכים
     ypLoad()              טוען את המילון מהשרת פעם אחת (מטמון 10 דקות). Promise<boolean> (האם נטען)
     ypApply(text)         מחיל את המילון (אותו אלגוריתם כמו firebase/functions/lib/lexicon.js) → מחרוזת
     ypSpeak(text, opts)   → Promise<{ok:true}|{ok:false,reason:'no-voice'|'no-api'|'busy'|'error',message}>. לא זורק שגיאה. opts.onEnd
     ypVoice(text)         → Promise<{ok:true,url}|{ok:false,reason,message}> שמע בקול האמיתי מהשרת. לא זורק שגיאה
     ypStop()              עוצר הקראה (גם שמע)
     ypIsVoiceErr(e)       האם השגיאה מהשרת היא "הקול האנושי לא זמין" / "תקרה" (voice-unavailable / voice-quota)
     ypChoice(e,{onTts,onLater}) מציג בחלון את שתי האפשרויות. onTts – שליחה חוזרת בקול הממוחשב (Promise; שגיאה מוצגת בחלון)
     ypButton(id)          HTML של כפתור "שמע קודם" + שורת מצב. id = מזהה תיבת הטקסט (textarea/input)
     ACT.ypPlay            קורא את הטקסט מהתיבה ומפעיל/עוצר הקראה
   משתמש רק ב: tok, FB, EMU, ACT, esc. */
(function(){
'use strict';
const YP_NOVOICE='אין בטלפון הזה קול עברי להשמעה מקדימה. אפשר לשלוח, ולהקשיב בקו.';
const YP_NOAPI='ההשמעה המקדימה לא נתמכת בטלפון הזה. אפשר לשלוח, ולהקשיב בקו.';
const YP_NOTE='זה קירוב בלבד: הקול בקו נשמע אחרת.';
const YP_MAX=300,YP_LEN=40,YP_TTL=600000;
const YP_REAL='זה הקול שיישמע בקו.',YP_HINT='שומעים את הנוסח לפני השליחה. לא נשלח כלום לקו.';
let LX={entries:[],at:0,loaded:false},LOAD=null,SPEAKING=false,AUD=null;
function parse(text){ // כמו parseLexicon בשרת
 const by=new Map();
 String(text==null?'':text).split(/\r?\n/).forEach(raw=>{
  const line=raw.trim();if(!line||line[0]==='#')return;
  const eq=line.indexOf('='),from=eq<0?'':line.slice(0,eq).trim(),to=eq<0?'':line.slice(eq+1).trim();
  if(!from||!to||from.length>YP_LEN||to.length>YP_LEN)return;
  const k=from.toLowerCase();if(!by.has(k)&&by.size>=YP_MAX)return;
  by.delete(k);by.set(k,{from,to})});
 return [...by.values()]}
const rx=s=>s.replace(/[.*+?^${}()|[\]\\\/-]/g,'\\$&');
window.ypLexicon=text=>{LX={entries:parse(text),at:Date.now(),loaded:true};return LX.entries.length};
window.ypApply=text=>{ // כמו applyLexicon בשרת
 const s=String(text==null?'':text),list=LX.entries;if(!list.length)return s;
 const map=new Map();for(const e of list)map.set(e.from.toLowerCase(),e.to);
 const froms=[...map.keys()].sort((a,b)=>b.length-a.length);
 const re=new RegExp(`(?<![\\p{L}\\p{N}'׳"״])([ובהלמשכ]{0,2})(${froms.map(rx).join('|')})(?![\\p{L}\\p{N}'׳])`,'giu');
 return s.replace(re,(m,pre,word)=>pre+map.get(word.toLowerCase()))};
const base=()=>(typeof EMU!=='undefined'&&EMU)?`http://${EMU}:5001/${FB.projectId}/us-central1`:`https://us-central1-${FB.projectId}.cloudfunctions.net`;
window.ypLoad=()=>{ // כשל = הקראה בלי מילון (ypSpeak מדווח על כך), לא שגיאה
 if(LX.loaded&&Date.now()-LX.at<YP_TTL)return Promise.resolve(true);
 if(LOAD)return LOAD;
 LOAD=(async()=>{try{
  const t=await tok(),r=await fetch(base()+'/getLineState',{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({data:{slots:[]}})});
  const j=await r.json();if(!r.ok||!j||j.error||!j.result||typeof j.result.lexicon!=='string')return false;
  window.ypLexicon(j.result.lexicon);return true}catch(e){return false}finally{LOAD=null}})();
 return LOAD};
async function heVoice(){ // קול עברי, או null. ממתין עד 2 שניות לרשימת הקולות
 const S=window.speechSynthesis,pick=()=>(S.getVoices()||[]).find(v=>/^(he|iw)([-_]|$)/i.test(v.lang||''))||null;
 let v=pick();if(v)return v;
 await new Promise(res=>{let done=false;const f=()=>{if(!done){done=true;S.removeEventListener&&S.removeEventListener('voiceschanged',f);res()}};
  S.addEventListener&&S.addEventListener('voiceschanged',f);setTimeout(f,2000)});
 return pick()}
window.ypStop=()=>{try{if(window.speechSynthesis)speechSynthesis.cancel()}catch(e){}try{if(AUD){AUD.a.pause();URL.revokeObjectURL(AUD.url)}}catch(e){}AUD=null;SPEAKING=false};
const he=s=>typeof s==='string'&&/[֐-׿]/.test(s);
window.ypVoice=async text=>{ // הקול האמיתי מהשרת. כל כשל = {ok:false} (ואז משמיעים בקול הטלפון)
 const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),90000);
 try{
  const t=await tok(),r=await fetch(base()+'/previewVoice',{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({data:{text:String(text||'')}}),signal:ctl.signal});
  let j=null;try{j=await r.json()}catch(e){}
  if(!r.ok||!j||j.error||!j.result||typeof j.result.data!=='string'){const er=(j&&j.error)||{};return{ok:false,reason:(er.details&&er.details.reason)||'error',message:he(er.message)?er.message:''}}
  const bin=atob(j.result.data),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  return{ok:true,url:URL.createObjectURL(new Blob([u8],{type:j.result.mime||'audio/mpeg'})),cached:!!j.result.cached}
 }catch(e){return{ok:false,reason:e&&e.name==='AbortError'?'timeout':'offline',message:''}}
 finally{clearTimeout(tm)}};
window.ypSpeak=async(text,opts)=>{
 opts=opts||{};
 try{
  if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined')return{ok:false,reason:'no-api',message:YP_NOAPI};
  const said=window.ypApply(String(text||'').trim());
  if(!said)return{ok:false,reason:'error',message:'אין נוסח להשמעה.'};
  const v=await heVoice();
  if(!v)return{ok:false,reason:'no-voice',message:YP_NOVOICE};
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(said);u.lang=v.lang||'he-IL';u.voice=v;
  const end=()=>{SPEAKING=false;if(opts.onEnd){try{opts.onEnd()}catch(e){}}};
  u.onend=end;u.onerror=end;SPEAKING=true;speechSynthesis.speak(u);
  return{ok:true,lexicon:LX.loaded,said}
 }catch(e){SPEAKING=false;return{ok:false,reason:'error',message:'ההשמעה המקדימה נכשלה. אפשר לשלוח, ולהקשיב בקו.'}}};
window.ypButton=id=>`<button type="button" class="btn g s" data-a="ypPlay" data-t="${esc(id)}">▶ שמע קודם</button><span class="note" data-yp-msg="${esc(id)}" aria-live="polite" style="display:block;margin:4px 0 0">${YP_HINT}</span>`;
ACT.ypPlay=async el=>{
 const id=el.dataset.t,box=document.getElementById(id),msg=document.querySelector(`[data-yp-msg="${CSS.escape(id)}"]`);
 const say=(t,bad)=>{if(msg){msg.textContent=t;msg.style.color=bad?'var(--warn)':''}};
 let last=YP_HINT;const idle=()=>{el.textContent='▶ שמע קודם';say(last)};
 if(SPEAKING){window.ypStop();idle();return}
 if(!box||!String(box.value||'').trim()){say('אין נוסח להשמעה.',true);return}
 el.disabled=true;say('מכין השמעה בקול האמיתי…');
 // 1. הקול האמיתי (השרת מחיל את המילון בעצמו)
 const v=await window.ypVoice(box.value);
 if(v.ok){
  try{const a=new Audio(v.url);AUD={a,url:v.url};const end=()=>{if(AUD&&AUD.a===a){URL.revokeObjectURL(v.url);AUD=null;SPEAKING=false;idle()}};
   a.onended=end;a.onerror=end;SPEAKING=true;await a.play();el.disabled=false;el.textContent='■ עצור';last=YP_REAL;say(YP_REAL);return}
  catch(e){window.ypStop()} // ההשמעה בטלפון נכשלה – ממשיכים לקול הטלפון
 }
 // 2. נפילה לקול הטלפון (קירוב). voice-off = הקול האמיתי לא מופעל בשרת – בלי הודעה מיוחדת
 const why=v.ok||v.reason==='voice-off'?'':'הקול האמיתי לא זמין כרגע'+(v.reason==='preview-limit'?' (הגעתם למכסת ההשמעות בקול האמיתי)':'')+', ולכן זו השמעה בקול הטלפון. ';
 const ok=await window.ypLoad(); // המילון חייב להיטען לפני ההקראה, אחרת ההגייה שונה מהקו
 const r=await window.ypSpeak(box.value,{onEnd:idle});
 el.disabled=false;
 if(!r.ok){say(why+r.message,true);return}
 last=why+(ok?YP_NOTE:'המילון לא נטען, ולכן ההשמעה היא בלי מילון ההגייה. '+YP_NOTE);
 el.textContent='■ עצור';say(last,!ok||!!why)};
// ---------- "הקול האנושי לא זמין": שתי אפשרויות, בלי מעבר אוטומטי ----------
let VC=null;
window.ypIsVoiceErr=e=>!!e&&(e.reason==='voice-unavailable'||e.reason==='voice-quota');
window.ypChoice=(e,o)=>{
 o=o||{};VC={onTts:o.onTts,onLater:o.onLater,busy:false};const quota=e&&e.reason==='voice-quota';
 const m=e&&he(e.msg)?e.msg:quota?'הגענו לתקרת הקול האנושי לחודש הזה.':'הקול האנושי לא זמין כרגע.';
 dlg(`<h3>${quota?'נגמרה מכסת הקול האנושי לחודש':'הקול האנושי לא זמין כרגע'}</h3>
 <p class="note" id="ypVcMsg" style="margin:0 0 8px">${esc(m)}</p>
 <p class="note" style="margin:0 0 12px;font-weight:700">שום דבר לא נשלח לקו. מה לעשות?</p>
 <div class="row"><button type="button" class="btn grow" data-a="ypVcTts">שלח בקול הממוחשב</button><button type="button" class="btn g grow" data-a="ypVcLater">נסה שוב מאוחר יותר</button></div>
 <p id="ypVcWhy" class="note" style="color:var(--bad);font-weight:700;margin:8px 0 0;display:none"></p>`)};
ACT.ypVcTts=async()=>{
 if(!VC||VC.busy)return;const v=VC;v.busy=true;
 const bs=document.querySelectorAll('[data-a=ypVcTts],[data-a=ypVcLater]'),w=document.getElementById('ypVcWhy');
 bs.forEach(b=>b.disabled=true);const t=document.querySelector('[data-a=ypVcTts]');if(t)t.textContent='שולח…';if(w)w.style.display='none';
 try{await v.onTts();if(VC===v)VC=null}
 catch(err){v.busy=false;bs.forEach(b=>b.disabled=false);if(t)t.textContent='שלח בקול הממוחשב';
  const m=err&&err.userMsg||'השליחה בקול הממוחשב נכשלה. נסו שוב מאוחר יותר.';if(w){w.textContent=m;w.style.display=''}if(typeof toast==='function')toast(m)}};
ACT.ypVcLater=()=>{if(VC&&VC.busy)return;const f=VC&&VC.onLater;VC=null;closeDlg();if(f)f();if(typeof toast==='function')toast('לא נשלח כלום. אפשר לנסות שוב מאוחר יותר.')};
})();
