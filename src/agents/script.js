import { callWithFailover } from '../llm/client.js';
import { withRetry } from '../engine/retry.js';
import { updatePipelineStatus, logAgentAction, getActiveLearnings } from '../db/supabase.js';
import { agentProviders, PIPELINE_STATUS } from '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandContext = fs.readFileSync(path.join(__dirname, '../templates/brand-context.txt'), 'utf-8');
const systemPrompt = fs.readFileSync(path.join(__dirname, '../templates/prompts/script.txt'), 'utf-8').replace(/\{brand_context\}/g, brandContext);

export async function runScriptAgent(pipeline) {
  console.log('[Script Agent] Menulis naskah konten...');

  const learnings = await getActiveLearnings(pipeline.pillar_name);
  const learningsText = learnings.length
    ? learnings.map(l => `- ${l.insight_summary} (confidence: ${l.confidence})`).join('\n')
    : 'Belum ada learning';

  const prompt = systemPrompt.replace('{learnings}', learningsText);

  const userPrompt = `Buatkan naskah untuk ide konten ini:
- Judul: ${pipeline.idea_content.angle}
- Deskripsi: ${pipeline.idea_content.description}
- Tipe visual: ${pipeline.idea_content.visual_type}
- Pilar: ${pipeline.pillar_name}`;

  const startTime = Date.now();
  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.script, [
      { role: 'system', content: prompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.7 });
  }, 'script');

  let scriptContent;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    scriptContent = JSON.parse(cleaned);
  } catch (err) {
    scriptContent = { hook: result.content.substring(0, 150), body: [result.content], cta: 'Chat WA di bio!' };
  }

  await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.SCRIPT_DRAFTED, { script_content: scriptContent });

  await logAgentAction({
    pipeline_id: pipeline.id,
    agent_name: 'script',
    action: 'write_script',
    status: 'success',
    provider_used: result.providerUsed || 'unknown',
    model_used: result.modelUsed || null,
    tokens_used: result.usage?.total_tokens || 0,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[Script Agent] Hook: ${scriptContent.hook}`);
  return scriptContent;
}
