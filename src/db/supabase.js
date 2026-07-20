import { createClient } from '@supabase/supabase-js';
import { config, PIPELINE_STATUS } from '../config.js';

const supabaseUrl = config.SUPABASE_URL;
const supabaseKey = config.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ─── Calendar ──────────────────────────

export async function getTodayPillar(date = new Date()) {
  const dayOfWeek = date.getDay();
  const { data, error } = await supabase
    .from('content_calendar')
    .select('*')
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Gagal ambil pilar: ${error.message}`);
  if (!data) throw new Error(`Tidak ada pilar untuk hari ini (day ${dayOfWeek}). Jalankan 'npm run seed' dulu.`);
  return data;
}

// ─── Pipeline ──────────────────────────

export async function createPipelineEntry(calendarDate, pillar, ideaContent) {
  const { data, error } = await supabase
    .from('content_pipeline')
    .insert({
      calendar_date: calendarDate,
      pillar_name: pillar.pillar_name,
      needs_real_photo: pillar.needs_real_photo,
      idea_content: ideaContent,
      status: PIPELINE_STATUS.IDEA,
    })
    .select()
    .single();

  if (error) throw new Error(`Gagal buat pipeline: ${error.message}`);
  return data;
}

export async function updatePipelineStatus(id, status, updates = {}) {
  const { data, error } = await supabase
    .from('content_pipeline')
    .update({ status, ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Gagal update pipeline: ${error.message}`);
  return data;
}

export async function getPipelineById(id) {
  const { data, error } = await supabase
    .from('content_pipeline')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Gagal ambil pipeline: ${error.message}`);
  return data;
}

export async function getPipelineByDate(date) {
  const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date;
  const { data, error } = await supabase
    .from('content_pipeline')
    .select('*')
    .eq('calendar_date', dateStr)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Gagal ambil pipeline: ${error.message}`);
  return data;
}

export async function getActivePipelines() {
  const { data, error } = await supabase
    .from('content_pipeline')
    .select('*')
    .not('status', 'in', `("${PIPELINE_STATUS.PUBLISHED}","${PIPELINE_STATUS.FAILED}")`)
    .order('calendar_date', { ascending: true });

  if (error) throw new Error(`Gagal ambil pipeline aktif: ${error.message}`);
  return data;
}

// ─── Conversation History ──────────────

// In-memory fallback kalo DB gak bisa
const memHistory = new Map();
const dbUnavailableUntil = new Map();
const DB_COOLDOWN_MS = 10 * 60 * 1000; // 10 menit fallback memory kalo DB error berulang

function isDbInCooldown(key) {
  const until = dbUnavailableUntil.get(key) || 0;
  return Date.now() < until;
}

function markDbCooldown(key) {
  dbUnavailableUntil.set(key, Date.now() + DB_COOLDOWN_MS);
}

export async function saveConversationMessage(chatId, role, content, contextSnapshot = null) {
  const key = `save:${chatId}`;
  if (isDbInCooldown(key)) {
    if (!memHistory.has(chatId)) memHistory.set(chatId, []);
    const hist = memHistory.get(chatId);
    hist.push({ role, content });
    if (hist.length > 50) hist.splice(0, hist.length - 50);
    return;
  }
  const { error } = await supabase.from('conversation_history').insert({
    chat_id: chatId,
    role,
    content,
    context_snapshot: contextSnapshot,
  });
  if (error) {
    console.error('[DB] Gagal simpan percakapan (fallback ke memory):', error.message);
    markDbCooldown(key);
    if (!memHistory.has(chatId)) memHistory.set(chatId, []);
    const hist = memHistory.get(chatId);
    hist.push({ role, content });
    if (hist.length > 50) hist.splice(0, hist.length - 50);
  }
}

export async function getRecentConversation(chatId, limit = 20) {
  const key = `save:${chatId}`;
  if (isDbInCooldown(key)) {
    if (memHistory.has(chatId)) {
      return memHistory.get(chatId).slice(-limit);
    }
    return [];
  }
  try {
    const { data, error } = await supabase
      .from('conversation_history')
      .select('role, content')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data || []).reverse();
  } catch {
    markDbCooldown(key);
    if (memHistory.has(chatId)) {
      return memHistory.get(chatId).slice(-limit);
    }
    return [];
  }
}

// ─── Learnings ──────────────────────────

