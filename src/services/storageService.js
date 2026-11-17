const settings = require('../config/settings');
const { COLLECTED_FILE, readJson, writeJson } = settings;
const supabaseService = require('./supabaseService');
const logger = require('../utils/logger');

let collected = readJson(COLLECTED_FILE, []);

function getExpiryDays() {
  return settings.expiryDays || 60;
}

// Helper to check if a job is expired (> expiryDays, default from settings)
function isJobExpired(job, maxDays = null) {
  const days = (typeof maxDays === 'number' && maxDays > 0) ? maxDays : getExpiryDays();
  if (!job || !job.date) return false;
  const postDate = new Date(job.date).getTime();
  if (isNaN(postDate)) return false;
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
  return postDate < cutoffTime;
}

// Get non-expired jobs (always purges jobs older than expiryDays from web & responses)
function getCollectedJobs(limit = null) {
  const activeJobs = collected.filter(j => !isJobExpired(j));
  if (limit && typeof limit === 'number') {
    return activeJobs.slice().reverse().slice(0, limit);
  }
  return activeJobs;
}

function addJob(job) {
  if (!job) return;

  // If the job is already older than expiryDays, skip storing
  if (isJobExpired(job)) return;

  // Prevent duplicate insertion by link, id, or messageId
  const exists = collected.some(
    j => (j.link && job.link && j.link === job.link) ||
         (j.source === job.source && j.messageId === job.messageId) ||
         (j.id && job.id && j.id === job.id)
  );

  if (!exists) {
    collected.push(job);
    saveCollected();

    // Async save to Supabase
    if (supabaseService.isConfigured()) {
      supabaseService.upsertJob(job).catch(err => {
        logger.error('Failed to sync job to Supabase:', err.message);
      });
    }
  }
}

function saveCollected() {
  // Save non-expired jobs (keep up to 2000 jobs)
  const activeJobs = collected.filter(j => !isJobExpired(j));
  writeJson(COLLECTED_FILE, activeJobs.slice(-2000));
}

function getCollectedCount() {
  return collected.filter(j => !isJobExpired(j)).length;
}

// Auto-purge jobs older than expiryDays (customizable from bot chat)
// NOTE: Only removes from database and web dashboard. Telegram messages are KEPT!
async function purgeExpiredJobs(maxDays = null) {
  const days = (typeof maxDays === 'number' && maxDays > 0) ? maxDays : getExpiryDays();
  logger.info(`Running auto-cleanup for jobs older than ${days} days...`);

  // 1. Purge from Supabase
  let supabaseDeleted = 0;
  if (supabaseService.isConfigured()) {
    supabaseDeleted = await supabaseService.deleteExpiredJobsFromSupabase(days);
  }

  // 2. Purge from local storage / memory
  const initialCount = collected.length;
  collected = collected.filter(j => !isJobExpired(j, days));
  const localDeleted = initialCount - collected.length;

  if (localDeleted > 0) {
    saveCollected();
    logger.info(`Cleaned ${localDeleted} expired jobs (> ${days} days) from local database & web.`);
  } else {
    logger.info(`Local database clean: no expired jobs found.`);
  }

  return { localDeleted, supabaseDeleted, days };
}

// Startup initialization & sync
async function initStorage() {
  // 1. Initial cleanup of expired jobs
  await purgeExpiredJobs();

  // 2. If Supabase is connected, automatically migrate and sync all historical data
  if (supabaseService.isConfigured()) {
    try {
      const migrate = require('./migrateToSupabase');
      await migrate.runMigration({ verbose: false });
      logger.info('Supabase: All historical data (channels, keywords, seen posts, settings, jobs) synchronized successfully.');
    } catch (err) {
      logger.error('Error synchronizing all data with Supabase:', err.message);
    }
  }

  // 3. Schedule recurring cleanup every 6 hours
  setInterval(() => {
    purgeExpiredJobs().catch(err => {
      logger.error('Scheduled job expiration cleanup error:', err.message);
    });
  }, 6 * 60 * 60 * 1000);
}

module.exports = {
  get collected() { return collected; },
  set collected(val) { collected = val; },
  getCollectedJobs,
  addJob,
  saveCollected,
  getCollectedCount,
  purgeExpiredJobs,
  initStorage,
  isJobExpired,
  getExpiryDays
};
