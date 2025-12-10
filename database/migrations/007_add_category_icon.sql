-- Add icon_class to categories for category icons
ALTER TABLE categories
    ADD COLUMN icon_class VARCHAR(80) NULL AFTER description;
