require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const SINK_ENV = process.env.SINK_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');
const KEYWORDS_FILE = path.join(DATA_DIR, 'keywords.json');
const SEEN_FILE = path.join(DATA_DIR, 'seen.json');
const COLLECTED_FILE = path.join(DATA_DIR, 'collected.json');
const SINK_FILE = path.join(DATA_DIR, 'sink.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');

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
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

let sources = readJson(SOURCES_FILE, []);
let keywords = readJson(KEYWORDS_FILE, null);
if (!keywords) {
  keywords = ['backend', 'frontend', 'full stack', 'fullstack', 'devops', 'qa', 'quality assurance',
    'software engineer', 'software developer', 'web developer', 'mobile developer',
    'data engineer', 'data scientist', 'machine learning', 'ml engineer', 'ai engineer',
    'cloud engineer', 'site reliability', 'sre', 'ui/ux', 'ui ux', 'react', 'node.js',
    'python developer', 'java developer', '.net developer', 'golang', 'rust developer',
    'ios developer', 'android developer', 'flutter', 'react native',
    'IT Development', 'IT Programmer',

    // UI/UX Designers
    'UI Designer', 'UX Designer', 'UI/UX Designer', 'UI UX Designer',
    'Product Designer', 'UX Researcher', 'UX Research',
    'Interaction Designer', 'Visual Designer', 'Web Designer',
    'Mobile App Designer', 'Graphic Designer', 'Figma Designer',
    'Design Engineer', 'Junior UI UX Designer', 'UI UX Intern',

    // Data Roles
    'Data Analyst', 'Data Engineer', 'Data Scientist', 'Data Specialist',
    'Data Developer', 'Business Intelligence Analyst', 'BI Developer',
    'BI Analyst', 'Database Developer', 'Database Administrator', 'DBA',
    'SQL Developer', 'ETL Developer', 'Machine Learning Engineer',
    'ML Engineer', 'AI Engineer', 'Artificial Intelligence Engineer',
    'AI Developer', 'Deep Learning Engineer', 'NLP Engineer',
    'Computer Vision Engineer', 'Python Data Engineer', 'Data Intern',

    // DevOps & Cloud
    'DevOps Engineer', 'DevOps Developer', 'Cloud Engineer', 'Cloud Developer',
    'Cloud Architect', 'AWS Engineer', 'Azure Engineer', 'Google Cloud Engineer',
    'GCP Engineer', 'System Administrator', 'Systems Administrator',
    'Linux Administrator', 'Windows Administrator',
    'Infrastructure Engineer', 'Site Reliability Engineer', 'SRE',
    'Platform Engineer', 'Build Engineer', 'Release Engineer',
    'CI/CD Engineer', 'Kubernetes Engineer', 'Docker Engineer',
    'Network Engineer', 'Network Administrator', 'IT Infrastructure Engineer',

    // Mobile Developers
    'Mobile Developer', 'Mobile App Developer', 'Mobile Application Developer',
    'Mobile Engineer', 'Android Developer', 'iOS Developer',
    'Flutter Developer', 'React Native Developer', 'Swift Developer',
    'Kotlin Developer', 'Dart Developer', 'Xamarin Developer',
    'Ionic Developer', 'Mobile Software Engineer',
    'Junior Mobile Developer', 'Mobile Developer Intern',

    // Full Stack
    'Full Stack Developer', 'Full-Stack Developer', 'Fullstack Engineer',
    'Full Stack Engineer', 'Full-Stack Engineer', 'Web Application Developer',
    'Full Stack Web Developer', 'MERN Stack Developer',
    'MEAN Stack Developer', 'Laravel Vue Developer',
    'React Node Developer', 'Software Web Developer',
    'Junior Full Stack Developer', 'Full Stack Intern',

    // Backend Developers
    'Backend Developer', 'Back-End Developer', 'Backend Engineer',
    'Back-End Engineer', 'API Developer', 'API Engineer',
    'PHP Developer', 'Laravel Developer', 'Node.js Developer',
    'Express.js Developer', 'Python Backend Developer',
    'Django Developer', 'Flask Developer', 'Java Backend Developer',
    'Spring Boot Developer', 'C# Developer', 'ASP.NET Developer',
    'Go Developer', 'Golang Developer', 'Ruby Developer',
    'Ruby on Rails Developer', 'NestJS Developer',
    'Junior Backend Developer', 'Backend Intern',

    // Frontend Developers
    'Frontend Developer', 'Front-End Developer', 'Frontend Engineer',
    'Front-End Engineer', 'Frontend Web Developer', 'UI Developer',
    'Web UI Developer', 'JavaScript Developer', 'TypeScript Developer',
    'React Developer', 'React.js Developer', 'Vue Developer',
    'Vue.js Developer', 'Angular Developer', 'Next.js Developer',
    'Nuxt.js Developer', 'HTML CSS Developer', 'CSS Developer',
    'Junior Frontend Developer', 'Frontend Intern',

    // QA & Testing
    'QA', 'Q&A', 'Quality Assurance', 'QA Tester', 'QA Engineer',
    'QA Analyst', 'QA Specialist', 'Software Tester',
    'Software Test Engineer', 'Test Engineer', 'Test Analyst',
    'Manual Tester', 'Manual QA', 'Manual Testing',
    'Automation Tester', 'Automation QA', 'QA Automation Engineer',
    'SDET', 'Performance Tester', 'API Tester',
    'Mobile App Tester', 'Web Tester', 'Junior QA', 'QA Intern',
    'Software Testing'
];
  writeJson(KEYWORDS_FILE, keywords);
}
let seen = new Set(readJson(SEEN_FILE, []));
let collected = readJson(COLLECTED_FILE, []);
let channels = readJson(CHANNELS_FILE, []);
const lastPostId = {};

// Destination sink and forwarding mode:
// Forwarding modes:
//   'group' - Forward to all Group sinks (Default / Recommended)
//   'admin' - Forward to Admin bot chat (DM) only
//   'both'  - Forward to BOTH Group sinks and Admin bot chat
const DEFAULT_GROUP_SINK = process.env.SINK_CHAT_ID || '-1004469567529';
const DEFAULT_ADMIN_SINK = (process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '7339961364').split(',')[0].trim();

let rawSinkConfig = readJson(SINK_FILE, null);
let groupSinks = [DEFAULT_GROUP_SINK];
let adminSink = DEFAULT_ADMIN_SINK;
let sinkMode = 'group';

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
  adminSink = rawSinkConfig.adminSink || DEFAULT_ADMIN_SINK;
  sinkMode = rawSinkConfig.sinkMode || 'group';
}

let maxAgeDays = parseInt(process.env.MAX_AGE_DAYS || '30', 10);
if (rawSinkConfig && typeof rawSinkConfig === 'object' && rawSinkConfig.maxAgeDays) {
  const parsed = parseInt(rawSinkConfig.maxAgeDays, 10);
  if (!isNaN(parsed) && parsed > 0) {
    maxAgeDays = parsed;
  }
}

function getPrimaryGroupSink() {
  return groupSinks[0] || DEFAULT_GROUP_SINK;
}

let groupSink = getPrimaryGroupSink();

function getPrimarySink() {
  if (sinkMode === 'admin') return adminSink;
  return getPrimaryGroupSink();
}

let sink = getPrimarySink();

function saveSources() { writeJson(SOURCES_FILE, sources); }
function saveKeywords() { writeJson(KEYWORDS_FILE, keywords); }
function saveSeen() { writeJson(SEEN_FILE, Array.from(seen).slice(-5000)); }
function saveCollected() { writeJson(COLLECTED_FILE, collected.slice(-500)); }
function saveSink() {
  groupSink = getPrimaryGroupSink();
  sink = getPrimarySink();
  writeJson(SINK_FILE, {
    sinkMode,
    groupSinks,
    groupSink,
    adminSink,
    maxAgeDays
  });
}
function saveChannels() { writeJson(CHANNELS_FILE, channels); }

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

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function isAdmin(userOrMsg) {
  if (!userOrMsg) return false;
  if (typeof userOrMsg === 'object') {
    const fromId = userOrMsg.from ? String(userOrMsg.from.id) : null;
    const chatId = userOrMsg.chat ? String(userOrMsg.chat.id) : null;
    if (fromId && ADMIN_IDS.includes(fromId)) return true;
    if (chatId && ADMIN_IDS.includes(chatId)) return true;
    // Recognize anonymous admin posts in managed sink group(s)
    if (userOrMsg.sender_chat && (groupSinks.includes(String(userOrMsg.sender_chat.id)) || (chatId && String(userOrMsg.sender_chat.id) === chatId))) {
      return true;
    }
    return false;
  }
  return ADMIN_IDS.includes(String(userOrMsg));
}

function requireAdmin(msg) {
  if (!isAdmin(msg)) {
    if (!isPrivate(msg)) {
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    } else {
      safeSend(msg.chat.id, '⛔ Access denied: This command is restricted to administrators only.');
    }
    return false;
  }
  return true;
}
function isSource(chatId) {
  const id = String(chatId);
  if (groupSinks.includes(id) || id === String(groupSink)) return false;
  return sources.includes(id);
}

const TIMEZONE = 'Asia/Phnom_Penh';

function getPhnomPenhDateStr(date = new Date()) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function formatPhnomPenhDate(date) {
  if (!date) return { dateStr: '', weekday: '', time: '', isToday: false, display: '' };
  const d = new Date(date);
  if (isNaN(d.getTime())) return { dateStr: '', weekday: '', time: '', isToday: false, display: '' };

  const dateStr = getPhnomPenhDateStr(d);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long'
  }).format(d);

  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(d);

  const todayStr = getPhnomPenhDateStr(new Date());
  const isToday = dateStr === todayStr;

  return {
    dateStr,
    weekday,
    time,
    isToday,
    display: `${isToday ? 'Today, ' : ''}${dateStr} ${weekday} ${time}`
  };
}

function formatDate(date) {
  return formatPhnomPenhDate(date).display;
}

// Visual and informative admin notification cards
function formatKeywordAddedResponse(kw, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `✅ Keyword Added Successfully!\n\n` +
    `🎯 Added Keyword: "${kw}"\n` +
    `📊 Total Filter Keywords: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `🔍 Match Rule: Case-insensitive whole-word matching\n\n` +
    `🤖 Live Monitoring: The bot is now actively monitoring incoming posts and all ${channels.length} channels for "${kw}".`
  );
}

function formatKeywordExistsResponse(kw, total) {
  return (
    `ℹ️ Keyword Already Exists\n\n` +
    `🎯 Keyword: "${kw}"\n` +
    `📊 Total Filter Keywords: ${total}\n` +
    `⚠️ Notice: No changes made because "${kw}" is already active in your filter list.`
  );
}

function formatMultipleKeywordsAddedResponse(added, existing, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  let text = `✅ Keywords Processed Successfully!\n\n`;
  if (added.length) {
    text += `✨ Added (${added.length}):\n• ${added.join('\n• ')}\n\n`;
  }
  if (existing.length) {
    text += `ℹ️ Already Existed (${existing.length}):\n• ${existing.join('\n• ')}\n\n`;
  }
  text +=
    `📊 Total Filter Keywords: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `🔍 Match Rule: Case-insensitive whole-word matching\n\n` +
    `🤖 Action: Added keywords are now actively monitored across all ${channels.length} scraped channels.`;
  return text;
}

