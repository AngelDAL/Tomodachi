-- Create terminals table
CREATE TABLE IF NOT EXISTS terminals (
    terminal_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    terminal_name VARCHAR(50) NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add terminal_id to cash_registers if not exists
SET @dbname = DATABASE();
SET @tablename = "cash_registers";
SET @columnname = "terminal_id";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE cash_registers ADD COLUMN terminal_id INT NULL AFTER store_id;"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add constraint if not exists (This is trickier in pure SQL without stored procedures, 
-- but for this environment we can assume it might fail if exists or we can just try to add it. 
-- A safer way for migrations is usually to just run it and ignore specific errors, or check first.
-- For simplicity in this context, I will add the constraint directly. If it fails, it fails.)
-- ALTER TABLE cash_registers ADD CONSTRAINT fk_register_terminal FOREIGN KEY (terminal_id) REFERENCES terminals(terminal_id) ON DELETE SET NULL;

-- Insert default terminal for existing stores (only if they don't have one)
INSERT INTO terminals (store_id, terminal_name)
SELECT s.store_id, 'Caja Principal'
FROM stores s
WHERE NOT EXISTS (SELECT 1 FROM terminals t WHERE t.store_id = s.store_id);

-- Update existing cash_registers to link to the new default terminal
UPDATE cash_registers cr
JOIN terminals t ON cr.store_id = t.store_id
SET cr.terminal_id = t.terminal_id
WHERE cr.terminal_id IS NULL;

-- Now add the constraint safely
SET @dbname = DATABASE();
SET @tablename = "cash_registers";
SET @constraintname = "fk_register_terminal";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (constraint_name = @constraintname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE cash_registers ADD CONSTRAINT fk_register_terminal FOREIGN KEY (terminal_id) REFERENCES terminals(terminal_id) ON DELETE SET NULL;"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
