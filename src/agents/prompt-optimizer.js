import { callWithFailover } from '../llm/client.js';
import { agentProviders } from '../config.js';
import { withRetry } from '../engine/retry.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandProfile = JSON.parse(fs.readFileSync(path.join(__dirname, '../templates/brand-profile.json'), 'utf-8'));

const systemPrompt = `You are a Prompt Optimizer for Stable Diffusion XL.
Your job: convert an image brief into an optimized SDXL prompt.

Brand Visual Rules:
- Primary Color: ${brandProfile.visual.primary_color}
- Style: ${brandProfile.visual.style}

Output JSON:
{
  "prompt": "string (optimized positive prompt, comma-separated tags)",
  "negative_prompt": "string (negative prompt)",
  "width": 1080,
  "height": 1350,
  "steps": 30,
  "cfg": 7.5,
  "seed": -1
}

Prompt Engineering Rules:
1. Start with subject description
2. Add style keywords (e.g., "professional photography", "studio lighting")
3. Add color palette from brand profile
4. Add composition details
5. Add quality boosters ("high quality", "detailed", "sharp focus")
6. Never include text, watermarks, or logos in prompt
7. Keep prompt under 200 words
8. Use comma-separated tags, not sentences
9. Include Instagram aspect ratio (1080x1350 for 4:5)

Example Output:
{
  "prompt": "professional workspace, modern desk, laptop, dark blue theme, soft studio lighting, clean composition, minimalist style, high quality, detailed, sharp focus, Instagram ready",
  "negative_prompt": "text, watermark, blurry, distorted, extra fingers, nsfw, low quality",
  "width": 1080,
  "height": 1350,
  "steps": 30,
  "cfg": 7.5,
  "seed": -1
}`;

export async function runPromptOptimizer(imageBrief, campaignPlan) {
  console.log('[Prompt Optimizer] Optimizing prompt for SDXL...');

  const userPrompt = `Optimize this image brief for SDXL:

Brief:
- Style: ${imageBrief.style}
- Lighting: ${imageBrief.lighting}
- Camera: ${imageBrief.camera}
- Composition: ${imageBrief.composition}
- Aspect: ${imageBrief.aspect}
- Brand Color: ${imageBrief.brand_color}
- Background: ${imageBrief.background}
- Subject: ${imageBrief.subject}
- Props: ${imageBrief.props?.join(', ') || 'None'}
- Mood: ${imageBrief.mood}
- Negative: ${imageBrief.negative_prompt}

Campaign:
- Format: ${campaignPlan?.format || 'single_image'}
- Objective: ${campaignPlan?.objective || 'product'}

Return optimized SDXL prompt JSON.`;

  const startTime = Date.now();

  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.prompt_optimizer, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.5, responseFormat: 'json_object' });
  }, 'prompt_optimizer');

  let optimized;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    optimized = JSON.parse(cleaned);
  } catch {
    optimized = {
      prompt: `${imageBrief.subject || 'Custom T-shirt'}, ${imageBrief.style || 'minimalist'} style, ${imageBrief.lighting || 'soft'} lighting, ${imageBrief.brand_color || '#0B1220'} color scheme, clean composition, high quality, detailed, sharp focus`,
      negative_prompt: imageBrief.negative_prompt || 'text, watermark, blurry, distorted, extra fingers, nsfw',
      width: 1080,
      height: 1350,
      steps: 30,
      cfg: 7.5,
      seed: -1,
    };
  }

  console.log(`[Prompt Optimizer] Prompt ready (${optimized.prompt.split(',').length} tags)`);

  return {
    optimized,
    duration_ms: Date.now() - startTime,
    provider_used: result.providerUsed,
  };
}
