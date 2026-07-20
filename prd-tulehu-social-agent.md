# PRD: Tulehu Inkline — Sistem AI Agent Social Media Push (Instagram)

**Versi:** 1.2
**Status:** In Development
**Owner:** Gaulan (Tulehu Inkline)
**Target build model:** DeepSeek V4 Flash

---

## Daftar Isi

1. [Latar Belakang & Tujuan](#1-latar-belakang--tujuan)
2. [Prinsip Desain](#2-prinsip-desain)
3. [Arsitektur Sistem](#3-arsitektur-sistem)
4. [Peran Tiap Agent](#4-peran-tiap-agent)
5. [Alur Kerja (Pipeline per Konten)](#5-alur-kerja-pipeline-per-konten)
6. [Model Data (Supabase)](#6-model-data-supabase)
7. [Metrik Trust (Analysis Agent)](#7-metrik-trust-analysis-agent)
8. [Integrasi Telegram](#8-integrasi-telegram)
9. [Integrasi Instagram Graph API](#9-integrasi-instagram-graph-api)
10. [Alokasi Provider AI](#10-alokasi-provider-ai)
11. [Rotasi Pilar Konten](#11-rotasi-pilar-konten)
12. [Mekanisme Belajar & Upgrade Diri](#12-mekanisme-belajar--upgrade-diri)
13. [Tech Stack & Project Structure](#13-tech-stack--project-structure)
14. [Setup & Environment](#14-setup--environment)
15. [Error Handling & Retry](#15-error-handling--retry)
16. [Provider Failover Strategy](#16-provider-failover-strategy)
17. [Provider Budget & Rate Limit Monitoring](#17-provider-budget--rate-limit-monitoring)
18. [Ringkasan Keputusan Diskusi](#18-ringkasan-keputusan-diskusi)
19. [Langkah Implementasi](#19-langkah-implementasi)
20. [Risiko & Mitigasi](#20-risiko--mitigasi)
21. [Glosarium](#21-glosarium)

---

## 1. Latar Belakang & Tujuan

Tulehu Inkline butuh sistem yang bisa menjalankan produksi konten Instagram secara berkelanjutan — dari ide sampai publish — tanpa Gaulan harus mengerjakan tiap langkah secara manual. Tujuan utamanya bukan sekadar posting otomatis, tapi **membangun trust** calon customer lewat konten yang konsisten dan terbukti efektif berdasarkan data performa nyata, bukan tebak-tebakan.

Sistem ini adalah **backend murni**, tanpa frontend/dashboard. Semua interaksi manusia terjadi lewat Telegram.

### Tujuan v1
- Produksi konten harian untuk Instagram Tulehu Inkline
- Manusia (Gaulan) tetap jadi gatekeeper kualitas lewat approval gate, bukan full-auto tanpa kontrol
- Sistem belajar dari histori insight yang sudah ada, dan terus memperbarui pemahamannya tiap minggu
- Semua komponen berjalan di provider AI gratis, masing-masing agent punya provider sendiri

### Non-goals v1
- Tidak ada dashboard/frontend
- Tidak ada training/fine-tuning model sendiri ("upgrade diri" dilakukan lewat evolusi prompt & knowledge base, bukan retrain model)
- Tidak menangani tracking DM/inquiry otomatis (keterbatasan permission Graph API — dicatat manual oleh Gaulan bila diperlukan nanti)
- Tidak multi-platform dulu (fokus IG saja, TikTok dkk menyusul)

---

## 2. Prinsip Desain

1. **Leader agent adalah satu-satunya kontak manusia.** Semua sub-agent bekerja di belakang layar; Gaulan tidak pernah berinteraksi langsung dengan mereka.
2. **Stateful, bukan reaktif.** Pipeline harus bisa pause berhari-hari (menunggu approval atau foto dari Gaulan) dan resume persis dari titik terakhir. Ini state machine, bukan chatbot session.
3. **Approval gate 2 tahap** — mencegah pemborosan resource (image generation) untuk naskah yang bakal direvisi, dan tetap memberi kontrol final sebelum publish.
4. **Hybrid calendar** — rotasi pilar konten sebagai baseline, tapi bisa digeser oleh data performa nyata.
5. **Belajar tanpa retrain** — sistem "upgrade diri" lewat knowledge base (`learnings`) yang terus diperbarui dan memengaruhi instruksi agent, bukan lewat training ulang model.
6. **Provider terpisah per agent** — memudahkan debugging (tau persis agent mana yang kena rate limit) dan menghindari titik gagal tunggal.

---

## 3. Arsitektur Sistem

### 3.1 Gambaran Arsitektur

```
┌─────────────────────────────────────────────────────────────────┐
│                        TELEGRAM BOT                              │
│              (Leader Agent Interface dengan Gaulan)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SCHEDULER (node-cron)                       │
│           Trigger pipeline harian + mingguan sesuai jadwal       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 PIPELINE STATE MACHINE                           │
│                                                                  │
│  ┌─────────┐   ┌─────────┐   ┌──────────┐   ┌──────────┐       │
│  │  IDEA   │──▶│  SCRIPT │──▶│  GATE 1  │──▶│  ASSET   │       │
│  │  Agent  │   │  Agent  │   │ (Approve)│   │  (Image) │       │
│  └─────────┘   └─────────┘   └──────────┘   └──────────┘       │
│                                          │                      │
│                                     ┌────▼──────┐               │
│                                     │  CAPTION  │               │
│                                     │  Agent    │               │
│                                     └────┬──────┘               │
│                                          ▼                      │
│                                 ┌──────────────┐                │
│                                 │   GATE 2     │                │
│                                 │  (Approval)  │                │
│                                 └──────┬───────┘                │
│                                        ▼                        │
│                                 ┌──────────────┐                │
│                                 │ PUBLISH      │                │
│                                 │ Agent        │                │
│                                 └──────────────┘                │
│                                        │                        │
│                                        ▼                        │
│                                 ┌──────────────┐                │
│                                 │ ANALYSIS     │                │
│                                 │ Agent        │                │
│                                 │ (Mingguan)   │                │
│                                 └──────────────┘                │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SUPABASE (PostgreSQL)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │content_calendar │content_pipeline│  │  learnings   │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│  ┌──────────────┐  ┌──────────────┐                              │
│  │ig_post_insights│  │agent_logs   │                              │
│  └──────────────┘  └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                  EXTERNAL APIs & PROVIDERS                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │Telegram  │  │Instagram │  │OpenRouter│  │Ollama    │        │
│  │Bot API   │  │Graph API │  │(free)    │  │(local)   │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                        │
│  │Cloudflare│  │Groq      │  │Gemini    │                        │
│  │Workers AI│  │(free)    │  │(vision)  │                        │
│  └──────────┘  └──────────┘  └──────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Komponen inti
- **Bot Telegram** — menerima & mengirim pesan Telegram (Leader Agent tinggal di sini)
- **Scheduler** — cron job (`node-cron`) yang berjalan sebagai background process, trigger pipeline harian sesuai jadwal di `content_calendar`
- **Supabase (Postgres)** — single source of truth untuk semua state: kalender, progres pipeline, dan knowledge base pembelajaran
- **Modul-modul agent** — masing-masing adalah fungsi/module yang memanggil LLM provider tertentu + tools relevan (image gen, Instagram Graph API, dll)
- **State Machine Engine** — mengelola transisi status pipeline, pause/resume, retry logic

### 3.3 Hosting
- Lokal (laptop Gaulan) untuk v1. Cron hanya berjalan saat laptop aktif — ini limitasi yang disadari dan diterima untuk tahap awal. Migrasi ke VPS/server bisa jadi fase 2 kalau target harian mulai sering bolong karena laptop mati.

---

## 4. Peran Tiap Agent

| Agent | Call Sign | Tugas | Provider (v1) | Butuh LLM? |
|-------|-----------|-------|---------------|------------|
| **Leader** | **COMMANDER** | Orkestrator. Komunikasi 2 arah dengan Gaulan via Telegram, delegasi ke sub-agent, kelola approval gate, kelola state pipeline | OpenRouter free (GPT-OSS 120B / Mixtral 8x7B) | Ya — kritis di tool calling |
| **Idea agent** | **SCOUT** | Baca `content_calendar` (pilar hari ini) + `learnings` (pola performa terbaru), hasilkan ide konten + tag jenis visual (foto asli / AI-generated) | Ollama lokal (Llama 3.1 8B) | Ya — ringan |
| **Script agent** | **SCRIBE** | Dari ide, tulis hook + isi + CTA untuk konten | OpenRouter free / opencode | Ya — butuh reasoning & kreativitas |
| **Image agent** | **PIXEL** | Jika AI-generated: generate visual dari script. Jika butuh foto asli: minta Leader kirim permintaan foto ke Gaulan dan tunggu upload | Cloudflare Workers AI (Stable Diffusion XL) | Ya, untuk generate; tidak untuk jalur foto asli |
| **Caption agent** | **WORDSMITH** | Tulis caption final + hashtag, berjalan paralel dengan Image agent | Ollama lokal (Llama 3.1 8B) | Ya — ringan |
| **Publish agent** | **DEPLOYER** | Publish ke Instagram lewat Graph API (create media container → publish), simpan post ID | — | Tidak — murni pemanggilan API |
| **Analysis agent** | **INTEL** | Audit retroaktif satu kali di awal (dari histori insight yang sudah ada), lalu berjalan mingguan. Menyimpulkan pola performa fokus metrik trust, menulis ke `learnings`, dan menjalankan reflection cycle | Groq free tier (Llama 3.1 70B / Mixtral 8x7B) | Ya — reasoning ringan-menengah |

### 4.1 Call Sign Radio Protocol

```
COMMANDER: "SCOUT, status ide untuk hari ini."
SCOUT: "COMMANDER, ide ready: 'BTS Proses Sablon' — butuh foto asli."
COMMANDER: "SCRIBE, kerjakan script dari ide SCOUT."
SCRIBE: "COMMANDER, draft script v1 siap review."
COMMANDER: "Gaulan, ini naskahnya. Approve atau revisi?"
Gaulan: "Approve"
COMMANDER: "PIXEL, generate gambar dari script. WORDSMITH, tulis caption."
PIXEL: "COMMANDER, asset ready."
WORDSMITH: "COMMANDER, caption ready."
COMMANDER: "Gaulan, ini preview final. Approve atau revisi?"
Gaulan: "Approve. Posting."
COMMANDER: "DEPLOYER, publish sekarang."
DEPLOYER: "COMMANDER, posted! ID: 123456789"
COMMANDER: "Gaulan, postingan sudah live: link"
```

---

## 5. Alur Kerja (Pipeline per Konten)

### 5.1 State Machine Diagram

```
                    ┌─────────┐
                    │  IDLE   │
                    └────┬────┘
                         │ Scheduler trigger
                         ▼
                    ┌─────────┐
                    │  IDEA   │
                    └────┬────┘
                         │ Ide siap
                         ▼
                    ┌──────────┐
                    │  SCRIPT  │
                    └────┬─────┘
                         │ Script drafted
                         ▼
              ┌──────────────────────┐
              │ AWAITING_SCRIPT_APPROVAL│ ◄────┐
              └──────────┬───────────┘      │
                         │                    │
                    ┌────▼────┐               │
                    │ APPROVE?│               │
                    └────┬────┘               │
                  ┌──────┴──────┐             │
                  ▼              ▼            │
           ┌──────────┐   ┌──────────┐        │
           │ APPROVED │   │ REVISI   ├────────┘
           └────┬─────┘   └──────────┘
                │
          ┌─────┴─────┐
          ▼           ▼
   ┌──────────┐  ┌──────────┐
   │AWAITING  │  │GENERATING│
   │ASSET     │  │ASSET     │
   │(foto)    │  │(AI)      │
   └────┬─────┘  └────┬────┘
        │             │
        ▼             ▼
   ┌──────────────────────┐
   │ AWAITING_FINAL_APPROVAL│ ◄────┐
   └──────────┬───────────┘      │
              │                    │
         ┌────▼────┐               │
         │ APPROVE?│               │
         └────┬────┘               │
       ┌──────┴──────┐             │
       ▼              ▼            │
┌──────────┐   ┌──────────┐        │
│ APPROVED │   │ REVISI   ├────────┘
└────┬─────┘   └──────────┘
     │
     ▼
┌──────────┐
│PUBLISHING│
└────┬─────┘
     │
     ▼
┌──────────┐
│PUBLISHED │
└──────────┘
```

### 5.2 Pipeline Detail

#### 5.2.1 Manual Mode (dengan approval gate)

```
1. Scheduler trigger (harian, sesuai jadwal di content_calendar)
2. Idea agent → baca pilar hari ini + learnings → hasilkan ide + tag jenis visual
3. Script agent → hook, isi, CTA
4. >>> APPROVAL GATE 1 <<<
   Leader kirim naskah ke Telegram → tunggu balasan Gaulan
   - Approve → lanjut ke langkah 5
   - Revisi → balik ke Script agent dengan feedback, ulangi gate ini
5. Percabangan berdasarkan tag jenis visual:
   a. Butuh foto asli → Leader minta Gaulan kirim foto via Telegram, pipeline PAUSE sampai foto diterima
      - Fallback: jika jam cutoff (mis. 18:00) belum ada foto, Leader otomatis switch ke pilar cadangan AI-generated hari itu
   b. AI-generated → Image agent generate langsung
   Caption agent berjalan paralel (tidak menunggu Image agent)
6. >>> APPROVAL GATE 2 <<<
   Leader kirim preview final (gambar + caption) ke Telegram → tunggu balasan Gaulan
   - Approve → lanjut ke langkah 7
   - Revisi → balik ke agent terkait (image dan/atau caption) sesuai feedback, ulangi gate ini
7. Publish agent → post ke Instagram, simpan post_id ke content_pipeline
8. Leader konfirmasi ke Gaulan via Telegram (link postingan)
```

#### 5.2.2 Auto Pipeline Modes

Scheduler menggunakan 3 mode yang dikonfigurasi via `AUTO_PIPELINE_MODE` di `.env`:

| Mode | Gate 1 (Script) | Gate 2 (Final) | Timeout |
|------|----------------|----------------|---------|
| `full_auto` | **Skip** — langsung lanjut tanpa approval | **Skip** — langsung publish setelah asset siap | Tidak ada timeout |
| `semi_auto` | Manual approval via Telegram | Manual approval via Telegram | **120 menit** auto-approve |
| `manual_fallback` | Manual approval via Telegram | Manual approval via Telegram | Timeout → fallback ke AI pillar → auto-publish |

**full_auto**: Hanya untuk pilar edukasi/tips (konten text + AI-generated visual). Tidak butuh foto asli.
**semi_auto**: Default. Gaulan tetap approve, tapi kalo liat ≤120 menit, sistem auto-approve.
**manual_fallback**: Gaulan approve, kalo liat/timeout → ganti pillar cadangan AI → publish otomatis.

```javascript
// src/engine/pipeline.js
getAutoMode(pillar) {
  if (pillar === 'edukasi' && process.env.AUTO_PIPELINE_MODE === 'full_auto') return 'full_auto';
  const mode = process.env.AUTO_PIPELINE_MODE || 'semi_auto';
  return mode;
}
```

#### 5.2.3 Quick Post Feature

Alur terpisah dari pipeline harian — Gaulan bisa kapan saja kirim foto produk + langsung posting.

```
1. Gaulan kirim foto kaos ke chat Telegram
2. Leader terima foto → download ke base64 (expired-proof)
3. LLM Vision (Gemini native API) analisis foto:
   - Generate hook, body (3 poin), CTA, caption, hashtags
   - Output strict JSON
4. Leader tampilkan preview ke Gaulan:
   - Foto + Hook + Isi + CTA + Caption + Hashtags
5. Gaulan bales:
   - "posting" → langsung publish ke Instagram
   - "revisi: [pesan]" → edit caption manual
   - kirim teks lain → Leader proses sebagai chat biasa
6. On success: auto-save learning ke Supabase, leader konfirmasi link
```

Draft disimpan di in-memory `quickPostDraft` — tidak persist ke database (satu session, sekali posting).

### 5.3 Siklus mingguan (terpisah dari pipeline harian)

```
Analysis agent (cron mingguan, misal Minggu 20:00) →
  tarik insight dari post yang sudah 3-7 hari →
  hitung metrik trust (lihat §7) →
  update/tulis learnings baru →
  reflection: tinjau learnings lama, hapus/turunkan confidence yang sudah tidak terbukti →
  (opsional) usulkan pergeseran prioritas pilar di content_calendar untuk minggu berikutnya →
  Leader kirim ringkasan hasil analisis ke Gaulan via Telegram
```

### 5.4 Cutoff Time & Fallback Logic

```javascript
// Konfigurasi cutoff
const CUTOFF_HOUR = 18; // 18:00 WIT
const RECHECK_INTERVAL_MINUTES = 30;
const MAX_RECHECKS = 4; // 2 jam maksimal menunggu

// Logic
if (currentHour >= CUTOFF_HOUR && pipeline.status === 'awaiting_asset') {
  if (recheckCount >= MAX_RECHECKS) {
    // Switch ke pilar cadangan AI-generated
    const fallbackPillar = await getFallbackPillar();
    await switchPillar(currentPipeline.id, fallbackPillar);
    Leader.sendMessage("⏰ Melewati batas waktu pengiriman foto. Beralih ke konten AI-generated untuk hari ini.");
  }
}
```

### 5.5 Revision Limits

| Approval Gate | Max Revisions (v1) | After Max |
|---------------|-------------------|-----------|
| Gate 1 (Script) | Unlimited (v1) | — |
| Gate 2 (Final) | Unlimited (v1) | — |
| Catatan | Akan ditambahkan batasan di v2 jika perlu | |

---

## 6. Model Data (Supabase)

### 6.1 `content_calendar`

Menyimpan rotasi pilar dan slot mingguan.

```sql
CREATE TABLE content_calendar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    pillar_name TEXT NOT NULL,
    needs_real_photo BOOLEAN NOT NULL DEFAULT false,
    priority_override TEXT, -- diisi Analysis agent kalau ada rekomendasi
    fallback_ai_pillar TEXT, -- pilar AI-generated jika foto asli tidak tersedia
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calendar_day ON content_calendar(day_of_week, is_active);
```

### 6.2 `content_pipeline`

Tracking status tiap konten, dari ide sampai publish. Ini kunci untuk pause-resume.

```sql
CREATE TYPE pipeline_status AS ENUM (
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
    'failed'
);

CREATE TABLE content_pipeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_date DATE NOT NULL,
    pillar_name TEXT NOT NULL,
    status pipeline_status NOT NULL DEFAULT 'idea',
    idea_content JSONB, -- {angle, description, visual_type}
    script_content JSONB, -- {hook, body, cta, visual_prompts}
    needs_real_photo BOOLEAN DEFAULT false,
    asset_url TEXT,
    asset_type TEXT, -- 'ai_generated' | 'real_photo'
    caption_content TEXT,
    hashtags TEXT[], -- array hashtag
    revision_notes JSONB, -- [{gate: 1, note: "...", timestamp: "..."}]
    revision_count_gate1 INTEGER DEFAULT 0,
    revision_count_gate2 INTEGER DEFAULT 0,
    ig_post_id TEXT,
    ig_permalink TEXT,
    error_log TEXT,
    fallback_used BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_date ON content_pipeline(calendar_date);
CREATE INDEX idx_pipeline_status ON content_pipeline(status);
```

### 6.3 `learnings`

Knowledge base hasil kesimpulan Analysis agent — ini yang dibaca Idea/Script agent, bukan data insight mentah.

```sql
CREATE TABLE learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    insight_summary TEXT NOT NULL,
    pillar_related TEXT,
    confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')) DEFAULT 'low',
    based_on_post_count INTEGER DEFAULT 1,
    evidence_notes TEXT, -- penjelasan data yang mendukung
    status TEXT CHECK (status IN ('active', 'deprecated')) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learnings_status ON learnings(status);
CREATE INDEX idx_learnings_pillar ON learnings(pillar_related);
```

### 6.4 `ig_post_insights` (opsional, cache mentah)

Simpan raw insight dari Graph API per post_id agar Analysis agent tidak perlu selalu fetch ulang.

```sql
CREATE TABLE ig_post_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id TEXT NOT NULL UNIQUE,
    ig_post_id UUID REFERENCES content_pipeline(id),
    insights_json JSONB, -- raw response dari Graph API
    saves_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    comments_sample JSONB, -- sample komentar untuk analysis
    profile_visits INTEGER DEFAULT 0,
    follows_from_post INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2),
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ig_insights_post ON ig_post_insights(post_id);
```

### 6.5 `agent_logs`

Logging aktivitas tiap agent untuk debugging.

```sql
CREATE TABLE agent_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID REFERENCES content_pipeline(id),
    agent_name TEXT NOT NULL, -- 'leader', 'idea', 'script', 'image', 'caption', 'publish', 'analysis'
    action TEXT NOT NULL, -- 'generate_idea', 'write_script', 'generate_image', dll
    status TEXT CHECK (status IN ('success', 'error', 'rate_limited', 'timeout')) DEFAULT 'success',
    provider_used TEXT, -- 'openrouter', 'ollama', 'groq', 'cloudflare_workers', 'instagram_api'
    model_used TEXT, -- nama model spesifik
    tokens_used INTEGER,
    duration_ms INTEGER,
    error_message TEXT,
    metadata JSONB, -- additional data
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_logs_pipeline ON agent_logs(pipeline_id);
CREATE INDEX idx_logs_agent ON agent_logs(agent_name);
CREATE INDEX idx_logs_created ON agent_logs(created_at);
```

### 6.6 `conversation_history`

Menyimpan riwayat chat antara Leader agent dan Gaulan untuk konteks percakapan.

```sql
CREATE TABLE conversation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL DEFAULT 'main',
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conv_session ON conversation_history(session_id, created_at);
```

**In-memory fallback**: Jika Supabase `INSERT`/`SELECT` ditolak permission, sistem fallback ke array in-memory (`conversationBuffer[]`). Leader tetap bisa jalan tanpa database chat.

### 6.7 `provider_health`

Tracking kesehatan/kuota provider gratis.

```sql
CREATE TABLE provider_health (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_name TEXT UNIQUE NOT NULL, -- 'openrouter', 'ollama', 'groq', 'cloudflare_workers'
    status TEXT CHECK (status IN ('healthy', 'degraded', 'down')) DEFAULT 'healthy',
    daily_requests INTEGER DEFAULT 0,
    daily_limit INTEGER, -- batas kuota gratis
    rate_limit_remaining INTEGER,
    rate_limit_reset_at TIMESTAMPTZ,
    last_error TEXT,
    checked_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Metrik Trust (Analysis Agent)

Fokus bukan viralitas, tapi sinyal yang mengindikasikan calon customer makin percaya.

### Primary Metrics

| Metrik | Sumber Data | Bobot | Keterangan |
|--------|-------------|-------|------------|
| **Saves** | Instagram Insights API | High | Indikasi konten disimpan sebagai referensi sebelum order |
| **Kualitas komentar** | Comment analysis (LLM) | High | Komentar berisi pertanyaan (harga, custom, durasi) dibobot lebih tinggi daripada komentar emoji/generic |
| **Profile visits** | Instagram Insights API | Medium | Indikasi ketertarikan lanjutan |
| **Follows** | Instagram Insights API | Medium | Dari profile visit ke follow |
| **Shares** | Instagram Insights API | Medium | Dibagikan ke orang lain = trust signal |
| **Reach** | Instagram Insights API | Low | Seberapa banyak orang lihat |

### Comment Quality Scoring

Analysis agent akan membaca isi komentar dan memberi skor:

| Skor | Tipe Komentar | Contoh |
|------|--------------|--------|
| **3** | Pertanyaan bisnis (harga, pesan, custom) | "Min, harga untuk ukuran XXL berapa?" |
| **2** | Komentar relevan (pujian, feedback) | "Bagus banget hasilnya, mereknya halus" |
| **1** | Komentar generik (emoji, tag teman) | "🔥🔥", "@temen liat deh" |
| **0** | Spam / tidak relevan | "Follow for follow" |

---

## 8. Integrasi Telegram

### 8.1 Bot Communication

- Leader agent mengelola seluruh percakapan lewat satu bot Telegram
- **Approval gate**: Leader kirim pesan (teks/foto) dengan instruksi jelas

### 8.2 Format Pesan Approval Gate 1 (Script)

```
📝 *Naskah Konten — [Pilar]*
*Hari/Tanggal:* Senin, 15 Januari 2024
*Ide:* Behind the Scenes proses sablon kaos custom

*HOOK:* 
"Pesan kaos custom? Gampang banget! 🎨"

*ISI:* 
[3 paragraf isi konten]

*CTA:*
"Chat WA di bio untuk konsultasi gratis desain! 👇"

*Jenis Visual:* Foto asli (diminta dari Anda)

━━━━━━━━━━━━━━━━━━
Balas *"approve"* untuk lanjut ke pembuatan visual.
Balas *"revisi: [pesan]"* untuk minta perbaikan.
━━━━━━━━━━━━━━━━━━
```

### 8.3 Format Pesan Approval Gate 2 (Final)

```
🖼 *Preview Final — [Judul Konten]*

[Gambar]

*Caption:*
[Caption lengkap dengan hashtags]

━━━━━━━━━━━━━━━━━━
Balas *"approve"* untuk langsung publish ke Instagram.
Balas *"revisi: [pesan]"* untuk minta perbaikan.
Balas *"posting"* untuk langsung publish tanpa revisi.
━━━━━━━━━━━━━━━━━━
```

### 8.4 Format Pesan Minta Foto Asli

```
📸 *Butuh Foto untuk Konten*
Hari ini jadwalnya: *[Pilar]*

Saya butuh foto:
- *Subjek:* [deskripsi foto yang dibutuhkan]
- *Jumlah:* 1-2 foto
- *Tips:* Usahakan lighting cukup, resolusi tinggi

Kirim foto langsung di chat ini.
Pipeline akan pause sampai foto diterima ⏸️
```

### 8.5 Format Pesan Konfirmasi Posting

```
✅ *Konten Terposting!*
📱 *Instagram*
🔗 [Link postingan]
🕐 Diposting: [timestamp]
━━━━━━━━━━━━━━━━━━
Kalau ada yang perlu diubah, bilang aja!
```

### 8.6 Inline Menu & Keyboard

Menggunakan 3 layer input:

1. **`setMyCommands`** — daftar `/` command muncul di input field:
   - `/start` — mulai/sapa
   - `/status` — status pipeline hari ini
   - `/jadwal` — jadwal minggu ini
   - `/skip` — skip konten hari ini
   - `/pause` — pause pipeline
   - `/resume` — resume
   - `/fallback` — pindah pillar cadangan
   - `/feedback [pesan]` — kirim manual learning
   - `/learnings` — lihat active learnings
   - `/analisa [foto]` — Quick Post (kirim foto produk)

2. **ReplyKeyboardMarkup** — tombol di bawah input:
   - `📊 Status` — `/status`
   - `📅 Jadwal` — `/jadwal`
   - `📸 Quick Post` — trigger quick post

3. **Inline Keyboard** — tombol dalam pesan:
   - `✅ Approve` — setujui gate
   - `🔄 Revisi` — minta revisi
   - `📸 Posting` — publish quick post
   - `❌ Skip` — skip konten

4. **Fallback teks bebas** — parsing manual kalo Gaulan ketik teks biasa.

### 8.7 Command Reference (Gaulan → Leader)

| Perintah / Input | Fungsi |
|------------------|--------|
| `approve` / klik ✅ Approve | Setujui gate saat ini |
| `revisi: [pesan]` / klik 🔄 Revisi | Minta revisi dengan catatan |
| `posting` / klik 📸 Posting | Langsung publish quick post |
| `skip` / klik ❌ Skip | Skip konten hari ini |
| `/status` / klik 📊 Status | Tanya status pipeline hari ini |
| `/jadwal` / klik 📅 Jadwal | Lihat jadwal minggu ini |
| `/feedback [pesan]` | Kirim manual learning |
| `/learnings` | Lihat semua active learnings |
| `/fallback` | Pindah ke pillar cadangan |
| Kirim foto | Trigger Quick Post (analisis foto langsung) |

### 8.8 Implementation Note

Parsing via `bot.on('message:text')` → `executeAction()` di leader.js:
- Jika pipeline aktif di gate → proses sebagai approval/revisi
- Jika tidak → cari command match
- Jika foto dikirim → proses sebagai Quick Post
- Fallback → kirim ke Leader agent LLM sebagai chat biasa

---

## 9. Integrasi Instagram Graph API

### 9.1 Prasyarat

- Facebook App (sudah tersedia)
- IG Business Account terhubung ke FB Page (sudah tersedia)
- Long-lived access token (sudah tersedia)
- Scope permissions: `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `pages_read_engagement`

### 9.2 Flow Publish

```
Create Media Container (POST /{ig-user-id}/media)
    → Dapat container_id
    ↓
Publish Media (POST /{ig-user-id}/media_publish?creation_id={container_id})
    → Dapat ig_post_id (media_id)
    ↓
Simpan ig_post_id ke content_pipeline
    ↓
(Optional) Ambil permalink: GET /{media_id}?fields=permalink
```

### 9.3 API Endpoints Reference

| Tujuan | Method | Endpoint | Catatan |
|--------|--------|----------|---------|
| Create image container | POST | `/{ig-user-id}/media` | `image_url`, `caption` |
| Create carousel container | POST | `/{ig-user-id}/media` | `media_type=CAROUSEL`, `children=[id1,id2]` |
| Publish container | POST | `/{ig-user-id}/media_publish` | `creation_id=container_id` |
| Get media insights | GET | `/{media-id}/insights` | `metric=saves,comments,reach,shares,profile_visits,follows` |
| Get media comments | GET | `/{media-id}/comments` | `fields=text,username,timestamp` |
| Get permalink | GET | `/{media-id}` | `fields=permalink` |

### 9.4 Error Handling

| Error Code | Artinya | Tindakan |
|------------|---------|----------|
| 190 | Invalid token | Minta Gaulan refresh token, pause pipeline |
| 400 (media ID invalid) | Container gagal | Retry 2x, lalu fail |
| 429 | Rate limit | Exponential backoff, log ke `provider_health` |
| 500 | Instagram internal error | Retry 3x dengan delay 30s |

### 9.5 Instagram API Rate Limit Policy

```
Instagram Graph API:
- 200 calls per user per hour (standard)
- 6,000 calls per user per day (business account)
- Retry-After header di 429 response

Untuk v1:
- Jadwalkan publish di jam berbeda
- Cache insights untuk Analysis agent
- Jangan fetch data berlebihan
```

---

## 10. Alokasi Provider AI (semua gratis)

### 10.1 Provider per Agent

| Agent | Provider Utama | Model | Fallback | Notes |
|-------|---------------|-------|----------|-------|
| Leader | OpenRouter free | `meta-llama/llama-3.1-70b-instruct` | Groq `llama-3.3-70b-versatile` | Tool calling via text |
| Idea agent | OpenRouter free | `meta-llama/llama-3.1-70b-instruct` | Groq `llama-3.3-70b-versatile` | Ollama lokal gak dipake (laptop tdk cukup) |
| Script agent | OpenRouter free | `meta-llama/llama-3.1-70b-instruct` | Groq `llama-3.3-70b-versatile` | — |
| Caption agent | OpenRouter free | `meta-llama/llama-3.1-70b-instruct` | Groq `llama-3.3-70b-versatile` | — |
| Image agent | Cloudflare Workers AI | Stable Diffusion XL (SDXL) | — | Hanya untuk AI-generated |
| Vision (QuickPost) | **Gemini native API** | `gemini-2.5-flash` | OpenRouter `nvidia/nemotron-nano-12b-v2-vl:free`, `google/gemma-4-31b-it:free` | **Gemini** via REST (`generateContent`), bukan OpenAI-compatible. Download foto → base64 → send inline |
| Publish agent | — | — | — | Tidak butuh LLM |
| Analysis agent | OpenRouter free | `qwen/qwen-2.5-72b-instruct:free` | Groq `llama-3.3-70b-versatile`, OpenRouter `meta-llama/llama-3.1-70b-instruct` | — |

### 10.2 Gemini Vision Detail (QuickPost)

Gemini tidak support OpenAI-compatible API untuk image input. Implementasi:

```javascript
// callGeminiNative() di src/llm/client.js
// 1. Convert OpenAI message format → Gemini contents array
// 2. System prompts: filter + gabung SEMUA ke user message pertama (messages.filter, bukan find)
// 3. Image URL → download → base64 → inline_data
// 4. POST ke: /v1beta/models/{model}:generateContent?key={API_KEY}
// 5. Parse response.candidates[0].content.parts[0].text
```

**System prompt merge fix**: Gemini tidak punya `role: system`. Awalnya `messages.find` hanya ambil system message **pertama** → prompt kedua (format JSON, brand context) hilang → LLM output teks bebas. Fix: `messages.filter` ambil **semua** system prompt, gabung, merge ke user message.

### 10.3 Provider Budget Monitoring

| Provider | Batas Gratis | Monitoring |
|----------|-------------|------------|
| OpenRouter | $1 credit awal, rate limited | Cek `provider_health` daily |
| Ollama lokal | Unlimited (lokal) | CPU/RAM monitoring |
| Cloudflare Workers AI | 10k requests/day (SDXL) | Cek usage dashboard |
| Groq | 30 req/min, 14400 req/day | `X-RateLimit-Remaining` header |
| Instagram API | 200 calls/hour, 6000/day | `X-App-Usage` response header |

### 10.3 Catatan Penting

> Ketersediaan model gratis di tiap provider berubah dari waktu ke waktu — cek ulang saat implementasi.

> Ollama lokal perlu resource: minimal 8GB RAM untuk Llama 3.1 8B (quantized). Jika laptop Gaulan tidak mencukupi, bisa fallback ke OpenRouter/Groq untuk Idea dan Caption agent.

> Cloudflare Workers AI: SDXL generation membutuhkan ~10-15 detik per gambar. Budget 10.000 request per hari gratis.

---

## 11. Rotasi Pilar Konten

### 11.1 Pilar Baseline (v1)

| Hari | Pilar | Butuh Foto Asli? | Fallback AI | Tujuan |
|------|-------|-----------------|-------------|--------|
| Senin | **Produk Highlight** — showcase kaos custom | Ya | Quote grafis promo | Trust produk |
| Selasa | **Tips/edukasi sablon** — cara rawat kaos, beda DTF & sablon manual | Tidak (AI) | — | Authority/ expertise |
| Rabu | **BTS Proses** — behind the scenes produksi | Ya | Konten AI visual storytelling | Trust proses |
| Kamis | **Promo/Quote Grafis** — inspirasi desain, promo musiman | Tidak (AI) | — | Engagement |
| Jumat | **Testimoni Customer** — review, unboxing, foto customer | Ya | Testimoni tekstual + grafis | Social proof |
| Sabtu | **Interaktif** — Q&A, polling, challenge | Tidak (AI) | — | Engagement |
| Minggu | **Fleksibel** — mengikuti rekomendasi Analysis agent | Campuran | — | Optimasi |

### 11.2 Cadangan AI-generated (Fallback)

Jika foto asli tidak tersedia sampai cutoff 18:00:

| Original Pillar | Fallback AI Pillar |
|-----------------|-------------------|
| Produk Highlight | "Kaos custom inspirasi — grafis quote + mockup AI" |
| BTS Proses | "Cerita visual AI: dari desain ke kaos jadi (ilustrasi)" |
| Testimoni Customer | "Rangkuman testimoni tekstual + grafis pendukung" |

### 11.3 Detail Final

> Detail final pilar & cadence, brand voice caption, dan batas jumlah revisi — disusun sambil jalan, tidak mengunci scope v1.

---

## 12. Mekanisme Belajar & Upgrade Diri

Bukan retraining model. Realisasinya:

### 12.1 Reflection Cycle Mingguan (Analysis Agent)

```
1. Fetch insights untuk post 3-7 hari terakhir
2. Hitung metrik trust per post
3. Bandingkan performa antar pilar
4. Bandingkan performa antara hook storytelling vs hook pertanyaan
5. Bandingkan performa visual AI vs foto asli (jika data cukup)
6. Tulis kesimpulan ke tabel `learnings`
7. Reflection: review learnings lama:
   - Confidence 'high' dengan bukti konsisten → pertahankan
   - Confidence 'low' tanpa bukti baru → turunkan atau hapus
   - Jika ada learnings baru yang bertentangan → selesaikan konflik (yang terbaru dengan evidence_count lebih tinggi menang)
8. Usulkan pergeseran prioritas pilar (opsional, disimpan di `content_calendar.priority_override`)
9. Leader kirim ringkasan ke Gaulan via Telegram
```

### 12.2 Cara Learnings Mempengaruhi Agent

```javascript
// Setiap agent membaca learnings aktif sebelum bekerja
async function getActiveLearnings(pillarName) {
  const { data } = await supabase
    .from('learnings')
    .select('*')
    .eq('status', 'active')
    .or(`pillar_related.eq.${pillarName},pillar_related.is.null`)
    .order('confidence', { ascending: false });
  
  return data;
}

// Contoh: Idea agent mendapat instruksi tambahan
// "Pertimbangkan learnings terbaru: 'Hook berbentuk pertanyaan pada konten BTS menghasilkan save rate 2x rata-rata'"
```

### 12.3 Brand Context Injection

Semua agent prompt (leader, idea, script, caption, analysis, quickpost) menggunakan placeholder `{brand_context}` yang di-replace dengan isi `src/templates/brand-context.txt` saat startup:

```javascript
// src/agents/leader.js (dan semua agent lain)
const brandContext = fs.readFileSync('src/templates/brand-context.txt', 'utf-8');
const prompt = template.replace('{brand_context}', brandContext);
```

**Isi brand-context.txt** (~80 lines):
- Identitas brand: Tulehu Inkline, kaos custom sablon & DTF
- Target market: pria & wanita 18-35, fashion kasual
- Brand personality: berani, autentik, gak perlu sok elit
- Unique selling points: sablon halus, harga terjangkau, desain bebas
- Preferred tone: santai tapi expert, gaul tapi trusted
- Call-to-action preferences
- Visual guidelines
- **Truth guard**: QuickPost prompt wajib deskripsikan foto apa adanya — jangan ngasumsi warna/detail yang gak keliatan. Ditambahkan setelah hallucination bug (LLM selalu tulis "kaos hitam" walau foto kaos putih).

### 12.4 QuickPost Vision Truth Guard

QuickPost menggunakan prompt khusus (`quickpost.txt`) dengan aturan ketat:

```
DESKRIPSIKAN FOTONYA SECARA AKURAT. JANGAN PERNAH ngasumsi warna,
bahan, atau detail yang gak keliatan di foto. Liat fotonya beneran,
tulis apa yang lo liat.
```

Plus system override di kode:
```javascript
{ role: 'system', content: 'KAMU WAJIB mendeskripsikan foto secara akurat...' }
```
Temperature diturunkan ke **0.3** untuk mengurangi hallucination.

### 12.5 Prompt Evolution (Future Enhancement)

Pola yang berulang kali terkonfirmasi (`confidence: high`, `based_on_post_count` > 10) bisa otomatis memengaruhi instruksi yang dibaca Idea/Script agent di siklus berikutnya, lewat query ke `learnings` sebelum tiap agent mulai bekerja.

---

## 13. Tech Stack & Project Structure

### 13.1 Tech Stack

| Layer | Tech | Alasan |
|-------|------|--------|
| **Runtime** | Node.js 18+ (LTS) | Familiar, async-native, npm ecosystem besar |
| **Language** | JavaScript (ESM) | Digunakan, bukan TypeScript — simpel untuk v1 |
| **Bot Framework** | `grammy` | v1.20+, middleware support |
| **Scheduler** | `node-cron` | Ringan, no dependency, native Node.js |
| **Database** | Supabase (PostgreSQL) | Realtime, REST API, SQL editor |
| **ORM** | Supabase JS Client | Langsung, tanpa ORM tambahan |
| **LLM Client** | Custom (`callWithFailover`) | OpenAI-compatible (OpenRouter, Groq) + **Gemini native** (REST langsung, bukan OpenAI format) |
| **Vision** | Gemini REST API (`generateContent`) | Download foto → base64 → inline_data. Bukan OpenAI-compatible. |
| **Image Gen** | Cloudflare Workers AI REST API | Gratis, serverless, SDXL |
| **Instagram API** | fetch langsung | Tidak perlu SDK |
| **State Machine** | Custom (native JS) | Full control, simpel untuk kompleksitas v1 |

### 13.2 Project Structure

```
tulehu-social-agent/
├── src/
│   ├── index.js                 # Entry point
│   ├── config.js                # Environment variables, constants, agentProviders chains
│   ├── telegram/
│   │   ├── bot.js               # Bot init, inline keyboard, setMyCommands, routing
│   ├── scheduler/
│   │   └── daily.js             # Cron harian (0 9 * * *), handleAutoTimeout, auto modes
│   ├── agents/
│   │   ├── leader.js            # Leader/orchestrator: executeAction, handleQuickPost, handleFeedback, saveLearning, gatherContext
│   │   ├── idea.js              # Idea agent (loads brand-context.txt)
│   │   ├── script.js            # Script agent (loads brand-context.txt)
│   │   ├── image.js             # Image generator agent
│   │   ├── caption.js           # Caption agent (loads brand-context.txt)
│   │   └── analysis.js          # Analysis/Intel agent (loads brand-context.txt)
│   ├── engine/
│   │   └── pipeline.js          # State machine: getAutoMode, autoContinuePipeline, autoPipelineToEnd, fallbackPipeline
│   ├── llm/
│   │   └── client.js            # callWithFailover, rateLimitRetry, callGeminiNative (vision REST)
│   ├── platforms/
│   │   └── instagram.js         # Instagram Graph API: createMediaContainer, publishMediaContainer, getMedia, checkTokenExpiry
│   ├── db/
│   │   ├── supabase.js          # Supabase client + in-memory fallback for conversation_history
│   │   └── migrations/
│   │       ├── 001_init.sql
│   │       ├── 002_learnings.sql
│   │       └── 003_conversation_history.sql
│   ├── utils/
│   │   └── helpers.js           # escapeMarkdown, sleep, etc.
│   └── templates/
│       ├── brand-context.txt    # Central brand guide (~80 lines), injected via {brand_context}
│       └── prompts/
│           ├── idea.txt
│           ├── script.txt
│           ├── caption.txt
│           ├── analysis.txt
│           ├── leader.txt       # Short, token-efficient, max 2-3 kalimat
│           └── quickpost.txt    # Strict JSON output, vision-based, truth guard
├── prd-tulehu-social-agent.md
├── .env
├── package.json
└── README.md
```

### 13.3 Key Dependencies (package.json)

```json
{
  "name": "tulehu-social-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "migrate": "node src/db/migrations/run.js",
    "test": "node --test tests/",
    "lint": "eslint src/"
  },
  "dependencies": {
    "grammy": "^1.20.0",
    "node-cron": "^3.0.3",
    "@supabase/supabase-js": "^2.45.0",
    "openai": "^4.60.0",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0",
    "zod": "^3.23.0",
    "pino": "^9.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

## 14. Setup & Environment

### 14.1 Prasyarat

- Node.js 18+ 
- npm / pnpm
- Ollama (untuk lokal LLM) — optional jika mau fallback ke API
- Supabase account (gratis)
- Telegram Bot Token (dari @BotFather)
- Instagram Business Account + Facebook App + Access Token

### 14.2 Environment Variables (.env)

```bash
# ─── APP ───────────────────────────────────────
NODE_ENV=development
LOG_LEVEL=info

# ─── TELEGRAM ───────────────────────────────────
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_OWNER_CHAT_ID=your_chat_id_here

# ─── SUPABASE ───────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# ─── OPENROUTER ────────────────────────────────
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
OPENROUTER_MODEL=open-orc/poseidon

# ─── OLLAMA (local) ────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# ─── GROQ ──────────────────────────────────────
GROQ_API_KEY=gsk_xxxxxxxx
GROQ_MODEL=llama-3.1-70b-versatile

# ─── CLOUDFLARE WORKERS AI ─────────────────────
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
# SDXL model name (default)
CLOUDFLARE_AI_MODEL=@cf/stabilityai/stable-diffusion-xl-base-1.0

# ─── INSTAGRAM GRAPH API ───────────────────────
IG_USER_ID=your_ig_business_account_id
IG_ACCESS_TOKEN=your_long_lived_access_token
IG_APP_ID=your_fb_app_id
IG_APP_SECRET=your_fb_app_secret

# ─── PIPELINE ──────────────────────────────────
CUTOFF_HOUR=18
RECHECK_INTERVAL_MINUTES=30
MAX_RECHECKS=4

# ─── SCHEDULER ─────────────────────────────────
DAILY_PUBLISH_CRON=0 9 * * *
WEEKLY_ANALYSIS_CRON=0 20 * * 0
```

### 14.3 Setup Langkah demi Langkah

```bash
# 1. Clone project
git clone https://github.com/gaulan/tulehu-social-agent.git
cd tulehu-social-agent

# 2. Install dependencies
npm install

# 3. Copy env
cp .env.example .env
# Edit .env dengan credentials lo

# 4. Setup Supabase
# Login ke https://supabase.com
# Buat project baru
# Jalankan SQL dari src/db/migrations/001_init.sql

# 5. Setup Ollama (lokal, optional)
# Install dari https://ollama.ai
ollama pull llama3.1:8b

# 6. Setup Ollama (lokal, optional)
# Install dari https://ollama.ai

# 7. Run migrations
npm run migrate

# 8. Seeder content_calendar
node src/db/seed.js

# 9. Start
npm run dev
```

### 14.4 Cron Schedule (Manual via node-cron, bukan system cron)

```javascript
// src/scheduler/daily.js
import cron from 'node-cron';
import { startPipeline } from '../engine/pipeline.js';

// Default: setiap hari jam 09:00 WIT (UTC+9)
export function startDailyScheduler() {
  cron.schedule(process.env.DAILY_PUBLISH_CRON, async () => {
    console.log('[Scheduler] Trigger pipeline harian...');
    await startPipeline(new Date());
  }, {
    timezone: "Asia/Jayapura"
  });
}

// src/scheduler/weekly.js
import cron from 'node-cron';
import { runAnalysis } from '../agents/analysis.js';

// Default: setiap Minggu jam 20:00 WIT
export function startWeeklyScheduler() {
  cron.schedule(process.env.WEEKLY_ANALYSIS_CRON, async () => {
    console.log('[Scheduler] Trigger analysis mingguan...');
    await runAnalysis();
  }, {
    timezone: "Asia/Jayapura"
  });
}
```

---

## 15. Error Handling & Retry

### 15.1 Retry Logic per Agent

| Agent | Max Retries | Delay | Exponential Backoff |
|-------|-------------|-------|---------------------|
| Leader | 3 | 5s | Ya |
| Idea agent | 2 | 3s | Ya |
| Script agent | 3 | 5s | Ya |
| Image agent | 2 | 10s | Ya (karena generate image lambat) |
| Caption agent | 2 | 3s | Ya |
| Publish agent | 3 | 30s | Ya (karena Instagram API rate limit) |
| Analysis agent | 2 | 10s | Ya |

### 15.2 Exponential Backoff Implementation

```javascript
async function retry(fn, maxRetries = 3, baseDelay = 5000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (error.status === 429) {
        // Rate limited — extract Retry-After
        const retryAfter = parseInt(error.headers?.['retry-after']) || 60;
        console.log(`[Retry] Rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }
      
      if (attempt === maxRetries) break;
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`[Retry] Attempt ${attempt}/${maxRetries} failed. Waiting ${delay}ms...`);
      await sleep(delay + Math.random() * 1000); // Jitter
    }
  }
  
  throw lastError;
}
```

### 15.3 Pipeline Failure Handling

| Status | Artinya | Tindakan |
|--------|---------|----------|
| `failed` | Gagal setelah retry maksimal | Leader kirim notifikasi error ke Gaulan. Pipeline berhenti di sini. Gaulan bisa manual trigger resume besok |
| `timeout` | Melebihi batas waktu | Sama seperti failed. Kalau error di Image agent karena terlalu lama, bisa dicoba ulang manual |

---

## 16. Provider Failover Strategy

### 16.1 Chain of Responsibility

Setiap agent punya daftar provider dalam urutan prioritas. Jika provider utama gagal (rate limit, down, error), coba provider berikutnya.

```javascript
const agentProviders = {
  leader: [
    { provider: 'openrouter', model: 'open-orc/poseidon' },
    { provider: 'opencode', model: 'deepseek-v4-flash' },
    { provider: 'groq', model: 'llama-3.1-70b-versatile' },
  ],
  script: [
    { provider: 'openrouter', model: 'deepseek-v4-flash' },
    { provider: 'groq', model: 'mixtral-8x7b-32768' },
    { provider: 'ollama', model: 'llama3.1:8b' },
  ],
  idea: [
    { provider: 'ollama', model: 'llama3.1:8b' },
    { provider: 'openrouter', model: 'open-orc/poseidon' },
  ],
  caption: [
    { provider: 'ollama', model: 'llama3.1:8b' },
    { provider: 'groq', model: 'llama-3.1-8b-instant' },
  ],
  // ...
};
```

### 16.2 Provider Health Check

```javascript
async function getAvailableProvider(agentName) {
  const providers = agentProviders[agentName];
  
  for (const p of providers) {
    const health = await supabase
      .from('provider_health')
      .select('status')
      .eq('provider_name', p.provider)
      .single();
    
    if (health.data?.status !== 'down') {
      return p;
    }
  }
  
  // Semua down — throw error
  throw new Error(`Semua provider untuk ${agentName} sedang down`);
}
```

---

## 17. Ringkasan Keputusan Diskusi

- ✅ Bangun sendiri (custom backend), bukan pakai Hermes Agent — alasan: kebutuhan inti berupa stateful pause-resume workflow tidak match dengan pola reaktif Hermes, dan Gaulan sudah punya building block yang relevan dari project-project sebelumnya
- ✅ Backend murni, tanpa frontend — semua interaksi lewat Telegram
- ✅ Approval 2 gate (naskah, lalu final)
- ✅ Kalender hybrid (rotasi + data-driven)
- ✅ Provider terpisah per agent, semua gratis
- ✅ Model build: DeepSeek V4 Flash (fallback: Nemotron / Mixtral di OpenRouter free tier)
- ✅ Provider failover chain — jika satu provider down, coba provider lain secara otomatis
- ✅ State machine berbasis Supabase — pipeline bisa pause-resume berapa lama pun
- ✅ Metrik trust (bukan viral) — fokus: saves, kualitas komentar, profile visit → follow

---

## 18. Langkah Implementasi

### Fase 1: Foundation (Estimasi: 3-4 hari)

1. Setup project structure + dependencies
2. Setup Supabase + run migrations
3. Setup Telegram bot + webhook handler
4. Test komunikasi Leader agent → Gaulan

### Fase 2: Pipeline Core (Estimasi: 5-7 hari)

5. Implementasi Publish agent (Graph API) — paling mudah divalidasi karena tidak bergantung LLM
6. Bangun state machine engine (pipeline.js)
7. Bangun scheduler (daily + weekly)
8. Implementasi Idea → Script → approval gate 1

### Fase 3: Content Production (Estimasi: 4-5 hari)

9. Implementasi Image agent (Cloudflare Workers AI + fallback foto asli)
10. Implementasi Caption agent (paralel dengan Image)
11. Implementasi approval gate 2
12. Uji end-to-end dengan 1 pilar dulu

### Fase 4: Intelligence (Estimasi: 3-4 hari)

13. Audit retroaktif awal (Analysis agent baca histori yang ada)
14. Implementasi analysis mingguan + reflection cycle
15. Seeder content_calendar dengan 7 pilar
16. Uji full flow 7 hari

### Total Estimasi: 15-20 hari

---

## 19. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Free provider rate limit/hilang | Pipeline gagal | Provider failover chain; log ke `provider_health` untuk monitoring |
| Instagram API token expired | Publish gagal | Token long-lived (60 hari). Calendar reminder + notifikasi Gaulan untuk refresh |
| Laptop mati/mati listrik | Pipeline pause | Hosting lokal (v1) — resiko diterima. Pipeline bisa resume dari state terakhir saat laptop nyala lagi |
| LLM hallucination (output tidak sesuai) | Konten salah | 2 approval gate manual, Gaulan sebagai gatekeeper |
| Ollama tidak bisa jalan di laptop (RAM kurang) | Idea & Caption agent tidak bisa pakai lokal | Fallback ke OpenRouter/Groq untuk agent tersebut |
| Gaulan lupa approve | Pipeline stuck | Cutoff + fallback ke AI pillar. Leader kirim reminder otomatis tiap 30 menit (max 4x) |
| File foto tidak sesuai harapan | Asset berkualitas rendah | Leader minta ulang dengan deskripsi lebih detail |
| Biaya provider gratis berubah | Cost tiba-tiba | Pantau `provider_health`, siapkan opsi paid tier kalau perlu |

---

## 20. Glosarium

| Istilah | Definisi |
|---------|----------|
| **Agent** | Modul/fungsi yang menjalankan satu tugas spesifik (misal: generate script, generate gambar) |
| **Approval Gate** | Titik di mana Gaulan harus approve atau revisi sebelum pipeline lanjut |
| **Callback** | Fungsi yang dipanggil saat event terjadi (misal: saat bot menerima pesan) |
| **Confidence** | Tingkat keyakinan Analysis agent terhadap suatu learning (`low`/`medium`/`high`) |
| **Content Pipeline** | Alur produksi per konten: ide → script → asset → caption → approval → publish |
| **Cutoff Time** | Batas waktu menunggu foto asli sebelum fallback ke AI-generated |
| **Exponential Backoff** | Strategi retry dengan delay yang meningkat secara eksponensial |
| **Fallback Pillar** | Pilar konten AI-generated yang digunakan jika pilar utama butuh foto asli tapi tidak tersedia |
| **Gatekeeper** | Peran Gaulan sebagai penjaga kualitas sebelum konten dipublish |
| **Learning** | Kesimpulan dari Analysis agent yang disimpan di tabel `learnings` |
| **Leader Agent** | Orkestrator utama yang mengelola pipeline dan berkomunikasi dengan Gaulan |
| **Long-lived Token** | Instagram API token yang berlaku 60 hari (vs short-lived 1 jam) |
| **Metrik Trust** | Metrics yang mengukur tingkat kepercayaan calon customer (saves, comments quality, profile visits) |
| **Pilar Konten** | Tema konten yang dirotasi per hari (contoh: Produk Highlight, BTS Proses, Testimoni) |
| **Pipeline** | Alur produksi dari ide sampai publish, tersimpan sebagai state machine |
| **Provider** | Layanan AI/API yang digunakan agent (OpenRouter, Groq, Ollama, Cloudflare, dll) |
| **Reflection Cycle** | Proses mingguan Analysis agent: review learning, hapus yang tidak relevan, update yang baru |
| **Scheduler** | Cron job yang trigger pipeline harian dan analysis mingguan |
| **State Machine** | Model status yang mendefinisikan transisi pipeline (idea → script_drafted → ... → published) |
| **Stateful** | Sistem yang menyimpan state antarlangkah — bisa pause dan resume |

---

## Versi Dokumen

| Versi | Tanggal | Perubahan |
|-------|---------|-----------|
| 1.0 | — | Initial PRD |
| 1.1 | — | Added: Project structure, tech stack, setup guide, error handling, provider failover, risk mitigation, glossary, rate limit policy, cutoff logic, API reference |
| 1.2 | 20 Jul 2026 | **Implemented changes:** Quick Post feature (vision → generate → publish), auto pipeline modes (full_auto/semi_auto/manual_fallback), inline keyboard menu, conversation_history with in-memory fallback, brand-context.txt injection, Gemini native vision API (not OpenAI), rate-limit retry + failover delay, JSON parsing fallback with regex, `callGeminiNative` merge fix (`.filter` instead of `.find`), pipeline stuck auto-reset, leader prompt max 2-3 kalimat, learning system auto-save + `/feedback`, Instagram token expiry checker |

---

*Dokumen ini siap untuk memulai implementasi. Untuk perubahan/update, update versi dan catat di tabel di atas.*
