
USE tomodachi_pos;
ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL AFTER email;
ALTER TABLE stores ADD COLUMN theme_config TEXT NULL AFTER address;
ALTER TABLE stores ADD COLUMN logo_url VARCHAR(255) NULL AFTER theme_config;
