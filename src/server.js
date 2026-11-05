const express = require('express');
const path = require('path');
const https = require('https');
const settings = require('./config/settings');
const logger = require('./utils/logger');
const { getCollectedJobs, getCollectedCount } = require('./services/storageService');
const { getSeenCount } = require('./services/duplicateCheck');
const { initBot, bot } = require('./bot/index');
const { pollChannels } = require('./bot/handlers/channelPost');

const app = express();
app.use(express.json());

// Serve static frontend files
app.use(express.static(settings.PUBLIC_DIR));

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  const channels = settings.getChannels();
  const keywords = settings.getKeywords();
  const sources = settings.getSources();
  const primarySink = settings.getPrimaryGroupSink();

  res.json({
    sources,
    sink: primarySink,
    sinks: settings.groupSinks,
    sinkMode: settings.sinkMode,
    groupSinks: settings.groupSinks,
    groupSink: primarySink,
    adminSink: settings.adminSink,
    maxAgeDays: settings.maxAgeDays,
    keywords,
    channels: channels.length,
    channelsList: channels,
    collectedCount: getCollectedCount(),
    seenCount: getSeenCount()
  });
});

app.get('/api/collected', (req, res) => {
  const limit = parseInt(req.query.limit || '200', 10);
  res.json(getCollectedJobs(limit));
});

app.get('/api/sources', (req, res) => {
  res.json(settings.getSources());
});

app.get('/api/channels', (req, res) => {
  res.json(settings.getChannels());
});

app.post('/api/refresh', async (req, res) => {
  pollChannels().catch(console.error);
  res.json({ ok: true, message: 'Live scrape scan initiated' });
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

// Start Express server
const server = app.listen(settings.PORT, () => {
  logger.info(`Dashboard running on http://localhost:${settings.PORT}`);
  // Initialize Telegram Bot & Scraper Loop
  initBot();
});

module.exports = { app, server };
