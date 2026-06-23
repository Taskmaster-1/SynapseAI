-- ════════════════════════════════════════════════════════
--  SaaS Backend – Supabase Schema
--  Run in Supabase SQL Editor or via supabase/migrations
-- ════════════════════════════════════════════════════════

-- Enable UUID extension (already enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   TEXT UNIQUE NOT NULL,
    hashed_password         TEXT NOT NULL,
    full_name               TEXT NOT NULL,
    avatar_url              TEXT,

    -- Stripe / Billing
    stripe_customer_id      TEXT UNIQUE,
    stripe_subscription_id  TEXT,
    subscription_status     TEXT NOT NULL DEFAULT 'free'
                                CHECK (subscription_status IN
                                    ('free','active','trialing','past_due','canceled','unpaid')),
    subscription_plan       TEXT,
    subscription_period_end TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── files ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename        TEXT,
    content_type    TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    storage_path    TEXT NOT NULL,
    url             TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_files_user_id ON files(user_id);

-- ── notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'info'
                    CHECK (type IN ('info','success','warning','error')),
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id       ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread   ON notifications(user_id) WHERE is_read = FALSE;

-- ── Row Level Security ────────────────────────────────────────────────────────
-- (Enable RLS on all tables; server uses service-role key and bypasses RLS)

ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE files          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications  ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own row
CREATE POLICY "users: self read"   ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users: self update" ON users FOR UPDATE USING (auth.uid() = id);

-- Files belong to owner
CREATE POLICY "files: owner access" ON files
    FOR ALL USING (auth.uid() = user_id);

-- Notifications belong to owner
CREATE POLICY "notifications: owner access" ON notifications
    FOR ALL USING (auth.uid() = user_id);
