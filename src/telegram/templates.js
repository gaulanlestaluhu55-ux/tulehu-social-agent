import { escapeMarkdown } from '../utils/helpers.js';

function parseCaptionContent(captionContent) {
  if (!captionContent) return { text: '', hashtags: [] };
  
  // If it's already an object
  if (typeof captionContent === 'object') {
    return {
      text: captionContent.caption || captionContent.text || '',
      hashtags: captionContent.hashtags || [],
    };
  }
  
  // Try to parse JSON string
  try {
    const parsed = JSON.parse(captionContent);
    return {
      text: parsed.caption || parsed.text || captionContent,
      hashtags: parsed.hashtags || [],
    };
  } catch {
    // Not JSON, use as plain text
    return { text: captionContent, hashtags: [] };
  }
}

export function scriptApprovalTemplate(pipeline, scriptContent) {
  const bodyText = Array.isArray(scriptContent.body)
    ? scriptContent.body.map((b, i) => `${i + 1}. ${escapeMarkdown(b)}`).join('\n')
    : escapeMarkdown(scriptContent.body);

  return `📝 *Naskah Konten — ${escapeMarkdown(pipeline.pillar_name)}*
*Hari/Tanggal:* ${pipeline.calendar_date}
*Ide:* ${escapeMarkdown(pipeline.idea_content?.angle || '-')}

*HOOK:*
${escapeMarkdown(scriptContent.hook)}

*ISI:*
${bodyText}

*CTA:*
${escapeMarkdown(scriptContent.cta)}

*Jenis Visual:* ${pipeline.needs_real_photo ? '📸 Foto asli \\(diminta dari Anda\\)' : '🎨 AI\\-generated'}

━━━━━━━━━━━━━━━━━━
Balas *"approve"* untuk lanjut ke pembuatan visual\.
Balas *"revisi: \\[pesan\\]"* untuk minta perbaikan\.
━━━━━━━━━━━━━━━━━━`;
}

export function finalApprovalTemplate(pipeline, captionContent) {
  const { text, hashtags } = parseCaptionContent(captionContent);
  const hashtagStr = hashtags.length > 0 ? '\n\n' + hashtags.map(h => `#${h}`).join(' ') : '';

  return `🖼 *Preview Final — ${escapeMarkdown(pipeline.idea_content?.angle || 'Konten')}*

*Caption:*
${escapeMarkdown(text)}${hashtagStr}

━━━━━━━━━━━━━━━━━━━
Balas *"approve"* untuk langsung publish ke Instagram\.
Balas *"revisi: \\[pesan\\]"* untuk minta perbaikan\.
Balas *"posting"* untuk langsung publish\.
━━━━━━━━━━━━━━━━━━━`;
}

export function requestPhotoTemplate(pipeline) {
  return `📸 *Butuh Foto untuk Konten*
Hari ini jadwalnya: *${escapeMarkdown(pipeline.pillar_name)}*

Saya butuh foto:
\\- *Subjek:* ${escapeMarkdown(pipeline.idea_content?.description || 'foto produk atau proses produksi')}
\\- *Jumlah:* 1\\-2 foto
\\- *Tips:* Usahakan lighting cukup, resolusi tinggi

Kirim foto langsung di chat ini\.
Pipeline akan pause sampai foto diterima ⏸️`;
}

export function publishConfirmationTemplate(result) {
  return `✅ *Konten Terposting\\!*
📱 *Instagram*
🔗 ${result.permalink || 'Link akan muncul setelah publish'}
🕐 Diposting: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' })}
━━━━━━━━━━━━━━━━━━
Kalau ada yang perlu diubah, bilang aja\\!`;
}

export function errorTemplate(errorMessage) {
  return `❌ *Error\\!*
${escapeMarkdown(errorMessage)}

Pipeline berhenti\. Cek log untuk detail\.`;
}

export function statusTemplate(pipeline) {
  const statusEmoji = {
    draft: '📝',
    idea_ready: '💡',
    script_ready: '✍️',
    visual_uploaded: '🖼️',
    caption_ready: '📝',
    scheduled: '📅',
    publishing: '📤',
    published: '✅',
    failed: '❌',
  };

  return `📊 *Status Pipeline — ${pipeline.calendar_date}*

*Pilar:* ${escapeMarkdown(pipeline.pillar_name)}
*Status:* ${statusEmoji[pipeline.status] || '❓'} *${pipeline.status.replace(/_/g, ' ')}*
*Ide:* ${escapeMarkdown(pipeline.idea_content?.angle || '-')}`;
}

export function scheduleTemplate(schedule) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  let text = '📅 *Jadwal Konten Minggu Ini*\n\n';

  for (const item of schedule) {
    text += `*${days[item.day_of_week]}:* ${escapeMarkdown(item.pillar_name)}`;
    if (item.priority_override) text += ` _\\(→ ${escapeMarkdown(item.priority_override)}\\)_`;
    text += '\n';
  }

  return text;
}
