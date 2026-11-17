'use strict';
// סביבת ההרצה: רק אמולטור Firestore מקומי (או פרויקט הבדיקה, בדגל מפורש). לעולם לא פרויקט הייצור.
//
// לקח מסשנים קודמים: בסביבת ענן יש שרת מתווך (HTTPS_PROXY / JAVA_TOOL_OPTIONS), ו-gRPC של firebase-admin
// מנסה לעבור דרכו גם אל 127.0.0.1. לכן כאן – לפני שטוענים את firebase-admin – מוסיפים את 127.0.0.1 ו-localhost
// ל-NO_PROXY ומבטלים את משתני ה-proxy של gRPC. ההפעלה של האמולטור עצמו (Java) נעשית ב-run-emulator.sh בלי JAVA_TOOL_OPTIONS.

const PROD_PROJECTS = ['largpeami']; // פרויקט הייצור – חסום תמיד
const TEST_PROJECT = 'largpeami-test-f4691'; // פרויקט הבדיקה – רק עם POS_ALLOW_TEST_PROJECT=1
const DEFAULT_EMU_PROJECT = 'demo-pos-load'; // תחילית demo- = האמולטור לא פונה לשום שירות אמיתי
const BIZ = process.env.POS_BIZ || 'demo-pos'; // הנתונים נכתבים תחת b/{BIZ}/ (כמו lib/tenant.js)

function bypassProxyForLocal() {
  const local = ['127.0.0.1', 'localhost', '::1'];
  for (const k of ['NO_PROXY', 'no_proxy']) {
    const cur = (process.env[k] || '').split(',').map((s) => s.trim()).filter(Boolean);
    process.env[k] = Array.from(new Set(cur.concat(local))).join(',');
  }
  // gRPC (@grpc/grpc-js) מכבד grpc_proxy / http(s)_proxy. לחיבור לאמולטור – בלי proxy בכלל.
  process.env.grpc_proxy = '';
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete process.env[k];
}

function target() {
  const emu = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT || process.env.POS_PROJECT || DEFAULT_EMU_PROJECT;
  if (PROD_PROJECTS.includes(project)) throw new Error(`סירוב: ${project} הוא פרויקט הייצור. מותר רק אמולטור או ${TEST_PROJECT}.`);
  if (emu) {
    const host = emu.split(':')[0];
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new Error('FIRESTORE_EMULATOR_HOST חייב להצביע על המחשב המקומי: ' + emu);
    return { mode: 'emulator', project, emu };
  }
  if (project === TEST_PROJECT && process.env.POS_ALLOW_TEST_PROJECT === '1') return { mode: 'test-project', project };
  throw new Error('אין FIRESTORE_EMULATOR_HOST. מריצים דרך run-emulator.sh, או (רק לפרויקט הבדיקה) GCLOUD_PROJECT=' + TEST_PROJECT + ' POS_ALLOW_TEST_PROJECT=1.');
}

let _db = null;
function db() {
  if (_db) return _db;
  const t = target();
  if (t.mode === 'emulator') bypassProxyForLocal();
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId: t.project });
  _db = getFirestore();
  _db.__target = t;
  return _db;
}

const P = (path) => `b/${BIZ}/${path}`; // נתיב בתוך העסק

module.exports = { db, target, P, BIZ, TEST_PROJECT, bypassProxyForLocal };
