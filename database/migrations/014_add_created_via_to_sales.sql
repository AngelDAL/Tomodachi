-- Migración: created_via en ventas (quién registró la venta)
-- Permite distinguir ventas hechas por humano (sesión) vs agente/IA (token).
USE tomodachi_pos;
SET NAMES utf8mb4;

ALTER TABLE sales
    ADD COLUMN created_via VARCHAR(10) NOT NULL DEFAULT 'session'
    COMMENT 'session = interfaz (humano), token = API/agente'
    AFTER created_at;
