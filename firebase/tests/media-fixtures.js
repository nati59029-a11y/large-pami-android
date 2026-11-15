'use strict';
// קבצי דמה לבדיקות "קול, תמונה וסרטון למזכירה" (secretary-media): נבנים בקוד, בלי ffmpeg ובלי קבצים במאגר.
// wav(sec) – WAV מונו 16kHz; webm(sec, { duration }) – כמו MediaRecorder (פלח ואשכולות בגודל לא ידוע, בלי Duration),
// או עם Duration ב-Info; mp4(sec, brand) – ftyp + moov/mvhd; jpg() / png() – רק כותרת הסוג (שרת הדמה של Gemini לא מפענח).

function wav(sec, rate) {
  const sr = rate || 16000, n = Math.round(sec * sr) * 2;
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(n, 40);
  return b;
}

// EBML: אלמנט עם גודל ידוע (גודל באורך 8 בתים) או לא ידוע
const UNKNOWN = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
function size8(n) { const b = Buffer.alloc(8); b[0] = 0x01; let v = n; for (let i = 7; i >= 1; i--) { b[i] = v & 0xff; v = Math.floor(v / 256); } return b; }
const el = (idHex, body, unknown) => Buffer.concat([Buffer.from(idHex, 'hex'), unknown ? UNKNOWN : size8(body.length), body]);
const uint = (v, n) => { const b = Buffer.alloc(n); let x = v; for (let i = n - 1; i >= 0; i--) { b[i] = x & 0xff; x = Math.floor(x / 256); } return b; };
function block(rel) { const b = Buffer.alloc(4 + 20); b[0] = 0x81; b.writeInt16BE(rel, 1); b[3] = 0x80; return el('a3', b); }
function webm(sec, o) {
  const opt = o || {};
  const ms = Math.round(sec * 1000);
  const info = [el('2ad7b1', uint(1000000, 3))];
  if (opt.duration) { const d = Buffer.alloc(8); d.writeDoubleBE(ms); info.push(el('4489', d)); }
  const parts = [el('1549a966', Buffer.concat(info)), el('1654ae6b', Buffer.from([0xae, 0x80]))];
  for (let t = 0; t <= ms; t += 5000) {
    const kids = [el('e7', uint(t, 4))];
    for (let r = 0; r < 5000 && t + r <= ms; r += 1000) kids.push(block(Math.min(r, ms - t)));
    parts.push(el('1f43b675', Buffer.concat(kids), true));
  }
  const head = el('1a45dfa3', Buffer.concat([el('4282', Buffer.from('webm'))]));
  return Buffer.concat([head, el('18538067', Buffer.concat(parts), true), Buffer.alloc(opt.pad || 0)]);
}

function box(type, body) { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(type, 4, 'ascii'); return Buffer.concat([h, body]); }
function mp4(sec, brand, pad) {
  const ftyp = box('ftyp', Buffer.concat([Buffer.from((brand || 'isom').padEnd(4, ' '), 'ascii'), Buffer.alloc(4)]));
  const mv = Buffer.alloc(100); mv[0] = 0; mv.writeUInt32BE(1000, 12); mv.writeUInt32BE(Math.round(sec * 1000), 16);
  return Buffer.concat([ftyp, box('moov', box('mvhd', mv)), box('mdat', Buffer.alloc(pad || 64))]);
}

const jpg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n || 200, 7)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 3)]);

module.exports = { wav, webm, mp4, jpg, png };
