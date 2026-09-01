# Guía de Integración de Balanzas/Pesas en Tomodachi

## Descripción General

Tomodachi ahora soporta la integración de balanzas reales y pesas conectadas a través de puertos COM (USB o Serial tradicionales). Esto permite automatizar la entrada de pesos en ventas a granel sin necesidad de escribir manualmente los valores.

## Requisitos

### Hardware
- **Balanza/Pesa digital** compatible con comunicación serial
- **Cable de conexión** (USB, Serial RS-232, o adaptador)
- **Computadora** con puerto COM disponible

### Software
- **Navegador**: Chrome 89+, Edge 89+, Opera 75+ (requiere WebSerial API)
- **Conexión HTTPS** (WebSerial API requiere contexto seguro)
- **Acceso a puertos COM** (se solicita permiso al conectar)

> **Nota**: Firefox y Safari aún no soportan WebSerial API. Se recomienda usar Chrome o Edge.

## Protocolos Soportados

### 1. Genérico (9600 baud, 8N1)
**Formato**: Número con decimales seguido de terminador CR/LF
```
1234.56\r\n
2500.00\r\n
```
**Compatible con**: La mayoría de balanzas básicas

### 2. Datalogic (9600 baud, 8O2)
**Formato**: ST, GS, número, unidad, terminador
```
ST,GS,1234.56,g\r\n
ST,GS,2500.00,kg\r\n
```
**Compatible con**: Balanzas Datalogic

### 3. Excell (1200 baud, 8N1)
**Formato**: Signo + número + unidad
```
+1234.56g\r
+2500.00kg\r
```
**Compatible con**: Balanzas Excell y algunas marcas chinas

## Configuración

### Paso 1: Identificar el Puerto COM
1. Conecta la balanza a la computadora
2. Abre el Panel de Control → Dispositivos → Puertos COM
3. Busca el puerto de tu balanza (ej: COM3, COM4)
4. Nota el número del puerto

### Paso 2: Verificar el Protocolo
1. Abre el programa **"Herramienta de Prueba de Balanzas"** (`scale-test.html`)
2. Selecciona el protocolo que especifica el manual de tu balanza
3. Haz clic en "Conectar" y selecciona el puerto
4. Si funciona, deberías ver el peso en tiempo real

### Paso 3: Usar en Punto de Venta
1. En la página de Ventas, haz clic en el botón <i class="fas fa-weight-hanging"></i> "Balanza"
2. Selecciona el protocolo compatible
3. El indicador mostrará "Conectada" cuando esté lista
4. Cuando agregues un producto a granel, la balanza se leerá automáticamente

## Uso en Punto de Venta

### Flujo Normal

1. **Agregar Producto a Granel**
   - Busca un producto marcado como "a granel"
   - Haz clic para agregarlo
   - Se abrirá un modal de cantidad

2. **Modal de Cantidad**
   - **Si tienes balanza conectada**: Verás el peso en tiempo real
   - Presiona "Usar Peso de Balanza" para auto-llenar la cantidad
   - O ingresa manualmente la cantidad

3. **Confirmación**
   - El total se calcula automáticamente
   - Presiona "Agregar al Carrito" para confirmar

### Ejemplo
```
Producto: Café Premium
Precio: $150 por kg
Balanza muestra: 2.500 kg
Total automático: 2.500 × $150 = $375.00
```

## Herramienta de Prueba (scale-test.html)

Es una herramienta completa para probar y diagnosticar balanzas:

### Características
- **Selector de protocolo**: Elige entre Genérico, Datalogic, Excell
- **Conexión real**: Se conecta a puertos COM disponibles
- **Monitor de peso**: Muestra el peso en tiempo real
- **Simulador**: Simula datos de balanza para pruebas sin hardware
- **Registro de eventos**: Historial completo de conexiones y lecturas
- **Exportación**: Descarga logs para diagnóstico

### Uso del Simulador
1. Abre `scale-test.html` en el navegador
2. Haz clic en "Conectar" (sin seleccionar puerto real)
3. En la sección "Simulador", ingresa un peso
4. Presiona "Simular"
5. Verás cómo se procesa el peso según el protocolo

## Solución de Problemas

### Problema: "WebSerial API no soportada"
**Causa**: Estás usando un navegador que no soporta WebSerial
**Solución**: Usa Chrome 89+, Edge 89+ u Opera 75+

### Problema: No aparece el puerto COM
**Causa**: El puerto COM no está disponible o el navegador no tiene permisos
**Solución**: 
1. Verifica que el dispositivo esté conectado
2. Abre el Administrador de dispositivos para confirmar el puerto
3. Intenta desconectar y reconectar el dispositivo

