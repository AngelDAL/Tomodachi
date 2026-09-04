# Migración de la base de datos de Hostinger a Tomodachi Community Edition

## Diagnóstico

El respaldo `u741607357_tomodachi` fue comparado contra `database/schema.sql` de la rama `community-edition`.

- La base de datos heredada contiene **12 tablas**.
- El esquema actual de Community contiene **31 tablas**.
- Falta `login_attempts`, que es la causa directa del error:
  `SQLSTATE[42S02] ... login_attempts doesn't exist`.
- También faltan 18 tablas usadas por clientes, devoluciones, tokens, notificaciones, recetas/BOM, lotes y pantallas digitales.
- `products`, `sales`, `sale_details` y `stores` tienen columnas nuevas ausentes.
- La base heredada usa enteros para algunas existencias; Community usa `DECIMAL(12,3)` para permitir productos a granel y recetas.

## Archivo que se debe ejecutar

```text
database/migrations/032_reconcile_hostinger_community.sql
```

Es una migración para una base de datos existente. No depende de que la base se llame `tomodachi_pos`: se debe seleccionar la base correcta en phpMyAdmin o pasarla como argumento al cliente `mysql`.

## Procedimiento recomendado en Hostinger

1. Poner la aplicación en mantenimiento o impedir temporalmente nuevos accesos.
2. Descargar un respaldo completo desde phpMyAdmin. Si se tiene acceso SSH, usar:

   ```bash
   mysqldump --single-transaction --routines --triggers -u USUARIO -p BASE_DATOS > respaldo_antes_tomodachi.sql
   ```

3. Abrir phpMyAdmin, seleccionar **exactamente** `u741607357_tomodachi` y abrir la pestaña **SQL**.
4. Pegar o importar el contenido completo de `032_reconcile_hostinger_community.sql`.
5. Ejecutarlo una sola vez y revisar los resultados finales:
   - `tablas_tomodachi` debe ser 31, salvo que la base tenga tablas adicionales ajenas a Tomodachi.
   - La consulta `tabla_faltante` debe devolver cero filas.
   - En `products`, `bulk_unit` debe estar seguido por `tracking_type`, `consume_mode`, `pieces_per_box` e `is_ingredient`.
6. Probar login, inventario, creación de una venta y consulta del historial.

Con SSH, la ejecución equivalente es:

```bash
mysql -u USUARIO -p u741607357_tomodachi < 032_reconcile_hostinger_community.sql
```

## Seguridad de datos

El script:

- No elimina tablas.
- No elimina columnas.
- No elimina filas ni reescribe productos, ventas o existencias.
- Usa `CREATE TABLE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS`, por lo que se puede repetir si la conexión se corta después de una parte.
- Amplía las columnas de existencias de entero a `DECIMAL(12,3)`.
- Agrega valores por defecto compatibles: `tracking_type='stock'`, `consume_mode='fifo'`, `is_ingredient=0`, `amount_paid=0`, `refunded_amount=0` y `created_via='session'`.

La conversión de tipos es deliberadamente conservadora, pero el respaldo previo es obligatorio porque ningún cambio de esquema debe ejecutarse sin una forma de restauración.

## Nota sobre `schema_migrations`

Este archivo se puede ejecutar manualmente en Hostinger y no necesita que exista `schema_migrations`. Si el código de la aplicación usa esa tabla para controlar migraciones, registrar esta versión después de comprobar la estructura:

```sql
INSERT IGNORE INTO schema_migrations (version)
VALUES ('032_reconcile_hostinger_community.sql');
```

No se debe ejecutar esa sentencia si la tabla `schema_migrations` no existe o si la aplicación de Hostinger no utiliza ese mecanismo.
