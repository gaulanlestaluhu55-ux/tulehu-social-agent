import cron from 'node-cron';
import { supabase } from '../db/supabase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Publisher cron — polls publish_queue and publishes due items.
 * Runs every PUBLISH_POLL_INTERVAL_MINUTES (default 5).
 */
export function startPublisherCron(bot) {
  const interval = config.PUBLISH_POLL_INTERVAL_MINUTES || 5;
  const cronExpr = `*/${interval} * * * *`;

  logger.info(`[Publisher Cron] Starting: ${cronExpr} (Asia/Jayapura)`);

  cron.schedule(cronExpr, async () => {
    try {
      const { data: due, error } = await supabase
        .from('publish_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString())
        .limit(5);

      if (error) {
        logger.error(`[Publisher Cron] Query error: ${error.message}`);
        return;
      }

      if (!due || due.length === 0) return;

      logger.info(`[Publisher Cron] Processing ${due.length} items`);

      for (const item of due) {
        try {
          // Mark as publishing
          await supabase
            .from('publish_queue')
            .update({ status: 'uploading', started_at: new Date().toISOString() })
            .eq('id', item.id);

          // Import and call publish function
          const { publishToInstagram } = await import('../platforms/instagram.js');
          const result = await publishToInstagram({
            imageUrl: item.asset_url,
            imageUrls: Array.isArray(item.asset_urls) ? item.asset_urls : null,
            caption: item.caption_content,
            hashtags: item.hashtags,
          });

          // Mark as published
          await supabase
            .from('publish_queue')
            .update({
              status: 'published',
              platform_post_id: result.id,
              platform_permalink: result.permalink,
              completed_at: new Date().toISOString(),
            })
            .eq('id', item.id);

          // Update pipeline status
          if (item.pipeline_id) {
            await supabase
              .from('content_pipeline')
              .update({ status: 'published' })
              .eq('id', item.pipeline_id);
          }

          // Notify Telegram
          if (bot && config.TELEGRAM_OWNER_CHAT_ID) {
            await bot.api.sendMessage(
              config.TELEGRAM_OWNER_CHAT_ID,
              `✅ Published: ${result.permalink || item.id}`
            );
          }

          logger.info(`[Publisher Cron] Published: ${item.id}`);
        } catch (err) {
          logger.error(`[Publisher Cron] Failed: ${item.id}: ${err.message}`);

          // Mark as failed or retry
          const newRetryCount = (item.retry_count || 0) + 1;
          if (newRetryCount >= (item.max_retries || 3)) {
            await supabase
              .from('publish_queue')
              .update({
                status: 'failed',
                error_message: err.message,
                retry_count: newRetryCount,
                last_error_at: new Date().toISOString(),
              })
              .eq('id', item.id);

            // Notify failure
            if (bot && config.TELEGRAM_OWNER_CHAT_ID) {
              await bot.api.sendMessage(
                config.TELEGRAM_OWNER_CHAT_ID,
                `❌ Publish gagal (${item.id}): ${err.message}`
              );
            }
          } else {
            await supabase
              .from('publish_queue')
              .update({
                status: 'retry',
                error_message: err.message,
                retry_count: newRetryCount,
                last_error_at: new Date().toISOString(),
              })
              .eq('id', item.id);
          }
        }
      }
    } catch (err) {
      logger.error(`[Publisher Cron] Unexpected error: ${err.message}`);
    }
  }, { timezone: 'Asia/Jayapura' });
}

/**
 * Instagram token expiry checker — runs daily at noon.
 */
export function startTokenCheckCron(bot) {
  cron.schedule('0 12 * * *', async () => {
    try {
      const { config } = await import('../config.js');
      const tokenExpiry = process.env.IG_TOKEN_EXPIRY;
      if (!tokenExpiry) return;

      const expiryDate = new Date(tokenExpiry);
      const now = new Date();
      const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

      if (daysLeft <= 0) {
        await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID, '⚠️ Instagram token sudah EXPIRED! Segera perbarui.');
      } else if (daysLeft <= 7) {
        await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID, `⚠️ Instagram token expires dalam ${daysLeft} hari (${expiryDate.toISOString().split('T')[0]})`);
      }
    } catch (err) {
      logger.error(`[Token Check] Error: ${err.message}`);
    }
  }, { timezone: 'Asia/Jayapura' });
}
