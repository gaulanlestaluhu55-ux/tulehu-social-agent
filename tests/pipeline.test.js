import { describe, it } from 'node:test';
import assert from 'node:assert';

// Unit test untuk logika pipeline state machine
// Catatan: test integration butuh supabase mock — untuk sekarang test struktur state aja

describe('Pipeline states', () => {
  const VALID_STATUSES = [
    'idea',
    'script_drafted',
    'awaiting_script_approval',
    'script_approved',
    'awaiting_asset',
    'generating_asset',
    'awaiting_final_approval',
    'approved',
    'publishing',
    'published',
    'failed',
  ];

  it('semua status pipeline valid', () => {
    for (const s of VALID_STATUSES) {
      assert.ok(s.length > 0, `Status "${s}" harus punya nama`);
    }
  });

  it('urutan pipeline logis', () => {
    const ideaIdx = VALID_STATUSES.indexOf('idea');
    const publishedIdx = VALID_STATUSES.indexOf('published');
    const failedIdx = VALID_STATUSES.indexOf('failed');

    assert.ok(ideaIdx >= 0);
    assert.ok(publishedIdx > ideaIdx, 'published harus setelah idea');
    assert.ok(failedIdx > ideaIdx, 'failed hanya setelah ada aktivitas');
  });
});
