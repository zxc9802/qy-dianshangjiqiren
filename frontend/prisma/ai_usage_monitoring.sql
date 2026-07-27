ALTER TABLE users
ADD COLUMN IF NOT EXISTS billing_audience text NOT NULL DEFAULT 'external',
ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

ALTER TABLE video_usage_logs
ADD COLUMN IF NOT EXISTS app_id text,
ADD COLUMN IF NOT EXISTS request_id text,
ADD COLUMN IF NOT EXISTS input_tokens bigint,
ADD COLUMN IF NOT EXISTS cached_input_tokens bigint,
ADD COLUMN IF NOT EXISTS output_tokens bigint,
ADD COLUMN IF NOT EXISTS reasoning_tokens bigint,
ADD COLUMN IF NOT EXISTS total_tokens bigint,
ADD COLUMN IF NOT EXISTS usage_source text,
ADD COLUMN IF NOT EXISTS billing_audience text NOT NULL DEFAULT 'external',
ADD COLUMN IF NOT EXISTS upstream_cost_usd numeric(18, 8),
ADD COLUMN IF NOT EXISTS upstream_cost_cny numeric(18, 8),
ADD COLUMN IF NOT EXISTS group_multiplier numeric(10, 4),
ADD COLUMN IF NOT EXISTS sale_multiplier numeric(10, 4),
ADD COLUMN IF NOT EXISTS cost_credits bigint,
ADD COLUMN IF NOT EXISTS charged_credits bigint,
ADD COLUMN IF NOT EXISTS billing_unit text,
ADD COLUMN IF NOT EXISTS billable_units numeric(18, 4),
ADD COLUMN IF NOT EXISTS price_version text;

-- Accounts and usage records present before external billing goes live belong
-- to the internal team. The marker makes this backfill run only once; accounts
-- and usage records created afterwards keep their real billing audience.
WITH first_billing_audience_backfill AS (
    INSERT INTO system_settings (key, value, created_at, updated_at)
    VALUES ('ai_usage_billing_audience_backfill_v1', NOW()::text, NOW(), NOW())
    ON CONFLICT (key) DO NOTHING
    RETURNING key
),
backfilled_users AS (
    UPDATE users
    SET billing_audience = 'internal'
    WHERE billing_audience <> 'internal'
      AND EXISTS (SELECT 1 FROM first_billing_audience_backfill)
    RETURNING id
),
backfilled_usage_logs AS (
    UPDATE video_usage_logs
    SET billing_audience = 'internal'
    WHERE billing_audience <> 'internal'
      AND EXISTS (SELECT 1 FROM first_billing_audience_backfill)
    RETURNING id
)
SELECT
    (SELECT COUNT(*) FROM backfilled_users) AS users_backfilled,
    (SELECT COUNT(*) FROM backfilled_usage_logs) AS usage_logs_backfilled;

UPDATE users
SET billing_audience = 'internal'
WHERE role = 'admin' AND billing_audience <> 'internal';

CREATE INDEX IF NOT EXISTS idx_usage_logs_app_created_at
ON video_usage_logs (app_id, created_at);

DROP INDEX IF EXISTS idx_usage_logs_channel_request_id;

CREATE UNIQUE INDEX idx_usage_logs_channel_request_id
ON video_usage_logs (channel, request_id);
