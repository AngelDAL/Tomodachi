-- Promotions v2: NxM volume deals, quantities per bundle target, and reusable product labels.
CREATE TABLE IF NOT EXISTS product_tags (
    tag_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(80) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_product_tag_store_name (store_id, name),
    INDEX idx_product_tags_store (store_id),
    CONSTRAINT fk_product_tags_store FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_tag_assignments (
    product_id INT NOT NULL,
    tag_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, tag_id),
    CONSTRAINT fk_product_tag_assignment_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    CONSTRAINT fk_product_tag_assignment_tag FOREIGN KEY (tag_id) REFERENCES product_tags(tag_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS bulk_pay_quantity INT NOT NULL DEFAULT 0 AFTER min_quantity;

ALTER TABLE promotion_targets
    ADD COLUMN IF NOT EXISTS tag_id INT NULL AFTER category_id,
    ADD COLUMN IF NOT EXISTS required_quantity INT NOT NULL DEFAULT 1 AFTER tag_id,
    ADD INDEX IF NOT EXISTS idx_promotion_targets_tag (tag_id),
    ADD CONSTRAINT fk_promotion_targets_tag FOREIGN KEY (tag_id) REFERENCES product_tags(tag_id) ON DELETE CASCADE;
