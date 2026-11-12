'use strict';
// אפליקציה עם הסמל של העסק – בנייה מיידית (12.11.2026, החלטת בעל המערכת):
//   requestBizApk({ bizId, noLogo? })  →  { ok, status: 'building' | 'already' | 'no-token' | 'failed' }
//   - מי מורשה: רק מנהל־על.
//   - עסק במבנה החדש בלבד (לא לארג' פעמי, לא "business" – האפליקציה הכללית).
//   - בלי לוגו במיתוג: נדחה (no-logo), אלא אם noLogo === true (מנהל־העל בחר "המשך בלי לוגו" – סמל כללי ושם העסק).
//   - מסמן b/{bizId}.apkState = { st: 'building', t, by, noLogo, rebuild } ומפעיל ב-GitHub את build-biz-apks.yml מ-main
//     (workflow_dispatch: publish=true, only=<bizId>). בסוף הבנייה GitHub כותב st: 'ready' (או 'failed') ו-apkTag.
//   - בנייה שכבר רצה (פחות מ-20 דקות) – לא מופעלת שוב.
//   - הסוד GH_DISPATCH_TOKEN (מפתח גישה של GitHub עם הרשאת Actions בלבד, למאגר הזה בלבד) לא נכתב ללוג ולא חוזר בתשובה.
//     בלי סוד תקין – status 'no-token' ושום דבר לא משתנה.
// רק השרת כותב ל-b/{bizId} (חוקי Firestore לא השתנו).

const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const T = require('./lib/tenant');
const R = require('./lib/roles');

const GH_DISPATCH_TOKEN = defineSecret('GH_DISPATCH_TOKEN');
const REPO = 'nati59029-a11y/large-pami-android';
const WORKFLOW = 'build-biz-apks.yml';
const BUSY_MS = 20 * 60 * 1000;
const TOKEN_RE = /^(github_pat_|ghp_)[A-Za-z0-9_]{20,250}$/;

const deny = (reason, message) => new HttpsError('permission-denied', message, { reason });
const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });

function defaultDeps() {
  return {
    token: () => { try { return GH_DISPATCH_TOKEN.value(); } catch (e) { return ''; } },
    fetch: (u, o) => fetch(u, o),
    now: () => Date.now(),
  };
}

async function dispatch(D, token, bizId) {
  try {
    const r = await D.fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'biz-apk', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { publish: 'true', only: bizId } }),
    });
    return r && r.status === 204 ? '' : 'http-' + (r ? r.status : 0);
  } catch (e) { return 'network'; }
}

async function requestBizApk(request, deps) {
  const D = Object.assign(defaultDeps(), deps || {});
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'צריך להתחבר לאפליקציה', { reason: 'not-signed-in' });
  if (!(await T.isSuper(uid))) throw deny('not-superadmin', 'הפעולה מותרת למנהל המערכת בלבד');
  const input = R.inputObject(request);
  const bizId = typeof input.bizId === 'string' ? input.bizId : '';
  if (!T.BIZ_RE.test(bizId) || bizId === T.BIZ0 || bizId === 'business') throw bad('bad-biz', 'מזהה עסק לא תקין');
  const biz = await T.loadBiz(bizId);
  if (!biz || !biz.exists) throw new HttpsError('not-found', 'העסק לא נמצא', { reason: 'no-biz' });
  if (biz.dataRoot === 'legacy') throw new HttpsError('failed-precondition', 'העסק עדיין פועל במצב הקיים', { reason: 'legacy-biz' });
  const db = getFirestore(), ref = db.doc('b/' + bizId);
  const d = (await ref.get()).data() || {};
  const br = d.brand && typeof d.brand === 'object' ? d.brand : {};
  const logo = br.logoPath === `b/${bizId}/brand/logo`;
  if (!logo && input.noLogo !== true) throw new HttpsError('failed-precondition', 'לעסק אין לוגו', { reason: 'no-logo' });
  const now = D.now();
  const st = d.apkState && typeof d.apkState === 'object' ? d.apkState : {};
  if (st.st === 'building' && typeof st.t === 'number' && now - st.t < BUSY_MS) return { ok: true, status: 'already' };
  const token = String(D.token() || '').trim();
  if (!TOKEN_RE.test(token)) return { ok: true, status: 'no-token' };
  const rebuild = d.apkTag === 'biz-' + bizId;
  await ref.update({ apkState: { st: 'building', t: now, by: uid, noLogo: !logo, rebuild } });
  const why = await dispatch(D, token, bizId);
  if (why) {
    logger.warn('requestBizApk: dispatch failed', { bizId, why });
    await ref.update({ 'apkState.st': 'failed', 'apkState.why': why });
    return { ok: true, status: 'failed' };
  }
  try { await db.collection(`b/${bizId}/audit`).doc().set({ by: uid, t: now, act: 'requestBizApk', note: logo ? 'logo' : 'noLogo' }); } catch (e) { /* audit לא חוסם */ }
  return { ok: true, status: 'building' };
}

exports.requestBizApk = onCall({ secrets: [GH_DISPATCH_TOKEN], maxInstances: 3, timeoutSeconds: 60 }, T.scoped(async (request) => requestBizApk(request)));
Object.defineProperty(exports, '_core', { enumerable: false, value: { requestBizApk, TOKEN_RE, BUSY_MS } });
