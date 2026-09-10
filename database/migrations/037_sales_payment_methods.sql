-- =============================================
-- Migración 037: métodos de pago con pasarela en sales.payment_method
-- =============================================
-- El ENUM de sales.payment_method no incluía 'codi' ni 'stripe'. Con
-- sql_mode = STRICT_TRANS_TABLES (el que trae el contenedor), registrar una
-- venta cobrada por CoDi o por Stripe fallaba con error de datos truncados:
-- la venta nunca se guardaba, aunque la interfaz y la API aceptaran el método.
--
-- Se deja el ENUM completo para que la migración sea idempotente y no dependa
-- del orden en que se apliquen las migraciones de cada módulo.
ALTER TABLE sales
MODIFY COLUMN payment_method ENUM('cash', 'card', 'transfer', 'mixed', 'credit', 'codi', 'stripe') NOT NULL;
