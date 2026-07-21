import { callWithFailover } from '../llm/client.js';
import { agentProviders } from '../config.js';
import { supabase } from '../db/supabase.js';
import { withRetry } from '../engine/retry.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandProfile = JSON.parse(fs.readFileSync(path.join(__dirname, '../templates/brand-profile.json'), 'utf-8'));

const systemPrompt = `You are a Campaign Planner for ${brandProfile.brand.name}.
Your job: plan content campaigns based on the content calendar.

Brand Context:
- Type: ${brandProfile.brand.type}
- Location: ${brandProfile.brand.location}
- Tone: ${brandProfile.tone.voice}, ${brandProfile.tone.language}
- Visual Style: ${brandProfile.visual.style}
- Primary Color: ${brandProfile.visual.primary_color}

Output JSON:
{
  "pillar": "string (from content_calendar)",
  "objective": "edu|product|bts|promo|testimonial|interactive",
  "format": "carousel|single_image|reel|story",
  "target_platforms": ["instagram", "facebook", "threads", "tiktok"],
  "content_angle": "string (specific angle for today)",
  "key_message": "string (main takeaway)",
  "visual_mood": "string (e.g., warm, professional, playful)",
  "estimated_duration_minutes": number
}

Rules:
- Match objective to pillar type
- Choose format based on content type (edu→carousel, product→single_image, bts→reel)
- Always include all 4 platforms
- Keep visual_mood consistent with brand profile`;

export async function runCampaignPlanner(pillar, calendarDate) {
  console.log('[Campaign Planner] Planning content for', calendarDate);

  const { data: learnings } = await supabase
    .from('learnings')
    .select('insight_summary, pillar_related, confidence')
    .eq('status', 'active')
    .eq('pillar_related', pillar.pillar_name)
    .order('confidence', { ascending: false })
    .limit(5);

  const learningsText = learnings?.map(l => `- ${l.insight_summary} (${l.confidence})`).join('\n') || 'No learnings yet';

  const userPrompt = `Plan content for:
- Date: ${calendarDate}
- Pillar: ${pillar.pillar_name}
- Needs Real Photo: ${pillar.needs_real_photo}
- Learnings:\n${learningsText}

Return JSON plan.`;

  const startTime = Date.now();

  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.campaign, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.7, responseFormat: { type: 'json_object' } });
  }, 'campaign');

  let plan;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    plan = JSON.parse(cleaned);
  } catch {
    plan = {
      pillar: pillar.pillar_name,
      objective: pillar.pillar_name.includes('Tips') ? 'edu' : 'product',
      format: 'single_image',
      target_platforms: ['instagram', 'facebook', 'threads', 'tiktok'],
      content_angle: pillar.pillar_name,
      key_message: 'Custom T-shirt printing by Tulehu Inkline',
      visual_mood: brandProfile.visual.style,
      estimated_duration_minutes: 30,
    };
  }

  console.log(`[Campaign Planner] Plan ready: ${plan.objective} → ${plan.format}`);

  return {
    plan,
    duration_ms: Date.now() - startTime,
    provider_used: result.providerUsed,
  };
}
