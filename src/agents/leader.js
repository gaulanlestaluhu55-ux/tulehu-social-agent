import { agentProviders, config } from '../config.js';
import { supabase, saveConversationMessage, getRecentConversation, getActiveLearnings } from '../db/supabase.js';
import { runAnalysisAgent } from './analysis.js';
import { callWithFailover, multimodalText } from '../llm/client.js';
import { escapeMarkdown } from '../utils/helpers.js';
import { needsVisualRecheck } from '../utils/quickpost.js';
import {
  getComments, replyToComment, scoreCommentQuality,
  getConversations, sendMessage,
  archiveMedia, deleteMedia,
  getPages,
  getAdAccounts, getCampaigns,
} from '../platforms/instagram.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandContext = fs.readFileSync(path.join(__dirname, '../templates/brand-context.txt'), 'utf-8');
const leaderSystemPrompt = fs.readFileSync(path.join(__dirname, '../templates/prompts/leader.txt'), 'utf-8').replace(/\{brand_context\}/g, brandContext);
const quickpostBrandContext = `
BRAND CONTEXT — TULEHU INKLINE
- Tulehu Inkline = jasa sablon kaos custom di Tulehu, Maluku.
- Tone: santai, jelas, trusted, tidak lebay.
- CTA utama: ajak konsultasi/order via WA.
- Jangan mengarang harga, promo, stok, bahan, jumlah order, testimoni, atau data bisnis.
- Deskripsikan foto apa adanya. Fakta visual mengalahkan preferensi/brand context.
`;
const quickpostPrompt = fs.readFileSync(path.join(__dirname, '../templates/prompts/quickpost.txt'), 'utf-8').replace(/\{brand_context\}/g, quickpostBrandContext);

const MAX_HISTORY = 20;

async function gatherContext() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  let upcomingCount = 0;
  try {
    const { count } = await supabase
      .from('publish_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    upcomingCount = count || 0;
  } catch {}

  return {
    upcoming_count: upcomingCount,
    current_time: `${dayNames[now.getDay()]}, ${now.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })} ${now.toLocaleTimeString('id-ID')} WIT`,
  };
}

export async function handleConversation(ctx, messageText) {
  try {
    const chatId = String(ctx.chat?.id || 'default');
    const context = await gatherContext();

    await saveConversationMessage(chatId, 'user', messageText, context);
    const history = await getRecentConversation(chatId, MAX_HISTORY);

    const systemContent = leaderSystemPrompt
      .replace('{pipeline_status}', `Upcoming scheduled: ${context.upcoming_count}`)
      .replace('{today_pillar}', '-')
      .replace('{pending_count}', String(context.upcoming_count))
      .replace('{cron_schedule}', 'Publisher cron tiap 5 menit')
      .replace('{current_time}', context.current_time);

    const messages = [
      { role: 'system', content: systemContent },
      ...history.map(m => ({
        role: m.role,
        content: m.role === 'user' ? `Owner: ${m.content}` : m.content,
      })),
    ];

    try {
      const learnings = await getActiveLearnings();
      if (learnings.length > 0) {
        const lrnText = learnings.slice(0, 5).map(l => `- ${l.insight_summary}`).join('\n');
        messages.push({ role: 'system', content: `Pelajaran dari pengalaman sebelumnya:\n${lrnText}` });
      }
    } catch {}

    const result = await callWithFailover(agentProviders.leader, messages, { temperature: 0.7, maxTokens: 1024 });
    const reply = result.content.replace(/ACTION:\s*\w+/gi, '').trim();

    await saveConversationMessage(chatId, 'assistant', reply, context);
    await ctx.reply(reply || 'Siap bro!');
  } catch (err) {
    await ctx.reply(`Maaf bro, gue lagi error nih: ${err.message}. Coba ulang ya.`);
  }
}

