import { callWithFailover } from '../llm/client.js';
import { withRetry } from '../engine/retry.js';
import { getActiveLearnings, logAgentAction } from '../db/supabase.js';
import { agentProviders } from '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandContext = fs.readFileSync(path.join(__dirname, '../templates/brand-context.txt'), 'utf-8');
const ideaPrompt = fs.readFileSync(path.join(__dirname, '../templates/prompts/idea.txt'), 'utf-8').replace(/\{brand_context\}/g, brandContext);

/**
 * Generate 3-5 idea options for a pipeline slot.
 * @param {object} pipeline - pipeline row with pillar_name, calendar_date, etc.
 * @returns {object[]} array of idea options [{angle, description, visual_type}, ...]
 */
export async function runIdeaAgent(pipeline) {
  console.log('[Idea Agent] Generating idea options...');

  const learnings = await getActiveLearnings(pipeline.pillar_name);
  const learningsText = learnings.length
    ? learnings.map(l => `- ${l.insight_summary} (confidence: ${l.confidence})`).join('\n')
    : 'Belum ada learning';

  const prompt = ideaPrompt
    .replace('{pillar_name}', pipeline.pillar_name)
    .replace('{needs_real_photo}', 'Ya')
    .replace('{learnings}', learningsText);

  const startTime = Date.now();
  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.idea, [
      { role: 'system', content: prompt + '\n\nIMPORTANT: Return a JSON object with "options" array containing 3-5 idea alternatives. Format: {"options": [{"angle": "...", "description": "...", "visual_type": "ai_generated|real_photo"}, ...]}' },
      { role: 'user', content: `Hasilkan 3-5 ide konten untuk pilar: ${pipeline.pillar_name}` },
    ], { temperature: 0.8 });
  }, 'idea');

  let ideas;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Handle both formats: {options: [...]} or single object
    if (Array.isArray(parsed.options)) {
      ideas = parsed.options;
    } else if (Array.isArray(parsed)) {
      ideas = parsed;
    } else {
      // Single idea — wrap in array and add 2 more generic alternatives
      ideas = [parsed];
    }
  } catch (err) {
    // Fallback: create single idea from text
    ideas = [{
      angle: result.content.split('\n')[0].replace(/^["\s]*|["\s]*$/g, '').substring(0, 100),
      description: result.content.substring(0, 200),
      visual_type: 'ai_generated',
    }];
  }

  // Ensure 3-5 options minimum
  if (ideas.length < 3) {
    const genericAngles = [
      'Tips & edukasi praktis',
      'Behind the scenes proses',
      'Testimoni & social proof',
      'Quote/inspirasi desain',
      'Interaktif Q&A',
    ];
    while (ideas.length < 3 && ideas.length < 5) {
      const usedAngles = ideas.map(i => i.angle?.toLowerCase() || '');
      const available = genericAngles.filter(a => !usedAngles.includes(a.toLowerCase()));
      if (available.length === 0) break;
      ideas.push({
        angle: available[0],
        description: `Konten ${available[0].toLowerCase()} untuk pilar ${pipeline.pillar_name}`,
        visual_type: 'ai_generated',
      });
    }
  }

  // Normalize format
  ideas = ideas.map(idea => ({
    angle: String(idea.angle || 'Ide konten').substring(0, 100),
    description: String(idea.description || '').substring(0, 300),
    visual_type: idea.visual_type || 'ai_generated',
  }));

  await logAgentAction({
    pipeline_id: pipeline.id,
    agent_name: 'idea',
    action: 'generate_ideas',
    status: 'success',
    provider_used: result.providerUsed || 'unknown',
    model_used: result.modelUsed || null,
    tokens_used: result.usage?.total_tokens || 0,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[Idea Agent] ${ideas.length} ideas generated`);
  return ideas;
}
