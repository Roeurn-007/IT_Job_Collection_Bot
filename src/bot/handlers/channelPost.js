const settings = require('../../config/settings');
const { isJobPost, decodeHtmlEntities } = require('../../services/jobFilter');
const { isPostWithinMaxAge } = require('../../services/dateFilter');
const { isDuplicate, markSeen } = require('../../services/duplicateCheck');
const { addJob } = require('../../services/storageService');
const { forwardJob } = require('../services/forwardService');
const { getPhnomPenhDateStr, formatPhnomPenhDate } = require('../../utils/dateUtils');
const logger = require('../../utils/logger');

const lastPostId = {};

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

// 2. Scrape a single public channel web preview
async function scrapeChannel(username) {
  try {
    const url = `https://t.me/s/${username}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!res.ok) return;
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

    const lastKnown = lastPostId[username] || 0;
    for (const post of candidatePosts) {
      const key = `${username}_${post.num}`;
      if (isDuplicate(key)) continue;
      markSeen(key);

      const jobRecord = {
        source: `@${username}`,
        sourceId: username,
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
      if (maxNum > lastKnown) lastPostId[username] = maxNum;
    }
  } catch (e) {
    logger.error(`Channel scraper error for @${username}:`, e.message);
  }
}

// 3. Automated parallel multi-channel polling
async function pollChannels() {
  const channels = settings.getChannels();
  const BATCH_SIZE = 6;
  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(u => scrapeChannel(u)));
  }
}

function startScraper() {
  const channels = settings.getChannels();
  setTimeout(pollChannels, 2000);
  setInterval(pollChannels, 30000);
  logger.info(`Channel scraper enabled for ${channels.length} channels (parallel batches of 6 every 30s).`);
}

module.exports = {
  isSource,
  sourceLabel,
  buildSourceLink,
  handleIncoming,
  scrapeChannel,
  pollChannels,
  startScraper
};
