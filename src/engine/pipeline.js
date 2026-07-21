import { updatePipelineStatus, getPipelineById } from '../db/supabase.js';
import { runIdeaAgent } from '../agents/idea.js';
import { runScriptAgent } from '../agents/script.js';
import { runCaptionAgent } from '../agents/caption.js';
import { runImageBriefAgent } from '../agents/image-brief.js';
import { runPromptOptimizer } from '../agents/prompt-optimizer.js';
import { validateScript, validateCaption } from '../agents/validator.js';
import { PIPELINE_STATUS } from '../config.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../db/supabase.js';

/**
 * Create a new content slot.
 * @param {string} calendarDate - YYYY-MM-DD
 * @param {string} scheduledTime - HH:MM (optional, can be set later)
 * @param {string} pillarName - free text pillar name
 * @returns {object} created pipeline row
 */
export async function createSlot(calendarDate, scheduledTime, pillarName, contentType = 'single_image') {
  const { data, error } = await supabase
    .from('content_pipeline')
    .insert({
      calendar_date: calendarDate,
      scheduled_time: scheduledTime || null,
      pillar_name: pillarName,
      content_type: contentType,
      status: PIPELINE_STATUS.DRAFT,
    })
    .select()
    .single();

  if (error) throw new Error(`Gagal buat slot: ${error.message}`);
  logger.info(`[Pipeline] Slot created: ${data.id} for ${calendarDate}`);
  return data;
}

/**
 * Generate 3-5 idea options for a slot.
 * @param {string} pipelineId
 * @returns {object[]} array of idea options
 */
export async function generateIdeaForSlot(pipelineId) {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

  logger.info(`[Pipeline] Generating ideas for slot ${pipelineId}...`);

  const ideas = await runIdeaAgent(pipeline);

  await updatePipelineStatus(pipelineId, PIPELINE_STATUS.IDEA_READY, {
    idea_options: ideas,
  });

  logger.info(`[Pipeline] ${ideas.length} ideas generated`);
  return ideas;
}

/**
 * Select an idea from the options.
 * @param {string} pipelineId
 * @param {number} selectedIndex - index of selected idea (0-based)
 */
export async function selectIdea(pipelineId, selectedIndex) {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);
  if (!pipeline.idea_options || !pipeline.idea_options[selectedIndex]) {
    throw new Error(`Invalid idea index: ${selectedIndex}`);
  }

  const selectedIdea = pipeline.idea_options[selectedIndex];
  await updatePipelineStatus(pipelineId, PIPELINE_STATUS.IDEA_READY, {
    idea_selected_index: selectedIndex,
    idea_content: selectedIdea,
  });

  logger.info(`[Pipeline] Idea ${selectedIndex} selected for ${pipelineId}`);
}

/**
 * Generate script for a slot.
 * @param {string} pipelineId
 * @returns {object} script content {hook, body, cta}
 */
export async function generateScriptForSlot(pipelineId) {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);
  if (!pipeline.idea_content) {
    if (pipeline.idea_options && pipeline.idea_selected_index != null) {
      pipeline.idea_content = pipeline.idea_options[pipeline.idea_selected_index];
    } else {
      throw new Error('Pilih ide terlebih dahulu sebelum generate script');
    }
  }

  logger.info(`[Pipeline] Generating script for slot ${pipelineId}...`);

  const scriptContent = await runScriptAgent(pipeline);

  // Validate script quality
  const validation = await validateScript(scriptContent);
  logger.info(`[Pipeline] Script validation: ${validation.score} (${validation.valid ? 'PASS' : 'FAIL'})`);

  await updatePipelineStatus(pipelineId, PIPELINE_STATUS.SCRIPT_READY, {
    script_content: scriptContent,
  });

  return { scriptContent, validation };
}

/**
 * Update script with manual edits.
 * @param {string} pipelineId
 * @param {object} editedScript - {hook, body, cta}
 */
