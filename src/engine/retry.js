import { sleep } from '../utils/helpers.js';

export const RETRY_CONFIG = {
  leader:   { maxRetries: 3, baseDelay: 5000 },
  idea:     { maxRetries: 2, baseDelay: 3000 },
  script:   { maxRetries: 3, baseDelay: 5000 },
  image:    { maxRetries: 2, baseDelay: 10000 },
  caption:  { maxRetries: 2, baseDelay: 3000 },
  publish:  { maxRetries: 3, baseDelay: 30000 },
  analysis: { maxRetries: 2, baseDelay: 10000 },
};

const AUTH_ERROR_KEYWORDS = [
  'access token', 'session has expired', 'token expired', 'invalid token',
  'invalid oauth', 'not authorized', 'permission denied',
];

function isAuthError(error) {
  const msg = (error.message || '').toLowerCase();
  if (AUTH_ERROR_KEYWORDS.some(k => msg.includes(k))) return true;
  const apiError = error.response?.data?.error;
  if (apiError) {
    const apiMsg = (apiError.message || '').toLowerCase();
    if (AUTH_ERROR_KEYWORDS.some(k => apiMsg.includes(k))) return true;
    if (apiError.code === 190 || apiError.code === 401) return true;
  }
  if (error.status === 401 || error.response?.status === 401) return true;
  return false;
}

export async function withRetry(fn, agentName, options = {}) {
  const config = RETRY_CONFIG[agentName] || { maxRetries: 2, baseDelay: 5000 };
  const maxRetries = options.maxRetries ?? config.maxRetries;
  const baseDelay = options.baseDelay ?? config.baseDelay;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      if (isAuthError(error)) {
        console.warn(`[Retry ${agentName}] Auth error detected — throwing immediately: ${error.message}`);
        throw error;
      }

      if (error.status === 429 || error.response?.status === 429) {
        const retryAfter = parseInt(
          error.headers?.['retry-after']
          || error.response?.headers?.['retry-after']
          || '60'
        );
        console.warn(`[Retry ${agentName}] Rate limited (attempt ${attempt}/${maxRetries}), waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (attempt === maxRetries) break;

      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
      console.warn(`[Retry ${agentName}] Attempt ${attempt}/${maxRetries} failed. Retrying in ${Math.round(delay)}ms...`);
      console.warn(`  Error: ${error.message}`);
      await sleep(delay);
    }
  }

  throw lastError;
}
