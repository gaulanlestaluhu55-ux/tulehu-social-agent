# PRD: Tulehu Social Agent v2.0 — Human-Driven Content Dashboard

**Versi:** 2.0
**Status:** Design → Implementation
**Owner:** Gaulan (Tulehu Inkline)
**Menggantikan konsep:** v1.2 (autonomous pipeline + Telegram approval gate)

---

## 1. Kenapa Pivot dari v1.2

v1.2 dibangun sebagai sistem **otonom**: cron trigger pipeline harian, AI jalan dari idea sampai draft final, Gaulan cuma approve/revisi 2 gate lewat Telegram. Setelah dipakai, dua masalah utama muncul:

1. **Kualitas kurang pas** — beberapa agent (script, caption) gak dapet feedback dari learning loop, parameter image generation yang udah dioptimasi kebuang di jalan, dan quality-checker gambar logic-nya bocor (lihat audit terpisah, sudah dikirim ke AI agent sebagai fix prompt v1.2.1).
2. **Kontrol kurang fleksibel** — Telegram sebagai satu-satunya jalur kerja terlalu sempit buat kerja yang butuh iterasi (pilih dari beberapa opsi ide, edit naskah panjang, susun kalender sebulan sekaligus).

**v2.0 mengubah filosofi inti:** dari *"AI jalan sendiri, Gaulan approve"* menjadi *"Gaulan yang drive tiap aset, AI jadi co-pilot on-demand di setiap step, cron cuma jadi tukang publish yang setia."*

### Non-goals v2.0 (perubahan dari v1.2)
- ❌ Tidak ada lagi auto-mode (full_auto/semi_auto/manual_fallback), auto-timeout, cutoff fallback
- ❌ Tidak ada lagi approval gate 2-tahap via Telegram
- ❌ Tidak ada lagi generate gambar oleh AI (Cloudflare SDXL) di jalur produksi konten — visual selalu diupload manual oleh Gaulan (baik foto asli maupun hasil generate dari tools eksternal)
- ❌ Rotasi pilar otomatis (`content_calendar` 7-hari baseline) tidak lagi jadi trigger — kalender jadi freeform, Gaulan isi manual

---

## 2. Prinsip Desain v2.0

1. **Gaulan adalah operator, bukan approver.** Tiap aset (ide, naskah, visual, caption, jadwal) lahir dari klik dan edit Gaulan sendiri, bukan dari sistem yang jalan sendiri lalu diperiksa belakangan.
2. **Step-by-step, bukan chain otomatis.** Tiap agent dipanggil satu-satu lewat aksi eksplisit (klik tombol), hasilnya selalu bisa diedit sebelum lanjut ke step berikutnya. Tidak ada step yang otomatis lanjut ke step lain.
3. **Batch-friendly.** Gaulan bisa bikin slot kosong untuk banyak tanggal sekaligus (1 minggu/bulan), lalu jalanin step per slot kapan pun sempat — tidak harus dalam satu sesi atau berurutan tanggal.
4. **Publishing tetap otomatis lewat cron** — ini satu-satunya bagian yang tetap "hands-off". Begitu konten dijadwalkan (`scheduled_at` di `publish_queue`), cron yang eksekusi publish di jam yang ditentukan, tanpa campur tangan manual lagi.
5. **Visual selalu dari luar sistem.** Tidak ada AI image generation di jalur produksi. Image Brief + Prompt Optimizer tetap ada, tapi cuma menghasilkan *panduan* (brief teks + prompt siap pakai) untuk dipakai Gaulan di tools eksternal — bukan generate gambar langsung.
6. **Telegram tetap hidup, tapi scope-nya menyempit** ke: command status/analysis/komentar/inbox/ads (read + light interaction), dan Quick Post (fitur berdiri sendiri, tidak nyambung ke kalender/slot terjadwal).
7. **Satu basis kode, dua entry point.** Dashboard (Next.js, request-response) dan Bot+Cron (proses long-running) sama-sama import langsung dari `src/agents`, `src/platforms`, `src/db` — tidak ada REST API terpisah yang duplikat logic.

---

