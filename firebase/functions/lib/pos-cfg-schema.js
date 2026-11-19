/* POS:M4 – סכמת ההגדרות של הקופה (poscfg). קובץ אחד, זהה בדיוק בשני המקומות:
     app-source/www/pos-cfg-schema.js  (דפדפן: window.PosCfgSchema)
     firebase/functions/lib/pos-cfg-schema.js  (שרת: module.exports)
   מקור: האפיון הסופי (06-אפיון-סופי.md), פרק 2 – כל שורה בטבלה = שורה כאן (313 מפתחות). פורמט השורה: אפיון ה 0.4.
   כללים (פרק 2):
     - נקודה בשם = אובייקט מקונן בתוך poscfg/main (למשל cat.nameMax נשמר כ-main.cat.nameMax).
     - מפתחות sa.* נשמרים ב-poscfg/sa (בלי הקידומת). sa.on, sa.st, sa.type, sa.mods מועתקים בשרת, באותה טרנזקציה, ל-poscfg/saPub.
     - who: 'sa' מנהל־על בלבד · 'own' בעל העסק · 'mgr' מנהל העסק. מי שמעל תמיד יכול גם הוא.
       מנהל־על משנה לעסק דרך sa.who{k} (מי משנה) או sa.lock[] (רק מנהל־על).
     - sens: הגדרה רגישה – אישור שני (אפיון ה 0.7, ד17).
     - brOk: מותרת חריגה לסניף (poscfg/br_{br}). mod: שייכת למודול – כשהמודול כבוי ההגדרה לא מוצגת ולא חלה.
     - def = הערך לעסק הנוכחי (פרק 1 סעיף 4: ברירת המחדל מתאימה לעסק הנוכחי). "למלא" = null.
   השרת דוחה מפתח שלא רשום כאן. מוסיפים הגדרה = שורה כאן בלבד (ממוינת לפי sec), בלי שינוי בשרת, בכללים או במסך.
   סכומים באגורות (u:'ag'). */
