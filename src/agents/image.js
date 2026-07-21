import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, agentProviders, PIPELINE_STATUS } from '../config.js';
import { updatePipelineStatus, logAgentAction } from '../db/supabase.js';
import { withRetry } from '../engine/retry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandVisualContext = fs.readFileSync(path.join(__dirname, '../templates/brand-context.txt'), 'utf-8')
  .split('\n').filter(l => l.match(/VISUAL|MOCKUP|AI|GAMBAR|FOTO|AI-GENERATED/i)).join('\n') || 'Prioritas visual: 1) Foto asli hasil produksi, 2) Foto proses, 3) Mockup, 4) AI hanya untuk edukasi. Jangan gunakan AI yang bisa disangka hasil produksi asli. Jangan tambah logo ke desain customer.';

async function generateWithCloudflare(prompt, options = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/ai/run/${config.CLOUDFLARE_AI_MODEL}`;

  const response = await axios.post(url, {
    prompt: `${prompt}\n\nCatatan brand: ${brandVisualContext}`,
    negative_prompt: options.negative_prompt || 'nsfw, low quality, blurry, distorted, text, watermark, extra fingers, bad anatomy',
    num_steps: options.steps || 20,
    guidance: options.cfg || 7.5,
  }, {
    headers: {
      'Authorization': `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  return Buffer.from(response.data);
}

export async function runImageAgent(pipeline, optimizedPrompt = null) {
  console.log('[Image Agent] Menyiapkan gambar...');

  if (pipeline.needs_real_photo) {
    console.log('[Image Agent] Pipeline butuh foto asli — menunggu upload Gaulan');
    await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.AWAITING_ASSET);
    return { type: 'awaiting_real_photo', message: 'Butuh foto asli dari Gaulan' };
  }

  await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.GENERATING_ASSET);
  
  // Extract prompt string and options from optimizedPrompt object
  let visualPrompt;
  let imageOptions = {};
  
  if (optimizedPrompt && typeof optimizedPrompt === 'object') {
    visualPrompt = optimizedPrompt.prompt || pipeline.script_content?.visual_notes || pipeline.idea_content?.description || 'Custom t-shirt design, Indonesian context';
    imageOptions = {
      negative_prompt: optimizedPrompt.negative_prompt,
      steps: optimizedPrompt.steps,
      cfg: optimizedPrompt.cfg,
    };
  } else if (typeof optimizedPrompt === 'string') {
    visualPrompt = optimizedPrompt;
  } else {
    visualPrompt = pipeline.script_content?.visual_notes || pipeline.idea_content?.description || 'Custom t-shirt design, Indonesian context';
  }

  const startTime = Date.now();
  const imageBuffer = await withRetry(async () => {
    return await generateWithCloudflare(visualPrompt, imageOptions);
  }, 'image');

  const filename = `ig_${pipeline.id}_${Date.now()}.png`;
  const filepath = path.join(process.cwd(), 'assets', filename);

  if (!fs.existsSync(path.join(process.cwd(), 'assets'))) {
    fs.mkdirSync(path.join(process.cwd(), 'assets'), { recursive: true });
  }

  fs.writeFileSync(filepath, imageBuffer);

  await updatePipelineStatus(pipeline.id, pipeline.status, {
    asset_url: filepath,
    asset_type: 'ai_generated',
  });

  await logAgentAction({
    pipeline_id: pipeline.id,
    agent_name: 'image',
    action: 'generate_image',
    status: 'success',
    provider_used: 'cloudflare_workers',
    duration_ms: Date.now() - startTime,
  });

  console.log(`[Image Agent] Gambar siap: ${filename}`);
  return { type: 'ai_generated', filepath, filename };
}
