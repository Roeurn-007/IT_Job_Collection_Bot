const settings = require('../../config/settings');
const { bot, safeSend } = require('./telegramService');
const { getCollectedJobs } = require('../../services/storageService');
const { formatPhnomPenhDate, getPhnomPenhDateStr } = require('../../utils/dateUtils');
const { decodeHtmlEntities } = require('../../services/jobFilter');
const logger = require('../../utils/logger');

function formatJobCard(job) {
  const text = decodeHtmlEntities(job.text || job.snippet || '').trim();
  const source = job.source ? (job.source.startsWith('@') ? job.source : `@${job.source}`) : '';
  const dateInfo = formatPhnomPenhDate(job.date);
  const badge = dateInfo.isToday ? '🔥 [NEW JOB POST TODAY]' : '📅 [RECENT JOB POST]';
  const footer = `\n\n(Source: ${source})${job.link ? '\n' + job.link : ''}\nPosted: ${dateInfo.display}`;
  return `${badge}\n\n${text}${footer}`;
}

async function forwardJob(job) {
  const targets = settings.getTargetSinks();
  if (!targets.length) return false;

  const content = formatJobCard(job);
  const dateInfo = formatPhnomPenhDate(job.date);

  for (const targetId of targets) {
    try {
      if (job.photo) {
        await bot.sendPhoto(targetId, job.photo.file_id, {
          caption: content.slice(0, 1024)
        });
      } else {
        await safeSend(targetId, content);
      }
      logger.info(`Forwarded IT job: ${job.source} #${job.messageId} [${dateInfo.display}] to ${targetId}`);
    } catch (err) {
      logger.error(`Failed to forward job to ${targetId}:`, err.message);
    }
  }

  return true;
}

async function forwardRecentJobsToGroups(adminChatId, count = 15) {
  const collected = getCollectedJobs();
  if (!collected.length) {
    return safeSend(adminChatId, '⚠️ No collected IT jobs available in database to forward.');
  }

  const groupTargets = settings.groupSinks;
  if (!groupTargets.length) {
    return safeSend(adminChatId, '⚠️ No group destination sinks configured. Please add a sink first via /addsink.');
  }

  const todayStr = getPhnomPenhDateStr(new Date());
  const sorted = collected.slice().sort((a, b) => {
    const aIsToday = getPhnomPenhDateStr(a.date) === todayStr ? 1 : 0;
    const bIsToday = getPhnomPenhDateStr(b.date) === todayStr ? 1 : 0;
    if (aIsToday !== bIsToday) return bIsToday - aIsToday;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const jobsToForward = sorted.slice(0, count);
  const actualCount = jobsToForward.length;

  await safeSend(adminChatId, `🚀 Starting push of ${actualCount} IT jobs to ${groupTargets.length} group sink(s)...`);

  let totalDelivered = 0;
  for (const targetId of groupTargets) {
    let sentCount = 0;
    for (const job of jobsToForward) {
      const content = formatJobCard(job);
      try {
        if (job.photo && job.photo.file_id) {
          await bot.sendPhoto(targetId, job.photo.file_id, {
            caption: content.slice(0, 1024)
          });
        } else {
          await safeSend(targetId, content);
        }
        sentCount++;
      } catch (err) {
        logger.error(`Forward recent job #${job.messageId} failed to ${targetId}:`, err.message);
      }
      // Small pause to prevent hitting Telegram rate limits
      await new Promise(r => setTimeout(r, 150));
    }
    if (sentCount > 0) totalDelivered++;
  }

  const now = formatPhnomPenhDate(new Date()).display;
  return safeSend(adminChatId,
    `✅ Successfully Forwarded ${actualCount} IT Jobs!\n\n` +
    `📦 Total Jobs Sent: ${actualCount}\n` +
    `👥 Delivered to Groups (${totalDelivered}/${groupTargets.length}):\n` +
    groupTargets.map((g, idx) => `  ${idx + 1}. ${g}`).join('\n') + `\n` +
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

async function testSinks(adminChatId) {
  const targetSinks = settings.getTargetSinks();
  if (!targetSinks.length) {
    return safeSend(adminChatId, '⚠️ No destination sinks configured yet.');
  }

  const now = formatPhnomPenhDate(new Date()).display;
  const results = [];

  for (const s of targetSinks) {
    const isBotChat = s === String(settings.adminSink);
    const label = isBotChat ? `🤖 Bot Chat (Admin DM: ${s})` : `👥 Group Sink (${s})`;
    try {
      const res = await bot.sendMessage(s,
        `🧪 Connection Test: IT Job Collection Bot\n\n` +
        `This is a test notification to verify that this destination is properly connected and receiving job alerts.\n\n` +
        `🕒 Time: ${now}\n` +
        `📌 Mode: ${settings.sinkMode.toUpperCase()}`
      );
      if (res && res.message_id) {
        results.push(`✅ ${label}: Connected successfully!`);
      } else {
        results.push(`❌ ${label}: Failed to receive message.`);
      }
    } catch (err) {
      results.push(`❌ ${label}: Error — ${err.message}`);
    }
  }

  return safeSend(adminChatId,
    `🧪 Sink Verification Test Report\n\n` +
    `🕒 Tested: ${now}\n` +
    `📌 Forwarding Mode: ${settings.sinkMode.toUpperCase()}\n` +
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

module.exports = {
  formatJobCard,
  forwardJob,
  forwardRecentJobsToGroups,
  testSinks
};
