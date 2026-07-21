import { supabase } from '../db/supabase.js';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

const QUEUE_STATES = {
  PENDING: 'pending',
  UPLOADING: 'uploading',
  PUBLISHED: 'published',
  FAILED: 'failed',
  RETRY: 'retry',
};

const PLATFORMS = {
  instagram: { name: 'Instagram', maxCaption: 2200, maxHashtags: 30 },
  facebook: { name: 'Facebook', maxCaption: 63206, maxHashtags: 0 },
  threads: { name: 'Threads', maxCaption: 500, maxHashtags: 0 },
  tiktok: { name: 'TikTok', maxCaption: 2200, maxHashtags: 0 },
};

export async function addToQueue(pipelineId, platforms, content) {
  const entries = [];

  for (const platform of platforms) {
    const platformConfig = PLATFORMS[platform];
    if (!platformConfig) {
      console.warn(`[Publisher Queue] Unknown platform: ${platform}`);
      continue;
    }

    let caption = content.caption;
    if (caption.length > platformConfig.maxCaption) {
      caption = caption.substring(0, platformConfig.maxCaption - 3) + '...';
    }

    const { data, error } = await supabase
      .from('publish_queue')
      .insert({
        pipeline_id: pipelineId,
        platform,
        status: QUEUE_STATES.PENDING,
        caption_content: caption,
        hashtags: content.hashtags || [],
        asset_url: content.asset_url,
        asset_type: content.asset_type,
        retry_count: 0,
        max_retries: 3,
        metadata: {
          brand_color: content.brand_color,
          visual_mood: content.visual_mood,
          campaign_objective: content.campaign_objective,
        },
      })
      .select()
      .single();

    if (error) {
      console.error(`[Publisher Queue] Failed to add ${platform}:`, error.message);
      continue;
    }

    entries.push(data);
    console.log(`[Publisher Queue] Added ${platform} job: ${data.id}`);
  }

  return entries;
}

export async function processQueue() {
  const { data: pendingJobs } = await supabase
    .from('publish_queue')
    .select('*')
    .eq('status', QUEUE_STATES.PENDING)
    .order('created_at', { ascending: true })
    .limit(5);

  if (!pendingJobs || pendingJobs.length === 0) {
    return { processed: 0 };
  }

  let processed = 0;

  for (const job of pendingJobs) {
    try {
      await supabase
        .from('publish_queue')
        .update({ status: QUEUE_STATES.UPLOADING, started_at: new Date().toISOString() })
        .eq('id', job.id);

      const result = await publishToPlatform(job);

      await supabase
        .from('publish_queue')
        .update({
          status: QUEUE_STATES.PUBLISHED,
          platform_post_id: result.postId,
          platform_permalink: result.permalink,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      processed++;
      console.log(`[Publisher Queue] Published to ${job.platform}: ${result.permalink}`);

    } catch (error) {
      const newRetryCount = (job.retry_count || 0) + 1;
      const newStatus = newRetryCount >= job.max_retries ? QUEUE_STATES.FAILED : QUEUE_STATES.RETRY;

      await supabase
        .from('publish_queue')
        .update({
          status: newStatus,
          retry_count: newRetryCount,
          error_message: error.message,
          last_error_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      console.error(`[Publisher Queue] Failed ${job.platform} (attempt ${newRetryCount}):`, error.message);
    }
  }

  return { processed };
}

async function publishToPlatform(job) {
  switch (job.platform) {
    case 'instagram':
      return await publishToInstagram(job);
    case 'facebook':
      return await publishToFacebook(job);
    case 'threads':
      return await publishToThreads(job);
    case 'tiktok':
      return await publishToTiktok(job);
    default:
      throw new Error(`Unsupported platform: ${job.platform}`);
  }
}

async function publishToInstagram(job) {
  const { createMediaContainer, publishMediaContainer, getMedia } = await import('../platforms/instagram.js');

  let imageUrl = job.asset_url;

  if (imageUrl && fs.existsSync(imageUrl)) {
    const { uploadToStorage } = await import('../agents/publish.js');
    imageUrl = await uploadToStorage(imageUrl);
  }

  if (!imageUrl) {
    throw new Error('No image URL for Instagram publish');
  }

  const caption = job.hashtags?.length
    ? `${job.caption_content}\n\n${job.hashtags.map(h => `#${h}`).join(' ')}`
    : job.caption_content;

  const containerId = await createMediaContainer(imageUrl, caption);
  await new Promise(r => setTimeout(r, 5000));
  const igPostId = await publishMediaContainer(containerId);

  let permalink = `https://instagram.com/p/${igPostId}/`;
  try {
    const media = await getMedia(igPostId);
    if (media.permalink) permalink = media.permalink;
  } catch {}

  return { postId: igPostId, permalink };
}

async function publishToFacebook(job) {
  console.log(`[Publisher Queue] Facebook publish not yet implemented`);
  return { postId: 'pending', permalink: 'https://facebook.com/pending' };
}

async function publishToThreads(job) {
  console.log(`[Publisher Queue] Threads publish not yet implemented`);
  return { postId: 'pending', permalink: 'https://threads.net/pending' };
}

async function publishToTiktok(job) {
  console.log(`[Publisher Queue] TikTok publish not yet implemented`);
  return { postId: 'pending', permalink: 'https://tiktok.com/pending' };
}

export async function getQueueStatus(pipelineId) {
  const { data } = await supabase
    .from('publish_queue')
    .select('*')
    .eq('pipeline_id', pipelineId)
    .order('created_at', { ascending: true });

  return data || [];
}

export async function retryFailedJob(jobId) {
  const { data: job } = await supabase
    .from('publish_queue')
    .select('*')
    .eq('id', jobId)
    .single();

  if (!job || job.status !== QUEUE_STATES.FAILED) {
    return null;
  }

  await supabase
    .from('publish_queue')
    .update({
      status: QUEUE_STATES.RETRY,
      retry_count: 0,
      error_message: null,
    })
    .eq('id', jobId);

  return jobId;
}

export { QUEUE_STATES, PLATFORMS };
