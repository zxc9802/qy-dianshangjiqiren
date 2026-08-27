ALTER TABLE points_transactions
ADD COLUMN IF NOT EXISTS reference_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS points_transactions_reference_key_key
ON points_transactions(reference_key)
WHERE reference_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS points_transactions_user_id_created_at_idx
ON points_transactions(user_id, created_at DESC);
