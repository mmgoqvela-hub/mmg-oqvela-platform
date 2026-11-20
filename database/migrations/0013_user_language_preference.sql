-- MMG OQVELA
-- Migration 0013: Persist each user's preferred interface language.

ALTER TABLE users
ADD COLUMN preferred_language TEXT NOT NULL DEFAULT 'ar'
CHECK (preferred_language IN ('ar', 'en'));
