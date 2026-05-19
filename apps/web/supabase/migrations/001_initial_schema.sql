-- Phase 1: profiles + capture_items + attachments + RLS

-- Profiles table (auto-created via trigger on auth.users insert)
CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username   TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Capture items
CREATE TABLE capture_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL DEFAULT 'text',
  title            TEXT NOT NULL,
  source           TEXT NOT NULL,
  source_url       TEXT,
  raw_content      TEXT,
  my_understanding TEXT,
  summary          TEXT,
  status           TEXT NOT NULL DEFAULT 'later',
  tags             TEXT[] DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE capture_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own items"    ON capture_items FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own items"  ON capture_items FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own items"  ON capture_items FOR UPDATE  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own items"  ON capture_items FOR DELETE  USING (auth.uid() = user_id);

CREATE INDEX idx_capture_items_user_id ON capture_items(user_id);
CREATE INDEX idx_capture_items_status ON capture_items(status);
CREATE INDEX idx_capture_items_created_at ON capture_items(created_at DESC);

-- Attachments
CREATE TABLE attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_item_id  UUID REFERENCES capture_items(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name        TEXT NOT NULL,
  file_type        TEXT NOT NULL,
  file_size        BIGINT,
  storage_path     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own attachments"   ON attachments FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own attachments" ON attachments FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own attachments" ON attachments FOR DELETE  USING (auth.uid() = user_id);

CREATE INDEX idx_attachments_capture_item_id ON attachments(capture_item_id);
