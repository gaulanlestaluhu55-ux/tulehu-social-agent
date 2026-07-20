import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseReply } from '../src/utils/parser.js';

describe('parseReply', () => {
  it('approve — berbagai varian', () => {
    assert.strictEqual(parseReply('approve').action, 'approve');
    assert.strictEqual(parseReply('APPROVE').action, 'approve');
    assert.strictEqual(parseReply('ok').action, 'approve');
    assert.strictEqual(parseReply('oke').action, 'approve');
    assert.strictEqual(parseReply('lanjut').action, 'approve');
    assert.strictEqual(parseReply('posting').action, 'approve');
    assert.strictEqual(parseReply('publish').action, 'approve');
  });

  it('skip — berbagai varian', () => {
    assert.strictEqual(parseReply('skip').action, 'skip');
    assert.strictEqual(parseReply('tolak').action, 'skip');
    assert.strictEqual(parseReply('batal').action, 'skip');
    assert.strictEqual(parseReply('cancel').action, 'skip');
  });

  it('status — berbagai varian', () => {
    assert.strictEqual(parseReply('status').action, 'status');
    assert.strictEqual(parseReply('progress').action, 'status');
    assert.strictEqual(parseReply('cek').action, 'status');
  });

  it('jadwal', () => {
    assert.strictEqual(parseReply('jadwal').action, 'schedule');
    assert.strictEqual(parseReply('schedule').action, 'schedule');
  });

  it('pause / resume', () => {
    assert.strictEqual(parseReply('pause').action, 'pause');
    assert.strictEqual(parseReply('stop').action, 'pause');
    assert.strictEqual(parseReply('resume').action, 'resume');
    assert.strictEqual(parseReply('lanjutkan').action, 'resume');
  });

  it('revisi', () => {
    const r1 = parseReply('revisi: ganti hook');
    assert.strictEqual(r1.action, 'revise');
    assert.strictEqual(r1.note, 'ganti hook');

    const r2 = parseReply('revisi:lebih panjang');
    assert.strictEqual(r2.action, 'revise');
    assert.strictEqual(r2.note, 'lebih panjang');
  });

  it('unknown', () => {
    const r = parseReply('halo');
    assert.strictEqual(r.action, 'unknown');
    assert.strictEqual(r.message, 'halo');
  });
});
