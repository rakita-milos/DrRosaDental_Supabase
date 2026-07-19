SET search_path TO app, public;

ALTER TABLE codebook_items
  ADD COLUMN IF NOT EXISTS price_currency TEXT NOT NULL DEFAULT 'EUR';

ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';
