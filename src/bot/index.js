const settings = require('../config/settings');
const logger = require('../utils/logger');
const { formatPhnomPenhDate, getPhnomPenhDateStr } = require('../utils/dateUtils');
const { decodeHtmlEntities } = require('../services/jobFilter');
const { getCollectedJobs } = require('../services/storageService');
const { getSeenCount } = require('../services/duplicateCheck');
const {
  bot,
  isPrivate,
  isAdmin,
  requireAdmin,
  isAllowedNonAdminCommand,
  safeSend,
  deleteMessage,
  deliverToUserOrRedirect
} = require('./services/telegramService');
const {
  forwardJob,
  forwardRecentJobsToGroups,
  testSinks
} = require('./services/forwardService');
const {
  handleIncoming,
  scrapeChannel,
  pollChannels,
  startScraper,
  isSource,
  sourceLabel
} = require('./handlers/channelPost');

// In-memory admin interaction state machine
const adminState = {};

// -------------------------------------------------------------
// UI Markup Helpers & Menus
// -------------------------------------------------------------

function getAdminControlPanelMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '🔍 Manage Keywords', callback_data: 'admin_menu_keywords' },
        { text: '📢 Scraped Channels', callback_data: 'admin_menu_channels' }
      ],
      [
        { text: '🎯 Destination Sinks', callback_data: 'admin_menu_sink' },
        { text: `📅 Max Age: ${settings.maxAgeDays}d`, callback_data: 'admin_menu_maxage' }
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
        { text: '📋 View All Channels', callback_data: 'ch_list' },
        { text: '⚡ Scrape All Now', callback_data: 'ch_scrape_all' }
      ],
      [
        { text: '🔙 Back to Admin Menu', callback_data: 'admin_main' }
      ]
    ]
  };
}

function getSinkMenuMarkup() {
  const mode = settings.sinkMode;
  return {
    inline_keyboard: [
      [
        { text: `${mode === 'group' ? '✅ ' : ''}👥 Groups Only`, callback_data: 'sink_mode_group' },
        { text: `${mode === 'admin' ? '✅ ' : ''}🤖 Bot Chat Only`, callback_data: 'sink_mode_admin' }
      ],
      [
        { text: `${mode === 'both' ? '✅ ' : ''}🔄 Both (Group + Bot)`, callback_data: 'sink_mode_both' }
      ],
      [
        { text: '➕ Add Group Sink', callback_data: 'sink_add' },
        { text: '🗑️ Remove Group Sink', callback_data: 'sink_remove' }
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

function getMaxAgeMenuMarkup() {
  const current = settings.maxAgeDays;
  return {
    inline_keyboard: [
      [
        { text: `${current === 1 ? '✅ ' : ''}1 Day (Today only)`, callback_data: 'maxage_set_1' },
        { text: `${current === 3 ? '✅ ' : ''}3 Days`, callback_data: 'maxage_set_3' }
      ],
      [
        { text: `${current === 7 ? '✅ ' : ''}7 Days (1 Week)`, callback_data: 'maxage_set_7' },
        { text: `${current === 14 ? '✅ ' : ''}14 Days (2 Weeks)`, callback_data: 'maxage_set_14' }
      ],
      [
        { text: `${current === 30 ? '✅ ' : ''}30 Days (1 Month)`, callback_data: 'maxage_set_30' },
        { text: `${current === 60 ? '✅ ' : ''}60 Days (2 Months)`, callback_data: 'maxage_set_60' }
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

function getForwardCountMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '1 Job', callback_data: 'fwd_count_1' },
        { text: '2 Jobs', callback_data: 'fwd_count_2' },
        { text: '3 Jobs', callback_data: 'fwd_count_3' }
      ],
      [
        { text: '5 Jobs', callback_data: 'fwd_count_5' },
        { text: '10 Jobs', callback_data: 'fwd_count_10' },
        { text: '15 Jobs', callback_data: 'fwd_count_15' }
      ],
      [
        { text: '20 Jobs', callback_data: 'fwd_count_20' }
      ],
      [
        { text: '🔙 Back to Admin Panel', callback_data: 'admin_main' }
      ]
    ]
  };
}

function getCancelMarkup(backCallback = 'admin_main') {
  return {
    inline_keyboard: [
      [{ text: '❌ Cancel', callback_data: backCallback }]
    ]
  };
}

function getRemoveSinkMarkup() {
  const rows = settings.groupSinks.map(s => [{
    text: `🗑️ Remove ${s}`,
    callback_data: `sink_del_${s}`
  }]);
  rows.push([{ text: '🔙 Back to Sinks', callback_data: 'admin_menu_sink' }]);
  return { inline_keyboard: rows };
}

// -------------------------------------------------------------
// Response Text Formatters
// -------------------------------------------------------------

function formatKeywordAddedResponse(kw, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `✅ Keyword Added Successfully!\n\n` +
    `🔍 Added: "${kw}"\n` +
    `📊 Total Active Keywords: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Status: Filter active in 30-second live scraper\n\n` +
    `💡 Any future job post mentioning "${kw}" will automatically be recognized as an IT job.`
  );
}

function formatKeywordsMultipleAddedResponse(addedList, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `✅ Multiple Keywords Added Successfully!\n\n` +
    `➕ Added (${addedList.length}): ${addedList.join(', ')}\n` +
    `📊 Total Active Keywords: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Status: Filter active in 30-second live scraper`
  );
}

function formatKeywordRemovedResponse(kw, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `🗑️ Keyword Removed Successfully!\n\n` +
    `🔍 Removed: "${kw}"\n` +
    `📊 Total Active Keywords: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Status: Filter updated in 30-second live scraper`
  );
}