## 3. Arsitektur Sistem v2.0

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│   NEXT.JS DASHBOARD          │        │   TELEGRAM BOT (proses terpisah)│
│   (Vercel atau self-host)    │        │   + CRON (node-cron, long-running)│
│                              │        │                                │
│  /calendar   → kelola slot   │        │  /status /analysis /jadwal    │
│  /slot/:id   → workspace     │        │  /comments /inbox /ads        │
│  /queue      → jadwal publish│        │  Quick Post (foto → caption)  │
│  /analysis   → insight page  │        │                                │
│  /comments   → moderasi      │        │  Cron: poll publish_queue     │
│  /messages   → DM Instagram  │        │  tiap N menit → publish       │
│  /ads        → data iklan    │        │  Cron: cek token IG harian    │
└──────────────┬───────────────┘        └───────────────┬────────────────┘
               │                                          │
               │         Keduanya import langsung          │
               └───────────────────┬──────────────────────┘
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │   SHARED MODULES (src/agents, src/platforms, src/db)│
        │   idea.js · script.js · image-brief.js               │
        │   prompt-optimizer.js · caption.js · analysis.js     │
        │   analytics.js · instagram.js · supabase.js          │
        └───────────────────────┬───────────────────────────┘
                                 ▼
                     SUPABASE (Postgres) + Instagram Graph API
