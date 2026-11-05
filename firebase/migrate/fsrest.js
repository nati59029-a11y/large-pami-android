'use strict';
// לקוח Firestore דרך REST, לכלי ההעברה בלבד.
// למה REST ולא firebase-admin לנתונים: האפליקציה שומרת סכומים כ-doubleValue גם כשהם שלמים (index.html, dv=v=>({doubleValue:+v})).
// firebase-admin קורא אותם כמספר JS וכותב אותם בחזרה כ-integerValue, כלומר משנה את הטיפוס. כאן הנתונים עוברים בדיוק
// בצורה שבה Firestore מחזיר אותם (ערכים "גולמיים"), ולכן אין איבוד טיפוס: Timestamp, GeoPoint, הפניות, בייטים,
// מספרים שלמים גדולים (מחרוזת) ו-double נשמרים כמו שהם. firebase-admin משמש רק לאסימון הגישה (בפרויקט אמיתי) ול-Storage.
//
// הגנות כתיבה (בקוד, לא רק בתהליך):
//  1. כתיבה רק במצב write (mode === 'write'). במצב readonly כל ניסיון כתיבה זורק שגיאה.
//  2. כתיבה רק ליעד: b/<bizId> (מסמך העסק), b/<bizId>/... (הנתונים המועתקים), ו-users/<uid> ביצירה בלבד.
//  3. אין בקוד מחיקה: אין שימוש ב-DELETE ואין פעולת delete בכתיבה המרוכזת.
//  4. כל כתיבה מוגנת בתנאי מוקדם: יצירה = "המסמך לא קיים" (exists:false). עדכון = "המסמך לא השתנה מאז שקראנו אותו"
//     (updateTime), או "המסמך קיים" לשינוי dataRoot בלבד. כך אף פעם לא נדרס מסמך ששונה בינתיים.

const crypto = require('node:crypto');

const DB = '(default)';

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  if (typeof v === 'number') {
    if (Object.is(v, -0)) return '"-0"';
    if (!Number.isFinite(v)) return JSON.stringify(String(v));
  }
  return JSON.stringify(v);
}

// זמן בפורמט אחיד (9 ספרות אחרי הנקודה), כדי שאותו זמן ייתן תמיד אותו גיבוב
function normTs(s) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(String(s));
  return m ? m[1] + '.' + (m[2] || '').padEnd(9, '0') + 'Z' : String(s);
}

// נרמול ערך גולמי של Firestore: שומר את הטיפוס במפורש (integerValue מול doubleValue וכו'), רק מאחיד צורה
function normValue(v) {
  if (!v || typeof v !== 'object') return v;
  const k = Object.keys(v)[0];
  const x = v[k];
  switch (k) {
    case 'integerValue': return { i: String(x) };
    case 'doubleValue': return { d: typeof x === 'string' ? x : x };
    case 'timestampValue': return { t: normTs(x) };
    case 'mapValue': return { m: normFields((x && x.fields) || {}) };
    case 'arrayValue': return { a: ((x && x.values) || []).map(normValue) };
    case 'geoPointValue': return { g: [Number(x.latitude || 0), Number(x.longitude || 0)] };
    case 'stringValue': return { s: x };
    case 'booleanValue': return { b: !!x };
    case 'nullValue': return { n: null };
    case 'bytesValue': return { y: x };
    case 'referenceValue': return { r: x };
    default: return { [k]: x }; // טיפוס לא מוכר: נשמר כמו שהוא
  }
}
function normFields(f) {
  const o = {};
  for (const key of Object.keys(f || {})) o[key] = normValue(f[key]);
  return o;
}
function hashFields(fields) {
  return crypto.createHash('sha256').update(stable(normFields(fields || {}))).digest('hex');
}
const MISSING = 'MISSING'; // מסמך "ריק" שקיים רק כאב של תת-אוסף

// קידוד נתיב לכתובת: כל קטע בנפרד (שמות עם רווחים, עברית, #, %, ?)
const encPath = p => p.split('/').map(encodeURIComponent).join('/');

class FsRest {
  constructor({ project, mode, bizId, token, emulatorHost }) {
    if (!project) throw new Error('חסר מזהה פרויקט');
    this.project = project;
    this.mode = mode === 'write' ? 'write' : 'readonly';
    this.bizId = bizId;
    this.prefix = `projects/${project}/databases/${DB}/documents`;
    this.base = (emulatorHost ? `http://${emulatorHost}` : 'https://firestore.googleapis.com') + '/v1/' + this.prefix;
    this.token = token; // פונקציה שמחזירה אסימון (באמולטור: 'owner')
    this.stats = { reads: 0, writes: 0 };
  }

  rel(name) { return name.startsWith(this.prefix + '/') ? name.slice(this.prefix.length + 1) : name; }

