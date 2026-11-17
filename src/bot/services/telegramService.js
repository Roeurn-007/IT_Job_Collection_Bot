const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const settings = require('../../config/settings');
const logger = require('../../utils/logger');

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 30,
  maxFreeSockets: 10
});

if (!settings.TELEGRAM_BOT_TOKEN) {
  logger.error('TELEGRAM_BOT_TOKEN is not set in .env! Aborting.');
  process.exit(1);
}

const bot = new TelegramBot(settings.TELEGRAM_BOT_TOKEN, {
  polling: true,
  request: { agent: httpsAgent }
});

let cachedBotUsername = (settings && settings.BOT_USERNAME) || 'facescan_roeurn_bot';

async function getBotUsername() {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await bot.getMe();
    if (me && me.username) {
      cachedBotUsername = me.username;
      return cachedBotUsername;
    }
  } catch (err) {
    // Non-fatal, return fallback
  }
  return cachedBotUsername || 'facescan_roeurn_bot';
}

// Pre-fetch bot identity on startup
bot.getMe().then((me) => {
  if (me && me.username) {
    cachedBotUsername = me.username;
    logger.info(`Bot identity verified: @${me.username} (ID: ${me.id})`);
  }
}).catch((err) => {
  logger.warn('Failed to pre-fetch bot identity:', err.message);
});

function isPrivate(msg) {
  return msg && msg.chat && msg.chat.type === 'private';
}

function isAdmin(userOrMsg) {
  if (!userOrMsg) return false;
  if (typeof userOrMsg === 'object') {
    const fromId = userOrMsg.from ? String(userOrMsg.from.id) : null;
    const chatId = userOrMsg.chat ? String(userOrMsg.chat.id) : null;
    if (fromId && settings.ADMIN_IDS.includes(fromId)) return true;
    if (chatId && settings.ADMIN_IDS.includes(chatId)) return true;
    // Recognize anonymous admin posts in managed sink group(s)
    if (userOrMsg.sender_chat && (settings.groupSinks.includes(String(userOrMsg.sender_chat.id)) || (chatId && String(userOrMsg.sender_chat.id) === chatId))) {
      return true;
    }
    return false;
  }
  return settings.ADMIN_IDS.includes(String(userOrMsg));
}

function requireAdmin(msg) {
  if (!isAdmin(msg)) {
    if (!isPrivate(msg)) {
      notifyNonAdminAndRedirect(msg);
    } else {
      safeSend(msg.chat.id, '⛔ Access denied: This command is restricted to administrators only.');
    }
    return false;
  }
  return true;
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

async function safeSend(chatId, text, opts = {}) {
  if (!text) return null;

  const sendOne = async (targetId, content) => {
    try {
      return await bot.sendMessage(targetId, content, opts);
    } catch (e) {
      if (e.response && e.response.body && e.response.body.parameters && e.response.body.parameters.migrate_to_chat_id) {
        const newId = String(e.response.body.parameters.migrate_to_chat_id);
        logger.info(`Chat ${targetId} upgraded to supergroup ${newId}. Updating sinks.`);
        const idx = settings.groupSinks.indexOf(String(targetId));
        if (idx !== -1) {
          settings.groupSinks[idx] = newId;
          settings.saveSink();
        }
        try {
          return await bot.sendMessage(newId, content, opts);
        } catch (err2) {
          logger.error('Retry send error to newId', newId, err2.message);
        }
      } else {
        logger.error(`Send error to ${targetId}:`, e.message);
      }
      return null;
    }
  };

  return await sendOne(chatId, text);
}

async function deleteMessage(chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
    return true;
  } catch (err) {
    return false;
  }
}

