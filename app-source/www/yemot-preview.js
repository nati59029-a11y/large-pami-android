/* רכיב "שמע קודם": הקראת נוסח בטלפון עצמו (speechSynthesis), אחרי החלת מילון ההגייה. קירוב בלבד – הקול בקו (ימות) שונה.
   קובץ עצמאי וניתן לשימוש חוזר (חלון "שמור ושלח" ומשבצת "שלוחות הקו"). ממשק לפי חוזה 5.8 (פ1 = טלפון, לכן אין ypPhone):
     ypLexicon(text)       שומר את טקסט המילון (מ-getLineState). מחזיר מספר ערכים
     ypLoad()              טוען את המילון מהשרת פעם אחת (מטמון 10 דקות). Promise<boolean> (האם נטען)
     ypApply(text)         מחיל את המילון (אותו אלגוריתם כמו firebase/functions/lib/lexicon.js) → מחרוזת
     ypSpeak(text, opts)   → Promise<{ok:true}|{ok:false,reason:'no-voice'|'no-api'|'busy'|'error',message}>. לא זורק שגיאה. opts.onEnd
     ypStop()              עוצר הקראה
     ypButton(id)          HTML של כפתור "שמע קודם" + שורת מצב. id = מזהה תיבת הטקסט (textarea/input)
     ACT.ypPlay            קורא את הטקסט מהתיבה ומפעיל/עוצר הקראה
   משתמש רק ב: tok, FB, EMU, ACT, esc. */
(function(){
'use strict';
const YP_NOVOICE='אין בטלפון הזה קול עברי להשמעה מקדימה. אפשר לשלוח, ולהקשיב בקו.';
const YP_NOAPI='ההשמעה המקדימה לא נתמכת בטלפון הזה. אפשר לשלוח, ולהקשיב בקו.';
const YP_NOTE='זה קירוב בלבד: הקול בקו נשמע אחרת.';
const YP_MAX=300,YP_LEN=40,YP_TTL=600000;
let LX={entries:[],at:0,loaded:false},LOAD=null,SPEAKING=false;
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
window.ypStop=()=>{try{if(window.speechSynthesis)speechSynthesis.cancel()}catch(e){}SPEAKING=false};
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
window.ypButton=id=>`<button type="button" class="btn g s" data-a="ypPlay" data-t="${esc(id)}">▶ שמע קודם</button><span class="note" data-yp-msg="${esc(id)}" aria-live="polite" style="display:block;margin:4px 0 0">${YP_NOTE}</span>`;
ACT.ypPlay=async el=>{
 const id=el.dataset.t,box=document.getElementById(id),msg=document.querySelector(`[data-yp-msg="${CSS.escape(id)}"]`);
 const say=(t,bad)=>{if(msg){msg.textContent=t;msg.style.color=bad?'var(--warn)':''}};
 const idle=()=>{el.textContent='▶ שמע קודם';say(YP_NOTE)};
 if(SPEAKING){window.ypStop();idle();return}
 if(!box||!String(box.value||'').trim()){say('אין נוסח להשמעה.',true);return}
 el.disabled=true;say('מכין השמעה…');
 const ok=await window.ypLoad(); // המילון חייב להיטען לפני ההקראה, אחרת ההגייה שונה מהקו
 const r=await window.ypSpeak(box.value,{onEnd:idle});
 el.disabled=false;
 if(!r.ok){say(r.message,true);return}
 el.textContent='■ עצור';say(ok?YP_NOTE:'המילון לא נטען, ולכן ההשמעה היא בלי מילון ההגייה. '+YP_NOTE,!ok)};
})();