export async function updateScript(pipelineId, editedScript) {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

  await updatePipelineStatus(pipelineId, PIPELINE_STATUS.SCRIPT_READY, {
    script_content: editedScript,
  });

  logger.info(`[Pipeline] Script updated for ${pipelineId}`);
}

/**
 * Generate visual brief + optimized prompt (reference only, no image generation).
 * @param {string} pipelineId
 * @returns {object} {imageBrief, optimizedPrompt}
 */
export async function generateVisualBrief(pipelineId) {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);
  if (!pipeline.script_content) throw new Error('Generate script terlebih dahulu');

  const isCarousel = pipeline.content_type === 'carousel';
  logger.info(`[Pipeline] Generating visual brief for slot ${pipelineId} (${isCarousel ? 'carousel' : 'single'})...`);

  if (isCarousel && pipeline.script_content.slides) {
    const briefs = [];
    const prompts = [];

    for (let i = 0; i < pipeline.script_content.slides.length; i++) {
      const slide = pipeline.script_content.slides[i];
      logger.info(`[Pipeline] Brief for slide ${i + 1}/${pipeline.script_content.slides.length}: ${slide.headline}`);

      const imageBriefResult = await runImageBriefAgent(pipeline, pipeline.script_content, slide);
      briefs.push(imageBriefResult.brief);

      const promptOptResult = await runPromptOptimizer(imageBriefResult.brief, pipeline.campaign_plan, i);
      prompts.push(promptOptResult.optimized);
    }

    await updatePipelineStatus(pipelineId, pipeline.status, {
      image_brief: briefs,
      optimized_prompt: prompts,
    });

    logger.info(`[Pipeline] ${briefs.length} carousel briefs ready`);
    return { imageBriefs: briefs, optimizedPrompts: prompts };
  } else {
    const imageBriefResult = await runImageBriefAgent(pipeline, pipeline.script_content);
    const imageBrief = imageBriefResult.brief;

    const promptOptResult = await runPromptOptimizer(imageBrief, pipeline.campaign_plan);
    const optimizedPrompt = promptOptResult.optimized;

    await updatePipelineStatus(pipelineId, pipeline.status, {
      image_brief: imageBrief,
      optimized_prompt: optimizedPrompt,
    });

    logger.info(`[Pipeline] Visual brief ready: ${imageBrief.style}, ${imageBrief.mood}`);
    return { imageBrief, optimizedPrompt };
  }
}

/**
 * Upload visual to Supabase Storage.
 * @param {string} pipelineId
 * @param {Buffer} fileBuffer - image buffer
 * @param {string} filename - original filename
 * @returns {string} public URL
 */