(function(root){
'use strict';

/* ---------- רשימות סגורות ---------- */
// אמצעי תשלום (אפיון סופי 4.1). הקפה אינה אמצעי – possale.debt בלבד.
const PAY=['cash','card','check','transfer','bit','paybox','gift','voucher','extGift','link'];
// מודולים (sa.mods, אפיון ה 0.5 + פרק 2.1). lot חדש, בנפרד מ-serial.
const MODS=['weight','variants','serial','lot','expiry','services','online','preorder','delivery','layaway','offsite','custDisplay','clock','gift','foreignCur','club','ai'];
const MODS_HE={weight:'מוצר שקיל וברקוד משקל',variants:'מידה / צבע / טעם',serial:'מספר סידורי',lot:'אצווה',expiry:'תאריך תפוגה',services:'פריטי שירות',online:'חנות אונליין',preorder:'הזמנה מראש ומקדמה',delivery:'משלוחים',layaway:'שמירה בצד ותשלום מאוחר',offsite:'מכירה מחוץ לחנות',custDisplay:'מסך לקוח',clock:'שעון נוכחות',gift:'כרטיס מתנה ושובר',foreignCur:'מטבע זר',club:'מועדון לקוחות',ai:'"שאל את הקופה" (AI)'};
// מדורים באזור הניהול (אפיון ה 0.4)
const SECS=[['biz','עסק'],['tax','מס ומסמכים'],['sale','מסך מכירה'],['pay','תשלום'],['rcpt','קבלות'],['ret','החזרות'],['promo','מבצעים והנחות'],['cust','לקוחות ומועדון'],['staff','עובדים'],['cash','מזומן וסגירה'],['inv','מוצרים ומלאי'],['rep','דוחות'],['hw','חומרה'],['off','אופליין וגיבוי'],['ui','תצוגה'],['br','סניפים'],['online','הזמנות ואונליין'],['ai','AI'],['mig','מעבר מכספיט'],['sys','מערכת']];
// סוגי עסק (אפיון ה 0.6). מסעדה לא נתמכת.
const TYPES=['bakeryDisposable','grocery','fashion','electronics','general','service'];
const ROLES=['none','cashier','lead','posMgr','mgr','brMgr','admin','owner','all','staff'];
const WHO=['sa','own','mgr'];

const ROWS=[];
const R=(sec,who,k,t,def,he,o)=>{ROWS.push(Object.assign({k,sec,t,def,who,sens:false,brOk:false,adv:false,mod:null,he},o||{}))};
const S=(o)=>Object.assign({sens:true},o||{});
const A={adv:true};

/* ===== עסק ומנהל-על ===== */
R('biz','sa','sa.on','bool',true,'הקופה פתוחה לעסק');
R('biz','sa','sa.st','enum','trial','מצב הקופה',{vals:['trial','active','susp'],help:'trial עד המעבר · susp = מושעית'});
R('biz','sa','sa.type','enum','bakeryDisposable','סוג העסק (תבנית)',{vals:TYPES});
R('biz','sa','sa.maxDev','int',25,'מספר קופות מרבי לעסק',{min:1,max:9999});
R('biz','sa','sa.maxBr','int',5,'מספר סניפים מרבי',{min:1,max:100});
R('biz','sa','maxDevPerBr','int',5,'מספר קופות מרבי לסניף',{min:1,max:999});
R('biz','sa','sa.lock','strs',[],'הגדרות נעולות (רק מנהל־על)',{maxLen:400,itemMax:40});
R('biz','sa','sa.who','json',{},'שינוי "מי משנה" להגדרה',{shape:'obj',help:'{מפתח: sa / own / mgr}'});
R('biz','sa','scale','enum','L','היקף העסק',{vals:['S','M','L']});
R('biz','sa','multiBranch','bool',true,'ריבוי סניפים');
R('biz','sa','stockView','enum','ownSeeAll','צפייה במלאי של סניפים אחרים',{vals:['own','ownSeeAll','all']});
R('biz','sa','sa.mods','obj',null,'מודולים',{fields:{}});
R('biz','mgr','openDays','days',[0,1,2,3,4,5],'ימי פתיחה',{brOk:true});
R('biz','mgr','hours','json',null,'שעות פתיחה',{shape:'obj',nul:true,brOk:true,help:'{יום: [פתיחה, סגירה]}. ערב חג ושישי – בנפרד'});
R('biz','mgr','holidayOpen','bool',true,'פתוח בחגים',{brOk:true});
R('biz','mgr','peakSeasons','json',[{n:'חגים',x:3}],'עונות שיא',{shape:'arr',help:'[{n: שם, from?, to?, x: פי כמה}]'});
R('biz','own','dayCut','time','03:00','סוף יום עסקים (מכירה אחרי חצות)',A);

/* ===== מס ומסמכים ===== */
R('tax','own','osekType','enum','murshe','סוג עוסק',S({vals:['murshe','patur','company','amuta']}));
R('tax','own','vatRate','num',18,'שיעור מע"מ',S({u:'pct',min:0,max:100}));
R('tax','own','priceInclVat','bool',true,'מחירים כוללים מע"מ',S());
R('tax','own','vatItemClass','bool',false,'סיווג מע"מ לכל מוצר',A);
R('tax','own','docDef','enum','ir','מסמך ברירת מחדל ללקוח פרטי',S({vals:['ir','rc','inv','inv+rc']}));
R('tax','sa','docBiz','enum','inv+rc','מסמך ללקוח עסקי',{vals:['ir','inv','inv+rc']});
R('tax','sa','docDraft','bool',false,'טיוטת מסמך לפני הפקה',A);
R('tax','own','docSeries','enum','dev','סדרת מספור',S({vals:['dev','br','biz'],help:'dev = סדרה לכל קופה (החלטה 1)'}));
R('tax','own','docShowSaleId','bool',false,'מספר מכירה פנימי במסמך');
R('tax','own','allocMin','int',500000,'סף מספר הקצאה (לפני מע"מ)',S({u:'ag',min:0,max:100000000}));
R('tax','own','allocMode','enum','manual','מספר הקצאה',S({vals:['manual','auto','off']}));
R('tax','own','cashMax','int',600000,'תקרת מזומן לעסקה',S({u:'ag',min:0,max:100000000,help:'מעל הסכום – לפי "מה קורה מעל תקרת המזומן"'}));
R('tax','own','cashMaxMode','enum','warn','מה קורה מעל תקרת המזומן',{vals:['note','warn','lead','block'],help:'warn = אזהרה שהקופאי מאשר בלחיצה, נרשמת ביומן (החלטה 14)'});
R('tax','own','giftDocMode','enum','advance','מסמך לכרטיס מתנה',{vals:['advance','sale'],adv:true});
R('tax','own','retainYears','int',7,'שנות שמירת מסמכים ויומנים',S({u:'yr',min:1,max:30}));
R('tax','own','cfgApprove','enum','sens','אישור שני לשינוי הגדרות',{vals:['none','sens','all'],adv:true});
R('tax','own','logAcct','bool',false,'רואה החשבון רואה את יומן השינויים',A);
R('tax','own','acctQs','json',[],'שאלות לרואה החשבון',{shape:'arr',help:'[{q, st, a}]'});
R('tax','own','rollout','json',{},'הפעלה הדרגתית',{shape:'obj',help:'{פיצ\'ר: {on, uids[]}}',adv:true});

/* ===== מעבר מכספיט ===== */
R('mig','own','mig.src','enum','caspitHyp','מקור הייבוא',{vals:['caspitHyp','caspit','csv','none']});
R('mig','own','mig.importOrder','list',['prod','cust'],'סדר הייבוא',{vals:['prod','cust','bal','stock'],ord:true});
R('mig','own','mig.dupMode','enum','ask','מוצר כפול בייבוא',{vals:['ask','skip','update']});
R('mig','own','mig.skipInactive','bool',true,'דילוג על מוצרים לא פעילים');
R('mig','own','mig.catMap','bool',true,'מיפוי קטגוריות בייבוא');
R('mig','own','mig.cutDate','date','','יום החיתוך',S());
R('mig','own','mig.avoidPeak','bool',true,'אזהרה על יום חיתוך בעונת שיא');
R('mig','own','mig.parallelDays','int',7,'ימי עבודה מקבילה',{u:'day',min:0,max:60});
R('mig','own','mig.reconDiffMax','int',1000,'הפרש מותר בבדיקת התאמה',{u:'ag',min:0,max:10000000});
R('mig','own','mig.countMode','enum','full','ספירת מלאי לפני המעבר',{vals:['full','partial','none']});
R('mig','own','mig.cancelAfterDays','int',7,'ביטול כספיט אחרי (ימים בלי הפרש)',{u:'day',min:0,max:365});
R('mig','own','mig.rollbackDays','int',2,'חזרה לכספיט אפשרית עד (ימים)',{u:'day',min:0,max:60});
R('mig','own','mig.oldKeepYears','int',7,'שמירת הנתונים הישנים (שנים)',{u:'yr',min:1,max:30});

/* ===== מוצרים ואריחים ===== */
const PFIELDS=['name','price','bc','cat','sku','cost','sup','minQ'];
R('inv','mgr','cat.reqFields','list',PFIELDS.slice(),'שדות חובה במוצר',{vals:PFIELDS});
R('inv','sa','cat.nameMax','int',40,'אורך שם מוצר מרבי',{min:10,max:200,adv:true});
R('inv','mgr','cat.skuAuto','bool',true,'מק"ט אוטומטי');
R('inv','sa','cat.subLevels','int',1,'רמות תת-קטגוריה',{min:0,max:3,adv:true});
R('inv','sa','cat.prices','list',['reg','sale','ws'],'סוגי מחיר',{vals:['reg','sale','ws','club','min']});
R('inv','mgr','cat.minPriceMode','enum','perProd','מחיר מינימום',{vals:['off','perProd','pct']});
R('inv','sa','cat.multiSup','bool',true,'כמה ספקים למוצר');
R('inv','sa','cat.images','bool',false,'תמונות מוצר');
R('inv','sa','cat.variantAttrs','list',['size','color','taste'],'מאפייני וריאציה',{vals:['size','color','taste','model'],mod:'variants'});
R('inv','mgr','cat.seasons','bool',true,'מוצרים עונתיים');
R('inv','mgr','cat.genPerCat','bool',true,'מוצר כללי לכל קטגוריה');
R('inv','mgr','cat.manualPrice','enum','genOnly','הקלדת מחיר ידנית',{vals:['never','genOnly','always']});
R('inv','sa','cat.bundles','bool',true,'מארזים');
R('inv','sa','cat.track','list',['lot','exp'],'מעקב',{vals:['lot','exp','sn'],help:'exp רק במוצר שסומן'});
R('inv','sa','cat.decimalQty','bool',false,'כמות עשרונית');
R('inv','mgr','cat.favMax','int',24,'מספר אריחים מועדפים',{min:0,max:200});
R('inv','mgr','cat.tileMode','enum','mix','אריחים במסך המכירה',{vals:['fav','cat','mix']});
R('inv','mgr','tileImg','enum','imgTxt','תוכן האריח',{vals:['txt','img','imgTxt'],help:'טקסט כל עוד אין תמונות'});
R('inv','mgr','tileSize','enum','md','גודל אריח',{vals:['sm','md','lg']});
R('inv','mgr','uiTiles','enum','auto','מספר אריחים בשורה',{vals:['auto','3','4','5','6']});
R('inv','mgr','brPriceMode','enum','perBr','מחיר לסניף',{vals:['same','perBr']});
R('inv','mgr','brPriceBy','enum','brMgr','מי קובע מחיר לסניף',{vals:['admin','brMgr']});
R('inv','mgr','brPromo','bool',true,'מבצע לסניף',{brOk:true});
R('inv','mgr','onlinePrice','enum','perProd','מחיר אונליין',{vals:['same','perProd'],mod:'online'});
R('inv','mgr','svcPids','strs',[],'מוצרי שירות קבועים (אריזה, משלוח)',{maxLen:50,itemMax:80});
R('inv','mgr','freeAmt','bool',true,'סכום חופשי במכירה');

/* ===== ברקוד ומדבקות ===== */
R('inv','sa','bc.checkDigit','bool',true,'בדיקת ספרת ביקורת');
R('inv','sa','bc.intPrefix','str','200','קידומת ברקוד פנימי',{max:3,re:'^[0-9]{1,3}$'});
R('inv','sa','bc.prefixes','json',{gift:'98',cpn:'99',rcpt:'97'},'קידומות ברקוד מיוחדות',{shape:'obj',adv:true});
R('inv','mgr','bc.partialMin','int',4,'ספרות מינימום בחיפוש ברקוד חלקי',{min:2,max:13});
R('inv','mgr','bc.beep','bool',true,'צליל בכל סריקה');
R('inv','mgr','bc.camera','enum','backup','סריקה במצלמה',{vals:['off','backup','main']});
R('inv','mgr','bc.unknown','enum','quickAdd','ברקוד לא מוכר',{vals:['quickAdd','ask','block']});
R('inv','mgr','bc.cashierCreate','enum','always','קופאי יוצר מוצר מהיר',{vals:['never','lead','always']});
R('inv','mgr','bc.notifyNew','bool',true,'התראה למנהל על מוצר חדש מהקופה');
R('inv','mgr','bc.hiddenSale','enum','warn','מכירת מוצר מוסתר',{vals:['allow','warn','block']});
R('inv','sa','wbc','obj',null,'ברקוד משקל',{mod:'weight',fields:{prefix:{t:'str',def:'',max:3,re:'^[0-9]{0,3}$',he:'קידומת'},mode:{t:'enum',def:'price',vals:['price','wt'],he:'מקודד'}}});
R('inv','sa','hwScanQr','bool',false,'סריקת QR');
R('inv','mgr','lbl.onNew','bool',true,'מדבקה למוצר חדש');
R('inv','mgr','lbl.onRcv','bool',true,'מדבקה בקליטת סחורה');
R('inv','mgr','lbl.onPrice','enum','suggest','מדבקה בשינוי מחיר',{vals:['off','suggest','auto']});
R('inv','mgr','lbl.size','enum','s','גודל מדבקת מוצר',{vals:['s','m','l']});
R('inv','mgr','lbl.via','enum','pdf','הדפסת מדבקות',{vals:['pdf','printer']});
R('inv','mgr','lbl.shelf','enum','s','גודל מדבקת מדף',{vals:['off','s','m','l']});

/* ===== מלאי ורכש ===== */
R('inv','sa','inv.on','enum','all','ניהול מלאי',{vals:['off','all','marked']});
R('inv','mgr','inv.zero','enum','warn','מכירה כשהמלאי 0',{vals:['allow','warn','block']});
R('inv','mgr','inv.negative','bool',true,'מלאי שלילי מותר');
R('inv','mgr','inv.countRole','enum','posMgr','מי סופר מלאי',{vals:ROLES});
R('inv','mgr','inv.countApprove','bool',true,'אישור ספירה');
R('inv','mgr','inv.fixApprove','bool',true,'אישור תיקון מלאי');
R('inv','mgr','inv.minAlert','enum','app','התראת מלאי מינימום',{vals:['off','app','push']});
R('inv','mgr','inv.expAlertDays','int',3,'התראת תפוגה (ימים לפני)',{u:'day',min:0,max:365,mod:'expiry'});
R('inv','sa','inv.valuation','enum','avg','שווי מלאי',{vals:['avg','last','fifo'],adv:true});
R('inv','sa','inv.locations','strs',['wh'],'מקומות מלאי (מחסנים)',{maxLen:20,itemMax:40});
R('inv','sa','inv.production','bool',true,'ייצור (מתכון)');
R('inv','sa','inv.shareOnline','bool',true,'מלאי משותף לאונליין',{mod:'online'});
R('inv','mgr','inv.shelfLoc','json',{yh:true,nl:false},'מיקום מדף לפי סניף',{shape:'obj'});
R('inv','mgr','inv.xferTwoSide','bool',true,'העברה בין סניפים – אישור בשני הצדדים');
R('inv','mgr','inv.holdReserves','enum','preorderOnly','שריון מלאי להזמנות',{vals:['off','preorderOnly','all']});
R('inv','mgr','otherBrSale','enum','order','מוצר שנמצא רק בסניף אחר',{vals:['off','order','sell']});
R('inv','mgr','brMgrSeeOther','bool',false,'מנהל סניף רואה סניפים אחרים');
R('inv','sa','pur.on','bool',true,'רכש');
R('inv','mgr','pur.suggest','enum','sales','המלצת הזמנה',{vals:['off','min','sales']});
R('inv','mgr','pur.salesDays','int',28,'ימי מכירה לחישוב ההמלצה',{u:'day',min:1,max:365});
R('inv','mgr','pur.approve','enum','admin','אישור הזמנת רכש',{vals:ROLES});
R('inv','mgr','pur.send','enum','whatsapp','שליחת הזמנה לספק',{vals:['whatsapp','mail','pdf']});
R('inv','mgr','pur.costUpd','enum','ask','עדכון עלות בקליטה',{vals:['ask','auto','off']});
R('inv','mgr','pur.priceUpd','enum','suggest','עדכון מחיר בקליטה',{vals:['off','suggest','auto']});
R('inv','mgr','pur.newBc','enum','ask','ברקוד חדש בקליטה',{vals:['ask','auto','off']});

/* ===== מסך המכירה ===== */
R('sale','sa','searchMax','int',10,'תוצאות חיפוש מרביות',{min:3,max:50});
R('sale','sa','searchFuzzy','bool',true,'חיפוש סלחני');
R('sale','mgr','parkMax','int',0,'מכירות בהמתנה (0 = בלי הגבלה)',{min:0,max:100});
R('sale','mgr','afterPay','enum','clean','אחרי תשלום',{vals:['clean','summary']});
R('sale','mgr','confirmClearCart','bool',false,'אישור לביטול כל העגלה');
R('sale','mgr','uiConfirmDel','bool',true,'אישור למחיקת שורה');
R('sale','mgr','uiUndoSec','int',5,'שניות ל"בטל"',{min:0,max:30});
R('sale','mgr','cashierView','list',['price','stock','custName','myRep','promo'],'מה הקופאי רואה',{vals:['price','stock','custName','myRep','promo']});
R('sale','mgr','dailyGoal','int',null,'יעד יומי',{u:'ag',min:0,max:1000000000,nul:true,brOk:true});
R('sale','sa','uiPersonal','list',['theme','font','sound'],'העדפות שהעובד בוחר (בפרופיל)',{vals:['theme','font','sound']});
R('sale','mgr','lockMin','int',0,'נעילת מסך אחרי (דקות, 0 = כבוי)',{u:'min',min:0,max:120});
R('sale','mgr','beginner','bool',true,'מצב מתחיל');
R('sale','mgr','beginnerShifts','int',3,'משמרות במצב מתחיל לעובד חדש',{min:0,max:50});
R('sale','mgr','beginnerHide','list',['disc','priceOvr','split','hold','ret'],'מה מוסתר במצב מתחיל',{vals:['disc','priceOvr','split','hold','ret']});

/* ===== תשלום ואשראי ===== */
R('pay','own','payOn','list',['cash','card','check','transfer','bit','paybox','gift','voucher','extGift'],'אמצעי תשלום פעילים',S({vals:PAY}));
R('pay','mgr','payPrimary','enum','cash','אמצעי תשלום ראשי',{vals:PAY});
R('pay','mgr','quickCash','nums',[5000,10000,20000],'כפתורי מזומן מהיר',{u:'ag',min:100,max:10000000,maxLen:6});
R('pay','sa','cashRound','enum',0,'עיגול מזומן (אגורות)',{vals:[0,10,50,100]});
R('pay','mgr','checkPostdated','bool',true,'צ\'ק דחוי');
R('pay','sa','refReq','list',['transfer','bit','paybox'],'אסמכתא חובה',{vals:PAY});
R('pay','mgr','creditOverLimit','enum','block','חריגה ממסגרת הקפה',{vals:['allow','warn','block']});
R('pay','own','partialPay','enum','debt','יתרה שלא שולמה',{vals:['off','debt']});
R('pay','sa','payVoidRole','enum','lead','ביטול תשלום',{vals:ROLES});
R('pay','mgr','bigSaleAppr','int',0,'אישור למכירה מעל (0 = כבוי)',{u:'ag',min:0,max:100000000});
R('pay','mgr','cardMin','int',0,'מינימום לאשראי',{u:'ag',min:0,max:1000000});
R('pay','sa','dupWinMin','int',10,'חלון אזהרת חיוב כפול (דקות)',{u:'min',min:0,max:120});
R('pay','sa','termMode','enum','manual','מסוף אשראי',{vals:['manual','auto'],help:'auto רק אחרי שנבחר ספק (החלטה 2)'});
R('pay','sa','termProvider','str','','ספק סליקה',{max:40});
R('pay','sa','txTypes','list',['reg','inst','defer'],'סוגי עסקת אשראי',{vals:['reg','inst','defer','credit']});
R('pay','mgr','instMax','int',3,'מספר תשלומים מרבי',{min:1,max:36});
R('pay','mgr','instMinAmt','int',30000,'מינימום לתשלומים',{u:'ag',min:0,max:100000000});
R('pay','mgr','payLinkOn','bool',true,'תשלום בקישור (רק עם ספק)');

/* ===== קבלות ===== */
R('rcpt','mgr','rcptPrint','enum','always','הדפסת קבלה',{vals:['always','ask','never']});
R('rcpt','mgr','rcptWidth','enum',80,'רוחב נייר (מ"מ)',{vals:[58,80]});
R('rcpt','mgr','rcptBizFmt','enum','a4','מסמך ללקוח עסקי',{vals:['a4','roll']});
R('rcpt','sa','rcptSend','list',['wa','mail'],'שליחת קבלה',{vals:['wa','mail','sms']});
R('rcpt','mgr','mailBizOnly','bool',true,'מייל רק ללקוח עסקי');
R('rcpt','mgr','rcptLogo','enum','bw','לוגו בקבלה',{vals:['off','bw']});
R('rcpt','own','rcptFooter','str','תודה ולהתראות','שורה בתחתית הקבלה',{max:300,help:'תודה + כתובת + מדיניות החזרה'});
R('rcpt','mgr','rcptQr','bool',true,'QR בקבלה');
R('rcpt','mgr','rcptBarcode','bool',true,'ברקוד בקבלה (להחזרה)');
R('rcpt','mgr','rcptCashier','enum','num','שם הקופאי בקבלה',{vals:['off','num','name']});
R('rcpt','sa','reprintMark','bool',false,'סימון "העתק" בהדפסה חוזרת');
R('rcpt','mgr','giftRcpt','bool',true,'קבלת מתנה (בלי מחיר)');
R('rcpt','mgr','webDoc','enum','ir','מסמך להזמנה מהאתר',{vals:['ir','rc','inv']});

/* ===== החזרות ===== */
R('ret','mgr','retDays','int',14,'ימים להחזרה',{u:'day',min:0,max:365});
R('ret','mgr','retNoRcpt','enum','lead','החזרה בלי קבלה',{vals:['never','lead','mgr','all']});
R('ret','mgr','retNoRcptPrice','enum','cur','מחיר בהחזרה בלי קבלה',{vals:['cur','min90']});
R('ret','mgr','retNoRcptDef','enum','voucher','זיכוי בהחזרה בלי קבלה',{vals:['voucher','cash','exchange']});
R('ret','mgr','retRefundPolicy','json',{card:['card'],gift:['gift'],'*':['cash','voucher','same']},'אמצעי זיכוי לפי אמצעי התשלום',{shape:'obj'});
R('ret','mgr','retMgrAbove','int',20000,'אישור מנהל להחזרה מעל',{u:'ag',min:0,max:100000000});
R('ret','mgr','retDefective','enum','exchange','מוצר פגום',{vals:['exchange','refund','ask']});
R('ret','mgr','retNeedTag','bool',true,'החזרה רק עם תווית');
R('ret','mgr','retWhy','strs',['פגום','לא מתאים','שינוי דעה','אחר'],'סיבות החזרה',{maxLen:20,itemMax:40});
R('ret','mgr','retAlertCnt','int',5,'התראה על החזרות של לקוח (בחודש)',{min:0,max:100});
R('ret','sa','creditExpDays','int',730,'תוקף פתק זיכוי (ימים)',{u:'day',min:0,max:3650});
R('ret','mgr','retAnyBr','bool',true,'החזרה בכל סניף');

/* ===== הנחות ומבצעים ===== */
R('promo','mgr','discMax','obj',null,'הנחה מרבית (%)',{fields:{cashier:{t:'num',def:0,min:0,max:100,he:'קופאי',u:'pct'},lead:{t:'num',def:10,min:0,max:100,he:'אחראי משמרת',u:'pct'}},help:'אחראי – עד 10% (החלטה 3)'});
R('promo','mgr','discRoles','enum','lead','מי נותן הנחה',{vals:ROLES});
R('promo','mgr','discWhy','strs',null,'סיבות הנחה',{nul:true,maxLen:20,itemMax:40});
R('promo','sa','promoStack','enum','best','כמה מבצעים על אותו מוצר',{vals:['best','first','all']});
R('promo','mgr','promoCancelRole','enum','lead','ביטול מבצע בעגלה',{vals:ROLES});
R('promo','mgr','cpnStack','bool',true,'כמה קופונים בעסקה');
R('promo','mgr','cpnOnPromo','bool',false,'קופון על מוצר במבצע');

/* ===== מועדון ודיוור ===== */
const CL={mod:'club'};
R('cust','sa','club.type','enum','mix','סוג המועדון',Object.assign({vals:['points','disc','mix']},CL));
R('cust','sa','club.allBranches','bool',true,'מועדון משותף לכל הסניפים',CL);
R('cust','sa','club.retDeduct','bool',true,'הורדת נקודות בהחזרה',CL);
R('cust','mgr','club.earnPct','num',3,'צבירה (% מהקנייה)',Object.assign({u:'pct',min:0,max:100},CL));
R('cust','mgr','club.earnByCat','json',{},'צבירה לפי קטגוריה',Object.assign({shape:'obj',adv:true},CL));
R('cust','mgr','club.minRedeem','int',50,'מינימום נקודות למימוש',Object.assign({min:0,max:1000000},CL));
R('cust','mgr','club.showDebt','bool',true,'הצגת חוב הקפה ללקוח',CL);
R('cust','own','club.ptVal','int',1,'שווי נקודה (אגורות)',Object.assign({u:'ag',min:0,max:10000},CL));
R('cust','own','club.expMonths','int',12,'תוקף נקודות (חודשים)',Object.assign({min:0,max:120},CL));
R('cust','own','club.maxRedeemPct','int',null,'מימוש מרבי (% מהעסקה)',Object.assign({u:'pct',min:0,max:100,nul:true},CL));
R('cust','own','club.earnOnPromo','bool',false,'צבירה על מוצר במבצע',CL);
R('cust','mgr','club.idBy','list',['phone','name','card','tz','qr'],'זיהוי חבר מועדון',Object.assign({vals:['phone','name','card','tz','qr']},CL));
R('cust','mgr','club.joinBy','list',['pos','pay','qr'],'הצטרפות',Object.assign({vals:['pos','pay','qr','web']},CL));
R('cust','mgr','club.joinReq','list',['phone','name'],'שדות חובה בהצטרפות',Object.assign({vals:['phone','name','mail','bday','addr']},CL));
R('cust','mgr','club.joinFields','list',['phone','name','mail','bday','addr'],'שדות בטופס ההצטרפות',Object.assign({vals:['phone','name','mail','bday','addr']},CL));
R('cust','own','club.joinGift','int',null,'מתנת הצטרפות (נקודות)',Object.assign({min:0,max:1000000,nul:true},CL));
R('cust','own','club.bdayDiscPct','int',10,'הנחת יום הולדת (%)',Object.assign({u:'pct',min:0,max:100},CL));
R('cust','own','club.bdayDays','int',7,'ימי הטבת יום הולדת',Object.assign({u:'day',min:0,max:60},CL));
R('cust','own','club.custViewRole','enum','cashier','מי רואה פרטי לקוח',Object.assign({vals:ROLES},CL));
R('cust','own','mkt.on','bool',true,'דיוור ללקוחות');
R('cust','own','mkt.channel','enum','wa','ערוץ דיוור',{vals:['wa','mail','sms']});
R('cust','own','mkt.maxPerMonth','int',4,'הודעות בחודש ללקוח',{min:0,max:60});
R('cust','own','mkt.approver','enum','owner','מי מאשר דיוור',{vals:ROLES});

/* ===== עובדים ===== */
R('staff','mgr','staff.pinLen','int',4,'אורך קוד עובד',{min:4,max:8});
R('staff','mgr','staff.pinFail','enum','lock30','קוד שגוי',{vals:['none','lock30','lock5m'],help:'lock30 = נעילה ל-30 שניות אחרי 5 ניסיונות + התראה למנהל (החלטה 8)'});
R('staff','mgr','staff.shiftStart','enum','auto','פתיחת משמרת',{vals:['auto','manual']});
R('staff','mgr','staff.shiftEnd','enum','day','סיום משמרת',{vals:['day','z','manual']});
R('staff','mgr','staff.clockBreaks','bool',true,'הפסקות בשעון נוכחות',{mod:'clock'});
R('staff','mgr','staff.apprMode','enum','phone','אישור אחראי',{vals:['phone','pin','both']});
R('staff','mgr','staff.apprOffline','bool',true,'אישור ב-PIN בלי רשת');
R('staff','mgr','staff.apprTtlSec','int',90,'תוקף בקשת אישור (שניות)',{min:10,max:600});
R('staff','mgr','staff.roles','json',{},'מטריצת הרשאות לפי תפקיד',{shape:'obj',adv:true,help:'ג 3.3. ריק = ברירת המחדל בקוד'});
R('staff','own','staff.commission','bool',true,'עמלות');
R('staff','mgr','staff.goals','bool',true,'יעדים לעובד');
R('staff','mgr','staff.training','bool',true,'מצב תרגול');
R('staff','sa','trainVideo','str','','קישור לסרטון הדרכה',{max:300});

/* ===== מזומן וסגירת יום ===== */
R('cash','mgr','openCashDef','int',100000,'עודף יעד בפתיחת יום',{u:'ag',min:0,max:10000000,brOk:true});
R('cash','mgr','cash.floatRange','nums',[70000,150000],'טווח עודף תקין',{u:'ag',min:0,max:10000000,maxLen:2,minLen:2,brOk:true});
R('cash','mgr','cash.openMode','enum','carry','פתיחת יום',{vals:['carry','count','fixed']});
R('cash','mgr','cash.openCountReq','bool',false,'ספירה חובה בפתיחה');
R('cash','sa','cash.drawerPerDev','bool',true,'מגירה לכל קופה');
R('cash','sa','cash.countDenoms','nums',[20000,10000,5000,2000,1000,500,200,100,50,10],'ערכי ספירה',{u:'ag',min:1,max:1000000,maxLen:20});
R('cash','sa','z.blockOpenCart','bool',true,'חסימת Z עם עגלה פתוחה');
R('cash','mgr','cash.blindCount','bool',false,'ספירה עיוורת');
R('cash','mgr','cash.countsPerDay','int',1,'ספירות ביום',{min:0,max:10});
R('cash','mgr','cash.inAllowed','bool',true,'הכנסת מזומן למגירה');
R('cash','mgr','cash.depositSlip','bool',false,'שובר הפקדה');
R('cash','mgr','cash.safe','bool',false,'כספת');
R('cash','own','cash.outRole','enum','mgr','מי מוציא מזומן',{vals:ROLES});
R('cash','own','cash.outToExp','enum','afterAppr','הוצאת מזומן נרשמת כהוצאה',{vals:['never','afterAppr','auto']});
R('cash','own','cash.depositRole','enum','mgr','מי מפקיד',{vals:ROLES});
R('cash','mgr','cash.outPhoto','enum','opt','צילום בהוצאת מזומן',{vals:['off','opt','req']});
R('cash','mgr','cash.drawerAlert','int',300000,'התראה על מזומן במגירה מעל',{u:'ag',min:0,max:100000000});
R('cash','mgr','cash.noSale','enum','all','פתיחת מגירה בלי מכירה',{vals:['all','lead','mgr']});
R('cash','mgr','cash.autoOpen','enum','cash','פתיחת מגירה אוטומטית',{vals:['never','cash','all']});
R('cash','mgr','hwDrawer','bool',true,'מגירה מחוברת');
R('cash','mgr','hwDrawerSensor','bool',false,'חיישן מגירה');
R('cash','mgr','z.closeRole','enum','cashier','מי סוגר יום',{vals:ROLES});
R('cash','mgr','z.xRole','enum','lead','מי מפיק דוח X',{vals:ROLES});
R('cash','mgr','z.output','list',['save'],'דוח Z',{vals:['save','print','pdf','mail']});
R('cash','mgr','z.forgot','enum','continue','שכחו לסגור יום',{vals:['continue','block','auto']});
R('cash','mgr','z.diffIgnore','int',1000,'הפרש שלא דורש הסבר',{u:'ag',min:0,max:1000000});
R('cash','mgr','z.diffAppr','bool',true,'אישור מנהל להפרש');
R('cash','mgr','z.diffAlert','int',1000,'התראה על הפרש מעל',{u:'ag',min:0,max:1000000});
R('cash','mgr','z.consolidated','bool',true,'Z מאוחד לעסק');

/* ===== דוחות והתראות ===== */
R('rep','own','rpt.costRole','enum','mgr','מי רואה עלות ורווח',{vals:ROLES});
R('rep','own','rpt.phoneProfitRole','enum','owner','מי רואה רווח בטלפון',{vals:ROLES});
R('rep','own','rpt.fullRole','enum','mgr','מי רואה את כל הדוחות',{vals:ROLES});
R('rep','own','rpt.daily','bool',true,'סיכום יומי');
R('rep','own','rpt.weekly','json',{d:0,t:'21:00'},'סיכום שבועי',{shape:'obj',help:'{d: יום 0–6, t: שעה}'});
R('rep','own','rpt.goalMonthly','int',null,'יעד חודשי',{u:'ag',min:0,max:100000000000,nul:true});
R('rep','own','rpt.acct','json',{mail:null,every:'2m',fmt:['pdf','xlsx','csv'],auto:true},'דוח לרואה החשבון',{shape:'obj'});
R('rep','own','rpt.forecast','bool',true,'תחזית מכירות');
R('rep','mgr','rpt.compareTo','enum','lastWeekSameDay','השוואה ל',{vals:['yesterday','lastWeekSameDay','lastYear']});
R('rep','mgr','rpt.anomaly','bool',true,'התראה על חריגה');
R('rep','mgr','rpt.alerts','json',{drop:30,voids:10,bigRet:50000},'ספי התראות',{shape:'obj',help:'drop %, voids, bigRet אגורות. סף הנחה = discMax.lead'});

/* ===== חומרה, בלי רשת וגיבוי ===== */
R('hw','mgr','hwAutoCut','bool',true,'חיתוך נייר אוטומטי');
R('hw','mgr','hwPaperOut','enum','reprint','נגמר הנייר',{vals:['reprint','ask','skip']});
R('hw','mgr','hwCustShow','list',['cart','promo','qr'],'מה מוצג במסך הלקוח',{vals:['cart','promo','qr','logo'],mod:'custDisplay'});
R('hw','mgr','hwStatusTo','enum','mgr','התראת תקלת חומרה ל',{vals:ROLES});
R('off','sa','offSale','bool',true,'מכירה בלי רשת');
R('off','sa','devApprove','bool',true,'אישור מכשיר חדש');
R('off','sa','bkManual','enum','mgr','גיבוי ידני',{vals:ROLES});
R('off','sa','restoreBy','enum','owner','שחזור מגיבוי',{vals:ROLES});
R('off','mgr','offPay','list',['cash','cardManual'],'תשלום בלי רשת',{vals:['cash','cardManual','check']});
R('off','mgr','offRet','bool',false,'החזרה בלי רשת');
R('off','mgr','offGift','bool',true,'שובר / קופון בלי רשת',{mod:'gift'});
R('off','mgr','offGiftMax','int',20000,'תקרת שובר בלי רשת',{u:'ag',min:0,max:10000000,mod:'gift'});
R('off','mgr','offDot','enum','dot','סימון בלי רשת',{vals:['dot','bar']});
R('off','mgr','syncTick','enum','each','סימן ✓ לסנכרון',{vals:['each','summary']});
R('off','mgr','qWarnCnt','int',20,'אזהרה על תור ממתין (מכירות)',{min:1,max:10000});
R('off','mgr','qWarnMin','int',30,'אזהרה על תור ממתין (דקות)',{u:'min',min:1,max:10000});
R('off','mgr','qStaleH','int',24,'תור ישן (שעות)',{min:1,max:1000});
R('off','mgr','manEntry','enum','mgr','הקלדה ידנית של מכירות מנייר',{vals:ROLES});
R('off','mgr','emergency','enum','close','נוהל חירום',{vals:['close','paper','caspit']});
R('off','mgr','bkExt','enum','monthly','עותק גיבוי חיצוני',{vals:['off','weekly','monthly']});
R('off','mgr','bkAlert','list',['owner'],'התראת גיבוי ל',{vals:['owner','mgr','dev']});
R('sys','mgr','errReport','bool',true,'דיווח תקלות אוטומטי');
R('sys','mgr','errNotify','list',['owner','dev'],'התראת תקלה ל',{vals:['owner','mgr','dev']});
R('sys','mgr','updMode','enum','notify','עדכון גרסה',{vals:['auto','notify','manual']});
R('sys','sa','updOrder','enum','gradual','סדר עדכון הקופות',{vals:['all','gradual']});

/* ===== תצוגה וצלילים ===== */
R('ui','mgr','uiBtn','enum','md','גודל כפתורים',{vals:['sm','md','lg']});
R('ui','mgr','uiIcons','bool',true,'סמלים בכפתורים');
R('ui','mgr','uiLight','bool',true,'מותר מצב בהיר');
R('ui','mgr','uiStateClr','bool',true,'צבעי מצב');
R('ui','mgr','uiPromoHi','bool',true,'הדגשת מבצע');
R('ui','mgr','uiOrient','enum','both','כיוון מסך',{vals:['both','land','port']});
R('ui','mgr','uiAnim','enum','low','אנימציה',{vals:['off','low','full']});
R('ui','mgr','kbdKeys','bool',true,'קיצורי מקלדת');
R('ui','mgr','sndUnknown','bool',true,'צליל לברקוד לא מוכר');
R('ui','mgr','sndDone','bool',true,'צליל בסיום מכירה');
R('ui','mgr','vibrate','bool',true,'רטט');

/* ===== הזמנות ומשלוחים ===== */
const OR={mod:'preorder'},DL={mod:'delivery'};
R('online','mgr','ordSrc','list',['phone','wa','store'],'מקורות הזמנה',Object.assign({vals:['phone','wa','store','web']},OR));
R('online','mgr','ordReq','list',['name','phone','addr'],'שדות חובה בהזמנה',Object.assign({vals:['name','phone','addr','mail']},OR));
R('online','mgr','ordDepPct','int',100,'מקדמה (%)',Object.assign({u:'pct',min:0,max:100},OR));
R('online','mgr','ordDepDoc','enum','rc','מסמך למקדמה',Object.assign({vals:['rc','ir']},OR));
R('online','mgr','ordCancel','enum','ask','ביטול הזמנה',Object.assign({vals:['ask','refund','voucher','keep']},OR));
R('online','mgr','ordHoldDays','int',7,'ימי שמירת הזמנה',Object.assign({u:'day',min:0,max:365},OR));
R('online','mgr','ordNotify','enum','waLink','הודעה ללקוח',Object.assign({vals:['off','waLink','sms']},OR));
R('online','mgr','ordStatusBy','enum','staff','מי מעדכן מצב הזמנה',Object.assign({vals:['staff','lead','mgr']},OR));
R('online','mgr','dlvBy','enum','own','משלוח על ידי',Object.assign({vals:['own','courier','both']},DL));
R('online','mgr','dlvFreeFrom','int',null,'משלוח חינם מעל',Object.assign({u:'ag',min:0,max:100000000,nul:true},DL));

/* ===== AI ===== */
const AI={mod:'ai'};
R('ai','sa','aiCapAg','int',15000,'תקרת עלות AI בחודש',Object.assign({u:'ag',min:0,max:10000000},AI));
R('ai','sa','aiCam','bool',false,'מצלמה חכמה',AI);
R('ai','mgr','aiAskBy','enum','admin','מי שואל את הקופה',Object.assign({vals:ROLES},AI));
R('ai','mgr','aiVoice','enum','consent','שימוש בקול',Object.assign({vals:['off','consent']},AI));
R('ai','mgr','aiVoiceSearch','bool',false,'חיפוש קולי',AI);
R('ai','mgr','aiDictate','bool',true,'הכתבה',AI);
R('ai','mgr','aiUpsell','bool',true,'הצעת מוצר משלים',AI);
R('ai','mgr','aiImg','bool',true,'תמונות מוצר ב-AI (מגל 4)',AI);
R('ai','mgr','aiOcrImport','bool',true,'קריאת מחירון מצילום');

/* sa.mods – שדה בוליאני לכל מודול. ברירת המחדל = העסק הנוכחי (פרק 2): דלוקים variants, lot, expiry, preorder, delivery, layaway,
   offsite, custDisplay, clock, gift, club. כבויים: weight, serial, services, online, foreignCur, ai (עד המעבר). */
const MODS_ON=['variants','lot','expiry','preorder','delivery','layaway','offsite','custDisplay','clock','gift','club'];
ROWS.find(r=>r.k==='sa.mods').fields=Object.fromEntries(MODS.map(m=>[m,{t:'bool',def:MODS_ON.includes(m),he:MODS_HE[m]}]));

/* שמות שבוטלו (הטור "במקום" בפרק 2 + 2.1). הבדיקה האוטומטית מוודאת שאף אחד מהם לא נכנס לסכמה. */
const REPLACED=['cat.vatPerProd','docRetail','cashMaxAct','bkKeepY','cat.importSrc','quickKeys','sndScan','hwScanSrc','wbc.on','hwScale','hwLabels','zeroStock','ordReserve','showStock','cashierStats','staff.lockMin','beginnerAuto','hwTerm','hwPrintAlways','hwPaperDef','clubShared','hwClubId','cash.floatTarget','zPrint','alerts','rolloutMode','voiceSearch','club.on','staff.clock','hwCustDisp','ordOn','dlvOn','onlineOn','aiOn'];

/* ---------- עזרים ---------- */
const BY=Object.create(null);for(const r of ROWS){if(BY[r.k])throw new Error('pos-cfg-schema: duplicate '+r.k);BY[r.k]=r}
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const clone=v=>v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v));
const isSa=k=>k.slice(0,3)==='sa.';
const fail=(reason,msg)=>{const e=new Error(msg||reason);e.reason=reason;return e};
// ברירת מחדל של שורה (obj – לפי השדות)
function defOf(r){if(r.t==='obj'){const o={};for(const[f,fd]of Object.entries(r.fields))o[f]=clone(fd.def);return o}return clone(r.def)}
// קריאה / כתיבה של נתיב מנוקד בתוך אובייקט (main: cat.nameMax → main.cat.nameMax; sa: sa.mods → sa.mods)
const pathOf=k=>isSa(k)?k.slice(3).split('.'):k.split('.');
function pget(o,k){let c=o;for(const p of pathOf(k)){if(!isObj(c)||!has(c,p))return undefined;c=c[p]}return c}
function pset(o,k,v){const ps=pathOf(k);let c=o;for(let i=0;i<ps.length-1;i++){if(!isObj(c[ps[i]]))c[ps[i]]={};c=c[ps[i]]}c[ps[ps.length-1]]=v}
function pdel(o,k){const ps=pathOf(k);let c=o;for(let i=0;i<ps.length-1;i++){if(!isObj(c[ps[i]]))return;c=c[ps[i]]}delete c[ps[ps.length-1]]}
const TIME_RE=/^([01][0-9]|2[0-3]):[0-5][0-9]$/,DATE_RE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,CTRL=/[\u0000-\u001f]/;
function jsonOk(v,depth){if(depth>6)return false;if(v===null||typeof v==='boolean'||typeof v==='string')return typeof v!=='string'||(v.length<=500&&!CTRL.test(v));
 if(typeof v==='number')return Number.isFinite(v);if(Array.isArray(v))return v.length<=200&&v.every(x=>!Array.isArray(x)&&jsonOk(x,depth+1));/* Firestore: אין מערך בתוך מערך */
 if(isObj(v)){const ks=Object.keys(v);return ks.length<=200&&ks.every(k=>k.length<=60&&!CTRL.test(k)&&jsonOk(v[k],depth+1))}return false}

