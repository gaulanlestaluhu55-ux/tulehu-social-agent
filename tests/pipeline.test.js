import { describe, it } from 'node:test';
import assert from 'node:assert';

// Unit test untuk pipeline state machine v2.0

describe('Pipeline states (v2.0)', () => {
  const VALID_STATUSES = [
    'draft',
    'idea_ready',
    'script_ready',
    'visual_uploaded',
    'caption_ready',
    'scheduled',
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
    const draftIdx = VALID_STATUSES.indexOf('draft');
    const publishedIdx = VALID_STATUSES.indexOf('published');
    const failedIdx = VALID_STATUSES.indexOf('failed');

    assert.ok(draftIdx >= 0);
    assert.ok(publishedIdx > draftIdx, 'published harus setelah draft');
    assert.ok(failedIdx > draftIdx, 'failed hanya setelah ada aktivitas');
  });

  it('tidak ada status approval lama', () => {
    const oldStatuses = [
      'awaiting_script_approval',
      'script_approved',
      'awaiting_asset',
      'generating_asset',
      'awaiting_final_approval',
      'approved',
    ];
    for (const s of oldStatuses) {
      assert.ok(!VALID_STATUSES.includes(s), `Status lama "${s}" tidak boleh ada di v2.0`);
    }
  });
});