export async function handleStatus(ctx) {
  try {
    const { data: queue, error } = await supabase
      .from('publish_queue')
      .select('*')
      .order('scheduled_at', { ascending: true })
      .limit(10);

    if (error) throw new Error(error.message);

    if (!queue || queue.length === 0) {
      await ctx.reply('📭 Tidak ada konten terjadwal.\n\nBuka dashboard untuk buat slot baru: /calendar');
      return;
    }

    let msg = '📊 *Publish Queue*\n\n';
    for (const item of queue) {
      const scheduled = item.scheduled_at
        ? new Date(item.scheduled_at).toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' })
        : '-';
      const statusEmoji = { pending: '⏳', uploading: '📤', published: '✅', failed: '❌', retry: '🔄' }[item.status] || '❓';
      msg += `${statusEmoji} *${item.platform}* — ${scheduled}\n`;
      if (item.platform_permalink) {
        msg += `   🔗 ${item.platform_permalink}\n`;
      }
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`❌ Gagal ambil status: ${err.message}`);
  }
}

export async function handleSchedule(ctx) {
  try {
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const from = now.toISOString().split('T')[0];
    const to = weekLater.toISOString().split('T')[0];

    const { data: slots, error } = await supabase
      .from('content_pipeline')
      .select('id, calendar_date, pillar_name, status')
      .gte('calendar_date', from)
      .lte('calendar_date', to)
      .order('calendar_date', { ascending: true });

    if (error) throw new Error(error.message);

    if (!slots || slots.length === 0) {
      await ctx.reply('📅 Tidak ada slot konten minggu ini.\n\nBuka dashboard untuk buat slot: /calendar');
      return;
    }

    let msg = '📅 *Jadwal Minggu Ini*\n\n';
    for (const s of slots) {
      const statusEmoji = { draft: '📝', idea_ready: '💡', script_ready: '✍️', visual_uploaded: '🖼️', caption_ready: '📝', scheduled: '📅', published: '✅', failed: '❌' }[s.status] || '❓';
      msg += `${statusEmoji} *${s.calendar_date}* — ${s.pillar_name} (${s.status})\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`❌ Gagal ambil jadwal: ${err.message}`);
  }
}

export async function handleAnalysis(ctx) {
  await ctx.reply('⏳ Menjalankan analysis mingguan... (mungkin butuh beberapa menit)');
  try {
    const result = await runAnalysisAgent();
    await ctx.reply(`✅ Analysis selesai! ${result.newInsights} insight baru dari ${result.analyzedPosts} postingan.`);
  } catch (err) {
    await ctx.reply(`❌ Analysis error: ${err.message}`);
  }
}

export async function handleComments(ctx, mediaId) {
  try {
    const comments = await getComments(mediaId, 20);
    if (!comments.length) {
      await ctx.reply('💬 Belum ada komentar di postingan ini.');
      return;
    }
    let msg = `💬 *Komentar — ${mediaId}*\n\n`;
    for (const c of comments.slice(0, 15)) {
      const score = scoreCommentQuality(c.text || '');
      const badge = ['⬜', '🟡', '🟢', '🔵'][score] || '⬜';
      msg += `${badge} *${c.username}:* ${escapeMarkdown(c.text?.substring(0, 100) || '')}\n`;
    }
    if (comments.length > 15) msg += `\n...dan ${comments.length - 15} komentar lainnya`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`❌ Gagal ambil komentar: ${err.message}`);
  }
}

export async function handleReplyComment(ctx, commentId, message) {
  try {
    const replyId = await replyToComment(commentId, message);
    await ctx.reply(`✅ Balasan terkirim! Reply ID: ${replyId}`);
  } catch (err) {
    await ctx.reply(`❌ Gagal balas komentar: ${err.message}`);
  }
}

export async function handleInbox(ctx) {
  try {
    const conversations = await getConversations();
    if (!conversations.length) {
      await ctx.reply('📭 Tidak ada percakapan.');
      return;
    }
    let msg = '📨 *Inbox Instagram*\n\n';
    for (const c of conversations.slice(0, 10)) {
      const lastMsg = c.last_message?.message || '(kosong)';
      msg += `🗣️ ${c.participants?.[0]?.username || 'Unknown'}: ${escapeMarkdown(lastMsg.substring(0, 60))}\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`❌ Gagal ambil inbox: ${err.message}`);
  }
}