function formatChannelAddedResponse(u, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `✅ Channel Added Successfully!\n\n` +
    `📢 Monitored Channel: @${u}\n` +
    `📡 Total Scraped Channels: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Status: Included in 30-second automated scraper\n\n` +
    `💡 The bot will automatically scan @${u} every 30 seconds for IT jobs.`
  );
}

function formatChannelRemovedResponse(u, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `🗑️ Channel Removed Successfully!\n\n` +
    `📢 Removed: @${u}\n` +
    `📡 Total Scraped Channels: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Status: Removed from 30-second scraper loop`
  );
}

function formatSinkMenuText() {
  let modeName = `👥 Groups Only (${settings.groupSinks.length} group${settings.groupSinks.length === 1 ? '' : 's'})`;
  let desc = `All newly discovered IT jobs are forwarded to all ${settings.groupSinks.length} group sink(s).`;
  if (settings.sinkMode === 'admin') {
    modeName = '🤖 Only Bot Chat (Admin DM)';
    desc = `All newly discovered IT jobs are forwarded directly to your private chat with the bot (${settings.adminSink}).`;
  } else if (settings.sinkMode === 'both') {
    modeName = `🔄 Both (${settings.groupSinks.length} Group${settings.groupSinks.length === 1 ? '' : 's'} + Bot Chat)`;
    desc = `All newly discovered IT jobs are forwarded simultaneously to all ${settings.groupSinks.length} group(s) and your private bot chat (${settings.adminSink}).`;
  }

  const groupList = settings.groupSinks.map((id, idx) => `  ${idx + 1}. 👥 Group ID: ${id}`).join('\n');

  return (
    `🎯 Destination Sinks & Forwarding Mode\n\n` +
    `📌 Active Forwarding Mode: ${modeName}\n` +
    `🤖 Admin Chat ID: ${settings.adminSink || '(not set)'}\n\n` +
    `👥 Configured Group Destination Sinks (${settings.groupSinks.length}):\n` +
    (groupList || '  (No group sinks configured)') + `\n\n` +
    `ℹ️ ${desc}\n\n` +
    `💡 Select an option below to add/remove sinks, switch mode, or test:`
  );
}

