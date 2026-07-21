import { PIPELINE_STATUS, agentProviders, config } from '../config.js';
import { startPipeline, resumePipeline, continueAfterScriptApproval, publishFinal } from '../engine/pipeline.js';
import { checkCutoff } from '../engine/fallback.js';
import { supabase, getActivePipelines, updatePipelineStatus, saveConversationMessage, getRecentConversation, getActiveLearnings } from '../db/supabase.js';
import { runScriptAgent } from './script.js';
import { runImageAgent } from './image.js';
import { runCaptionAgent } from './caption.js';
import { runAnalysisAgent } from './analysis.js';
import { runPublishAgent } from './publish.js';
import { callWithFailover, multimodalText } from '../llm/client.js';
import { escapeMarkdown } from '../utils/helpers.js';
import { compressForTelegram } from '../utils/image.js';
import { needsVisualRecheck } from '../utils/quickpost.js';
import * as templates from '../telegram/templates.js';
import {
  getComments, replyToComment, scoreCommentQuality,
  getConversations, sendMessage,
  getMedia, archiveMedia, deleteMedia,
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

  let pipelineStatus = 'Belum ada pipeline untuk hari ini';
  let todayPillar = '-';

  try {
    const { data: todayPipeline } = await supabase
      .from('content_pipeline')
      .select('*')
      .eq('calendar_date', dateStr)
      .limit(1)
      .maybeSingle();

    if (todayPipeline) {
      pipelineStatus = todayPipeline.status.replace(/_/g, ' ');
      todayPillar = todayPipeline.pillar_name;
    } else {
      const dayOfWeek = now.getDay();
      const { data: pillar } = await supabase
        .from('content_calendar')
        .select('pillar_name, needs_real_photo')
        .eq('day_of_week', dayOfWeek)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (pillar) todayPillar = pillar.pillar_name;
    }
  } catch {}

  const active = await getActivePipelines().catch(() => []);

  const cronSchedule = {
    '0 9 * * *': 'Setiap hari jam 9:00 WIT',
    '0 20 * * 0': 'Setiap Minggu jam 20:00 WIT (analisis mingguan)',
  };

  return {
    pipeline_status: pipelineStatus,
    today_pillar: todayPillar,
    pending_count: active.length,
    current_time: `${dayNames[now.getDay()]}, ${now.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })} ${now.toLocaleTimeString('id-ID')} WIT`,
    cron_schedule: cronSchedule[config.DAILY_PUBLISH_CRON] || `Cron: ${config.DAILY_PUBLISH_CRON}`,
  };
}

