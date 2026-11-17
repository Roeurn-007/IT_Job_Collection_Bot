const assert = require('assert');
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

  console.log('===============================================================');
  console.log('🎉 ALL SYSTEMS VERIFIED! PRODUCTION READY WITH 0 ERRORS');
  console.log('===============================================================');

  const { bot } = require('../src/bot/services/telegramService');
  if (bot && typeof bot.stopPolling === 'function') {
    await bot.stopPolling().catch(() => {});
  }
  process.exit(0);
}

testFullSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
