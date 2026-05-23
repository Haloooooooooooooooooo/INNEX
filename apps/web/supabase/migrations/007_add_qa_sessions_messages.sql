-- Phase 3: sessionized QA

CREATE TABLE qa_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT '新建对话',
  mode             TEXT NOT NULL DEFAULT 'notes',
  pinned_note_id   UUID REFERENCES notes(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE qa_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own qa sessions"   ON qa_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own qa sessions" ON qa_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own qa sessions" ON qa_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own qa sessions" ON qa_sessions FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_qa_sessions_user_updated ON qa_sessions(user_id, updated_at DESC);

CREATE TABLE qa_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          TEXT NOT NULL,
  citations        JSONB DEFAULT '[]',
  trace_id         UUID,
  model            TEXT,
  evidence_level   TEXT NOT NULL DEFAULT 'unknown',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE qa_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own qa messages"   ON qa_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own qa messages" ON qa_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own qa messages" ON qa_messages FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_qa_messages_session_created ON qa_messages(session_id, created_at ASC);
CREATE INDEX idx_qa_messages_user_created ON qa_messages(user_id, created_at DESC);
