import { callWithFailover } from '../llm/client.js';
import { agentProviders } from '../config.js';
import { withRetry } from '../engine/retry.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandProfile = JSON.parse(fs.readFileSync(path.join(__dirname, '../templates/brand-profile.json'), 'utf-8'));

const systemPrompt = `You are an Image Brief Agent for ${brandProfile.brand.name}.
Your job: create a detailed visual brief for AI image generation.

Brand Visual Rules:
- Primary Color: ${brandProfile.visual.primary_color}
- Secondary Color: ${brandProfile.visual.secondary_color}
- Accent Color: ${brandProfile.visual.accent_color}
- Style: ${brandProfile.visual.style}
- Photography: ${JSON.stringify(brandProfile.visual.photography)}

Output JSON:
{
  "style": "minimalist|professional|playful|cinematic",
  "lighting": "natural|soft_studio|dramatic|golden_hour",
  "camera": "85mm|50mm|35mm|wide_angle|macro",
  "composition": "center|rule_of_thirds|leading_lines|symmetrical",
  "aspect": "4:5|1:1|16:9",
  "brand_color": "${brandProfile.visual.primary_color}",
  "accent_color": "${brandProfile.visual.accent_color}",
  "background": "clean_white|dark_gradient|textured|environmental",
  "subject": "string (main visual element)",
  "props": ["array of supporting elements"],
  "mood": "string (emotional tone)",
  "negative_prompt": "text, watermark, blurry, distorted, extra fingers, nsfw"
}

Rules:
- Match style to content objective
- Always use brand colors
- Keep composition clean for Instagram
- Include negative_prompt for quality`;

export async function runImageBriefAgent(pipeline, scriptContent, slide = null) {
  const isCarousel = pipeline.content_type === 'carousel';
  console.log(`[Image Brief] Creating visual brief${isCarousel && slide ? ` for slide: ${slide.headline}` : ''}...`);

  const slideContext = slide ? `
- Slide Headline: ${slide.headline}
- Slide Description: ${slide.description}
- Slide Visual Notes: ${slide.visual_notes}` : '';

  const userPrompt = `Create image brief for:
- Pillar: ${pipeline.pillar_name}
- Hook: ${scriptContent.hook}
- Visual Notes: ${scriptContent.visual_notes || 'None'}
${slideContext}
- Campaign Format: ${pipeline.campaign_plan?.format || (isCarousel ? 'carousel' : 'single_image')}
- Campaign Mood: ${pipeline.campaign_plan?.visual_mood || 'professional'}

Return JSON brief.`;

  const startTime = Date.now();

  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.image_brief, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.6, responseFormat: { type: 'json_object' } });
  }, 'image_brief');

  let brief;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    brief = JSON.parse(cleaned);
  } catch {
    brief = {
      style: 'minimalist',
      lighting: 'soft_studio',
      camera: '85mm',
      composition: 'center',
      aspect: '4:5',
      brand_color: brandProfile.visual.primary_color,
      accent_color: brandProfile.visual.accent_color,
      background: 'clean_white',
      subject: scriptContent.visual_notes || 'Custom T-shirt design',
      props: ['workspace', 'professional setting'],
      mood: 'professional',
      negative_prompt: 'text, watermark, blurry, distorted, extra fingers, nsfw',
    };
  }

  console.log(`[Image Brief] Brief ready: ${brief.style} / ${brief.lighting}`);

  return {
    brief,
    duration_ms: Date.now() - startTime,
    provider_used: result.providerUsed,
  };
}
