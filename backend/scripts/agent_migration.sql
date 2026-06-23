-- ════════════════════════════════════════════════════════
--  Agent tables migration
--  Run after schema.sql
-- ════════════════════════════════════════════════════════

-- ── agent_sessions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'New conversation',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_sessions_user ON agent_sessions(user_id);

CREATE TRIGGER agent_sessions_updated_at
    BEFORE UPDATE ON agent_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── agent_messages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
    content         TEXT NOT NULL,
    tool_name       TEXT,
    tool_call_id    TEXT,
    tokens          INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_messages_session    ON agent_messages(session_id);
CREATE INDEX idx_agent_messages_session_ts ON agent_messages(session_id, created_at DESC);

-- ── agent_summaries ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_summaries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    summary             TEXT NOT NULL,
    message_count       INTEGER NOT NULL,
    up_to_message_id    TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_summaries_session ON agent_summaries(session_id, created_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE agent_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_sessions: owner"  ON agent_sessions  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "agent_messages: owner"  ON agent_messages  FOR ALL
    USING (session_id IN (SELECT id FROM agent_sessions WHERE user_id = auth.uid()));
CREATE POLICY "agent_summaries: owner" ON agent_summaries FOR ALL
    USING (session_id IN (SELECT id FROM agent_sessions WHERE user_id = auth.uid()));

-- ── user_tool_connections ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_tool_connections (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_name                TEXT NOT NULL,
    connected_account_id    TEXT,
    status                  TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','disconnected','error')),
    connected_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disconnected_at         TIMESTAMPTZ,
    UNIQUE(user_id, app_name)
);

CREATE INDEX idx_user_tool_connections_user ON user_tool_connections(user_id, status);

ALTER TABLE user_tool_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tool_connections: owner" ON user_tool_connections
    FOR ALL USING (auth.uid() = user_id);
