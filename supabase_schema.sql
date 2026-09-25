-- ====================================================================
-- SoundVault — Supabase Database Setup Script
-- ====================================================================
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/kgtlhjwsheiholowfebj/sql
-- ====================================================================

-- 1. Create the tracks table
CREATE TABLE IF NOT EXISTS public.tracks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    duration FLOAT DEFAULT 0,
    thumbnail TEXT,
    audio_url TEXT NOT NULL,
    source_url TEXT,
    filesize BIGINT DEFAULT 0,
    created_at DOUBLE PRECISION DEFAULT EXTRACT(EPOCH FROM NOW())
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

-- 3. Create permissive access policy for SoundVault
DROP POLICY IF EXISTS "Allow all for SoundVault" ON public.tracks;
CREATE POLICY "Allow all for SoundVault" ON public.tracks
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 4. Create the playlists table
CREATE TABLE IF NOT EXISTS public.playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    track_ids TEXT[] DEFAULT '{}',
    created_at DOUBLE PRECISION DEFAULT EXTRACT(EPOCH FROM NOW())
);

-- 5. Enable Row Level Security (RLS) for playlists
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

-- 6. Create permissive access policy for playlists
DROP POLICY IF EXISTS "Allow all for playlists" ON public.playlists;
CREATE POLICY "Allow all for playlists" ON public.playlists
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Done! Your Supabase database is now configured to store track and playlist metadata.
