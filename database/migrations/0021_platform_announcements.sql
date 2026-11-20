CREATE TABLE IF NOT EXISTS platform_announcements (
  id TEXT PRIMARY KEY,
  title_ar TEXT NOT NULL CHECK(length(trim(title_ar)) BETWEEN 2 AND 160),
  title_en TEXT NOT NULL CHECK(length(trim(title_en)) BETWEEN 2 AND 160),
  message_ar TEXT NOT NULL CHECK(length(trim(message_ar)) BETWEEN 2 AND 1000),
  message_en TEXT NOT NULL CHECK(length(trim(message_en)) BETWEEN 2 AND 1000),
  announcement_type TEXT NOT NULL DEFAULT 'info' CHECK(announcement_type IN ('info','success','warning','urgent')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_public
ON platform_announcements(is_active, starts_at, ends_at, created_at DESC);
