import { updatePipelineStatus, getPipelineById, getPipelineByDate, getTodayPillar } from '../db/supabase.js';
import { runIdeaAgent } from '../agents/idea.js';
import { runScriptAgent } from '../agents/script.js';
import { runImageAgent } from '../agents/image.js';
import { runCaptionAgent } from '../agents/caption.js';
import { runPublishAgent } from '../agents/publish.js';
import { withRetry } from './retry.js';
import { checkCutoff } from './fallback.js';
import { config, PIPELINE_STATUS } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Pipeline state machine — mengelola produksi 1 konten dari awal sampai publish.
 * Support pause-resume: setiap langkah update status di Supabase.
 */
export async function startPipeline(date = new Date()) {
  logger.info(`[Pipeline] Memulai pipeline untuk ${date.toISOString().split('T')[0]}...`);

  const existing = await getPipelineByDate(date);
  if (existing && existing.status === PIPELINE_STATUS.PUBLISHED) {
    logger.info('[Pipeline] Konten hari ini sudah dipublish, skip');
    return existing;
  }

  if (existing && existing.status !== PIPELINE_STATUS.PUBLISHED) {
    if ([PIPELINE_STATUS.PUBLISHING, PIPELINE_STATUS.FAILED].includes(existing.status)) {
      logger.info(`[Pipeline] Pipeline sebelumnya ${existing.status}, buat baru`);
      await updatePipelineStatus(existing.id, PIPELINE_STATUS.FAILED, { error_log: `Pipeline ${existing.status}, direset` });
    } else {
      logger.info(`[Pipeline] Melanjutkan pipeline yang tertunda (status: ${existing.status})`);
      return resumePipeline(existing);
    }
  }

  // Pipeline baru
  try {
    const pillar = await getTodayPillar(date);
    logger.info(`[Pipeline] Pilar hari ini: ${pillar.pillar_name}`);

    const pipeline = await runIdeaAgent(pillar, date.toISOString().split('T')[0]);

    const scriptContent = await runScriptAgent(pipeline);
    await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL);

    logger.info('[Pipeline] Menunggu approval naskah (Gate 1)');
    return { pipeline, status: PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL, scriptContent };

  } catch (err) {
    logger.error(`[Pipeline] Gagal: ${err.message}`);
    throw err;
  }
}

/**
 * Resume pipeline dari status terakhir.
 */
export async function resumePipeline(pipeline) {
  logger.info(`[Pipeline] Resume pipeline ${pipeline.id} dari status ${pipeline.status}`);

  switch (pipeline.status) {
    case PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL:
      return { pipeline, status: PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL, scriptContent: pipeline.script_content };

    case PIPELINE_STATUS.SCRIPT_APPROVED:
      return continueAfterScriptApproval(pipeline);

    case PIPELINE_STATUS.AWAITING_ASSET: {
      const cutoff = await checkCutoff(pipeline);
      if (cutoff.switched) {
        logger.info('[Pipeline] Cutoff trigger, restart pipeline dengan fallback pillar');
        return startPipeline(new Date(pipeline.calendar_date));
      }
      return { pipeline, status: PIPELINE_STATUS.AWAITING_ASSET };
    }

    case PIPELINE_STATUS.GENERATING_ASSET:
    case PIPELINE_STATUS.AWAITING_FINAL_APPROVAL:
      return { pipeline, status: PIPELINE_STATUS.AWAITING_FINAL_APPROVAL, scriptContent: pipeline.script_content };

    case PIPELINE_STATUS.APPROVED:
      return publishFinal(pipeline);

    default:
      if (pipeline.status === PIPELINE_STATUS.FAILED) {
        logger.info(`[Pipeline] Pipeline sudah failed, buat baru`);
        return startPipeline(new Date(pipeline.calendar_date));
      }
      logger.info(`[Pipeline] Status ${pipeline.status} tidak bisa di-resume, tandai failed`);
      await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.FAILED, { error_log: `Gak bisa resume dari status ${pipeline.status}` });
      throw new Error(`Pipeline ${pipeline.id} gagal: status ${pipeline.status} tidak bisa di-resume`);
  }
}

/**
 * Lanjut setelah script di-approve — generate asset (image/caption paralel)
 */
