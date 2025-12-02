-- Eliminar restricciones UNIQUE globales y agregar compuestas por tienda
ALTER TABLE products DROP INDEX barcode;
ALTER TABLE products DROP INDEX qr_code;

ALTER TABLE products ADD UNIQUE KEY unique_store_barcode (store_id, barcode);
ALTER TABLE products ADD UNIQUE KEY unique_store_qr_code (store_id, qr_code);
