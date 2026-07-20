import 'dotenv/config';
import { logger } from './utils/logger.js';
import { createBot } from './telegram/bot.js';
import { startDailyScheduler } from './scheduler/daily.js';
import { startWeeklyScheduler } from './scheduler/weekly.js';
import { getActivePipelines } from './db/supabase.js';

logger.info('🚀 Tulehu Social Agent — Starting...');
logger.info(`📱 Telegram bot connecting...`);

const bot = createBot();

// Start schedulers
startDailyScheduler(bot);
startWeeklyScheduler(bot);

// Start bot
bot.start({
  onStart: async (botInfo) => {
    logger.info(`✅ Bot aktif: @${botInfo.username}`);

    // Cek pipeline tertunda saat startup
    try {
      const pending = await getActivePipelines();
      if (pending.length > 0) {
        logger.info(`📋 ${pending.length} pipeline tertunda ditemukan`);
        for (const p of pending) {
          logger.info(`   - ${p.calendar_date}: ${p.pillar_name} (${p.status})`);
        }
      }
    } catch (err) {
      logger.warn(`Gagal cek pipeline tertunda: ${err.message}`);
    }
  },
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  bot.stop();
  process.exit(0);
});