function parseActionFromResponse(text) {
  const match = text.match(/ACTION:\s*(\w+)/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

async function executeAction(ctx, action) {
  try {
    switch (action) {
      case 'run_pipeline':
        await handleStartPipeline(ctx);
        break;
      case 'show_status':
        await handleStatus(ctx);
        break;
      case 'show_schedule':
        await handleSchedule(ctx);
        break;
      case 'run_analysis':
        await handleAnalysis(ctx);
        break;
      case 'show_learnings': {
        const { getActiveLearnings } = await import('../db/supabase.js');
        const learnings = await getActiveLearnings();
        if (learnings.length === 0) {
          await ctx.reply('Belum ada learnings bro.');
        } else {
          const msg = learnings.slice(0, 5).map((l, i) =>
            `${i + 1}. ${l.insight_summary} (${l.confidence})`
          ).join('\n');
          await ctx.reply(`📚 Learnings:\n${msg}`);
        }
        break;
      }
      default:
        // skip unknown actions
        break;
    }
  } catch (err) {
    console.error(`[Leader] Action ${action} error:`, err.message);
  }
}

export async function handleConversation(ctx, messageText) {
  try {
    const chatId = String(ctx.chat?.id || 'default');
    const context = await gatherContext();

    // Simpan pesan user ke DB
    await saveConversationMessage(chatId, 'user', messageText, context);

    // Ambil history terakhir dari DB
    const history = await getRecentConversation(chatId, MAX_HISTORY);
    const contextSnapshot = { pipeline_status: context.pipeline_status, today_pillar: context.today_pillar, pending_count: context.pending_count, current_time: context.current_time, cron_schedule: context.cron_schedule };

    // Bangun system prompt
    const systemContent = leaderSystemPrompt
      .replace('{pipeline_status}', context.pipeline_status)
      .replace('{today_pillar}', context.today_pillar)
      .replace('{pending_count}', String(context.pending_count))
      .replace('{cron_schedule}', context.cron_schedule)
      .replace('{current_time}', context.current_time);

    // Kirim history ke LLM
    const messages = [
      { role: 'system', content: systemContent },
      ...history.map(m => ({
        role: m.role,
        content: m.role === 'user' ? `Owner: ${m.content}` : m.content,
      })),
    ];

    // Ambil learnings aktif buat konteks tambahan
    try {
      const learnings = await getActiveLearnings(context.today_pillar || undefined);
      if (learnings.length > 0) {
        const lrnText = learnings.slice(0, 5).map(l => `- ${l.insight_summary}`).join('\n');
        messages.push({ role: 'system', content: `Pelajaran dari pengalaman sebelumnya:\n${lrnText}` });
      }
    } catch {}

    const result = await callWithFailover(agentProviders.leader, messages, { temperature: 0.7, maxTokens: 1024 });

    const reply = result.content.replace(/ACTION:\s*\w+/gi, '').trim();
    const action = parseActionFromResponse(result.content);

    // Simpan balasan assistant ke DB
    await saveConversationMessage(chatId, 'assistant', reply, contextSnapshot);

    await ctx.reply(reply || 'Siap bro!');

    // Eksekusi action kalo ada
    if (action) {
      await executeAction(ctx, action);
    }
  } catch (err) {
    await ctx.reply(`Maaf bro, gue lagi error nih: ${err.message}. Coba ulang ya.`);
  }
}

export async function handleStartPipeline(ctx) {
  await ctx.reply('⏳ Memulai pipeline hari ini...');
  try {
    const result = await startPipeline();
    if (result.status === PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL) {
      await ctx.reply(templates.scriptApprovalTemplate(result.pipeline, result.scriptContent), { parse_mode: 'Markdown' });
    } else if (result.status === PIPELINE_STATUS.PUBLISHED || result.igPostId) {
      await ctx.reply(`ℹ️ Konten hari ini *udah dipublikasi* tadi.\n${result.permalink || ''}`, { parse_mode: 'Markdown' });
    } else if (result.status === PIPELINE_STATUS.FAILED) {
      await ctx.reply(`❌ Pipeline sebelumnya gagal, buat baru...`, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    await ctx.reply(`❌ Error: ${err.message}`);
  }
}

export async function handleStatus(ctx) {
  const pipelines = await getActivePipelines();
  if (pipelines.length === 0) {
    await ctx.reply('📭 Tidak ada pipeline aktif. Ketik /run untuk mulai.');
    return;
  }
  for (const p of pipelines) {
    await ctx.reply(templates.statusTemplate(p), { parse_mode: 'Markdown' });
  }
}

export async function handleSchedule(ctx) {
  const { data } = await supabase
    .from('content_calendar')
    .select('*')
    .eq('is_active', true)
    .order('day_of_week');
  await ctx.reply(templates.scheduleTemplate(data || []), { parse_mode: 'Markdown' });
}

export async function handlePause(ctx) {
  await ctx.reply('⏸️ Pipeline di-pause. Pipeline akan tetap di status terakhir sampai di-resume.');
}

export async function handleResume(ctx) {
  try {
    const pipelines = await getActivePipelines();
    const paused = pipelines.find(p =>
      [PIPELINE_STATUS.AWAITING_ASSET, PIPELINE_STATUS.AWAITING_FINAL_APPROVAL, PIPELINE_STATUS.APPROVED].includes(p.status)
    );

    if (!paused) {
      await ctx.reply('📭 Tidak ada pipeline yang perlu di-resume.');
      return;
    }

    const result = await resumePipeline(paused);

    if (result.status === PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL) {
      await ctx.reply(templates.scriptApprovalTemplate(result.pipeline, result.scriptContent), { parse_mode: 'Markdown' });
    } else if (result.status === PIPELINE_STATUS.AWAITING_ASSET) {
      await ctx.reply(templates.requestPhotoTemplate(result.pipeline), { parse_mode: 'Markdown' });
    } else if (result.status === PIPELINE_STATUS.AWAITING_FINAL_APPROVAL) {
      const caption = result.pipeline.caption_content || '';
      await ctx.reply(templates.finalApprovalTemplate(result.pipeline, caption), { parse_mode: 'Markdown' });
    } else if (result.permalink) {
      await ctx.reply(templates.publishConfirmationTemplate(result), { parse_mode: 'Markdown' });
    }
  } catch (err) {
    await ctx.reply(`❌ Resume error: ${err.message}`);
  }
}

export async function handleSkip(ctx, today) {
  if (today) {
    await updatePipelineStatus(today.id, PIPELINE_STATUS.FAILED, { error_log: 'Skipped by Gaulan' });
    await ctx.reply('⏭️ Konten hari ini di-skip.');
  } else {
    await ctx.reply('📭 Tidak ada konten hari ini untuk di-skip.');
  }
}

export async function handleFallback(ctx, today) {
  if (!today) {
    await ctx.reply('📭 Tidak ada pipeline aktif.');
    return;
  }
  if (today.status !== PIPELINE_STATUS.AWAITING_ASSET) {
    await ctx.reply(`Pipeline saat ini status *${today.status}* — gak perlu fallback.`, { parse_mode: 'Markdown' });
    return;
  }
  await ctx.reply('⏳ Beralih ke AI pillar...');
  try {
    today.recheckCount = 999;
    const result = await checkCutoff(today, 999);
    if (result.switched) {
      await ctx.reply(`✅ Beralih ke: *${result.newPillar}*. Pipeline akan mulai ulang.`, { parse_mode: 'Markdown' });
      const newResult = await startPipeline(new Date(today.calendar_date));
      if (newResult.status === PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL) {
        await ctx.reply(templates.scriptApprovalTemplate(newResult.pipeline, newResult.scriptContent), { parse_mode: 'Markdown' });
      }
    } else {
      await ctx.reply('Gagal fallback: tidak ada pilar cadangan.');
    }
  } catch (err) {
    await ctx.reply(`❌ Fallback error: ${err.message}`);
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

export async function handleApprove(ctx, today) {
  if (today.status === PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL) {
    await updatePipelineStatus(today.id, PIPELINE_STATUS.SCRIPT_APPROVED);
    await ctx.reply('✅ Naskah disetujui! Memproduksi asset...');

    try {
      const pipelineData = await supabase.from('content_pipeline').select('*').eq('id', today.id).single().then(r => r.data);
      const result = await continueAfterScriptApproval(pipelineData);

      if (result.status === PIPELINE_STATUS.AWAITING_ASSET) {
        await ctx.reply(templates.requestPhotoTemplate(result.pipeline), { parse_mode: 'Markdown' });
      } else if (result.status === PIPELINE_STATUS.AWAITING_FINAL_APPROVAL) {
        const caption = result.pipeline.caption_content || '';
        if (result.imageResult?.filepath) {
          try {
            const { buffer } = await compressForTelegram(result.imageResult.filepath);
            await ctx.replyWithPhoto({ source: buffer, filename: path.basename(result.imageResult.filepath) });
          } catch (e) {
            console.warn('[Pipeline] Gagal kirim preview foto:', e.message);
          }
        }
        await ctx.reply(templates.finalApprovalTemplate(result.pipeline, caption), { parse_mode: 'Markdown' });
      }
    } catch (err) {
      await ctx.reply(templates.errorTemplate(err.message), { parse_mode: 'Markdown' });
    }
  } else if ([PIPELINE_STATUS.AWAITING_FINAL_APPROVAL, PIPELINE_STATUS.APPROVED].includes(today.status)) {
    await updatePipelineStatus(today.id, PIPELINE_STATUS.APPROVED);
    await ctx.reply('✅ Final disetujui! Mempublikasikan...');

    try {
      const result = await publishFinal(today);
      // Auto-save learning dari pipeline success
      saveLearningAutomatically(result.permalink, today.caption_content, today.hashtags || [], {
        source: 'pipeline', pillar: today.pillar_name, pipeline_id: today.id,
      });
      await ctx.reply(templates.publishConfirmationTemplate(result), { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply(templates.errorTemplate(err.message), { parse_mode: 'Markdown' });
    }
  } else {
    await ctx.reply(`Status pipeline saat ini: ${today.status}. Tidak perlu approval sekarang.`);
  }
}

export async function handleRevise(ctx, today, note) {
  if (today.status === PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL) {
    const notes = [...(today.revision_notes || []), { gate: 1, note, timestamp: new Date().toISOString() }];
    await updatePipelineStatus(today.id, PIPELINE_STATUS.SCRIPT_DRAFTED, {
      revision_notes: notes,
      revision_count_gate1: (today.revision_count_gate1 || 0) + 1,
    });
    await ctx.reply(`🔄 Naskah direvisi. Memproses ulang dengan catatan: "${note}"`);

    const freshPipeline = await supabase.from('content_pipeline').select('*').eq('id', today.id).single().then(r => r.data);
    const scriptContent = await runScriptAgent(freshPipeline);
    await updatePipelineStatus(today.id, PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL);
    await ctx.reply(templates.scriptApprovalTemplate(freshPipeline, scriptContent), { parse_mode: 'Markdown' });

  } else if ([PIPELINE_STATUS.AWAITING_FINAL_APPROVAL, PIPELINE_STATUS.APPROVED].includes(today.status)) {
    const notes = [...(today.revision_notes || []), { gate: 2, note, timestamp: new Date().toISOString() }];
    await ctx.reply(`🔄 Preview direvisi. Memproses ulang dengan catatan: "${note}"`);

    const freshPipeline = await supabase.from('content_pipeline').select('*').eq('id', today.id).single().then(r => r.data);

    await updatePipelineStatus(today.id, PIPELINE_STATUS.GENERATING_ASSET, {
      revision_notes: notes,
      revision_count_gate2: (today.revision_count_gate2 || 0) + 1,
    });

    try {
      const [imageResult, captionResult] = await Promise.all([
        runImageAgent(freshPipeline),
        runCaptionAgent(freshPipeline, freshPipeline.script_content),
      ]);

      await updatePipelineStatus(today.id, PIPELINE_STATUS.AWAITING_FINAL_APPROVAL);

      if (imageResult.type === 'ai_generated' && imageResult.filepath) {
        try {
          const { buffer } = await compressForTelegram(imageResult.filepath);
          await ctx.replyWithPhoto({ source: buffer, filename: path.basename(imageResult.filepath) });
        } catch (e) {
          console.warn('[Pipeline] Gagal kirim revisi foto:', e.message);
        }
      }
      await ctx.reply(templates.finalApprovalTemplate(freshPipeline, freshPipeline.caption_content || ''), { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply(templates.errorTemplate(err.message), { parse_mode: 'Markdown' });
    }
  } else {
    await ctx.reply(`Revisi hanya bisa dilakukan saat menunggu approval. Status sekarang: ${today.status}`);
  }
}

export async function handlePhoto(ctx, photo, awaitingPhoto) {
  const file = await ctx.api.getFile(photo.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const captionText = ctx.message.caption?.trim() || '';

  if (!awaitingPhoto) {
    if (captionText) {
      await ctx.reply('⏳ Menganalisis gambar dengan AI...');
      try {
        const result = await callWithFailover(agentProviders.vision, [
          {
            role: 'system',
            content: `Kamu adalah asisten AI untuk Tulehu Inkline. Analisis gambar yang dikirim dan jawab pertanyaan pengguna. Jawab dalam bahasa Indonesia yang santai dan helpful.\n\nBRAND CONTEXT:\n${brandContext}`,
          },
          {
            role: 'user',
            content: multimodalText(captionText, fileUrl),
          },
        ], { temperature: 0.7, maxTokens: 1024 });
        await ctx.reply(`💬 *Analisis Gambar:*\n\n${escapeMarkdown(result.content)}`, { parse_mode: 'Markdown' });
      } catch (err) {
        await ctx.reply(`❌ Gagal menganalisis gambar: ${err.message}`);
      }
    } else {
      await ctx.reply('Foto diterima! Kirim dengan teks pertanyaan biar saya analisis pakai AI.');
    }
    return;
  }

  await updatePipelineStatus(awaitingPhoto.id, PIPELINE_STATUS.GENERATING_ASSET, {
    asset_url: fileUrl,
    asset_type: 'real_photo',
  });

  await ctx.reply('📸 Foto diterima! Melanjutkan pipeline...');

  try {
    const freshPipeline = await supabase.from('content_pipeline').select('*').eq('id', awaitingPhoto.id).single().then(r => r.data);
    const captionResult = await runCaptionAgent(freshPipeline, freshPipeline.script_content);

    await updatePipelineStatus(freshPipeline.id, PIPELINE_STATUS.AWAITING_FINAL_APPROVAL);

    await ctx.replyWithPhoto(photo.file_id);
    await ctx.reply(
      templates.finalApprovalTemplate(freshPipeline, freshPipeline.caption_content || ''),
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.reply(`❌ Error: ${err.message}`);
  }
}

// ─── instagram_manage_comments ───────────

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

// ─── instagram_manage_messages ──────────

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

// ─── instagram_manage_contents ──────────

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

// ─── pages_show_list ─────────────────

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

// ─── ads_read / ads_management ───────

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

// ─── Learning helper ────────────────────

async function saveLearningAutomatically(permalink, caption, hashtags, extra = {}) {
  try {
    const insight = `[Auto] ${extra.hook ? `Hook: "${extra.hook}". ` : ''}Diposting di ${permalink}`;
    const pillar = extra.pillar || null;

    await supabase.from('learnings').insert({
      insight_summary: insight.substring(0, 500),
      pillar_related: pillar,
      confidence: 'medium',
      based_on_post_count: 1,
      evidence_notes: JSON.stringify({
        permalink,
        caption_length: caption?.length || 0,
        hashtags: hashtags || [],
        ...extra,
        saved_at: new Date().toISOString(),
      }),
      status: 'active',
    });
  } catch (err) {
    console.error('[Leader] Gagal auto-save learning:', err.message);
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

  let fileUrlForPublish; // URL asli buat Instagram

  if (photo && photo.file_id) {
    const file = await ctx.api.getFile(photo.file_id);
    const directUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    fileUrlForPublish = directUrl;
    // Download langsung jadi base64 biar expired-proof buat dikirim ke Gemini
    const imgRes = await fetch(directUrl);
    if (imgRes.ok && (imgRes.headers.get('content-type') || '').startsWith('image/')) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get('content-type');
      fileUrl = `data:${mime};base64,${buf.toString('base64')}`;
    } else {
      fileUrl = directUrl; // fallback ke URL kalo gagal download
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
    saveLearningAutomatically(permalink, draft.content.caption, draft.content.hashtags, {
      source: 'quick_post', hook: draft.content.hook, cta: draft.content.cta,
    });

    if (draft?.photoFileId) {
      try { await ctx.replyWithPhoto(draft.photoFileId); } catch {}
    }
    await ctx.reply(`✅ Diposting!\n🔗 ${permalink}`);
  } catch (err) {
    await ctx.reply(`❌ Gagal posting: ${err.message}`);
  }
}
