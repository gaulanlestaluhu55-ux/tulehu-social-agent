import cron from 'node-cron';
import { config, PIPELINE_STATUS } from '../config.js';
import { startPipeline, resumePipeline, getAutoMode, autoContinuePipeline, autoPipelineToEnd, fallbackPipeline } from '../engine/pipeline.js';
import { checkCutoff } from '../engine/fallback.js';
import { supabase, updateProviderHealth, getTodayPillar } from '../db/supabase.js';
import { logger } from '../utils/logger.js';
import { escapeMarkdown } from '../utils/helpers.js';

/**
 * Daily scheduler — auto pipeline dengan 3 mode:
 * full_auto (edukasi → skip semua gate), semi_auto (timeout auto-approve), manual_fallback (fallback pillar).
 */
const TOKEN_WARN_DAYS = 7;
const TOKEN_URGENT_DAYS = 3;
const TOKEN_CRITICAL_DAYS = 1;

// Auto-confirm timeout (ms)
const AUTO_TIMEOUT = config.AUTO_CONFIRM_TIMEOUT_MINUTES * 60 * 1000;

// Track timeout handles biar gak dobel
const autoTimeouts = new Map();

async function checkInstagramToken(bot) {
  const token = config.IG_ACCESS_TOKEN;
  if (!token || token === 'your_long_lived_access_token') return;

  try {
    const url = `https://graph.facebook.com/v21.0/debug_token?input_token=${token}&access_token=${token}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.data?.is_valid) {
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        '🚨 Instagram Token EXPIRED! Pipeline gak bisa publish. Refresh token sekarang juga!'
      );
      await updateProviderHealth('instagram_api', { status: 'down', last_error: 'Token expired' });
      return;
    }

    const expiresAt = data.data.expires_at;
    if (!expiresAt || expiresAt === 0) return;

    const expiryDate = new Date(expiresAt * 1000);
    const now = new Date();
    const daysLeft = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));

    await updateProviderHealth('instagram_api', {
      status: daysLeft <= TOKEN_CRITICAL_DAYS ? 'degraded' : 'healthy',
      last_error: null,
    });

    if (daysLeft <= 0) {
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `🚨 *Instagram Token EXPIRED Today!*\nPipeline publish akan gagal. Refresh token segera!`
      );
    } else if (daysLeft <= TOKEN_CRITICAL_DAYS) {
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `⚠️ *Instagram Token expires besok!* (${daysLeft} hari lagi)\nRefresh token sekarang biar gak bermasalah.`
      );
    } else if (daysLeft <= TOKEN_URGENT_DAYS) {
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `⚠️ *Instagram Token expires ${daysLeft} hari lagi* — refresh ya bro.`
      );
    } else if (daysLeft <= TOKEN_WARN_DAYS) {
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `📅 *Instagram Token expires ${daysLeft} hari lagi* (${expiryDate.toLocaleDateString('id-ID')}). Masih aman, tapi catet tanggalnya.`
      );
    }
  } catch (err) {
    logger.warn(`[Scheduler] Gagal cek token: ${err.message}`);
  }
}

/**
 * Handle 1 hari pipeline — tentuin mode, jalanin, kasih tau owner.
 */
async function runDailyPipeline(bot, date) {
  const dateStr = date.toISOString().split('T')[0];
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  // Dapatkan pillar dulu
  const pillar = await getTodayPillar(date);
  const mode = getAutoMode(pillar);

  // Cek existing pipeline
  const { data: existing } = await supabase
    .from('content_pipeline')
    .select('*')
    .eq('calendar_date', dateStr)
    .maybeSingle();

  if (existing?.status === PIPELINE_STATUS.PUBLISHED) {
    logger.info('[Scheduler] Konten hari ini sudah dipublish');
    return;
  }

  logger.info(`[Scheduler] ${dayNames[date.getDay()]} — ${pillar.pillar_name} [mode: ${mode}]`);

  // ─── full_auto: edukasi → skip semua gate ───
  if (mode === 'full_auto') {
    let pipeline;
    if (existing) {
      pipeline = existing;
    } else {
      const result = await startPipeline(date);
      pipeline = result.pipeline || result;
    }
    await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
      `🤖 *Auto Pipeline — ${escapeMarkdown(pillar.pillar_name)}*\n\nKonten edukasi, gue proses langsung ya bro. Tenang aja.`
    );
    try {
      const published = await autoPipelineToEnd(pipeline);
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `✅ *Auto Published!*\n${published.permalink || 'Instagram'}\n\nTipe: ${escapeMarkdown(pillar.pillar_name)}`
      );
    } catch (err) {
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `❌ *Auto Pipeline Gagal:* ${escapeMarkdown(err.message)}`
      );
    }
    return;
  }

  // ─── semi_auto / manual_fallback: mulai pipeline, kirim approval ───
  let result;
  if (existing) {
    result = await resumePipeline(existing);
  } else {
    result = await startPipeline(date);
  }

  if (result.status === PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL) {
    const { scriptApprovalTemplate } = await import('../telegram/templates.js');
    await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
      `📋 *Pipeline ${escapeMarkdown(pillar.pillar_name)}*\n\n` +
      (mode === 'semi_auto'
        ? `Gue tunggu ${config.AUTO_CONFIRM_TIMEOUT_MINUTES} menit. Kalo gak lo approve, gue lanjut otomatis pake AI.\n\n`
        : `Lo perlu kirim foto asli. Kalo ${config.AUTO_CONFIRM_TIMEOUT_MINUTES} menit gak ada respon, gue ganti konten otomatis.\n\n`) +
      scriptApprovalTemplate(result.pipeline, result.scriptContent)
    );

    // Set timeout auto-approve
    const timeoutKey = `script_${result.pipeline.id}`;
    if (autoTimeouts.has(timeoutKey)) clearTimeout(autoTimeouts.get(timeoutKey));
    autoTimeouts.set(timeoutKey, setTimeout(async () => {
      autoTimeouts.delete(timeoutKey);
      await handleAutoTimeout(bot, result.pipeline, mode, pillar);
    }, AUTO_TIMEOUT));
  }
}

/**
 * Handle timeout — pipeline gak direspons owner.
 */
async function handleAutoTimeout(bot, pipeline, mode, pillar) {
  try {
    const fresh = await supabase.from('content_pipeline').select('*').eq('id', pipeline.id).single().then(r => r.data);
    if (!fresh || fresh.status === PIPELINE_STATUS.PUBLISHED || fresh.status === PIPELINE_STATUS.FAILED) return;

    if (mode === 'semi_auto') {
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `⏰ *Timeout — Auto lanjut*\nGak ada respon, gue lanjut pake AI buat konten hari ini.`
      );
      const published = await autoPipelineToEnd(fresh);
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `✅ *Auto Published!*\n${published.permalink || 'Instagram'}`
      );
    } else {
      // manual_fallback: fallback pillar
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `⏰ *Timeout — Fallback konten*\nGak ada respon + butuh foto asli. Gue ganti konten otomatis.`
      );
      const result = await fallbackPipeline(fresh);
      if (result && result.status === PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL) {
        const { scriptApprovalTemplate } = await import('../telegram/templates.js');
        await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
          `🔄 *Fallback: ${escapeMarkdown(result.pipeline?.pillar_name || 'Konten AI')}*\n\n${scriptApprovalTemplate(result.pipeline, result.scriptContent)}`
        );
        // Set timeout lagi buat fallback
        const timeoutKey = `fallback_${result.pipeline.id}`;
        autoTimeouts.set(timeoutKey, setTimeout(async () => {
          autoTimeouts.delete(timeoutKey);
          await handleAutoTimeout(bot, result.pipeline, 'semi_auto', pillar);
        }, AUTO_TIMEOUT));
      }
    }
  } catch (err) {
    logger.error(`[Scheduler] Auto timeout error: ${err.message}`);
    await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
      `❌ *Auto Pipeline Error:* ${escapeMarkdown(err.message)}`
    );
  }
}

export function startDailyScheduler(bot) {
  const cronExpression = config.DAILY_PUBLISH_CRON;

  logger.info(`[Scheduler] Daily pipeline: ${cronExpression} (Asia/Jayapura)`);

  // Cek token saat startup
  setTimeout(() => checkInstagramToken(bot), 3000);

  cron.schedule(cronExpression, async () => {
    logger.info('[Scheduler] Trigger pipeline harian...');
    try {
      await runDailyPipeline(bot, new Date());
    } catch (err) {
      logger.error(`[Scheduler] Pipeline error: ${err.message}`);
      await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
        `❌ *Pipeline Error:* ${escapeMarkdown(err.message)}`
      );
    }
  }, {
    timezone: 'Asia/Jayapura',
  });

  // Cek pipeline yg mungkin tertunda saat startup
  setTimeout(async () => {
    const { data: pending } = await supabase
      .from('content_pipeline')
      .select('*')
      .not('status', 'in', `("${PIPELINE_STATUS.PUBLISHED}","${PIPELINE_STATUS.FAILED}","${PIPELINE_STATUS.IDEA}")`)
      .limit(10);

    if (pending && pending.length > 0) {
      logger.info(`[Scheduler] ${pending.length} pipeline tertunda ditemukan saat startup`);
      for (const p of pending) {
        logger.info(`   - ${p.calendar_date}: ${p.pillar_name} (${p.status})`);
        // Tandai yang stuck di 'publishing' sebagai failed
        if (p.status === PIPELINE_STATUS.PUBLISHING) {
          await supabase.from('content_pipeline').update({
            status: PIPELINE_STATUS.FAILED,
            error_log: 'Stuck at publishing, direset saat startup',
            updated_at: new Date().toISOString(),
          }).eq('id', p.id);
          logger.info(`   => Pipeline ${p.id} direset ke FAILED`);
        }
      }
    }
  }, 5000);

  // Cek token tiap hari
  cron.schedule('0 12 * * *', () => checkInstagramToken(bot), { timezone: 'Asia/Jayapura' });

  // Periodic fallback check — cek cutoff tiap 30 menit
  const recheckMs = config.RECHECK_INTERVAL_MINUTES * 60 * 1000;
  setInterval(async () => {
    try {
      const { data: awaitingAssets } = await supabase
        .from('content_pipeline')
        .select('*')
        .eq('status', PIPELINE_STATUS.AWAITING_ASSET)
        .limit(5);

      if (!awaitingAssets || awaitingAssets.length === 0) return;

      for (const pipeline of awaitingAssets) {
        const cutoff = await checkCutoff(pipeline);
        if (cutoff.switched) {
          logger.info(`[Scheduler] Fallback triggered for pipeline ${pipeline.id}`);
          const result = await resumePipeline(pipeline);
          if (result.status === PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL) {
            const { scriptApprovalTemplate } = await import('../telegram/templates.js');
            await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
              `⏰ *Cutoff Trigger — Fallback ke AI Pillar*\n\n${scriptApprovalTemplate(result.pipeline, result.scriptContent)}`
            );
          }
        }
      }
    } catch (err) {
      logger.error(`[Scheduler] Fallback check error: ${err.message}`);
    }
  }, recheckMs);
}