### Problema: No se leen pesos correctamente
**Causa**: Protocolo incorrecto
**Solución**:
1. Abre la herramienta de prueba (`scale-test.html`)
2. Prueba los tres protocolos
3. Identifica cuál funciona con tu balanza
4. Verifica el manual de la balanza para confirmar

### Problema: Pesos erráticos o parciales
**Causa**: Velocidad de transmisión incorrecta (baud rate)
**Solución**:
1. Verifica los parámetros en el manual de la balanza
2. Algunos protocolos tienen baud rates específicos:
   - Genérico: 9600
   - Datalogic: 9600
   - Excell: 1200

### Problema: La conexión se cae frecuentemente
**Causa**: Puede ser un problema de cable o puerto COM inestable
**Solución**:
1. Prueba con un cable diferente
2. Intenta un puerto USB diferente
3. Desactiva/reactiva el dispositivo
4. Reinicia el navegador

## Configuración Avanzada

### Cambiar Protocolo en Tiempo de Ejecución
Los vendedores pueden cambiar el protocolo sin recargar la página:
1. Desconecta la balanza actual (clic en botón)
2. Vuelve a hacer clic
3. Selecciona el nuevo protocolo

### Múltiples Balanzas
Actualmente soporta una balanza a la vez. Si necesitas cambiar de balanza:
1. Desconecta la actual
2. Desconecta el hardware
3. Conecta la nueva balanza
4. Vuelve a conectar desde el POS

## Calibración y Tara

Algunos procedimientos comunes:

### Tara (Puesta a Cero)
Realiza esta acción **en la balanza físicamente**, no en el software:
1. Coloca un recipiente
2. Presiona el botón TARE/ZERO en la balanza
3. Ahora lee el peso neto sin el recipiente

### Calibración
Si los pesos son inexactos:
1. Abre la herramienta de prueba
2. Simula un peso conocido
3. Compáralo con un peso patrón
4. Ajusta en el manual de la balanza

## Integración API

Para desarrolladores que deseen integrar ScaleManager en sus propias aplicaciones:

```javascript
// Crear instancia
const scale = new ScaleManager();

// Establecer protocolo
scale.setProtocol('generic'); // 'generic', 'datalogic', 'excell'

// Conectar
await scale.requestPort();

// Escuchar eventos
scale.on('onWeight', (data) => {
  console.log(`Peso: ${data.weight} ${data.unit}`);
});

scale.on('onError', (data) => {
  console.error(`Error: ${data.message}`);
});

// Desconectar
await scale.disconnect();
```

## Especificaciones Técnicas

### WebSerial API
- **Estándar**: W3C Web Serial API
- **Navegadores**: Chrome 89+, Edge 89+, Opera 75+
- **Contexto requerido**: HTTPS o localhost
- **Permisos**: Se solicitan durante la conexión

### Velocidades Soportadas
- 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200 baud

### Formato de Datos
- **Bytes**: 8 bits
- **Paridad**: Configurado por protocolo (none, odd, even)
- **Terminadores**: CR (\r), LF (\n), CRLF (\r\n)

## FAQ

**P: ¿Puedo usar una balanza que no está en la lista?**  
R: Posiblemente. Si el formato de salida es similar al "Genérico" (número + terminador), debería funcionar. Prueba primero con la herramienta de prueba.

**P: ¿Se almacenan datos de las balanzas?**  
R: No. La conexión es directa entre el navegador y el puerto COM. No se almacenan datos en servidores.

**P: ¿Funciona offline?**  
R: No, necesitas estar conectado al sistema. WebSerial API funciona localmente pero la aplicación Tomodachi requiere acceso a la base de datos.

**P: ¿Cuántas balanzas puedo conectar simultáneamente?**  
R: Actualmente una. Para múltiples balanzas, se necesitaría una arquitectura más compleja.

**P: ¿Qué pasa si se desconecta la balanza?**  
R: El indicador mostrará "Desconectada" y puedes volver a ingresar manualmente cantidades. Al reconectar, se reasigna automáticamente.

## Soporte y Reportar Problemas

Si encuentras problemas:
1. Abre la herramienta de prueba (`scale-test.html`)
2. Presiona "Descargar" en el registro de eventos
3. Reporta el error con el archivo de log
4. Incluye:
   - Marca y modelo de balanza
   - Protocolo utilizado
   - Navegador y versión
   - Pasos para reproducir

## Historial de Versiones

### v1.0 (Actual)
- Soporte para 3 protocolos de balanzas
- WebSerial API integration
- Herramienta de prueba y simulador
- Modal de cantidad con lectura automática de balanza
- Indicador de estado en tiempo real