export async function handleSendDm(ctx, conversationId, message) {
  try {
    const msgId = await sendMessage(conversationId, message);
    await ctx.reply(`✅ DM terkirim! Message ID: ${msgId}`);
  } catch (err) {
    await ctx.reply(`❌ Gagal kirim DM: ${err.message}`);
  }
}

export async function handleArchivePost(ctx, mediaId) {
  try {
    await archiveMedia(mediaId);
    await ctx.reply(`📦 Postingan ${mediaId} di-archive.`);
  } catch (err) {
    await ctx.reply(`❌ Gagal archive: ${err.message}`);
  }
}

export async function handleDeletePost(ctx, mediaId) {
  try {
    await deleteMedia(mediaId);
    await ctx.reply(`🗑️ Postingan ${mediaId} dihapus.`);
  } catch (err) {
    await ctx.reply(`❌ Gagal hapus: ${err.message}`);
  }
}

export async function handlePages(ctx) {
  try {
    const pages = await getPages();
    if (!pages.length) {
      await ctx.reply('📄 Tidak ada halaman Facebook yang terhubung.');
      return;
    }
    let msg = '📄 *Halaman Facebook*\n\n';
    for (const p of pages) {
      msg += `📌 *${escapeMarkdown(p.name)}*\n`;
      msg += `   ID: \`${p.id}\`\n`;
      if (p.followers_count) msg += `   Followers: ${p.followers_count}\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`❌ Gagal ambil halaman: ${err.message}`);
  }
}

export async function handleAds(ctx) {
  try {
    const accounts = await getAdAccounts();
    if (!accounts.length) {
      await ctx.reply('📊 Tidak ada akun iklan.');
      return;
    }
    let msg = '📊 *Akun Iklan*\n\n';
    for (const a of accounts) {
      msg += `📌 *${escapeMarkdown(a.name || 'Unnamed')}*\n`;
      msg += `   Status: ${['Inactive', 'Active', 'Disabled'][a.account_status] || a.account_status}\n`;
      const campaigns = await getCampaigns(a.id.replace('act_', ''));
      msg += `   Campaigns: ${campaigns.length}\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`❌ Gagal ambil data iklan: ${err.message}`);
  }
}

export async function handleFeedback(ctx, postIdOrUrl, message) {
  try {
    const insight = `[Feedback] ${message}`;
    await supabase.from('learnings').insert({
      insight_summary: insight.substring(0, 500),
      pillar_related: null,
      confidence: 'high',
      based_on_post_count: 1,
      evidence_notes: JSON.stringify({ post: postIdOrUrl || 'tidak disebutkan', feedback: message, by: 'owner', saved_at: new Date().toISOString() }),
      status: 'active',
    });
    await ctx.reply('✅ Makasih feedbacknya bro, gue catet biar makin pinter.');
  } catch (err) {
    await ctx.reply(`❌ Gagal simpen feedback: ${err.message}`);
  }
}

// ─── Quick Post — foto → analisis → caption → posting ────

let quickPostDraft = null;

