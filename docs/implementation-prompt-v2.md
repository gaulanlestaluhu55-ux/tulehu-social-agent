# Implementation Prompt: Tulehu Social Agent v2.0 — Dashboard Co-Pilot

## Konteks

Kamu mengerjakan pivot arsitektur besar untuk codebase Node.js/ES modules ini. Sebelumnya sistem ini otonom (cron trigger pipeline lengkap idea→publish, approval via Telegram). Sekarang jadi **dashboard co-pilot**: Gaulan (owner) generate & edit tiap aset manual lewat Next.js dashboard, cron cuma bertugas publish konten yang sudah dijadwalkan.

Baca PRD lengkapnya di `prd-tulehu-social-agent-v2.md` (satu folder dengan prompt ini) untuk konteks penuh sebelum mulai. Kerjakan urut sesuai fase di bawah — jangan loncat fase karena fase belakang bergantung pada schema/API dari fase sebelumnya.

**Catatan penting:** codebase ini mungkin sudah dapat 4 fix kualitas dari audit sebelumnya (learnings loop di script/caption, parameter image optimizer, image quality regenerate loop, validator field mismatch). Kalau fix-fix itu belum dikerjakan, dua di antaranya (parameter image optimizer, image quality regenerate loop) **jadi tidak relevan lagi** di v2.0 karena `image.js` dan `image-review.js` keluar dari jalur aktif — skip saja fix itu. Fix learnings loop (script.js, caption.js) dan validator field mismatch **tetap wajib dikerjakan**, karena agent-agent itu tetap dipakai di v2.0.

---

## Fase 1: Database Migration

Buat migration baru `src/db/migrations/007_dashboard_v2.sql`:

```sql
-- 1. Tambah kolom baru ke content_pipeline
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS scheduled_time TIME;
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS idea_options JSONB;
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS idea_selected_index INTEGER;
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS image_brief JSONB;
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS optimized_prompt JSONB;

-- 2. Tambah scheduled_at ke publish_queue
ALTER TABLE publish_queue ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_publish_queue_scheduled
  ON publish_queue(scheduled_at) WHERE status = 'pending';

-- 3. Update CHECK constraint status di content_pipeline (drop constraint lama, buat baru)
-- Cek dulu nama constraint yang ada (biasanya via \d content_pipeline di psql atau baca migration 001_init.sql),
-- lalu drop & recreate dengan value baru:
-- 'draft', 'idea_ready', 'script_ready', 'visual_uploaded', 'caption_ready',
-- 'scheduled', 'publishing', 'published', 'failed'
```

Sesuaikan detail constraint name dengan yang benar-benar ada di `001_init.sql` — baca dulu file itu sebelum bikin ALTER/DROP CONSTRAINT.

Update `src/config.js`:
```js
export const PIPELINE_STATUS = {
  DRAFT: 'draft',
  IDEA_READY: 'idea_ready',
  SCRIPT_READY: 'script_ready',
  VISUAL_UPLOADED: 'visual_uploaded',
  CAPTION_READY: 'caption_ready',
  SCHEDULED: 'scheduled',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  FAILED: 'failed',
};
```
Hapus semua referensi status lama (`AWAITING_SCRIPT_APPROVAL`, `SCRIPT_APPROVED`, `AWAITING_ASSET`, `GENERATING_ASSET`, `AWAITING_FINAL_APPROVAL`, `APPROVED`) di seluruh codebase — grep dulu semua pemakaiannya sebelum hapus biar gak ada yang keteteran.

Bikin bucket Supabase Storage baru `content-assets` (lewat migration/script terpisah atau dokumentasikan langkah manual di README kalau storage bucket gak bisa dibuat lewat SQL — biasanya perlu Supabase dashboard/API).

---

## Fase 2: Rombak `src/engine/pipeline.js`

Ganti seluruh isi file ini. Buang semua fungsi auto-chain (`startPipeline` versi lama, `resumePipeline`, `continueAfterScriptApproval`, `autoContinuePipeline`, `autoPipelineToEnd`, `fallbackPipeline`). Ganti dengan fungsi-fungsi granular yang masing-masing melakukan **satu step saja**, dipanggil dari API route:

