'use strict';
// נקודת כניסה אחת לכל הבדיקות, בסדר קבוע: קודם כל הבדיקות, ובסוף בדיקת הכיסוי (שצריכה את התוצאות שלהן).
const { after } = require('node:test');
require('./10-firestore-matrix');
require('./20-app-replay');
require('./30-special-cases');
require('./35-hardening');
require('./40-storage-matrix');
require('./50-functions');
require('./90-coverage');
const H = require('./helpers');
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* האמולטור כבר נסגר */ } });
