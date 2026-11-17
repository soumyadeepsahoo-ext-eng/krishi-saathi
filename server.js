import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { LANGUAGES, BY_CODE, fromSarvam } from './languages.js';
import { buildSystem, visiblePart, parseMeta } from './prompt.js';
import * as db from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.set('trust proxy', 1); // Render / Vercel sit behind a proxy
app.use(cors({
  origin: config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Channel'],
}));
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

const chatLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many messages. Please wait a minute.' } });
const voiceLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

const UUIDISH = /^[A-Za-z0-9-]{16,64}$/;
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* Identify the farmer by an anonymous device id the app/widget generates. */
const farmer = wrap(async (req, res, next) => {
  const deviceId = req.get('X-Device-Id');
  if (!deviceId || !UUIDISH.test(deviceId)) return res.status(400).json({ error: 'Missing or invalid X-Device-Id header' });
  const channel = ['web', 'app', 'whatsapp'].includes(req.get('X-Channel')) ? req.get('X-Channel') : 'web';
  req.farmer = await db.getOrCreateFarmer(deviceId, channel);
  req.channel = channel;
  next();
});

const admin = (req, res, next) => {
  const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== config.adminToken) return res.status(401).json({ error: 'Unauthorised' });
  next();
};

/* ---------- Public config ---------- */
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/config', (_req, res) => res.json({
  botName: config.botName,
  languages: LANGUAGES.map(({ code, name, native, tts }) => ({ code, name, native, serverTts: !!config.sarvamKey && tts })),
  voiceInput: !!config.sarvamKey,
}));

/* ---------- Chat (Server-Sent Events stream) ---------- */
app.post('/api/chat', chatLimiter, farmer, wrap(async (req, res) => {
  const { conversationId, message = '', language = 'auto', fast = false } = req.body || {};
  const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, 4) : [];
  const text = String(message).trim().slice(0, 4000);
  if (!text && !images.length) return res.status(400).json({ error: 'Empty message' });
  for (const im of images) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(im?.mediaType) || typeof im?.data !== 'string') {
      return res.status(400).json({ error: 'Images must be JPEG, PNG, WebP or GIF (base64).' });
    }
  }
  const lang = BY_CODE[language] ? language : 'auto';
  const shown = text || '(photo)';

  // Conversation
  let conv = conversationId ? await db.getConversation(conversationId, req.farmer.id) : null;
  if (!conv) conv = await db.createConversation(req.farmer.id, shown.replace(/\s+/g, ' ').slice(0, 80), lang, req.channel);
  const history = await db.recentMessages(conv.id, 14);
  await db.addMessage({ conversation_id: conv.id, role: 'user', content: shown, image_count: images.length });

  // Build Claude request
  const msgs = history.map(m => ({ role: m.role, content: m.image_count && m.role === 'user' ? `${m.content}\n[farmer had attached ${m.image_count} photo(s)]` : m.content }));
  const userContent = [
    ...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })),
    { type: 'text', text: images.length ? `${shown}\n\n[The farmer attached ${images.length} photo(s).]` : shown },
  ];
  msgs.push({ role: 'user', content: userContent });
  // The API needs alternating roles starting with user: merge any repeats.
  const merged = [];
  for (const m of msgs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) {
      const toBlocks = c => (typeof c === 'string' ? [{ type: 'text', text: c }] : c);
      prev.content = [...toBlocks(prev.content), ...toBlocks(m.content)];
    } else merged.push({ ...m });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();

  const kb = await db.activeKb();
  const model = fast ? config.fastModel : config.model;

  // Stream back to the client
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('meta', { conversationId: conv.id });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);

  let full = '', sentLen = 0, finished = false;
  const stream = anthropic.messages.stream({
    model, max_tokens: 4096, system: buildSystem(kb, lang, req.farmer), messages: merged,
  });
  res.on('close', () => { if (!finished) stream.abort(); clearInterval(ping); });

  stream.on('text', delta => {
    full += delta;
    const vis = visiblePart(full);
    if (vis.length > sentLen) { send('text', { delta: vis.slice(sentLen) }); sentLen = vis.length; }
  });

  try {
    await stream.finalMessage();
    finished = true;
    const { body, meta } = parseMeta(full);
    const content = body || full;
    const replyLang = (meta?.lang && String(meta.lang).slice(0, 8)) || (lang !== 'auto' ? lang : null);
    const suggestions = Array.isArray(meta?.suggestions) ? meta.suggestions.filter(s => typeof s === 'string').slice(0, 3) : [];
    const saved = await db.addMessage({
      conversation_id: conv.id, role: 'assistant', content, lang: replyLang, question: shown.slice(0, 1000),
      topic: meta?.topic ? String(meta.topic).slice(0, 80) : null, kb_gap: !!meta?.gap, suggestions, model,
    });
    await db.touchConversation(conv.id, { language: replyLang || lang });
    send('done', { messageId: saved.id, content, suggestions, lang: replyLang });
  } catch (err) {
    finished = true;
    if (!res.writableEnded) {
      const status = err?.status;
      const msg = status === 429 || status === 529 ? 'The assistant is busy right now. Please try again in a minute.'
        : 'Sorry, something went wrong. Please try again.';
      console.error('chat error', status, err?.message);
      send('error', { error: msg, partial: visiblePart(full) });
    }
  } finally {
    clearInterval(ping);
    if (!res.writableEnded) res.end();
  }
}));

