-- ============================================================
-- 035: Cambio obligatorio de la contraseña inicial
-- ============================================================
-- Añade users.must_change_password: si vale 1, el usuario debe cambiar su
-- contraseña antes de poder usar el sistema. Se marca la cuenta "admin"
-- creada con la contraseña por defecto "admin123" (solo si todavía tiene
-- esa contraseña; si ya fue cambiada, no se toca).
--
-- Nota: ALTER TABLE ... ADD COLUMN no es idempotente; si la columna ya
-- existe, el entrypoint registra la migración como aplicada y continúa.

ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER reset_token_expires_at;

UPDATE users
   SET must_change_password = 1
 WHERE username = 'admin'
   AND password_hash = '$2y$10$rDGCkOinf6RJ2ywtMU6QYeeTNkqq4/soMpsxdF4wO9lqIRTrjfP2a';