function stripMarkdownArtifacts(text) {
  return String(text || '')
    .replace(/\\([#.!\-_*[\]()~`>+=|{}])/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
}

function parseQuickPostContent(raw) {
  const cleaned = stripMarkdownArtifacts(raw);
  const jsonText = (cleaned.match(/\{[\s\S]*\}/) || [cleaned])[0];
  const content = JSON.parse(jsonText);
  if (content.is_product_photo !== true) {
    throw new Error(content.reason || 'Foto bukan produk kaos yang layak diposting.');
  }
  const hashtags = [...new Set((content.hashtags || [])
    .map(h => String(h).replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, '').trim())
    .filter(Boolean))];
  for (const required of ['TulehuInkline', 'KaosCustom']) {
    if (!hashtags.some(h => h.toLowerCase() === required.toLowerCase())) hashtags.unshift(required);
  }
  const caption = stripMarkdownArtifacts(content.caption).slice(0, 220);
  const body = Array.isArray(content.body) ? content.body.map(stripMarkdownArtifacts).filter(Boolean).slice(0, 3) : [];
  if (!caption || !content.hook || body.length === 0) throw new Error('Output Quick Post tidak lengkap. Coba kirim ulang foto produk yang jelas.');
  const baseColor = stripMarkdownArtifacts(content.base_color || '').toLowerCase();
  const colorTag = baseColor.includes('hitam') ? 'KaosHitam' : baseColor.includes('putih') ? 'KaosPutih' : '';
  if (colorTag) {
    for (let i = hashtags.length - 1; i >= 0; i--) {
      if (/^Kaos(Putih|Hitam)$/i.test(hashtags[i]) && hashtags[i].toLowerCase() !== colorTag.toLowerCase()) hashtags.splice(i, 1);
    }
    if (!hashtags.some(h => h.toLowerCase() === colorTag.toLowerCase())) hashtags.push(colorTag);
  }
  const visibleText = stripMarkdownArtifacts(content.visible_text || '');
  const fixColor = text => {
    if (baseColor.includes('putih')) return text.replace(/kaos\s+hitam/gi, 'kaos putih');
    if (baseColor.includes('hitam')) return text.replace(/kaos\s+putih/gi, 'kaos hitam');
    return text;
  };
  const fixOcr = text => {
    if (!/x[-\s]?treme/i.test(visibleText)) return text.replace(/desain\s+X[-\s]?TREME/gi, 'desain tipografi').replace(/X[-\s]?TREME/gi, 'tipografi');
    return text;
  };
  const fixText = text => fixOcr(fixColor(text));
  return {
    ...content,
    base_color: stripMarkdownArtifacts(content.base_color || ''),
    print_color: stripMarkdownArtifacts(content.print_color || ''),
    visible_text: visibleText,
    hook: fixText(stripMarkdownArtifacts(content.hook)).slice(0, 120),
    body: body.map(fixText),
    cta: stripMarkdownArtifacts(content.cta || 'Chat WA buat order.'),
    caption: fixText(caption),
    hashtags: hashtags.slice(0, 15),
  };
}

function buildQuickPostCaption(content) {
  return `${content.caption}\n\n${content.hashtags.map(h => `#${h}`).join(' ')}`;
}

async function verifyQuickPostVisual(fileUrl) {
  const prompt = `
Kamu vision checker. Tugasmu cuma baca visual foto kaos, bukan bikin caption.
OUTPUT HANYA JSON VALID:
{"base_color":"warna kain kaos utama","print_color":"warna desain/sablon","visible_text":"teks besar yang terbaca jelas"}

RULE:
- base_color = warna kain kaos utama yang dipakai model, bukan warna tulisan/sablon, celana, background, shadow, atau highlight lampu.
- Abaikan warna desain/sablon saat menentukan base_color.
- Kalau kain kaos mayoritas hitam, jawab "hitam" walau tulisan/desain putih.
- Kalau kain kaos mayoritas putih, jawab "putih" walau tulisan/desain hitam.
- visible_text hanya teks besar yang benar-benar terbaca jelas. Kalau tidak yakin, kosongkan.
`;
  const result = await callWithFailover(agentProviders.vision, [
    { role: 'system', content: prompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Cek warna kain kaos utama, warna desain/sablon, dan teks besar yang terlihat.' },
        { type: 'image_url', image_url: { url: fileUrl } },
      ],
    },
  ], { temperature: 0, maxTokens: 512, responseFormat: { type: 'json_object' } });
  const jsonText = (stripMarkdownArtifacts(result.content).match(/\{[\s\S]*\}/) || [result.content])[0];
  return JSON.parse(jsonText);
}

function applyVisualCheck(content, visual) {
  const baseColor = stripMarkdownArtifacts(visual?.base_color || content.base_color || '');
  const printColor = stripMarkdownArtifacts(visual?.print_color || content.print_color || '');
  const visibleText = stripMarkdownArtifacts(visual?.visible_text || content.visible_text || '');
  const fromColor = content.base_color;
  content.base_color = baseColor;
  content.print_color = printColor;
  content.visible_text = visibleText;
  if (fromColor && baseColor && fromColor.toLowerCase() !== baseColor.toLowerCase()) {
    const oldColor = fromColor.toLowerCase();
    const newColor = baseColor.toLowerCase();
    const replaceColor = text => String(text || '')
      .replace(new RegExp(`kaos\\s+dasar\\s+${oldColor}`, 'gi'), `kaos dasar ${newColor}`)
      .replace(new RegExp(`kaos\\s+${oldColor}`, 'gi'), `kaos ${newColor}`);
    content.hook = replaceColor(content.hook);
    content.body = (content.body || []).map(replaceColor);
    content.caption = replaceColor(content.caption);
  }
  return parseQuickPostContent(JSON.stringify(content));
}

export function hasQuickPostDraft() {
  return quickPostDraft !== null;
}

export async function updateQuickPostCaption(ctx, caption) {
  if (!quickPostDraft) {
    await ctx.reply('Gak ada draft quick post. Kirim foto dulu bro.');
    return;
  }
  const cleanCaption = stripMarkdownArtifacts(caption);
  if (!cleanCaption) {
    await ctx.reply('Caption revisi kosong bro. Pakai: revisi: caption baru');
    return;
  }
  quickPostDraft.content.caption = cleanCaption;
  quickPostDraft.captionText = buildQuickPostCaption(quickPostDraft.content);
  await ctx.reply(`Caption diupdate.\n\n${quickPostDraft.captionText}\n\nBales "posting" buat publish.`);
}

export async function recheckQuickPostVisual(ctx) {
  if (!quickPostDraft) {
    await ctx.reply('Gak ada draft quick post. Kirim foto dulu bro.');
    return;
  }
  await ctx.reply('⏳ Cek ulang warna kaos + teks desain...');
  try {
    const visual = await verifyQuickPostVisual(quickPostDraft.fileUrl);
    const content = applyVisualCheck(quickPostDraft.content, visual);
    const captionText = buildQuickPostCaption(content);
    quickPostDraft = { ...quickPostDraft, content, captionText };
    const preview = `📸 Quick Post — Visual Recheck\n\n` +
      `Warna kaos:\n${content.base_color || '-'}\n\n` +
      `Warna desain/sablon:\n${content.print_color || '-'}\n\n` +
      `Teks terlihat:\n${content.visible_text || '-'}\n\n` +
      `Caption:\n${captionText}\n\n` +
      `Bales "posting" buat publish.`;
    await ctx.reply(preview);
  } catch (err) {
    await ctx.reply(`❌ Gagal cek ulang visual: ${err.message}`);
  }
}

export async function handleQuickPost(ctx, photo, userCaption = '') {
  let fileUrl;
  let photoFileId;
  let fileUrlForPublish;

  if (photo && photo.file_id) {
    const file = await ctx.api.getFile(photo.file_id);
    const directUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    fileUrlForPublish = directUrl;
    const imgRes = await fetch(directUrl);
    if (imgRes.ok && (imgRes.headers.get('content-type') || '').startsWith('image/')) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get('content-type');
      fileUrl = `data:${mime};base64,${buf.toString('base64')}`;
    } else {
      fileUrl = directUrl;
    }
    photoFileId = photo.file_id;
  } else if (quickPostDraft) {
    fileUrl = quickPostDraft.fileUrl;
    fileUrlForPublish = quickPostDraft.fileUrlForPublish || quickPostDraft.fileUrl;
    photoFileId = quickPostDraft.photoFileId;
  } else {
    await ctx.reply('Kirim fotonya dulu bro.');
    return;
  }

  await ctx.reply('⏳ Liat fotonya dulu bro, gue siapin konten...');

  try {
    const result = await callWithFailover(agentProviders.vision, [
      { role: 'system', content: 'KAMU WAJIB mendeskripsikan foto secara akurat. Jangan pernah mengubah warna, bahan, atau detail yang terlihat di foto. Ini prioritas utama.' },
      { role: 'system', content: quickpostPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userCaption || 'Deskripsikan foto ini secara akurat. Buat konten Instagram sesuai fotonya.' },
          { type: 'image_url', image_url: { url: fileUrl } },
        ],
      },
    ], { temperature: 0.2, maxTokens: 2048, responseFormat: { type: 'json_object' } });

    let content = parseQuickPostContent(result.content);
    if (process.env.QUICKPOST_VERIFY_VISUAL === 'true') try {
      const visual = await verifyQuickPostVisual(fileUrl);
      content = applyVisualCheck(content, visual);
    } catch (err) {
      console.warn('[QuickPost] Visual verification skipped:', err.message);
    }
    const captionText = buildQuickPostCaption(content);

    quickPostDraft = { fileUrl, fileUrlForPublish, photoFileId, content, captionText };
    const visualWarning = needsVisualRecheck(content)
      ? '⚠️ Warna/teks visual kurang yakin. Bales "cek ulang visual" sebelum posting.\n\n'
      : '';

    const preview = `📸 Quick Post — Preview\n\n` +
      visualWarning +
      `Hook:\n${content.hook}\n\n` +
      `Warna kaos:\n${content.base_color || '-'}\n\n` +
      `Warna desain/sablon:\n${content.print_color || '-'}\n\n` +
      `Teks terlihat:\n${content.visible_text || '-'}\n\n` +
      `Isi:\n${content.body.map((b, i) => `${i + 1}. ${b}`).join('\n')}\n\n` +
      `CTA:\n${content.cta}\n\n` +
      `Caption:\n${captionText}\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Bales "posting" buat langsung publish\n` +
      `Bales "revisi: ..." kalo mau diedit\n` +
      `Bales "cek ulang visual" kalo warna/teks desain salah`;

    await ctx.replyWithPhoto(photoFileId);
    await ctx.reply(preview);

  } catch (err) {
    await ctx.reply(`❌ Error analisis foto: ${err.message}`);
  }
}

