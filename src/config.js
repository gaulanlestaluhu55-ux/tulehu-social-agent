import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN wajib diisi'),
  TELEGRAM_OWNER_CHAT_ID: z.string().min(1, 'TELEGRAM_OWNER_CHAT_ID wajib diisi'),

  // Supabase
  SUPABASE_URL: z.string().url('SUPABASE_URL harus URL valid'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY wajib diisi'),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().optional().default(''),
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3.1-70b-instruct:free'),

  // opencode
  OPENCODE_API_KEY: z.string().optional().default(''),
  OPENCODE_MODEL: z.string().default('deepseek-v4-flash'),

  // Gemini (Google AI — free tier)
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  // Groq
  GROQ_API_KEY: z.string().optional().default(''),
  GROQ_MODEL: z.string().default('llama-3.1-70b-versatile'),

  // Cloudflare Workers AI
  CLOUDFLARE_ACCOUNT_ID: z.string().optional().default(''),
  CLOUDFLARE_API_TOKEN: z.string().optional().default(''),
  CLOUDFLARE_AI_MODEL: z.string().default('@cf/stabilityai/stable-diffusion-xl-base-1.0'),

  // Instagram Graph API
  IG_USER_ID: z.string().min(1, 'IG_USER_ID wajib diisi'),
  IG_ACCESS_TOKEN: z.string().min(1, 'IG_ACCESS_TOKEN wajib diisi'),
  IG_APP_ID: z.string().optional().default(''),
  IG_APP_SECRET: z.string().optional().default(''),

  // Pipeline
  CUTOFF_HOUR: z.coerce.number().min(0).max(23).default(18),
  RECHECK_INTERVAL_MINUTES: z.coerce.number().min(5).default(30),
  MAX_RECHECKS: z.coerce.number().min(1).max(10).default(4),
  DAILY_PUBLISH_CRON: z.string().default('0 9 * * *'),
  WEEKLY_ANALYSIS_CRON: z.string().default('0 20 * * 0'),
  AUTO_CONFIRM_TIMEOUT_MINUTES: z.coerce.number().min(10).default(120),

  // Auto-mode: full_auto = skip all gates, semi_auto = timeout-based fallback
  AUTO_MODE: z.enum(['full', 'semi', 'off']).default('semi'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Environment variables tidak valid:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;

// Provider priority chains
export const agentProviders = {
  leader: [
    { name: 'openrouter', model: 'meta-llama/llama-3.1-70b-instruct' },
    { name: 'groq', model: 'llama-3.3-70b-versatile' },
    { name: 'gemini', model: config.GEMINI_MODEL },
  ],
  // text agents — Gemini primary, fallback OpenRouter/Groq
  idea: [
    { name: 'gemini', model: config.GEMINI_MODEL },
    { name: 'groq', model: 'llama-3.3-70b-versatile' },
    { name: 'openrouter', model: 'meta-llama/llama-3.1-70b-instruct' },
  ],
  script: [
    { name: 'gemini', model: config.GEMINI_MODEL },
    { name: 'openrouter', model: 'meta-llama/llama-3.1-70b-instruct' },
    { name: 'groq', model: 'llama-3.3-70b-versatile' },
  ],
  caption: [
    { name: 'gemini', model: config.GEMINI_MODEL },
    { name: 'groq', model: 'llama-3.3-70b-versatile' },
    { name: 'openrouter', model: 'meta-llama/llama-3.1-70b-instruct' },
  ],
  image: [
    { name: 'cloudflare_workers', model: config.CLOUDFLARE_AI_MODEL },
  ],
  // Vision = Gemini only (butuh multimodal)
  vision: [
    { name: 'gemini', model: config.GEMINI_MODEL },
    { name: 'openrouter', model: 'nvidia/nemotron-nano-12b-v2-vl:free' },
    { name: 'openrouter', model: 'google/gemma-4-31b-it:free' },
  ],
  analysis: [
    { name: 'gemini', model: config.GEMINI_MODEL },
    { name: 'openrouter', model: 'meta-llama/llama-3.1-70b-instruct' },
    { name: 'groq', model: 'llama-3.3-70b-versatile' },
  ],
};

// Pipeline statuses
export const PIPELINE_STATUS = {
  IDEA: 'idea',
  SCRIPT_DRAFTED: 'script_drafted',
  AWAITING_SCRIPT_APPROVAL: 'awaiting_script_approval',
  SCRIPT_APPROVED: 'script_approved',
  AWAITING_ASSET: 'awaiting_asset',
  GENERATING_ASSET: 'generating_asset',
  AWAITING_FINAL_APPROVAL: 'awaiting_final_approval',
  APPROVED: 'approved',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  FAILED: 'failed',
};

// Approval keywords
export const APPROVAL_KEYWORDS = ['approve', 'ok', 'oke', 'lanjut', 'ya', 'posting', 'publish'];

// Instagram API base
export const IG_API_BASE = 'https://graph.facebook.com/v21.0';
