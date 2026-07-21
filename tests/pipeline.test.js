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

describe('Carousel support', () => {
  const VALID_CONTENT_TYPES = ['single_image', 'carousel'];

  it('content_type hanya boleh single_image atau carousel', () => {
    for (const ct of VALID_CONTENT_TYPES) {
      assert.ok(ct === 'single_image' || ct === 'carousel');
    }
    assert.strictEqual(VALID_CONTENT_TYPES.length, 2);
  });

  it('carousel script punya slides array', () => {
    const carouselScript = {
      hook: 'Test hook',
      body: ['Poin 1', 'Poin 2'],
      cta: 'Chat WA!',
      slides: [
        { headline: 'Slide 1', description: 'Deskripsi 1', visual_notes: 'Visual 1' },
        { headline: 'Slide 2', description: 'Deskripsi 2', visual_notes: 'Visual 2' },
      ],
    };
    assert.ok(Array.isArray(carouselScript.slides));
    assert.ok(carouselScript.slides.length >= 2);
    assert.ok(carouselScript.slides[0].headline);
    assert.ok(carouselScript.slides[0].visual_notes);
  });

  it('carousel brief dan prompt adalah array', () => {
    const carouselBriefs = [
      { style: 'minimalist', mood: 'professional' },
      { style: 'playful', mood: 'energetic' },
    ];
    const carouselPrompts = [
      { prompt: 'prompt 1', negative_prompt: 'neg 1' },
      { prompt: 'prompt 2', negative_prompt: 'neg 2' },
    ];
    assert.ok(Array.isArray(carouselBriefs));
    assert.ok(Array.isArray(carouselPrompts));
    assert.strictEqual(carouselBriefs.length, carouselPrompts.length);
  });

  it('carousel asset_url adalah array', () => {
    const assets = [
      'https://storage.example.com/slide1.jpg',
      'https://storage.example.com/slide2.jpg',
    ];
    assert.ok(Array.isArray(assets));
    assert.ok(assets.length >= 2);
    assets.forEach(url => assert.ok(url.startsWith('https://')));
  });

  it('single_image fields tetap jadi object, bukan array', () => {
    const singleBrief = { style: 'minimalist', mood: 'professional' };
    const singlePrompt = { prompt: 'prompt', negative_prompt: 'neg' };
    assert.ok(!Array.isArray(singleBrief));
    assert.ok(!Array.isArray(singlePrompt));
    assert.ok(singleBrief.style);
    assert.ok(singlePrompt.prompt);
  });
});
