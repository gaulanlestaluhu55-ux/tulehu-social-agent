/**
 * Parsing balasan bebas teks dari Gaulan.
 * Support: "approve", "revisi: ...", "skip", "status", "tolak", "pause", "resume"
 */
export function parseReply(text) {
  const lower = text.toLowerCase().trim();
  
  if (['approve', 'ok', 'oke', 'lanjut', 'posting', 'publish'].includes(lower)) {
    return { action: 'approve' };
  }
  
  if (['skip', 'tolak', 'batal', 'cancel'].includes(lower)) {
    return { action: 'skip' };
  }
  
  if (['status', 'progress', 'cek'].includes(lower)) {
    return { action: 'status' };
  }
  
  if (['jadwal', 'schedule'].includes(lower)) {
    return { action: 'schedule' };
  }
  
  if (['pause', 'stop'].includes(lower)) {
    return { action: 'pause' };
  }
  
  if (['resume', 'lanjutkan'].includes(lower)) {
    return { action: 'resume' };
  }
  
  if (lower.startsWith('revisi') || lower.startsWith('revisi:')) {
    const note = lower.replace(/^revisi\s*:?\s*/, '').trim();
    return { action: 'revise', note };
  }
  
  return { action: 'unknown', message: text };
}
