# Guía de Prueba - Venta a Granel

## Cambios Realizados

Se han corregido los siguientes problemas en la implementación de venta a granel:

### 1. **Transmisión de Datos `is_bulk` y `bulk_unit`**
   - ✅ `renderGallery()` - Agregados atributos `data-is_bulk` y `data-bulk_unit`
   - ✅ `searchProducts()` - Agregados campos en búsqueda
   - ✅ `fetchByCode()` - Agregados campos en escáner
   - ✅ Búsqueda por voz - Agregados campos

### 2. **Modal de Cantidad a Granel**
   - ✅ Se abre cuando `is_bulk == 1`
   - ✅ Solicita la cantidad/peso en la unidad correcta
   - ✅ Muestra preview del total en tiempo real
   - ✅ Se puede cerrar con botón "Cancelar" o clic en la X
   - ✅ Se agrega al carrito con Enter o botón "Agregar"

### 3. **Estilos CSS**
   - ✅ Modal está visible con clase `.active`
   - ✅ Animación de entrada suave
   - ✅ Responsivo para móviles

---

## Procedimiento de Prueba

### Paso 1: Configurar un Producto a Granel

1. Abre **Inventario**
2. Crea o edita un producto (ej: "Manzanas")
3. En la sección "Venta a Granel":
   - ✅ Marca el checkbox
   - ✅ Selecciona "kg" como unidad
   - ✅ Establece precio: $50
4. Guarda los cambios

### Paso 2: Probar desde Galería

1. Abre **Punto de Venta**
2. Busca el producto "Manzanas" en la galería
3. **Resultado esperado:**
   - Se abre un modal titulado "🪜 Manzanas"
   - Muestra "Precio por kg: $50.00"
   - Campo de entrada: "Cantidad en kilogramos:"
   - Preview de total: "Total: $0.00"

### Paso 3: Probar Entrada de Cantidad

1. En el modal, escribe `2.5` en el campo
2. **Resultado esperado:**
   - El preview actualiza a: "Total: $125.00"

### Paso 4: Agregar al Carrito

1. Haz clic en "Agregar al Carrito" (o presiona Enter)
2. **Resultado esperado:**
   - Modal se cierra
   - Sonido de éxito
   - Notificación: "2.5 kg agregados"
   - El producto aparece en el carrito

### Paso 5: Verificar Carrito

En la tabla del carrito debe mostrarse:
```
Manzanas | $50.00 | 2.5 kg | $125.00
```

Con un input que permite decimales (step 0.001).

### Paso 6: Probar Búsqueda

1. En el campo de búsqueda, escribe "manzana"
2. Haz clic en el resultado
3. **Resultado esperado:** Se abre el mismo modal de cantidad

### Paso 7: Probar Escáner (Opcional)

Si tienes un código de barras/QR configurado:
1. Escanea el producto
2. **Resultado esperado:** Se abre el modal de cantidad

---

## Checklist de Validación

- [ ] Modal se abre cuando haces clic en producto a granel
- [ ] Modal muestra el nombre del producto correcto
- [ ] Modal muestra "Precio por [unidad]:" correctamente
- [ ] El preview actualiza en tiempo real al escribir
- [ ] Se puede confirmar con Enter o botón
- [ ] Se puede cancelar con botón o X
- [ ] El producto se agrega al carrito con cantidad decimal
- [ ] Se muestra la unidad junto a la cantidad en el carrito
- [ ] El cálculo de total es correcto (cantidad × precio)
- [ ] La búsqueda también abre el modal
- [ ] El escáner abre el modal (si está configurado)
- [ ] Se puede completar la venta normalmente

---

## Posibles Errores y Soluciones

### El modal no aparece
**Solución:**
1. Abre la consola (F12)
2. Busca errores en JavaScript
3. Verifica que `is_bulk` sea `1` en los datos del producto
4. Limpia el caché del navegador (Ctrl+Shift+Del)

### El modal aparece pero no se ve bien
**Solución:**
1. Verifica que `bulk_sales.css` esté en `public/css/`
2. Verifica que esté vinculado en `sales.html`
3. Recarga la página (Ctrl+F5)

### La cantidad no se actualiza en el preview
**Solución:**
1. Verifica que JavaScript no tenga errores (F12)
2. Asegúrate de que `formatCurrency()` esté disponible

### El producto no se agrega al carrito
**Solución:**
1. Verifica que confirmes correctamente
2. Abre la consola para ver errores
3. Asegúrate de que CART esté definido

---

## Archivos Modificados en Esta Sesión

- `public/js/sales.js` - Correcciones completas
- `public/css/bulk_sales.css` - Estilos del modal
- `public/sales.html` - Vinculación CSS

No necesitas ejecutar migraciones nuevas (ya se creó en la sesión anterior).

---

## Próximos Pasos

1. **Prueba completa** siguiendo el procedimiento anterior
2. **Verifica todos los métodos** de agregar (galería, búsqueda, escáner)
3. **Prueba en móvil** para validar responsividad
4. **Completa una venta** con productos a granel
5. **Verifica el stock** se actualiza correctamente con decimales
