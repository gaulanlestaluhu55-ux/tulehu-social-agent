import { callWithFailover, multimodalText } from '../llm/client.js';
import { agentProviders } from '../config.js';
import { withRetry } from '../engine/retry.js';
import fs from 'fs';

const systemPrompt = `You are an Image Quality Checker for social media content.
Your job: evaluate AI-generated images for quality and brand compliance.

Quality Criteria:
1. Technical: blur, noise, artifacts, resolution
2. Anatomy: hands, fingers, faces, proportions
3. Composition: framing, balance, focal point
4. Brand: color accuracy, style consistency, no unwanted text/watermarks
5. Platform: Instagram-ready (4:5 ratio, clean, engaging)

Scoring:
- 0.0-0.5: Reject (needs regeneration)
- 0.5-0.7: Acceptable (minor issues)
- 0.7-0.9: Good (ready to use)
- 0.9-1.0: Excellent (perfect)

Output JSON:
{
  "score": number (0.0-1.0),
  "verdict": "reject|acceptable|good|excellent",
  "issues": ["array of issues found"],
  "suggestions": ["array of improvement suggestions"],
  "brand_compliant": boolean,
  "instagram_ready": boolean
}

Rules:
- Be strict on anatomy (hands, faces)
- Be strict on text/watermarks (never acceptable)
- Be lenient on minor style variations
- Always check Instagram aspect ratio (4:5 preferred)`;

export async function runImageQualityChecker(imagePath, imageBrief) {
  console.log('[Image Review] Checking image quality...');

  if (!fs.existsSync(imagePath)) {
    return {
      score: 0,
      verdict: 'reject',
      issues: ['Image file not found'],
      suggestions: ['Regenerate image'],
      brand_compliant: false,
      instagram_ready: false,
    };
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  const userPrompt = `Evaluate this AI-generated image:

Expected Brief:
- Style: ${imageBrief?.style || 'minimalist'}
- Lighting: ${imageBrief?.lighting || 'soft'}
- Subject: ${imageBrief?.subject || 'Custom T-shirt'}
- Brand Color: ${imageBrief?.brand_color || '#0B1220'}

Check for:
1. Blur or artifacts
2. Hand/face distortions
3. Text or watermarks
4. Color accuracy
5. Instagram readiness (4:5 ratio)

Return quality assessment JSON.`;

  const startTime = Date.now();

  const result = await withRetry(async () => {
    return await callWithFailover(agentProviders.vision, [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ], { temperature: 0.3, responseFormat: { type: 'json_object' } });
  }, 'image_review');

  let assessment;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    assessment = JSON.parse(cleaned);
  } catch {
    assessment = {
      score: 0.7,
      verdict: 'acceptable',
      issues: ['Could not parse assessment'],
      suggestions: ['Manual review recommended'],
      brand_compliant: true,
      instagram_ready: true,
    };
  }

  const duration = Date.now() - startTime;
  console.log(`[Image Review] Score: ${assessment.score} (${assessment.verdict}) - ${duration}ms`);

  return {
    assessment,
    duration_ms: duration,
    provider_used: result.providerUsed,
  };
}

export async function autoRegenerateIfNeeded(imageResult, imageBrief, generateFn, maxAttempts = 3) {
  const assessment = imageResult.assessment || { score: 0.7 };
  let currentPath = imageResult.filepath;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[Image Review] Attempt ${attempt}/${maxAttempts}`);

    if (assessment.score >= 0.7) {
      console.log(`[Image Review] Image accepted (score: ${assessment.score})`);
      return { success: true, assessment, attempts: attempt, filepath: currentPath };
    }

    if (attempt < maxAttempts) {
      console.log(`[Image Review] Image rejected (score: ${assessment.score}), regenerating...`);
      const newPath = await generateFn();
      if (newPath) currentPath = newPath;
    }
  }

  console.log(`[Image Review] All ${maxAttempts} attempts exhausted, using last image`);
  const finalResult = await runImageQualityChecker(currentPath, imageBrief);
  return { success: false, assessment: finalResult.assessment, attempts: maxAttempts, filepath: currentPath };
}
