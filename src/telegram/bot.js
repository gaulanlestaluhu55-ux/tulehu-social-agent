import { Bot } from 'grammy';
import { config } from '../config.js';
import { parseReply } from '../utils/parser.js';
import { logger } from '../utils/logger.js';
import {
  handleStatus,
  handleSchedule,
  handleAnalysis,
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
 * Bot Telegram v2.0 — commands only, no approval gates.
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

  const stickey = {
    reply_markup: {
      keyboard: [
        ['📊 Status', '📅 Jadwal'],
        ['📈 Analysis', '💬 Komentar'],
        ['📸 Quick Post', '📨 Inbox'],
      ],
      resize_keyboard: true,
      persistent: true,
    },
  };

  const mainMenu = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📊 Status', callback_data: 'status' },
          { text: '📅 Jadwal', callback_data: 'jadwal' },
        ],
        [
          { text: '📈 Analysis', callback_data: 'analysis' },
          { text: '💬 Komentar', callback_data: 'comments' },
        ],
        [
          { text: '📨 Inbox', callback_data: 'inbox' },
          { text: '📸 Quick Post', callback_data: 'quickpost' },
        ],
      ],
    },
  };

  bot.command('start', async (ctx) => {
    await ctx.reply('🚀 *COMMANDER — Social Media SWAT Team Tulehu Inkline*\n\n'
      + 'Dashboard: buka /calendar di browser\n'
      + 'Quick Post: kirim foto produk langsung dari sini',
      { parse_mode: 'Markdown', ...stickey, ...mainMenu });
  });

  bot.api.setMyCommands([
    { command: 'status', description: '📊 Status publish queue' },
    { command: 'jadwal', description: '📅 Jadwal konten minggu ini' },
    { command: 'analysis', description: '📈 Analisis mingguan' },
    { command: 'comments', description: '💬 Lihat komentar' },
    { command: 'inbox', description: '📨 Baca DM' },
    { command: 'pages', description: '📄 Info halaman' },
    { command: 'ads', description: '📢 Data iklan' },
    { command: 'quickpost', description: '📸 Quick Post' },
    { command: 'start', description: '🏠 Menu utama' },
  ]).catch(() => {});

  bot.command('status', handleStatus);
  bot.command('jadwal', handleSchedule);
  bot.command('analysis', handleAnalysis);
  bot.command('inbox', handleInbox);
  bot.command('pages', handlePages);
  bot.command('ads', handleAds);
  bot.command('quickpost', async (ctx) => {
    await ctx.reply('📸 Kirim foto produk lo, gue bikin caption + hashtag siap posting.');
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

  bot.command('feedback', async (ctx) => {
    const text = ctx.message.text;
    const firstSpace = text.indexOf(' ');
    if (firstSpace === -1 || text.length < firstSpace + 3) {
      await ctx.reply('Gunakan: /feedback [post_id/url] [pesan feedback]');
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

  // Callback buttons
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    switch (data) {
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

  // Message handlers
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const parsed = parseReply(text);

    // Keyboard shortcuts
    const keyboardActions = {
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

    if (keyboardActions[text]) {
      await keyboardActions[text]();
      return;
    }

    // Quick post flow
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
          if (parsed.note) {
            await updateQuickPostCaption(ctx, parsed.note);
          } else {
            await ctx.reply('Mau revisi bagian apa? Kirim "revisi: caption baru lo"');
          }
          return;
      }
    }

    // LLM conversation
    await handleConversation(ctx, text);
  });

  bot.on('message:photo', async (ctx) => {
    const photo = ctx.message.photo.pop();
    const captionText = ctx.message.caption?.trim() || '';
    await handleQuickPost(ctx, photo, captionText);
  });

  return bot;
}
