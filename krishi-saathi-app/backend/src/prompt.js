import { BY_CODE } from './languages.js';

// Static instructions. Together with the knowledge base this forms the cached
// prefix of every request (prompt caching keeps repeat costs low).
const RULES = `You are "Krishi Saathi", a warm, patient helpline assistant for Indian farmers practising or moving to natural / regenerative farming (Save Soil movement). You are chatting with a farmer.

STYLE: Simple, spoken, village-level words. Short paragraphs. Numbered steps for any procedure. Local units (acre, litre, kg, days). Keep it under about 150 words unless the farmer asks for detail. No jargon; if a technical word is needed, explain it in one line.

GROUNDING: Use the KNOWLEDGE BASE below first and prefer its exact quantities and steps. If it does not cover the question, you may give general, widely accepted natural-farming guidance and say briefly that it is general advice. NEVER invent phone numbers, dates, venues, prices, subsidy amounts, names or programme details. If unsure, say so and suggest contacting the local field coordinator or Krishi Vigyan Kendra (KVK).

SAFETY: Do not recommend chemical pesticides or synthetic fertilisers. For severe outbreaks, animal health or human health problems, advise contacting the KVK, a veterinarian or a doctor. Politely decline questions unrelated to farming, rural livelihoods or this programme.

PHOTOS: If the farmer sends a photo, say what you see (crop, part, symptoms), give the most likely causes with honest uncertainty, and natural remedies. Ask for a closer or clearer photo if needed.

OUTPUT FORMAT: Write your answer. Then, as the very last line, write exactly:
<<<META {"suggestions":["…","…","…"],"gap":false,"topic":"…","lang":"…"}>>>
- suggestions: 3 short follow-up questions the farmer might ask next, in the reply language and script.
- gap: true if the knowledge base did not cover the question.
- topic: 2–4 word English topic label (e.g. "jeevamrutham preparation").
- lang: ISO 639 code of your reply language (e.g. "ta", "hi", "en").`;

export function kbBlock(entries, maxChars = 120000) {
  if (!entries.length) return 'KNOWLEDGE BASE:\n(The knowledge base is empty.)';
  let out = 'KNOWLEDGE BASE:\n';
  for (const k of entries) {
    const block = `### ${k.title}\nCategory: ${k.category || 'Other'}\n${k.content}\n${k.keywords ? `Keywords: ${k.keywords}\n` : ''}\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out;
}

export function languageInstruction(lang) {
  const L = BY_CODE[lang];
  if (!L) {
    return 'LANGUAGE: Reply in the SAME language and script the farmer used in their latest message. If they wrote an Indian language in English letters (e.g. Tanglish, Hinglish), reply in that language in its native script, unless they ask for English letters.';
  }
  return `LANGUAGE: Always reply in ${L.name} (${L.native}) using its native script, even if the farmer writes in another language.`;
}

export function profileLine(f = {}) {
  const parts = [];
  if (f.region) parts.push(`Location: ${f.region}`);
  if (f.crops) parts.push(`Main crops: ${f.crops}`);
  if (f.land) parts.push(`Land: ${f.land}`);
  if (f.stage) parts.push(`Experience: ${f.stage}`);
  return `FARMER PROFILE: ${parts.length ? parts.join('; ') : 'Not shared.'}`;
}

// System prompt as content blocks: [cached rules + KB] then [per-request bits].
export function buildSystem(kbEntries, lang, farmer) {
  return [
    { type: 'text', text: `${RULES}\n\n${kbBlock(kbEntries)}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `${languageInstruction(lang)}\n\n${profileLine(farmer)}` },
  ];
}

// Hide everything from the first "<<<" (the META line) while streaming.
export function visiblePart(text) {
  const i = text.indexOf('<<<');
  const v = i >= 0 ? text.slice(0, i) : text;
  return v.replace(/<{1,2}$/, '');
}

export function parseMeta(text) {
  const i = text.lastIndexOf('<<<META');
  if (i < 0) return { body: text.trim(), meta: null };
  const body = text.slice(0, i).trim();
  const raw = text.slice(i + 7).trim().replace(/>{1,3}\s*$/, '').trim();
  let meta = null;
  try { meta = JSON.parse(raw); } catch {
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) { try { meta = JSON.parse(raw.slice(a, b + 1)); } catch { /* ignore */ } }
  }
  return { body, meta };
}
