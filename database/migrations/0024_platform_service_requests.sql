-- MMG OQVELA
-- Migration 0024: Public contact and service request inbox

CREATE TABLE platform_service_requests (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL CHECK (
    request_type IN ('support','advertising','store_setup','website_design','contact')
  ),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new','reviewing','accepted','rejected','completed')
  ),
  admin_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_platform_service_requests_status_created
  ON platform_service_requests(status, created_at DESC);

CREATE INDEX idx_platform_service_requests_type_created
  ON platform_service_requests(request_type, created_at DESC);
