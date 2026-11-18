require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const CONFIG_DIR = path.join(SRC_DIR, 'config');
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');

// Ensure necessary directories exist
[STORAGE_DIR, CONFIG_DIR, LOGS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// JSON file helpers
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    let content = fs.readFileSync(file, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return JSON.parse(content);
  } catch (e) {
    console.error(`Error reading ${file}:`, e.message);
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`Error writing ${file}:`, e.message);
  }
}

// Environment settings
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_IDS = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const DEFAULT_GROUP_SINK = process.env.SINK_CHAT_ID || '';
const DEFAULT_ADMIN_SINK = ADMIN_IDS[0] || '';

// File paths
const CHANNELS_FILE = path.join(CONFIG_DIR, 'channels.json');
const KEYWORDS_FILE = path.join(CONFIG_DIR, 'keywords.json');
const SINK_FILE = path.join(STORAGE_DIR, 'sink.json');
const COLLECTED_FILE = path.join(STORAGE_DIR, 'collected.json');
const SEEN_FILE = path.join(STORAGE_DIR, 'seen.json');
const SOURCES_FILE = path.join(STORAGE_DIR, 'sources.json');

const KNOWN_DEFAULT_GROUP = '-1004469567529';

function isPlaceholder(val) {
  if (!val) return true;
  const s = String(val).trim();
  return s.includes('x') || s.includes('your_') || s.includes('<') || !/^-?\d+$/.test(s);
}

function getResolvedAdminSink() {
  if (adminSink && !isPlaceholder(adminSink)) return String(adminSink);
  if (DEFAULT_ADMIN_SINK && !isPlaceholder(DEFAULT_ADMIN_SINK)) return String(DEFAULT_ADMIN_SINK);
  if (ADMIN_IDS.length && !isPlaceholder(ADMIN_IDS[0])) return String(ADMIN_IDS[0]);
  return '7339961364';
}

function isValidGroupSink(val) {
  if (!val) return false;
  const s = String(val).trim();
  if (isPlaceholder(s)) return false;
  // If it's an admin user ID or positive number, it's a private chat, NOT a group!
  if (ADMIN_IDS.includes(s) || s === getResolvedAdminSink()) return false;
  // Telegram Group and Supergroup IDs are negative numbers (e.g. -1004469567529)
  return s.startsWith('-');
}

// Sink Configuration
let rawSinkConfig = readJson(SINK_FILE, null);
let groupSinks = [];
let adminSink = '';
let sinkMode = 'group'; // 'group' | 'admin' | 'both'
let maxAgeDays = parseInt(process.env.MAX_AGE_DAYS || '30', 10);
let expiryDays = parseInt(process.env.EXPIRY_DAYS || '60', 10);
let allowUserChat = process.env.ALLOW_USER_CHAT === 'true'; // false = normal messages blocked in group, true = allowed

if (typeof rawSinkConfig === 'string' && isValidGroupSink(rawSinkConfig)) {
  groupSinks = [rawSinkConfig];
} else if (rawSinkConfig && typeof rawSinkConfig === 'object') {
  if (Array.isArray(rawSinkConfig.groupSinks)) {
    groupSinks = rawSinkConfig.groupSinks.map(String).filter(s => isValidGroupSink(s));
  } else if (rawSinkConfig.groupSink && isValidGroupSink(rawSinkConfig.groupSink)) {
    groupSinks = [String(rawSinkConfig.groupSink)];
  }
  if (rawSinkConfig.adminSink && !isPlaceholder(rawSinkConfig.adminSink)) {
    adminSink = String(rawSinkConfig.adminSink);
  }
  sinkMode = rawSinkConfig.sinkMode || 'group';
  if (rawSinkConfig.maxAgeDays) {
    const parsed = parseInt(rawSinkConfig.maxAgeDays, 10);
    if (!isNaN(parsed) && parsed > 0) maxAgeDays = parsed;
  }
  if (rawSinkConfig.expiryDays) {
    const parsed = parseInt(rawSinkConfig.expiryDays, 10);
    if (!isNaN(parsed) && parsed > 0) expiryDays = parsed;
  }
  if (typeof rawSinkConfig.allowUserChat === 'boolean') {
    allowUserChat = rawSinkConfig.allowUserChat;
  }
}

// Always fallback to valid group configuration
if (!groupSinks.length) {
  if (DEFAULT_GROUP_SINK && isValidGroupSink(DEFAULT_GROUP_SINK)) {
    groupSinks = [DEFAULT_GROUP_SINK];
  } else {
    groupSinks = [KNOWN_DEFAULT_GROUP];
  }
}
if (!adminSink && DEFAULT_ADMIN_SINK && !isPlaceholder(DEFAULT_ADMIN_SINK)) {
  adminSink = DEFAULT_ADMIN_SINK;
}

