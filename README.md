# Tulehu Social Agent — SWAT Team 🚀

Sistem **Social Media SWAT Team** untuk Tulehu Inkline — produksi konten Instagram otomatis dari ide sampai publish.

**Arsitektur:** Multi-agent system dengan Leader Agent sebagai orkestrator via Telegram.

---

## 📋 Prasyarat

- **Node.js 18+**
- **Supabase account** (gratis di [supabase.com](https://supabase.com))
- **Telegram Bot Token** (dari [@BotFather](https://t.me/BotFather))
- **Instagram Business Account** + Facebook App + Long-lived Access Token
- **(Optional) Ollama** untuk LLM lokal ([ollama.ai](https://ollama.ai))

---

## ⚙️ Setup

### 1. Clone & Install

```bash
git clone https://github.com/gaulan/tulehu-social-agent.git
cd tulehu-social-agent
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env
# Edit .env dengan credentials lo
```

### 3. Database (Supabase)

```bash
# Login ke Supabase → SQL Editor → jalankan:
# src/db/migrations/001_init.sql
```

Atau via CLI:

```bash
npm run migrate  # (butuh Supabase RPC exec_sql enabled)
```

### 4. Seed Calendar

```bash
npm run seed
```

### 5. Start

```bash
npm run dev    # Development (auto-restart)
npm run start  # Production
```

---

## 🏗️ Struktur Project

```
src/
├── index.js              # Entry point
├── config.js             # Environment config & constants
├── telegram/
│   ├── bot.js            # Telegram bot + Leader Agent
│   └── templates.js      # Message templates
├── agents/
│   ├── idea.js           # Idea Agent (Research)
│   ├── script.js         # Script Agent (Writer)
│   ├── image.js          # Image Agent (Visual)
│   ├── caption.js        # Caption Agent (Wordsmith)
│   ├── publish.js        # Publish Agent (Instagram)
│   └── analysis.js       # Analysis Agent (Intel)
├── engine/
│   ├── pipeline.js       # State machine pipeline
│   ├── retry.js          # Exponential backoff per agent
│   └── fallback.js       # Cutoff time & fallback pillar logic
├── llm/
│   └── client.js         # LLM client (OpenAI-compatible)
├── scheduler/
│   ├── daily.js          # Cron harian
│   └── weekly.js         # Cron mingguan
├── db/
│   ├── supabase.js       # Supabase client & queries
│   ├── migrate.js        # Migration runner
│   ├── seed.js           # Calendar seeder
│   └── migrations/
│       ├── 001_init.sql  # Initial schema
│       └── 002_patch_insights.sql
├── templates/
│   └── prompts/          # LLM prompt templates (.txt files)
├── utils/
│   ├── helpers.js        # Utility functions (sleep)
│   ├── logger.js         # Logger (pino)
│   └── parser.js         # Telegram reply parser
```

---

## 🤖 Agent Roles

| Agent | Call Sign | Provider | Tugas |
|-------|-----------|----------|-------|
| **Leader** | COMMANDER | OpenRouter | Orkestrator, komunikasi dgn Gaulan |
| **Idea** | SCOUT | Ollama lokal | Riset, ide konten |
| **Script** | SCRIBE | OpenRouter | Nulis hook + isi + CTA |
| **Image** | PIXEL | Cloudflare Workers AI | Generate gambar |
| **Caption** | WORDSMITH | Ollama lokal | Caption + hashtag |
| **Publish** | DEPLOYER | — | Post ke Instagram |
| **Analysis** | INTEL | Groq | Evaluasi performa mingguan |

---

## 📱 Telegram Commands

| Command | Fungsi |
|---------|--------|
| `/start` | Informasi bot |
| `/run` | Jalankan pipeline hari ini |
| `/status` | Cek status pipeline |
| `/jadwal` | Lihat jadwal mingguan |
| `/pause` | Pause pipeline |
| `/resume` | Resume pipeline |
| `/skip` | Skip konten hari ini |
| `/analysis` | Jalankan analysis mingguan |

### Approval Gates

| Gate | Waktu | Format Pesan |
|------|-------|-------------|
| **Gate 1** | Script selesai | Balas `"approve"` atau `"revisi: [pesan]"` |
| **Gate 2** | Preview final (gambar + caption) | Balas `"approve"` atau `"revisi: [pesan]"` |

---

## 🗓️ Content Calendar (Baseline)

| Hari | Pilar | Foto? | Fallback |
|------|-------|-------|----------|
| Senin | Produk Highlight | 📸 Ya | Quote grafis |
| Selasa | Tips/edukasi sablon | 🎨 AI | — |
| Rabu | BTS Proses | 📸 Ya | AI storytelling |
| Kamis | Promo/Quote Grafis | 🎨 AI | — |
| Jumat | Testimoni Customer | 📸 Ya | Testimoni tekstual |
| Sabtu | Interaktif (Q&A/polling) | 🎨 AI | — |
| Minggu | Fleksibel (rekomendasi Analysis) | Campuran | — |

---

## 🔄 Pipeline Flow

```
Scheduler → Idea Agent → Script Agent → Gate 1 (Gaulan)
  → Image Agent (parallel) → Caption Agent (parallel)
  → Gate 2 (Gaulan) → Publish Agent → ✅
```

---

## 📦 Teknologi

| Komponen | Tech |
|----------|------|
| Runtime | Node.js 18+ (JavaScript) |
| Bot | Grammy (Telegraf fork) |
| Database | Supabase (PostgreSQL) |
| LLM Client | OpenAI-compatible (OpenRouter/Groq/Ollama) |
| Image Gen | Cloudflare Workers AI (SDXL) |
| Scheduler | node-cron |
| Logging | Pino |

---

## 📊 Provider AI (Semua Gratis)

| Provider | Agent | Limit |
|----------|-------|-------|
| OpenRouter | Leader, Script | $1 initial credit |
| Ollama lokal | Idea, Caption | Unlimited |
| Cloudflare Workers AI | Image | 10.000 req/day |
| Groq | Analysis | 30 req/min, 14.400/day |

---

## 🛡️ Error Handling

- **Exponential backoff** — setiap agent punya retry logic (lihat `src/engine/retry.js`)
- **Cutoff time fallback** — switch otomatis ke AI pillar jika foto asli telat (lihat `src/engine/fallback.js`)
- **Provider failover** — jika provider A down, coba B
- **Pipeline stateful** — pause/resume dari status terakhir
- **Provider health tracking** — tabel `provider_health`

---

## 📄 License

MIT — Tulehu Inkline 2024
