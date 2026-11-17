// All database access lives here (Supabase / PostgreSQL via the service-role key).
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function check({ data, error }) {
  if (error) throw Object.assign(new Error(error.message), { status: 500, cause: error });
  return data;
}

/* ---------- Farmers ---------- */
export async function getOrCreateFarmer(deviceId, channel = 'web') {
  const found = check(await supabase.from('farmers').select('*').eq('device_id', deviceId).maybeSingle());
  if (found) {
    // Touch last_seen without blocking the request.
    supabase.from('farmers').update({ last_seen: new Date().toISOString() }).eq('id', found.id).then(() => {});
    return found;
  }
  return check(await supabase.from('farmers')
    .upsert({ device_id: deviceId, channel }, { onConflict: 'device_id' })
    .select('*').single());
}

export async function updateFarmer(id, fields) {
  return check(await supabase.from('farmers').update(fields).eq('id', id).select('*').single());
}

/* ---------- Conversations & messages ---------- */
export async function getConversation(id, farmerId) {
  return check(await supabase.from('conversations').select('*').eq('id', id).eq('farmer_id', farmerId).maybeSingle());
}

export async function createConversation(farmerId, title, language, channel) {
  return check(await supabase.from('conversations')
    .insert({ farmer_id: farmerId, title, language, channel }).select('*').single());
}

export async function touchConversation(id, fields = {}) {
  return check(await supabase.from('conversations')
    .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id));
}

export async function listConversations(farmerId, limit = 50) {
  return check(await supabase.from('conversations')
    .select('id,title,language,updated_at').eq('farmer_id', farmerId)
    .order('updated_at', { ascending: false }).limit(limit));
}

export async function deleteConversation(id, farmerId) {
  return check(await supabase.from('conversations').delete().eq('id', id).eq('farmer_id', farmerId));
}

export async function recentMessages(conversationId, limit = 14) {
  const rows = check(await supabase.from('messages')
    .select('id,role,content,lang,image_count,suggestions,rating,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).limit(limit));
  return rows.reverse();
}

export async function allMessages(conversationId) {
  return check(await supabase.from('messages')
    .select('id,role,content,lang,image_count,suggestions,rating,created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(500));
}

export async function addMessage(row) {
  return check(await supabase.from('messages').insert(row).select('id').single());
}

export async function rateMessage(messageId, farmerId, rating) {
  // Make sure the message belongs to this farmer before rating it.
  const msg = check(await supabase.from('messages')
    .select('id, conversations!inner(farmer_id)').eq('id', messageId)
    .eq('conversations.farmer_id', farmerId).maybeSingle());
  if (!msg) return false;
  check(await supabase.from('messages').update({ rating }).eq('id', messageId));
  return true;
}

/* ---------- Knowledge base (cached in memory for 60 s) ---------- */
let kbCache = { at: 0, rows: [] };
export async function activeKb() {
  if (Date.now() - kbCache.at < 60_000) return kbCache.rows;
  const rows = check(await supabase.from('kb_entries')
    .select('id,title,category,content,keywords').eq('active', true)
    .order('category').order('title'));
  kbCache = { at: Date.now(), rows };
  return rows;
}
export function invalidateKb() { kbCache.at = 0; }

export async function listKb() {
  return check(await supabase.from('kb_entries').select('*').order('category').order('title'));
}
export async function createKb(fields) {
  invalidateKb();
  return check(await supabase.from('kb_entries').insert(fields).select('*').single());
}
export async function updateKb(id, fields) {
  invalidateKb();
  return check(await supabase.from('kb_entries')
    .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select('*').single());
}
export async function deleteKb(id) {
  invalidateKb();
  return check(await supabase.from('kb_entries').delete().eq('id', id));
}
export async function importKb(rows) {
  invalidateKb();
  return check(await supabase.from('kb_entries').insert(rows).select('id'));
}

/* ---------- Insights ---------- */
export async function insights() {
  const [totals, languages, topics, gaps, feedback] = await Promise.all([
    supabase.from('insights_totals').select('*').single(),
    supabase.from('insights_languages').select('*'),
    supabase.from('insights_topics').select('*'),
    supabase.from('messages').select('question,topic,lang,created_at').eq('kb_gap', true)
      .order('created_at', { ascending: false }).limit(50),
    supabase.from('messages').select('question,content,rating,lang,created_at').not('rating', 'is', null)
      .order('created_at', { ascending: false }).limit(30),
  ]);
  return {
    totals: check(totals), languages: check(languages), topics: check(topics),
    gaps: check(gaps), feedback: check(feedback),
  };
}
