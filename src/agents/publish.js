import fs from 'fs';
import path from 'path';
import { config, PIPELINE_STATUS } from '../config.js';
import { updatePipelineStatus, logAgentAction } from '../db/supabase.js';
import { withRetry } from '../engine/retry.js';
import { createMediaContainer, publishMediaContainer, getMedia } from '../platforms/instagram.js';

async function ensureBucket() {
  try {
    const listUrl = `${config.SUPABASE_URL}/storage/v1/bucket`;
    const res = await fetch(listUrl, {
      headers: { 'Authorization': `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const data = await res.json();
    const buckets = data.buckets || data.items || [];
    const exists = buckets.some(b => b.name === 'instagram-assets');
    if (exists) {
      console.log('[Publish] Bucket instagram-assets sudah ada');
      return;
    }
  } catch (e) {
    console.warn('[Publish] Gagal cek bucket, coba upload langsung:', e.message);
  }

  console.log('[Publish] Creating instagram-assets bucket...');
  try {
    const createRes = await fetch(`${config.SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'instagram-assets',
        name: 'instagram-assets',
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'video/mp4'],
      }),
    });
    const createData = await createRes.json();
    console.log('[Publish] Bucket create result:', JSON.stringify(createData));
  } catch (e) {
    console.warn('[Publish] Gagal create bucket (mungkin sudah ada):', e.message);
  }
}

let bucketReady = false;

async function uploadToStorage(localPath) {
  if (!bucketReady) {
    await ensureBucket();
    bucketReady = true;
  }

  const filename = `${Date.now()}_${path.basename(localPath)}`;
  const storageUrl = `${config.SUPABASE_URL}/storage/v1/object/instagram-assets/${filename}`;
  const imageBuffer = fs.readFileSync(localPath);

  const res = await fetch(storageUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[Publish] Storage upload error: ${res.status} - ${err}`);
    throw new Error(`Storage upload failed (${res.status}): ${err}`);
  }

  const publicUrl = `${config.SUPABASE_URL}/storage/v1/object/public/instagram-assets/${filename}`;
  console.log(`[Publish] Uploaded to: ${publicUrl}`);
  return publicUrl;
}

export async function runPublishAgent(pipeline) {
  console.log('[Publish Agent] Mempublikasikan konten ke Instagram...');

  if (!config.IG_ACCESS_TOKEN || config.IG_ACCESS_TOKEN === 'your_long_lived_access_token') {
    console.log('[Publish Agent] IG_ACCESS_TOKEN belum diisi — skip publish (dry run)');
    await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.PUBLISHED, {
      ig_post_id: 'dry-run',
      ig_permalink: 'https://instagram.com/p/dry-run/',
    });
    return { success: true, igPostId: 'dry-run', permalink: 'https://instagram.com/p/dry-run/', dryRun: true };
  }

  const startTime = Date.now();

  return withRetry(async () => {
    let imageUrl = pipeline.asset_url;

    if (imageUrl && fs.existsSync(imageUrl)) {
      console.log('[Publish Agent] Upload asset ke Supabase Storage...');
      try {
        imageUrl = await uploadToStorage(imageUrl);
      } catch (e) {
        throw new Error(`Gagal upload ke Supabase Storage: ${e.message}. Buat bucket "instagram-assets" dulu di Supabase Storage!`);
      }
    }

    if (!imageUrl) {
      throw new Error('Tidak ada asset URL untuk dipublish');
    }

    const containerId = await createMediaContainer(imageUrl, pipeline.caption_content);
    console.log(`[Publish Agent] Container ID: ${containerId}`);

    await new Promise(r => setTimeout(r, 5000));
    const igPostId = await publishMediaContainer(containerId);

    let permalink = `https://instagram.com/p/${igPostId}/`;
    try {
      const media = await getMedia(igPostId);
      if (media.permalink) permalink = media.permalink;
    } catch {
      console.warn('[Publish Agent] Gagal fetch permalink, pakai default');
    }

    await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.PUBLISHED, {
      ig_post_id: igPostId,
      ig_permalink: permalink,
    });

    await logAgentAction({
      pipeline_id: pipeline.id,
      agent_name: 'publish',
      action: 'publish_post',
      status: 'success',
      provider_used: 'instagram_api',
      duration_ms: Date.now() - startTime,
      metadata: { ig_post_id: igPostId, permalink },
    });

    console.log(`[Publish Agent] Berhasil publish! ${permalink}`);
    return { success: true, igPostId, permalink };

  }, 'publish');
}