// בדיקת ערך מול שורה (או שדה של obj). מחזיר ערך מנורמל או זורק bad-value. null מותר רק ב-nul.
function check(r,v,k){
 const bad=()=>fail('bad-value','ערך לא תקין: '+(k||r.k));
 if(v===null){if(r.nul)return null;throw bad()}
 const lo=r.min!=null?r.min:0,hi=r.max!=null?r.max:1e12;
 switch(r.t){
  case 'bool':if(typeof v!=='boolean')throw bad();return v;
  case 'int':if(!Number.isInteger(v)||v<lo||v>hi)throw bad();return v;
  case 'num':if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)throw bad();return Math.round(v*100)/100;
  case 'str':if(typeof v!=='string'||v.length>(r.max||200)||CTRL.test(v)||(r.re&&!new RegExp(r.re).test(v)))throw bad();return v;
  case 'enum':if(!r.vals.some(x=>x===v))throw bad();return v;
  case 'list':{if(!Array.isArray(v)||new Set(v).size!==v.length||v.some(x=>!r.vals.includes(x)))throw bad();return r.ord?v.slice():r.vals.filter(x=>v.includes(x))}
  case 'time':if(typeof v!=='string'||!TIME_RE.test(v))throw bad();return v;
  case 'date':if(typeof v!=='string'||(v!==''&&!DATE_RE.test(v)))throw bad();return v;
  case 'days':{if(!Array.isArray(v)||new Set(v).size!==v.length||v.some(x=>!Number.isInteger(x)||x<0||x>6))throw bad();return v.slice().sort((a,b)=>a-b)}
  case 'nums':{if(!Array.isArray(v)||v.length>(r.maxLen||50)||v.length<(r.minLen||0)||v.some(x=>!Number.isInteger(x)||x<lo||x>hi))throw bad();return v.slice()}
  case 'strs':{if(!Array.isArray(v)||v.length>(r.maxLen||50)||v.some(x=>typeof x!=='string'||!x||x.length>(r.itemMax||80)||CTRL.test(x)))throw bad();return v.slice()}
  case 'json':{if(r.shape==='obj'&&!isObj(v))throw bad();if(r.shape==='arr'&&!Array.isArray(v))throw bad();if(!jsonOk(v,0)||JSON.stringify(v).length>4000)throw bad();return clone(v)}
  case 'obj':{if(!isObj(v)||!Object.keys(v).length)throw bad();const o={};for(const[f,x]of Object.entries(v)){if(!r.fields[f])throw fail('unknown-key','הגדרה לא מוכרת: '+(k||r.k)+'.'+String(f).slice(0,20));o[f]=check(r.fields[f],x,(k||r.k)+'.'+f)}return o}
 }
 throw bad()}

