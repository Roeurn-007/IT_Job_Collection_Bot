# 🚀 IT Job Collection Telegram Bot & Web Dashboard

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram_Bot-API_0.66-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![Supabase](https://img.shields.io/badge/Database-Supabase_PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Render](https://img.shields.io/badge/Deploy-Render_Ready-46E3B7?style=for-the-badge&logo=render&logoColor=black)](https://render.com)
[![Express](https://img.shields.io/badge/Web_UI-Express_Dashboard-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)

An automated enterprise-grade Telegram scraper, IT job intelligence engine, and real-time Web Dashboard. The system monitors **59+ public Cambodian recruitment channels**, filters posts against **177+ technical keywords**, standardizes timestamps to Cambodia Local Time (`Asia/Phnom_Penh`), syncs to **Supabase PostgreSQL**, and forwards curated job alerts to target Telegram channels and groups.

---

## 📑 Table of Contents
- [Architecture & Data Flow](#-architecture--data-flow)
- [Key Features](#-key-features)
- [Web Dashboard Preview](#-web-dashboard-preview)
- [Quick Start & Installation](#-quick-start--installation)
- [Supabase Cloud Database Setup](#-supabase-cloud-database-setup)
- [Deploying to Render](#-deploying-to-render)
- [Telegram Bot Commands](#-telegram-bot-commands)
- [Customizable Expiration & Retention](#-customizable-expiration--retention)
- [Group Auto-Moderation & BotFather Setup](#-group-auto-moderation--botfather-setup)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Project Directory Structure](#-project-directory-structure)

---

## 🏗 Architecture & Data Flow

```
                      ┌──────────────────────────────────────────────┐
                      │    59+ Telegram Channels (t.me/s/<channel>)  │
                      └──────────────────────┬───────────────────────┘
                                             │
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │         Paced Batch Scraper Engine           │
                      │  • 4 channels/batch • 1.5s delay             │
                      │  • 90s cycle loop   • Overlap Mutex Lock     │
                      │  • 12s timeout      • 1-retry backoff        │
                      └──────────────────────┬───────────────────────┘
                                             │
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │       Intelligence & Filtering Engine        │
                      │  • 177+ IT Keywords (Dev, AI, Cloud, etc.)   │
                      │  • Anti-False-Positive regex heuristics      │
                      │  • Post Age Filter (Default: ≤ 30 days)      │
                      │  • In-Memory Deduplication (Seen Posts)      │
                      └──────────────────────┬───────────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │                                           │
                       ▼                                           ▼
         ┌───────────────────────────┐               ┌───────────────────────────┐
         │   Telegram Forwarder      │               │   Persistence & Database  │
         │ • Group Sinks (Supergroup)│               │ • Supabase Cloud Postgres │
         │ • Admin Direct Message    │               │ • Local JSON Fallback     │
         │ • Forward Mode Dispatch   │               │ • Full Date Preservation  │
         └───────────────────────────┘               └─────────────┬─────────────┘
                                                                   │
                                                                   ▼
                                                     ┌───────────────────────────┐
                                                     │    Express Web Dashboard  │
                                                     │ • http://localhost:3000   │
                                                     │ • Search, Filters & Stats │
                                                     │ • Auto 60-Day Expiry      │
                                                     └───────────────────────────┘
```

---

## ✨ Key Features

- **📡 Anti-Throttling Multi-Channel Scraper**:
  - Scrapes 59 top Cambodian recruitment channels (ABA, Canadia, CamHR, Jobify, MEF GDDE, Smart Axiata, Wing, Chip Mong, etc.).
  - Paced batch architecture (`BATCH_SIZE = 4`, `BATCH_DELAY_MS = 1500ms`) with an overlap lock mutex and 90-second scraping intervals to prevent IP rate-limiting (`fetch failed`).
  - Automatic channel name sanitization (strips `t.me/`, `@`, and leading/trailing slashes).

- **🧠 High-Precision IT Keyword Matching**:
  - Evaluates posts against 177 technical keywords (Full Stack, Node.js, Python, Flutter, React, Cyber Security, DevOps, AI/ML, Cloud, QA, Database Admin, etc.).
  - Pre-scrubs URLs, usernames, and emails to eliminate false positive matches.

- **💾 Dual Cloud & Local Persistence (Supabase + Local Storage)**:
  - Real-time upsert to Supabase PostgreSQL database tables (`jobs`, `channels`, `keywords`, `seen_posts`, `sources`, `bot_settings`).
  - Graceful fallback: If Supabase credentials are not provided, system operates seamlessly using local JSON storage (`storage/collected.json`).
  - Automatic migration script (`npm run migrate:supabase`) pushes all 133+ historical jobs, channels, and keywords with zero data loss.

- **🗓️ 60-Day (2-Month) Expiration Retention**:
  - Automatically cleans up jobs older than 60 days from Supabase and the Web Dashboard.
  - **Important**: Messages in Telegram groups and channels are **never deleted**, ensuring your community job archive stays complete.
  - Retention duration is customizable directly in Telegram chat (`/setexpiry <days>`, `/expiry`, or through the `/admin` interactive menu).

- **🛡️ Channel & Group Sink Auto-Moderation**:
  - Keeps destination job groups 100% spam-free.
  - Admins can freely post announcements and chat.
  - Unprivileged member chatter, images, stickers, and spam are instantly removed.
  - Public member commands (`/status`, `/recent`, `/channels`) are replied to via private DM with user notification self-deleting after 5 seconds.

- **🌐 Modern Web Dashboard**:
  - Light & Dark mode toggle.
  - Instant live search by title, company, skills, or salary.
  - Modal viewer with full job descriptions, source links, and flyer previews.
  - Dynamic export to JSON and CSV.
  - Interactive manual refresh and database cleanup triggers.

- **☁️ 100% Ready for Render Cloud Deployment**:
  - `render.yaml` Blueprint file included.
  - Built-in 14-minute anti-sleep ping for Render Free tier.
  - Graceful `SIGTERM` / `SIGINT` shutdown handling prevents `409 Conflict: terminated by other getUpdates request` on rolling deploys.
  - Health check endpoint `/api/health` for uptime monitors.

---

## 🚀 Quick Start & Installation

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18.0.0 or higher
- A Telegram account and Bot Token from [@BotFather](https://t.me/BotFather)

### 2. Clone and Install Dependencies
```bash
git clone https://github.com/Roeurn-007/IT_Job_Collection_Bot.git
cd IT_Job_Collection_Bot
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Open `.env` and fill in your credentials:
```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
ADMIN_CHAT_ID=your_telegram_user_id
SINK_CHAT_ID=-100xxxxxxxxxx

# Scraper & Expiration Settings
MAX_AGE_DAYS=30
SCRAPE_INTERVAL_SECONDS=90
EXPIRY_DAYS=60

# Web Server
PORT=3000
NODE_ENV=production

# Supabase Cloud Database (Optional)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_service_role_or_anon_key
```

### 4. Start the Application
```bash
# Start bot and dashboard
npm start

# For local development with live reload:
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 🗄️ Supabase Cloud Database Setup

This bot can use Supabase PostgreSQL for cloud-native persistence, making it persistent across server restarts and container redeployments.

### 1. Create a Supabase Project
1. Go to [database.new](https://database.new) and create a free project.
2. In your Supabase Dashboard, navigate to **SQL Editor**.

### 2. Run the Database Schema
1. Open the file [`supabase_schema.sql`](file:///c:/Users/USER/Desktop/IT%20Job%20Collection%20Bot/supabase_schema.sql) in this repository.
2. Paste the SQL script into the Supabase SQL Editor and click **Run**.
3. This creates:
   - `jobs` (collected job listings with exact ISO timestamps)
   - `channels` (monitored Telegram channels)
   - `keywords` (IT filter terms)
   - `seen_posts` (deduplication hashes)
   - `sources` (monitored source chats)
   - `bot_settings` (runtime configuration keys)
   - `purge_expired_jobs(days_threshold)` stored procedure.

### 3. Migrate All Historical Data to Supabase
Run the automated migration tool to sync all existing 133+ historical jobs, 59 channels, and 177 keywords into your database:
```bash
npm run migrate:supabase
```

---

## ☁️ Deploying to Render

Deploying this bot to [Render](https://render.com) takes under 3 minutes.

### Option A: Using Render Blueprint (Recommended)
1. Fork or push this repository to your GitHub account.
2. In the Render Dashboard, click **New +** > **Blueprint**.
3. Select this repository. Render will automatically read [`render.yaml`](file:///c:/Users/USER/Desktop/IT%20Job%20Collection%20Bot/render.yaml) and configure:
   - Web Service in Singapore region (`sin`) for lowest latency to Southeast Asia.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check: `/api/health`
4. Enter your environment variables (`TELEGRAM_BOT_TOKEN`, `ADMIN_CHAT_ID`, `SINK_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_KEY`).
5. Click **Apply**.

### Option B: Manual Web Service Setup
1. Click **New +** > **Web Service**.
2. Connect your GitHub repository.
3. Configure the following:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
4. Add the environment variables from your `.env` file under the **Environment** tab.

> [!TIP]
> **Anti-Sleep Keep-Alive**: Free-tier Render services sleep after 15 minutes of inactivity. This bot includes a built-in keep-alive pinger in `src/server.js` that pings its own `/api/health` route every 14 minutes using `RENDER_EXTERNAL_URL`, keeping your Telegram bot and scraper awake 24/7 at no cost.

---

## 🤖 Telegram Bot Commands

### 👑 Administrator Commands
| Command | Arguments | Description |
| :--- | :--- | :--- |
| `/admin` | — | Open the interactive Telegram Admin Control Panel with button menus. |
| `/status` | — | Display bot diagnostic metrics, Supabase status, channel count, and retention settings. |
| `/groupchat` | `[on\|off]` | View or toggle normal member group chat permission (open / restricted). |
| `/allowchat` | — | Allow normal members to chat freely in the group (disables auto-deletion). |
| `/blockchat` | — | Restrict group to jobs only (enables auto-deletion of non-admin chat). |
| `/expiry` | — | View current database expiration retention window. |
| `/setexpiry` | `<days>` | Set custom expiration retention (e.g. `/setexpiry 60`, `/setexpiry 90`). |
| `/cleanup` | `[days]` | Manually trigger purge of expired jobs from DB and Web Dashboard. |
| `/maxage` | `[days]` | View or update max post age filter (1–365 days; default: 30 days). |
| `/forwardjobs` | `<count>` | Forward custom number of recent jobs to group sinks on demand. |
| `/sinkmode` | — | Switch delivery target: `group` (default), `admin`, or `both`. |
| `/sink` | — | Display all active destination sinks and forwarding configuration. |
| `/addsink` | `<chat_id>` | Add a new Telegram group or channel chat ID as a destination sink. |
| `/removesink` | — | Interactively remove an active destination sink. |
| `/channels` | — | View list of all 59 monitored Telegram channels. |
| `/addchannel` | `<username>`| Add a new public channel to the scraper loop. |
| `/removechannel`| `<username>`| Remove a channel from the scraper loop. |
| `/keywords` | — | View all active IT filter keywords. |
| `/addkeyword` | `<terms>` | Add single or comma-separated keywords (e.g. `/addkeyword AI, LangChain`). |
| `/removekeyword`| `<term>` | Remove a keyword from the filter. |
| `/cancel` | — | Cancel any pending interactive prompt or wizard. |

### 👥 Public Member Commands (Group & DM)
| Command | Description |
| :--- | :--- |
| `/status` | Check if bot is online and view monitored channel stats. |
| `/recent` | View recent IT job opportunities directly in bot DM. |
| `/channels`| View public recruitment channels monitored by the bot. |

---

## ⏳ Customizable Expiration & Retention

The bot features a 2-month (60-day) data retention cycle designed to keep your database and Web Dashboard fast and relevant:

1. **Automatic Daily Purge**:
   - Every 24 hours (and at system startup), jobs older than the expiration window (`EXPIRY_DAYS`, default: 60) are removed from Supabase and the Web Dashboard.
2. **Telegram Messages Are 100% Preserved**:
   - The cleanup only deletes records from the database and Web UI. **No messages in Telegram channels or groups are ever deleted**.
3. **Change Retention Duration Anytime**:
   - Via Chat: Send `/setexpiry 45` or `/setexpiry 90`.
   - Via Admin Menu: Send `/admin` > Click **"⏳ Expiry (60d)"** > Select `30 Days`, `60 Days`, `90 Days`, `180 Days`, or enter a custom day count.
   - Via Web API: `POST /api/cleanup?days=60`.

---

## 🛡️ Group Auto-Moderation & Chat Permission Toggle

The bot includes an intelligent group moderation engine to keep your job broadcast channels clean, while giving administrators full control over whether normal members can chat.

### Moderation Modes:
- **🔒 Restricted Mode (Default)**:
  Non-admin messages, photos, files, and stickers sent in the group are immediately deleted. The bot responds with a polite 15-second redirect notice and inline button linking to the bot DM, then auto-cleans the notice.
- **🔓 Allowed Mode (Open Chat)**:
  Non-admin members can chat, discuss, and send text freely in the group. The bot will NOT auto-remove their messages.

### How to Toggle Group Chat:
- **Via Admin Control Panel**: Send `/admin` > Click **"💬 Chat: 🔒 Restricted"** (or **"💬 Chat: 🔓 Open"**) > Select mode.
- **Via Direct Commands**: Send `/allowchat` to open chat, or `/blockchat` to restrict it to jobs only.

### BotFather Setup (Required for Group Moderation)
1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send the command:
   ```
   /setprivacy
   ```
3. Select your bot.
4. Choose **`Disable`**.
   > *Why? This allows the bot to inspect and moderate incoming text messages in your group.*
5. Add the bot to your Telegram group as an **Administrator** with the following permissions:
   - ✅ **Delete Messages**
   - ✅ **Post Messages** (for channels)

---

## 🧪 Testing & Quality Assurance

Run the comprehensive automated test suites to verify system integrity:

```bash
# Run end-to-end feature verification (Sanitization, Expiration, Timezones, APIs)
npm test

# Run Supabase integration & live connection test
npm run test:supabase
```

Test coverage includes:
- [x] Channel username sanitization (stripping URLs, prefixes, trailing slashes).
- [x] Retention expiration persistence in `sink.json` and `bot_settings`.
- [x] Exact ISO 8601 date storage without distortion or timezone drift.
- [x] 60-day retention cleanup logic (older jobs purged, fresh jobs preserved).
- [x] Live Supabase CRUD and graceful local storage fallback.
- [x] In-memory Web Dashboard Express routes (`/api/health`, `/api/status`, `/api/collected`, `/api/cleanup`).
- [x] Group Auto-Moderation & 15-second redirect notice with inline button.
- [x] Admin group chat permission toggle (Allow / Restrict) with persistent storage in `sink.json`.

---

## 📂 Project Directory Structure

```
IT Job Collection Bot/
├── src/
│   ├── bot/
│   │   ├── handlers/
│   │   │   └── channelPost.js      # Resilient paced scraper with overlap mutex
│   │   ├── services/
│   │   │   ├── forwardService.js   # Job message forwarding to sinks
│   │   │   └── telegramService.js  # Telegram Bot API client instance
│   │   └── index.js                # Command routing, admin panel & inline keyboards
│   ├── config/
│   │   ├── channels.json           # 59 Cleaned Cambodian channels
│   │   ├── keywords.json           # 177 IT qualification keywords
│   │   └── settings.js             # Configuration manager & state loader
│   ├── services/
│   │   ├── dateFilter.js           # Post age filtering (default 30 days)
│   │   ├── duplicateCheck.js       # Seen post hashing & deduplication
│   │   ├── jobFilter.js            # IT keyword matching engine
│   │   ├── migrateToSupabase.js    # Zero-data-loss database migration script
│   │   ├── storageService.js       # Unified data layer (Supabase + local fallback)
│   │   └── supabaseService.js      # Supabase client wrapper & CRUD operations
│   ├── utils/
│   │   ├── dateUtils.js            # Asia/Phnom_Penh date formatting
│   │   └── logger.js               # Structured console logger
│   └── server.js                   # Express dashboard server & Render keep-alive
├── public/                         # Modern frontend Web Dashboard
│   ├── app.js                      # Client-side reactivity, search & modal logic
│   ├── index.html                  # Responsive dashboard UI
│   ├── style.css                   # Glassmorphism dark/light stylesheet
│   └── IT_Job_Collection_Roeurn_Rors.png
├── storage/                        # Persistent local data
│   ├── collected.json              # Historical collected jobs (133+ jobs)
│   ├── sink.json                   # Sinks and retention configuration
│   └── sources.json                # Monitored source chat IDs
├── tests/
│   ├── test_all_features.js        # Comprehensive end-to-end test suite
│   └── test_supabase_integration.js# Supabase & retention test suite
├── .env.example                    # Template environment variables
├── .gitignore                      # Git ignore rules
├── package.json                    # Project metadata & npm scripts
├── render.yaml                     # Render Infrastructure-as-Code Blueprint
├── server.js                       # Root forwarder entrypoint
└── supabase_schema.sql             # Supabase PostgreSQL schema definition
```

---

## 📜 License

This project is licensed under the [ISC License](LICENSE).
