import { callWithFailover } from '../llm/client.js';
import { withRetry } from '../engine/retry.js';
import { updatePipelineStatus, logAgentAction, getActiveLearnings } from '../db/supabase.js';
import { agentProviders, PIPELINE_STATUS } from '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandContext = fs.readFileSync(path.join(__dirname, '../templates/brand-context.txt'), 'utf-8');
const singlePrompt = fs.readFileSync(path.join(__dirname, '../templates/prompts/script.txt'), 'utf-8').replace(/\{brand_context\}/g, brandContext);
const carouselPrompt = fs.readFileSync(path.join(__dirname, '../templates/prompts/script-carousel.txt'), 'utf-8').replace(/\{brand_context\}/g, brandContext);

export async function runScriptAgent(pipeline) {
  const isCarousel = pipeline.content_type === 'carousel';
  console.log(`[Script Agent] Menulis naskah konten (${isCarousel ? 'carousel' : 'single_image'})...`);

  const learnings = await getActiveLearnings(pipeline.pillar_name);
  const learningsText = learnings.length
    ? learnings.map(l => `- ${l.insight_summary} (confidence: ${l.confidence})`).join('\n')
    : 'Belum ada learning';

  const basePrompt = (isCarousel ? carouselPrompt : singlePrompt).replace('{learnings}', learningsText);

  const userPrompt = `Buatkan naskah untuk ide konten ini:
- Judul: ${pipeline.idea_content.angle}
- Deskripsi: ${pipeline.idea_content.description}
- Tipe visual: ${pipeline.idea_content.visual_type}
- Tipe konten: ${isCarousel ? 'carousel (3-5 slide)' : 'single image'}
- Pilar: ${pipeline.pillar_name}`;

  const startTime = Date.now();
  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.script, [
      { role: 'system', content: basePrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.7 });
  }, 'script');

  let scriptContent;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    const jsonStr = jsonStart !== -1 && jsonEnd !== -1 ? cleaned.substring(jsonStart, jsonEnd + 1) : cleaned;
    scriptContent = JSON.parse(jsonStr);

    // Handle nested string: hook/body might contain JSON string
    if (typeof scriptContent.hook === 'string' && scriptContent.hook.includes('"hook"')) {
      const inner = JSON.parse(scriptContent.hook);
      scriptContent = { ...scriptContent, ...inner };
    }
    if (typeof scriptContent.body === 'string') {
      scriptContent.body = [scriptContent.body];
    }
  } catch (err) {
    if (isCarousel) {
      scriptContent = {
        hook: result.content.substring(0, 150),
        body: [result.content],
        cta: 'Chat WA di bio!',
        slides: [
          { headline: 'Hook', description: result.content.substring(0, 200), visual_notes: 'Foto produk kaos sablon' },
          { headline: 'Detail', description: result.content.substring(200, 400), visual_notes: 'Detail proses sablon' },
          { headline: 'CTA', description: 'Chat WA di bio!', visual_notes: 'WhatsApp icon + nomor' },
        ],
      };
    } else {
      scriptContent = { hook: result.content.substring(0, 150), body: [result.content], cta: 'Chat WA di bio!' };
    }
  }

  if (isCarousel && !scriptContent.slides) {
    scriptContent.slides = [
      { headline: scriptContent.hook, description: scriptContent.body?.[0] || '', visual_notes: 'Visual hook' },
      { headline: 'Isi', description: scriptContent.body?.join(' ') || '', visual_notes: 'Visual utama' },
      { headline: 'CTA', description: scriptContent.cta, visual_notes: 'Visual CTA' },
    ];
  }

  await updatePipelineStatus(pipeline.id, PIPELINE_STATUS.SCRIPT_READY, { script_content: scriptContent });

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
  if (isCarousel) console.log(`[Script Agent] Slides: ${scriptContent.slides.length}`);
  return scriptContent;
}