export async function getActiveLearnings(pillarName = null) {
  // Fetch all active learnings, filter in code to avoid special char issues
  const { data, error } = await supabase
    .from('learnings')
    .select('*')
    .eq('status', 'active')
    .order('confidence', { ascending: false });

  if (error) throw new Error(`Gagal ambil learnings: ${error.message}`);

  if (!pillarName) return data || [];

  return (data || []).filter(l => !l.pillar_related || l.pillar_related === pillarName);
}

export async function createLearning(insight) {
  const { data, error } = await supabase
    .from('learnings')
    .insert(insight)
    .select()
    .single();

  if (error) throw new Error(`Gagal simpan learning: ${error.message}`);
  return data;
}

// ─── Post Analytics ──────────────────────

export async function upsertPostAnalytics(postData) {
  const { data, error } = await supabase
    .from('post_analytics')
    .upsert(postData, { onConflict: 'ig_media_id' })
    .select()
    .single();

  if (error) throw new Error(`Gagal upsert post analytics: ${error.message}`);
  return data;
}

export async function getPostAnalytics(options = {}) {
  const { limit = 50, orderBy = 'timestamp', ascending = false, startDate = null, endDate = null } = options;

  let query = supabase
    .from('post_analytics')
    .select('*')
    .order(orderBy, { ascending })
    .limit(limit);

  if (startDate) query = query.gte('timestamp', startDate);
  if (endDate) query = query.lte('timestamp', endDate);

  const { data, error } = await query;
  if (error) throw new Error(`Gagal ambil post analytics: ${error.message}`);
  return data || [];
}

export async function getTopPosts(limit = 10, metric = 'engagement_rate') {
  const { data, error } = await supabase
    .from('post_analytics')
    .select('*')
    .order(metric, { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Gagal ambil top posts: ${error.message}`);
  return data || [];
}

export async function getPostAnalyticsByType(mediaType) {
  const { data, error } = await supabase
    .from('post_analytics')
    .select('*')
    .eq('media_type', mediaType)
    .order('engagement_rate', { ascending: false });

  if (error) throw new Error(`Gagal ambil analytics by type: ${error.message}`);
  return data || [];
}

export async function getAnalyticsSummary() {
  const { data, error } = await supabase
    .rpc('get_analytics_summary');

  if (error) {
    // Fallback ke query manual kalo RPC gak ada
    const { data: posts, error: fallbackError } = await supabase
      .from('post_analytics')
      .select('like_count, comments_count, saves, reach, shares, profile_visits, follows, engagement_rate');

    if (fallbackError) throw new Error(`Gagal ambil summary: ${fallbackError.message}`);

    if (!posts || posts.length === 0) {
      return { total_posts: 0, avg_engagement: 0, total_reach: 0 };
    }

    const summary = posts.reduce((acc, post) => {
      acc.total_posts++;
      acc.total_likes += post.like_count || 0;
      acc.total_comments += post.comments_count || 0;
      acc.total_saves += post.saves || 0;
      acc.total_reach += post.reach || 0;
      acc.total_shares += post.shares || 0;
      acc.total_profile_visits += post.profile_visits || 0;
      acc.total_follows += post.follows || 0;
      acc.total_engagement_rate += post.engagement_rate || 0;
      return acc;
    }, {
      total_posts: 0, total_likes: 0, total_comments: 0, total_saves: 0,
      total_reach: 0, total_shares: 0, total_profile_visits: 0, total_follows: 0,
      total_engagement_rate: 0
    });

    summary.avg_engagement = summary.total_posts > 0
      ? (summary.total_engagement_rate / summary.total_posts).toFixed(2)
      : 0;

    return summary;
  }

  return data;
}

// ─── Agent Logs ──────────────────────────

export async function logAgentAction(log) {
  const { error } = await supabase.from('agent_logs').insert({
    ...log,
    created_at: new Date().toISOString(),
  });

  if (error) console.error('[DB] Gagal log agent action:', error.message);
}

// ─── Provider Health ──────────────────

export async function updateProviderHealth(providerName, data) {
  const { error } = await supabase
    .from('provider_health')
    .upsert(
      { provider_name: providerName, ...data, checked_at: new Date().toISOString() },
      { onConflict: 'provider_name' }
    );

  if (error) console.error('[DB] Gagal update health provider:', error.message);
}

export async function getHealthyProvider(providerName) {
  const { data } = await supabase
    .from('provider_health')
    .select('status')
    .eq('provider_name', providerName)
    .single();

  return data?.status !== 'down';
}
