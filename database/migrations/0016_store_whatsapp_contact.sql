-- MMG OQVELA
-- Migration 0016: Store WhatsApp contact details

ALTER TABLE stores
ADD COLUMN whatsapp_phone TEXT;
