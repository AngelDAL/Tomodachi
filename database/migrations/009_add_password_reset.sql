ALTER TABLE users
ADD COLUMN reset_token_hash VARCHAR(255) NULL AFTER show_onboarding,
ADD COLUMN reset_token_expires_at DATETIME NULL AFTER reset_token_hash;