```js
export async function createSlot(calendarDate, scheduledTime, pillarName) { /* insert content_pipeline row status=draft */ }
export async function generateIdeaForSlot(pipelineId) { /* panggil runIdeaAgent, MODIFIKASI supaya return 3-5 opsi, simpan ke idea_options, status=idea_ready */ }
export async function selectIdea(pipelineId, selectedIndex) { /* simpan idea_selected_index, siapkan idea_content dari options[index] */ }
export async function generateScriptForSlot(pipelineId) { /* panggil runScriptAgent, status=script_ready */ }
export async function updateScript(pipelineId, editedScript) { /* simpan edit-an manual Gaulan */ }
export async function generateVisualBrief(pipelineId) { /* panggil runImageBriefAgent lalu runPromptOptimizer berurutan, simpan ke image_brief & optimized_prompt, TIDAK ubah status wajib (opsional) */ }
export async function uploadVisual(pipelineId, fileBuffer, filename) { /* upload ke Supabase Storage bucket content-assets, simpan public URL ke asset_url, status=visual_uploaded */ }
export async function generateCaptionForSlot(pipelineId) { /* panggil runCaptionAgent, status=caption_ready */ }
export async function updateCaption(pipelineId, editedCaption) { /* simpan edit-an manual */ }
export async function scheduleSlot(pipelineId, scheduledAt) { /* insert row ke publish_queue dengan scheduled_at, status pipeline=scheduled */ }
```

`runIdeaAgent` di `src/agents/idea.js` perlu dimodifikasi: prompt template `idea.txt` diubah supaya minta LLM return **array 3-5 objek ide** (bukan 1 objek), format:
```json
{ "options": [ { "angle": "...", "description": "...", "visual_type": "..." }, ... 3-5 items ] }
```
Parsing di `idea.js` disesuaikan, dan fungsi ini **tidak lagi langsung `createPipelineEntry`** — pipeline entry sudah dibuat duluan lewat `createSlot`, `runIdeaAgent` sekarang cuma generate opsi dan return array-nya untuk disimpan oleh `generateIdeaForSlot`.

---

## Fase 3: Next.js Dashboard — Setup & API Routes

Kalau Next.js project belum ada di repo ini, scaffold di subfolder (mis. `dashboard/`) atau di root sesuai preferensi struktur project — pastikan `src/agents`, `src/platforms`, `src/db` tetap bisa diimport langsung dari dalam Next.js API routes (App Router: `app/api/.../route.js`), karena semuanya sudah ES modules.

API routes yang perlu dibuat (App Router, tiap route panggil fungsi dari Fase 2 langsung, return JSON):

```
POST   /api/slots                    → createSlot (bisa terima array untuk batch create banyak tanggal sekaligus)
GET    /api/slots?from=&to=          → list slot dalam range tanggal (buat /calendar view)
GET    /api/slots/:id                → detail 1 slot
POST   /api/slots/:id/idea           → generateIdeaForSlot
PUT    /api/slots/:id/idea           → selectIdea
POST   /api/slots/:id/script         → generateScriptForSlot
PUT    /api/slots/:id/script         → updateScript
POST   /api/slots/:id/visual-brief   → generateVisualBrief
POST   /api/slots/:id/visual         → uploadVisual (multipart/form-data)
POST   /api/slots/:id/caption        → generateCaptionForSlot
PUT    /api/slots/:id/caption        → updateCaption
POST   /api/slots/:id/schedule       → scheduleSlot
GET    /api/queue                    → list publish_queue (buat /queue page)
DELETE /api/queue/:id                → cancel/unschedule (kalau status masih pending)

GET    /api/analysis                 → panggil analysis.js / analytics.js langsung, return JSON
GET    /api/comments?media_id=       → panggil getComments dari platforms/instagram.js
POST   /api/comments/reply           → panggil replyToComment
GET    /api/messages                 → panggil getConversations
POST   /api/messages/send            → panggil sendMessage
GET    /api/ads                      → panggil getAdAccounts + getCampaigns
```

