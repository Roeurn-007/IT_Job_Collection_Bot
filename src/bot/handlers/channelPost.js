const settings = require('../../config/settings');
const { isJobPost, decodeHtmlEntities } = require('../../services/jobFilter');
const { isPostWithinMaxAge } = require('../../services/dateFilter');
const { isDuplicate, markSeen } = require('../../services/duplicateCheck');
const { addJob } = require('../../services/storageService');
const { forwardJob } = require('../services/forwardService');
const { getPhnomPenhDateStr, formatPhnomPenhDate } = require('../../utils/dateUtils');
const logger = require('../../utils/logger');

const lastPostId = {};
let isPolling = false;
let scraperTimer = null;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

function sanitizeUsername(username) {
  if (!username) return '';
  return String(username)
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .trim();
}

function isSource(chatId) {
  const id = String(chatId);
  if (settings.groupSinks.includes(id) || id === String(settings.getPrimaryGroupSink())) return false;
  return settings.getSources().includes(id);
}

function sourceLabel(chat) {
  if (chat.title) return chat.title;
  if (chat.username) return `@${chat.username}`;
  return `Chat ${chat.id}`;
}

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

// 1. Handle incoming channel posts from Telegram Bot updates
async function handleIncoming(msg) {
  const chatId = String(msg.chat.id);
  if (!isSource(chatId)) return;
  const targetSinks = settings.getTargetSinks();
  if (targetSinks.includes(chatId)) return;

  const text = msg.text || msg.caption || '';
  if (!isJobPost(text)) return;

  const key = `${chatId}_${msg.message_id}`;
  if (isDuplicate(key)) return;
  markSeen(key);

  const label = sourceLabel(msg.chat);
  const link = buildSourceLink(msg.chat, msg.message_id);
  const posted = msg.date ? new Date(msg.date * 1000) : new Date();
  const dateInfo = formatPhnomPenhDate(posted);

  const photo = msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;

  const job = {
    source: label,
    sourceId: chatId,
    messageId: msg.message_id,
    snippet: text.slice(0, 400),
    text: decodeHtmlEntities(text),
    date: posted.toISOString(),
    link,
    photo: photo ? { file_id: photo.file_id } : null,
    isToday: dateInfo.isToday
  };

  addJob(job);
  await forwardJob(job);
}

// Helper to fetch channel preview with timeout and 1 transient-error retry
async function fetchChannelPreview(cleanUsername) {
  const url = `https://t.me/s/${cleanUsername}`;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(12000)
      });
      return res;
    } catch (err) {
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1200));
        continue;
      }
      throw err;
    }
  }
}

// 2. Scrape a single public channel web preview
async function scrapeChannel(username) {
  const cleanUsername = sanitizeUsername(username);
  if (!cleanUsername) return;

  try {
    const res = await fetchChannelPreview(cleanUsername);
    if (!res.ok) {
      if (res.status === 429) {
        logger.warn(`Rate limit (HTTP 429) received for @${cleanUsername}. Cooling down.`);
      }
      return;
    }
    const html = await res.text();

    const postDivs = html.split('<div class="tgme_widget_message_wrap');
    if (postDivs.length <= 1) return;

    const candidatePosts = [];

    for (let i = 1; i < postDivs.length; i++) {
      const chunk = postDivs[i];
      const postMatch = chunk.match(/data-post="([^"]+)"/);
      if (!postMatch) continue;
      const postId = postMatch[1];
      const num = parseInt(postId.split('/').pop(), 10);

      // Extract publication date
      const timeMatch = chunk.match(/<time[^>]+datetime="([^"]+)"/);
      const date = timeMatch ? new Date(timeMatch[1]) : null;
      if (!date || isNaN(date.getTime())) continue;

      // Filter by max post age
      const ageCheck = isPostWithinMaxAge(date, settings.maxAgeDays);
      if (!ageCheck.isWithinMaxAge) continue;

      // Extract message text / caption for this exact post
      const textMatch = chunk.match(/class="tgme_widget_message_text[^"]*"[\s\S]*?>([\s\S]*?)<\/div>/);
      let text = '';
      if (textMatch) {
        text = textMatch[1]
          .replace(/<br\s*[\/]?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim();
      }

      // Extract photo if present
      const photoMatch = chunk.match(/background-image:url\('([^']+)'\)/);
      const photoUrl = photoMatch ? photoMatch[1] : null;

      if (!text && !photoUrl) continue;

      // Filter IT Job posts
      if (!isJobPost(text)) continue;

      candidatePosts.push({
        num,
        postId,
        text: decodeHtmlEntities(text),
        date,
        photoUrl,
        isToday: ageCheck.isToday,
        dateInfo: ageCheck.dateInfo
      });
    }

    const lastKnown = lastPostId[cleanUsername] || 0;
    for (const post of candidatePosts) {
      const key = `${cleanUsername}_${post.num}`;
      if (isDuplicate(key)) continue;
      markSeen(key);

      const jobRecord = {
        source: `@${cleanUsername}`,
        sourceId: cleanUsername,
        messageId: post.num,
        snippet: post.text.slice(0, 400),
        text: post.text,
        date: post.date.toISOString(),
        link: `https://t.me/${post.postId}`,
        isToday: post.isToday
      };

      addJob(jobRecord);

      // Forward jobs published today to destination sink(s)
      if (post.isToday) {
        await forwardJob(jobRecord);
      }
    }

    if (candidatePosts.length) {
      const maxNum = Math.max(...candidatePosts.map(p => p.num));
      if (maxNum > lastKnown) lastPostId[cleanUsername] = maxNum;
    }
  } catch (e) {
    const causeCode = e.cause?.code || e.cause?.message || '';
    const causeStr = causeCode ? ` (${causeCode})` : '';
    logger.error(`Channel scraper error for @${cleanUsername}: ${e.message}${causeStr}`);
  }
}

// 3. Automated parallel multi-channel polling with batch delays and overlap protection
async function pollChannels() {
  if (isPolling) {
    logger.warn('Previous scraping cycle is still in progress. Skipping to prevent overlap.');
    return { ok: false, message: 'Scrape already in progress' };
  }
  isPolling = true;

  try {
    const channels = settings.getChannels();
    const BATCH_SIZE = 4;
    const BATCH_DELAY_MS = 1500;

    for (let i = 0; i < channels.length; i += BATCH_SIZE) {
      const batch = channels.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(u => scrapeChannel(u)));
      if (i + BATCH_SIZE < channels.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }
    return { ok: true, count: channels.length };
  } finally {
    isPolling = false;
  }
}

// Chained recursive timer loop prevents overlapping intervals
async function runScraperLoop() {
  try {
    await pollChannels();
  } catch (err) {
    logger.error('Scraper loop error:', err.message);
  } finally {
    const intervalMs = settings.scrapeIntervalMs || 90000;
    scraperTimer = setTimeout(runScraperLoop, intervalMs);
  }
}

function startScraper() {
  const channels = settings.getChannels();
  const intervalSec = Math.round((settings.scrapeIntervalMs || 90000) / 1000);
  setTimeout(runScraperLoop, 2000);
  logger.info(`Channel scraper enabled for ${channels.length} channels (batches of 4 every ${intervalSec}s).`);
}

module.exports = {
  sanitizeUsername,
  isSource,
  sourceLabel,
  buildSourceLink,
  handleIncoming,
  scrapeChannel,
  pollChannels,
  startScraper
};