async function deliverToUserOrRedirect(msg, commandName, executeFn) {
  if (!msg || !msg.chat) return;

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
  const botUser = await getBotUsername();

  const keyboard = [];
  if (botUser) {
    keyboard.push([{ text: `💬 Open in Bot Chat`, url: `https://t.me/${botUser}?start=${commandName}` }]);
  }

  let redirectHint = null;
  try {
    redirectHint = await bot.sendMessage(
      msg.chat.id,
      `👋 Hello ${name}, you need to chat directly with the bot to view ${label}.\n\n👇 Tap below to open bot chat:`,
      keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}
    );
    if (redirectHint && redirectHint.message_id) {
      logger.info(`Command redirect notice sent to ${name} in ${msg.chat.id} (hint #${redirectHint.message_id}, auto-cleans in 12s)`);
    }
  } catch (err) {
    logger.error(`Failed to send command redirect in ${msg.chat.id}:`, err.message);
  }

  // 4. Auto-remove BOTH the user's comment AND the bot's response after 12 seconds
  setTimeout(() => {
    if (msg.message_id) {
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }
    if (redirectHint && redirectHint.message_id) {
      bot.deleteMessage(msg.chat.id, redirectHint.message_id).catch(() => {});
    }
  }, 12000);
}

// Active notice tracking: key = `${chatId}:${userId}` -> { messageId, timer }
const activeUserNotices = new Map();

async function notifyNonAdminAndRedirect(msg) {
  if (!msg || !msg.chat || !msg.chat.id) return;

  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const userId = msg.from ? msg.from.id : (msg.sender_chat ? msg.sender_chat.id : null);
  const senderName = msg.from
    ? `${msg.from.first_name || ''} ${msg.from.last_name || ''} (@${msg.from.username || msg.from.id})`.trim()
    : (msg.sender_chat ? (msg.sender_chat.title || 'Channel') : 'Unknown member');

  // 1. Immediately delete the non-admin message/media
  if (messageId) {
    bot.deleteMessage(chatId, messageId)
      .then(() => {
        logger.autoDelete(messageId, senderName, chatId);
      })
      .catch((err) => {
        logger.error(`Delete failed for #${messageId} in ${chatId}:`, err.message);
      });
  }

  // 2. Cooldown guard: If an active notice is already displayed for this user in this group, avoid spam
  const noticeKey = `${chatId}:${userId || 'anonymous'}`;
  if (activeUserNotices.has(noticeKey)) {
    return;
  }

  // 3. Format user display name
  let name = 'there';
  if (msg.from) {
    if (msg.from.username) {
      name = '@' + msg.from.username;
    } else if (msg.from.first_name && msg.from.first_name.toLowerCase() !== 'group') {
      name = msg.from.first_name;
    }
  } else if (msg.sender_chat && msg.sender_chat.title) {
    name = msg.sender_chat.title;
  }

  // 4. Retrieve bot username (from memory cache or API)
  const botUsername = await getBotUsername();

  const keyboard = [];
  if (botUsername) {
    keyboard.push([{ text: '💬 Chat Directly with Bot', url: `https://t.me/${botUsername}?start=help` }]);
  }

  // 5. Send polite warning notice to user
  const noticeText =
    `👋 Hello ${name}!\n\n` +
    `🚫 Non-admin messages are not allowed in this group.\n` +
    `📌 This group is exclusively reserved for IT job announcements.\n\n` +
    `💬 Please chat directly with the bot for job search, commands, or assistance:` +
    (botUsername ? `\n👉 @${botUsername}` : '');

  let noticeMsg = null;
  try {
    noticeMsg = await bot.sendMessage(
      chatId,
      noticeText,
      keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}
    );
    if (noticeMsg && noticeMsg.message_id) {
      logger.info(`Redirect notice sent to non-admin ${senderName} in ${chatId} (notice #${noticeMsg.message_id}, auto-cleans in 15s)`);
    }
  } catch (err) {
    logger.error(`Failed to send redirect notice to ${chatId}:`, err.message);
    return;
  }

  // 6. Keep notice visible for 15 seconds so user has time to read and click, then auto-delete
  if (noticeMsg && noticeMsg.message_id) {
    const timer = setTimeout(() => {
      bot.deleteMessage(chatId, noticeMsg.message_id).catch(() => {});
      activeUserNotices.delete(noticeKey);
    }, 15000);

    activeUserNotices.set(noticeKey, {
      messageId: noticeMsg.message_id,
      timer
    });
  }
}

module.exports = {
  bot,
  isPrivate,
  isAdmin,
  requireAdmin,
  isAllowedNonAdminCommand,
  safeSend,
  deleteMessage,
  deliverToUserOrRedirect,
  notifyNonAdminAndRedirect,
  getBotUsername
};

