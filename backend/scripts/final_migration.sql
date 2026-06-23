-- ════════════════════════════════════════════════════════
--  Final migrations — preferences + analytics
--  Run after schema.sql and agent_migration.sql
-- ════════════════════════════════════════════════════════

-- ── user_preferences ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    agent_instructions      TEXT,
    agent_tone              TEXT NOT NULL DEFAULT 'professional'
                                CHECK (agent_tone IN ('professional','casual','concise','detailed')),
    auto_execute_safe_tools BOOLEAN NOT NULL DEFAULT TRUE,
    confirm_before_send     BOOLEAN NOT NULL DEFAULT TRUE,
    timezone                TEXT NOT NULL DEFAULT 'UTC',
    work_start_hour         INTEGER NOT NULL DEFAULT 9 CHECK (work_start_hour BETWEEN 0 AND 23),
    work_end_hour           INTEGER NOT NULL DEFAULT 18 CHECK (work_end_hour BETWEEN 0 AND 23),
    work_days               INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4],
    daily_digest_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    daily_digest_time       TEXT NOT NULL DEFAULT '08:00',
    digest_channels         TEXT[] NOT NULL DEFAULT ARRAY['gmail','googlecalendar'],
    email_notifications     BOOLEAN NOT NULL DEFAULT TRUE,
    language                TEXT NOT NULL DEFAULT 'en',
    response_language       TEXT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preferences: owner" ON user_preferences
    FOR ALL USING (auth.uid() = user_id);


-- ── agent_tool_logs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_tool_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    tool_name       TEXT NOT NULL,
    success         BOOLEAN NOT NULL DEFAULT TRUE,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    provider        TEXT NOT NULL DEFAULT 'gemini',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_logs_session   ON agent_tool_logs(session_id);
CREATE INDEX idx_tool_logs_tool_name ON agent_tool_logs(tool_name);
CREATE INDEX idx_tool_logs_created   ON agent_tool_logs(created_at DESC);

ALTER TABLE agent_tool_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tool_logs: session owner" ON agent_tool_logs
    FOR ALL USING (
        session_id IN (
            SELECT id FROM agent_sessions WHERE user_id = auth.uid()
        )
    );


-- ── Helpful view: per-user usage summary ──────────────────────────────────────
CREATE OR REPLACE VIEW user_usage_30d AS
SELECT
    s.user_id,
    COUNT(DISTINCT s.id)                                    AS sessions,
    COUNT(m.id)                                             AS messages,
    COALESCE(SUM(m.tokens), 0)                              AS total_tokens,
    COUNT(tl.id)                                            AS tool_calls,
    COUNT(tl.id) FILTER (WHERE tl.success = FALSE)         AS tool_errors
FROM agent_sessions s
LEFT JOIN agent_messages  m  ON m.session_id  = s.id
    AND m.created_at > NOW() - INTERVAL '30 days'
LEFT JOIN agent_tool_logs tl ON tl.session_id = s.id
    AND tl.created_at > NOW() - INTERVAL '30 days'
WHERE s.created_at > NOW() - INTERVAL '30 days'
GROUP BY s.user_id;
