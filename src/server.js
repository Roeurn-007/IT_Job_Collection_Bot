const express = require('express');
const path = require('path');
const https = require('https');
const settings = require('./config/settings');
const logger = require('./utils/logger');
const { getCollectedJobs, getCollectedCount, initStorage, purgeExpiredJobs } = require('./services/storageService');
const { getSeenCount } = require('./services/duplicateCheck');
const supabaseService = require('./services/supabaseService');
const { initBot, bot } = require('./bot/index');
const { pollChannels } = require('./bot/handlers/channelPost');

const app = express();
app.use(express.json());

// Serve static frontend files
app.use(express.static(settings.PUBLIC_DIR));

// API Routes
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'it-job-collection-bot',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/status', async (req, res) => {
  const channels = settings.getChannels();
  const keywords = settings.getKeywords();
  const sources = settings.getSources();
  const primarySink = settings.getPrimaryGroupSink();
  const supabaseStatus = await supabaseService.getSupabaseStatus();

  res.json({
    sources,
    sink: primarySink,
    sinks: settings.groupSinks,
    sinkMode: settings.sinkMode,
    groupSinks: settings.groupSinks,
    groupSink: primarySink,
    adminSink: settings.adminSink,
    maxAgeDays: settings.maxAgeDays,
    expiryDays: settings.expiryDays,
    keywords,
    channels: channels.length,
    channelsList: channels,
    collectedCount: getCollectedCount(),
    seenCount: getSeenCount(),
    supabase: supabaseStatus
  });
});

app.get('/api/collected', async (req, res) => {
  const limit = parseInt(req.query.limit || '200', 10);
  // Try fetching directly from Supabase if configured, otherwise fallback to local storage
  if (supabaseService.isConfigured()) {
    const dbJobs = await supabaseService.fetchJobsFromSupabase(limit, settings.expiryDays);
    if (dbJobs) return res.json(dbJobs);
  }
  res.json(getCollectedJobs(limit));
});

app.get('/api/sources', (req, res) => {
  res.json(settings.getSources());
});

app.get('/api/channels', (req, res) => {
  res.json(settings.getChannels());
});

app.post('/api/refresh', async (req, res) => {
  const result = await pollChannels().catch(err => ({ ok: false, message: err.message }));
  res.json(result || { ok: true, message: 'Live scrape scan initiated' });
});

// Trigger database expiration cleanup manually
app.post('/api/cleanup', async (req, res) => {
  const days = parseInt(req.query.days || settings.expiryDays, 10);
  const result = await purgeExpiredJobs(days);
  res.json({ ok: true, message: `Purged jobs older than ${days} days from database and web`, ...result });
});

app.get('/api/photo/:fileId', async (req, res) => {
  try {
    const file = await bot.getFile(req.params.fileId);
    if (!file || !file.file_path) return res.status(404).end();
    const fileUrl = `https://api.telegram.org/file/bot${settings.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    https.get(fileUrl, (stream) => {
      res.setHeader('Content-Type', 'image/jpeg');
      stream.pipe(res);
    }).on('error', () => res.status(500).end());
  } catch (err) {
    res.status(500).end();
  }
});

// Single Page Application route fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).end();
  res.sendFile(path.join(settings.PUBLIC_DIR, 'index.html'));
});

// Render Free Tier Keep-Alive Ping (Prevents service from sleeping after 15 mins)
function startKeepAlive() {
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL;
  if (!externalUrl || externalUrl.includes('localhost') || externalUrl.includes('127.0.0.1')) {
    return;
  }
  const pingUrl = `${externalUrl.replace(/\/+$/, '')}/api/health`;
  const PING_INTERVAL = 14 * 60 * 1000; // Ping every 14 minutes

  logger.info(`Keep-alive anti-sleep ping enabled for: ${pingUrl}`);
  setInterval(async () => {
    try {
      const res = await fetch(pingUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        logger.info('Keep-alive ping successful (Render service active).');
      }
    } catch (err) {
      logger.warn('Keep-alive ping warning:', err.message);
    }
  }, PING_INTERVAL);
}

// Graceful shutdown handler for Render rolling deploys & fast restarts
function setupGracefulShutdown(serverInstance) {
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    // 1. Immediately close HTTP server to release port 3000 instantly
    if (serverInstance) {
      try {
        serverInstance.close(() => {
          logger.info('HTTP server closed.');
        });
      } catch (_) {}
    }

    // 2. Stop Telegram bot polling with a 1.5s timeout to avoid 409 Conflict
    try {
      if (bot && typeof bot.stopPolling === 'function') {
        logger.info('Stopping Telegram bot polling to avoid 409 Conflict on next instance...');
        await Promise.race([
          bot.stopPolling(),
          new Promise(r => setTimeout(r, 1500))
        ]);
      }
    } catch (_) {}

    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

// Start Express server if run directly
let server = null;
if (require.main === module) {
  // Bind to 0.0.0.0 for cloud hosting compatibility (Render, Railway, Fly.io, etc.)
  server = app.listen(settings.PORT, '0.0.0.0', async () => {
    logger.info(`Dashboard running on http://0.0.0.0:${settings.PORT} (Port: ${settings.PORT})`);
    
    // Initialize storage (purges jobs older than retention & syncs with Supabase if configured)
    await initStorage().catch(err => {
      logger.error('Failed to initialize storage / Supabase sync:', err.message);
    });

    // Initialize Telegram Bot & Scraper Loop
    initBot();

    // Start keep-alive ping for Render Free tier
    startKeepAlive();

    // Setup graceful shutdown for zero-downtime rolling deploys
    setupGracefulShutdown(server);
  });
}

module.exports = { app, server };
