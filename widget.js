/*!
 * Krishi Saathi chat widget — add to any website with one line:
 *   <script src="https://YOUR-BACKEND/widget.js" defer></script>
 * Optional attributes on the script tag:
 *   data-api="https://YOUR-BACKEND"   (defaults to where widget.js is served from)
 *   data-title="Krishi Saathi"  data-color="#2f6b3f"  data-language="auto|ta|hi|…"
 *   data-position="right|left"  data-open="true" (start open)
 */
(function () {
  'use strict';
  if (window.__krishiSaathiWidget) return;
  window.__krishiSaathiWidget = true;

  const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  const ds = (script && script.dataset) || {};
  const API = (ds.api || (script ? new URL(script.src, location.href).origin : '')).replace(/\/$/, '');
  const COLOR = /^#[0-9a-f]{3,8}$/i.test(ds.color || '') ? ds.color : '#2f6b3f';
  const POS = ds.position === 'left' ? 'left' : 'right';
  let TITLE = ds.title || 'Krishi Saathi';

  /* ---------- storage ---------- */
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  let deviceId = ls.get('ks_device');
  if (!deviceId) { deviceId = uuid(); ls.set('ks_device', deviceId); }

  const S = {
    lang: ls.get('ks_lang') || ds.language || 'auto',
    convId: ls.get('ks_conv') || null,
    languages: [], voiceInput: false, busy: false, ctl: null, images: [],
    rec: null, recChunks: [], recording: false, audio: null, speakingBtn: null, loaded: false,
  };

  const STARTERS = [
    'How do I prepare Jeevamrutham for one acre?',
    'My tomato leaves are curling and turning yellow. What can I do?',
    'How can I increase organic carbon in my soil?',
    'What is mulching and how do I do it?',
  ];

  /* ---------- DOM (Shadow DOM keeps host site styles out) ---------- */
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483000;bottom:0;' + POS + ':0;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
:host{all:initial}
[hidden]{display:none!important}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
button,input,select,textarea{font:inherit;color:inherit}
.launcher{position:fixed;bottom:20px;${POS}:20px;width:60px;height:60px;border-radius:50%;border:0;background:${COLOR};color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;display:grid;place-items:center;transition:transform .15s}
.launcher:hover{transform:scale(1.06)}
.panel{position:fixed;bottom:92px;${POS}:20px;width:390px;max-width:calc(100vw - 24px);height:620px;max-height:calc(100vh - 110px);background:#fffdf8;color:#1d2a20;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;border:1px solid #e2dac8;font-size:15px;line-height:1.45}
.panel.open{display:flex}
.head{background:${COLOR};color:#fff;padding:10px 12px;display:flex;align-items:center;gap:8px}
.head .t{flex:1;min-width:0}.head b{display:block;font-size:15px}.head small{opacity:.85;font-size:12px}
.hbtn{background:rgba(255,255,255,.15);border:0;color:#fff;width:32px;height:32px;border-radius:9px;cursor:pointer;display:grid;place-items:center}
.hbtn:hover{background:rgba(255,255,255,.28)}
select.lang{background:rgba(255,255,255,.15);border:0;color:#fff;border-radius:9px;padding:6px 6px;max-width:120px;font-size:13px}
select.lang option{color:#1d2a20}
.body{flex:1;overflow:auto;padding:14px 12px;background:#f7f3ea;display:flex;flex-direction:column;gap:10px}
.welcome{background:#fffdf8;border:1px solid #e2dac8;border-radius:14px;padding:16px;text-align:center}
.welcome h3{margin:4px 0 6px;font-size:18px}.welcome p{margin:0 0 12px;color:#5d6a5e;font-size:14px}
.starter{display:flex;flex-direction:column;gap:6px}
.starter button,.chips button{border:1px solid #d7cfbd;background:#fff;border-radius:12px;padding:9px 11px;text-align:left;cursor:pointer;font-size:14px}
.starter button:hover,.chips button:hover{border-color:${COLOR}}
.m{display:flex}.m.u{justify-content:flex-end}
.bub{max-width:86%;padding:9px 12px;border-radius:14px;overflow-wrap:anywhere;font-size:14.5px}
.u .bub{background:${COLOR};color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap}
.b .bub{background:#fffdf8;border:1px solid #e2dac8;border-bottom-left-radius:4px}
.bub p{margin:0 0 7px}.bub p:last-child{margin:0}.bub ul,.bub ol{margin:3px 0 7px;padding-inline-start:20px}.bub .h{font-weight:700;margin:4px 0}
.bub img{width:72px;height:72px;object-fit:cover;border-radius:8px;margin:0 4px 4px 0}
.acts{display:flex;gap:4px;margin-top:6px;flex-wrap:wrap}
.acts button{border:1px solid #e2dac8;background:#f7f3ea;border-radius:7px;padding:2px 8px;font-size:12px;color:#5d6a5e;cursor:pointer}
.acts button.on{background:#e3eee0;color:${COLOR};border-color:${COLOR}}
.note{font-size:12px;color:#5d6a5e;margin-top:4px}.err{color:#b3412e}
.dots{display:inline-flex;gap:4px}.dots i{width:6px;height:6px;border-radius:50%;background:${COLOR};animation:b 1.2s infinite;opacity:.4}
.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}
@keyframes b{40%{opacity:1;transform:translateY(-3px)}}
.chips{display:flex;flex-direction:column;gap:5px;padding:0 12px 6px;background:#f7f3ea}
.chips:empty{display:none}.chips button{font-size:13px;padding:6px 10px;color:${COLOR}}
.comp{border-top:1px solid #e2dac8;padding:8px;background:#fffdf8}
.pend{display:flex;gap:6px;padding:0 4px 6px}.pend:empty{display:none}
.pend div{position:relative}.pend img{width:48px;height:48px;object-fit:cover;border-radius:8px}
.pend button{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:0;background:#1d2a20;color:#fff;font-size:11px;cursor:pointer;line-height:18px;padding:0}
.row{display:flex;align-items:flex-end;gap:4px}
textarea{flex:1;border:0;outline:none;resize:none;background:transparent;padding:8px 4px;max-height:120px;min-height:38px;font-size:15px}
.cb{width:38px;height:38px;border-radius:11px;border:0;background:transparent;color:#5d6a5e;cursor:pointer;display:grid;place-items:center;flex:none}
.cb:hover{background:#f1ece0}.cb.send{background:${COLOR};color:#fff}.cb.rec{background:#b3412e;color:#fff;animation:p 1.2s infinite}
@keyframes p{50%{opacity:.7}}
.hist{position:absolute;inset:52px 0 0 0;background:#fffdf8;display:none;flex-direction:column;overflow:auto;padding:10px}
.hist.open{display:flex}.hist h4{margin:4px 6px 8px}
.hi{display:flex;align-items:center;gap:6px;padding:9px 10px;border-radius:10px;cursor:pointer}
.hi:hover{background:#f1ece0}.hi span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hi button{border:0;background:transparent;color:#5d6a5e;cursor:pointer;font-size:12px}
.foot{font-size:10.5px;color:#8a8f86;text-align:center;padding:2px 0 0}
@media (max-width:480px){.panel{inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0;bottom:0}}
</style>
<button class="launcher" aria-label="Open farmer chat">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>
</button>
<div class="panel" role="dialog" aria-label="Farmer chat">
  <div class="head">
    <div class="t"><b class="title"></b><small>Natural farming help · any language</small></div>
    <select class="lang" aria-label="Reply language"></select>
    <button class="hbtn hist-btn" title="Past chats" aria-label="Past chats"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg></button>
    <button class="hbtn new-btn" title="New chat" aria-label="New chat"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg></button>
    <button class="hbtn close-btn" title="Close" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>
  <div class="body" aria-live="polite"></div>
  <div class="chips"></div>
  <div class="comp">
    <div class="pend"></div>
    <div class="row">
      <button class="cb photo" title="Send a crop photo" aria-label="Attach photo"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-5-7 8"/></svg></button>
      <input type="file" class="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
      <textarea rows="1" placeholder="Ask in any Indian language…" aria-label="Your question"></textarea>
      <button class="cb mic" title="Speak" aria-label="Voice input" hidden><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
      <button class="cb send" aria-label="Send"><svg class="sendico" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
    </div>
    <div class="foot">AI answers may be imperfect — check important steps with your field coordinator.</div>
  </div>
  <div class="hist"><h4>Past chats</h4><div class="hlist"></div></div>
</div>`;
  const q = s => root.querySelector(s);
  const panel = q('.panel'), body = q('.body'), chips = q('.chips'), input = q('textarea');
  q('.title').textContent = TITLE;

  /* ---------- helpers ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function md(text) {
    const inl = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let html = '', list = null;
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of esc(text).split('\n')) {
      const l = raw.trim(); let m;
      if (!l) { close(); continue; }
      if ((m = l.match(/^#{1,4}\s+(.*)$/))) { close(); html += `<div class="h">${inl(m[1])}</div>`; continue; }
      if ((m = l.match(/^[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inl(m[1])}</li>`; continue; }
      if ((m = l.match(/^(\d+)[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); html += `<ol start="${m[1]}">`; list = 'ol'; } html += `<li>${inl(m[2])}</li>`; continue; }
      close(); html += `<p>${inl(l)}</p>`;
    }
    close(); return html;
  }
  const headers = (json = true) => Object.assign({ 'X-Device-Id': deviceId, 'X-Channel': 'web' }, json ? { 'Content-Type': 'application/json' } : {});
  async function api(path, opts = {}) {
    const r = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign(headers(!(opts.body instanceof FormData)), opts.headers || {}) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { status: r.status, data: j });
    return j;
  }
  const scroll = () => { body.scrollTop = body.scrollHeight; };
  function setBusy(b) {
    S.busy = b;
    q('.sendico').innerHTML = b ? '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>' : '<path d="M5 12h14M13 6l6 6-6 6"/>';
    q('.send').setAttribute('aria-label', b ? 'Stop' : 'Send');
  }

  /* ---------- rendering ---------- */
  function welcome() {
    body.innerHTML = `<div class="welcome"><h3>Vanakkam · Namaste 🙏</h3><p>Ask me about natural farming in your own language — type, speak, or send a crop photo.</p><div class="starter">${STARTERS.map(s => `<button>${esc(s)}</button>`).join('')}</div></div>`;
    body.querySelectorAll('.starter button').forEach(b => { b.onclick = () => send(b.textContent); });
    chips.innerHTML = '';
  }
  function userMsg(text, thumbs) {
    if (body.querySelector('.welcome')) body.innerHTML = '';
    const el = document.createElement('div'); el.className = 'm u';
    el.innerHTML = `<div class="bub" dir="auto">${(thumbs || []).map(u => `<img src="${u}" alt="">`).join('')}${thumbs && thumbs.length ? '<br>' : ''}${esc(text)}</div>`;
    body.appendChild(el); scroll(); return el;
  }
  function botMsg() {
    const el = document.createElement('div'); el.className = 'm b';
    el.innerHTML = '<div><div class="bub" dir="auto"><span class="dots"><i></i><i></i><i></i></span></div></div>';
    body.appendChild(el); scroll(); return el;
  }
  function botActions(el, msg) {
    const a = document.createElement('div'); a.className = 'acts';
    a.innerHTML = '<button data-a="speak">🔊 Listen</button><button data-a="up" title="Helpful">👍</button><button data-a="down" title="Not helpful">👎</button>';
    a.querySelector('[data-a=speak]').onclick = e => speak(msg.content, msg.lang, e.currentTarget);
    const rate = async (v, btn) => {
      if (!msg.id || msg.rating) return;
      msg.rating = v; btn.classList.add('on');
      a.querySelectorAll('[data-a=up],[data-a=down]').forEach(b => { b.disabled = true; });
      api(`/api/messages/${msg.id}/rating`, { method: 'POST', body: JSON.stringify({ rating: v }) }).catch(() => {});
    };
    a.querySelector('[data-a=up]').onclick = e => rate(1, e.currentTarget);
    a.querySelector('[data-a=down]').onclick = e => rate(-1, e.currentTarget);
    if (msg.rating) { a.querySelector(msg.rating > 0 ? '[data-a=up]' : '[data-a=down]').classList.add('on'); a.querySelectorAll('[data-a=up],[data-a=down]').forEach(b => { b.disabled = true; }); }
    el.firstElementChild.appendChild(a);
  }
  function renderChips(list) {
    chips.innerHTML = '';
    (list || []).slice(0, 3).forEach(s => { const b = document.createElement('button'); b.dir = 'auto'; b.textContent = s; b.onclick = () => send(s); chips.appendChild(b); });
  }

  /* ---------- chat ---------- */
  async function send(text) {
    text = (text || '').trim();
    if (S.busy || (!text && !S.images.length)) return;
    const imgs = S.images.slice(); S.images = []; renderPending();
    input.value = ''; autosize(); chips.innerHTML = '';
    userMsg(text || '📷', imgs.map(i => i.url));
    const el = botMsg(); const bub = el.querySelector('.bub');
    setBusy(true);
    const ctl = new AbortController(); S.ctl = ctl;
    let shown = '', done = null, errMsg = null;
    try {
      const r = await fetch(API + '/api/chat', {
        method: 'POST', headers: headers(), signal: ctl.signal,
        body: JSON.stringify({ conversationId: S.convId, message: text, language: S.lang, images: imgs.map(i => ({ mediaType: i.mediaType, data: i.data })) }),
      });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Could not reach the assistant.'); }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          let ev = 'message', data = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          let d; try { d = JSON.parse(data); } catch (e) { continue; }
          if (ev === 'meta' && d.conversationId) { S.convId = d.conversationId; ls.set('ks_conv', S.convId); }
          else if (ev === 'text') { shown += d.delta; bub.innerHTML = md(shown); scroll(); }
          else if (ev === 'done') done = d;
          else if (ev === 'error') { errMsg = d.error; if (d.partial) shown = d.partial; }
        }
      }
    } catch (e) {
      errMsg = e.name === 'AbortError' ? 'Stopped.' : (e.message || 'Network problem. Please try again.');
    } finally {
      if (S.ctl === ctl) S.ctl = null;
      setBusy(false);
    }
    if (done) {
      const msg = { id: done.messageId, content: done.content, lang: done.lang };
      bub.innerHTML = md(done.content); botActions(el, msg); renderChips(done.suggestions);
    } else {
      bub.innerHTML = (shown ? md(shown) : '') + `<div class="note ${errMsg === 'Stopped.' ? '' : 'err'}">${esc(errMsg || 'No reply.')}</div>`;
    }
    scroll();
  }

  /* ---------- history ---------- */
  async function openHistory() {
    const h = q('.hist'); h.classList.toggle('open');
    if (!h.classList.contains('open')) return;
    const list = q('.hlist'); list.innerHTML = '<div class="note">Loading…</div>';
    try {
      const rows = await api('/api/conversations');
      list.innerHTML = rows.length ? '' : '<div class="note">No past chats yet.</div>';
      rows.forEach(c => {
        const it = document.createElement('div'); it.className = 'hi';
        it.innerHTML = '<span dir="auto"></span><button title="Delete">✕</button>';
        it.firstChild.textContent = c.title || 'Chat';
        it.onclick = () => { h.classList.remove('open'); loadConversation(c.id); };
        it.querySelector('button').onclick = async ev => {
          ev.stopPropagation();
          await api('/api/conversations/' + c.id, { method: 'DELETE' }).catch(() => {});
          if (S.convId === c.id) newChat();
          it.remove();
        };
        list.appendChild(it);
      });
    } catch (e) { list.innerHTML = '<div class="note err">Could not load chats.</div>'; }
  }
  async function loadConversation(id) {
    try {
      const c = await api('/api/conversations/' + id);
      S.convId = c.id; ls.set('ks_conv', c.id);
      body.innerHTML = '';
      if (!c.messages.length) { welcome(); return; }
      let last = null;
      for (const m of c.messages) {
        if (m.role === 'user') userMsg(m.content + (m.image_count ? `  📷×${m.image_count}` : ''));
        else { const el = botMsg(); el.querySelector('.bub').innerHTML = md(m.content); botActions(el, m); last = m; }
      }
      renderChips(c.messages[c.messages.length - 1].role === 'assistant' && last ? last.suggestions : []);
    } catch (e) { S.convId = null; ls.del('ks_conv'); welcome(); }
  }
  function newChat() { if (S.busy && S.ctl) S.ctl.abort(); S.convId = null; ls.del('ks_conv'); welcome(); q('.hist').classList.remove('open'); input.focus(); }

  /* ---------- photos (resized in the browser before upload) ---------- */
  function resize(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1280, s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL('image/jpeg', 0.82);
        resolve({ url: dataUrl, mediaType: 'image/jpeg', data: dataUrl.split(',')[1] });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  async function addFiles(files) {
    for (const f of files) {
      if (!/^image\//.test(f.type) || S.images.length >= 4) continue;
      try { S.images.push(await resize(f)); } catch (e) { /* skip */ }
    }
    renderPending();
  }
  function renderPending() {
    const p = q('.pend'); p.innerHTML = '';
    S.images.forEach((im, i) => {
      const d = document.createElement('div'); d.innerHTML = '<img alt=""><button aria-label="Remove">✕</button>';
      d.querySelector('img').src = im.url; d.querySelector('button').onclick = () => { S.images.splice(i, 1); renderPending(); };
      p.appendChild(d);
    });
  }

  /* ---------- voice input (record → server → Sarvam STT) ---------- */
  async function toggleRec() {
    if (S.recording) { S.rec && S.rec.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { input.placeholder = 'Microphone blocked — please type.'; return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    S.rec = rec; S.recChunks = [];
    rec.ondataavailable = e => { if (e.data.size) S.recChunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      S.recording = false; q('.mic').classList.remove('rec'); clearTimeout(S.recTimer);
      const blob = new Blob(S.recChunks, { type: rec.mimeType || 'audio/webm' });
      if (blob.size < 1200) return;
      const ph = input.placeholder; input.placeholder = 'Listening to your voice…';
      try {
        const fd = new FormData();
        fd.append('audio', blob, 'voice.' + (/mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm'));
        fd.append('language', S.lang);
        const r = await api('/api/transcribe', { method: 'POST', body: fd });
        if (r.text) { input.value = (input.value ? input.value + ' ' : '') + r.text; autosize(); input.focus(); }
      } catch (e) { input.placeholder = 'Could not understand — please try again or type.'; setTimeout(() => { input.placeholder = ph; }, 3000); return; }
      input.placeholder = ph;
    };
    rec.start(); S.recording = true; q('.mic').classList.add('rec');
    S.recTimer = setTimeout(() => { if (S.recording) rec.stop(); }, 28000); // Sarvam REST: under 30 s
  }

  /* ---------- read aloud (Sarvam for 11 languages, else the browser's own voice) ---------- */
  function stopSpeaking() {
    try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (S.audio) { S.audio.pause(); S.audio = null; }
    if (S.speakingBtn) { S.speakingBtn.textContent = '🔊 Listen'; S.speakingBtn.classList.remove('on'); S.speakingBtn = null; }
  }
  async function speak(text, lang, btn) {
    const was = S.speakingBtn === btn; stopSpeaking(); if (was) return;
    S.speakingBtn = btn; btn.textContent = '⏹ Stop'; btn.classList.add('on');
    const code = lang || (S.lang !== 'auto' ? S.lang : 'en');
    const L = S.languages.find(l => l.code === code);
    if (L && L.serverTts) {
      try {
        const r = await api('/api/tts', { method: 'POST', body: JSON.stringify({ text, language: code }) });
        if (S.speakingBtn !== btn) return;
        S.audio = new Audio(`data:${r.mimeType};base64,${r.audio}`);
        S.audio.onended = stopSpeaking; await S.audio.play(); return;
      } catch (e) { /* fall back to browser voice */ }
    }
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/[*#_`>]/g, '').slice(0, 3000));
      u.lang = code === 'en' ? 'en-IN' : code + '-IN';
      const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.toLowerCase().startsWith(code + '-'));
      if (v) u.voice = v;
      u.onend = u.onerror = stopSpeaking; speechSynthesis.speak(u);
    } catch (e) { stopSpeaking(); }
  }

  /* ---------- setup ---------- */
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
  async function init() {
    if (S.loaded) return; S.loaded = true;
    try {
      const c = await api('/api/config');
      S.languages = c.languages || []; S.voiceInput = !!c.voiceInput;
      if (c.botName && !ds.title) { TITLE = c.botName; q('.title').textContent = TITLE; }
    } catch (e) { S.languages = []; }
    const sel = q('.lang');
    sel.innerHTML = '<option value="auto">Auto 🌐</option>' + S.languages.map(l => `<option value="${l.code}">${esc(l.native)}</option>`).join('');
    sel.value = S.languages.some(l => l.code === S.lang) ? S.lang : 'auto';
    sel.onchange = () => { S.lang = sel.value; ls.set('ks_lang', S.lang); };
    q('.mic').hidden = !(S.voiceInput && navigator.mediaDevices && window.MediaRecorder);
    if (S.convId) await loadConversation(S.convId); else welcome();
  }
  function toggle(open) {
    const isOpen = open == null ? !panel.classList.contains('open') : open;
    panel.classList.toggle('open', isOpen);
    if (isOpen) { init(); setTimeout(() => input.focus(), 50); } else stopSpeaking();
  }
  q('.launcher').onclick = () => toggle();
  q('.close-btn').onclick = () => toggle(false);
  q('.new-btn').onclick = newChat;
  q('.hist-btn').onclick = openHistory;
  q('.send').onclick = () => { if (S.busy) { S.ctl && S.ctl.abort(); } else send(input.value); };
  q('.photo').onclick = () => q('.file').click();
  q('.file').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  q('.mic').onclick = toggleRec;
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!S.busy) send(input.value); } });
  input.addEventListener('paste', e => { const fs = [...((e.clipboardData && e.clipboardData.files) || [])].filter(f => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); addFiles(fs); } });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });

  const mount = () => { document.body.appendChild(host); if (ds.open === 'true') toggle(true); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  // Small public API: window.KrishiSaathi.open() / .close() / .ask("question")
  window.KrishiSaathi = { open: () => toggle(true), close: () => toggle(false), ask: t => { toggle(true); init().then(() => send(t)); } };
})();