// "מי משנה" בפועל: sa.lock → 'sa'; sa.who[k] → הערך; אחרת who של השורה. מפתחות sa.* – תמיד מנהל־על.
const RANK={mgr:1,own:2,sa:3};
function whoOf(k,sa){const r=BY[k];if(!r)return 'sa';if(isSa(k))return 'sa';
 if(isObj(sa)&&Array.isArray(sa.lock)&&sa.lock.includes(k))return 'sa';
 const w=isObj(sa)&&isObj(sa.who)?sa.who[k]:undefined;return WHO.includes(w)?w:r.who}
// role: 'sa' | 'own' | 'mgr'
const canSet=(k,role,sa)=>!!RANK[role]&&RANK[role]>=RANK[whoOf(k,sa)];
const modOn=(r,mods)=>!r.mod||!isObj(mods)||mods[r.mod]===true;
function modsOf(sa){const o={};const f=BY['sa.mods'].fields;const m=isObj(sa)&&isObj(sa.mods)?sa.mods:{};for(const x of MODS)o[x]=typeof m[x]==='boolean'?m[x]:f[x].def;return o}

/* הערך בפועל (4 שכבות, אפיון ה 0.2): ברירת המחדל בקוד ← tpl (ערכי התבנית, אם נמסרו) ← main (העסק) ← br (סניף, רק brOk).
   sa – poscfg/sa או poscfg/saPub (on, st, type, mods). ערך שמור לא תקין (למשל אחרי שינוי טווח) – נופל לשכבה הקודמת, לא מפיל את הקופה.
   → { cfg:{k:ערך}, src:{k:'def'|'tpl'|'biz'|'br'}, off:{k:true} – מודול כבוי (ההגדרה לא חלה), mods, on, st, type } */