Untuk tiap route yang reuse fungsi Telegram existing (`getComments`, `getConversations`, dst di `platforms/instagram.js`), **jangan duplikasi logic** — import fungsi yang sama persis yang dipakai `leader.js`. Kalau ada logic formatting yang nempel di dalam fungsi platform (harusnya tidak, tapi cek), pisahkan dulu formatting Telegram-nya keluar dari fungsi data-fetching.

Frontend pages minimal (styling detail terserah kamu, ikuti design system project kalau ada):
- `/calendar` — kalender bulan/minggu, klik tanggal kosong buka form bikin slot (bisa multi-select tanggal untuk batch)
- `/slot/[id]` — workspace linear: card Idea (3-5 opsi) → form Script editable → card Visual Brief (read-only reference) → uploader Visual → form Caption editable → date/time picker + tombol Schedule
- `/queue` — tabel upcoming scheduled posts, tombol cancel
- `/analysis`, `/comments`, `/messages`, `/ads` — sesuai Section 8 PRD

---

## Fase 4: Scheduler Baru

Buat `src/scheduler/publisher-cron.js` menggantikan `src/scheduler/daily.js`:

```js
import cron from 'node-cron';
import { supabase } from '../db/supabase.js';
import { processQueueItem } from '../agents/publisher.js'; // reuse fungsi publish yang sudah ada
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export function startPublisherCron(bot) {
  const intervalCron = `*/${config.PUBLISH_POLL_INTERVAL_MINUTES || 5} * * * *`;
  cron.schedule(intervalCron, async () => {
    const { data: due } = await supabase
      .from('publish_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .limit(5);

    if (!due || due.length === 0) return;

    for (const item of due) {
      try {
        const result = await processQueueItem(item); // pastikan publisher.js punya/dibuat fungsi ini, reuse logic yang sudah ada di publish.js
        await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
          `✅ Published: ${result.permalink || item.id}`);
      } catch (err) {
        logger.error(`[Cron] Publish gagal untuk ${item.id}: ${err.message}`);
        await bot.api.sendMessage(config.TELEGRAM_OWNER_CHAT_ID,
          `❌ Publish gagal (${item.id}): ${err.message}`);
      }
    }
  }, { timezone: 'Asia/Jayapura' });
}
```

Cek isi `src/agents/publisher.js` yang sudah ada dulu — kemungkinan besar sudah ada fungsi untuk proses 1 item queue (karena tabel `publish_queue` sudah pernah dibuat di migration 006), tinggal dipastikan cocok dipanggil dari cron baru ini, tidak perlu ditulis ulang dari nol.

Pertahankan `checkInstagramToken` (dari `daily.js` lama) sebagai cron kecil terpisah, jadwal harian, tetap kirim notifikasi ke Telegram seperti sebelumnya.

Pertahankan `src/scheduler/weekly.js` (Analysis Agent) **tanpa perubahan**.

Update `src/index.js`: ganti pemanggilan `startDailyScheduler` jadi `startPublisherCron` + jadwal token-check + tetap panggil `startWeeklyScheduler`.

---

## Fase 5: Trim `src/telegram/bot.js` dan `src/agents/leader.js`

Di `bot.js`:
- Hapus command: `/run`, `/pause`, `/resume`, `/skip`, `/fallback`
- Hapus import & pemakaian: `handleStartPipeline`, `handlePause`, `handleResume`, `handleSkip`, `handleFallback`, `handleApprove`, `handleRevise`
- **Sekalian benerin bug lama:** pindahkan definisi object `keyboardActions` (yang isinya arrow function manggil `ctx`) ke **dalam** handler `bot.on('message:text', async (ctx) => {...})`, supaya closure-nya benar.
- Update `mainMenu`/`stickey` keyboard: buang tombol yang nunjuk ke fitur yang dihapus (Run pipeline), pastikan Quick Post, Status, Jadwal, Analysis, Komentar, Inbox tetap ada.

