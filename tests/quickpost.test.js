import { describe, it } from 'node:test';
import assert from 'node:assert';
import { needsVisualRecheck } from '../src/utils/quickpost.js';

describe('Quick Post visual confidence', () => {
  it('passes when common base color and visible text exist', () => {
    assert.strictEqual(needsVisualRecheck({ base_color: 'hitam', visible_text: 'HATUHAHA AMARIMA' }), false);
    assert.strictEqual(needsVisualRecheck({ base_color: 'putih', visible_text: 'HATUHAHA AMARIMA' }), false);
  });

  it('requires recheck when base color or visible text is weak', () => {
    assert.strictEqual(needsVisualRecheck({ base_color: '', visible_text: 'HATUHAHA AMARIMA' }), true);
    assert.strictEqual(needsVisualRecheck({ base_color: 'gelap', visible_text: 'HATUHAHA AMARIMA' }), true);
    assert.strictEqual(needsVisualRecheck({ base_color: 'hitam', visible_text: '' }), true);
  });
});
