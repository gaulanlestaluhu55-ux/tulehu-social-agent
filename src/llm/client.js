import OpenAI from 'openai';
import { config } from '../config.js';

/**
 * Generic LLM client — OpenAI-compatible interface.
 * Support: OpenRouter, Ollama, Groq, opencode
 */
const clients = {};

function getClient(provider, apiKey, baseURL) {
  const key = `${provider}:${baseURL}`;
  if (!clients[key]) {
    clients[key] = new OpenAI({
      apiKey,
      baseURL,
    });
  }
  return clients[key];
}

async function rateLimitRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.status === 429 || err.message?.includes('429');
      if (!isRateLimit || i === maxRetries - 1) throw err;
      const delay = (i + 1) * 3000;
      console.warn(`[LLM] Rate limit, retry ${i + 1}/${maxRetries} in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Gemini gak support image URL — harus base64
export async function callLLM(providerName, model, messages, options = {}) {
  const providerConfigs = {
    openrouter: {
      apiKey: config.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    },
    groq: {
      apiKey: config.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    },
    gemini: {
      apiKey: config.GEMINI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
    opencode: {
      apiKey: config.OPENCODE_API_KEY,
      baseURL: 'https://api.opencode.ai/v1',
    },
  };

  const provider = providerConfigs[providerName];
  if (!provider) throw new Error(`Provider tidak dikenal: ${providerName}`);

  // Gemini vision → pake native API (OpenAI-compatible gak support image)
  if (providerName === 'gemini' && messages.some(m => Array.isArray(m.content))) {
    return callGeminiNative(model, messages, options);
  }

  const client = getClient(providerName, provider.apiKey, provider.baseURL);

  const completion = await rateLimitRetry(() => client.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
  }));

  // Safety check untuk response format yang beda-beda
  if (!completion || !completion.choices || !Array.isArray(completion.choices) || completion.choices.length === 0) {
    console.warn(`[LLM] ${providerName} response unexpected:`, JSON.stringify(completion).substring(0, 200));
    throw new Error(`Invalid response from ${providerName}`);
  }

  return {
    content: completion.choices[0]?.message?.content || '',
    usage: completion.usage,
    model: completion.model,
  };
}

// Gemini native API handler — dipake kalo ada image (OpenAI-compatible gak support)
async function callGeminiNative(model, messages, options = {}) {
  const validModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  const modelName = validModels.includes(model) ? model : 'gemini-2.5-flash';

  // Convert OpenAI message format ke Gemini native format
  const contents = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // Gemini gak support system prompt, merge ke user pertama
    const parts = [];
    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if (part.type === 'image_url' && part.image_url?.url) {
          // Convert URL → base64 kalo masih URL
          let dataUrl = part.image_url.url;
          if (dataUrl.startsWith('http')) {
            try {
              const res = await fetch(dataUrl, { headers: { 'User-Agent': 'TulehuInklineBot/1.0' } });
              const ct = res.headers.get('content-type') || 'image/jpeg';
              if (ct.startsWith('image/')) {
                const buf = Buffer.from(await res.arrayBuffer());
                dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
              }
            } catch (e) {
              console.warn('[Gemini] Gagal download image:', e.message);
              continue;
            }
          }
          // data:image/jpeg;base64,xxx → Gemini Part inlineData
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
          }
        }
      }
    }
    if (parts.length > 0) {
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
    }
  }

  // Gabung SEMUA system prompt ke user message pertama
  const sysMsgs = messages.filter(m => m.role === 'system');
  const sysText = sysMsgs.map(m => m.content).join('\n\n');
  if (sysText && contents.length > 0 && contents[0].parts[0]?.text) {
    contents[0].parts[0].text = sysText + '\n\n' + contents[0].parts[0].text;
  }

  if (contents.length === 0) throw new Error('No valid content for Gemini');

  const generationConfig = {
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: options.maxTokens ?? 2048,
    ...(options.responseFormat?.type === 'json_object' ? { responseMimeType: 'application/json' } : {}),
  };
  const body = { contents, generationConfig };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.GEMINI_API_KEY}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();

  if (!res.ok) throw new Error(`${res.status} ${data.error?.message || 'Gemini error'}`);

  return {
    content: data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '',
    usage: { prompt_tokens: data.usageMetadata?.promptTokenCount, completion_tokens: data.usageMetadata?.candidatesTokenCount },
    model: modelName,
  };
}

/**
 * Helper buat bikin multimodal message (text + image).
 * OpenAI-compatible: content berupa array of parts.
 */
export function multimodalText(text, imageUrl) {
  if (!imageUrl) return text;
  return [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: imageUrl } },
  ];
}

// Provider cooldown setelah 429 — skip provider selama X menit
const providerCooldownUntil = new Map();
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 menit

function isProviderCooledDown(providerName) {
  const until = providerCooldownUntil.get(providerName) || 0;
  return Date.now() < until;
}

function markProviderCooldown(providerName) {
  providerCooldownUntil.set(providerName, Date.now() + RATE_LIMIT_COOLDOWN_MS);
  console.warn(`[LLM] Provider ${providerName} cooldown ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
}

/**
 * Panggil LLM dengan provider failover.
 * Coba provider satu per satu sampai sukses.
 */
export async function callWithFailover(providerChain, messages, options = {}) {
  const { supabase } = await import('../db/supabase.js');
  const { updateProviderHealth } = await import('../db/supabase.js');

  let lastError;
  for (const provider of providerChain) {
    if (isProviderCooledDown(provider.name)) {
      console.warn(`[LLM] Skip ${provider.name} (masih cooldown)`);
      continue;
    }
    try {
      const result = await callLLM(provider.name, provider.model, messages, options);
      await updateProviderHealth(provider.name, { status: 'healthy', last_error: null });
      return { ...result, providerUsed: provider.name, modelUsed: provider.model };
    } catch (err) {
      lastError = err;
      const isRateLimit = err.status === 429 || err.message?.includes('429');
      console.warn(`[LLM] Provider ${provider.name} gagal: ${err.message}`);
      if (isRateLimit) markProviderCooldown(provider.name);
      await updateProviderHealth(provider.name, {
        status: isRateLimit ? 'degraded' : 'down',
        last_error: err.message?.substring(0, 200),
      });
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
  }
  throw new Error(`Semua provider gagal. Terakhir: ${lastError?.message}`);
}
