export function needsVisualRecheck(content) {
  const baseColor = String(content?.base_color || '').trim().toLowerCase();
  const visibleText = String(content?.visible_text || '').trim();
  return !baseColor || !['putih', 'hitam'].some(c => baseColor.includes(c)) || !visibleText;
}
