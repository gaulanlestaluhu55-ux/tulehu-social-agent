import cron from 'node-cron';
import { config } from '../config.js';
import { runAnalysisAgent } from '../agents/analysis.js';
import { logger } from '../utils/logger.js';
import { escapeMarkdown } from '../utils/helpers.js';

/**
 * Weekly scheduler — trigger analysis agent setiap minggu.
 */
export function startWeeklyScheduler(bot) {
  const cronExpression = config.WEEKLY_ANALYSIS_CRON; // default: "0 20 * * 0" (Minggu 20:00)

  logger.info(`[Scheduler] Weekly analysis: ${cronExpression} (Minggu 20:00 WIT)`);

  cron.schedule(cronExpression, async () => {
    logger.info('[Scheduler] Memulai analysis mingguan...');

    try {
      const result = await runAnalysisAgent();
      
      const message = `📊 *Analysis Mingguan Selesai*\n` +
        `📝 ${result.newInsights} insight baru\n` +
        `📱 ${result.analyzedPosts} postingan dianalisis\n\n` +
        `Sistem akan menerapkan learning ini minggu depan.`;

      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID, message);
    } catch (err) {
      logger.error(`[Scheduler] Analysis error: ${err.message}`);
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `❌ *Analysis Error:* ${escapeMarkdown(err.message)}`
      );
    }
  }, {
    timezone: 'Asia/Jayapura',
  });
}