export async function continueAfterScriptApproval(pipeline) {
  logger.info('[Pipeline] Script approved. Memulai produksi asset...');

  await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.GENERATING_ASSET);

  try {
    const [imageResult, captionResult] = await Promise.all([
      runImageAgent(pipeline),
      runCaptionAgent(pipeline, pipeline.script_content),
    ]);

    if (imageResult.type === 'awaiting_real_photo') {
      await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.AWAITING_ASSET);
      logger.info('[Pipeline] Menunggu foto asli dari Gaulan');
      return { pipeline: await getPipelineById(pipeline.id), status: PIPELINE_STATUS.AWAITING_ASSET };
    }

    await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.AWAITING_FINAL_APPROVAL);
    logger.info('[Pipeline] Asset siap. Menunggu approval final (Gate 2)');

    return {
      pipeline: await getPipelineById(pipeline.id),
      status: PIPELINE_STATUS.AWAITING_FINAL_APPROVAL,
      imageResult,
      captionResult,
    };

  } catch (err) {
    logger.error(`[Pipeline] Gagal produksi asset: ${err.message}`);
    await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.FAILED, { error_log: err.message });
    throw err;
  }
}

/**
 * Publish konten setelah approval final.
 */
export async function publishFinal(pipeline) {
  await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.PUBLISHING);

  try {
    const result = await withRetry(async () => {
      return await runPublishAgent(pipeline);
    }, 'publish');
    logger.info(`[Pipeline] Konten berhasil dipublish: ${result.permalink}`);
    return result;
  } catch (err) {
    logger.error(`[Pipeline] Gagal publish: ${err.message}`);
    await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.FAILED, { error_log: err.message });
    throw err;
  }
}

// ─── Auto-mode helpers ───────────────────

export function getAutoMode(pillar) {
  if (!config.AUTO_MODE || config.AUTO_MODE === 'off') return 'manual';
  if (pillar.pillar_name && pillar.pillar_name.startsWith('Tips/edukasi')) return 'full_auto';
  if (!pillar.needs_real_photo) return 'semi_auto';
  return 'manual_fallback';
}

/**
 * Auto-approve script dan lanjut generate asset.
 * Kembalikan hasil akhir (pipeline + image + caption atau error).
 */
export async function autoContinuePipeline(pipeline) {
  logger.info(`[Auto] Auto-approve pipeline ${pipeline.id}`);

  if (pipeline.status === PIPELINE_STATUS.AWAITING_SCRIPT_APPROVAL) {
    await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.SCRIPT_APPROVED);
    const fresh = await getPipelineById(pipeline.id);
    return continueAfterScriptApproval(fresh);
  }

  if ([PIPELINE_STATUS.AWAITING_FINAL_APPROVAL, PIPELINE_STATUS.APPROVED].includes(pipeline.status)) {
    await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.APPROVED);
    return publishFinal(pipeline);
  }

  return resumePipeline(pipeline);
}

/**
 * Auto-publish: generate + publish tanpa approval gates.
 * Untuk full_auto mode (tips/edukasi).
 */
export async function autoPipelineToEnd(pipeline) {
  logger.info(`[Auto] Full auto pipeline ${pipeline.id} — skip semua gate`);

  // Auto-approve script
  await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.SCRIPT_APPROVED);
  const fresh = await getPipelineById(pipeline.id);

  // Generate asset (AI image + caption)
  const { runImageAgent } = await import('../agents/image.js');
  const { runCaptionAgent } = await import('../agents/caption.js');

  await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.GENERATING_ASSET);

  const [imageResult, captionResult] = await Promise.all([
    runImageAgent(fresh),
    runCaptionAgent(fresh, fresh.script_content),
  ]);

  // Kalo butuh real photo tapi di auto mode, fallback pake AI
  if (imageResult.type === 'awaiting_real_photo') {
    logger.info(`[Auto] Pipeline butuh foto asli, fallback ke AI pillar`);
    const { checkCutoff } = await import('./fallback.js');
    const cutoff = await checkCutoff(fresh);
    if (cutoff.switched) {
      const restarted = await startPipeline(new Date(fresh.calendar_date));
      return autoPipelineToEnd(restarted.pipeline || restarted);
    }
    throw new Error('Auto mode but tidak ada fallback pillar — skip hari ini');
  }

  // Langsung publish
  const freshPipeline = await getPipelineById(fresh.id);
  await updatePipelineStatus(fresh.id, PIPELINE_STATUS.AWAITING_FINAL_APPROVAL, {
    asset_url: imageResult.filepath || imageResult.url,
  });

  const published = await publishFinal(await getPipelineById(fresh.id));
  return published;
}

/**
 * Fallback pipeline: ganti pillar ke AI pillar kalo user gak ngasih foto.
 */
export async function fallbackPipeline(pipeline) {
  logger.info(`[Auto] Fallback pipeline ${pipeline.id} — ganti pillar`);
  const { checkCutoff } = await import('./fallback.js');
  const cutoff = await checkCutoff(pipeline);
  if (cutoff.switched) {
    return startPipeline(new Date(pipeline.calendar_date));
  }
  // Fallback langsung: buat pipeline baru dengan pillar AI
  await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.FAILED, { error_log: 'Auto fallback: user no response' });
  return startPipeline(new Date(pipeline.calendar_date));
}
