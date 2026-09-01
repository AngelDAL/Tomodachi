# Modern Integration & Sidebar Enhancements

## Cambios Realizados

1.  **Sidebar Flotante y Moderno (Desktop)**:
    *   Se creó `public/css/sidebar-modern.css` con estilos para una apariencia "flotante" (separada de los bordes, bordes redondeados, sombras).
    *   Se aplica automáticamente en pantallas mayores a 1024px.
    *   Incluye transiciones suaves para el colapso.

2.  **Funcionalidad de Colapsar (Collapse)**:
    *   Se añadió un botón en el encabezado del menú (icono de hamburguesa) para colapsar el menú en escritorio.
    *   El estado (colapsado/expandido) se guarda en `localStorage` para persistir entre recargas.
    *   En modo colapsado, el menú se reduce a ~80px y solo muestra iconos.

3.  **Nombre de Tienda Dinámico**:
    *   `sidebar-loader.js` ahora consulta `/api/stores/settings.php` para obtener el nombre real de la tienda.
    *   Reemplaza automáticamente "Tomodachi" con el nombre configurado.

## Archivos Modificados/Creados

*   `public/js/sidebar-loader.js`: Lógica de inyección CSS, botón de toggle y fetch de API.
*   `public/css/sidebar-modern.css`: Nuevos estilos (Glassmorphism, Floating layout).

## Notas
*   Si el nombre de la tienda no se carga (ej. por error de conexión o sesión), se mantiene el valor por defecto.
*   El diseño es responsive y vuelve al comportamiento estándar en móviles.
