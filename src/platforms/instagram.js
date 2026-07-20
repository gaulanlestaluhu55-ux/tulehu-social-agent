import { config, IG_API_BASE } from '../config.js';

const token = () => config.IG_ACCESS_TOKEN;
const igUser = () => config.IG_USER_ID;

async function api(method, path, opts = {}) {
  const url = `${IG_API_BASE}${path}`;
  const params = { access_token: token(), ...opts.params };
  const res = await fetch(url, { method, ...(opts.body ? { body: opts.body } : {}), ...(params ? {} : {}) });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

function qs(obj) { return '?' + Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); }

async function get(path, params = {}) {
  params.access_token = token();
  const res = await fetch(`${IG_API_BASE}${path}${qs(params)}`);
  return res.json();
}

async function post(path, params = {}) {
  params.access_token = token();
  const res = await fetch(`${IG_API_BASE}${path}${qs(params)}`, { method: 'POST' });
  return res.json();
}

// ─── instagram_basic ───────────────────────

export async function getIgUser(fields = 'id,username,name,profile_picture_url') {
  return get(`/${igUser()}`, { fields });
}

export async function getUserMedia(limit = 50, after = null) {
  const params = {
    fields: 'id,caption,media_type,media_url,timestamp,permalink,like_count,comments_count',
    limit,
  };
  if (after) params.after = after;
  return get(`/${igUser()}/media`, params);
}

export async function getAllUserMedia() {
  const allMedia = [];
  let after = null;
  do {
    const res = await getUserMedia(50, after);
    if (res.data) allMedia.push(...res.data);
    after = res.paging?.next || null;
  } while (after);
  return allMedia;
}

// ─── instagram_content_publish ────────────

export async function createMediaContainer(imageUrl, caption) {
  const data = await post(`/${igUser()}/media`, { image_url: imageUrl, caption });
  if (data.error) throw new Error(`Create media gagal: ${data.error.message}`);
  return data.id;
}

export async function publishMediaContainer(containerId) {
  const data = await post(`/${igUser()}/media_publish`, { creation_id: containerId });
  if (data.error) throw new Error(`Publish media gagal: ${data.error.message}`);
  return data.id;
}

export async function getMedia(mediaId, fields = 'id,permalink,media_type,media_url,caption,timestamp') {
  return get(`/${mediaId}`, { fields });
}

export async function getMediaChildren(carouselMediaId) {
  return get(`/${carouselMediaId}/children`, { fields: 'id,media_url,media_type' });
}

// ─── instagram_manage_insights ────────────

export async function getMediaInsights(mediaId) {
  const data = await get(`/${mediaId}/insights`, {
    metric: 'saved,likes,comments,reach,shares,profile_visits,follows',
  });
  const parsed = {};
  for (const item of data.data || []) {
    const val = item.values?.[0]?.value;
    parsed[item.name] = typeof val === 'number' ? val : 0;
  }
  return parsed;
}

export async function getUserInsights(since, until, metric = 'impressions,reach,profile_views,follower_count') {
  const data = await get(`/${igUser()}/insights`, {
    metric,
    period: 'day',
    since: Math.floor(since.getTime() / 1000),
    until: Math.floor(until.getTime() / 1000),
  });
  return data.data || [];
}

// ─── instagram_manage_comments ───────────

export async function getComments(mediaId, limit = 50) {
  const data = await get(`/${mediaId}/comments`, {
    fields: 'id,text,username,timestamp,like_count,replies',
    limit,
  });
  return data.data || [];
}

export async function replyToComment(commentId, message) {
  const data = await post(`/${commentId}/replies`, { message });
  if (data.error) throw new Error(`Reply gagal: ${data.error.message}`);
  return data.id;
}

export async function getCommentReplies(commentId) {
  const data = await get(`/${commentId}/replies`, { fields: 'id,text,username,timestamp' });
  return data.data || [];
}

export async function deleteComment(commentId) {
  return fetch(`${IG_API_BASE}/${commentId}?access_token=${token()}`, { method: 'DELETE' });
}

export function scoreCommentQuality(text) {
  const lower = text.toLowerCase();
  if (/harga|berapaan|price|cost|order|pesan|custom|dm|wa\b|chat|min\b|kak|bang/i.test(lower)) return 3;
  if (/bagus|keren|mantap|suka|nice|good|love|best|wah|salut|kualitas|rapi/i.test(lower)) return 2;
  if (/^(🔥|❤️|😍|👍|🙌|💯|👏)+$/i.test(text.trim()) || /@\w+/.test(lower)) return 1;
  if (/follow|f4f|like4like|promo|spam/i.test(lower)) return 0;
  return 1;
}

// ─── instagram_manage_messages ───────────

export async function getConversations() {
  const data = await get(`/${igUser()}/conversations`, {
    platform: 'instagram',
    fields: 'id,participants,unread_count,last_message',
  });
  return data.data || [];
}

export async function getConversation(conversationId) {
  const data = await get(`/${conversationId}`, {
    fields: 'id,messages{id,message,from,created_at},participants',
  });
  return data;
}

export async function sendMessage(conversationId, message) {
  const data = await post(`/me/messages`, {
    recipient: { conversation_id: conversationId },
    message: { text: message },
  });
  if (data.error) throw new Error(`Kirim DM gagal: ${data.error.message}`);
  return data.message_id;
}

// ─── instagram_manage_contents ───────────

export async function archiveMedia(mediaId) {
  const data = await post(`/${mediaId}`, { is_archived: true });
  if (data.error) throw new Error(`Archive gagal: ${data.error.message}`);
  return data.success;
}

export async function deleteMedia(mediaId) {
  const res = await fetch(`${IG_API_BASE}/${mediaId}?access_token=${token()}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) throw new Error(`Delete gagal: ${data.error.message}`);
  return data.success;
}

// ─── instagram_manage_engagement ─────────

export async function likeMedia(mediaId) {
  return post(`/${mediaId}/likes`);
}

export async function unlikeMedia(mediaId) {
  return fetch(`${IG_API_BASE}/${mediaId}/likes?access_token=${token()}`, { method: 'DELETE' });
}

export async function getMediaLikes(mediaId) {
  const data = await get(`/${mediaId}/likes`, { fields: 'id,username' });
  return data.data || [];
}

// ─── pages_read_engagement / pages_show_list ───

export async function getPages() {
  const data = await get(`/me/accounts`, { fields: 'id,name,username,followers_count,access_token' });
  return data.data || [];
}

export async function getPageInsights(pageId, metric = 'page_impressions,page_fans') {
  const data = await get(`/${pageId}/insights`, { metric, period: 'day' });
  return data.data || [];
}

// ─── ads_management / ads_read ──────────

export async function getAdAccounts() {
  const data = await get(`/me/adaccounts`, { fields: 'id,name,account_status,currency' });
  return data.data || [];
}

export async function getCampaigns(adAccountId) {
  const data = await get(`/act_${adAccountId}/campaigns`, {
    fields: 'id,name,status,objective,created_time',
  });
  return data.data || [];
}

export async function getAds(campaignId) {
  const data = await get(`/${campaignId}/ads`, {
    fields: 'id,name,status,adset{name},creative{id}',
  });
  return data.data || [];
}

// ─── Token helpers ─────────────────────

export async function debugToken(inputToken) {
  return get('/debug_token', { input_token: inputToken });
}

export async function exchangeToken(shortLivedToken, appId, appSecret) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${appId}` +
    `&client_secret=${appSecret}` +
    `&fb_exchange_token=${shortLivedToken}`
  );
  return res.json();
}
