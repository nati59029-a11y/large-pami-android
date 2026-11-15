'use strict';
// חילוץ טקסט מ-PDF של pdfkit (מינימלי) – הועבר מ-ar-pdf.unit.test.js כדי שגם ar-docs.test.js יבדוק את הקובץ שהשרת מחזיר (החלטה 29).
// מפענח את הזרמים ואת טבלת ToUnicode של הגופן; כל שורה בסדר החזותי משמאל לימין – מה שהעין רואה.
const zlib = require('node:zlib');

function objects(buf) {
  const s = buf.toString('latin1');
  const out = {};
  const re = /(\d+) 0 obj\s*/g;
  let m;
  while ((m = re.exec(s))) {
    const id = +m[1], start = re.lastIndex;
    const end = s.indexOf('endobj', start);
    let dict = s.slice(start, end), stream = null;
    const si = dict.indexOf('stream');
    if (si >= 0 && /\/Length (\d+)/.test(dict.slice(0, si))) {
      const len = +/\/Length (\d+)/.exec(dict.slice(0, si))[1];
      let ds = start + si + 6; if (s[ds] === '\r') ds++; if (s[ds] === '\n') ds++;
      stream = buf.subarray(ds, ds + len);
      if (/\/FlateDecode/.test(dict.slice(0, si))) stream = zlib.inflateSync(stream);
      dict = dict.slice(0, si);
    }
    out[id] = { dict, stream };
  }
  return out;
}
function cmapOf(stream) {
  const s = stream.toString('latin1'), map = {};
  const hex = (h) => { let r = ''; for (let i = 0; i < h.length; i += 4) r += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return r; };
  for (const b of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const x of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map[parseInt(x[1], 16)] = hex(x[2]);
  for (const b of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const x of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const a = parseInt(x[1], 16), z = parseInt(x[2], 16);
      if (x[3][0] === '[') [...x[3].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((y, i) => { map[a + i] = hex(y[1]); });
      else { const base = parseInt(x[3].slice(1, -1), 16); for (let c = a; c <= z; c++) map[c] = String.fromCharCode(base + c - a); }
    }
  }
  return map;
}
// → [[שורה חזותית, …] לכל עמוד]
function extract(buf) {
  const ob = objects(buf);
  const fonts = {}; // שם משאב → מפה
  for (const o of Object.values(ob)) {
    const fr = /\/Font\s*<<([^>]*)>>/.exec(o.dict);
    if (!fr) continue;
    for (const x of fr[1].matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
      const f = ob[+x[2]], tu = f && /\/ToUnicode (\d+) 0 R/.exec(f.dict);
      if (tu) fonts[x[1]] = cmapOf(ob[+tu[1]].stream);
    }
  }
  const pages = [];
  const kids = Object.values(ob).find((o) => /\/Type \/Pages/.test(o.dict));
  const order = [...kids.dict.matchAll(/(\d+) 0 R/g)].map((x) => +x[1]);
  for (const pid of order) {
    const cs = /\/Contents (\d+) 0 R/.exec(ob[pid].dict);
    const st = ob[+cs[1]].stream.toString('latin1');
    const items = [];
    let font = null, x = 0, y = 0;
    for (const tk of st.matchAll(/\/(\w+) [\d.]+ Tf|1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm|\[([^\]]*)\] TJ/g)) {
      if (tk[1]) font = fonts[tk[1]];
      else if (tk[2] != null) { x = +tk[2]; y = +tk[3]; }
      else if (tk[4] != null && font) {
        const str = [...tk[4].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => { let r = ''; for (let i = 0; i < h[1].length; i += 4) r += font[parseInt(h[1].slice(i, i + 4), 16)] || '?'; return r; }).join('');
        items.push({ x, y: Math.round(y), str });
      }
    }
    const rows = new Map();
    for (const it of items) { if (!rows.has(it.y)) rows.set(it.y, []); rows.get(it.y).push(it); }
    pages.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((i) => i.str).join('')));
  }
  return pages;
}
module.exports = { extract };
