import 'dotenv/config';
import { logger } from './utils/logger.js';
import { createBot } from './telegram/bot.js';
import { startPublisherCron, startTokenCheckCron } from './scheduler/publisher-cron.js';
import { startWeeklyScheduler } from './scheduler/weekly.js';

logger.info('🚀 Tulehu Social Agent — Starting...');
logger.info(`📱 Telegram bot connecting...`);

const bot = createBot();

// Start schedulers (v2.0 — simple publisher cron, no auto-pipeline)
startPublisherCron(bot);
startTokenCheckCron(bot);
startWeeklyScheduler(bot);

// Start bot
bot.start({
  onStart: async (botInfo) => {
    logger.info(`✅ Bot aktif: @${botInfo.username}`);
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
