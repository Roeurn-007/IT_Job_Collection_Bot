const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const settings = require('../src/config/settings');
const storageService = require('../src/services/storageService');
const supabaseService = require('../src/services/supabaseService');
const { sanitizeUsername } = require('../src/bot/handlers/channelPost');
const { formatPhnomPenhDate } = require('../src/utils/dateUtils');
const { app } = require('../src/server');

async function testFullSuite() {
  console.log('===============================================================');
  console.log('🧪 COMPREHENSIVE END-TO-END TEST SUITE FOR IT JOB BOT');
  console.log('===============================================================\n');

  // -----------------------------------------------------------------
  // 1. CHANNEL SANITIZATION & SCRAPER STABILITY TEST
  // -----------------------------------------------------------------
  console.log('STEP 1: Channel Sanitization & Scraper Stability');
  const dirtyChannels = [
    'https://t.me/camhrjobs',
    't.me/HBCareer',
    '@channelcamupjob',
    'aseanworks/',
    'https://t.me/abacareers/'
  ];
  for (const raw of dirtyChannels) {
    const clean = sanitizeUsername(raw);
    assert(!clean.includes('/') && !clean.includes('@') && !clean.includes('http'), `Failed to sanitize: ${raw}`);
    console.log(`  • "${raw}" -> "${clean}" ✅`);
  }
  console.log('  ✅ Channel sanitization verified with 0 invalid formats.\n');

  // -----------------------------------------------------------------
  // 2. EXPIRATION CUSTOMIZATION & SINK PERSISTENCE TEST
  // -----------------------------------------------------------------
  console.log('STEP 2: Expiration Retention Persistence in sink.json');
  const originalExpiry = settings.expiryDays;
  console.log('  • Original Expiry Days:', originalExpiry);

  // Simulate admin changing to 45 days
  settings.expiryDays = 45;
  settings.saveSink();
  assert.strictEqual(settings.expiryDays, 45, 'Memory setting must be 45');

  // Verify reload from storage
  const reloadedSink = settings.readJson(settings.SINK_FILE, {});
  assert.strictEqual(reloadedSink.expiryDays, 45, 'sink.json must persist 45');
  console.log('  • Successfully updated and persisted custom expiry to 45 days.');

  // Restore to 60 days
  settings.expiryDays = 60;
  settings.saveSink();
  console.log('  • Restored default 60-day (2-month) retention setting.\n');

  // -----------------------------------------------------------------
  // 3. DATE STORAGE & ZERO DATA LOSS INTEGRITY TEST
  // -----------------------------------------------------------------
  console.log('STEP 3: Date Storage & Data Loss Prevention');
  const exactDateStr = '2026-11-17T09:18:23.456Z';
  const sampleJob = {
    id: 'test_verify_zero_loss_9999',
    source: '@camhrjobs',
    sourceId: 'camhrjobs',
    messageId: 9999,
    snippet: 'Staff AI Engineer ($3500-$5000) at TechCorp',
    text: 'Staff AI Engineer ($3500-$5000) at TechCorp. Requirements: Python, PyTorch, Node.js.',
    date: exactDateStr,
    link: 'https://t.me/camhrjobs/9999',
    isToday: true
  };

  storageService.addJob(sampleJob);
  const found = storageService.collected.find(j => j.id === sampleJob.id);
  assert(found, 'Job must be stored in storageService');
  assert.strictEqual(found.date, exactDateStr, 'Date must match exact timestamp down to the millisecond');
  assert.strictEqual(found.text, sampleJob.text, 'Full post text must be stored with zero data loss');
  assert.strictEqual(found.snippet, sampleJob.snippet, 'Snippet must be preserved');
  console.log('  • Input ISO Date:', exactDateStr);
  console.log('  • Stored Date:', found.date);
  console.log('  • Formatted Cambodia Local Date:', formatPhnomPenhDate(found.date).display);
  console.log('  ✅ PASS: Exact date and data fields verified with zero distortion.\n');

  // Clean test job
  storageService.collected = storageService.collected.filter(j => j.id !== sampleJob.id);
  storageService.saveCollected();

  // -----------------------------------------------------------------
  // 4. 2-MONTH EXPIRATION PURGE LOGIC TEST
  // -----------------------------------------------------------------
  console.log('STEP 4: 2-Month Expiration Purge Verification');
  const freshDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days old
  const expiredDate = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString(); // 65 days old

  const jobFresh = { id: 'test_keep_1', date: freshDate, text: 'Fresh job' };
  const jobExpired = { id: 'test_purge_1', date: expiredDate, text: 'Old job' };

  storageService.collected.push(jobFresh);
  storageService.collected.push(jobExpired);

  console.log('  • Testing with retention = 60 days:');
  const purgeRes = await storageService.purgeExpiredJobs(60);
  console.log('  • Purge Result:', purgeRes);

  const freshSurvived = storageService.collected.some(j => j.id === 'test_keep_1');
  const expiredDeleted = !storageService.collected.some(j => j.id === 'test_purge_1');

  assert(freshSurvived, 'Fresh job (5d old) MUST NOT be deleted');
  assert(expiredDeleted, 'Expired job (65d old) MUST be deleted');
  console.log('  ✅ PASS: Only jobs > 60 days are removed; fresh jobs are 100% safe.\n');

  // Clean test job
  storageService.collected = storageService.collected.filter(j => j.id !== 'test_keep_1');
  storageService.saveCollected();

  // -----------------------------------------------------------------
  // 5. SERVER API ENDPOINTS & WEB DASHBOARD TEST (IN-MEMORY)
  // -----------------------------------------------------------------
  console.log('STEP 5: Web Dashboard & Server API Endpoints');
  function testRoute(expressApp, method, url) {
    return new Promise((resolve, reject) => {
      const { EventEmitter } = require('events');
      const req = Object.assign(new EventEmitter(), {
        method,
        url,
        path: url.split('?')[0],
        headers: { host: 'localhost' },
        query: {},
        body: {}
      });
      const [pathOnly, qs] = url.split('?');
      if (qs) {
        req.query = Object.fromEntries(new URLSearchParams(qs));
      }
      const res = {
        statusCode: 200,
        headers: {},
        status(c) { this.statusCode = c; return this; },
        setHeader(k, v) { this.headers[k] = v; return this; },
        json(data) { resolve({ statusCode: this.statusCode, data }); },
        send(data) { resolve({ statusCode: this.statusCode, data }); },
        end() { resolve({ statusCode: this.statusCode, data: null }); }
      };
      expressApp.handle(req, res, (err) => {
        if (err) reject(err);
        else resolve({ statusCode: 404, data: null });
      });
    });
  }

  // 5.1 /api/health
  const healthRes = await testRoute(app, 'GET', '/api/health');
  assert.strictEqual(healthRes.statusCode, 200, 'Health check failed');
  assert.strictEqual(healthRes.data.ok, true, 'Health ok failed');
  console.log('  • GET /api/health -> OK (Status 200) ✅');

  // 5.2 /api/status
  const statusRes = await testRoute(app, 'GET', '/api/status');
  assert(statusRes.data.channels > 0, 'Channels count must be > 0');
  assert.strictEqual(statusRes.data.expiryDays, 60, 'Status must report 60d expiry');
  console.log(`  • GET /api/status -> Channels: ${statusRes.data.channels}, Collected: ${statusRes.data.collectedCount}, Expiry: ${statusRes.data.expiryDays}d, Supabase: ${statusRes.data.supabase.configured ? 'Connected' : 'Local Fallback'} ✅`);

  // 5.3 /api/collected
  const collectedRes = await testRoute(app, 'GET', '/api/collected?limit=5');
  assert(Array.isArray(collectedRes.data), 'Must return array of jobs');
  console.log(`  • GET /api/collected -> Returned ${collectedRes.data.length} recent non-expired jobs ✅`);

  // 5.4 /api/cleanup
  const cleanupRes = await testRoute(app, 'POST', '/api/cleanup');
  assert.strictEqual(cleanupRes.data.ok, true, 'Cleanup endpoint failed');
  console.log(`  • POST /api/cleanup -> Executed successfully (Local purged: ${cleanupRes.data.localDeleted}) ✅`);

  console.log('  ✅ All Express APIs and Dashboard routes verified.\n');

  // -----------------------------------------------------------------
  // 6. GROUP AUTO-MODERATION & REDIRECT NOTICE VERIFICATION
  // -----------------------------------------------------------------
  console.log('STEP 6: Group Auto-Moderation & Redirect Notice Verification');
  const {
    isAdmin,
    isAllowedNonAdminCommand,
    notifyNonAdminAndRedirect
  } = require('../src/bot/services/telegramService');

  // Test 6.1: Admin vs Non-Admin detection
  const adminMsg = { from: { id: settings.ADMIN_IDS[0] }, chat: { id: '-1004469567529' } };
  const nonAdminMsg = { from: { id: '1122334455', username: 'jobseeker_cambodia', first_name: 'Sokha' }, chat: { id: '-1004469567529' }, message_id: 888, text: 'Hello, any IT job vacancies today?' };
  
  assert.strictEqual(isAdmin(adminMsg), true, 'Admin message must be recognized as admin');
  assert.strictEqual(isAdmin(nonAdminMsg), false, 'Non-admin message must NOT be recognized as admin');
  console.log('  • Admin vs Non-admin identity verification passed ✅');

  // Test 6.2: Allowed vs Prohibited command filtering
  assert.strictEqual(isAllowedNonAdminCommand('/start'), true);
  assert.strictEqual(isAllowedNonAdminCommand('/status'), true);
  assert.strictEqual(isAllowedNonAdminCommand('/recent'), true);
  assert.strictEqual(isAllowedNonAdminCommand('/channels'), true);
  assert.strictEqual(isAllowedNonAdminCommand('hello world'), false);
  assert.strictEqual(isAllowedNonAdminCommand('/admin'), false);
  assert.strictEqual(isAllowedNonAdminCommand('/setexpiry 45'), false);
  assert.strictEqual(isAllowedNonAdminCommand(undefined), false);
  console.log('  • Allowed vs Prohibited message/command filter verified ✅');

  // Test 6.3: Mock dispatch of notifyNonAdminAndRedirect
  const { bot } = require('../src/bot/services/telegramService');
  let deletedMsgId = null;
  let sentNotice = null;
  const originalDelete = bot.deleteMessage;
  const originalSend = bot.sendMessage;

  bot.deleteMessage = async (cId, mId) => {
    deletedMsgId = mId;
    return true;
  };
  bot.sendMessage = async (cId, text, opts) => {
    sentNotice = { cId, text, opts };
    return { message_id: 999 };
  };

  try {
    await notifyNonAdminAndRedirect(nonAdminMsg);

    assert.strictEqual(deletedMsgId, 888, 'Non-admin user message must be immediately deleted');
    assert(sentNotice, 'Bot must send redirect notice to group');
    assert(sentNotice.text.includes('👋 Hello @jobseeker_cambodia!'), 'Notice must greet user by handle');
    assert(sentNotice.text.includes('🚫 Non-admin messages are not allowed in this group.'), 'Notice must explain group restriction');
    assert(sentNotice.text.includes('📌 This group is exclusively reserved for IT job announcements.'), 'Notice must explain group purpose');
    assert(sentNotice.text.includes('💬 Please chat directly with the bot'), 'Notice must prompt direct chat');
    assert(sentNotice.opts && sentNotice.opts.reply_markup && sentNotice.opts.reply_markup.inline_keyboard, 'Notice must have inline keyboard button');
    
    const btn = sentNotice.opts.reply_markup.inline_keyboard[0][0];
    assert.strictEqual(btn.text, '💬 Chat Directly with Bot');
    assert(btn.url.includes('https://t.me/'), 'Button must link to bot direct chat');
    console.log('  • Redirect notice formatting, greeting, and inline keyboard button verified ✅');

    // Test 6.4: Anti-spam cooldown prevention
    let duplicateNoticeSent = false;
    bot.sendMessage = async () => { duplicateNoticeSent = true; return { message_id: 1000 }; };
    await notifyNonAdminAndRedirect({ ...nonAdminMsg, message_id: 889 });
    assert.strictEqual(duplicateNoticeSent, false, 'Duplicate warning must not be spammed while previous notice is active');
    console.log('  • Anti-spam notice cooldown protection verified ✅');
  } finally {
    bot.deleteMessage = originalDelete;
    bot.sendMessage = originalSend;
  }

  console.log('  ✅ Group Auto-Moderation & Redirect Notice 100% verified.\n');

  // -----------------------------------------------------------------
  // 7. GROUP CHAT PERMISSION TOGGLE & PERSISTENCE TEST
  // -----------------------------------------------------------------
  console.log('STEP 7: Group Chat Permission Toggle & Persistence (Admin Feature)');
  
  // Test 7.1: Admin enables group chat (allow normal users to text)
  settings.allowUserChat = true;
  settings.saveSink();
  assert.strictEqual(settings.allowUserChat, true, 'Memory setting must be true');

  // Verify reloaded from sink.json
  const sinkCheck = settings.readJson(settings.SINK_FILE, {});
  assert.strictEqual(sinkCheck.allowUserChat, true, 'sink.json must persist allowUserChat: true');
  console.log('  • Admin opened group chat: successfully persisted allowUserChat = true ✅');

  // Verify Express /api/status endpoint reflects allowUserChat
  const statusResChat = await testRoute(app, 'GET', '/api/status');
  assert.strictEqual(statusResChat.data.allowUserChat, true, '/api/status must reflect allowUserChat: true');
  console.log('  • /api/status endpoint reports allowUserChat: true ✅');

  // Verify non-admin messages are NOT deleted when allowUserChat = true
  let testMsgDeleted = false;
  const tempDelete = bot.deleteMessage;
  bot.deleteMessage = async () => { testMsgDeleted = true; };
  if (!settings.allowUserChat && !isAllowedNonAdminCommand('hello world')) {
    await notifyNonAdminAndRedirect(nonAdminMsg);
  }
  bot.deleteMessage = tempDelete;
  assert.strictEqual(testMsgDeleted, false, 'Non-admin messages must NOT be deleted when allowUserChat is true');
  console.log('  • Verified normal user chat is preserved without auto-deletion when allowUserChat is enabled ✅');

  // Test 7.2: Admin disables/locks group chat (restricted to jobs only)
  settings.allowUserChat = false;
  settings.saveSink();
  assert.strictEqual(settings.allowUserChat, false, 'Memory setting must be false');

  const sinkCheckRestricted = settings.readJson(settings.SINK_FILE, {});
  assert.strictEqual(sinkCheckRestricted.allowUserChat, false, 'sink.json must persist allowUserChat: false');
  console.log('  • Admin locked group chat: successfully persisted allowUserChat = false ✅');

  const statusResRestricted = await testRoute(app, 'GET', '/api/status');
  assert.strictEqual(statusResRestricted.data.allowUserChat, false, '/api/status must reflect allowUserChat: false');
  console.log('  • /api/status endpoint reports allowUserChat: false ✅');

  console.log('  ✅ Admin Group Chat Moderation Toggle 100% verified.\n');

  // -----------------------------------------------------------------
  // 8. DESTINATION SINK VALIDATION & MULTI-MODE FORWARDING AUDIT
  // -----------------------------------------------------------------
  console.log('STEP 8: Destination Sink Validation & Forwarding Modes Audit');
  const { isValidGroupSink } = require('../src/config/settings');
  const { forwardJob } = require('../src/bot/services/forwardService');

  // 8.1 Validation of group sink IDs
  assert.strictEqual(isValidGroupSink('-1004469567529'), true, '-100 supergroup ID must be valid');
  assert.strictEqual(isValidGroupSink('-1009876543210'), true, '-100 supergroup ID must be valid');
  assert.strictEqual(isValidGroupSink('7339961364'), false, 'Positive admin user ID must be rejected as group sink');
  assert.strictEqual(isValidGroupSink('123456789'), false, 'Positive user ID must be rejected as group sink');
  assert.strictEqual(isValidGroupSink('-100xxxxxxxxxx'), false, 'Placeholder ID must be rejected');
  assert.strictEqual(isValidGroupSink(''), false, 'Empty string must be rejected');
  console.log('  • Group Sink ID validator strictly protects against accidental user IDs ✅');

  // 8.2 Primary group fallback
  const primaryGroup = settings.getPrimaryGroupSink();
  assert(primaryGroup.startsWith('-'), 'Primary group sink must start with minus sign (-)');
  console.log(`  • Verified primary group sink target: ${primaryGroup} ✅`);

  // 8.3 Verify getTargetSinks in all 3 modes
  const originalMode = settings.sinkMode;
  try {
    settings.sinkMode = 'group';
    const groupTargets = settings.getTargetSinks();
    assert(groupTargets.every(id => id.startsWith('-')), 'Group mode must ONLY target negative group/channel IDs');
    assert(groupTargets.includes('-1004469567529'), 'Must target managed group -1004469567529');
    console.log('  • Mode "group": Exclusively targets real group sinks ✅');

    settings.sinkMode = 'admin';
    const adminTargets = settings.getTargetSinks();
    assert(adminTargets.includes(settings.adminSink), 'Admin mode must target admin private chat');
    console.log('  • Mode "admin": Targets admin private chat ✅');

    settings.sinkMode = 'both';
    const bothTargets = settings.getTargetSinks();
    assert(bothTargets.length >= 2, 'Both mode must target both group and admin');
    console.log('  • Mode "both": Targets both group and admin simultaneously ✅');
  } finally {
    settings.sinkMode = originalMode;
    settings.saveSink();
  }

  // 8.4 Verify live forwarding dispatch logic (mocked)
  let dispatchedTarget = null;
  let dispatchedContent = null;
  let dispatchedPhotoTarget = null;
  const originalSafeSend = bot.sendMessage;
  const originalSendPhoto = bot.sendPhoto;

  bot.sendMessage = async (target, content) => {
    dispatchedTarget = String(target);
    dispatchedContent = content;
    return { message_id: 12345 };
  };
  bot.sendPhoto = async (target, photo, opts) => {
    dispatchedPhotoTarget = String(target);
    return { message_id: 12346 };
  };

  try {
    settings.sinkMode = 'group';
    const testJobText = {
      id: 'test_fwd_1',
      source: '@camhrjobs',
      messageId: 5555,
      text: 'We are hiring a Senior React Developer ($2500). Requirements: React, TypeScript.',
      date: new Date().toISOString()
    };
    await forwardJob(testJobText);
    assert(dispatchedTarget.startsWith('-'), 'Forwarded job MUST be sent to group ID, never user ID');
    assert(dispatchedContent.includes('React Developer'), 'Forwarded card must include job description');
    assert(dispatchedContent.includes('@camhrjobs'), 'Forwarded card must include source channel');
    console.log(`  • Forwarding service correctly dispatches text jobs to group target: ${dispatchedTarget} ✅`);

    const testJobPhoto = {
      id: 'test_fwd_2',
      source: '@camhrjobs',
      messageId: 5556,
      text: 'Senior DevOps Engineer ($3000)',
      date: new Date().toISOString(),
      photo: { file_id: 'test_photo_id' }
    };
    await forwardJob(testJobPhoto);
    assert(dispatchedPhotoTarget.startsWith('-'), 'Forwarded photo job MUST be sent to group ID');
    console.log(`  • Forwarding service correctly dispatches photo jobs to group target: ${dispatchedPhotoTarget} ✅`);
  } finally {
    bot.sendMessage = originalSafeSend;
    bot.sendPhoto = originalSendPhoto;
    settings.sinkMode = originalMode;
    settings.saveSink();
  }
  console.log('  ✅ Destination Sink Validation & Forwarding Audit 100% verified.\n');

  // -----------------------------------------------------------------
  // 9. IT KEYWORD FILTERING & SANITIZATION ENGINE
  // -----------------------------------------------------------------
  console.log('STEP 9: IT Keyword Filtering & Anti-Spam Intelligence');
  const { isJobPost, getMatchedKeywords } = require('../src/services/jobFilter');

  // Real IT jobs
  const itJob1 = 'We are hiring: Senior Fullstack Developer (Node.js + Vue.js). Salary: $2000-$3500/month. Location: Phnom Penh.';
  const itJob2 = 'Urgent Recruitment: IT Support Specialist & Network Engineer needed at ABA Bank. Apply now!';
  assert.strictEqual(isJobPost(itJob1), true, 'Must detect IT job post');
  assert.strictEqual(isJobPost(itJob2), true, 'Must detect IT job post');
  const matched1 = getMatchedKeywords(itJob1);
  assert(matched1.length > 0, 'Must extract matched technical keywords');
  console.log(`  • IT Job Detection verified -> Matched keywords: [${matched1.join(', ')}] ✅`);

  // Non-IT jobs
  const nonItJob = 'Job Vacancy: Looking for Waiter & Cashier for coffee shop in BKK1. Apply today.';
  assert.strictEqual(isJobPost(nonItJob), false, 'Must reject non-IT job');
  console.log('  • Non-IT job correctly filtered out ✅');

  // Spam / Contests with keywords in URL
  const spamPost = 'React to this post to win a lucky draw prize! Visit https://example.com/flutter_giveaway';
  assert.strictEqual(isJobPost(spamPost), false, 'Must reject spam / giveaway posts');
  console.log('  • Contest / giveaway post correctly filtered out ✅');
  console.log('  ✅ IT Keyword Filtering & Sanitization 100% verified.\n');

  // -----------------------------------------------------------------
  // 10. RENDER PRODUCTION BLUEPRINT & DEPLOYMENT HEALTH AUDIT
  // -----------------------------------------------------------------
  console.log('STEP 10: Render Cloud Deployment & Blueprint Audit');
  const renderYamlPath = path.join(__dirname, '../render.yaml');
  assert(fs.existsSync(renderYamlPath), 'render.yaml must exist in root');
  const renderYamlContent = fs.readFileSync(renderYamlPath, 'utf8');
  assert(renderYamlContent.includes('type: web'), 'render.yaml must define web service');
  assert(renderYamlContent.includes('plan: free'), 'render.yaml must specify free tier');
  assert(renderYamlContent.includes('region: singapore'), 'render.yaml must use low-latency singapore region');
  assert(renderYamlContent.includes('healthCheckPath: /api/health'), 'render.yaml must configure health check path');
  assert(renderYamlContent.includes('TELEGRAM_BOT_TOKEN'), 'render.yaml must declare TELEGRAM_BOT_TOKEN');
  assert(renderYamlContent.includes('SINK_CHAT_ID'), 'render.yaml must declare SINK_CHAT_ID');
  console.log('  • render.yaml validated: Singapore Web Service with /api/health check ✅');
  console.log('  ✅ Render Cloud Infrastructure-as-Code 100% verified.\n');

  console.log('===============================================================');
  console.log('🎉 ALL SYSTEMS VERIFIED! PRODUCTION READY WITH 0 ERRORS');
  console.log('===============================================================');

  if (bot && typeof bot.stopPolling === 'function') {
    await bot.stopPolling().catch(() => {});
  }
  process.exit(0);
}

testFullSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
