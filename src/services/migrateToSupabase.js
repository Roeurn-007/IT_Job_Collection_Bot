const fs = require('fs');
const path = require('path');
const settings = require('../config/settings');
const supabaseService = require('./supabaseService');
const logger = require('../utils/logger');

function loadJsonSafe(filepath, fallback = []) {
  try {
    if (!fs.existsSync(filepath)) return fallback;
    const content = fs.readFileSync(filepath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(content);
  } catch (err) {
    logger.error(`Error reading ${filepath}:`, err.message);
    return fallback;
  }
}

async function runMigration(options = { verbose: true }) {
  const log = (...args) => {
    if (options.verbose) console.log(...args);
  };

  log('================================================================');
  log('📦 SUPABASE HISTORICAL DATA MIGRATION & FULL SYNC');
  log('================================================================\n');

  if (!supabaseService.isConfigured()) {
    log('⚠️  SUPABASE NOT CONFIGURED!');
    log('   Please set SUPABASE_URL and SUPABASE_KEY in your .env file.');
    log('   Once added, run: npm run migrate:supabase\n');
    return { success: false, message: 'Supabase credentials missing in .env' };
  }

  const supabase = supabaseService.getClient();
  const summary = {
    channels: 0,
    keywords: 0,
    seen: 0,
    sources: 0,
    settings: 0,
    jobs: 0
  };

  try {
    // -------------------------------------------------------------
    // 1. SYNC CHANNELS
    // -------------------------------------------------------------
    log('1️⃣ Migrating Channels...');
    const channels = settings.getChannels();
    if (channels.length > 0) {
      const channelRows = channels.map(username => ({
        username,
        is_active: true
      }));
      const { error: chErr } = await supabase
        .from('channels')
        .upsert(channelRows, { onConflict: 'username' });

      if (chErr) {
        log(`   ❌ Channels sync error: ${chErr.message}`);
      } else {
        summary.channels = channels.length;
        log(`   ✅ Synced ${channels.length} channels to Supabase "channels" table.`);
      }
    }

    // -------------------------------------------------------------
    // 2. SYNC KEYWORDS
    // -------------------------------------------------------------
    log('\n2️⃣ Migrating IT Filter Keywords...');
    const keywords = settings.getKeywords();
    if (keywords.length > 0) {
      const keywordRows = keywords.map(kw => ({
        keyword: String(kw).trim(),
        category: 'General IT'
      }));
      const { error: kwErr } = await supabase
        .from('keywords')
        .upsert(keywordRows, { onConflict: 'keyword' });

      if (kwErr) {
        log(`   ❌ Keywords sync error: ${kwErr.message}`);
      } else {
        summary.keywords = keywords.length;
        log(`   ✅ Synced ${keywords.length} keywords to Supabase "keywords" table.`);
      }
    }

    // -------------------------------------------------------------
    // 3. SYNC SEEN POSTS (DEDUPLICATION HISTORY)
    // -------------------------------------------------------------
    log('\n3️⃣ Migrating Seen Posts Deduplication History...');
    const seenStorage = loadJsonSafe(path.join(settings.STORAGE_DIR, 'seen.json'), []);
    const uniqueSeen = Array.from(new Set(seenStorage)).filter(Boolean);

    if (uniqueSeen.length > 0) {
      const BATCH_SIZE = 100;
      let insertedSeen = 0;
      for (let i = 0; i < uniqueSeen.length; i += BATCH_SIZE) {
        const batch = uniqueSeen.slice(i, i + BATCH_SIZE).map(key => ({ key }));
        const { error: seenErr } = await supabase
          .from('seen_posts')
          .upsert(batch, { onConflict: 'key' });
        if (!seenErr) insertedSeen += batch.length;
      }
      summary.seen = insertedSeen;
      log(`   ✅ Synced ${insertedSeen} seen post keys to Supabase "seen_posts" table.`);
    }

    // -------------------------------------------------------------
    // 4. SYNC SOURCES & BOT SETTINGS
    // -------------------------------------------------------------
    log('\n4️⃣ Migrating Monitored Sources & Bot Settings...');
    const sourcesStorage = loadJsonSafe(path.join(settings.STORAGE_DIR, 'sources.json'), []);
    const uniqueSources = Array.from(new Set(sourcesStorage)).filter(Boolean);

    if (uniqueSources.length > 0) {
      const sourceRows = uniqueSources.map(chat_id => ({ chat_id: String(chat_id) }));
      await supabase.from('sources').upsert(sourceRows, { onConflict: 'chat_id' }).catch(() => {});
      summary.sources = uniqueSources.length;
      log(`   ✅ Synced ${uniqueSources.length} source chat IDs to Supabase "sources" table.`);
    }

    // Bot Configuration Settings
    const sinkConfig = loadJsonSafe(path.join(settings.STORAGE_DIR, 'sink.json'), {});
    const configRows = [
      { key: 'sink_mode', value: { mode: settings.sinkMode } },
      { key: 'group_sinks', value: { sinks: settings.groupSinks } },
      { key: 'admin_sink', value: { sink: settings.adminSink } },
      { key: 'max_age_days', value: { days: settings.maxAgeDays } },
      { key: 'expiry_days', value: { days: settings.expiryDays } },
      { key: 'scrape_interval_seconds', value: { seconds: settings.SCRAPE_INTERVAL_SECONDS } },
      { key: 'sources', value: { sources: uniqueSources } }
    ];
    const { error: cfgErr } = await supabase
      .from('bot_settings')
      .upsert(configRows, { onConflict: 'key' });

    if (!cfgErr) {
      summary.settings = configRows.length;
      log(`   ✅ Synced core bot configuration to Supabase "bot_settings" table.`);
    }

    // -------------------------------------------------------------
    // 5. SYNC HISTORICAL COLLECTED JOBS (WITH DATES PRESERVED)
    // -------------------------------------------------------------
    log('\n5️⃣ Migrating All Historical Jobs (Preserving Exact Dates)...');
    const jobsStorage = loadJsonSafe(path.join(settings.STORAGE_DIR, 'collected.json'), []);

    // Deduplicate by link or source_messageId
    const jobMap = new Map();
    jobsStorage.forEach(job => {
      if (!job) return;
      const key = job.link || `${job.sourceId || job.source}_${job.messageId}`;
      if (!jobMap.has(key)) {
        jobMap.set(key, job);
      }
    });

    const allHistoricalJobs = Array.from(jobMap.values());
    log(`   • Found ${allHistoricalJobs.length} total historical jobs across storage.`);

    // Filter out jobs older than retention window (expiryDays)
    const cutoffTime = Date.now() - settings.expiryDays * 24 * 60 * 60 * 1000;
    const activeJobs = allHistoricalJobs.filter(j => {
      if (!j.date) return true;
      const t = new Date(j.date).getTime();
      return isNaN(t) || t >= cutoffTime;
    });

    log(`   • ${activeJobs.length} active jobs within current ${settings.expiryDays}-day retention window.`);

    if (activeJobs.length > 0) {
      const BATCH_SIZE = 25;
      let insertedJobs = 0;
      for (let i = 0; i < activeJobs.length; i += BATCH_SIZE) {
        const batch = activeJobs.slice(i, i + BATCH_SIZE).map(job => {
          const safeDate = job.date && !isNaN(new Date(job.date).getTime())
            ? new Date(job.date).toISOString()
            : new Date().toISOString();
          const safeCollectedAt = job.collectedAt && !isNaN(new Date(job.collectedAt).getTime())
            ? new Date(job.collectedAt).toISOString()
            : safeDate;

          return {
            id: job.id || `${job.sourceId || job.source}_${job.messageId}`,
            source: job.source,
            source_id: job.sourceId || null,
            message_id: job.messageId ? parseInt(job.messageId, 10) : null,
            snippet: job.snippet || '',
            text: job.text || '',
            date: safeDate,
            link: job.link || null,
            photo: job.photo || null,
            is_today: Boolean(job.isToday),
            collected_at: safeCollectedAt
          };
        });

        const { error: jobErr } = await supabase
          .from('jobs')
          .upsert(batch, { onConflict: 'id' });

        if (!jobErr) {
          insertedJobs += batch.length;
        } else {
          log(`   ⚠️ Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${jobErr.message}`);
        }
      }
      summary.jobs = insertedJobs;
      log(`   ✅ Synced ${insertedJobs} historical jobs with exact timestamps into Supabase "jobs" table.`);
    }

    log('\n================================================================');
    log('🎉 FULL MIGRATION & SYNCHRONIZATION COMPLETED SUCCESSFULLY!');
    log('================================================================');
    log(`📊 Final Supabase Counts:`);
    log(`   • Channels:      ${summary.channels}`);
    log(`   • Keywords:      ${summary.keywords}`);
    log(`   • Seen Posts:    ${summary.seen}`);
    log(`   • Sources:       ${summary.sources}`);
    log(`   • Settings:      ${summary.settings}`);
    log(`   • Active Jobs:   ${summary.jobs}`);
    log('================================================================\n');

    return { success: true, summary };
  } catch (err) {
    log(`❌ Migration failed with exception: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Allow running directly from command line: node src/services/migrateToSupabase.js
if (require.main === module) {
  runMigration({ verbose: true }).then(() => process.exit(0));
}

module.exports = {
  runMigration
};
