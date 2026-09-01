# Herramientas de Prueba - Balanzas/Pesas

## Acceso Rápido

### 1. Herramienta de Prueba de Balanzas
**URL**: `http://localhost/Tomodachi/public/scale-test.html`

**Función**: Probar, conectar y diagnosticar balanzas reales o simuladas
- Selector de protocolo (Genérico, Datalogic, Excell)
- Conexión a puertos COM reales
- Simulador de pesos para pruebas
- Monitor de peso en tiempo real
- Registro de eventos completo
- Exportación de logs para diagnóstico

### 2. Punto de Venta
**URL**: `http://localhost/Tomodachi/public/sales.html`

**Botón de Balanza**: Icono ⚖️ en la barra superior
- Conectar balanzas al punto de venta
- Auto-lectura de pesos en productos a granel
- Indicador de estado en tiempo real

## Pasos Básicos

### Probar una Balanza
1. Abre `scale-test.html`
2. Conecta el hardware a la computadora
3. Selecciona el protocolo apropiado
4. Haz clic en "Conectar"
5. Selecciona el puerto COM de tu balanza
6. Deberías ver el peso en tiempo real

### Usar en Ventas
1. Ve a `sales.html` (Punto de Venta)
2. Haz clic en botón ⚖️ (Balanza)
3. Selecciona el protocolo
4. Conecta tu balanza
5. Cuando agregues un producto a granel, verás el peso automáticamente
6. O presiona "Usar Peso de Balanza" para auto-llenar

## Navegadores Requeridos
- ✅ Chrome 89+
- ✅ Edge 89+
- ✅ Opera 75+
- ❌ Firefox (aún no soporta WebSerial API)
- ❌ Safari (aún no soporta WebSerial API)

## Documentación Completa
Ver: `SCALE_INTEGRATION_GUIDE.md` para detalles técnicos, protocolos, y solución de problemas.
