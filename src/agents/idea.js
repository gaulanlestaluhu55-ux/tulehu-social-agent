import { callWithFailover } from '../llm/client.js';
import { withRetry } from '../engine/retry.js';
import { getActiveLearnings, createPipelineEntry, logAgentAction } from '../db/supabase.js';
import { agentProviders } from '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandContext = fs.readFileSync(path.join(__dirname, '../templates/brand-context.txt'), 'utf-8');
const ideaPrompt = fs.readFileSync(path.join(__dirname, '../templates/prompts/idea.txt'), 'utf-8').replace(/\{brand_context\}/g, brandContext);

export async function runIdeaAgent(pillar, calendarDate) {
  console.log('[Idea Agent] Menghasilkan ide konten...');

  const learnings = await getActiveLearnings(pillar.pillar_name);
  const learningsText = learnings.length
    ? learnings.map(l => `- ${l.insight_summary} (confidence: ${l.confidence})`).join('\n')
    : 'Belum ada learning';

  const prompt = ideaPrompt
    .replace('{pillar_name}', pillar.pillar_name)
    .replace('{needs_real_photo}', pillar.needs_real_photo ? 'Ya' : 'Tidak')
    .replace('{learnings}', learningsText);

  const startTime = Date.now();
  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.idea, [
      { role: 'system', content: prompt },
      { role: 'user', content: 'Hasilkan ide konten untuk hari ini.' },
    ], { temperature: 0.8 });
  }, 'idea');

  let ideaContent;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    ideaContent = JSON.parse(cleaned);
  } catch (err) {
    ideaContent = {
      angle: result.content.split('\n')[0].replace(/^["\s]*|["\s]*$/g, ''),
      description: result.content.substring(0, 200),
      visual_type: pillar.needs_real_photo ? 'real_photo' : 'ai_generated',
    };
  }

  const pipeline = await createPipelineEntry(calendarDate, pillar, ideaContent);

  await logAgentAction({
    pipeline_id: pipeline.id,
    agent_name: 'idea',
    action: 'generate_idea',
    status: 'success',
    provider_used: result.providerUsed || 'unknown',
    model_used: result.modelUsed || null,
    tokens_used: result.usage?.total_tokens || 0,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[Idea Agent] Ide: ${ideaContent.angle}`);
  return pipeline;
}
