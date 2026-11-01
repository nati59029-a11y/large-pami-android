'use strict';
// גזירת מפתח הצפנה לגיבוי, לכל משתמש: HKDF-SHA-256 (RFC 5869) ממפתח-האב BACKUP_MASTER_KEY ומהמזהה של המשתמש.
// אותו משתמש מקבל תמיד אותו מפתח (כל עוד מפתח-האב לא השתנה); משתמשים שונים מקבלים מפתחות שונים.
// המזהה נלקח רק מהטוקן המאומת – לעולם לא מהקלט.

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const KEY_VERSION = 'v1';
const SALT = Buffer.from('large-pami/app-backup/' + KEY_VERSION, 'utf8');

// מפתח-האב נשמר בכספת כמחרוזת base64 של 32 בתים לפחות (למשל: openssl rand -base64 32).
function parseMasterKey(value) {
  const s = String(value || '').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4 !== 0) return null;
  const buf = Buffer.from(s, 'base64');
  return buf.length >= 32 ? buf : null;
}

function deriveBackupKey(masterKeyValue, uid) {
  const master = parseMasterKey(masterKeyValue);
  if (!master) throw new HttpsError('failed-precondition', 'מפתח הגיבוי בשרת לא מוגדר כראוי', { reason: 'master-key-missing' });
  const info = Buffer.from('uid:' + uid, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', master, SALT, info, 32));
}

module.exports = { deriveBackupKey, parseMasterKey, KEY_VERSION, SALT };
