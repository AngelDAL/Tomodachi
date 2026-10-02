-- =============================================
-- Migración 049: cola de impresión ESC/POS
-- =============================================
-- Hasta hoy la impresora de cocina era una SUGERENCIA: la salida `kind='print'`
-- de una estación guardaba un nombre libre (`target`) que nadie consumía, la
-- impresión la hacía el NAVEGADOR (`window.print()` en public/js/comandas.js) y
-- `printed_count` subía solo si el mesero aceptaba un diálogo. Si cocina nunca
-- vio el ticket, nadie se enteraba.
--
-- Esta migración abre el camino del servidor: la salida aprende a tener RUTA,
-- nace la cola (`print_jobs`) y la comanda aprende a decir si su ticket salió.
--
-- Alcance deliberado: es un segundo camino DE LA COMANDA, no del dinero.
-- `api/sales/create_sale.php`, `includes/SaleService.class.php` y
-- `includes/CashRegister.class.php` quedan intactos.
--
-- Por qué 049 y no 048: cuando esta tarea se ejecutó, el número 048 ya lo ocupaba
-- `048_schema_migrations_status.sql` (TAB-39). Los archivos se aplican por nombre
-- (`sort -V` en docker/migrations.sh), así que meter un segundo 048 aplicaría la
-- cola ANTES del arreglo del estado de migraciones y dejaría el orden ambiguo.
--
-- Idempotente (mismo idioma que la 041): `ADD COLUMN IF NOT EXISTS` y
-- `CREATE TABLE IF NOT EXISTS` permiten aplicarla sobre una base existente y
-- sobre una limpia. Las mismas columnas y la misma tabla están en
-- database/schema.sql para instalaciones nuevas (que registran esta migración
-- como `baseline` y no la ejecutan).
-- =============================================

-- ─── station_outputs: el destino deja de ser texto libre y pasa a tener ruta ──
-- `target` SE QUEDA: es la etiqueta humana de la salida ("Impresora de barra"),
-- y el vocabulario del proyecto la pide.
ALTER TABLE station_outputs
    ADD COLUMN IF NOT EXISTS transport   ENUM('net9100','none') NOT NULL DEFAULT 'net9100' AFTER kind,
    ADD COLUMN IF NOT EXISTS host        VARCHAR(60) NULL AFTER target,
    ADD COLUMN IF NOT EXISTS paper_width ENUM('58','80') NOT NULL DEFAULT '80' AFTER host,
    ADD COLUMN IF NOT EXISTS `charset`   ENUM('cp437','cp850') NOT NULL DEFAULT 'cp850' AFTER paper_width,
    ADD COLUMN IF NOT EXISTS has_drawer  TINYINT(1) NOT NULL DEFAULT 0 AFTER `charset`;

-- ─── print_jobs: la cola. Una fila por (comanda, salida) ──────────────────────
-- Es la unidad de trabajo del worker (scripts/print-worker.php). Sin esta tabla
-- no hay reintento, ni marca de "no salió", ni idempotencia del reintento.
CREATE TABLE IF NOT EXISTS print_jobs (
    job_id          INT AUTO_INCREMENT PRIMARY KEY,
    store_id        INT NOT NULL,
    comanda_id      INT NULL COMMENT 'NULL en un job que no nace de comanda',
    output_id       INT NULL COMMENT 'La salida concreta (station_outputs)',
    kind            ENUM('comanda','ticket','corte') NOT NULL DEFAULT 'comanda',
    payload         MEDIUMBLOB NOT NULL COMMENT 'Bytes ESC/POS YA renderizados (binario: cp850/cp437 no son UTF-8 válido)',
    status          ENUM('pending','sending','done','failed') NOT NULL DEFAULT 'pending',
    attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0,
    last_error      VARCHAR(255) NULL,
    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at      DATETIME NULL COMMENT 'Lease: evita dos workers con el mismo ticket',
    claimed_by      VARCHAR(64) NULL,
    done_at         DATETIME NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Idempotencia del reintento: un reintento ACTUALIZA la fila existente, nunca
    -- inserta un segundo ticket para la misma (comanda, salida).
    UNIQUE KEY uk_job_comanda_output (comanda_id, output_id),
    INDEX idx_job_cola (status, next_attempt_at),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (comanda_id) REFERENCES comandas(comanda_id) ON DELETE CASCADE,
    FOREIGN KEY (output_id) REFERENCES station_outputs(output_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── comandas: la marca visible para el mesero ───────────────────────────────
-- `printed_count` NO se reemplaza: se queda como el contador auditable de éxitos
-- y el worker lo incrementa en el mismo UPDATE que pone print_status='printed',
-- para que el contador y el estado no puedan divergir.
ALTER TABLE comandas
    ADD COLUMN IF NOT EXISTS print_status     ENUM('none','queued','printed','failed') NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS print_attempts   TINYINT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS print_last_error VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS print_failed_at  DATETIME NULL;

-- Regla de tiempo respetada (AGENTS.md): `next_attempt_at`, `claimed_at` y
-- `done_at` se comparan y escriben con NOW() de SQL. Un timestamp calculado en
-- PHP contra la base (app en hora de México, MariaDB en UTC) produciría
-- reintentos inmediatos o de 6 horas.
