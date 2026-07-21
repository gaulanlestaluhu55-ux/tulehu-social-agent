import { Bot } from 'grammy';
import { config, PIPELINE_STATUS } from '../config.js';
import { parseReply } from '../utils/parser.js';
import { logger } from '../utils/logger.js';
import { getActivePipelines } from '../db/supabase.js';
import {
  handleStartPipeline,
  handleStatus,
  handleSchedule,
  handlePause,
  handleResume,
  handleSkip,
  handleFallback,
  handleAnalysis,
  handleApprove,
  handleRevise,
  handlePhoto,
  handleComments,
  handleReplyComment,
  handleInbox,
  handleSendDm,
  handleArchivePost,
  handleDeletePost,
  handlePages,
  handleAds,
  handleConversation,
  handleQuickPost,
  handleQuickPostPublish,
  updateQuickPostCaption,
  recheckQuickPostVisual,
  handleFeedback,
  hasQuickPostDraft,
} from '../agents/leader.js';

/**
 * Bot Telegram — meneruskan perintah ke Leader Agent.
 */
export function createBot() {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  const ownerId = `${config.TELEGRAM_OWNER_CHAT_ID}`;

  bot.use(async (ctx, next) => {
    const userId = `${ctx.from?.id}`;
    if (userId !== ownerId) {
      await ctx.reply('Maaf, bot ini hanya untuk owner.');
      return;
    }
    await next();
  });

  // Keyboard tetap di bawah (samaping type)
  const stickey = {
    reply_markup: {
      keyboard: [
        ['🚀 Run', '📊 Status', '📅 Jadwal'],
        ['📈 Analysis', '💬 Komentar', '📨 Inbox'],
        ['📚 Learnings', '📸 Quick Post'],
      ],
      resize_keyboard: true,
      persistent: true,
    },
  };

  const mainMenu = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🚀 Run Pipeline', callback_data: 'run' },
          { text: '📊 Status', callback_data: 'status' },
        ],
        [
          { text: '📅 Jadwal', callback_data: 'jadwal' },
          { text: '📈 Analysis', callback_data: 'analysis' },
        ],
        [
          { text: '💬 Komentar', callback_data: 'comments' },
          { text: '📨 Inbox', callback_data: 'inbox' },
        ],
        [
          { text: '📚 Learnings', callback_data: 'learnings' },
          { text: '📸 Quick Post', callback_data: 'quickpost' },
        ],
      ],
    },
  };

  bot.command('start', async (ctx) => {
    await ctx.reply('🚀 *COMMANDER — Social Media SWAT Team Tulehu Inkline*\n\n'
      + 'Gue leader tim konten lo. Bisa ngobrol langsung atau pake tombol di bawah 👇',
      { parse_mode: 'Markdown', ...stickey, ...mainMenu });
  });

  // Tombol command di samping type (ketik /)
  bot.api.setMyCommands([
    { command: 'run', description: '🚀 Jalankan pipeline' },
    { command: 'status', description: '📊 Status pipeline' },
    { command: 'jadwal', description: '📅 Jadwal konten' },
    { command: 'analysis', description: '📈 Analisis mingguan' },
    { command: 'comments', description: '💬 Lihat komentar' },
    { command: 'inbox', description: '📨 Baca DM' },
    { command: 'pages', description: '📄 Info halaman' },
    { command: 'ads', description: '📢 Data iklan' },
    { command: 'start', description: '🏠 Menu utama' },
  ]).catch(() => {});

  bot.command('run', handleStartPipeline);
  bot.command('status', handleStatus);
  bot.command('jadwal', handleSchedule);
  bot.command('pause', handlePause);
  bot.command('resume', handleResume);
  bot.command('analysis', handleAnalysis);
  bot.command('inbox', handleInbox);
  bot.command('pages', handlePages);
  bot.command('ads', handleAds);

  bot.command('seed', async (ctx) => {
    await ctx.reply('🌱 Mulai seed content_calendar...');
    try {
      const { supabase } = await import('../db/supabase.js');
      const pillars = [
        { day_of_week: 0, pillar_name: 'Fleksibel — rekomendasi Analysis agent', needs_real_photo: false, fallback_ai_pillar: null },
        { day_of_week: 1, pillar_name: 'Produk Highlight — showcase kaos custom', needs_real_photo: true, fallback_ai_pillar: 'Quote grafis inspirasi desain' },
        { day_of_week: 2, pillar_name: 'Tips/edukasi sablon — cara rawat kaos, beda DTF & sablon manual', needs_real_photo: false, fallback_ai_pillar: null },
        { day_of_week: 3, pillar_name: 'BTS Proses — behind the scenes produksi', needs_real_photo: true, fallback_ai_pillar: 'Konten AI visual storytelling' },
        { day_of_week: 4, pillar_name: 'Promo/Quote Grafis — inspirasi desain, promo musiman', needs_real_photo: false, fallback_ai_pillar: null },
        { day_of_week: 5, pillar_name: 'Testimoni Customer — review, unboxing, foto customer', needs_real_photo: true, fallback_ai_pillar: 'Testimoni tekstual + grafis pendukung' },
        { day_of_week: 6, pillar_name: 'Interaktif — Q&A, polling, challenge', needs_real_photo: false, fallback_ai_pillar: null },
      ];
      await supabase.from('content_calendar').delete().gte('day_of_week', 0);
      const { data, error } = await supabase.from('content_calendar').insert(pillars).select();
      if (error) throw error;
      await ctx.reply(`✅ Seed berhasil! ${data.length} pilar tersimpan.`);
    } catch (e) {
      await ctx.reply(`❌ Seed gagal: ${e.message}`);
    }
  });

  bot.command('dm', async (ctx) => {
    const parts = ctx.message.text.match(/^\/dm\s+(\S+)\s+(.+)/s);
    if (!parts) {
      await ctx.reply('Gunakan: /dm [conversation_id] [pesan]');
      return;
    }
    await handleSendDm(ctx, parts[1], parts[2]);
  });

  bot.command('comments', async (ctx) => {
    const args = ctx.message.text.split(/\s+/);
    if (args.length < 2) {
      await ctx.reply('Gunakan: /comments [post_id]');
      return;
    }
    await handleComments(ctx, args[1]);
  });

  bot.command('reply', async (ctx) => {
    const parts = ctx.message.text.match(/^\/reply\s+(\S+)\s+(.+)/s);
    if (!parts) {
      await ctx.reply('Gunakan: /reply [comment_id] [teks]');
      return;
    }
    await handleReplyComment(ctx, parts[1], parts[2]);
  });

  bot.command('archive', async (ctx) => {
    const args = ctx.message.text.split(/\s+/);
    if (args.length < 2) {
      await ctx.reply('Gunakan: /archive [post_id]');
      return;
    }
    await handleArchivePost(ctx, args[1]);
  });

  bot.command('delete', async (ctx) => {
    const args = ctx.message.text.split(/\s+/);
    if (args.length < 2) {
      await ctx.reply('Gunakan: /delete [post_id]');
      return;
    }
    await handleDeletePost(ctx, args[1]);
  });

  bot.command('skip', async (ctx) => {
    const pipelines = await getActivePipelines();
    const today = pipelines.find(p => p.calendar_date === new Date().toISOString().split('T')[0]);
    await handleSkip(ctx, today);
  });

  bot.command('feedback', async (ctx) => {
    const text = ctx.message.text;
    const firstSpace = text.indexOf(' ');
    if (firstSpace === -1 || text.length < firstSpace + 3) {
      await ctx.reply('Gunakan: /feedback [post_id/url] [pesan feedback]\nContoh: /feedback https://instagram.com/p/xxx ini bagus banget bro');
      return;
    }
    const rest = text.slice(firstSpace + 1).trim();
    const secondSpace = rest.indexOf(' ');
    if (secondSpace === -1) {
      await ctx.reply('Tolong kasih feedbacknya. Contoh: /feedback [post_id] keren banget');
      return;
    }
    const postId = rest.slice(0, secondSpace).trim();
    const msg = rest.slice(secondSpace + 1).trim();
    await handleFeedback(ctx, postId, msg);
  });

  bot.command('fallback', async (ctx) => {
    const pipelines = await getActivePipelines();
    const today = pipelines.find(p => p.calendar_date === new Date().toISOString().split('T')[0]);
    await handleFallback(ctx, today);
  });

  // ─── Callback: tombol inline ──────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    switch (data) {
      case 'run': await handleStartPipeline(ctx); break;
      case 'status': await handleStatus(ctx); break;
      case 'jadwal': await handleSchedule(ctx); break;
      case 'analysis': await handleAnalysis(ctx); break;
      case 'comments': await handleComments(ctx); break;
      case 'inbox': await handleInbox(ctx); break;
      case 'learnings': {
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
      case 'quickpost':
        await ctx.reply('📸 Kirim foto produk lo, gue bikin caption + hashtag siap posting.');
        break;
      default: break;
    }
  });

  // ─── Message handlers ──────

  // Route tombol keyboard tetap
  const keyboardActions = {
    '🚀 Run': () => handleStartPipeline(ctx),
    '📊 Status': () => handleStatus(ctx),
    '📅 Jadwal': () => handleSchedule(ctx),
    '📈 Analysis': () => handleAnalysis(ctx),
    '💬 Komentar': () => handleComments(ctx),
    '📨 Inbox': () => handleInbox(ctx),
    '📚 Learnings': async () => {
      const { getActiveLearnings } = await import('../db/supabase.js');
      const learnings = await getActiveLearnings();
      if (learnings.length === 0) return ctx.reply('Belum ada learnings bro.');
      const msg = learnings.slice(0, 5).map((l, i) =>
        `${i + 1}. ${l.insight_summary} (${l.confidence})`
      ).join('\n');
      await ctx.reply(`📚 Learnings:\n${msg}`);
    },
    '📸 Quick Post': () => ctx.reply('📸 Kirim foto produk lo, gue bikin caption + hashtag siap posting.'),
  };

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const parsed = parseReply(text);

    // Fast path: tombol keyboard tetap
    if (keyboardActions[text]) {
      await keyboardActions[text]();
      return;
    }

    const pipelines = await getActivePipelines();
    const today = pipelines.find(p => p.calendar_date === new Date().toISOString().split('T')[0]);

    // Quick post approve/revise (gak butuh pipeline)
    if (hasQuickPostDraft()) {
      if (text.toLowerCase().trim() === 'cek ulang visual') {
        await recheckQuickPostVisual(ctx);
        return;
      }
      switch (parsed.action) {
        case 'approve':
          await handleQuickPostPublish(ctx);
          return;
        case 'revise':
          // Update draft caption, then re-preview
          if (parsed.note) {
            await updateQuickPostCaption(ctx, parsed.note);
          } else {
            await ctx.reply('Mau revisi bagian apa? Kirim "revisi: caption baru lo"');
          }
          return;
      }
    }

    // Fast path: keyword matching untuk approval gate pipeline
    if (today) {
      switch (parsed.action) {
        case 'approve':
          await handleApprove(ctx, today);
          return;
        case 'revise':
          await handleRevise(ctx, today, parsed.note);
          return;
        case 'status':
          await ctx.reply((await import('./templates.js')).statusTemplate(today), { parse_mode: 'Markdown' });
          return;
        case 'skip':
          await handleSkip(ctx, today);
          return;
      }
    }

    // LLM path: conversational understanding
    await handleConversation(ctx, text);
  });

  bot.on('message:photo', async (ctx) => {
    const photo = ctx.message.photo.pop();
    const captionText = ctx.message.caption?.trim() || '';

    // Cek dulu apakah ada pipeline yang butuh foto
    const pipelines = await getActivePipelines();
    const awaitingPhoto = pipelines.find(p => p.status === PIPELINE_STATUS.AWAITING_ASSET);

    if (awaitingPhoto) {
      await handlePhoto(ctx, photo, awaitingPhoto);
    } else {
      // Quick post: foto → LLM → caption → siap posting
      await handleQuickPost(ctx, photo, captionText);
    }
  });

  return bot;
}