function eff(o){o=o||{};const sa=isObj(o.sa)?o.sa:{},main=isObj(o.main)?o.main:{},br=isObj(o.br)?o.br:null,tpl=isObj(o.tpl)?o.tpl:null;
 const mods=modsOf(sa),cfg={},src={},off={};
 for(const r of ROWS){const k=r.k;let v=defOf(r),s='def';
  const layers=isSa(k)?[['biz',sa]]:[['tpl',tpl],['biz',main]].concat(br&&r.brOk?[['br',br]]:[]);
  for(const[nm,L]of layers){if(!L)continue;const x=pget(L,k);if(x===undefined)continue;
   if(r.t==='obj'){if(!isObj(x))continue;const m=Object.assign({},v);let any=0;for(const[f,fx]of Object.entries(x))if(r.fields[f]){try{m[f]=check(r.fields[f],fx,k+'.'+f);any=1}catch(e){/* שדה לא תקין – השכבה הקודמת */}}v=m;if(any)s=nm;continue}
   try{v=check(r,x,k);s=nm}catch(e){/* ערך לא תקין – השכבה הקודמת */}}
  if(k==='sa.mods')v=mods;
  cfg[k]=v;src[k]=s;if(!modOn(r,mods))off[k]=true}
 return{cfg,src,off,mods,on:cfg['sa.on']===true,st:cfg['sa.st'],type:cfg['sa.type']}}

