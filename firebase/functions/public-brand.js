'use strict';
// דף הפתיחה להזמנה (welcome.html, 2026-11-08): publicBrand – קריאה ציבורית מינימלית של מיתוג העסק, בלי התחברות.
//   GET ?biz=<bizId>  →  { name, logo, colors, apkTag, theme }   (theme: 'a'|'b'|'c' – ערכת העיצוב, D1)   (רק אלה. שום שדה אחר מהמסמך לא יוצא.)
//   name   – שם התצוגה (brand.name, או שם העסק). logo – data:image/... (עד 1MB) או ''. colors – רק 6 מפתחות #rrggbb.
//   apkTag – 'latest' (ה-APK הכללי), או 'biz-<bizId>' רק אם במסמך העסק יש apkTag כזה (נכתב רק בשרת/קונסול; הלקוח לא כותב למסמך).
// עסק שלא קיים או מושהה – 404 אחיד. bizId הוא מזהה ולא סוד.
// הגבלת קצב: בזיכרון של המופע (30 בקשות לדקה לכל IP), ומטמון של 10 דקות לכל עסק. maxInstances: 2 – תקרה לעלות.
// הלוגו נקרא בשרת (Admin) רק מהנתיב הקבוע b/{bizId}/brand/logo – כללי Storage לא נפתחים.

const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getStorage } = require('firebase-admin/storage');
const T = require('./lib/tenant');

const KEYS = ['acc', 'acc2', 'onacc', 'bg', 'card', 'ink'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX = 1024 * 1024;
const RATE = 30, WIN = 60000, TTL = 600000;
const hits = new Map(), cache = new Map();

function limited(ip, now) {
  if (hits.size > 5000) hits.clear();
  const h = hits.get(ip);
  if (!h || now - h.t > WIN) { hits.set(ip, { t: now, n: 1 }); return false; }
  h.n++;
  return h.n > RATE;
}

async function logoOf(bizId, path) {
  if (path !== `b/${bizId}/brand/logo`) return '';
  try {
    const f = getStorage().bucket().file(path);
    const [m] = await f.getMetadata();
    if (!TYPES.includes(m.contentType) || +m.size > LOGO_MAX) return '';
    const [buf] = await f.download();
    return `data:${m.contentType};base64,${buf.toString('base64')}`;
  } catch (e) { return ''; }
}

async function brandOf(bizId) {
  const biz = await T.loadBiz(bizId);
  if (!biz) return null;
  if (!biz.exists) return bizId === T.BIZ0 ? { name: 'לארג׳ פעמי', logo: '', colors: {}, apkTag: 'latest', theme: 'a' } : null;
  if (biz.status !== 'active') return null;
  const d = (await require('firebase-admin/firestore').getFirestore().doc('b/' + bizId).get()).data() || {};
  const br = d.brand && typeof d.brand === 'object' ? d.brand : {};
  const name = (typeof br.name === 'string' && br.name.trim()) || biz.name || '';
  const colors = {};
  if (br.colors && typeof br.colors === 'object') for (const k of KEYS) if (typeof br.colors[k] === 'string' && HEX.test(br.colors[k])) colors[k] = br.colors[k].toLowerCase();
  const apkTag = d.apkTag === 'biz-' + bizId ? d.apkTag : 'latest';
  const theme = ['a', 'b', 'c'].includes(br.theme) ? br.theme : 'a';
  return { name: String(name).slice(0, 60), logo: await logoOf(bizId, br.logoPath), colors, apkTag, theme };
}

async function handle(req, res, now) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Methods', 'GET'); return res.status(204).send(''); }
  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });
  const ip = String(req.ip || (req.headers && req.headers['x-forwarded-for']) || '?').split(',')[0].trim();
  if (limited(ip, now)) return res.status(429).json({ error: 'rate' });
  const bizId = String((req.query && req.query.biz) || '');
  if (!T.BIZ_RE.test(bizId)) return res.status(400).json({ error: 'biz' });
  let c = cache.get(bizId);
  if (!c || now - c.t > TTL) {
    if (cache.size > 500) cache.clear();
    c = { t: now, v: await brandOf(bizId) };
    cache.set(bizId, c);
  }
  if (!c.v) return res.status(404).json({ error: 'none' });
  return res.status(200).json(c.v);
}

exports.publicBrand = onRequest({ maxInstances: 2, timeoutSeconds: 20, memory: '256MiB' }, async (req, res) => {
  try { await handle(req, res, Date.now()); } catch (e) {
    logger.error('publicBrand failed', { reason: 'internal', name: e && e.name });
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
  }
});
Object.defineProperty(exports, '_core', { enumerable: false, value: { handle, brandOf, hits, cache } });
