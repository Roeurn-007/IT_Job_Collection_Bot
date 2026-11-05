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
const ADMIN_IDS = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '7339961364')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const DEFAULT_GROUP_SINK = process.env.SINK_CHAT_ID || '-1004469567529';
const DEFAULT_ADMIN_SINK = ADMIN_IDS[0] || '7339961364';

// File paths
const CHANNELS_FILE = path.join(CONFIG_DIR, 'channels.json');
const KEYWORDS_FILE = path.join(CONFIG_DIR, 'keywords.json');
const SINK_FILE = path.join(STORAGE_DIR, 'sink.json');
const COLLECTED_FILE = path.join(STORAGE_DIR, 'collected.json');
const SEEN_FILE = path.join(STORAGE_DIR, 'seen.json');
const SOURCES_FILE = path.join(STORAGE_DIR, 'sources.json');

// Sink Configuration
let rawSinkConfig = readJson(SINK_FILE, null);
let groupSinks = [DEFAULT_GROUP_SINK];
let adminSink = DEFAULT_ADMIN_SINK;
let sinkMode = 'group'; // 'group' | 'admin' | 'both'
let maxAgeDays = parseInt(process.env.MAX_AGE_DAYS || '30', 10);

if (typeof rawSinkConfig === 'string') {
  if (rawSinkConfig === adminSink) {
    sinkMode = 'admin';
  } else {
    groupSinks = [rawSinkConfig];
    sinkMode = 'group';
  }
} else if (rawSinkConfig && typeof rawSinkConfig === 'object') {
  if (Array.isArray(rawSinkConfig.groupSinks) && rawSinkConfig.groupSinks.length) {
    groupSinks = rawSinkConfig.groupSinks.map(String).filter(Boolean);
  } else if (rawSinkConfig.groupSink) {
    groupSinks = [String(rawSinkConfig.groupSink)];
  }
  adminSink = String(rawSinkConfig.adminSink || DEFAULT_ADMIN_SINK);
  sinkMode = rawSinkConfig.sinkMode || 'group';
  if (rawSinkConfig.maxAgeDays) {
    const parsed = parseInt(rawSinkConfig.maxAgeDays, 10);
    if (!isNaN(parsed) && parsed > 0) maxAgeDays = parsed;
  }
}

function getPrimaryGroupSink() {
  return groupSinks[0] || DEFAULT_GROUP_SINK;
}

function getPrimarySink() {
  if (sinkMode === 'admin') return adminSink;
  return getPrimaryGroupSink();
}

function saveSink() {
  const primaryGroup = getPrimaryGroupSink();
  writeJson(SINK_FILE, {
    sinkMode,
    groupSinks,
    groupSink: primaryGroup,
    adminSink,
    maxAgeDays
  });
}

function getTargetSinks() {
  const targets = [];
  if (sinkMode === 'group' || sinkMode === 'both') {
    for (const g of groupSinks) {
      const s = String(g).trim();
      if (s && !targets.includes(s)) targets.push(s);
    }
  }
  if (sinkMode === 'admin' || sinkMode === 'both') {
    if (adminSink && !targets.includes(String(adminSink))) {
      targets.push(String(adminSink));
    }
  }
  return targets;
}

// Channels & Keywords helpers
function getChannels() {
  return readJson(CHANNELS_FILE, []);
}

function saveChannels(list) {
  writeJson(CHANNELS_FILE, list);
}

function getKeywords() {
  return readJson(KEYWORDS_FILE, []);
}

function saveKeywords(list) {
  writeJson(KEYWORDS_FILE, list);
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
  get adminSink() { return adminSink; },
  set adminSink(val) { adminSink = val; },
  get maxAgeDays() { return maxAgeDays; },
  set maxAgeDays(val) { maxAgeDays = val; },
  getPrimaryGroupSink,
  getPrimarySink,
  saveSink,
  getTargetSinks,
  getChannels,
  saveChannels,
  getKeywords,
  saveKeywords,
  getSources,
  saveSources
};
