-- =============================================================
-- Supabase Schema for IT Job Collection Bot
-- Run this script in the Supabase SQL Editor (Dashboard > SQL Editor)
-- =============================================================

-- 1. JOBS TABLE: Stores all scraped & forwarded IT job posts
CREATE TABLE IF NOT EXISTS public.jobs (
  id TEXT PRIMARY KEY,                       -- Unique identifier: e.g. "camhrjobs_25066"
  source TEXT NOT NULL,                     -- Channel name/label: e.g. "@camhrjobs"
  source_id TEXT,                           -- Clean username or channel ID
  message_id BIGINT,                        -- Telegram post ID
  snippet TEXT,                             -- Short excerpt for preview
  text TEXT,                                -- Full job post text
  date TIMESTAMPTZ NOT NULL,                -- Publication date of the post
  link TEXT,                                -- Direct Telegram link to the post
  photo JSONB,                              -- Media/photo metadata if available
  is_today BOOLEAN DEFAULT false,           -- True if published on collection day
  collected_at TIMESTAMPTZ DEFAULT NOW(),   -- Timestamp when the bot collected it
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for lightning fast queries and 2-month cleanup
CREATE INDEX IF NOT EXISTS idx_jobs_date ON public.jobs (date DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_source_id ON public.jobs (source_id);
CREATE INDEX IF NOT EXISTS idx_jobs_collected_at ON public.jobs (collected_at DESC);

-- 2. CHANNELS TABLE: Monitored public Telegram channels
CREATE TABLE IF NOT EXISTS public.channels (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,            -- e.g. "camhrjobs", "jobifyworks"
  title TEXT,                               -- Optional display title
  is_active BOOLEAN DEFAULT true,           -- Toggle scraping on/off
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channels_username ON public.channels (username);

-- 3. KEYWORDS TABLE: IT Job filter keywords
CREATE TABLE IF NOT EXISTS public.keywords (
  id BIGSERIAL PRIMARY KEY,
  keyword TEXT UNIQUE NOT NULL,             -- e.g. "software engineer", "frontend"
  category TEXT DEFAULT 'General IT',       -- Optional category tag
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SEEN POSTS TABLE: Deduplication tracker
CREATE TABLE IF NOT EXISTS public.seen_posts (
  key TEXT PRIMARY KEY,                     -- e.g. "camhrjobs_25066"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. BOT SETTINGS TABLE: Central configuration
CREATE TABLE IF NOT EXISTS public.bot_settings (
  key TEXT PRIMARY KEY,                     -- e.g. "sink_chat_id", "max_age_days"
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SOURCES TABLE: Monitored group / channel chat IDs
CREATE TABLE IF NOT EXISTS public.sources (
  chat_id TEXT PRIMARY KEY,                 -- e.g. "-1001197691723"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- 7. AUTOMATIC 2-MONTH EXPIRATION FUNCTION
-- Automatically purges jobs older than 60 days (2 months).
-- Note: Messages in Telegram channels/groups are NOT deleted!
-- Only removed from the database and web dashboard.
-- =============================================================
CREATE OR REPLACE FUNCTION public.purge_expired_jobs(days_threshold INT DEFAULT 60)
RETURNS INT AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM public.jobs
  WHERE date < (NOW() - (days_threshold || ' days')::INTERVAL)
     OR (date IS NULL AND collected_at < (NOW() - (days_threshold || ' days')::INTERVAL));
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- Allows public dashboard read access and bot service/anon write
-- =============================================================
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seen_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

-- Allow read access to anyone (for web dashboard)
CREATE POLICY "Public Read Jobs" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Public Read Channels" ON public.channels FOR SELECT USING (true);
CREATE POLICY "Public Read Keywords" ON public.keywords FOR SELECT USING (true);

-- Allow bot full access using API keys
CREATE POLICY "Bot Full Access Jobs" ON public.jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Bot Full Access Channels" ON public.channels FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Bot Full Access Keywords" ON public.keywords FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Bot Full Access Seen" ON public.seen_posts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Bot Full Access Settings" ON public.bot_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Bot Full Access Sources" ON public.sources FOR ALL USING (true) WITH CHECK (true);
