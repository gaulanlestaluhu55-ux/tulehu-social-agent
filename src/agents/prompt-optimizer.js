import { callWithFailover } from '../llm/client.js';
import { agentProviders } from '../config.js';
import { withRetry } from '../engine/retry.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandProfile = JSON.parse(fs.readFileSync(path.join(__dirname, '../templates/brand-profile.json'), 'utf-8'));

const imagePromptText = `You are a Prompt Optimizer for Stable Diffusion XL.
Your job: convert an image brief into an optimized SDXL prompt.

Brand Visual Rules:
- Primary Color: ${brandProfile.visual.primary_color}
- Style: ${brandProfile.visual.style}

Output JSON:
{
  "type": "image",
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
9. Include Instagram aspect ratio (1080x1350 for 4:5)`;

const layoutPromptText = `You are a Slide Design Optimizer for Instagram carousel.
Your job: convert a design brief into a clear layout direction for a graphic designer (Canva/Photoshop).

Output JSON:
{
  "type": "layout",
  "canvas_size": "1080x1350 (Instagram 4:5)",
  "layout_direction": "string (how elements are arranged)",
  "background_guidance": "string (colors, gradients, patterns)",
  "typography_guidance": "string (fonts, sizes, alignment, colors)",
  "icon_illustration": "string (icon style, placement, or illustration notes)",
  "decorative_notes": "string (shapes, lines, other decor)",
  "designer_notes": "string (tips for the designer)"
}`;

export async function runPromptOptimizer(imageBrief, campaignPlan, slideIndex = null) {
  const slideLabel = slideIndex !== null ? ` (slide ${slideIndex + 1})` : '';
  const isLayout = imageBrief.type === 'layout';
  console.log(`[Prompt Optimizer] Optimizing ${isLayout ? 'layout direction' : 'SDXL prompt'}${slideLabel}...`);

  const userPrompt = isLayout
    ? `Create a layout direction from this design brief:

Brief:
- Layout: ${imageBrief.layout}
- Background: ${imageBrief.background_type} / ${imageBrief.background_colors?.join(', ')}
- Typography: headline ${imageBrief.typography?.headline_style} / body ${imageBrief.typography?.body_style}
- Icon: ${imageBrief.icon_style}
- Decor: ${imageBrief.decorative_elements}
- Mood: ${imageBrief.overall_mood}
- Notes: ${imageBrief.notes}

Return layout direction JSON.`
    : `Optimize this image brief for SDXL:

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
  const systemPrompt = isLayout ? layoutPromptText : imagePromptText;

  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.prompt_optimizer, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.5, responseFormat: { type: 'json_object' } });
  }, 'prompt_optimizer');

  let optimized;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    const jsonStr = jsonStart !== -1 && jsonEnd !== -1 ? cleaned.substring(jsonStart, jsonEnd + 1) : cleaned;
    optimized = JSON.parse(jsonStr);
  } catch {
    optimized = isLayout ? {
      type: 'layout',
      canvas_size: '1080x1350',
      layout_direction: `Center text layout. Headline at top, description below, icon in middle.`,
      background_guidance: `Solid background with brand colors`,
      typography_guidance: `Large bold headline, smaller body text, centered alignment`,
      icon_illustration: 'Minimal line icons matching the topic',
      decorative_notes: 'Geometric shapes as decorative elements',
      designer_notes: imageBrief.notes || 'Keep it clean and modern',
    } : {
      type: 'image',
      prompt: `${imageBrief.subject || 'Custom T-shirt'}, ${imageBrief.style || 'minimalist'} style, ${imageBrief.lighting || 'soft'} lighting, ${imageBrief.brand_color || '#0B1220'} color scheme, clean composition, high quality, detailed, sharp focus`,
      negative_prompt: imageBrief.negative_prompt || 'text, watermark, blurry, distorted, extra fingers, nsfw',
      width: 1080,
      height: 1350,
      steps: 30,
      cfg: 7.5,
      seed: -1,
    };
  }

  console.log(`[Prompt Optimizer] ${isLayout ? 'Layout direction' : 'Prompt'} ready`);

  return {
    optimized,
    duration_ms: Date.now() - startTime,
    provider_used: result.providerUsed,
  };
}
