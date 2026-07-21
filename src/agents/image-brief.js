import { callWithFailover } from '../llm/client.js';
import { agentProviders } from '../config.js';
import { withRetry } from '../engine/retry.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandProfile = JSON.parse(fs.readFileSync(path.join(__dirname, '../templates/brand-profile.json'), 'utf-8'));

const imagePrompt = `You are an Image Brief Agent for ${brandProfile.brand.name}.
Your job: create a detailed visual brief for AI image generation.

Brand Visual Rules:
- Primary Color: ${brandProfile.visual.primary_color}
- Secondary Color: ${brandProfile.visual.secondary_color}
- Accent Color: ${brandProfile.visual.accent_color}
- Style: ${brandProfile.visual.style}
- Photography: ${JSON.stringify(brandProfile.visual.photography)}

Output JSON:
{
  "type": "image",
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
}`;

const layoutPrompt = `You are a Slide Design Brief Agent for ${brandProfile.brand.name}.
Your job: create a design brief for an Instagram carousel slide (text/education/tips content).

Brand Visual Rules:
- Primary Color: ${brandProfile.visual.primary_color}
- Secondary Color: ${brandProfile.visual.secondary_color}
- Accent Color: ${brandProfile.visual.accent_color}
- Style: ${brandProfile.visual.style}
- Fonts: ${brandProfile.visual.fonts.join(', ')}

Output JSON:
{
  "type": "layout",
  "layout": "fullscreen_text|split_text_image|top_text_bottom_visual|minimal_center",
  "background_type": "solid|gradient|pattern|illustration",
  "background_colors": ["warna utama", "warna aksen"],
  "typography": {
    "headline_style": "center|left|right",
    "headline_size": "large|medium|small",
    "headline_color": "#warna",
    "body_style": "center|left",
    "body_color": "#warna"
  },
  "icon_style": "minimal_line|filled|illustration|none",
  "decorative_elements": "geometric_shapes|dots|lines|illustrations|none",
  "overall_mood": "string (emotional tone)",
  "notes": "string (additional design notes)"
}`;

export async function runImageBriefAgent(pipeline, scriptContent, slide = null) {
  const isCarousel = pipeline.content_type === 'carousel';
  const slideType = slide?.slide_type || 'image';
  const isLayout = slideType === 'layout';

  console.log(`[Image Brief] Creating ${slideType} brief${isCarousel && slide ? ` for slide: ${slide.headline}` : ''}...`);

  const slideContext = slide ? `
- Slide Headline: ${slide.headline}
- Slide Description: ${slide.description}
- Slide Visual Notes: ${slide.visual_notes}
- Slide Type: ${slideType}` : '';

  const userPrompt = `Create ${slideType} brief for:
- Pillar: ${pipeline.pillar_name}
- Hook: ${scriptContent.hook}
${slideContext}
- Campaign Format: ${pipeline.campaign_plan?.format || (isCarousel ? 'carousel' : 'single_image')}
- Campaign Mood: ${pipeline.campaign_plan?.visual_mood || 'professional'}

Return JSON brief.`;

  const startTime = Date.now();
  const systemPrompt = isLayout ? layoutPrompt : imagePrompt;

  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.image_brief, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.6, responseFormat: { type: 'json_object' } });
  }, 'image_brief');

  let brief;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    const jsonStr = jsonStart !== -1 && jsonEnd !== -1 ? cleaned.substring(jsonStart, jsonEnd + 1) : cleaned;
    brief = JSON.parse(jsonStr);
  } catch {
    brief = isLayout ? {
      type: 'layout',
      layout: 'fullscreen_text',
      background_type: 'gradient',
      background_colors: [brandProfile.visual.primary_color, brandProfile.visual.accent_color],
      typography: {
        headline_style: 'center',
        headline_size: 'large',
        headline_color: '#ffffff',
        body_style: 'center',
        body_color: '#ffffff',
      },
      icon_style: 'minimal_line',
      decorative_elements: 'geometric_shapes',
      overall_mood: 'professional',
      notes: slide?.visual_notes || 'Clean slide design with brand colors',
    } : {
      type: 'image',
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

  console.log(`[Image Brief] ${isLayout ? 'Layout' : 'Image'} brief ready`);

  return {
    brief,
    duration_ms: Date.now() - startTime,
    provider_used: result.providerUsed,
  };
}
