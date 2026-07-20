import { callWithFailover } from '../llm/client.js';
import { withRetry } from '../engine/retry.js';
import { updatePipelineStatus, logAgentAction } from '../db/supabase.js';
import { agentProviders } from '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandContext = fs.readFileSync(path.join(__dirname, '../templates/brand-context.txt'), 'utf-8');
const systemPrompt = fs.readFileSync(path.join(__dirname, '../templates/prompts/caption.txt'), 'utf-8').replace(/\{brand_context\}/g, brandContext);

export async function runCaptionAgent(pipeline, scriptContent) {
  console.log('[Caption Agent] Menulis caption & hashtag...');

  const userPrompt = `Buat caption untuk konten ini:
- Pilar: ${pipeline.pillar_name}
- Hook: ${scriptContent.hook}
- Isi: ${JSON.stringify(scriptContent.body)}
- CTA: ${scriptContent.cta}`;

  const startTime = Date.now();
  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.caption, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.6 });
  }, 'caption');

  let captionContent;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    captionContent = JSON.parse(cleaned);
  } catch (err) {
    captionContent = {
      caption: result.content.substring(0, 2200),
      hashtags: ['TulehuInkline', 'KaosCustom', 'SablonKaos', 'Maluku'],
    };
  }

  const captionText = `${captionContent.caption}\n\n${captionContent.hashtags?.map(h => `#${h}`).join(' ') || ''}`;

  await updatePipelineStatus(pipeline.id, pipeline.status, {
    caption_content: captionText,
    hashtags: captionContent.hashtags,
  });

  await logAgentAction({
    pipeline_id: pipeline.id,
    agent_name: 'caption',
    action: 'write_caption',
    status: 'success',
    provider_used: result.providerUsed || 'unknown',
    model_used: result.modelUsed || null,
    tokens_used: result.usage?.total_tokens || 0,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[Caption Agent] Caption siap (${captionContent.caption.length} chars)`);
  return captionContent;
}
