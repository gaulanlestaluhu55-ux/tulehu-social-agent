import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { withRetry, RETRY_CONFIG } from '../src/engine/retry.js';

describe('withRetry', () => {
  it('sukses di percobaan pertama', async () => {
    const fn = mock.fn(async () => 'ok');
    const result = await withRetry(fn, 'idea');
    assert.strictEqual(result, 'ok');
    assert.strictEqual(fn.mock.callCount(), 1);
  });

  it('retry sampai maxRetries lalu throw', async () => {
    const err = new Error('fail');
    const fn = mock.fn(async () => { throw err; });
    await assert.rejects(async () => {
      await withRetry(fn, 'idea', { baseDelay: 10 });
    }, /fail/);
    assert.strictEqual(fn.mock.callCount(), RETRY_CONFIG.idea.maxRetries);
  });

  it('sukses setelah retry', async () => {
    let attempt = 0;
    const fn = mock.fn(async () => {
      attempt++;
      if (attempt < 3) throw new Error('not yet');
      return 'ok';
    });
    const result = await withRetry(fn, 'script', { baseDelay: 10 });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(attempt, 3);
  });

  it('rate limit 429 — retry with Retry-After', async () => {
    let attempt = 0;
    const fn = mock.fn(async () => {
      attempt++;
      if (attempt === 1) {
        const err = new Error('rate limited');
        err.status = 429;
        err.headers = { 'retry-after': '1' };
        throw err;
      }
      return 'ok';
    });
    const result = await withRetry(fn, 'publish', { baseDelay: 10 });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(attempt, 2);
  });
});
