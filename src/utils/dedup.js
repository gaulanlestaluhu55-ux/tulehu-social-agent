import { supabase } from '../db/supabase.js';
import crypto from 'crypto';

const SIMILARITY_THRESHOLD = 0.85;

function calculateHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function hammingDistance(hash1, hash2) {
  const bin1 = parseInt(hash1, 16).toString(2).padStart(128, '0');
  const bin2 = parseInt(hash2, 16).toString(2).padStart(128, '0');
  let distance = 0;
  for (let i = 0; i < 128; i++) {
    if (bin1[i] !== bin2[i]) distance++;
  }
  return distance;
}

function calculateSimilarity(hash1, hash2) {
  const distance = hammingDistance(hash1, hash2);
  return 1 - (distance / 128);
}

export async function checkDuplicate(imageBuffer, excludePipelineId = null) {
  const newHash = calculateHash(imageBuffer);

  let query = supabase
    .from('content_pipeline')
    .select('id, asset_url, asset_hash, pillar_name, calendar_date')
    .not('asset_hash', 'is', null)
    .order('calendar_date', { ascending: false })
    .limit(30);

  if (excludePipelineId) {
    query = query.neq('id', excludePipelineId);
  }

  const { data: recentPipelines } = await query;

  if (!recentPipelines || recentPipelines.length === 0) {
    return { isDuplicate: false, similarity: 0, similarPost: null };
  }

  let maxSimilarity = 0;
  let mostSimilar = null;

  for (const pipeline of recentPipelines) {
    if (!pipeline.asset_hash) continue;

    const similarity = calculateSimilarity(newHash, pipeline.asset_hash);

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      mostSimilar = pipeline;
    }
  }

  const isDuplicate = maxSimilarity >= SIMILARITY_THRESHOLD;

  if (isDuplicate) {
    console.log(`[Dedup] Duplicate detected: ${maxSimilarity.toFixed(2)} similarity with ${mostSimilar.calendar_date}`);
  }

  return {
    isDuplicate,
    similarity: maxSimilarity,
    similarPost: mostSimilar ? {
      id: mostSimilar.id,
      date: mostSimilar.calendar_date,
      pillar: mostSimilar.pillar_name,
    } : null,
  };
}

export async function storeImageHash(pipelineId, imageBuffer) {
  const hash = calculateHash(imageBuffer);

  await supabase
    .from('content_pipeline')
    .update({ asset_hash: hash })
    .eq('id', pipelineId);

  return hash;
}

export async function getRecentImageHashes(days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data } = await supabase
    .from('content_pipeline')
    .select('id, asset_hash, calendar_date, pillar_name')
    .not('asset_hash', 'is', null)
    .gte('calendar_date', startDate.toISOString().split('T')[0])
    .order('calendar_date', { ascending: false });

  return data || [];
}