export async function handleQuickPostPublish(ctx) {
  if (!quickPostDraft) {
    await ctx.reply('Gak ada draft quick post. Kirim foto dulu bro.');
    return;
  }

  const { fileUrlForPublish, captionText } = quickPostDraft;

  try {
    const { createMediaContainer, publishMediaContainer, getMedia } = await import('../platforms/instagram.js');
    const containerId = await createMediaContainer(fileUrlForPublish, captionText);
    await new Promise(r => setTimeout(r, 5000));
    const igPostId = await publishMediaContainer(containerId);

    let permalink = `https://instagram.com/p/${igPostId}/`;
    try {
      const media = await getMedia(igPostId);
      if (media.permalink) permalink = media.permalink;
    } catch {}

    const draft = quickPostDraft;
    quickPostDraft = null;

    // Auto-save learning
    try {
      await supabase.from('learnings').insert({
        insight_summary: `[Auto] Quick Post. Diposting di ${permalink}`.substring(0, 500),
        pillar_related: null,
        confidence: 'medium',
        based_on_post_count: 1,
        evidence_notes: JSON.stringify({
          permalink,
          source: 'quick_post',
          hook: draft.content.hook,
          cta: draft.content.cta,
          caption_length: draft.content.caption?.length || 0,
          hashtags: draft.content.hashtags || [],
          saved_at: new Date().toISOString(),
        }),
        status: 'active',
      });
    } catch (err) {
      console.error('[Leader] Gagal auto-save learning:', err.message);
    }

    if (draft?.photoFileId) {
      try { await ctx.replyWithPhoto(draft.photoFileId); } catch {}
    }
    await ctx.reply(`✅ Diposting!\n🔗 ${permalink}`);
  } catch (err) {
    await ctx.reply(`❌ Gagal posting: ${err.message}`);
  }
}