function formatSinkModeUpdatedResponse(mode) {
  const time = formatPhnomPenhDate(new Date()).display;
  let modeTitle = `👥 Groups Only (${settings.groupSinks.length} group${settings.groupSinks.length === 1 ? '' : 's'})`;
  let desc = `All newly discovered IT jobs will be forwarded directly to all ${settings.groupSinks.length} group sink(s).`;
  if (mode === 'admin') {
    modeTitle = '🤖 Only Bot Chat (Admin DM)';
    desc = `All newly discovered IT jobs will be forwarded directly to your private bot chat (${settings.adminSink}).`;
  } else if (mode === 'both') {
    modeTitle = `🔄 Both (${settings.groupSinks.length} Group${settings.groupSinks.length === 1 ? '' : 's'} + Bot Chat)`;
    desc = `All newly discovered IT jobs will be forwarded simultaneously to all ${settings.groupSinks.length} group(s) and your private bot chat (${settings.adminSink})!`;
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

function formatSinkAddedResponse(newId, totalBefore, totalAfter) {
  const time = formatPhnomPenhDate(new Date()).display;
  return (
    `✅ Destination Sink Added Successfully!\n\n` +
    `🎯 Added Group Sink: ${newId}\n` +
    `👥 Total Group Sinks: ${totalAfter} (was ${totalBefore})\n` +
    `🕒 Time: ${time}\n` +
    `⚡ Forwarding Status: ACTIVE\n\n` +
    `💡 Newly published IT jobs matching your filter keywords will now also be delivered to this group!\n\n` +
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

function formatMaxAgeMenuText() {
  return (
    `📅 Maximum Post Age Filter\n\n` +
    `📌 Current Setting: ${settings.maxAgeDays} Days\n\n` +
    `The bot checks the publication date of each channel post during automated scraping:\n` +
    `• Any post published within the last ${settings.maxAgeDays} days is analyzed for IT keywords.\n` +
    `• Any post older than ${settings.maxAgeDays} days is automatically skipped to prevent sending old job listings.\n\n` +
    `💡 Select a quick timeframe below, or reply with a custom number of days (1 - 365):`
  );
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

function formatForwardPromptText() {
  const collected = getCollectedJobs();
  const todayStr = getPhnomPenhDateStr(new Date());
  const todayCount = collected.filter(c => getPhnomPenhDateStr(c.date) === todayStr).length;

  return (
    `🚀 Forward Jobs to Group Sinks\n\n` +
    `📦 Total Collected Jobs: ${collected.length}\n` +
    `🔥 Jobs Published Today: ${todayCount}\n` +
    `👥 Target Group Sinks (${settings.groupSinks.length}):\n` +
    settings.groupSinks.map((s, i) => `  ${i + 1}. ${s}`).join('\n') + `\n\n` +
    `💡 Select how many jobs you would like to pull and forward to your group(s), or reply directly with any custom number (1 - 50):`
  );
}

async function editOrSend(chatId, messageId, text, markup) {
  if (messageId) {
    try {
      return await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: markup
      });
    } catch (_) {}
  }
  return await safeSend(chatId, text, { reply_markup: markup });
}

async function sendStatus(targetChatId, isAdminUser = false) {
  const collected = getCollectedJobs();
  const channels = settings.getChannels();
  const keywords = settings.getKeywords();
  const todayStr = getPhnomPenhDateStr(new Date());
  const todayCount = collected.filter(c => getPhnomPenhDateStr(c.date) === todayStr).length;
  const nowInfo = formatPhnomPenhDate(new Date());

  const sinkLine = isAdminUser
    ? `🎯 Destination Sink: ${settings.getPrimaryGroupSink() || '(not set)'} [Mode: ${settings.sinkMode.toUpperCase()}]\n`
    : '';
  const sourcesLine = isAdminUser ? `📡 Active Sources: ${settings.getSources().length}\n` : '';
  const maxAgeLine = isAdminUser ? `📅 Max Post Age: ${settings.maxAgeDays} days\n` : '';

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
    `👁️ Processed Posts: ${getSeenCount()}\n` +
    `⚡ Auto-Monitor Interval: 30 seconds`,
    isAdminUser ? {
      reply_markup: {
        inline_keyboard: [
          [
            { text: `📅 Edit Max Age (${settings.maxAgeDays}d)`, callback_data: 'admin_menu_maxage' },
            { text: '🛠️ Admin Panel', callback_data: 'admin_main' }
          ]
        ]
      }
    } : {}
  );
}

async function sendRecent(targetChatId, count = 10) {
  const collected = getCollectedJobs();
  if (!collected.length) return await safeSend(targetChatId, 'No collected jobs yet.');

  const todayStr = getPhnomPenhDateStr(new Date());
  const sorted = collected.slice().sort((a, b) => {
    const aIsToday = getPhnomPenhDateStr(a.date) === todayStr ? 1 : 0;
    const bIsToday = getPhnomPenhDateStr(b.date) === todayStr ? 1 : 0;
    if (aIsToday !== bIsToday) return bIsToday - aIsToday;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const list = sorted.slice(0, count);

  for (const c of list) {
    const text = decodeHtmlEntities(c.text || c.snippet || '').trim();
    const source = c.source ? (c.source.startsWith('@') ? c.source : `@${c.source}`) : '';
    const dateInfo = formatPhnomPenhDate(c.date);
    const badge = dateInfo.isToday ? '🔥 [NEW JOB POST TODAY]' : '📅 [RECENT JOB POST]';
    const footer = `\n\n(Source: ${source})${c.link ? '\n' + c.link : ''}\nPosted: ${dateInfo.display}`;

    if (c.photo && c.photo.file_id) {
      await bot.sendPhoto(targetChatId, c.photo.file_id, {
        caption: (badge + '\n\n' + text + footer).slice(0, 1024)
      }).catch(err => {
        return safeSend(targetChatId, `${badge}\n\n${text}${footer}`);
      });
    } else {
      await safeSend(targetChatId, `${badge}\n\n${text}${footer}`);
    }
  }
}

async function sendChannels(targetChatId) {
  const channels = settings.getChannels();
  if (!channels.length) return await safeSend(targetChatId, 'No channels configured.');
  const list = channels.map((c, i) => `${i + 1}. @${c}`).join('\n');
  return await safeSend(targetChatId, `📢 Scraped Channels (${channels.length}):\n\n${list}`);
}

// -------------------------------------------------------------
// Interactive Admin Input State Machine
// -------------------------------------------------------------

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
    return safeSend(msg.chat.id, '🚫 Action cancelled. Returned to normal mode.', {
      reply_markup: getAdminControlPanelMarkup()
    });
  }
  if (text.startsWith('/')) {
    delete adminState[adminId];
    return;
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
    const keywords = settings.getKeywords();
    const totalBefore = keywords.length;
    if (!keywords.includes(lower)) {
      keywords.push(lower);
      settings.saveKeywords(keywords);
      return safeSend(msg.chat.id, formatKeywordAddedResponse(lower, totalBefore, keywords.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Another Single', callback_data: 'kw_single' }],
            [{ text: '🔍 View Keywords', callback_data: 'kw_list' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      });
    } else {
      return safeSend(msg.chat.id, `ℹ️ Keyword "${lower}" already exists in the active filter.`, {
        reply_markup: getKeywordsMenuMarkup()
      });
    }
  }

  // 2. Multiple keywords
  if (state.action === 'add_kw_multiple') {
    const items = text.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    delete adminState[adminId];
    if (!items.length) {
      return safeSend(msg.chat.id, '⚠️ Please provide at least one valid keyword separated by commas.', {
        reply_markup: getCancelMarkup('admin_menu_keywords')
      });
    }
    const keywords = settings.getKeywords();
    const totalBefore = keywords.length;
    const added = [];
    for (const item of items) {
      if (!keywords.includes(item)) {
        keywords.push(item);
        added.push(item);
      }
    }
    if (added.length) settings.saveKeywords(keywords);
    return safeSend(msg.chat.id, formatKeywordsMultipleAddedResponse(added, totalBefore, keywords.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕➕ Add More Multiple', callback_data: 'kw_multiple' }],
          [{ text: '🔍 View Keywords', callback_data: 'kw_list' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  }

  // 3. Remove keyword
  if (state.action === 'remove_kw') {
    const items = text.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    delete adminState[adminId];
    let keywords = settings.getKeywords();
    const totalBefore = keywords.length;
    const removed = [];
    for (const item of items) {
      if (keywords.includes(item)) {
        keywords = keywords.filter(k => k !== item);
        removed.push(item);
      }
    }
    if (removed.length) settings.saveKeywords(keywords);
    return safeSend(msg.chat.id, formatKeywordRemovedResponse(removed.join(', '), totalBefore, keywords.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ Remove Another', callback_data: 'kw_remove' }],
          [{ text: '🔍 View Keywords', callback_data: 'kw_list' }],
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
      return safeSend(msg.chat.id, '⚠️ Please provide a valid channel username (e.g. cambodiajobs).', {
        reply_markup: getCancelMarkup('admin_menu_channels')
      });
    }
    const channels = settings.getChannels();
    const totalBefore = channels.length;
    if (!channels.includes(u)) {
      channels.push(u);
      settings.saveChannels(channels);
      return safeSend(msg.chat.id, formatChannelAddedResponse(u, totalBefore, channels.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Another Channel', callback_data: 'ch_add' }],
            [{ text: `⚡ Scrape @${u} Now`, callback_data: `scrape_one_${u}` }],
            [{ text: '📢 Channels Menu', callback_data: 'admin_menu_channels' }]
          ]
        }
      });
    } else {
      return safeSend(msg.chat.id, `ℹ️ Channel @${u} is already in the scraping list.`, {
        reply_markup: getChannelsMenuMarkup()
      });
    }
  }

  // 5. Remove channel
  if (state.action === 'remove_channel') {
    const u = text.replace(/^@/, '').trim();
    delete adminState[adminId];
    let channels = settings.getChannels();
    const totalBefore = channels.length;
    if (channels.includes(u)) {
      channels = channels.filter(c => c !== u);
      settings.saveChannels(channels);
      return safeSend(msg.chat.id, formatChannelRemovedResponse(u, totalBefore, channels.length), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🗑️ Remove Another', callback_data: 'ch_remove' }],
            [{ text: '📢 View Channels', callback_data: 'ch_list' }],
            [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
          ]
        }
      });
    } else {
      return safeSend(msg.chat.id, `⚠️ Channel @${u} was not found in the scraping list.`, {
        reply_markup: getChannelsMenuMarkup()
      });
    }
  }

  // 6. Add group sink
  if (state.action === 'add_sink_group' || state.action === 'set_sink_custom' || state.action === 'set_sink_group') {
    const val = text.trim();
    delete adminState[adminId];
    if (!val) {
      return safeSend(msg.chat.id, '⚠️ Please send a valid Chat ID (e.g. -1004469567529).', {
        reply_markup: getCancelMarkup('admin_menu_sink')
      });
    }
    const totalBefore = settings.groupSinks.length;
    if (!settings.groupSinks.includes(val)) {
      settings.groupSinks.push(val);
      settings.saveSink();
    }
    return safeSend(msg.chat.id,
      `${formatSinkAddedResponse(val, totalBefore, settings.groupSinks.length)}\n\n${formatSinkMenuText()}`,
      { reply_markup: getSinkMenuMarkup() }
    );
  }

  // 7. Remove group sink
  if (state.action === 'remove_sink_group') {
    const val = text.trim();
    delete adminState[adminId];
    const totalBefore = settings.groupSinks.length;
    if (settings.groupSinks.includes(val)) {
      settings.groupSinks = settings.groupSinks.filter(s => s !== val);
      settings.saveSink();
      return safeSend(msg.chat.id,
        `${formatSinkRemovedResponse(val, totalBefore, settings.groupSinks.length)}\n\n${formatSinkMenuText()}`,
        { reply_markup: getSinkMenuMarkup() }
      );
    } else {
      return safeSend(msg.chat.id,
        `⚠️ Group Sink ID ${val} was not found in your active sinks list.\n\n` +
        `👥 Total Group Sinks: ${settings.groupSinks.length}`,
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
    settings.maxAgeDays = val;
    settings.saveSink();
    return safeSend(msg.chat.id, formatMaxAgeUpdatedResponse(settings.maxAgeDays), {
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

// -------------------------------------------------------------
// Callback Query Handler (BotFather-style inline buttons)
// -------------------------------------------------------------

bot.on('callback_query', async (query) => {
  const fromId = query.from ? String(query.from.id) : '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : fromId;
  const messageId = query.message ? query.message.message_id : null;
  const data = query.data;

  // Security check: Only admins can trigger admin callbacks
  if (!settings.ADMIN_IDS.includes(fromId)) {
    return bot.answerCallbackQuery(query.id, {
      text: '⛔ Access denied: Administrator only.',
      show_alert: true
    }).catch(() => {});
  }

  if (data === 'admin_main') {
    delete adminState[fromId];
    return editOrSend(chatId, messageId,
      `🛠️ IT Job Collection Bot — Admin Control Panel\n\n` +
      `Welcome to the Admin Control Panel. You can customize and manage all bot features here just like in BotFather:\n\n` +
      `• 🔍 Keywords: Manage IT job title and skill filter keywords\n` +
      `• 📢 Scraped Channels: Manage public Telegram channels scanned every 30s\n` +
      `• 🎯 Destination Sinks: Set destination group(s) & mode (Groups/Bot Chat/Both)\n` +
      `• 📅 Max Age: Configure maximum age of jobs to collect (1-365 days)\n` +
      `• 🚀 Forward Jobs: Pull and forward custom number of recent jobs to group(s)\n` +
      `• 📊 Bot Status: Overview of bot uptime, jobs, and channels\n` +
      `• ⚡ Live Scan: Force an immediate scrape across all channels now\n\n` +
      `💡 Tap an option below to proceed:`,
      getAdminControlPanelMarkup()
    );
  }

  if (data === 'admin_menu_keywords') {
    delete adminState[fromId];
    const keywords = settings.getKeywords();
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
      `Please send the IT keywords separated by commas.\n\n` +
      `💡 Example:\n` +
      `Flutter, Golang, Ruby, Rust, NestJS\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_keywords')
    );
  }

  if (data === 'kw_list') {
    delete adminState[fromId];
    const keywords = settings.getKeywords();
    const list = keywords.join(', ');
    return editOrSend(chatId, messageId,
      `📋 Active Filter Keywords (${keywords.length}):\n\n` +
      list + `\n\n` +
      `💡 Select an action below:`,
      getKeywordsMenuMarkup()
    );
  }

  if (data === 'kw_remove') {
    adminState[fromId] = { action: 'remove_kw' };
    return editOrSend(chatId, messageId,
      `🗑️ Remove Keyword\n\n` +
      `Please send the keyword name(s) to remove (separated by commas if multiple).\n\n` +
      `💡 Example:\n` +
      `Ruby\n` +
      `or:\n` +
      `Ruby, Golang\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_keywords')
    );
  }

  if (data === 'admin_menu_channels') {
    delete adminState[fromId];
    const channels = settings.getChannels();
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
    const channels = settings.getChannels();
    const list = channels.map((c, i) => `${i + 1}. @${c}`).join('\n');
    return editOrSend(chatId, messageId,
      `📋 Monitored Channels (${channels.length}):\n\n` +
      list + `\n\n` +
      `💡 Select an action below:`,
      getChannelsMenuMarkup()
    );
  }

  if (data === 'ch_scrape_all') {
    delete adminState[fromId];
    bot.answerCallbackQuery(query.id, { text: '⚡ Live channel scan initiated!' }).catch(() => {});
    pollChannels().catch(console.error);
    const channels = settings.getChannels();
    return editOrSend(chatId, messageId,
      `⚡ Live Channel Scrape Initiated!\n\n` +
      `📡 Scanning all ${channels.length} channels in parallel batches of 6...\n` +
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

  if (data === 'admin_menu_sink') {
    delete adminState[fromId];
    return editOrSend(chatId, messageId, formatSinkMenuText(), getSinkMenuMarkup());
  }

  if (data === 'sink_mode_group') {
    settings.sinkMode = 'group';
    settings.saveSink();
    bot.answerCallbackQuery(query.id, { text: '🎯 Mode set to Groups Only' }).catch(() => {});
    return editOrSend(chatId, messageId,
      `${formatSinkModeUpdatedResponse('group')}\n\n${formatSinkMenuText()}`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_mode_admin') {
    settings.sinkMode = 'admin';
    settings.saveSink();
    bot.answerCallbackQuery(query.id, { text: '🤖 Mode set to Bot Chat Only' }).catch(() => {});
    return editOrSend(chatId, messageId,
      `${formatSinkModeUpdatedResponse('admin')}\n\n${formatSinkMenuText()}`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_mode_both') {
    settings.sinkMode = 'both';
    settings.saveSink();
    bot.answerCallbackQuery(query.id, { text: '🔄 Mode set to Both' }).catch(() => {});
    return editOrSend(chatId, messageId,
      `${formatSinkModeUpdatedResponse('both')}\n\n${formatSinkMenuText()}`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_add') {
    adminState[fromId] = { action: 'add_sink_group' };
    return editOrSend(chatId, messageId,
      `➕ Add Group Destination Sink\n\n` +
      `Please send the Telegram Group Chat ID to add.\n\n` +
      `💡 Example:\n` +
      `-1004469567529\n\n` +
      `💡 Tip: You can also use /addsink here while in the group to add it automatically.\n\n` +
      `(Or tap Cancel below to abort)`,
      getCancelMarkup('admin_menu_sink')
    );
  }

  if (data === 'sink_remove') {
    adminState[fromId] = { action: 'remove_sink_group' };
    if (!settings.groupSinks.length) {
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
      `👥 Current Group Sinks (${settings.groupSinks.length}):\n` +
      settings.groupSinks.map((s, idx) => `  ${idx + 1}. ${s}`).join('\n') + `\n\n` +
      `(Or tap Cancel below to abort)`,
      getRemoveSinkMarkup()
    );
  }

  if (data && data.startsWith('sink_del_')) {
    delete adminState[fromId];
    const remId = data.replace('sink_del_', '').trim();
    const totalBefore = settings.groupSinks.length;
    settings.groupSinks = settings.groupSinks.filter(s => s !== remId);
    settings.saveSink();
    bot.answerCallbackQuery(query.id, { text: `Removed sink: ${remId}` }).catch(() => {});
    return editOrSend(chatId, messageId,
      `${formatSinkRemovedResponse(remId, totalBefore, settings.groupSinks.length)}\n\n${formatSinkMenuText()}`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_list') {
    delete adminState[fromId];
    const list = settings.groupSinks.map((s, idx) => `• Group #${idx + 1}: ${s}`).join('\n');
    return editOrSend(chatId, messageId,
      `📋 Active Destination Sinks (${settings.groupSinks.length}):\n\n` +
      (list || 'No group sinks configured.') + `\n\n` +
      `📌 Forwarding Mode: ${settings.sinkMode.toUpperCase()}\n` +
      `🤖 Admin Bot Chat: ${settings.adminSink}\n\n` +
      `💡 Tap an action below:`,
      getSinkMenuMarkup()
    );
  }

  if (data === 'sink_test') {
    delete adminState[fromId];
    bot.answerCallbackQuery(query.id, { text: '🧪 Running sink tests...' }).catch(() => {});
    return testSinks(chatId);
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
          `Any newly discovered IT jobs published today have been delivered to your destination sink.`,
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
    settings.maxAgeDays = days;
    settings.saveSink();
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

  if (data === 'admin_run_scan') {
    delete adminState[fromId];
    bot.answerCallbackQuery(query.id, { text: '⚡ Live scan initiated!' }).catch(() => {});
    pollChannels().catch(console.error);
    const channels = settings.getChannels();
    return safeSend(chatId,
      `⚡ Live Channel Scrape Initiated!\n\n` +
      `📡 Scanning all ${channels.length} channels in parallel batches of 6...\n` +
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

// -------------------------------------------------------------
// Group Auto-Moderation & Regular User Input Restriction
// -------------------------------------------------------------

bot.on('message', (msg) => {
  if (isAdmin(msg)) return; // Admin is unrestricted

  // 1. In private chat: block any arbitrary text, media, or non-allowed commands
  if (isPrivate(msg)) {
    if (!isAllowedNonAdminCommand(msg.text)) {
      const channels = settings.getChannels();
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
  if (isSource(msg.chat.id) && !settings.groupSinks.includes(String(msg.chat.id)) && String(msg.chat.id) !== String(settings.getPrimaryGroupSink())) {
    return;
  }

  // Never attempt to delete messages sent by the bot itself
  if (msg.from && msg.from.is_bot && (msg.from.id === 9186503282 || msg.from.username === 'facescan_roeurn_bot')) {
    return;
  }

  if (!isAllowedNonAdminCommand(msg.text)) {
    const senderName = msg.from
      ? `${msg.from.first_name || ''} ${msg.from.last_name || ''} (@${msg.from.username || msg.from.id})`.trim()
      : 'Unknown member';
    bot.deleteMessage(msg.chat.id, msg.message_id)
      .then(() => {
        logger.autoDelete(msg.message_id, senderName, msg.chat.id);
      })
      .catch((err) => {
        logger.error(`Delete failed for #${msg.message_id} in ${msg.chat.id}:`, err.message);
      });
  }
});

// -------------------------------------------------------------
// Telegram Slash Commands
// -------------------------------------------------------------

bot.onText(/^\/start(?:\s+(.+))?/i, async (msg, match) => {
  if (!isPrivate(msg)) {
    return deliverToUserOrRedirect(msg, 'start', id => {
      const channels = settings.getChannels();
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
  if (param === 'recent') return await sendRecent(msg.chat.id, 10);
  if (param === 'status') return await sendStatus(msg.chat.id, isAdmin(msg));
  if (param === 'channels') return await sendChannels(msg.chat.id);

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
            [{ text: '📊 Bot Status', callback_data: 'admin_status' }],
            [{ text: '🚀 Forward Jobs to Group', callback_data: 'admin_forward_prompt' }]
          ]
        }
      }
    );
  }

  const channels = settings.getChannels();
  return safeSend(chatId,
    `🤖 IT Job Collection Bot\n\n` +
    `I collect IT job opportunities from Telegram channels and forward them to a central destination.\n\n` +
    `📋 Allowed Commands:\n` +
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
    `• 📢 Scraped Channels: Manage public Telegram channels scanned every 30s\n` +
    `• 🎯 Destination Sinks: Set destination group(s) & mode (Groups/Bot Chat/Both)\n` +
    `• 📅 Max Age: Configure maximum age of jobs to collect (1-365 days)\n` +
    `• 🚀 Forward Jobs: Pull and forward custom number of recent jobs to group(s)\n` +
    `• 📊 Bot Status: Overview of bot uptime, jobs, and channels\n` +
    `• ⚡ Live Scan: Force an immediate scrape across all channels now\n\n` +
    `💡 Select an option below:`,
    { reply_markup: getAdminControlPanelMarkup() }
  );
});

bot.onText(/^\/cancel(?:\s|$|@\w+)/i, (msg) => {
  if (!isAdmin(msg)) return;
  const adminId = String(msg.from ? msg.from.id : msg.chat.id);
  delete adminState[adminId];
  safeSend(msg.chat.id, '🚫 Action cancelled. Returned to normal mode.', {
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
  settings.maxAgeDays = val;
  settings.saveSink();
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

bot.onText(/^\/sinkmode(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const arg = m && m[1] ? m[1].trim().toLowerCase() : '';
  if (arg === 'group' || arg === 'admin' || arg === 'both') {
    settings.sinkMode = arg;
    settings.saveSink();
    return safeSend(msg.chat.id, formatSinkModeUpdatedResponse(arg), {
      reply_markup: getSinkMenuMarkup()
    });
  }
  return safeSend(msg.chat.id,
    `🎯 Choose Forwarding Mode:\n\n` +
    `• Groups Only: Jobs forwarded to all group sinks\n` +
    `• Bot Chat Only: Jobs forwarded to your private bot chat only\n` +
    `• Both: Jobs forwarded to both your group(s) and bot chat\n\n` +
    `💡 Select mode below:`,
    { reply_markup: getSinkMenuMarkup() }
  );
});

bot.onText(/^\/addsink(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  let targetId = raw;
  if (!targetId || targetId.toLowerCase() === 'here') {
    if (!isPrivate(msg)) {
      targetId = String(msg.chat.id);
    } else {
      const adminId = String(msg.from ? msg.from.id : msg.chat.id);
      adminState[adminId] = { action: 'add_sink_group' };
      return safeSend(msg.chat.id,
        `➕ Add Group Destination Sink\n\n` +
        `Please send the Telegram Group Chat ID to add as a destination sink.\n\n` +
        `💡 Example:\n` +
        `-1004469567529\n\n` +
        `💡 Or use /addsink in the target group.\n\n` +
        `(Or tap Cancel below to abort)`,
        getCancelMarkup('admin_menu_sink')
      );
    }
  }

  const totalBefore = settings.groupSinks.length;
  if (!settings.groupSinks.includes(targetId)) {
    settings.groupSinks.push(targetId);
    settings.saveSink();
  }
  return safeSend(msg.chat.id,
    `${formatSinkAddedResponse(targetId, totalBefore, settings.groupSinks.length)}\n\n${formatSinkMenuText()}`,
    { reply_markup: getSinkMenuMarkup() }
  );
});

bot.onText(/^\/removesink(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) {
    if (!settings.groupSinks.length) {
      return safeSend(msg.chat.id, '⚠️ No group sinks currently configured to remove.');
    }
    return safeSend(msg.chat.id,
      `🗑️ Remove Destination Sink\n\n` +
      `Tap a sink below to remove it, or use: /removesink <id>`,
      { reply_markup: getRemoveSinkMarkup() }
    );
  }

  const totalBefore = settings.groupSinks.length;
  if (settings.groupSinks.includes(raw)) {
    settings.groupSinks = settings.groupSinks.filter(s => s !== raw);
    settings.saveSink();
    return safeSend(msg.chat.id,
      `${formatSinkRemovedResponse(raw, totalBefore, settings.groupSinks.length)}\n\n${formatSinkMenuText()}`,
      { reply_markup: getSinkMenuMarkup() }
    );
  }
  return safeSend(msg.chat.id, `⚠️ Group Sink ${raw} was not found in your configured sinks list.`);
});

bot.onText(/^\/sink(?:\s|$|@\w+)/i, (msg) => {
  if (!requireAdmin(msg)) return;
  safeSend(msg.chat.id, formatSinkMenuText(), {
    reply_markup: getSinkMenuMarkup()
  });
});

bot.onText(/^\/keywords(?:\s|$|@\w+)/i, (msg) => {
  if (!requireAdmin(msg)) return;
  const keywords = settings.getKeywords();
  safeSend(msg.chat.id,
    `🔍 Active Filter Keywords (${keywords.length}):\n\n` +
    keywords.join(', ') +
    `\n\n💡 Select an action below:`,
    { reply_markup: getKeywordsMenuMarkup() }
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
      { reply_markup: getKeywordsMenuMarkup() }
    );
  }

  const items = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const keywords = settings.getKeywords();
  const totalBefore = keywords.length;
  const added = [];
  for (const item of items) {
    if (!keywords.includes(item)) {
      keywords.push(item);
      added.push(item);
    }
  }
  if (added.length) settings.saveKeywords(keywords);

  if (added.length === 1) {
    return safeSend(msg.chat.id, formatKeywordAddedResponse(added[0], totalBefore, keywords.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add Another Single', callback_data: 'kw_single' }],
          [{ text: '🔍 View Keywords', callback_data: 'kw_list' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  }

  return safeSend(msg.chat.id, formatKeywordsMultipleAddedResponse(added, totalBefore, keywords.length), {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕➕ Add More Multiple', callback_data: 'kw_multiple' }],
        [{ text: '🔍 View Keywords', callback_data: 'kw_list' }],
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
      `• Remove keyword: /removekeyword Flutter\n` +
      `• Remove multiple: /removekeyword Flutter, Golang\n\n` +
      `Or select from the menu below:`,
      { reply_markup: getKeywordsMenuMarkup() }
    );
  }

  const items = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  let keywords = settings.getKeywords();
  const totalBefore = keywords.length;
  const removed = [];
  for (const item of items) {
    if (keywords.includes(item)) {
      keywords = keywords.filter(k => k !== item);
      removed.push(item);
    }
  }
  if (removed.length) settings.saveKeywords(keywords);

  return safeSend(msg.chat.id, formatKeywordRemovedResponse(removed.join(', '), totalBefore, keywords.length), {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗑️ Remove Another', callback_data: 'kw_remove' }],
        [{ text: '🔍 View Keywords', callback_data: 'kw_list' }],
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

bot.onText(/^\/addchannel(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) {
    return safeSend(msg.chat.id,
      `💡 How to add channels:\n` +
      `• /addchannel cambodiaitjobs\n` +
      `• /addchannel @khmerdevelopers\n\n` +
      `Or tap below to enter channel username:`,
      { reply_markup: getChannelsMenuMarkup() }
    );
  }

  const u = raw.replace(/^@/, '').trim();
  const channels = settings.getChannels();
  const totalBefore = channels.length;
  if (!channels.includes(u)) {
    channels.push(u);
    settings.saveChannels(channels);
    return safeSend(msg.chat.id, formatChannelAddedResponse(u, totalBefore, channels.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add Another Channel', callback_data: 'ch_add' }],
          [{ text: `⚡ Scrape @${u} Now`, callback_data: `scrape_one_${u}` }],
          [{ text: '📢 Channels Menu', callback_data: 'admin_menu_channels' }]
        ]
      }
    });
  }
  return safeSend(msg.chat.id, `ℹ️ Channel @${u} is already in the scraping list.`);
});

bot.onText(/^\/removechannel(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) {
    return safeSend(msg.chat.id,
      `💡 How to remove channels:\n` +
      `• /removechannel cambodiaitjobs\n\n` +
      `Or select from the channels menu:`,
      { reply_markup: getChannelsMenuMarkup() }
    );
  }

  const u = raw.replace(/^@/, '').trim();
  let channels = settings.getChannels();
  const totalBefore = channels.length;
  if (channels.includes(u)) {
    channels = channels.filter(c => c !== u);
    settings.saveChannels(channels);
    return safeSend(msg.chat.id, formatChannelRemovedResponse(u, totalBefore, channels.length), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ Remove Another', callback_data: 'ch_remove' }],
          [{ text: '📢 View Channels', callback_data: 'ch_list' }],
          [{ text: '🛠️ Admin Panel', callback_data: 'admin_main' }]
        ]
      }
    });
  }
  return safeSend(msg.chat.id, `⚠️ Channel @${u} was not found in the scraping list.`);
});

bot.onText(/^\/channels?(?:\s|$|@\w+)/i, async (msg) => {
  if (!isPrivate(msg)) {
    return deliverToUserOrRedirect(msg, 'channels', id => sendChannels(id));
  }
  if (isAdmin(msg)) {
    const channels = settings.getChannels();
    const list = channels.map((c, i) => `${i + 1}. @${c}`).join('\n');
    return await safeSend(msg.chat.id,
      `📢 Scraped Channels (${channels.length}):\n\n${list}\n\n💡 Admin Options:`,
      { reply_markup: getChannelsMenuMarkup() }
    );
  }
  await sendChannels(msg.chat.id);
});

// Sources management (manual)
bot.onText(/^\/addsource\s+(.+)/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const id = m[1].trim();
  const sources = settings.getSources();
  if (!sources.includes(id)) {
    sources.push(id);
    settings.saveSources(sources);
  }
  safeSend(msg.chat.id, `Source added: ${id}`);
});

bot.onText(/^\/removesource\s+(.+)/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const id = m[1].trim();
  let sources = settings.getSources();
  sources = sources.filter(s => s !== id);
  settings.saveSources(sources);
  safeSend(msg.chat.id, `Source removed: ${id}`);
});

bot.onText(/^\/sources(?:\s|$|@\w+)/i, (msg) => {
  if (!requireAdmin(msg)) return;
  const sources = settings.getSources();
  safeSend(msg.chat.id, sources.length ? 'Sources:\n' + sources.join('\n') : 'No sources configured.');
});

// Destination sink alias commands
bot.onText(/^\/setsink(?:\s+(.+))?/i, (msg, m) => {
  if (!requireAdmin(msg)) return;
  const arg = m && m[1] ? m[1].trim() : '';
  if (!arg) {
    return safeSend(msg.chat.id, formatSinkMenuText(), {
      reply_markup: getSinkMenuMarkup()
    });
  }
  const totalBefore = settings.groupSinks.length;
  if (!settings.groupSinks.includes(arg)) {
    settings.groupSinks.push(arg);
    settings.saveSink();
  }
  return safeSend(msg.chat.id,
    `${formatSinkAddedResponse(arg, totalBefore, settings.groupSinks.length)}\n\n${formatSinkMenuText()}`,
    { reply_markup: getSinkMenuMarkup() }
  );
});

// Group member update handler
bot.on('my_chat_member', (upd) => {
  const chat = upd.chat;
  const newStatus = upd.new_chat_member && upd.new_chat_member.status;
  if (newStatus === 'administrator' || newStatus === 'member') {
    const id = String(chat.id);
    if (settings.groupSinks.includes(id) || id === String(settings.getPrimaryGroupSink())) {
      logger.info('Bot added to destination sink group:', id, sourceLabel(chat));
      return;
    }
    const sources = settings.getSources();
    if (!sources.includes(id)) {
      sources.push(id);
      settings.saveSources(sources);
      logger.info('Auto-added source:', id, sourceLabel(chat));
      for (const a of settings.ADMIN_IDS) {
        safeSend(a, `Bot added to "${sourceLabel(chat)}" (${id}). Added as source.`);
      }
    }
  }
  if (newStatus === 'left' || newStatus === 'kicked') {
    const id = String(chat.id);
    let sources = settings.getSources();
    sources = sources.filter(s => s !== id);
    settings.saveSources(sources);
  }
});

// Incoming message and channel post handlers
bot.on('message', handleIncoming);
bot.on('channel_post', handleIncoming);

function initBot() {
  logger.info('IT Job Collection Bot initialized with polling.');
  startScraper();
}

module.exports = {
  initBot,
  bot,
  sendStatus,
  sendRecent,
  sendChannels
};