```

---

## 4. Perubahan Data Model

### 4.1 `content_calendar` — deprecated sebagai trigger
Tabel lama (rotasi pilar 7-hari) tidak lagi dipakai untuk menentukan konten harian. Bisa dibiarkan ada di DB (tidak perlu drop) tapi tidak direferensikan oleh flow baru.

### 4.2 `content_pipeline` — reused, status disederhanakan
Tetap tabel utama per slot konten. Field baru/berubah:
- `pillar_name` → jadi **teks bebas** (Gaulan isi manual saat bikin slot), bukan lookup dari `content_calendar`
- `scheduled_time` (baru) → jam publish yang Gaulan tentukan per slot, dikombinasikan dengan `calendar_date` jadi datetime lengkap
- `asset_url`, `asset_type` → tetap ada, tapi sekarang selalu diisi lewat **upload manual** (Supabase Storage), bukan hasil `image.js`
- `idea_options` (baru, JSONB) → menyimpan 3-5 alternatif ide dari `runIdeaAgent`, plus `idea_selected_index` untuk nyatet mana yang dipilih Gaulan

**Status baru** (ganti `PIPELINE_STATUS` di `config.js`):
```
draft → idea_ready → script_ready → visual_uploaded → caption_ready → scheduled → published → failed
```
Semua status lama yang berbau approval (`awaiting_script_approval`, `awaiting_final_approval`, `script_approved`, `approved`, `awaiting_asset`, `generating_asset`, `publishing`) **dihapus**. `publishing` tetap dipakai tapi cuma dipakai internal saat cron proses publish (bukan status yang butuh approval).

### 4.3 `publish_queue` — tambah kolom scheduling
```sql
ALTER TABLE publish_queue ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_publish_queue_scheduled ON publish_queue(scheduled_at) WHERE status = 'pending';
```
Cron akan query: `WHERE status = 'pending' AND scheduled_at <= NOW()`.

### 4.4 Supabase Storage — bucket baru untuk visual upload
Bucket baru (mis. `content-assets`) untuk nyimpen foto/gambar yang diupload Gaulan lewat dashboard, diakses publik/signed-URL sesuai kebutuhan publish ke Instagram Graph API (yang butuh URL publik buat `image_url` parameter).

---

## 5. Alur Kerja per Slot (menggantikan Section 5 PRD v1.2)

1. **Buat slot** — dashboard `/calendar`, Gaulan pilih range tanggal + jam per slot (bisa banyak sekaligus, semua mulai berstatus `draft` dan kosong).
2. **Generate Idea** — di slot workspace, klik "Generate Idea" → `runIdeaAgent` dipanggil, dimodifikasi supaya return **array 3-5 alternatif** (bukan 1). Ditampilkan sebagai card, Gaulan klik salah satu → tersimpan ke `idea_selected_index`, status → `idea_ready`.
3. **Generate Script** — klik "Generate Script" → `runScriptAgent` (dengan fix learnings dari audit sebelumnya). Hasil hook/body/CTA ditampilkan di form editable (textarea per field). Gaulan edit bebas → simpan → status `script_ready`.
4. **Lihat Image Brief + Optimized Prompt** — klik "Generate Visual Brief" → `runImageBriefAgent` + `runPromptOptimizer` dipanggil berurutan (tanpa `runImageAgent`). Hasilnya ditampilkan sebagai **kartu referensi read-only**: style/lighting/composition/mood + prompt SDXL siap-pakai (buat dipakai manual di tools eksternal kalau mau AI-generate visual). Tidak mengubah status pipeline secara wajib — opsional dilihat, tidak ngeblok step berikutnya.
5. **Upload Visual** — drag-drop file (foto asli atau hasil generate eksternal) → upload ke Supabase Storage → `asset_url` terisi → status `visual_uploaded`. Ini satu-satunya jalur visual, tidak ada cabang logic per pillar lagi.
6. **Generate Caption** — klik "Generate Caption" → `runCaptionAgent` (dengan fix learnings). Editable, simpan → status `caption_ready`.
7. **Schedule** — Gaulan set/konfirmasi tanggal+jam publish → sistem insert row ke `publish_queue` dengan `scheduled_at` terisi, status pipeline → `scheduled`.
8. **Cron publish** — proses cron terpisah, polling `publish_queue`, publish yang `scheduled_at <= now()` lewat `publisher.js`/`publish.js` (retry logic yang sudah ada tetap dipakai apa adanya). Sukses → status `published`; gagal setelah max retries → `failed`, notif ke Telegram.

Setiap step **independen** — Gaulan bisa generate idea untuk 10 slot dulu, baru besoknya lanjut script untuk beberapa di antaranya, tidak harus linear dalam satu sesi.

---

## 6. Cron & Scheduler (menggantikan `src/scheduler/daily.js`)

`daily.js` yang lama (auto-mode, timeout handling, cutoff fallback — ratusan baris) **dihapus total**, diganti scheduler baru yang jauh lebih sederhana:

```js
// src/scheduler/publisher-cron.js (baru, menggantikan daily.js)
// Jalan tiap X menit (config: PUBLISH_POLL_INTERVAL_MINUTES, default 5)
// 1. Query publish_queue WHERE status='pending' AND scheduled_at <= NOW(), limit N
// 2. Untuk tiap row: panggil publisher.js/publish.js yang sudah ada
// 3. Update status published/failed, kirim notif Telegram ringkas
```

`weekly.js` (Analysis Agent mingguan) **tetap dipertahankan apa adanya** — masih relevan karena masih ngasih insight ke `learnings` table yang dipakai idea/script/caption agent.

Token-expiry checker (`checkInstagramToken` di `daily.js` lama) dipindah ke cron kecil tersendiri, tetap jalan harian, tetap notif Telegram.

---

## 7. Telegram Bot — Scope Baru

**Dihapus:**
- `handleApprove`, `handleRevise` dan semua logic approval gate
- Auto-mode (`getAutoMode`, `autoContinuePipeline`, `autoPipelineToEnd`, `fallbackPipeline`, `AUTO_CONFIRM_TIMEOUT_MINUTES`, `autoTimeouts` Map)
- `/run`, `/pause`, `/resume`, `/skip`, `/fallback` (gak relevan lagi — trigger konten sekarang dari dashboard)

**Dipertahankan (reuse langsung, tanpa ubah logic internal):**
- `/status` — direpurpose: tampilkan ringkasan `publish_queue` upcoming (bukan pipeline hari ini)
- `/jadwal` — tampilkan slot yang sudah di-schedule minggu ini
- `/analysis` — tetap manggil `analysis.js` apa adanya
- `/comments`, `/reply`, `/inbox`, `/dm`, `/archive`, `/delete`, `/pages`, `/ads` — semua tetap, ini yang jadi basis untuk dashboard pages juga (lihat Section 8)
- Quick Post (`handleQuickPost`, `handleQuickPostPublish`, dll) — **tidak disentuh sama sekali**, tetap fitur foto→caption→publish instan yang berdiri sendiri, terpisah dari kalender/slot terjadwal

**Bonus fix** (dari audit sebelumnya, tetap berlaku): `keyboardActions` di `bot.js` harus dipindah ke dalam handler `message:text` supaya `ctx` ke-capture dengan benar.

---

## 8. Dashboard Pages — Analysis, Comments, Messages, Ads

Prinsip: **jangan tulis ulang logic**. Handler Telegram yang sekarang (`handleComments`, `handleInbox`, `handlePages`, `handleAds`, `handleAnalysis` di `leader.js`) sudah memisahkan "ambil data" dari "format pesan" secara implisit — data-fetching-nya berasal dari fungsi di `src/platforms/instagram.js` (`getComments`, `getConversations`, `getPages`, `getAdAccounts`, `getCampaigns`, `replyToComment`, `sendMessage`, `archiveMedia`, `deleteMedia`) dan `src/agents/analysis.js`/`analytics.js`.

**Yang perlu dilakukan:** extract pemanggilan fungsi-fungsi itu jadi dipanggil langsung dari Next.js API routes (bukan lewat handler Telegram), lalu return JSON — tanpa mengubah fungsi platform-nya sama sekali.

Halaman dashboard baru:
| Halaman | Data source (reuse langsung) |
|---------|------------------------------|
| `/analysis` | `analysis.js` (insight mingguan) + `analytics.js` (metrik post) |
| `/comments` | `getComments`, `scoreCommentQuality`, `replyToComment` dari `platforms/instagram.js` |
| `/messages` | `getConversations`, `sendMessage` dari `platforms/instagram.js` |
| `/ads` | `getAdAccounts`, `getCampaigns` dari `platforms/instagram.js` |

Telegram command yang setara (`/comments`, `/inbox`, `/ads`) tetap jalan berdampingan — dua entry point, satu sumber data.

---

## 9. Agent yang Keluar dari Jalur Aktif

Tidak dihapus dari codebase (masih berguna kalau nanti mau diaktifkan lagi), tapi **tidak dipanggil lagi** di flow produksi konten:
- `src/agents/image.js` (Cloudflare SDXL generation)
- `src/agents/image-review.js` (quality checker + auto-regenerate)
- `src/utils/dedup.js` (dedup hash gambar AI — kurang relevan kalau visual dari upload manual, tapi bisa dipertimbangkan tetap jalan untuk cegah re-upload gambar yang sama)
- `src/engine/fallback.js` (cutoff logic — sudah tidak relevan tanpa auto-mode)

`src/agents/image-brief.js` dan `src/agents/prompt-optimizer.js` **tetap aktif**, tapi outputnya jadi referensi teks, bukan input ke image generation.

---

## 10. Ringkasan Keputusan Diskusi v2.0

- ✅ Pivot dari autonomous pipeline ke human-driven dashboard co-pilot
- ✅ Kalender freeform, bukan rotasi pilar otomatis
- ✅ Generate Idea kasih 3-5 opsi sekaligus, bukan 1
- ✅ Step-by-step manual per slot, tidak auto-chain
- ✅ Visual selalu upload manual (foto asli maupun hasil generate eksternal) — tidak ada AI image generation di jalur aktif
- ✅ Image Brief + Prompt Optimizer tetap jalan sebagai referensi teks
- ✅ Cron disederhanakan total: cuma polling `publish_queue` berdasarkan `scheduled_at`
- ✅ Telegram dipangkas ke command query/utility + Quick Post, approval gate dihapus
- ✅ Dashboard (Next.js) dan Bot+Cron share modul yang sama dalam satu repo — tidak ada REST API layer baru
- ✅ Dashboard nambah halaman Analysis/Comments/Messages/Ads, reuse fungsi platform yang sudah ada

---

## 11. Risiko Baru di v2.0

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Cron & Telegram bot proses long-running gak cocok di Vercel serverless | Bot/cron gak jalan kalau dashboard di-deploy full serverless | Dashboard (Next.js API routes + pages) bisa di Vercel, tapi bot+cron tetap proses Node terpisah (laptop untuk sekarang, VPS kalau mau upgrade reliability — sama seperti keputusan v1.2) |
| Gaulan lupa upload visual / lupa schedule | Slot nyangkut di status `visual_uploaded`/`caption_ready` selamanya | Dashboard `/queue` kasih badge "belum dijadwalkan" untuk slot yang udah lengkap tapi belum di-schedule |
| Race condition: slot diedit dari dashboard pas cron lagi publish | Data tidak konsisten | Cron kunci row (`status='publishing'`) sebelum proses, dashboard disable edit kalau status sudah `scheduled`/`publishing`/`published` |

---

## Versi Dokumen

| Versi | Tanggal | Perubahan |
|-------|---------|-----------|
| 2.0 | 21 Jul 2026 | Pivot total dari autonomous pipeline + Telegram approval gate ke human-driven dashboard co-pilot. Lihat Section 1-11. |

---

*Dokumen ini melengkapi (bukan menggantikan riwayat) PRD v1.2 — bagian arsitektur, alur kerja, dan Telegram scope di v1.2 dianggap superseded oleh dokumen ini.*