  async req(method, url, body) {
    if (method !== 'GET' && method !== 'POST') throw new Error('שיטה אסורה בכלי ההעברה: ' + method);
    for (let attempt = 1; ; attempt++) {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await this.token()) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const txt = await r.text();
      if (r.ok) return txt ? JSON.parse(txt) : {};
      if ((r.status === 429 || r.status >= 500) && attempt < 5) { await new Promise(res => setTimeout(res, 500 * attempt * attempt)); continue; }
      const e = new Error(`Firestore ${r.status}: ${txt.slice(0, 300)}`);
      e.status = r.status;
      throw e;
    }
  }

  // שמות תת-האוספים של מסמך ('' = שורש)
  async listCollectionIds(docPath) {
    const out = [];
    let pageToken;
    do {
      const url = this.base + (docPath ? '/' + encPath(docPath) : '') + ':listCollectionIds';
      const r = await this.req('POST', url, { pageSize: 300, pageToken });
      this.stats.reads++;
      out.push(...(r.collectionIds || []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out.sort();
  }

  // כל המסמכים באוסף, כולל מסמכים "חסרים" (אב של תת-אוסף בלי שדות)
  async listDocuments(collPath) {
    const out = [];
    let pageToken;
    do {
      const q = new URLSearchParams({ pageSize: '300', showMissing: 'true' });
      if (pageToken) q.set('pageToken', pageToken);
      const r = await this.req('GET', this.base + '/' + encPath(collPath) + '?' + q);
      this.stats.reads++;
      for (const d of r.documents || []) {
        const missing = !d.createTime;
        out.push({ path: this.rel(d.name), missing, fields: missing ? undefined : (d.fields || {}), updateTime: d.updateTime, createTime: d.createTime });
      }
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async getDoc(path) {
    try {
      const d = await this.req('GET', this.base + '/' + encPath(path));
      this.stats.reads++;
      return { path, fields: d.fields || {}, updateTime: d.updateTime, createTime: d.createTime };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  // ---- כתיבה: רק כאן, רק ליעד, רק עם תנאי מוקדם ----
  assertWritable(path, kind) {
    if (this.mode !== 'write') throw new Error('מצב קריאה בלבד: אסור לכתוב (' + path + ')');
    const biz = this.bizId;
    if (!/^[a-z0-9-]{3,30}$/.test(biz || '')) throw new Error('מזהה עסק לא תקין: ' + biz);
    const segs = path.split('/');
    const isBizDoc = path === 'b/' + biz;
    const underBiz = segs.length >= 4 && segs[0] === 'b' && segs[1] === biz;
    const isUser = segs.length === 2 && segs[0] === 'users' && kind === 'create';
    if (!(isBizDoc || underBiz || isUser)) throw new Error('כתיבה מחוץ ליעד נחסמה: ' + path + ' (' + kind + ')');
  }

  // writes: [{path, fields, kind:'create'|'update'|'setField', updateTime?, fieldPaths?}]
  // מחזיר לכל כתיבה {ok, updateTime, error}
  async writeDocs(writes) {
    const results = [];
    let chunk = [], size = 0;
    const flush = async () => {
      if (!chunk.length) return;
      const body = {
        writes: chunk.map(w => {
          this.assertWritable(w.path, w.kind);
          const update = { name: this.prefix + '/' + w.path, fields: w.fields };
          if (w.kind === 'create') return { update, currentDocument: { exists: false } };
          if (w.kind === 'update') {
            if (!w.updateTime) throw new Error('עדכון בלי updateTime נחסם: ' + w.path);
            return { update, currentDocument: { updateTime: w.updateTime } };
          }
          if (w.kind === 'setField') return { update, updateMask: { fieldPaths: w.fieldPaths }, currentDocument: { exists: true } };
          throw new Error('סוג כתיבה לא מוכר: ' + w.kind);
        }),
      };
      const r = await this.req('POST', this.base + ':batchWrite', body);
      const st = r.status || [];
      chunk.forEach((w, i) => {
        const s = st[i] || {};
        const ok = !s.code;
        if (ok) this.stats.writes++;
        results.push({ path: w.path, ok, updateTime: ok ? (r.writeResults[i] || {}).updateTime : undefined, error: ok ? undefined : `${s.code}: ${s.message || ''}` });
      });
      chunk = []; size = 0;
    };
    for (const w of writes) {
      const s = Buffer.byteLength(JSON.stringify(w.fields || {}));
      // מגבלת Firestore: עד 500 פעולות בבקשה, ו-10MB. כאן: עד 400 ועד 8MB
      if (chunk.length >= 400 || (chunk.length && size + s > 8 * 1024 * 1024)) await flush();
      chunk.push(w); size += s;
    }
    await flush();
    return results;
  }
}

async function pmap(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// סריקה רקורסיבית: כל המסמכים באוספים הנתונים (ובכל תת-אוסף שלהם), מתחת ל-parent ('' = שורש).
// מחזיר Map: נתיב יחסי ל-parent ← {missing, fields, hash, updateTime}
async function scanTree(fs, parent, collIds) {
  const out = new Map();
  const strip = p => (parent ? p.slice(parent.length + 1) : p);
  async function walkColl(collPath) {
    const docs = await fs.listDocuments(collPath);
    await pmap(docs, 16, async d => {
      out.set(strip(d.path), { missing: d.missing, fields: d.fields, hash: d.missing ? MISSING : hashFields(d.fields), updateTime: d.updateTime });
      const subs = await fs.listCollectionIds(d.path);
      for (const s of subs) await walkColl(d.path + '/' + s);
    });
  }
  for (const c of collIds) await walkColl((parent ? parent + '/' : '') + c);
  return out;
}

module.exports = { FsRest, scanTree, hashFields, stable, normFields, MISSING, pmap, encPath };
