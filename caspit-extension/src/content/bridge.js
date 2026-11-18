// תוסף כספית – גשר בעולם המבודד: מעביר ל-service worker רק קבצים ש-hook-main.js תפס,
// רק מאותו חלון ומאותו מקור, ורק עם ה-nonce שה-service worker נתן לריצה הנוכחית.
(() => {
  'use strict';
  if (window.__cxBridge) return;
  window.__cxBridge = true;
  let nonce = null;
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (!m || sender.id !== chrome.runtime.id || sender.tab) return;
    if (m.t === 'cx-arm') { nonce = typeof m.nonce === 'string' && m.nonce.length >= 16 ? m.nonce : null; reply({ ok: !!nonce }); }
    else if (m.t === 'cx-disarm') { nonce = null; reply({ ok: true }); }
    else if (m.t === 'cx-ping') reply({ ok: true, ready: document.readyState });
  });
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__cx !== 'hook' || d.kind !== 'file' || !nonce || d.nonce !== nonce || typeof d.b64 !== 'string') return;
    nonce = null; // קובץ אחד לכל דריכה
    chrome.runtime.sendMessage({ t: 'cx-file', nonce: d.nonce, name: String(d.name || '').slice(0, 120), mime: String(d.mime || '').slice(0, 100), size: +d.size || 0, via: String(d.via || ''), b64: d.b64 }).catch(() => {});
  });
})();
