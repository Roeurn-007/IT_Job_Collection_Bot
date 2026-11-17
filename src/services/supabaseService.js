const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase = null;
let isConnected = false;

function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    logger.info('Supabase: SUPABASE_URL or SUPABASE_KEY not configured in .env. Operating with local storage.');
    return null;
  }

  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
    isConnected = true;
    logger.info(`Supabase: Client connected to ${SUPABASE_URL}`);
    return supabase;
  } catch (err) {
    logger.error('Supabase: Initialization error:', err.message);
    isConnected = false;
    return null;
  }
}

// Initialize on module load
initSupabase();

function getClient() {
  if (!supabase && SUPABASE_URL && SUPABASE_KEY) {
    return initSupabase();
  }
  return supabase;
}

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY && supabase);
}

function parseSafeIsoDate(val, fallback = null) {
  if (val) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (fallback) {
    const d = new Date(fallback);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// -------------------------------------------------------------
// Job Operations
// -------------------------------------------------------------

async function upsertJob(job) {
  if (!isConfigured() || !job) return null;

  try {
    const record = {
      id: job.id || `${job.sourceId || job.source}_${job.messageId}`,
      source: job.source,
      source_id: job.sourceId || null,
      message_id: job.messageId ? parseInt(job.messageId, 10) : null,
      snippet: job.snippet || '',
      text: job.text || '',
      date: parseSafeIsoDate(job.date, job.collectedAt),
      link: job.link || null,
      photo: job.photo || null,
      is_today: Boolean(job.isToday),
      collected_at: parseSafeIsoDate(job.collectedAt, job.date)
    };

    const { data, error } = await supabase
      .from('jobs')
      .upsert(record, { onConflict: 'id' });

    if (error) {
      logger.error('Supabase: Failed to upsert job:', error.message);
      return null;
    }
    return record;
  } catch (err) {
    logger.error('Supabase: upsertJob exception:', err.message);
    return null;
  }
}

async function fetchJobsFromSupabase(limit = 300, maxAgeDays = 60) {
  if (!isConfigured()) return null;

  try {
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    let query = supabase
      .from('jobs')
      .select('*')
      .gte('date', cutoffDate)
      .order('date', { ascending: false });

    if (limit && typeof limit === 'number') {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) {
      logger.error('Supabase: Failed to fetch jobs:', error.message);
      return null;
    }

    return (data || []).map(row => ({
      id: row.id,
      source: row.source,
      sourceId: row.source_id,
      messageId: row.message_id ? parseInt(row.message_id, 10) : null,
      snippet: row.snippet,
      text: row.text,
      date: parseSafeIsoDate(row.date),
      link: row.link,
      photo: row.photo,
      isToday: row.is_today,
      collectedAt: parseSafeIsoDate(row.collected_at)
    }));
  } catch (err) {
    logger.error('Supabase: fetchJobs exception:', err.message);
    return null;
  }
}

// Remove jobs older than 60 days (2 months) from database
async function deleteExpiredJobsFromSupabase(maxAgeDays = 60) {
  if (!isConfigured()) return 0;

  try {
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('jobs')
      .delete({ count: 'exact' })
      .lt('date', cutoffDate);

    if (error) {
      logger.error('Supabase: Failed to delete expired jobs:', error.message);
      return 0;
    }

    const removed = count || 0;
    if (removed > 0) {
      logger.info(`Supabase: Automatically removed ${removed} expired jobs (> ${maxAgeDays} days) from database.`);
    }
    return removed;
  } catch (err) {
    logger.error('Supabase: deleteExpiredJobs exception:', err.message);
    return 0;
  }
}

// -------------------------------------------------------------
// Channel Operations
// -------------------------------------------------------------

async function syncChannelsToSupabase(channelsList) {
  if (!isConfigured() || !Array.isArray(channelsList)) return false;

  try {
    const rows = channelsList.map(username => ({ username }));
    const { error } = await supabase
      .from('channels')
      .upsert(rows, { onConflict: 'username' });

    if (error) {
      logger.error('Supabase: Failed to sync channels:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Supabase: syncChannels exception:', err.message);
    return false;
  }
}

async function fetchChannelsFromSupabase() {
  if (!isConfigured()) return null;

  try {
    const { data, error } = await supabase
      .from('channels')
      .select('username')
      .order('username', { ascending: true });

    if (error) {
      logger.error('Supabase: Failed to fetch channels:', error.message);
      return null;
    }
    return (data || []).map(r => r.username);
  } catch (err) {
    logger.error('Supabase: fetchChannels exception:', err.message);
    return null;
  }
}

async function addChannelToSupabase(username) {
  if (!isConfigured() || !username) return false;

  try {
    const { error } = await supabase
      .from('channels')
      .upsert({ username }, { onConflict: 'username' });

    if (error) {
      logger.error('Supabase: Failed to add channel:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Supabase: addChannel exception:', err.message);
    return false;
  }
}

async function removeChannelFromSupabase(username) {
  if (!isConfigured() || !username) return false;

  try {
    const { error } = await supabase
      .from('channels')
      .delete()
      .eq('username', username);

    if (error) {
      logger.error('Supabase: Failed to remove channel:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Supabase: removeChannel exception:', err.message);
    return false;
  }
}

// -------------------------------------------------------------
// Keywords Operations
// -------------------------------------------------------------

async function syncKeywordsToSupabase(keywordsList) {
  if (!isConfigured() || !Array.isArray(keywordsList)) return false;

  try {
    const rows = keywordsList.map(keyword => ({ keyword }));
    const { error } = await supabase
      .from('keywords')
      .upsert(rows, { onConflict: 'keyword' });

    if (error) {
      logger.error('Supabase: Failed to sync keywords:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Supabase: syncKeywords exception:', err.message);
    return false;
  }
}

async function fetchKeywordsFromSupabase() {
  if (!isConfigured()) return null;

  try {
    const { data, error } = await supabase
      .from('keywords')
      .select('keyword')
      .order('keyword', { ascending: true });

    if (error) {
      logger.error('Supabase: Failed to fetch keywords:', error.message);
      return null;
    }
    return (data || []).map(r => r.keyword);
  } catch (err) {
    logger.error('Supabase: fetchKeywords exception:', err.message);
    return null;
  }
}

// -------------------------------------------------------------
// Seen Posts Deduplication in Supabase
// -------------------------------------------------------------

async function markSeenInSupabase(key) {
  if (!isConfigured() || !key) return;

  try {
    await supabase.from('seen_posts').upsert({ key }, { onConflict: 'key' });
  } catch (_) {}
}

async function fetchSeenFromSupabase(limit = 5000) {
  if (!isConfigured()) return null;

  try {
    const { data, error } = await supabase
      .from('seen_posts')
      .select('key')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return null;
    return (data || []).map(r => r.key);
  } catch (_) {
    return null;
  }
}

// -------------------------------------------------------------
// Health / Status Check
// -------------------------------------------------------------

async function getSupabaseStatus() {
  if (!isConfigured()) {
    return {
      connected: false,
      configured: false,
      message: 'Supabase credentials not configured in .env'
    };
  }

  try {
    const { count, error } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return {
        connected: false,
        configured: true,
        error: error.message
      };
    }

    return {
      connected: true,
      configured: true,
      jobsCount: count || 0,
      url: SUPABASE_URL
    };
  } catch (err) {
    return {
      connected: false,
      configured: true,
      error: err.message
    };
  }
}

module.exports = {
  getClient,
  isConfigured,
  upsertJob,
  fetchJobsFromSupabase,
  deleteExpiredJobsFromSupabase,
  syncChannelsToSupabase,
  fetchChannelsFromSupabase,
  addChannelToSupabase,
  removeChannelFromSupabase,
  syncKeywordsToSupabase,
  fetchKeywordsFromSupabase,
  markSeenInSupabase,
  fetchSeenFromSupabase,
  getSupabaseStatus
};
