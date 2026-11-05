const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.resolve(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const LOG_FILE = path.join(LOGS_DIR, 'app.log');

function formatTimestamp() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

function writeToFile(level, msg) {
  try {
    const line = `[${formatTimestamp()}] [${level.toUpperCase()}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (_) {}
}

const logger = {
  info: (msg, ...args) => {
    const full = [msg, ...args].join(' ');
    console.log(`ℹ️ [INFO] ${full}`);
    writeToFile('INFO', full);
  },
  success: (msg, ...args) => {
    const full = [msg, ...args].join(' ');
    console.log(`✅ [SUCCESS] ${full}`);
    writeToFile('SUCCESS', full);
  },
  warn: (msg, ...args) => {
    const full = [msg, ...args].join(' ');
    console.warn(`⚠️ [WARN] ${full}`);
    writeToFile('WARN', full);
  },
  error: (msg, ...args) => {
    const full = [msg, ...args].join(' ');
    console.error(`❌ [ERROR] ${full}`);
    writeToFile('ERROR', full);
  },
  job: (source, id, title, target) => {
    const msg = `Forwarded IT job: ${source} #${id} "${title}" -> ${target}`;
    console.log(`🚀 [JOB] ${msg}`);
    writeToFile('JOB', msg);
  },
  autoDelete: (messageId, sender, chatId) => {
    const msg = `Auto-deleted message #${messageId} from non-admin "${sender}" in chat ${chatId}`;
    console.log(`🗑️ [MODERATION] ${msg}`);
    writeToFile('MODERATION', msg);
  }
};

module.exports = logger;