function formatKeywordsRemovedResponse(removed, notFound, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  let text = `🗑️ Keyword(s) Removed Successfully!\n\n`;
  if (removed.length) {
    text += `🔻 Removed (${removed.length}):\n• ${removed.join('\n• ')}\n\n`;
  }
  if (notFound.length) {
    text += `⚠️ Not Found in List (${notFound.length}):\n• ${notFound.join('\n• ')}\n\n`;
  }
  text +=
    `📊 Total Filter Keywords: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n\n` +
    `💡 Notice: Future posts containing only the removed keywords will no longer be collected.`;
  return text;
}

function formatChannelAddedResponse(u, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `✅ Channel Added Successfully!\n\n` +
    `📢 Channel: @${u}\n` +
    `🔗 Link: https://t.me/${u}\n` +
    `📡 Total Scraped Channels: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Frequency: Scraped every 30 seconds for today's IT jobs\n\n` +
    `💡 What happens next:\nThe bot will automatically scan @${u} every 30 seconds. You can also tap "⚡ Scrape This Channel Now" below to run an instant check.`
  );
}

function formatChannelExistsResponse(u, total) {
  return (
    `ℹ️ Channel Already Active\n\n` +
    `📢 Channel: @${u}\n` +
    `🔗 Link: https://t.me/${u}\n` +
    `📡 Total Scraped Channels: ${total}\n` +
    `⚠️ Notice: This channel is already active in the 30-second automated scraping loop.`
  );
}

function formatChannelRemovedResponse(u, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `🗑️ Channel Removed Successfully!\n\n` +
    `📢 Removed: @${u}\n` +
    `📡 Total Scraped Channels: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Status: Removed from 30-second scraper loop\n\n` +
    `💡 Notice: Past jobs collected from @${u} remain preserved in your archive.`
  );
}

function formatSinkUpdatedResponse(newSink) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `✅ Destination Sink Configured Successfully!\n\n` +
    `🎯 Target Chat ID: ${newSink}\n` +
    `👥 Total Group Sinks: ${groupSinks.length}\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Forwarding Status: ACTIVE\n\n` +
    `💡 All newly published IT jobs matching your ${keywords.length} filter keywords will now be delivered to this destination.\n\n` +
    `👉 Tap "🧪 Test All Sinks" below to verify bot posting permissions.`
  );
}

function formatSinkAddedResponse(newId, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `✅ Destination Sink Added Successfully!\n\n` +
    `🎯 Added Group Sink: ${newId}\n` +
    `👥 Total Group Sinks: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Forwarding Status: ACTIVE\n\n` +
    `💡 Newly published IT jobs matching your ${keywords.length} filter keywords will now also be delivered to this group!\n\n` +
    `👉 Tap "🧪 Test All Sinks" below to verify bot posting permissions.`
  );
}

function formatSinkRemovedResponse(remId, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `🗑️ Destination Sink Removed!\n\n` +
    `🎯 Removed Group Sink: ${remId}\n` +
    `👥 Remaining Group Sinks: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n\n` +
    `💡 The bot has stopped forwarding jobs to this group ID.`
  );
}

function formatSinkModeUpdatedResponse(mode) {
  const time = formatPhnomPenhDate(new Date()).display;
  let modeTitle = `👥 Groups Only (${groupSinks.length} group${groupSinks.length === 1 ? '' : 's'})`;
  let desc = `All newly discovered IT jobs will be forwarded directly to all ${groupSinks.length} group sink(s).`;
  if (mode === 'admin') {
    modeTitle = '🤖 Only Bot Chat (Admin DM)';
    desc = `All newly discovered IT jobs will be forwarded directly to your private bot chat (${adminSink}).`;
  } else if (mode === 'both') {
    modeTitle = `🔄 Both (${groupSinks.length} Group${groupSinks.length === 1 ? '' : 's'} + Bot Chat)`;
    desc = `All newly discovered IT jobs will be forwarded simultaneously to all ${groupSinks.length} group(s) and your private bot chat (${adminSink})!`;
  }

  return (
    `✅ Forwarding Mode Updated Successfully!\n\n` +
    `🎯 Selected Mode: ${modeTitle}\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Forwarding Status: ACTIVE\n\n` +
    `ℹ️ ${desc}\n\n` +
    `👉 You can test delivery with the button below.`
  );
}

function formatSinkMenuText() {
  let modeName = `👥 Groups Only (${groupSinks.length} group${groupSinks.length === 1 ? '' : 's'})`;
  let desc = `All newly discovered IT jobs are forwarded to all ${groupSinks.length} group sink(s).`;
  if (sinkMode === 'admin') {
    modeName = '🤖 Only Bot Chat (Admin DM)';
    desc = `All newly discovered IT jobs are forwarded directly to your private chat with the bot (${adminSink}).`;
  } else if (sinkMode === 'both') {
    modeName = `🔄 Both (${groupSinks.length} Group${groupSinks.length === 1 ? '' : 's'} + Bot Chat)`;
    desc = `All newly discovered IT jobs are forwarded simultaneously to all ${groupSinks.length} group(s) and your private bot chat (${adminSink}).`;
  }

  const groupList = groupSinks.map((id, idx) => `  ${idx + 1}. 👥 Group ID: ${id}`).join('\n');

  return (
    `🎯 Destination Sinks & Forwarding Mode\n\n` +
    `📌 Active Forwarding Mode: ${modeName}\n` +
    `🤖 Admin Chat ID: ${adminSink || '(not set)'}\n\n` +
    `👥 Configured Group Destination Sinks (${groupSinks.length}):\n` +
    (groupList || '  (No group sinks configured)') + `\n\n` +
    `ℹ️ ${desc}\n\n` +
    `💡 Select an option below to add/remove sinks, switch mode, or test:`
  );
}

function formatMaxAgeMenuText() {
  return (
    `📅 Maximum Post Age Filter\n\n` +
    `📌 Current Setting: ${maxAgeDays} Days\n\n` +
    `The bot checks the publication date of each channel post during automated scraping:\n` +
    `• Any post published within the last ${maxAgeDays} days is analyzed for IT keywords.\n` +
    `• Any post older than ${maxAgeDays} days is automatically skipped to prevent sending old job listings.\n\n` +
    `💡 Select a quick timeframe below, or reply with a custom number of days (1 - 365):`
  );
}

function getMaxAgeMenuMarkup() {
  return {
    inline_keyboard: [
      [
        { text: `${maxAgeDays === 1 ? '✅ ' : ''}1 Day (Today only)`, callback_data: 'maxage_set_1' },
        { text: `${maxAgeDays === 3 ? '✅ ' : ''}3 Days`, callback_data: 'maxage_set_3' }
      ],
      [
        { text: `${maxAgeDays === 7 ? '✅ ' : ''}7 Days (1 Week)`, callback_data: 'maxage_set_7' },
        { text: `${maxAgeDays === 14 ? '✅ ' : ''}14 Days (2 Weeks)`, callback_data: 'maxage_set_14' }
      ],
      [
        { text: `${maxAgeDays === 30 ? '✅ ' : ''}30 Days (1 Month)`, callback_data: 'maxage_set_30' },
        { text: `${maxAgeDays === 60 ? '✅ ' : ''}60 Days (2 Months)`, callback_data: 'maxage_set_60' }
      ],
      [
        { text: '✏️ Input Custom Days', callback_data: 'maxage_custom_prompt' }
      ],
      [
        { text: '🔙 Back to Admin Panel', callback_data: 'admin_main' }
      ]
    ]
  };
}

function formatMaxAgeUpdatedResponse(newDays) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `✅ Max Post Age Updated Successfully!\n\n` +
    `📅 New Age Filter: ${newDays} Day${newDays === 1 ? '' : 's'}\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Status: ACTIVE in 30-second live scraper\n\n` +
    `ℹ️ The bot will now only collect and forward IT jobs published within the last ${newDays} day${newDays === 1 ? '' : 's'}. Any older posts will be automatically ignored.`
  );
}

const JOB_INDICATORS = [
  // English indicators
  'hiring', 'recruit', 'recruitment', 'job', 'vacancy', 'career', 'position',
  'opening', 'openings', 'work', 'employ', 'employment', 'staff', 'wanted',
  'needed', 'apply', 'application', 'join our team', 'join us', 'we are hiring',
  'looking for', 'seeking', 'vacant', 'role', 'roles', 'post', 'posts',
  'candidate', 'candidates', 'employee', 'employees', 'hire', 'hires',
  'full-time', 'part-time', 'intern', 'internship', 'fresher', 'experienced',
  // Khmer indicators
  'ឱកាសការងារ', 'ជ្រើសរើស', 'ជ្រើសរើសបុគ្គលិក', 'តួនាទី', 'តំណែង',
  'ដំណឹងជ្រើសរើស', 'ត្រូវការជ្រើសរើស', 'ប្រាក់ខែ', 'ដាក់ពាក្យ', 'បទពិសោធន៍',
  'ស្វែងរក', 'ទំនួលខុសត្រូវ'
];

const NEGATIVE_KEYWORDS = [
  // Only actual spam/contests/lottery (never block regular words like bonus, free, holiday, sale)
  'lucky draw', 'giveaway', 'give away', 'sweepstake', 'lottery',
  'chance to win', 'react to this post to win', 'winners will be announced',
  'win an iphone', 'win prizes', 'lucky winner',
  // Khmer contest / giveaway
  'ឈ្នះរង្វាន់', 'ចាប់រង្វាន់', 'ចាប់ឆ្នោត'
];

function cleanTextForMatching(raw) {
  if (!raw) return '';
  return raw
    .replace(/https?:\/\/[^\s]+/gi, ' ') // Strip URLs (e.g. wwwinfinity.net)
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, ' ') // Strip email addresses
    .replace(/@\w+/g, ' '); // Strip @usernames / handles
}

function isJobPost(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  // Block actual contests/giveaways
  for (const neg of NEGATIVE_KEYWORDS) {
    if (t.includes(neg)) return false;
  }

  // Must contain at least one job indicator (English or Khmer)
  let hasJobIndicator = false;
  for (const ind of JOB_INDICATORS) {
    const i = ind.toLowerCase().trim();
    if (!i) continue;
    if (t.includes(i)) {
      hasJobIndicator = true;
      break;
    }
  }
  if (!hasJobIndicator) return false;

  // Must contain at least one IT keyword (matched against sanitized text without email/URL noise)
  const cleaned = cleanTextForMatching(text);
  let hasITKeyword = false;
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    try {
      let re;
      if (k === '.net') {
        // Must be preceded by start of string, whitespace or punctuation, never a word character or dot
        re = /(?:^|[\s,;:(/\[])\.net(?=[\s,;:!?)\]/-]|$)/i;
      } else if (k === 'c#') {
        re = /(?:^|[\s,;:(/\[])c#(?=[\s,;:!?)\]/-]|$)/i;
      } else {
        const left = /^\w/.test(k) ? '\\b' : '';
        const right = /\w$/.test(k) ? '\\b' : '';
        re = new RegExp(left + escapeRegExp(k) + right, 'i');
      }
      if (re.test(cleaned)) {
        hasITKeyword = true;
        break;
      }
    } catch (e) {
      if (cleaned.includes(k)) {
        hasITKeyword = true;
        break;
      }
    }
  }
  return hasITKeyword;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN not set. Aborting.'); process.exit(1); }

const https = require('https');
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 30,
  maxFreeSockets: 10
});

const bot = new TelegramBot(TOKEN, {
  polling: true,
  request: { agent: httpsAgent }
});
console.log('IT Job Collection bot started (polling with persistent keep-alive).');

