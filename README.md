# 🚀 IT Job Collection Telegram Bot & Web Dashboard

An automated Telegram bot and real-time Web Dashboard that scrapes 50+ Cambodian job channels every 30 seconds, filters IT-related opportunities using customizable keywords, and automatically forwards them to Telegram groups or direct bot chat.

---

## ✨ Features

- **📡 Automated Multi-Channel Scraper**: Continuously monitors 51+ public Telegram channels in parallel batches every 30 seconds.
- **🔍 Intelligent IT Filtering**: Matches against 170+ IT keywords (Software Engineers, Mobile, Backend, Frontend, DevOps, AI, QA, etc.) with URL and email sanitization to eliminate false positives.
- **🎯 Multi-Sink Destination Management**:
  - Supports multiple destination groups (`/addsink`, `/removesink`, `/sink`).
  - 3 Forwarding Modes (`/sinkmode`): Groups Only, Admin DM Only, or Both.
- **📅 Dynamic Max Post Age Filter**: Customize how old a post can be before being skipped (`/maxage [days]`, default 30 days).
- **🚀 On-Demand Forwarding**: Admin can pull and forward any number of recent jobs to group sinks (`/forwardjobs [count]`).
- **🛡️ Group Auto-Moderation**: Ensures group sinks stay 100% clean for job listings:
  - Admins can text and post announcements freely.
  - Normal members' chatter, media, or spam is instantly auto-removed.
  - Allowed public commands (`/status`, `/recent`, `/channels`) redirect members to bot DM and self-delete after 5 seconds.
- **🛠️ BotFather-Style Admin Panel**: Full in-chat control panel with inline buttons (`/admin`).
- **📊 Real-Time Web Dashboard**: Modern responsive web UI running on `http://localhost:3000`.

---

## 🚀 Quick Start

### 1. Installation
```bash
git clone https://github.com/Roeurn-007/IT_Job_Collection_Bot.git
cd IT_Job_Collection_Bot
npm install
```

### 2. Environment Configuration
Create a `.env` file from `.env.example`:
```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
ADMIN_CHAT_ID=your_telegram_user_id
SINK_CHAT_ID=-1004469567529
PORT=3000
MAX_AGE_DAYS=30
```

### 3. Run the Bot
```bash
# Start bot and web dashboard
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🤖 Telegram Commands

### 👥 Public Member Commands
- `/status` — View bot statistics and monitored channel count.
- `/recent` — View last collected IT jobs.
- `/channels` — View all monitored channels.

### ⚙️ Admin Commands
- `/admin` — Open the BotFather-style interactive Admin Control Panel.
- `/maxage [days]` — View or edit the maximum post age filter (1–365 days).
- `/forwardjobs [count]` — Forward custom number of recent jobs to group sinks.
- `/sinkmode` — Switch delivery mode (`group`, `admin`, or `both`).
- `/addsink <chat_id>` — Add a new group destination sink.
- `/removesink` — Remove a group destination sink.
- `/sink` — View active sinks and forwarding settings.
- `/keywords` — View and manage IT filter keywords.
- `/addkeyword <word>` — Add single or comma-separated keywords.
- `/removekeyword <word>` — Remove a keyword from the active filter.
- `/addchannel <username>` — Add a new public channel to the 30s scraper.
- `/removechannel <username>` — Remove a channel from scraper.
- `/cancel` — Cancel any active wizard input.

---

## 🔒 BotFather Privacy Setting (Required)
To allow the bot to auto-delete non-admin chatter in your group sinks:
1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/setprivacy`.
3. Select your bot and choose **`Disable`**.
4. Add the bot to your group as an **Administrator** with **Delete Messages** permission.

---

## 📄 License
ISC License
