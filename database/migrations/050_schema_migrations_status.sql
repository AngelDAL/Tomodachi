-- =============================================================
-- 050 — La tabla de control de migraciones distingue `applied` / `baseline` / `failed`
-- =============================================================
--
-- Hallazgo 2 de TAB-11: `docker/entrypoint.sh` registraba la migración fallida con
-- `INSERT IGNORE`, así que la fila quedaba INDISTINGUIBLE de una aplicada y el arranque
-- siguiente la saltaba: desfase permanente y silencioso. Desde TAB-39 el entrypoint
-- (docker/migrations.sh) escribe el desenlace, y para eso la tabla necesita columnas:
--
--   status          'applied'  = se ejecutó con éxito
--                   'baseline' = ya venía en database/schema.sql (primer arranque)
--                   'failed'   = falló; `error_text` dice por qué
--   error_text      stderr del cliente `mysql`, recortado a 2000 caracteres
--   attempts        cuántas veces se intentó (el entrypoint reintenta hasta
--                   MIGRATION_MAX_ATTEMPTS, default 3)
--   last_attempt_at cuándo fue el último intento
--
-- LAS FILAS QUE YA EXISTEN QUEDAN EN 'applied' (el DEFAULT): es lo ÚNICO que se puede
-- afirmar de ellas. No se inventa historia ni se marcan como baseline, porque no se sabe
-- si se ejecutaron o venían del schema.sql.
--
-- IDEMPOTENTE Y PORTABLE (mariadb:10.11 y MySQL 8): la guarda es
-- `information_schema.columns` + `PREPARE/EXECUTE`, así que correrla dos veces no falla
-- con "Duplicate column name" (que es justo el caso típico de ejecución manual). El
-- entrypoint hace lo mismo por su lado (`migrations_ensure_columns`), porque el arranque
-- no puede depender de que esta migración llegue a correr.
--
-- ROLLBACK: revertir `docker/entrypoint.sh` y `docker/migrations.sh`; las columnas son
-- aditivas y nadie más las exige `NOT NULL` sin default. Borrarlas sería destructivo
-- sobre metadatos (se perdería qué migró y qué no) → solo con autorización explícita.

-- Si la tabla no existe todavía (instalación manual en Hostinger), no hay nada que
-- hacer: la crea el entrypoint con la forma nueva.
SET @tabla := IF(
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'schema_migrations') > 0,
  'schema_migrations',
  NULL
);

SET @sql := IF(@tabla IS NULL OR (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' AND column_name = 'status') > 0,
  'DO 0',
  "ALTER TABLE `schema_migrations` ADD COLUMN `status` ENUM('applied','baseline','failed') NOT NULL DEFAULT 'applied' AFTER applied_at");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@tabla IS NULL OR (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' AND column_name = 'error_text') > 0,
  'DO 0',
  "ALTER TABLE `schema_migrations` ADD COLUMN `error_text` TEXT NULL AFTER `status`");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@tabla IS NULL OR (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' AND column_name = 'attempts') > 0,
  'DO 0',
  "ALTER TABLE `schema_migrations` ADD COLUMN `attempts` INT NOT NULL DEFAULT 0 AFTER `error_text`");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@tabla IS NULL OR (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' AND column_name = 'last_attempt_at') > 0,
  'DO 0',
  "ALTER TABLE `schema_migrations` ADD COLUMN `last_attempt_at` DATETIME NULL AFTER `attempts`");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- El estado se consulta por migración fallida (ready.php → `degraded`) y por estado.
SET @sql := IF(@tabla IS NULL OR (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' AND index_name = 'idx_schema_migrations_status') > 0,
  'DO 0',
  "ALTER TABLE `schema_migrations` ADD KEY `idx_schema_migrations_status` (`status`)");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
