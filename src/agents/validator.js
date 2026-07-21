import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandProfile = JSON.parse(fs.readFileSync(path.join(__dirname, '../templates/brand-profile.json'), 'utf-8'));

const VALIDATION_RULES = {
  hook: {
    maxLength: 150,
    minLength: 10,
    bannedWords: ['kak', 'brother', 'sobat', 'teman-teman', 'halo semua'],
  },
  body: {
    minPoints: 3,
    maxPoints: 5,
    maxPointLength: 200,
  },
  cta: {
    required: true,
    validCTAs: ['chat wa di bio', 'komentar di bawah', 'share ke teman', 'dm langsung', 'link di bio'],
  },
  caption: {
    maxLength: 2200,
    minLength: 80,
    maxHashtags: 15,
    minHashtags: 5,
  },
  brandVoice: {
    maxSentences: 3,
    avoidPatterns: [/kak\s/gi, /brother/gi, /sobat/gi],
  },
};

export function validateScript(scriptContent) {
  const errors = [];
  const warnings = [];

  if (!scriptContent.hook) {
    errors.push('Hook is missing');
  } else {
    if (scriptContent.hook.length > VALIDATION_RULES.hook.maxLength) {
      errors.push(`Hook too long: ${scriptContent.hook.length} chars (max ${VALIDATION_RULES.hook.maxLength})`);
    }
    if (scriptContent.hook.length < VALIDATION_RULES.hook.minLength) {
      warnings.push(`Hook very short: ${scriptContent.hook.length} chars`);
    }
    for (const word of VALIDATION_RULES.hook.bannedWords) {
      if (scriptContent.hook.toLowerCase().includes(word)) {
        errors.push(`Hook contains banned word: "${word}"`);
      }
    }
  }

  if (!scriptContent.body || !Array.isArray(scriptContent.body)) {
    errors.push('Body is missing or not an array');
  } else {
    if (scriptContent.body.length < VALIDATION_RULES.body.minPoints) {
      errors.push(`Body too short: ${scriptContent.body.length} points (min ${VALIDATION_RULES.body.minPoints})`);
    }
    if (scriptContent.body.length > VALIDATION_RULES.body.maxPoints) {
      warnings.push(`Body long: ${scriptContent.body.length} points`);
    }
    for (let i = 0; i < scriptContent.body.length; i++) {
      if (scriptContent.body[i].length > VALIDATION_RULES.body.maxPointLength) {
        warnings.push(`Body point ${i + 1} too long: ${scriptContent.body[i].length} chars`);
      }
    }
  }

  if (!scriptContent.cta) {
    errors.push('CTA is missing');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    score: Math.max(0, 1 - (errors.length * 0.2) - (warnings.length * 0.05)),
  };
}

export function validateCaption(captionContent) {
  const errors = [];
  const warnings = [];

  if (!captionContent.caption) {
    errors.push('Caption text is missing');
  } else {
    if (captionContent.caption.length > VALIDATION_RULES.caption.maxLength) {
      errors.push(`Caption too long: ${captionContent.caption.length} chars (max ${VALIDATION_RULES.caption.maxLength})`);
    }
    if (captionContent.caption.length < VALIDATION_RULES.caption.minLength) {
      warnings.push(`Caption short: ${captionContent.caption.length} chars`);
    }
    for (const pattern of VALIDATION_RULES.brandVoice.avoidPatterns) {
      if (pattern.test(captionContent.caption)) {
        errors.push(`Caption contains brand voice violation: ${pattern.source}`);
      }
    }
  }

  if (captionContent.hashtags) {
    if (captionContent.hashtags.length > VALIDATION_RULES.caption.maxHashtags) {
      warnings.push(`Too many hashtags: ${captionContent.hashtags.length} (max ${VALIDATION_RULES.caption.maxHashtags})`);
    }
    if (captionContent.hashtags.length < VALIDATION_RULES.caption.minHashtags) {
      warnings.push(`Too few hashtags: ${captionContent.hashtags.length} (min ${VALIDATION_RULES.caption.minHashtags})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    score: Math.max(0, 1 - (errors.length * 0.2) - (warnings.length * 0.05)),
  };
}

export function validateImageBrief(brief) {
  const errors = [];
  const warnings = [];

  const required = ['style', 'lighting', 'composition', 'aspect', 'brand_color', 'subject'];
  for (const field of required) {
    if (!brief[field]) {
      errors.push(`Image brief missing required field: ${field}`);
    }
  }

  if (brief.aspect && !['4:5', '1:1', '16:9'].includes(brief.aspect)) {
    warnings.push(`Non-standard aspect ratio: ${brief.aspect}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    score: Math.max(0, 1 - (errors.length * 0.25) - (warnings.length * 0.05)),
  };
}

export function validateCampaignPlan(plan) {
  const errors = [];
  const warnings = [];

  if (!plan.pillar) errors.push('Campaign pillar is missing');
  if (!plan.objective) errors.push('Campaign objective is missing');
  if (!plan.format) errors.push('Campaign format is missing');
  if (!plan.target_platforms || plan.target_platforms.length === 0) {
    errors.push('No target platforms specified');
  }

  const validObjectives = ['edu', 'product', 'bts', 'promo', 'testimonial', 'interactive'];
  if (plan.objective && !validObjectives.includes(plan.objective)) {
    errors.push(`Invalid objective: ${plan.objective}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    score: Math.max(0, 1 - (errors.length * 0.25) - (warnings.length * 0.05)),
  };
}

export function validateFullPipeline(pipeline) {
  const results = {
    campaign: pipeline.campaign_plan ? validateCampaignPlan(pipeline.campaign_plan) : null,
    script: pipeline.script_content ? validateScript(pipeline.script_content) : null,
    caption: pipeline.caption_content ? validateCaption({ caption: pipeline.caption_content, hashtags: pipeline.hashtags }) : null,
    imageBrief: pipeline.image_brief ? validateImageBrief(pipeline.image_brief) : null,
  };

  const allValid = Object.values(results).every(r => r === null || r.valid);
  const totalErrors = Object.values(results).reduce((sum, r) => sum + (r?.errors?.length || 0), 0);
  const totalWarnings = Object.values(results).reduce((sum, r) => sum + (r?.warnings?.length || 0), 0);

  return {
    valid: allValid,
    results,
    summary: {
      totalErrors,
      totalWarnings,
      overallScore: Object.values(results)
        .filter(r => r !== null)
        .reduce((sum, r) => sum + r.score, 0) / Object.values(results).filter(r => r !== null).length || 0,
    },
  };
}
