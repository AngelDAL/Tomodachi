ALTER TABLE users MODIFY COLUMN role ENUM('super_admin', 'admin', 'manager', 'cashier') NOT NULL;