export async function uploadVisual(pipelineId, fileBuffer, filename, slideIndex = null) {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

  const isCarousel = pipeline.content_type === 'carousel';
  const slidePath = isCarousel && slideIndex !== null ? `slide-${slideIndex}` : '';
  const safeFilename = `${pipelineId}/${slidePath ? slidePath + '/' : ''}${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

  const { error: uploadError } = await supabase.storage
    .from('content-assets')
    .upload(safeFilename, fileBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (uploadError) throw new Error(`Upload gagal: ${uploadError.message}`);

  const { data: urlData } = supabase.storage
    .from('content-assets')
    .getPublicUrl(safeFilename);

  const publicUrl = urlData.publicUrl;

  if (isCarousel && slideIndex !== null) {
    const currentAssets = Array.isArray(pipeline.asset_url) ? [...pipeline.asset_url] : [];
    currentAssets[slideIndex] = publicUrl;
    await updatePipelineStatus(pipelineId, pipeline.status, {
      asset_url: currentAssets,
      asset_type: 'image/jpeg',
    });
    logger.info(`[Pipeline] Carousel slide ${slideIndex} uploaded: ${publicUrl}`);
  } else {
    await updatePipelineStatus(pipelineId, PIPELINE_STATUS.VISUAL_UPLOADED, {
      asset_url: publicUrl,
      asset_type: 'image/jpeg',
    });
    logger.info(`[Pipeline] Visual uploaded: ${publicUrl}`);
  }

  return publicUrl;
}

/**
 * Generate caption for a slot.
 * @param {string} pipelineId
 * @returns {object} {caption, hashtags, validation}
 */
export async function generateCaptionForSlot(pipelineId) {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

  logger.info(`[Pipeline] Generating caption for slot ${pipelineId}...`);

  let captionResult = await runCaptionAgent(pipeline, pipeline.script_content);

  // Validate caption quality
  let validation = await validateCaption(captionResult);
  logger.info(`[Pipeline] Caption validation: ${validation.score} (${validation.valid ? 'PASS' : 'FAIL'})`);

  // Auto-regenerate once if score < 0.5
  if (!validation.valid && validation.score < 0.5) {
    logger.warn(`[Pipeline] Caption too weak (${validation.score}), regenerating once...`);
    captionResult = await runCaptionAgent(pipeline, pipeline.script_content);
    validation = await validateCaption(captionResult);
    logger.info(`[Pipeline] Caption re-validation: ${validation.score}`);
  }

  await updatePipelineStatus(pipelineId, PIPELINE_STATUS.CAPTION_READY, {
    caption_content: captionResult.caption,
    hashtags: captionResult.hashtags,
  });

  return { ...captionResult, validation };
}

/**
 * Update caption with manual edits.
 * @param {string} pipelineId
 * @param {string} editedCaption
 * @param {string[]} editedHashtags
 */
export async function updateCaption(pipelineId, editedCaption, editedHashtags) {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

  await updatePipelineStatus(pipelineId, PIPELINE_STATUS.CAPTION_READY, {
    caption_content: editedCaption,
    hashtags: editedHashtags,
  });

  logger.info(`[Pipeline] Caption updated for ${pipelineId}`);
}

/**
 * Schedule a slot for publishing.
 * @param {string} pipelineId
 * @param {string} scheduledAt - ISO datetime string
 */
export async function scheduleSlot(pipelineId, scheduledAt) {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

  const isCarousel = pipeline.content_type === 'carousel';

  // Insert into publish_queue
  const { error: queueError } = await supabase
    .from('publish_queue')
    .insert({
      pipeline_id: pipelineId,
      platform: 'instagram',
      status: 'pending',
      caption_content: pipeline.caption_content,
      hashtags: pipeline.hashtags,
      asset_url: isCarousel ? (Array.isArray(pipeline.asset_url) ? pipeline.asset_url[0] : null) : pipeline.asset_url,
      asset_urls: isCarousel ? pipeline.asset_url : null,
      asset_type: pipeline.asset_type,
      content_type: pipeline.content_type,
      scheduled_at: scheduledAt,
    });

  if (queueError) throw new Error(`Gagal schedule: ${queueError.message}`);

  await updatePipelineStatus(pipelineId, PIPELINE_STATUS.SCHEDULED);

  logger.info(`[Pipeline] Slot ${pipelineId} scheduled for ${scheduledAt}`);
}

/**
 * Get slot detail with all related data.
 * @param {string} pipelineId
 * @returns {object} full pipeline row
 */
export async function getSlotDetail(pipelineId) {
  return getPipelineById(pipelineId);
}

/**
 * List slots within a date range.
 * @param {string} from - YYYY-MM-DD
 * @param {string} to - YYYY-MM-DD
 * @returns {object[]} array of pipeline rows
 */
export async function listSlots(from, to) {
  const { data, error } = await supabase
    .from('content_pipeline')
    .select('*')
    .gte('calendar_date', from)
    .lte('calendar_date', to)
    .order('calendar_date', { ascending: true });

  if (error) throw new Error(`Gagal list slots: ${error.message}`);
  return data || [];
}
