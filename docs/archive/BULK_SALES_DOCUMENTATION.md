# Funcionalidad de Venta a Granel - Documentación

## Descripción General

Se ha implementado un sistema completo de venta a granel (por peso/volumen) que permite a los productos tener dos modos de venta:

1. **Por Unidad** (modo predeterminado) - Se vende por piezas/unidades
2. **A Granel** - Se vende por peso, volumen u otra medida (kg, gramos, litros, etc.)

## Características Implementadas

### 1. Base de Datos

Se agregaron dos campos a la tabla `products`:

- **`is_bulk`** (TINYINT) - Indica si el producto se vende a granel (0=no, 1=sí)
- **`bulk_unit`** (VARCHAR) - Unidad de medida: kg, g, L, mL, lb, oz, pza, m

Las columnas `quantity` en `sale_details` e `inventory_movements` se modificaron para permitir decimales (DECIMAL(10,3)).

**Migración:** `database/migrations/011_add_bulk_sale_support.sql`

### 2. API de Productos

Se actualizó `api/inventory/products.php` para:

- **GET**: Retorna campos `is_bulk` y `bulk_unit` al listar productos
- **POST**: Acepta `is_bulk` y `bulk_unit` al crear productos
- **PUT**: Permite actualizar `is_bulk` y `bulk_unit`

### 3. Interfaz de Inventario

Se agregó una sección "Venta a Granel" en `inventory.html`:

- Checkbox para activar/desactivar venta a granel
- Selector de unidad de medida (kg, g, L, mL, lb, oz, pza, m)
- Mostrador dinámico que aparece/desaparece según el checkbox

**Archivos modificados:**
- `public/inventory.html` - Formulario de edición
- `public/js/inventory.js` - Lógica de manejo del formulario

### 4. Interfaz de Punto de Venta

Se implementó un flujo especial para productos a granel en `sales.js`:

#### Flujo de Venta a Granel:

1. Al hacer clic en un producto marcado como "a granel", se abre un modal
2. El modal solicita la cantidad/peso
3. Se muestra un preview del total en tiempo real
4. Al confirmar, se agrega al carrito con la cantidad decimal

**Funciones principales:**
- `promptBulkQuantity(prod)` - Abre modal de cantidad
- `closeBulkModal()` - Cierra el modal
- `confirmBulkQuantity()` - Agrega al carrito

#### Cambios en el Carrito:

- Los inputs de cantidad permiten decimales para productos a granel
- Se muestra la unidad de medida junto a la cantidad
- El cálculo de precios funciona con decimales

### 5. API de Ventas

Se actualizó `api/sales/create_sale.php` para:

- Aceptar cantidades decimales en lugar de solo enteros
- Calcular correctamente el subtotal con cantidades decimales
- Guardar cantidades decimales en `sale_details`

## Ejemplo de Uso

### Configurar un Producto a Granel

1. Ir a **Inventario**
2. Seleccionar o crear un producto
3. En la sección "Venta a Granel":
   - Activar checkbox "Este producto se vende a granel"
   - Seleccionar unidad: "Kilogramos (kg)"
   - Establecer precio: $50 (significa $50 por kg)
4. Guardar cambios

### Vender Producto a Granel

1. Ir a **Punto de Venta**
2. Buscar el producto (ej: "Manzanas")
3. Hacer clic en el producto
4. Se abre modal: "¿Cuántos kg deseas?"
5. Ingresar cantidad: 2.5 kg
6. Se muestra: Total = $125.00 (2.5 × $50)
7. Confirmar → Se agrega al carrito

El carrito mostrará:
```
Manzanas | $50.00/kg | 2.5 kg | $125.00
```

## Estructura de Datos en el Carrito

Cada item en el carrito contiene:

```javascript
{
  product_id: 1,
  product_name: "Manzanas",
  unit_price: 50.00,        // Precio por kg
  original_price: 50.00,
  quantity: 2.5,            // En kg (decimal)
  subtotal: 125.00,
  is_bulk: 1,               // Indica que es producto a granel
  bulk_unit: "kg",          // Unidad de medida
  // ... otros campos
}
```

## Unidades de Medida Disponibles

Predefinidas en el formulario de productos:

- **kg** - Kilogramos
- **g** - Gramos
- **L** - Litros
- **mL** - Mililitros
- **lb** - Libras
- **oz** - Onzas
- **pza** - Piezas
- **m** - Metros

Pueden agregarse más editando el `<select>` en `inventory.html`.

## Validaciones

### Cantidad a Granel

- Mínimo: 0.001 (puede vender 1 gramo)
- Sin máximo predeterminado
- Acepta 3 decimales

### Stock

- Si permite stock negativo: se puede vender sin límite
- Si no permite: valida que haya suficiente cantidad

## Comportamiento del Stock

El stock se actualiza igual para productos a granel y normales:

- Si compras 2.5 kg de un producto a granel que tenía 10 kg, quedará con 7.5 kg
- Se registra en `inventory_movements` con cantidad decimal

## Reportes y Detalles

En reportes y detalles de venta, se mostrará:

```
Producto: Manzanas
Cantidad: 2.5 kg
Precio Unitario: $50.00/kg
Subtotal: $125.00
```

## Archivos Creados/Modificados

### Creados:
- `database/migrations/011_add_bulk_sale_support.sql`
- `public/css/bulk_sales.css`

### Modificados:
- `database/schema.sql` (tabla products)
- `api/inventory/products.php`
- `api/sales/create_sale.php`
- `public/inventory.html`
- `public/js/inventory.js`
- `public/js/sales.js`
- `public/sales.html`

## Notas Técnicas

1. **Precio por Unidad de Medida**: El campo `price` en `products` representa el precio por unidad de medida (no por unidad completa)

2. **Decimales**: Soporta hasta 3 decimales (0.001), suficiente para la mayoría de casos

3. **Compatibilidad**: Los productos normales siguen funcionando igual, con cantidades enteras

4. **Validación**: Toda validación de precio ocurre en el servidor, nunca confía en el cliente

## Próximas Mejoras Opcionales

- Agregar más unidades de medida personalizables
- Mostrar gráfico de consumo de productos a granel
- Alertas de stock bajo en decimales
- Búsqueda y filtrado por unidad de medida
- Conversión automática de unidades (kg ↔ g)