Di `leader.js`:
- Hapus: `handleStartPipeline`, `handleApprove`, `handleRevise`, `handlePhoto` (versi lama yang terkait `AWAITING_ASSET` — foto sekarang cuma buat Quick Post), semua logic auto-mode kalau ada yang nyangkut di sini juga.
- Pertahankan tanpa ubah: `handleComments`, `handleReplyComment`, `handleInbox`, `handleSendDm`, `handleArchivePost`, `handleDeletePost`, `handlePages`, `handleAds`, `handleAnalysis`, `handleQuickPost`, `handleQuickPostPublish`, `updateQuickPostCaption`, `recheckQuickPostVisual`, `handleFeedback`, `hasQuickPostDraft`.
- `handleStatus` dan `handleSchedule` perlu direpurpose: query `publish_queue` (upcoming scheduled) alih-alih `content_pipeline` status hari ini.

Di `src/scheduler/daily.js` — file ini dihapus total (digantikan `publisher-cron.js` di Fase 4).

---

## Fase 6: Non-aktifkan Agent yang Keluar dari Jalur

**Jangan hapus file-nya**, cukup pastikan tidak ada lagi pemanggilan aktif ke:
- `runImageAgent` (`src/agents/image.js`) di luar konteks Quick Post (Quick Post punya jalurnya sendiri via `utils/quickpost.js`, cek dulu apakah dia manggil `image.js` atau tidak — kalau Quick Post gak butuh AI-generate image, ini juga gak perlu disentuh)
- `runImageQualityChecker`, `autoRegenerateIfNeeded` (`src/agents/image-review.js`)
- `checkCutoff` (`src/engine/fallback.js`)
- `checkDuplicate`, `storeImageHash` (`src/utils/dedup.js`) — opsional, boleh tetap dipanggil di `uploadVisual` (Fase 2) untuk cegah upload gambar duplikat, keputusan ada di kamu, bukan blocker.

Pastikan `runImageBriefAgent` dan `runPromptOptimizer` tetap dipanggil (lewat `generateVisualBrief` di Fase 2), outputnya cuma disimpan sebagai referensi, tidak dioper ke `runImageAgent`.

---

## Fase 7: Fix Kualitas yang Masih Relevan

Terapkan dari audit sebelumnya (skip yang sudah tidak relevan sesuai catatan di atas):
1. **Learnings loop di `script.js` dan `caption.js`** — tetap wajib. Ikuti pola `getActiveLearnings` seperti di `idea.js`.
2. **Validator field mismatch** — di kode manapun sekarang yang mengecek hasil `validateScript`/`validateCaption`, pastikan pakai field `valid` (bukan `passed`). Karena flow sekarang manual (Gaulan yang generate & edit), pertimbangkan validator ini dipakai sebagai **indikator visual di dashboard** (badge "⚠️ ada isu" di slot workspace) daripada trigger regenerate otomatis — karena di v2.0, Gaulan yang putuskan mau regenerate atau edit manual, bukan sistem otomatis.

---

## Testing & Verifikasi

- Update/tulis ulang `tests/pipeline.test.js` supaya sesuai fungsi granular baru (bukan test `startPipeline` auto-chain lama).
- Pastikan `tests/quickpost.test.js` masih pass tanpa perubahan (Quick Post tidak disentuh).
- Test manual end-to-end minimal 1 slot: create slot → generate idea → pilih → generate script → edit → generate visual brief → upload visual dummy → generate caption → schedule → cek row masuk `publish_queue` dengan `scheduled_at` benar.
- Test cron: bikin row `publish_queue` dengan `scheduled_at` di masa lalu, jalankan `publisher-cron.js` manual, pastikan ke-publish dan status berubah.

Kerjakan Fase 1 → 7 berurutan. Di akhir tiap fase, ringkas apa yang berubah dan file apa saja yang disentuh, sebelum lanjut fase berikutnya.