/* שינוי: cur = { main, sa, br } (מסמכים נוכחיים או null); p = { set:{k:v}, unset:[k], scope:'main'|'br' }; role 'sa'|'own'|'mgr'.
   → { main?, sa?, br?, changes:[{k, old, new, sens}] }. כל המסמכים שהשתנו מוחזרים שלמים. זורק: unknown-key, bad-value, not-allowed,
   mod-off (המודול כבוי), not-br (מפתח בלי brOk בקובץ סניף). sa.* – רק ב-scope 'main' (נשמר ב-sa). */
function patch(cur,p,role){
 if(!RANK[role])throw fail('not-allowed','אין הרשאה');
 cur=cur||{};p=isObj(p)?p:{};const scope=p.scope==='br'?'br':'main';
 const set=p.set===undefined?{}:p.set,unset=p.unset===undefined?[]:p.unset;
 if(!isObj(set)||!Array.isArray(unset))throw fail('bad-value','קלט לא תקין');
 const keys=Object.keys(set).concat(unset);if(!keys.length)throw fail('bad-value','אין שינוי');if(keys.length>400)throw fail('bad-value','יותר מדי שינויים');
 const sa0=isObj(cur.sa)?cur.sa:{},mods=modsOf(sa0);
 const out={main:clone(isObj(cur.main)?cur.main:{}),sa:clone(sa0),br:clone(isObj(cur.br)?cur.br:{})};
 const touched={};const changes=[];
 for(const k of keys){
  if(typeof k!=='string'||!has(BY,k))throw fail('unknown-key','הגדרה לא מוכרת: '+String(k).slice(0,40));
  const r=BY[k];
  if(!canSet(k,role,sa0))throw fail('not-allowed','אין לך הרשאה לשנות: '+r.he);
  if(!modOn(r,mods)&&role!=='sa')throw fail('mod-off','המודול כבוי: '+r.he);
  if(scope==='br'&&(!r.brOk||isSa(k)))throw fail('not-br','ההגדרה לא ניתנת לשינוי לסניף: '+r.he);
 }
 const doc=k=>isSa(k)?'sa':scope;
 for(const k of unset){const d=doc(k);const old=pget(out[d],k);if(old===undefined)continue;pdel(out[d],k);touched[d]=1;changes.push({k,old:clone(old),new:null,sens:BY[k].sens,unset:true})}
 for(const[k,x]of Object.entries(set)){const r=BY[k],d=doc(k);let v=check(r,x,k);
  if(k==='sa.lock')for(const z of v)if(!has(BY,z)||isSa(z))throw fail('bad-value','הגדרה לא מוכרת בנעילה: '+String(z).slice(0,40));
  if(k==='sa.who')for(const[z,w]of Object.entries(v))if(!has(BY,z)||isSa(z)||!WHO.includes(w))throw fail('bad-value','ערך לא תקין ב"מי משנה": '+String(z).slice(0,40));
  const old=pget(out[d],k);
  if(r.t==='obj'&&isObj(old))v=Object.assign({},old,v);
  if(JSON.stringify(old)===JSON.stringify(v))continue;
  pset(out[d],k,v);touched[d]=1;changes.push({k,old:old===undefined?null:clone(old),new:clone(v),sens:r.sens})}
 const res={changes};for(const d of Object.keys(touched))res[d]=out[d];return res}

// עותק ציבורי של sa לקופה (poscfg/saPub, אפיון ה 0.3): on, st, type, mods, ver
function pubOf(sa,ver){const e=eff({sa});return{on:e.on,st:e.st,type:e.type,mods:e.mods,ver:Number.isInteger(ver)?ver:0}}

// תיאור למסך הניהול (בלי פונקציות)
function describe(){return{rows:clone(ROWS),secs:clone(SECS),mods:MODS.slice(),modsHe:clone(MODS_HE),types:TYPES.slice(),pay:PAY.slice(),roles:ROLES.slice()}}

const api={ROWS,BY,SECS,MODS,MODS_HE,TYPES,PAY,ROLES,WHO,REPLACED,check,defOf,eff,patch,whoOf,canSet,modOn,modsOf,pubOf,describe,pget,pset,isSa,COUNT:ROWS.length};
// שרת (Node) – module.exports; דפדפן – window.PosCfgSchema. אותו קובץ בדיוק בשני המקומות (בדיקה ב-pos-admin.unit.test.js)
if(typeof module==='object'&&module.exports)module.exports=api;else root.PosCfgSchema=api;
})(typeof self!=='undefined'?self:this);