bot.on('polling_error', (error) => {
  if (error && error.code !== 'EFATAL') {
    console.error('Telegram polling notice:', error.message || error);
  }
});

// Sync bot menu commands:
// Sync bot menu commands:
const publicCommands = [
  { command: 'status', description: 'overview' },
  { command: 'recent', description: 'last 15 collected jobs' },
  { command: 'channels', description: 'see all 50 scraped channels' }
];

// 1. Regular users and groups see the 3 public commands in [/] menu
bot.setMyCommands(publicCommands, { scope: { type: 'all_group_chats' } }).catch(() => {});
bot.setMyCommands(publicCommands, { scope: { type: 'all_private_chats' } }).catch(() => {});
bot.setMyCommands(publicCommands, { scope: { type: 'default' } }).catch(() => {});

// 2. Admin user gets full admin command list in their private chat
for (const adminId of ADMIN_IDS) {
  bot.setMyCommands([
    ...publicCommands,
    { command: 'admin', description: '🛠️ [Admin] control panel' },
    { command: 'forwardjobs', description: '🚀 [Admin] forward N jobs to group' },
    { command: 'sinkmode', description: '🎯 [Admin] choose sink mode (groups/bot/both)' },
    { command: 'addsink', description: '➕ [Admin] add group destination sink' },
    { command: 'removesink', description: '🗑️ [Admin] remove group destination sink' },
    { command: 'sink', description: '🎯 [Admin] view destination sinks & mode' },
    { command: 'keywords', description: '🔍 [Admin] list filter keywords' },
    { command: 'addkeyword', description: '➕ [Admin] add filter keyword(s)' },
    { command: 'removekeyword', description: '🗑️ [Admin] remove filter keyword(s)' },
    { command: 'channels', description: '📢 [Admin] scraped channels' },
    { command: 'addchannel', description: '➕ [Admin] add scraped channel' },
    { command: 'removechannel', description: '🗑️ [Admin] remove scraped channel' }
  ], { scope: { type: 'chat', chat_id: adminId } }).catch(() => {});
}

function isPrivate(msg) {
  return msg.chat && msg.chat.type === 'private';
}

function isAllowedNonAdminCommand(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim().toLowerCase();
  return (
    t.startsWith('/start') ||
    t.startsWith('/status') ||
    t.startsWith('/recent') ||
    t.startsWith('/channels')
  );
}

// BotFather-style UI helpers and markup builders
function getAdminControlPanelMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '🔍 Manage Keywords', callback_data: 'admin_menu_keywords' },
        { text: '📢 Scraped Channels', callback_data: 'admin_menu_channels' }
      ],
      [
        { text: '🎯 Destination Sinks', callback_data: 'admin_menu_sink' },
        { text: `📅 Max Age: ${maxAgeDays}d`, callback_data: 'admin_menu_maxage' }
      ],
      [
        { text: '🚀 Forward Jobs to Group', callback_data: 'admin_forward_prompt' },
        { text: '📊 Bot Status', callback_data: 'admin_status' }
      ],
      [
        { text: '⚡ Run Live Scan Now', callback_data: 'admin_run_scan' }
      ]
    ]
  };
}

function getKeywordsMenuMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '➕ Add Single Keyword', callback_data: 'kw_single' },
        { text: '➕➕ Add Multiple Keywords', callback_data: 'kw_multiple' }
      ],
      [
        { text: '📋 View All Keywords', callback_data: 'kw_list' },
        { text: '🗑️ Remove Keyword', callback_data: 'kw_remove' }
      ],
      [
        { text: '🔙 Back to Admin Menu', callback_data: 'admin_main' }
      ]
    ]
  };
}

function getChannelsMenuMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '➕ Add Channel', callback_data: 'ch_add' },
        { text: '🗑️ Remove Channel', callback_data: 'ch_remove' }
      ],
      [
        { text: '📋 View All Channels', callback_data: 'ch_list' }
      ],
      [
        { text: '🔙 Back to Admin Menu', callback_data: 'admin_main' }
      ]
    ]
  };
}

function getSinkMenuMarkup() {
  const groupLabel = sinkMode === 'group' ? `✅ 👥 Groups (${groupSinks.length})` : `👥 Groups (${groupSinks.length})`;
  const adminLabel = sinkMode === 'admin' ? '✅ 🤖 Only Bot Chat' : '🤖 Only Bot Chat';
  const bothLabel = sinkMode === 'both' ? `✅ 🔄 Both (${groupSinks.length} Grps + Bot)` : `🔄 Both (${groupSinks.length} Grps + Bot)`;

  return {
    inline_keyboard: [
      [
        { text: groupLabel, callback_data: 'sink_mode_group' },
        { text: adminLabel, callback_data: 'sink_mode_admin' }
      ],
      [
        { text: bothLabel, callback_data: 'sink_mode_both' }
      ],
      [
        { text: '➕ Add Group Sink', callback_data: 'sink_add' },
        { text: '🗑️ Remove Group Sink', callback_data: 'sink_remove' }
      ],
      [
        { text: '🚀 Forward Jobs to Group', callback_data: 'admin_forward_prompt' }
      ],
      [
        { text: '📋 View All Sinks', callback_data: 'sink_list' },
        { text: '🧪 Test All Sinks', callback_data: 'sink_test' }
      ],
      [
        { text: '🔙 Back to Admin Menu', callback_data: 'admin_main' }
      ]
    ]
  };
}

function getForwardCountMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '1 Job', callback_data: 'fwd_count_1' },
        { text: '2 Jobs', callback_data: 'fwd_count_2' },
        { text: '3 Jobs', callback_data: 'fwd_count_3' },
        { text: '4 Jobs', callback_data: 'fwd_count_4' }
      ],
      [
        { text: '5 Jobs', callback_data: 'fwd_count_5' },
        { text: '10 Jobs', callback_data: 'fwd_count_10' },
        { text: '15 Jobs', callback_data: 'fwd_count_15' },
        { text: '20 Jobs', callback_data: 'fwd_count_20' }
      ],
      [
        { text: '🔙 Back to Admin Menu', callback_data: 'admin_main' }
      ]
    ]
  };
}

function formatForwardPromptText() {
  return (
    `🚀 Forward Jobs to Group(s)\n\n` +
    `Please enter the number of recent job posts to forward (e.g. 1, 2, 3, 4, 15...):\n\n` +
    `💡 Send any number in chat:\n` +
    `• Type 1 - forwards the newest 1 job\n` +
    `• Type 2 - forwards the newest 2 jobs\n` +
    `• Type 3 - forwards the newest 3 jobs\n` +
    `• Type 4 - forwards the newest 4 jobs\n` +
    `• Or tap one of the quick buttons below!\n\n` +
    `📊 Available in Archive: ${collected.length} jobs\n` +
    `👥 Target Group Sink(s): ${groupSinks.length} active\n\n` +
    `(Or tap Cancel below to abort)`
  );
}

function getRemoveSinkMarkup() {
  const buttons = groupSinks.map((s, idx) => ([
    { text: `🗑️ Remove Sink #${idx + 1} (${s})`, callback_data: `sink_del_${s}` }
  ]));
  buttons.push([{ text: '🔙 Back to Sink Menu', callback_data: 'admin_menu_sink' }]);
  return { inline_keyboard: buttons };
}

function getCancelMarkup(backAction = 'admin_main') {
  return {
    inline_keyboard: [
      [{ text: '❌ Cancel', callback_data: backAction }]
    ]
  };
}

async function editOrSend(chatId, messageId, text, markup) {
  if (messageId) {
    try {
      return await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: markup || { inline_keyboard: [] }
      });
    } catch (e) {
      if (e.message && e.message.includes('message is not modified')) {
        return null;
      }
    }
  }
  return await safeSend(chatId, text, { reply_markup: markup });
}

const adminState = {};