function getPrimaryGroupSink() {
  const valid = groupSinks.find(s => isValidGroupSink(s));
  if (valid) return valid;
  if (DEFAULT_GROUP_SINK && isValidGroupSink(DEFAULT_GROUP_SINK)) return DEFAULT_GROUP_SINK;
  return KNOWN_DEFAULT_GROUP;
}

function getPrimarySink() {
  if (sinkMode === 'admin') return getResolvedAdminSink();
  return getPrimaryGroupSink();
}

function saveSink() {
  const primaryGroup = getPrimaryGroupSink();
  const primaryAdmin = getResolvedAdminSink();
  writeJson(SINK_FILE, {
    sinkMode,
    groupSinks,
    groupSink: primaryGroup,
    adminSink: primaryAdmin,
    maxAgeDays,
    expiryDays,
    allowUserChat
  });
}

function getTargetSinks() {
  const targets = [];
  if (sinkMode === 'group' || sinkMode === 'both') {
    for (const g of groupSinks) {
      const s = String(g).trim();
      if (isValidGroupSink(s) && !targets.includes(s)) targets.push(s);
    }
    // Safety guard: If in group mode and no valid group sink exists, ensure primary group sink is targeted
    if (!targets.length) {
      targets.push(getPrimaryGroupSink());
    }
  }
  if (sinkMode === 'admin' || sinkMode === 'both') {
    const aSink = getResolvedAdminSink();
    if (aSink && !targets.includes(aSink)) {
      targets.push(aSink);
    }
  }
  return targets;
}

// Scraping Interval
const SCRAPE_INTERVAL_SECONDS = parseInt(process.env.SCRAPE_INTERVAL_SECONDS || '90', 10);
const scrapeIntervalMs = Math.max(30, isNaN(SCRAPE_INTERVAL_SECONDS) ? 90 : SCRAPE_INTERVAL_SECONDS) * 1000;

// Channels & Keywords helpers
function sanitizeChannel(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .trim();
}

function getChannels() {
  const raw = readJson(CHANNELS_FILE, []);
  const seen = new Set();
  const cleaned = [];
  for (const item of raw) {
    const c = sanitizeChannel(item);
    if (c && !seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      cleaned.push(c);
    }
  }
  return cleaned;
}

function saveChannels(list) {
  const seen = new Set();
  const cleaned = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      const c = sanitizeChannel(item);
      if (c && !seen.has(c.toLowerCase())) {
        seen.add(c.toLowerCase());
        cleaned.push(c);
      }
    }
  }
  writeJson(CHANNELS_FILE, cleaned);

  try {
    const supabaseService = require('../services/supabaseService');
    if (supabaseService.isConfigured()) {
      supabaseService.syncChannelsToSupabase(cleaned).catch(() => {});
    }
  } catch (_) {}
}

function getKeywords() {
  return readJson(KEYWORDS_FILE, []);
}

function saveKeywords(list) {
  writeJson(KEYWORDS_FILE, list);

  try {
    const supabaseService = require('../services/supabaseService');
    if (supabaseService.isConfigured()) {
      supabaseService.syncKeywordsToSupabase(list).catch(() => {});
    }
  } catch (_) {}
}

function getSources() {
  return readJson(SOURCES_FILE, []);
}

function saveSources(list) {
  writeJson(SOURCES_FILE, list);
}

module.exports = {
  PORT,
  TELEGRAM_BOT_TOKEN,
  ADMIN_IDS,
  DEFAULT_GROUP_SINK,
  DEFAULT_ADMIN_SINK,
  ROOT_DIR,
  SRC_DIR,
  CONFIG_DIR,
  STORAGE_DIR,
  PUBLIC_DIR,
  LOGS_DIR,
  CHANNELS_FILE,
  KEYWORDS_FILE,
  SINK_FILE,
  COLLECTED_FILE,
  SEEN_FILE,
  SOURCES_FILE,
  readJson,
  writeJson,
  get sinkMode() { return sinkMode; },
  set sinkMode(val) { sinkMode = val; },
  get groupSinks() { return groupSinks; },
  set groupSinks(val) { groupSinks = val; },
  get adminSink() { return getResolvedAdminSink(); },
  set adminSink(val) { adminSink = val; },
  get maxAgeDays() { return maxAgeDays; },
  set maxAgeDays(val) { maxAgeDays = val; },
  get expiryDays() { return expiryDays; },
  set expiryDays(val) { expiryDays = val; },
  get allowUserChat() { return allowUserChat; },
  set allowUserChat(val) { allowUserChat = Boolean(val); },
  getPrimaryGroupSink,
  getPrimarySink,
  saveSink,
  getTargetSinks,
  getChannels,
  saveChannels,
  getKeywords,
  saveKeywords,
  getSources,
  saveSources,
  sanitizeChannel,
  isValidGroupSink,
  SCRAPE_INTERVAL_SECONDS,
  scrapeIntervalMs
};

