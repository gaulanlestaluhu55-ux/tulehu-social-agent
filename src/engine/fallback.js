import { supabase } from '../db/supabase.js';
import { config, PIPELINE_STATUS } from '../config.js';
import { logger } from '../utils/logger.js';

const CUTOFF_HOUR = config.CUTOFF_HOUR;
const RECHECK_INTERVAL = config.RECHECK_INTERVAL_MINUTES * 60 * 1000;
const MAX_RECHECKS = config.MAX_RECHECKS;

export async function checkCutoff(pipeline, recheckCount = 0) {
  const currentHour = new Date().getHours();

  if (pipeline.status !== PIPELINE_STATUS.AWAITING_ASSET) {
    return { switched: false };
  }

  if (currentHour < CUTOFF_HOUR) {
    return { switched: false, message: `Belum cutoff (${currentHour}:00 < ${CUTOFF_HOUR}:00)` };
  }

  if (recheckCount >= MAX_RECHECKS) {
    return await switchToFallback(pipeline);
  }

  return {
    switched: false,
    needRecheck: true,
    recheckCount,
    message: `Melewati cutoff, recheck ${recheckCount + 1}/${MAX_RECHECKS}`,
  };
}

async function switchToFallback(pipeline) {
  logger.warn(`[Fallback] Cutoff terlewati — switch ke fallback AI pillar`);

  const dayOfWeek = new Date(pipeline.calendar_date).getDay();
  const { data: pillar } = await supabase
    .from('content_calendar')
    .select('*')
    .eq('day_of_week', dayOfWeek)
    .single();

  const fallbackPillar = pillar?.fallback_ai_pillar;
  if (!fallbackPillar) {
    logger.warn('[Fallback] Tidak ada fallback pillar, skip konten hari ini');
    await supabase
      .from('content_pipeline')
      .update({
        status: PIPELINE_STATUS.FAILED,
        error_log: 'Cutoff time passed, no fallback pillar available',
        fallback_used: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pipeline.id);
    return { switched: true, fallbackUsed: true, skipped: true };
  }

  await supabase
    .from('content_pipeline')
    .update({
      pillar_name: fallbackPillar,
      needs_real_photo: false,
      status: PIPELINE_STATUS.IDEA,
      fallback_used: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pipeline.id);

  logger.info(`[Fallback] Switch ke: ${fallbackPillar}`);
  return { switched: true, fallbackUsed: true, newPillar: fallbackPillar };
}
