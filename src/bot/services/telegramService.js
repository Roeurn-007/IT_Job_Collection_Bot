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
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
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
  const botInfo = await bot.getMe().catch(() => ({ username: 'facescan_roeurn_bot' }));
  const botUser = botInfo.username || 'facescan_roeurn_bot';

  const redirectHint = await bot.sendMessage(
    msg.chat.id,
    `👋 Hello ${name}, you need to chat directly with the bot to view ${label}.\n\n👇 Tap below to open bot chat:`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: `💬 Open in Bot Chat`, url: `https://t.me/${botUser}?start=${commandName}` }
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

module.exports = {
  bot,
  isPrivate,
  isAdmin,
  requireAdmin,
  isAllowedNonAdminCommand,
  safeSend,
  deleteMessage,
  deliverToUserOrRedirect
};