/* ---------- History ---------- */
app.get('/api/conversations', farmer, wrap(async (req, res) => {
  res.json(await db.listConversations(req.farmer.id));
}));
app.get('/api/conversations/:id', farmer, wrap(async (req, res) => {
  const conv = await db.getConversation(req.params.id, req.farmer.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json({ ...conv, messages: await db.allMessages(conv.id) });
}));
app.delete('/api/conversations/:id', farmer, wrap(async (req, res) => {
  await db.deleteConversation(req.params.id, req.farmer.id);
  res.json({ ok: true });
}));
app.post('/api/messages/:id/rating', farmer, wrap(async (req, res) => {
  const rating = Number(req.body?.rating);
  if (![1, -1].includes(rating)) return res.status(400).json({ error: 'rating must be 1 or -1' });
  const ok = await db.rateMessage(req.params.id, req.farmer.id, rating);
  res.status(ok ? 200 : 404).json({ ok });
}));

/* ---------- Farm profile ---------- */
app.get('/api/profile', farmer, (req, res) => {
  const { region, crops, land, stage, language } = req.farmer;
  res.json({ region, crops, land, stage, language });
});
app.put('/api/profile', farmer, wrap(async (req, res) => {
  const b = req.body || {};
  const clean = v => (v == null ? null : String(v).trim().slice(0, 160) || null);
  const f = await db.updateFarmer(req.farmer.id, {
    region: clean(b.region), crops: clean(b.crops), land: clean(b.land), stage: clean(b.stage),
    language: BY_CODE[b.language] ? b.language : 'auto',
  });
  res.json({ region: f.region, crops: f.crops, land: f.land, stage: f.stage, language: f.language });
}));

/* ---------- Voice: speech-to-text (Sarvam, 22 languages) ---------- */
app.post('/api/transcribe', voiceLimiter, farmer, upload.single('audio'), wrap(async (req, res) => {
  if (!config.sarvamKey) return res.status(501).json({ error: 'Voice input is not configured' });
  if (!req.file) return res.status(400).json({ error: 'No audio file' });
  const lang = BY_CODE[req.body?.language]?.sarvam || 'unknown';
  const form = new FormData();
  form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), req.file.originalname || 'voice.webm');
  form.append('model', 'saaras:v3');
  form.append('mode', 'transcribe');
  form.append('language_code', lang);
  const r = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST', headers: { 'api-subscription-key': config.sarvamKey }, body: form,
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('sarvam stt', r.status, out); return res.status(502).json({ error: 'Could not understand the audio. Please try again or type.' }); }
  res.json({ text: out.transcript || '', language: fromSarvam(out.language_code) });
}));

/* ---------- Voice: text-to-speech (Sarvam Bulbul, 11 languages) ---------- */
app.post('/api/tts', voiceLimiter, farmer, wrap(async (req, res) => {
  const L = BY_CODE[req.body?.language];
  if (!config.sarvamKey || !L?.tts) return res.status(404).json({ error: 'Server voice not available for this language', fallback: true });
  const text = String(req.body?.text || '').replace(/[*#_`>]/g, '').slice(0, 2400);
  if (!text.trim()) return res.status(400).json({ error: 'No text' });
  const r = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': config.sarvamKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language_code: L.sarvam, model: 'bulbul:v3', output_audio_codec: 'mp3' }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.audios?.[0]) { console.error('sarvam tts', r.status, out); return res.status(502).json({ error: 'Read-aloud failed', fallback: true }); }
  res.json({ audio: out.audios[0], mimeType: 'audio/mpeg' });
}));

/* ---------- Admin: knowledge base + insights ---------- */
const kbFields = b => ({
  title: String(b.title || '').trim().slice(0, 200),
  category: String(b.category || 'Other').trim().slice(0, 60),
  content: String(b.content || '').trim().slice(0, 20000),
  keywords: String(b.keywords || '').trim().slice(0, 500),
  active: b.active !== false,
});
app.get('/api/admin/kb', admin, wrap(async (_req, res) => res.json(await db.listKb())));
app.post('/api/admin/kb', admin, wrap(async (req, res) => {
  const f = kbFields(req.body || {});
  if (!f.title || !f.content) return res.status(400).json({ error: 'Title and content are required' });
  res.json(await db.createKb(f));
}));
app.put('/api/admin/kb/:id', admin, wrap(async (req, res) => {
  const f = kbFields(req.body || {});
  if (!f.title || !f.content) return res.status(400).json({ error: 'Title and content are required' });
  res.json(await db.updateKb(req.params.id, f));
}));
app.delete('/api/admin/kb/:id', admin, wrap(async (req, res) => { await db.deleteKb(req.params.id); res.json({ ok: true }); }));
app.post('/api/admin/kb/import', admin, wrap(async (req, res) => {
  const rows = (Array.isArray(req.body?.entries) ? req.body.entries : []).slice(0, 1000).map(kbFields).filter(r => r.title && r.content);
  if (!rows.length) return res.status(400).json({ error: 'No valid rows (need title and content)' });
  const out = await db.importKb(rows);
  res.json({ imported: out.length });
}));
app.get('/api/admin/insights', admin, wrap(async (_req, res) => res.json(await db.insights())));

/* ---------- Errors ---------- */
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
  console.error(err);
  if (res.headersSent) return res.end();
  res.status(err.status && err.status < 600 ? err.status : 500).json({ error: err.expose ? err.message : 'Server error' });
});

app.listen(config.port, () => console.log(`${config.botName} backend listening on :${config.port}`));
