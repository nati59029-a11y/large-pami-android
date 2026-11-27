'use strict';
// נקודת כניסה אחת לכל הבדיקות, בסדר קבוע: קודם כל הבדיקות, ובסוף בדיקת הכיסוי (שצריכה את התוצאות שלהן).
const { after } = require('node:test');
require('./10-firestore-matrix');
require('./20-app-replay');
require('./30-special-cases');
require('./35-hardening');
require('./36-tasks');
require('./36b-tasks-claim');
require('./36c-private-requests');
require('./36d-tasks-v2');
require('./36e-tasks-delegate'); // שליחת משימות לעובד מורשה (tkS / dg, 19.11.2026)
require('./37-appreq');
require('./38-closings');
require('./39-cashout');
require('./41-closing-logic');
require('./42-closing-checks');
require('./43-rq-photos-zcthr');
require('./44-groups'); // קבוצות התכתבות (סבב 3, 17.11.2026)
require('./45-templates'); // תבניות משימה בענן (סבב 4, 18.11.2026)
require('./46-tasks-push'); // התראות משימות (tkPush / ptkPush, 18.11.2026)
require('./47-hs'); // חוסרים (hsr, hsph, hsx – 18.11.2026, שלב 1)
require('./47b-hs-push'); // התראה על חוסר שממתין לאישור (hsPush / hsPushB, 27.11.2026)
require('./40-storage-matrix');
require('./50-functions');
require('./60-yemot');
require('./61-yemot-line');
require('./62-voice');
require('./63-yemot-fblist');
require('./64-yemot-one-ext'); // כל התוכן בשלוחה אחת (משימה 2026-11-17, שלבים 1-2)
require('./65-yemot-tz-send'); // שליחת צינתוקים מהקו (sendLineTzintuk, משימה 2026-11-18)
require('./66-yemot-numbers'); // מספרים בקו: הצגה, חיפוש וחסימה (yemotFbList numbers/block/unblock, משימה 2026-11-19)
require('./67-yemot-optout'); // מי שיצא מהצינתוקים לא מקבל בתשלום, ודוח הקו (yemotFbList report, משימה 2026-11-23)
require('./48-pres-act'); // נוכחות (pres), יומן שימוש (act) ומתג cfg/act – 23.11.2026
require('./90-coverage');
const H = require('./helpers');
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* האמולטור כבר נסגר */ } });