// Handle interactive admin input (BotFather-style state machine)
bot.on('message', async (msg) => {
  if (!isAdmin(msg)) return;
  const adminId = String(msg.from ? msg.from.id : msg.chat.id);
  const state = adminState[adminId];
  if (!state) return;

  const text = (msg.text || '').trim();

  // If input was sent in a group chat, clean up the input message so the group stays clean
  if (!isPrivate(msg)) {
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
  }

  // Handle cancellation or slash commands
  if (text.toLowerCase() === '/cancel') {
    delete adminState[adminId];
    return safeSend(msg.chat.id, '❌ Action cancelled. Returned to normal mode.', {
      reply_markup: getAdminControlPanelMarkup()
    });
  }
  if (text.startsWith('/')) {
    delete adminState[adminId];
    return; // Allow standard slash command handler to process
  }

  // 1. Single keyword
  if (state.action === 'add_kw_single') {
    const val = text.trim();
    if (!val) {
      return safeSend(msg.chat.id, '⚠️ Please send a valid keyword or tap Cancel below.', {
        reply_markup: getCancelMarkup('admin_menu_keywords')
      });
    }
    delete adminState[adminId];
    const lower = val.toLowerCase();
    const totalBefore = keywords.length;
    if (!keywords.includes(lower)) {
      keywords.push(lower);
      saveKeywords();
      return safeSend(msg.chat.id, formatKeywordAddedResponse(lower, totalBefore, keywords.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Another Single', callback_data: 'kw_single' }],
            [{ text: '➕➕ Add Multiple Keywords', callback_data: 'kw_multiple' }],
            [{ text: '📋 View All Keywords', callback_data: 'kw_list' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      });
    } else {
      return safeSend(msg.chat.id, formatKeywordExistsResponse(lower, keywords.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Another Single', callback_data: 'kw_single' }],
            [{ text: '📋 View All Keywords', callback_data: 'kw_list' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      });
    }
  }

  // 2. Multiple keywords
  if (state.action === 'add_kw_multiple') {
    const items = text.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    delete adminState[adminId];
    if (!items.length) {
      return safeSend(msg.chat.id, '⚠️ No valid keywords detected. Please send keywords separated by commas, e.g. Flutter, Golang', {
        reply_markup: getCancelMarkup('admin_menu_keywords')
      });
    }
    const totalBefore = keywords.length;
    const added = [];
    const existing = [];
    for (const it of items) {
      if (!keywords.includes(it)) {
        keywords.push(it);
        added.push(it);
      } else {
        existing.push(it);
      }
    }
    if (added.length) saveKeywords();

    return safeSend(msg.chat.id, formatMultipleKeywordsAddedResponse(added, existing, totalBefore, keywords.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕➕ Add More Keywords', callback_data: 'kw_multiple' }],
          [{ text: '📋 View All Keywords', callback_data: 'kw_list' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  }

  // 3. Remove keyword(s)
  if (state.action === 'remove_kw') {
    const items = text.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    delete adminState[adminId];
    if (!items.length) {
      return safeSend(msg.chat.id, '⚠️ No valid keywords detected.', {
        reply_markup: getCancelMarkup('admin_menu_keywords')
      });
    }
    const totalBefore = keywords.length;
    const removed = [];
    const notFound = [];
    for (const it of items) {
      if (keywords.includes(it)) {
        keywords = keywords.filter(k => k !== it);
        removed.push(it);
      } else {
        notFound.push(it);
      }
    }
    if (removed.length) saveKeywords();

    return safeSend(msg.chat.id, formatKeywordsRemovedResponse(removed, notFound, totalBefore, keywords.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ Remove More Keywords', callback_data: 'kw_remove' }],
          [{ text: '📋 View All Keywords', callback_data: 'kw_list' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  }

  // 4. Add channel
  if (state.action === 'add_channel') {
    const u = text.replace(/^@/, '').trim();
    delete adminState[adminId];
    if (!u) {
      return safeSend(msg.chat.id, '⚠️ Invalid channel username.', {
        reply_markup: getCancelMarkup('admin_menu_channels')
      });
    }
    const totalBefore = channels.length;
    if (!channels.includes(u)) {
      channels.push(u);
      saveChannels();
      return safeSend(msg.chat.id, formatChannelAddedResponse(u, totalBefore, channels.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚡ Scrape This Channel Now', callback_data: `scrape_one_${u}` }],
            [{ text: '➕ Add Another Channel', callback_data: 'ch_add' }],
            [{ text: '📋 View All Channels', callback_data: 'ch_list' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      });
    } else {
      return safeSend(msg.chat.id, formatChannelExistsResponse(u, channels.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚡ Scrape This Channel Now', callback_data: `scrape_one_${u}` }],
            [{ text: '📢 Channels Menu', callback_data: 'admin_menu_channels' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      });
    }
  }

  // 5. Remove channel
  if (state.action === 'remove_channel') {
    const u = text.replace(/^@/, '').trim();
    delete adminState[adminId];
    const totalBefore = channels.length;
    if (channels.includes(u)) {
      channels = channels.filter(c => c !== u);
      saveChannels();
      return safeSend(msg.chat.id, formatChannelRemovedResponse(u, totalBefore, channels.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🗑️ Remove Another Channel', callback_data: 'ch_remove' }],
            [{ text: '📋 View All Channels', callback_data: 'ch_list' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      });
    } else {
      return safeSend(msg.chat.id,
        `⚠️ Channel @${u} was not found in the scraped list.\n\n` +
        `📢 Total Monitored Channels: ${channels.length}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📢 Channels Menu', callback_data: 'admin_menu_channels' }],
              [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
            ]
          }
        }
      );
    }
  }

  // 6. Add group sink
  if (state.action === 'add_sink_group' || state.action === 'set_sink_custom' || state.action === 'set_sink_group') {
    const val = text.trim();
    delete adminState[adminId];
    if (!val) {
      return safeSend(msg.chat.id, '⚠️ Invalid Chat ID.', {
        reply_markup: getCancelMarkup('admin_menu_sink')
      });
    }
    const totalBefore = groupSinks.length;
    if (!groupSinks.includes(val)) {
      groupSinks.push(val);
      saveSink();
      return safeSend(msg.chat.id, formatSinkAddedResponse(val, totalBefore, groupSinks.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🧪 Test All Sinks', callback_data: 'sink_test' }],
            [{ text: '➕ Add Another Group Sink', callback_data: 'sink_add' }],
            [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      });
    } else {
      return safeSend(msg.chat.id,
        `ℹ️ Destination Sink Already Exists!\n\n` +
        `Group ID ${val} is already in your active sinks list.\n\n` +
        `👥 Total Group Sinks: ${groupSinks.length}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
              [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
            ]
          }
        }
      );
    }
  }

  // 7. Remove group sink
  if (state.action === 'remove_sink_group') {
    const val = text.trim();
    delete adminState[adminId];
    const totalBefore = groupSinks.length;
    if (groupSinks.includes(val)) {
      groupSinks = groupSinks.filter(s => s !== val);
      saveSink();
      return safeSend(msg.chat.id, formatSinkRemovedResponse(val, totalBefore, groupSinks.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🗑️ Remove Another Sink', callback_data: 'sink_remove' }],
            [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      });
    } else {
      return safeSend(msg.chat.id,
        `⚠️ Group Sink ID ${val} was not found in your active sinks list.\n\n` +
        `👥 Total Group Sinks: ${groupSinks.length}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
              [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
            ]
          }
        }
      );
    }
  }

  // 8. Forward custom job count to groups
  if (state.action === 'forward_custom_count') {
    const val = parseInt(text.trim(), 10);
    delete adminState[adminId];
    if (isNaN(val) || val <= 0) {
      return safeSend(msg.chat.id,
        `⚠️ Invalid number. Please enter a valid number of jobs to forward (e.g. 15), or tap Cancel below.`,
        { reply_markup: getCancelMarkup('admin_main') }
      );
    }
    const count = Math.min(val, 50);
    return forwardRecentJobsToGroups(msg.chat.id, count);
  }

  // 9. Set custom max post age in days
  if (state.action === 'set_custom_maxage') {
    const val = parseInt(text.trim(), 10);
    delete adminState[adminId];
    if (isNaN(val) || val < 1 || val > 365) {
      return safeSend(msg.chat.id,
        `⚠️ Invalid number of days. Please enter a number between 1 and 365 (e.g. 7, 14, 30), or tap Cancel below.`,
        { reply_markup: getCancelMarkup('admin_menu_maxage') }
      );
    }
    maxAgeDays = val;
    saveSink();
    return safeSend(msg.chat.id, formatMaxAgeUpdatedResponse(maxAgeDays), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Bot Status', callback_data: 'admin_status' }],
          [{ text: '📅 Edit Max Age', callback_data: 'admin_menu_maxage' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  }
});

// Callback query handler for BotFather-style inline keyboards
bot.on('callback_query', async (query) => {
  const fromId = query.from ? String(query.from.id) : '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : fromId;
  const messageId = query.message ? query.message.message_id : null;
  const data = query.data;

  // Security check: Only admins can trigger admin callbacks
  if (!ADMIN_IDS.includes(fromId)) {
    return bot.answerCallbackQuery(query.id, {
      text: '⛔ Access denied: Admin only!',
      show_alert: true
    }).catch(() => {});
  }

  bot.answerCallbackQuery(query.id).catch(() => {});

  if (data === 'admin_main') {
    delete adminState[fromId];
    return editOrSend(chatId, messageId,
      `🛠️ IT Job Collection Bot — Admin Control Panel\n\n` +
      `Welcome to the Admin Control Panel. You can customize all bot settings directly here just like in BotFather:\n\n` +
      `• 🔍 Keywords: Manage IT job title and skill filter keywords\n` +
      `• 📢 Channels: Manage public telegram channels to scrape\n` +
      `• 🎯 Destination Sink: Set channel/group where jobs are forwarded\n` +
      `• 📊 Bot Status: View live collection statistics & health\n` +
      `• ⚡ Run Live Scan: Manually trigger an immediate scan of all channels`,
      getAdminControlPanelMarkup()
    );
  }

  if (data === 'admin_menu_keywords') {
    delete adminState[fromId];
    return editOrSend(chatId, messageId,
      `🔍 IT Keywords Management\n\n` +
      `Current Filter Keywords: ${keywords.length}\n` +
      `These keywords are used to identify IT job opportunities across all scraped channels.\n\n` +
      `💡 Select an action below:`,
      getKeywordsMenuMarkup()
    );
  }

  if (data === 'kw_single') {
    adminState[fromId] = { action: 'add_kw_single' };
    return editOrSend(chatId, messageId,
      `➕ Add Single Keyword\n\n` +
      `Please send the IT keyword you want to add.\n\n` +
      `💡 Example:\n` +
      `Flutter\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_keywords')
    );
  }

  if (data === 'kw_multiple') {
    adminState[fromId] = { action: 'add_kw_multiple' };
    return editOrSend(chatId, messageId,
      `➕➕ Add Multiple Keywords\n\n` +
      `Please send multiple keywords separated by commas (,).\n\n` +
      `💡 Example:\n` +
      `Flutter, Golang, Ruby, Next.js\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_keywords')
    );
  }

  if (data === 'kw_remove') {
    adminState[fromId] = { action: 'remove_kw' };
    return editOrSend(chatId, messageId,
      `🗑️ Remove Keyword(s)\n\n` +
      `Please send the keyword or comma-separated keywords you want to remove.\n\n` +
      `💡 Example:\n` +
      `Flutter\n` +
      `or:\n` +
      `Flutter, Golang, Ruby\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_keywords')
    );
  }

  if (data === 'kw_list') {
    delete adminState[fromId];
    return editOrSend(chatId, messageId,
      `🔍 Filter Keywords (${keywords.length}):\n\n` +
      keywords.join(', ') +
      `\n\n💡 Select an action below:`,
      getKeywordsMenuMarkup()
    );
  }

  if (data === 'admin_menu_channels') {
    delete adminState[fromId];
    return editOrSend(chatId, messageId,
      `📢 Scraped Channels Management\n\n` +
      `Total Monitored Channels: ${channels.length}\n` +
      `The bot automatically scans these public channels every 30 seconds for IT jobs.\n\n` +
      `💡 Select an action below:`,
      getChannelsMenuMarkup()
    );
  }

  if (data === 'ch_add') {
    adminState[fromId] = { action: 'add_channel' };
    return editOrSend(chatId, messageId,
      `➕ Add Scraped Channel\n\n` +
      `Please send the Telegram channel username (with or without @).\n\n` +
      `💡 Example:\n` +
      `cambodiaitjobs\n` +
      `or:\n` +
      `@khmerdevelopers\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_channels')
    );
  }

  if (data === 'ch_remove') {
    adminState[fromId] = { action: 'remove_channel' };
    return editOrSend(chatId, messageId,
      `🗑️ Remove Scraped Channel\n\n` +
      `Please send the Telegram channel username to remove.\n\n` +
      `💡 Example:\n` +
      `cambodiaitjobs\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_channels')
    );
  }

  if (data === 'ch_list') {
    delete adminState[fromId];
    const list = channels.map((c, i) => `${i + 1}. @${c}`).join('\n');
    return editOrSend(chatId, messageId,
      `📢 Scraped Channels (${channels.length}):\n\n${list}\n\n💡 Select an action below:`,
      getChannelsMenuMarkup()
    );
  }

  if (data === 'admin_menu_sink') {
    delete adminState[fromId];
    return editOrSend(chatId, messageId,
      formatSinkMenuText(),
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_mode_group') {
    delete adminState[fromId];
    sinkMode = 'group';
    saveSink();
    bot.answerCallbackQuery(query.id, { text: `Mode set to: 👥 Groups (${groupSinks.length})` }).catch(() => {});
    return editOrSend(chatId, messageId,
      `${formatSinkModeUpdatedResponse('group')}\n\n${formatSinkMenuText()}`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_mode_admin') {
    delete adminState[fromId];
    sinkMode = 'admin';
    saveSink();
    bot.answerCallbackQuery(query.id, { text: 'Mode set to: 🤖 Only Bot Chat' }).catch(() => {});
    return editOrSend(chatId, messageId,
      `${formatSinkModeUpdatedResponse('admin')}\n\n${formatSinkMenuText()}`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_mode_both') {
    delete adminState[fromId];
    sinkMode = 'both';
    saveSink();
    bot.answerCallbackQuery(query.id, { text: `Mode set to: 🔄 Both (${groupSinks.length} Grps + Bot)` }).catch(() => {});
    return editOrSend(chatId, messageId,
      `${formatSinkModeUpdatedResponse('both')}\n\n${formatSinkMenuText()}`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_add' || data === 'sink_custom_group' || data === 'sink_custom') {
    adminState[fromId] = { action: 'add_sink_group' };
    return editOrSend(chatId, messageId,
      `➕ Add New Group Destination Sink\n\n` +
      `Please send the Telegram group or channel ID where you want IT jobs delivered.\n\n` +
      `💡 Current Group Sinks (${groupSinks.length}):\n` +
      groupSinks.map((s, idx) => `• #${idx + 1}: ${s}`).join('\n') + `\n\n` +
      `💡 Example for Supergroup:\n` +
      `-1004469567529\n\n` +
      `💡 Tip: You can also invite the bot to any group as Admin and send /addsink directly in that group!\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_sink')
    );
  }

  if (data === 'sink_remove') {
    adminState[fromId] = { action: 'remove_sink_group' };
    if (!groupSinks.length) {
      delete adminState[fromId];
      return editOrSend(chatId, messageId,
        `⚠️ No group sinks currently configured to remove.\n\n` +
        `Tap below to add a new group sink:`,
        getSinkMenuMarkup()
      );
    }
    return editOrSend(chatId, messageId,
      `🗑️ Remove Destination Sink\n\n` +
      `Tap a sink below to remove it with 1 click, or send the Chat ID to remove:\n\n` +
      `👥 Current Group Sinks (${groupSinks.length}):\n` +
      groupSinks.map((s, idx) => `  ${idx + 1}. ${s}`).join('\n') + `\n\n` +
      `(Or tap Cancel below to abort)`,
      getRemoveSinkMarkup()
    );
  }

  if (data && data.startsWith('sink_del_')) {
    delete adminState[fromId];
    const remId = data.replace('sink_del_', '').trim();
    const totalBefore = groupSinks.length;
    groupSinks = groupSinks.filter(s => s !== remId);
    saveSink();
    bot.answerCallbackQuery(query.id, { text: `Removed sink: ${remId}` }).catch(() => {});
    return editOrSend(chatId, messageId,
      `${formatSinkRemovedResponse(remId, totalBefore, groupSinks.length)}\n\n${formatSinkMenuText()}`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_list') {
    delete adminState[fromId];
    const list = groupSinks.map((s, idx) => `• Group #${idx + 1}: ${s}`).join('\n');
    return editOrSend(chatId, messageId,
      `📋 Active Destination Sinks (${groupSinks.length}):\n\n` +
      (list || 'No group sinks configured.') + `\n\n` +
      `📌 Forwarding Mode: ${sinkMode.toUpperCase()}\n` +
      `🤖 Admin Bot Chat: ${adminSink}\n\n` +
      `💡 Tap an action below:`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_test') {
    delete adminState[fromId];
    const targetSinks = getTargetSinks();
    if (!targetSinks.length) {
      return bot.answerCallbackQuery(query.id, {
        text: '⚠️ No destination sink configured yet!',
        show_alert: true
      }).catch(() => {});
    }
    bot.answerCallbackQuery(query.id, { text: 'Sending verification ping to all active sinks...' }).catch(() => {});
    const now = formatPhnomPenhDate(new Date()).display;

    const results = [];
    for (const targetId of targetSinks) {
      const isGroup = groupSinks.includes(targetId);
      const targetLabel = isGroup ? `👥 Group Sink (${targetId})` : `🤖 Admin Bot Chat (${targetId})`;
      try {
        const sent = await bot.sendMessage(targetId,
          `🧪 IT Job Collection Bot — Sink Verification Test\n\n` +
          `✅ Connection Successful!\n` +
          `Target: ${targetLabel}\n` +
          `Active Mode: ${sinkMode === 'both' ? `🔄 Both (${groupSinks.length} Grps + Bot)` : (sinkMode === 'group' ? `👥 Groups (${groupSinks.length})` : '🤖 Only Bot Chat')}\n` +
          `🕒 Verified: ${now}`
        );
        results.push(`✅ ${targetLabel}: Delivered (Message #${sent.message_id})`);
      } catch (err) {
        results.push(`❌ ${targetLabel}: Failed (${err.message})`);
      }
    }

    return safeSend(chatId,
      `🧪 Sink Verification Test Report\n\n` +
      `🕒 Tested: ${now}\n` +
      `📌 Forwarding Mode: ${sinkMode.toUpperCase()}\n` +
      `🎯 Tested Destinations: ${targetSinks.length}\n\n` +
      `Results:\n` +
      results.join('\n\n') + `\n\n` +
      (results.some(r => r.startsWith('❌'))
        ? `💡 If a group test failed, ensure the bot is added to that group as an Administrator with "Post Messages" permission.`
        : `🎉 All ${targetSinks.length} destination(s) are connected and ready to receive IT jobs!`),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      }
    );
  }

  if (data && data.startsWith('scrape_one_')) {
    delete adminState[fromId];
    const targetChannel = data.replace('scrape_one_', '');
    bot.answerCallbackQuery(query.id, { text: `Scraping @${targetChannel}...` }).catch(() => {});
    safeSend(chatId, `⚡ Starting instant scrape of @${targetChannel}...`);
    scrapeChannel(targetChannel)
      .then(() => {
        safeSend(chatId,
          `✅ Instant scrape completed for @${targetChannel}!\n\n` +
          `Any newly discovered IT jobs published today have been delivered to your destination sink (${sink || 'not set'}).`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📢 Channels Menu', callback_data: 'admin_menu_channels' }],
                [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
              ]
            }
          }
        );
      })
      .catch((err) => {
        safeSend(chatId, `⚠️ Scrape error for @${targetChannel}: ${err.message}`);
      });
    return;
  }

  if (data === 'admin_status') {
    delete adminState[fromId];
    return sendStatus(chatId, true);
  }

  if (data === 'admin_forward_prompt') {
    adminState[fromId] = { action: 'forward_custom_count' };
    return editOrSend(chatId, messageId,
      formatForwardPromptText(),
      getForwardCountMarkup()
    );
  }

  if (data && data.startsWith('fwd_count_')) {
    delete adminState[fromId];
    const count = parseInt(data.replace('fwd_count_', ''), 10) || 15;
    bot.answerCallbackQuery(query.id, { text: `🚀 Forwarding ${count} jobs to group(s)...` }).catch(() => {});
    return forwardRecentJobsToGroups(chatId, count);
  }

  if (data === 'admin_forward_15') {
    delete adminState[fromId];
    bot.answerCallbackQuery(query.id, { text: '🚀 Pulling 15 jobs and forwarding to group...' }).catch(() => {});
    return forwardRecentJobsToGroups(chatId, 15);
  }

  if (data === 'admin_menu_maxage') {
    adminState[fromId] = { action: 'set_custom_maxage' };
    return editOrSend(chatId, messageId,
      formatMaxAgeMenuText(),
      getMaxAgeMenuMarkup()
    );
  }

  if (data && data.startsWith('maxage_set_')) {
    delete adminState[fromId];
    const days = parseInt(data.replace('maxage_set_', ''), 10) || 30;
    maxAgeDays = days;
    saveSink();
    bot.answerCallbackQuery(query.id, { text: `✅ Max post age set to ${days} days!` }).catch(() => {});
    return editOrSend(chatId, messageId,
      formatMaxAgeUpdatedResponse(days),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 Bot Status', callback_data: 'admin_status' }],
            [{ text: '📅 Edit Max Age', callback_data: 'admin_menu_maxage' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      }
    );
  }

  if (data === 'maxage_custom_prompt') {
    adminState[fromId] = { action: 'set_custom_maxage' };
    return editOrSend(chatId, messageId,
      `✏️ Set Custom Max Post Age\n\n` +
      `Please reply with the maximum post age in days (between 1 and 365).\n\n` +
      `💡 Example:\n` +
      `7\n` +
      `or:\n` +
      `45\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_maxage')
    );
  }

  if (data === 'admin_run_scan') {
    delete adminState[fromId];
    bot.answerCallbackQuery(query.id, { text: '⚡ Live scan initiated!' }).catch(() => {});
    pollChannels().catch(console.error);
    const now = formatPhnomPenhDate(new Date()).display;
    return safeSend(chatId,
      `⚡ Live Channel Scrape Initiated!\n\n` +
      `📡 Scanning all ${channels.length} channels in parallel batches of 6...\n` +
      `🕒 Triggered: ${now}\n` +
      `🎯 Destination Sink: ${sink || '(not set)'}\n` +
      `🔍 IT Keywords: ${keywords.length} active\n\n` +
      `Any jobs published today will appear in your destination sink.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 Bot Status', callback_data: 'admin_status' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      }
    );
  }
});

// Restrict regular users: no arbitrary input allowed, only allowed commands
bot.on('message', (msg) => {
  if (isAdmin(msg)) return; // Admin is unrestricted

  // 1. In private chat: block any arbitrary text, media, or non-allowed commands
  if (isPrivate(msg)) {
    if (!isAllowedNonAdminCommand(msg.text)) {
      bot.sendMessage(msg.chat.id,
        `⚠️ Custom input is not supported.\n\n` +
        `Please use the allowed commands only:\n` +
        `• /status - overview\n` +
        `• /recent - last 15 collected jobs\n` +
        `• /channels - see all ${channels.length} scraped channels`,
        {
          reply_markup: {
            keyboard: [
              [{ text: '/recent' }, { text: '/status' }],
              [{ text: '/channels' }]
            ],
            resize_keyboard: true
          }
        }
      ).catch(() => {});
    }
    return;
  }

  // 2. In group chats: block all normal messages, images, files, stickers, voice, etc. from regular members
  // Only allow the designated bot commands (/status, /recent, /channels, /start)
  if (isSource(msg.chat.id) && !groupSinks.includes(String(msg.chat.id)) && String(msg.chat.id) !== String(groupSink)) {
    return;
  }

  // Never attempt to delete messages sent by the bot itself
  if (msg.from && msg.from.is_bot && (msg.from.id === 9186503282 || msg.from.username === 'facescan_roeurn_bot')) {
    return;
  }

  console.log(`[Group Message Received] Chat: ${msg.chat.id}, From: ${msg.from?.first_name} (${msg.from?.id}), Text: "${msg.text || (msg.caption ? 'caption: ' + msg.caption : '[media]')}", isAdmin: ${isAdmin(msg)}`);

  if (!isAllowedNonAdminCommand(msg.text)) {
    const senderName = msg.from
      ? `${msg.from.first_name || ''} ${msg.from.last_name || ''} (@${msg.from.username || msg.from.id})`.trim()
      : 'Unknown member';
    bot.deleteMessage(msg.chat.id, msg.message_id)
      .then(() => {
        console.log(`[Auto-Deleted] Group message #${msg.message_id} from non-admin "${senderName}" in chat ${msg.chat.id}`);
      })
      .catch((err) => {
        console.error(`[Delete Failed] Message #${msg.message_id} in chat ${msg.chat.id}: ${err.message}`);
      });
  }
});

async function safeSend(chatId, text, opts = {}) {
  if (!text) return;

  const sendOne = async (targetId, content) => {
    try {
      return await bot.sendMessage(targetId, content, opts);
    } catch (e) {
      if (e.response && e.response.body && e.response.body.parameters && e.response.body.parameters.migrate_to_chat_id) {
        const newId = String(e.response.body.parameters.migrate_to_chat_id);
        console.log(`Chat ${targetId} upgraded to supergroup ${newId}. Updating sinks.`);
        const idx = groupSinks.indexOf(String(targetId));
        if (idx !== -1) {
          groupSinks[idx] = newId;
          saveSink();
        }
        try { return await bot.sendMessage(newId, content, opts); } catch (err2) { console.error('retry send error', newId, err2.message); }
      } else {
        console.error('send error', targetId, e.message);
      }
      return null;
    }
  };

  const MAX_CHUNK = 4000;
  if (text.length <= MAX_CHUNK) {
    return await sendOne(chatId, text);
  }
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if ((current + '\n' + line).length > MAX_CHUNK) {
      await sendOne(chatId, current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) {
    await sendOne(chatId, current);
  }
}

function sourceLabel(chat) {
  return chat.title || chat.username || chat.first_name || String(chat.id);
}

async function sendStatus(targetChatId, isAdminUser = false) {
  const todayStr = getPhnomPenhDateStr(new Date());
  const todayCount = collected.filter(c => getPhnomPenhDateStr(c.date) === todayStr).length;
  const nowInfo = formatPhnomPenhDate(new Date());

  const sinkLine = isAdminUser
    ? `🎯 Destination Sink: ${groupSink || '(not set)'} [Mode: ${sinkMode.toUpperCase()}]\n`
    : '';
  const sourcesLine = isAdminUser ? `📡 Active Sources: ${sources.length}\n` : '';
  const maxAgeLine = isAdminUser ? `📅 Max Post Age: ${maxAgeDays} days\n` : '';

  return await safeSend(targetChatId,
    `📊 IT Job Collection Bot Status\n\n` +
    `🕒 Time (Cambodia): ${nowInfo.display}\n` +
    `🔥 Jobs Published Today: ${todayCount}\n` +
    `📦 Total Collected Jobs: ${collected.length}\n` +
    `📢 Monitored Channels: ${channels.length}\n` +
    sourcesLine +
    sinkLine +
    maxAgeLine +
    `🔍 IT Keywords: ${keywords.length}\n` +
    `👁️ Processed Posts: ${seen.size}\n` +
    `⚡ Auto-Monitor Interval: 30 seconds`,
    isAdminUser ? {
      reply_markup: {
        inline_keyboard: [
          [
            { text: `📅 Edit Max Age (${maxAgeDays}d)`, callback_data: 'admin_menu_maxage' },
            { text: '🛠️ Admin Panel', callback_data: 'admin_main' }
          ]
        ]
      }
    } : {}
  );
}

async function sendRecent(targetChatId, count = 10) {
  if (!collected.length) return await safeSend(targetChatId, 'No collected jobs yet.');

  const todayStr = getPhnomPenhDateStr(new Date());
  const sorted = collected.slice().sort((a, b) => {
    const aIsToday = getPhnomPenhDateStr(a.date) === todayStr ? 1 : 0;
    const bIsToday = getPhnomPenhDateStr(b.date) === todayStr ? 1 : 0;
    if (aIsToday !== bIsToday) return bIsToday - aIsToday;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const list = sorted.slice(0, count);

  const sendSingle = (c) => {
    const text = decodeHtmlEntities(c.text || c.snippet || '').trim();
    const source = c.source ? (c.source.startsWith('@') ? c.source : `@${c.source}`) : '';
    const dateInfo = formatPhnomPenhDate(c.date);
    const badge = dateInfo.isToday ? '🔥 [NEW JOB POST TODAY]' : '📅 [RECENT JOB POST]';
    const link = c.link || (c.sourceId && c.messageId ? `https://t.me/${String(c.sourceId).replace(/^@/, '')}/${c.messageId}` : '');
    const postMsg = `${badge}\n\n${text}\n\n(Source: ${source})${dateInfo.display ? `\nPosted: ${dateInfo.display}` : ''}${link ? `\n${link}` : ''}`;

    if (c.media && c.media.fileId) {
      return bot.sendPhoto(targetChatId, c.media.fileId, { caption: postMsg.slice(0, 1024) })
        .catch(() => safeSend(targetChatId, postMsg));
    }
    return safeSend(targetChatId, postMsg);
  };

  let firstResult = null;
  for (let i = 0; i < list.length; i += 2) {
    const batch = list.slice(i, i + 2);
    const results = await Promise.all(batch.map(c => sendSingle(c)));
    if (!firstResult && results[0]) firstResult = results[0];
  }
  return firstResult;
}

async function forwardRecentJobsToGroups(adminChatId, count = 15) {
  if (!groupSinks.length) {
    return safeSend(adminChatId,
      `⚠️ No group destination sinks configured yet!\n\n` +
      `Please add a group sink first using /addsink <group_id> or via the Sink Settings menu.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Group Sink', callback_data: 'sink_add' }],
            [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }]
          ]
        }
      }
    );
  }

  if (!collected.length) {
    return safeSend(adminChatId, '⚠️ No collected jobs in the archive yet.');
  }

  const actualCount = Math.min(count, collected.length, 30);
  const now = formatPhnomPenhDate(new Date()).display;

  safeSend(adminChatId, `🚀 Starting forwarding of the latest ${actualCount} IT jobs to ${groupSinks.length} group sink(s)...`);

  let totalDelivered = 0;
  for (const groupTarget of groupSinks) {
    try {
      await sendRecent(groupTarget, actualCount);
      totalDelivered++;
    } catch (e) {
      console.error(`Failed to forward recent jobs to ${groupTarget}:`, e.message);
    }
  }

  return safeSend(adminChatId,
    `✅ Successfully Forwarded ${actualCount} IT Jobs!\n\n` +
    `📦 Total Jobs Sent: ${actualCount}\n` +
    `👥 Delivered to Groups (${totalDelivered}/${groupSinks.length}):\n` +
    groupSinks.map((g, idx) => `  ${idx + 1}. ${g}`).join('\n') + `\n` +
    `🕒 Completed: ${now}\n\n` +
    `All ${actualCount} jobs are now live in your group(s)!`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Bot Status', callback_data: 'admin_status' }],
          [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    }
  );
}

async function sendChannels(targetChatId) {
  if (!channels.length) return await safeSend(targetChatId, 'No channels configured.');
  const list = channels.map((c, i) => `${i + 1}. @${c}`).join('\n');
  return await safeSend(targetChatId, `📢 Scraped Channels (${channels.length}):\n\n${list}`);
}

async function deliverToUserOrRedirect(msg, commandName, executeFn) {
  const userId = msg.from ? msg.from.id : null;
  const isBotUser = !!(msg.from && msg.from.is_bot);

  // 1. Deliver content directly to the user's private bot chat if available
  if (userId && !isBotUser && typeof executeFn === 'function') {
    executeFn(userId).catch(() => {});
  }

  // 2. Format sender name nicely
  let name = 'there';
  if (msg.from && !isBotUser) {
    if (msg.from.username) {
      name = '@' + msg.from.username;
    } else if (msg.from.first_name && msg.from.first_name.toLowerCase() !== 'group') {
      name = msg.from.first_name;
    }
  }

  // 3. Post reply in group telling the user to use the command directly with the bot
  const label = commandName === 'recent' ? 'recent jobs' : commandName;
  const redirectHint = await bot.sendMessage(
    msg.chat.id,
    `👋 Hello ${name}, you need to chat directly with the bot to view ${label}.\n\n👇 Tap below to open bot chat:`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: `💬 Open in Bot Chat`, url: `https://t.me/facescan_roeurn_bot?start=${commandName}` }
        ]]
      }
    }
  ).catch(() => null);

  // 4. Auto-remove BOTH the user's comment AND the bot's response after 5 seconds
  setTimeout(() => {
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    if (redirectHint && redirectHint.message_id) {
      bot.deleteMessage(msg.chat.id, redirectHint.message_id).catch(() => {});
    }
  }, 5000);
}

bot.onText(/^\/start(?:\s+(.+))?/i, async (msg, match) => {
  if (!isPrivate(msg)) {
    return deliverToUserOrRedirect(msg, 'start', id => {
      const adminHelp = isAdmin(msg)
        ? `\n\n⚙️ Admin Commands:\n` +
          `• /admin - open BotFather control panel\n` +
          `• /maxage - edit max post age filter\n` +
          `• /sinkmode - choose sink mode (group/bot/both)\n` +
          `• /setsink - set group sink ID or mode\n` +
          `• /sink - view destination sink & mode\n` +
          `• /keywords - manage filter keywords\n` +
          `• /addkeyword - add filter keyword(s)\n` +
          `• /removekeyword - remove filter keyword(s)\n` +
          `• /channels - manage scraped channels`
        : '';

      return safeSend(id,
        `🤖 IT Job Collection Bot\n\n` +
        `I collect IT job opportunities from Telegram channels/groups and forward them to a central destination.\n\n` +
        `📋 Commands:\n` +
        `• /status - overview\n` +
        `• /recent - last 15 collected jobs\n` +
        `• /channels - see all ${channels.length} scraped channels` +
        adminHelp
      );
    });
  }

  const param = match && match[1] ? match[1].trim().toLowerCase() : '';
  if (param === 'recent') {
    return await sendRecent(msg.chat.id, 10);
  }
  if (param === 'status') {
    return await sendStatus(msg.chat.id, isAdmin(msg));
  }
  if (param === 'channels') {
    return await sendChannels(msg.chat.id);
  }

  const chatId = msg.chat.id;
  if (isAdmin(msg)) {
    return safeSend(chatId,
      `👋 Welcome Admin!\n\n` +
      `🤖 IT Job Collection Bot is running.\n\n` +
      `You can customize and manage all bot features easily with clickable buttons just like in BotFather.\n\n` +
      `💡 Key Commands:\n` +
      `• /admin - open BotFather Control Panel\n` +
      `• /maxage - edit max post age filter (1-365 days)\n` +
      `• /forwardjobs - forward jobs to group (custom number)\n` +
      `• /sinkmode - choose sink mode (groups/bot/both)\n` +
      `• /addsink - add group destination sink\n` +
      `• /removesink - remove group destination sink\n` +
      `• /addkeyword - add filter keyword(s)\n` +
      `• /keywords - view current keywords\n` +
      `• /status - bot statistics & health\n` +
      `• /recent - view last collected jobs\n` +
      `• /channels - manage scraped channels\n` +
      `• /cancel - cancel active wizard input`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛠️ Open Admin Control Panel', callback_data: 'admin_main' }],
            [
              { text: '🔍 Manage Keywords', callback_data: 'admin_menu_keywords' },
              { text: '📢 Scraped Channels', callback_data: 'admin_menu_channels' }
            ],
            [
              { text: '🎯 Destination Sink', callback_data: 'admin_menu_sink' },
              { text: '📊 Bot Status', callback_data: 'admin_status' }
            ]
          ]
        }
      }
    );
  }

  // Regular user in private chat
  safeSend(chatId,
    `🤖 IT Job Collection Bot\n\n` +
    `I collect IT job opportunities from Telegram channels/groups and forward them to a central destination.\n\n` +
    `📋 Commands:\n` +
    `• /status - overview\n` +
    `• /recent - last 15 collected jobs\n` +
    `• /channels - see all ${channels.length} scraped channels`,
    {
      reply_markup: {
        keyboard: [
          [{ text: '/recent' }, { text: '/status' }],
          [{ text: '/channels' }]
        ],
        resize_keyboard: true
      }
    }
  );
});

bot.onText(/^\/admin(?:\s|$|@\w+)/i, (msg) => {
  if (!requireAdmin(msg)) return;
  safeSend(msg.chat.id,
    `🛠️ IT Job Collection Bot — Admin Control Panel\n\n` +
    `Welcome to the Admin Control Panel. You can customize all bot settings directly here just like in BotFather:\n\n` +
    `• 🔍 Keywords: Manage IT job title and skill filter keywords\n` +
    `• 📢 Channels: Manage public telegram channels to scrape\n` +
    `• 🎯 Destination Sinks: Manage group sinks and delivery mode\n` +
    `• 🚀 Forward Jobs: Pull recent jobs and forward to group(s)\n` +
    `• 📊 Bot Status: View live collection statistics & health\n` +
    `• ⚡ Run Live Scan: Manually trigger an immediate scan of all channels`,
    {
      reply_markup: getAdminControlPanelMarkup()
    }
  );
});

bot.onText(/^\/cancel(?:\s|$|@\w+)/i, (msg) => {
  if (!isAdmin(msg)) return;
  const adminId = String(msg.from ? msg.from.id : msg.chat.id);
  delete adminState[adminId];
  safeSend(msg.chat.id, '❌ Action cancelled. Returned to normal mode.', {
    reply_markup: getAdminControlPanelMarkup()
  });
});

bot.onText(/^\/(?:forwardjobs|postjobs|pushjobs)(?:\s+(\d+))?/i, async (msg, m) => {
  if (!requireAdmin(msg)) return;
  if (!m || !m[1]) {
    const adminId = String(msg.from ? msg.from.id : msg.chat.id);
    adminState[adminId] = { action: 'forward_custom_count' };
    return safeSend(msg.chat.id, formatForwardPromptText(), {
      reply_markup: getForwardCountMarkup()
    });
  }
  const count = parseInt(m[1], 10) || 1;
  await forwardRecentJobsToGroups(msg.chat.id, count);
});

bot.onText(/^\/sinkmode(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const arg = m && m[1] ? m[1].trim().toLowerCase() : '';
  if (arg === 'group') {
    sinkMode = 'group';
    saveSink();
    return safeSend(msg.chat.id, formatSinkModeUpdatedResponse('group'), {
      reply_markup: getSinkMenuMarkup()
    });
  }
  if (arg === 'admin' || arg === 'bot' || arg === 'dm') {
    sinkMode = 'admin';
    saveSink();
    return safeSend(msg.chat.id, formatSinkModeUpdatedResponse('admin'), {
      reply_markup: getSinkMenuMarkup()
    });
  }
  if (arg === 'both' || arg === 'all') {
    sinkMode = 'both';
    saveSink();
    return safeSend(msg.chat.id, formatSinkModeUpdatedResponse('both'), {
      reply_markup: getSinkMenuMarkup()
    });
  }

  safeSend(msg.chat.id, formatSinkMenuText(), {
    reply_markup: getSinkMenuMarkup()
  });
});

bot.onText(/^\/addsink(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  let targetId = raw;
  if (!targetId || targetId.toLowerCase() === 'here') {
    if (!isPrivate(msg)) {
      targetId = String(msg.chat.id);
    }
  }
  if (!targetId) {
    return safeSend(msg.chat.id,
      `💡 How to add destination sinks:\n` +
      `• Add by chat ID: /addsink -1004469567529\n` +
      `• Or send /addsink directly inside any Telegram group\n\n` +
      `Or use the button below:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Group Sink', callback_data: 'sink_add' }],
            [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }]
          ]
        }
      }
    );
  }

  const totalBefore = groupSinks.length;
  if (!groupSinks.includes(targetId)) {
    groupSinks.push(targetId);
    saveSink();
    return safeSend(msg.chat.id, formatSinkAddedResponse(targetId, totalBefore, groupSinks.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🧪 Test All Sinks', callback_data: 'sink_test' }],
          [{ text: '➕ Add Another Group Sink', callback_data: 'sink_add' }],
          [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  } else {
    return safeSend(msg.chat.id,
      `ℹ️ Destination Sink Already Exists!\n\n` +
      `Group sink ${targetId} is already in your active sinks list.\n\n` +
      `👥 Total Group Sinks: ${groupSinks.length}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      }
    );
  }
});

bot.onText(/^\/removesink(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) {
    if (!groupSinks.length) {
      return safeSend(msg.chat.id, '⚠️ No group sinks currently configured to remove.');
    }
    return safeSend(msg.chat.id,
      `🗑️ Remove Destination Sink\n\n` +
      `Tap a sink below to remove it with 1 click, or send /removesink <chat_id>:\n\n` +
      `👥 Current Group Sinks (${groupSinks.length}):\n` +
      groupSinks.map((s, idx) => `  ${idx + 1}. ${s}`).join('\n'),
      {
        reply_markup: getRemoveSinkMarkup()
      }
    );
  }

  const targetId = raw;
  const totalBefore = groupSinks.length;
  if (groupSinks.includes(targetId)) {
    groupSinks = groupSinks.filter(s => s !== targetId);
    saveSink();
    return safeSend(msg.chat.id, formatSinkRemovedResponse(targetId, totalBefore, groupSinks.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ Remove Another Sink', callback_data: 'sink_remove' }],
          [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  } else {
    return safeSend(msg.chat.id,
      `⚠️ Group Sink ID ${targetId} was not found in your active sinks list.\n\n` +
      `👥 Total Group Sinks: ${groupSinks.length}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      }
    );
  }
});

bot.onText(/^\/setsink(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const arg = m && m[1] ? m[1].trim() : '';
  if (!arg) {
    return safeSend(msg.chat.id, formatSinkMenuText(), {
      reply_markup: getSinkMenuMarkup()
    });
  }

  const lower = arg.toLowerCase();
  if (lower === 'group' || lower === 'groups') {
    sinkMode = 'group';
    saveSink();
    return safeSend(msg.chat.id, formatSinkModeUpdatedResponse('group'), {
      reply_markup: getSinkMenuMarkup()
    });
  }
  if (lower === 'admin' || lower === 'bot' || lower === 'dm') {
    sinkMode = 'admin';
    saveSink();
    return safeSend(msg.chat.id, formatSinkModeUpdatedResponse('admin'), {
      reply_markup: getSinkMenuMarkup()
    });
  }
  if (lower === 'both' || lower === 'all') {
    sinkMode = 'both';
    saveSink();
    return safeSend(msg.chat.id, formatSinkModeUpdatedResponse('both'), {
      reply_markup: getSinkMenuMarkup()
    });
  }

  const targetId = lower === 'here' ? String(msg.chat.id) : arg;
  if (!groupSinks.includes(targetId)) {
    groupSinks.push(targetId);
  }
  sinkMode = 'group';
  saveSink();
  safeSend(msg.chat.id, formatSinkUpdatedResponse(targetId), {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🧪 Test All Sinks', callback_data: 'sink_test' }],
        [{ text: '🎯 Sink Settings', callback_data: 'admin_menu_sink' }],
        [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
      ]
    }
  });
});

bot.onText(/^\/addsource\s+(.+)/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const id = m[1].trim();
  if (!sources.includes(id)) { sources.push(id); saveSources(); }
  safeSend(msg.chat.id, `Source added: ${id}`);
});

bot.onText(/^\/removesource\s+(.+)/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const id = m[1].trim();
  sources = sources.filter(s => s !== id); saveSources();
  safeSend(msg.chat.id, `Source removed: ${id}`);
});

bot.onText(/^\/sources(?:\s|$|@\w+)/i, (msg) => {
  if (!requireAdmin(msg)) return;
  safeSend(msg.chat.id, sources.length ? 'Sources:\n' + sources.join('\n') : 'No sources configured.');
});

bot.onText(/^\/sink(?:\s|$|@\w+)/i, (msg) => {
  if (!requireAdmin(msg)) return;
  safeSend(msg.chat.id, formatSinkMenuText(), {
    reply_markup: getSinkMenuMarkup()
  });
});

bot.onText(/^\/keywords(?:\s|$|@\w+)/i, (msg) => {
  if (!requireAdmin(msg)) return;
  safeSend(msg.chat.id,
    `🔍 Active Filter Keywords (${keywords.length}):\n\n` +
    keywords.join(', ') +
    `\n\n💡 Select an action below:`,
    {
      reply_markup: getKeywordsMenuMarkup()
    }
  );
});

bot.onText(/^\/addkeyword(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) {
    return safeSend(msg.chat.id,
      `💡 How to add keywords:\n` +
      `• Add single keyword: /addkeyword Flutter\n` +
      `• Add multiple keywords: /addkeyword Flutter, Golang, Ruby\n\n` +
      `Or choose an option below:`,
      {
        reply_markup: getKeywordsMenuMarkup()
      }
    );
  }

  const items = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const totalBefore = keywords.length;
  const added = [];
  const existing = [];

  for (const item of items) {
    if (!keywords.includes(item)) {
      keywords.push(item);
      added.push(item);
    } else {
      existing.push(item);
    }
  }

  if (added.length) {
    saveKeywords();
  }

  const responseText = items.length === 1 && added.length === 1
    ? formatKeywordAddedResponse(added[0], totalBefore, keywords.length)
    : items.length === 1 && existing.length === 1
      ? formatKeywordExistsResponse(existing[0], keywords.length)
      : formatMultipleKeywordsAddedResponse(added, existing, totalBefore, keywords.length);

  safeSend(msg.chat.id, responseText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Add More Keywords', callback_data: 'kw_multiple' }],
        [{ text: '📋 View All Keywords', callback_data: 'kw_list' }],
        [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
      ]
    }
  });
});

bot.onText(/^\/removekeyword(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) {
    return safeSend(msg.chat.id,
      `💡 How to remove keywords:\n` +
      `• Remove single keyword: /removekeyword Flutter\n` +
      `• Remove multiple keywords: /removekeyword Flutter, Golang\n\n` +
      `Or choose an option below:`,
      {
        reply_markup: getKeywordsMenuMarkup()
      }
    );
  }

  const items = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const totalBefore = keywords.length;
  const removed = [];
  const notFound = [];

  for (const item of items) {
    if (keywords.includes(item)) {
      keywords = keywords.filter(k => k !== item);
      removed.push(item);
    } else {
      notFound.push(item);
    }
  }

  if (removed.length) {
    saveKeywords();
  }

  safeSend(msg.chat.id, formatKeywordsRemovedResponse(removed, notFound, totalBefore, keywords.length), {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗑️ Remove More Keywords', callback_data: 'kw_remove' }],
        [{ text: '📋 View All Keywords', callback_data: 'kw_list' }],
        [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
      ]
    }
  });
});

bot.onText(/^\/status(?:\s|$|@\w+)/i, async (msg) => {
  if (!isPrivate(msg)) {
    return deliverToUserOrRedirect(msg, 'status', id => sendStatus(id, isAdmin(msg)));
  }
  await sendStatus(msg.chat.id, isAdmin(msg));
});

bot.onText(/^\/recent(?:\s+(\d+))?(?:\s|$|@\w+)/i, async (msg, match) => {
  const count = match && match[1] ? Math.min(parseInt(match[1], 10), 20) : 10;
  if (!isPrivate(msg)) {
    return deliverToUserOrRedirect(msg, 'recent', id => sendRecent(id, count));
  }
  await sendRecent(msg.chat.id, count);
});

bot.on('my_chat_member', (upd) => {
  const chat = upd.chat;
  const newStatus = upd.new_chat_member && upd.new_chat_member.status;
  if (newStatus === 'administrator' || newStatus === 'member') {
    const id = String(chat.id);
    if (groupSinks.includes(id) || id === String(groupSink)) {
      console.log('Bot added to destination sink group:', id, sourceLabel(chat));
      return;
    }
    if (!sources.includes(id)) {
      sources.push(id); saveSources();
      console.log('Auto-added source:', id, sourceLabel(chat));
      for (const a of ADMIN_IDS) safeSend(a, `Bot added to "${sourceLabel(chat)}" (${id}). Added as source.`);
    }
  }
  if (newStatus === 'left' || newStatus === 'kicked') {
    const id = String(chat.id);
    sources = sources.filter(s => s !== id); saveSources();
  }
});

function buildSourceLink(chat, messageId) {
  const username = chat.username;
  if (username) return `https://t.me/${username}/${messageId}`;
  const id = String(chat.id);
  if (id.startsWith('-100')) {
    const numId = id.replace(/^-100/, '');
    return `https://t.me/c/${numId}/${messageId}`;
  }
  return null;
}

function handleIncoming(msg) {
  const chatId = String(msg.chat.id);
  if (!isSource(chatId)) return;
  const targetSinks = getTargetSinks();
  if (targetSinks.includes(chatId)) return;
  const text = msg.text || msg.caption || '';
  if (!isJobPost(text)) return;
  const key = `${chatId}_${msg.message_id}`;
  if (seen.has(key)) return;
  seen.add(key); saveSeen();

  const label = sourceLabel(msg.chat);
  const link = buildSourceLink(msg.chat, msg.message_id);
  const posted = msg.date ? new Date(msg.date * 1000) : new Date();
  const dateInfo = formatPhnomPenhDate(posted);
  const badge = dateInfo.isToday ? '🔥 [NEW JOB POST TODAY]' : '📅 [RECENT JOB POST]';
  const footer = `\n\n(Source: ${label})${link ? '\n' + link : ''}\nPosted: ${dateInfo.display}`;

  const hasMedia = !!(msg.photo || msg.video || msg.document || msg.audio || msg.voice || msg.animation || msg.sticker);
  const photo = msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;

  // Always save to collected jobs database
  collected.push({
    source: label,
    sourceId: chatId,
    messageId: msg.message_id,
    snippet: (text || '').replace(/\s+/g, ' ').slice(0, 400),
    text: text,
    date: new Date().toISOString(),
    link,
    media: photo ? { type: 'photo', fileId: photo.file_id } : null
  });
  saveCollected();

  if (!targetSinks.length) {
    console.log('Job post matched but no active sink target.', chatId, msg.message_id);
    return;
  }

  for (const targetId of targetSinks) {
    if (hasMedia) {
      bot.copyMessage(targetId, chatId, msg.message_id)
        .then(() => {
          if (link) safeSend(targetId, `Source: ${label}\n${link}`);
          console.log(`Forwarded job post to ${targetId}:`, chatId, msg.message_id);
        })
        .catch((err) => {
          console.error(`copyMessage failed for ${targetId}:`, err.message);
          safeSend(targetId, `${text}${footer}`);
        });
    } else {
      safeSend(targetId, `${text}${footer}`)
        .then(() => console.log(`Forwarded job post to ${targetId}:`, chatId, msg.message_id))
        .catch(e => console.error(`send failed for ${targetId}:`, e.message));
    }
  }
}

bot.on('message', handleIncoming);
bot.on('channel_post', handleIncoming);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/status', (req, res) => res.json({
  sources,
  sink: groupSink,
  sinks: groupSinks,
  sinkMode,
  groupSinks,
  groupSink,
  adminSink,
  maxAgeDays,
  keywords,
  channels: channels.length,
  channelsList: channels,
  collectedCount: collected.length,
  seenCount: seen.size
}));
app.get('/api/collected', (req, res) => {
  const limit = parseInt(req.query.limit || '200', 10);
  res.json(collected.slice().reverse().slice(0, limit));
});
app.get('/api/sources', (req, res) => res.json(sources));
app.get('/api/channels', (req, res) => res.json(channels));
app.post('/api/refresh', async (req, res) => {
  pollChannels().catch(console.error);
  res.json({ ok: true, message: 'Scan initiated' });
});

// Proxy Telegram file so frontend can display images without exposing bot token
app.get('/api/photo/:fileId', async (req, res) => {
  try {
    const file = await bot.getFile(req.params.fileId);
    res.redirect(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`);
  } catch (e) {
    res.status(404).json({ error: 'file not found' });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Dashboard running on http://localhost:${PORT}`));

// ===== Public channel scraping by @username =====

bot.onText(/^\/addchannel(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) {
    return safeSend(msg.chat.id,
      `💡 How to add channels:\n` +
      `• Example: /addchannel cambodiaitjobs\n` +
      `• Example: /addchannel @khmerdevelopers\n\n` +
      `Or choose an option below:`,
      { reply_markup: getChannelsMenuMarkup() }
    );
  }
  const u = raw.replace(/^@/, '').trim();
  const totalBefore = channels.length;
  if (!channels.includes(u)) {
    channels.push(u);
    saveChannels();
    safeSend(msg.chat.id, formatChannelAddedResponse(u, totalBefore, channels.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ Scrape This Channel Now', callback_data: `scrape_one_${u}` }],
          [{ text: '➕ Add Another Channel', callback_data: 'ch_add' }],
          [{ text: '📋 View All Channels', callback_data: 'ch_list' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  } else {
    safeSend(msg.chat.id, formatChannelExistsResponse(u, channels.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ Scrape This Channel Now', callback_data: `scrape_one_${u}` }],
          [{ text: '📢 Channels Menu', callback_data: 'admin_menu_channels' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  }
});

bot.onText(/^\/removechannel(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) {
    return safeSend(msg.chat.id,
      `💡 How to remove channels:\n` +
      `• Example: /removechannel cambodiaitjobs\n\n` +
      `Or choose an option below:`,
      { reply_markup: getChannelsMenuMarkup() }
    );
  }
  const u = raw.replace(/^@/, '').trim();
  const totalBefore = channels.length;
  if (channels.includes(u)) {
    channels = channels.filter(c => c !== u);
    saveChannels();
    safeSend(msg.chat.id, formatChannelRemovedResponse(u, totalBefore, channels.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ Remove Another Channel', callback_data: 'ch_remove' }],
          [{ text: '📋 View All Channels', callback_data: 'ch_list' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  } else {
    safeSend(msg.chat.id,
      `⚠️ Channel @${u} was not found in the scraped list.\n\n` +
      `📢 Total Monitored Channels: ${channels.length}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Channels Menu', callback_data: 'admin_menu_channels' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      }
    );
  }
});

bot.onText(/^\/channels?(?:\s|$|@\w+)/i, async (msg) => {
  if (!isPrivate(msg)) {
    return deliverToUserOrRedirect(msg, 'channels', id => sendChannels(id));
  }
  if (isAdmin(msg)) {
    const list = channels.map((c, i) => `${i + 1}. @${c}`).join('\n');
    return await safeSend(msg.chat.id,
      `📢 Scraped Channels (${channels.length}):\n\n${list}\n\n💡 Admin Options:`,
      { reply_markup: getChannelsMenuMarkup() }
    );
  }
  await sendChannels(msg.chat.id);
});

bot.onText(/^\/(?:maxage|setmaxage)(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) {
    const adminId = String(msg.from ? msg.from.id : msg.chat.id);
    adminState[adminId] = { action: 'set_custom_maxage' };
    return safeSend(msg.chat.id, formatMaxAgeMenuText(), {
      reply_markup: getMaxAgeMenuMarkup()
    });
  }
  const val = parseInt(raw, 10);
  if (isNaN(val) || val < 1 || val > 365) {
    return safeSend(msg.chat.id, '⚠️ Invalid number of days. Please provide a number between 1 and 365 (e.g. /maxage 7 or /maxage 30).', {
      reply_markup: getMaxAgeMenuMarkup()
    });
  }
  maxAgeDays = val;
  saveSink();
  return safeSend(msg.chat.id, formatMaxAgeUpdatedResponse(val), {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Bot Status', callback_data: 'admin_status' }],
        [{ text: '📅 Edit Max Age', callback_data: 'admin_menu_maxage' }],
        [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
      ]
    }
  });
});

async function scrapeChannel(username) {
  try {
    const url = `https://t.me/s/${username}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!res.ok) return;
    const html = await res.text();

    const postDivs = html.split('<div class="tgme_widget_message_wrap');
    if (postDivs.length <= 1) return;

    const now = Date.now();
    const todayStr = getPhnomPenhDateStr(new Date());
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    const candidatePosts = [];

    for (let i = 1; i < postDivs.length; i++) {
      const chunk = postDivs[i];
      const postMatch = chunk.match(/data-post="([^"]+)"/);
      if (!postMatch) continue;
      const postId = postMatch[1];
      const num = parseInt(postId.split('/').pop(), 10);
      if (isNaN(num)) continue;

      const link = `https://t.me/${username}/${num}`;
      const key = `ch_${username}_${num}`;

      // Prevent duplicate forwarding: check unique post key and URL
      if (seen.has(key) || seen.has(link) || collected.some(c => c.link === link)) {
        continue;
      }

      // Extract internal post publication datetime directly from <time> tag
      const timeMatch = chunk.match(/<time\b[^>]*datetime="([^"]+)"[^>]*>/i);
      const dateStr = timeMatch ? timeMatch[1] : null;
      const date = dateStr ? new Date(dateStr) : null;

      // Validate publication date
      if (!date || isNaN(date.getTime())) continue;

      // Check age limit (skip older than MAX_AGE_DAYS)
      const ageMs = now - date.getTime();
      if (ageMs > maxAgeMs) continue;

      // Extract message text / caption for this exact post
      const textMatch = chunk.match(/class="tgme_widget_message_text[^"]*"[\s\S]*?>([\s\S]*?)<\/div>/);
      let text = '';
      if (textMatch) {
        text = decodeHtmlEntities(textMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim());
      }
      if (!text) continue;

      // Filter IT Job posts
      if (!isJobPost(text)) continue;

      const postDateStr = getPhnomPenhDateStr(date);
      const isToday = postDateStr === todayStr;

      candidatePosts.push({
        num,
        key,
        link,
        date,
        isToday,
        text
      });
    }

    if (!candidatePosts.length) return;

    // Prioritize newest jobs:
    // 1. Jobs published on the current date (Asia/Phnom_Penh) are forwarded first
    // 2. Newer publication timestamps forward before older ones
    candidatePosts.sort((a, b) => {
      const aToday = a.isToday ? 1 : 0;
      const bToday = b.isToday ? 1 : 0;
      if (aToday !== bToday) return bToday - aToday;
      return b.date.getTime() - a.date.getTime();
    });

    for (const p of candidatePosts) {
      if (seen.has(p.key) || seen.has(p.link)) continue;
      seen.add(p.key);
      seen.add(p.link);
      saveSeen();

      const dateInfo = formatPhnomPenhDate(p.date);
      const badge = dateInfo.isToday ? '🔥 [NEW JOB POST TODAY]' : '📅 [RECENT JOB POST]';
      const msgText = `${badge}\n\n${p.text}\n\n(Source: @${username})\nPosted: ${dateInfo.display}\n${p.link}`;

      // Save to collected jobs database (so it is ALWAYS available on http://localhost:3000/ and /recent)
      collected.push({
        source: '@' + username,
        sourceId: username,
        messageId: p.num,
        snippet: p.text.replace(/\s+/g, ' ').slice(0, 400),
        text: p.text,
        date: p.date.toISOString(),
        link: p.link,
        isToday: p.isToday
      });
      saveCollected();

      const targetSinks = getTargetSinks();
      if (!targetSinks.length) {
        console.log('Job post matched and saved to database (no active sink target).', username, p.num);
        continue;
      }

      for (const targetId of targetSinks) {
        try {
          await safeSend(targetId, msgText);
          console.log(`Forwarded IT job: @${username} #${p.num} [${dateInfo.display}] to ${targetId}`);
        } catch (e) {
          console.error(`send to sink ${targetId} failed:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('scrape error', username, e.message);
  }
}

async function pollChannels() {
  const BATCH_SIZE = 6;
  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(u => scrapeChannel(u)));
  }
}

setTimeout(pollChannels, 2000);
setInterval(pollChannels, 30000);

console.log('Channel scraper enabled for', channels.length, 'channels (parallel batches of 6).');
