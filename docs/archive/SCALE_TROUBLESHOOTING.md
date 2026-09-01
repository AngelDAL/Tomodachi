# Troubleshooting - Problemas Comunes con Balanzas

## Problema: "WebSerial API no está soportada"

### Síntoma
Aparece un error diciendo que WebSerial API no está soportada

### Causas Posibles
1. Navegador incompatible (Firefox, Safari, IE)
2. Versión del navegador antigua

### Soluciones
- ✅ Usa **Chrome 89+**, **Edge 89+**, u **Opera 75+**
- Actualiza tu navegador a la última versión
- Verifica la versión en `Settings → About [Navegador]`

---

## Problema: "No aparece puerto COM en el selector"

### Síntoma
Al hacer clic en "Conectar", el selector de puertos no muestra ninguna opción

### Causas Posibles
1. Dispositivo no conectado
2. Drivers no instalados
3. Cable defectuoso
4. Permisos del navegador denegados

### Soluciones

**Paso 1: Verificar Conexión Física**
```
Windows:
1. Panel de Control → Dispositivos y impresoras
2. Busca tu balanza/dispositivo serial
3. Si aparece con signo ⚠️, necesita drivers
```

**Paso 2: Instalar/Actualizar Drivers**
- Ve al sitio web del fabricante
- Descarga los drivers para tu balanza
- Instala los drivers (puede requerir reinicio)

**Paso 3: Probar en Otro Puerto USB**
- Desconecta el dispositivo
- Conecta en un puerto USB diferente
- Intenta de nuevo

**Paso 4: Verificar Permisos del Navegador**
```
Chrome:
1. Settings → Privacy and security → Site settings
2. Busca "Serial ports"
3. Verifica que tomodachi.local está permitido
4. Limpia caché y recarga la página
```

---

## Problema: Detecta puerto pero no lee pesos

### Síntoma
El puerto se conecta pero no aparecen números en la pantalla

### Causas Posibles
1. Protocolo incorrecto
2. Velocidad de transmisión (baud rate) incorrecta
3. Configuración de bits/paridad incorrecta
4. Formato de datos incompatible

### Soluciones

**Paso 1: Identificar Protocolo Correcto**
1. Abre `scale-test.html`
2. Conecta con protocolo "Genérico"
3. Si no funciona, intenta "Datalogic"
4. Si aún no, intenta "Excell"
5. Consulta el manual de tu balanza

**Paso 2: Verificar Manual del Fabricante**
Busca en el manual:
- "Serial Protocol" o "Comunicación Serial"
- "Baud Rate" (normalmente 1200 o 9600)
- "Data Format" o "Output Format"
- Ejemplo de salida típica

**Paso 3: Probar en Otro Software**
Usa un terminal serial como **PuTTY** o **Hyperterminal** para verificar que tu balanza sí envía datos:
1. Descarga PuTTY (https://www.putty.org)
2. Abre conexión serial al puerto COM
3. Coloca peso en la balanza
4. ¿Ves números aparecer?
   - SÍ → Balanza funciona, problema en configuración
   - NO → Problema con el hardware/drivers

---

## Problema: Números erráticos o parciales

### Síntoma
Ve números como:
- "12" en lugar de "1234.56"
- "4999" en lugar de "4.999"
- Valores que cambian constantemente

### Causas Posibles
1. Baud rate incorrecto
2. Datos siendo cortados
3. Protocolo con formato diferente
4. Buffer de lectura incompleto

### Soluciones

**Opción 1: Probar Diferentes Baud Rates**
Si el protocolo se puede configurar:
- Intenta con 2400, 4800, 9600, 19200
- Verifica el manual para el valor correcto

**Opción 2: Cambiar Protocolo**
- Algunos fabricantes usan variantes no estándar
- Prueba todos los protocolos disponibles

**Opción 3: Calibrar la Balanza**
Algunos problemas vienen de una balanza mal calibrada:
1. Consulta el manual para procedimiento de calibración
2. Usa pesos estándar certificados
3. Realiza calibración de dos puntos si es necesario

---

## Problema: La balanza se desconecta frecuentemente

### Síntoma
- Conexión se pierde después de unos segundos
- "Desconectado" aparece en el indicador
- Necesita reconectar constantemente

### Causas Posibles
1. Cable suelto o defectuoso
2. Interferencia electromagnética
3. Problema de alimentación del dispositivo
4. Exceso de datos/líneas incompletas

### Soluciones

**Paso 1: Revisar Cable**
- Intenta con un cable diferente
- Asegúrate de que esté bien conectado
- Evita cables muy largos (máx 3m para serial)

**Paso 2: Cambiar Puerto USB**
- Intenta diferentes puertos USB
- Algunos puertos pueden tener problemas de energía

**Paso 3: Alejarte de Interferencias**
- Aleja el cable de routers WiFi
- Aleja de monitores/fluorescentes
- Evita cables de poder cerca del cable serial

**Paso 4: Alimentación**
- Verifica que la balanza tiene batería/energía
- Algunos dispositivos USB necesitan más potencia
- Intenta con un puerto USB 3.0 en lugar de 2.0

**Paso 5: Revisar Logs**
1. Abre `scale-test.html`
2. Presiona "Descargar" registro
3. Busca patrones de desconexión
4. ¿Se desconecta después de cierto tiempo?
5. ¿Se desconecta con ciertos rangos de peso?

---

## Problema: Peso no se auto-completa en el modal

### Síntoma
En el Punto de Venta, al agregar un producto a granel:
- El indicador de balanza no aparece
- Botón "Usar Peso de Balanza" está deshabilitado
- Tienes que escribir manualmente el peso

### Causas Posibles
1. Balanza no conectada
2. Balanza conectada pero sin lectura activa
3. Problema de sincronización

### Soluciones

**Paso 1: Verificar Conexión**
- Mira el indicador ⚖️ en la barra superior
- ¿Dice "Conectada"?
- Si no, haz clic para conectar

**Paso 2: Probar Lectura de Peso**
1. Abre `scale-test.html` en otra pestaña
2. Coloca peso en la balanza
3. ¿Ves el número en la herramienta de prueba?
4. Si SÍ → Vuelve a Ventas y reconecta
5. Si NO → Revisa otros pasos de troubleshooting

**Paso 3: Recargar Página**
- A veces ayuda recargar completamente la página
- Presiona Ctrl+Shift+R (recarga de caché limpio)

**Paso 4: Verificar Consola del Navegador**
1. Presiona F12 para abrir Developer Tools
2. Ve a la pestaña "Console"
3. ¿Ves algún error en rojo?
4. Si es así, copia el error y reporta

---

## Problema: Error "Secure context required"

### Síntoma
WebSerial API solo funciona en conexiones seguras (HTTPS), no en HTTP

### Causas Posibles
1. Estás accediendo por HTTP en lugar de HTTPS
2. Certificado HTTPS inválido

### Soluciones

**Opción 1: Usar Localhost (Local Development)**
```
✅ Funciona: http://localhost:8000
✅ Funciona: http://127.0.0.1:8000
❌ No funciona: http://192.168.x.x:8000
```

**Opción 2: Implementar HTTPS en Producción**
1. Obtén un certificado SSL/TLS
2. Configura HTTPS en tu servidor web
3. Redirige HTTP → HTTPS

**Opción 3: Usar Contexto de Desarrollo**
En Chrome, puedes habilitar WebSerial en modo no seguro:
1. Ve a `chrome://flags`
2. Busca "insecure context"
3. Cambia a "Enabled"
4. Reinicia Chrome
⚠️ Solo para desarrollo, no seguro para producción

---

## Problema: Peso llega pero está en unidad incorrecta

### Síntoma
La balanza envía "1.5kg" pero el sistema muestra "1.5oz"
O valores numéricos muy diferentes

### Causas Posibles
1. Parser de protocolo incorrecto
2. Balanza configurada para otra unidad
3. Protocolo específico del fabricante no estándar

### Soluciones

**Paso 1: Verificar Unidad en Balanza**
- Muchas balanzas tienen botón para cambiar unidad
- Cambia a kg/g/lb según necesites
- Verifica que esté en la unidad correcta

**Paso 2: Revisar Logs de Protocolo**
1. Abre `scale-test.html`
2. Anota exactamente qué envía la balanza
3. Compáralo con el formato esperado del protocolo
4. ¿Coinciden?

**Paso 3: Reportar si es No Estándar**
Si tu balanza envía un formato diferente:
1. Nota el formato exacto (ejemplo: "+1500g")
2. Anota la marca y modelo
3. Podría agregarse un nuevo protocolo

---

## Problema: Rendimiento lento / Lag en la aplicación

### Síntoma
La interfaz se pone lenta cuando está conectada la balanza
Especialmente al escribir en búsqueda

### Causas Posibles
1. Lectura continua de datos muy frecuente
2. Demasiados listeners/callbacks
3. Problema con el puerto COM

### Soluciones

**Paso 1: Revisar Configuración de Baud Rate**
- Un baud rate muy alto puede generar ruido
- Algunos protocolos tienen baud rate específicos
- Verifica que sea el recomendado

**Paso 2: Limitador de Frecuencia**
El código puede implementar debounce:
```javascript
let lastWeightUpdate = 0;
scale.on('onWeight', (data) => {
  if (Date.now() - lastWeightUpdate > 100) { // Máximo cada 100ms
    updateUI(data);
    lastWeightUpdate = Date.now();
  }
});
```

**Paso 3: Desconectar cuando no se Necesita**
- Desconecta la balanza si no estás pesando
- Ahorra recursos y reduce lag

**Paso 4: Probar en Otra Máquina**
- El problema podría ser de hardware
- Intenta en otro puerto USB
- Intenta en otra computadora

---

## Problema: Balanza conectada pero sin datos (silencio)

### Síntoma
- Conexión exitosa (dice "Conectada")
- Pero no ve ningún peso
- Aunque hay peso en la balanza

### Causas Posibles
1. Balanza espera comando para enviar peso
2. Protocolo de handshake no realizado
3. Balanza en modo sleep/reposo

### Soluciones

**Paso 1: Presionar Botón en Balanza**
- Algunas balanzas necesitan que presiones PRINT/SEND
- Intenta presionar ese botón después de colocar peso

**Paso 2: Revisar Manual - Modo de Funcionamiento**
Busca:
- "Continuous output" vs "On demand"
- Si es "On demand", necesitas enviar comando
- Si es "Continuous", debería enviar siempre

**Paso 3: Revisar Cable Conexión**
- Algunos cables serial necesitan líneas RTS/CTS
- Intenta otro cable
- Verifica que sea compatible

**Paso 4: Activar en Balanza**
Algunos fabricantes requieren:
1. Entrar a menú de configuración
2. Habilitar "RS-232" o "Serial Output"
3. Guardar configuración

Consulta el manual específico de tu balanza

---

## Cuando Nada Funciona: Diagnóstico Completo

Si ninguno de los pasos anteriores funciona:

### 1. Recopila Información
```
[ ] Marca y modelo exacto de balanza
[ ] Método de conexión (USB, Serial RS-232, etc)
[ ] Versión de navegador (Chrome/Edge/etc)
[ ] Sistema operativo (Windows/Mac/Linux)
[ ] Número de puerto COM que aparece
[ ] Configuración de baud rate de la balanza (si se puede cambiar)
[ ] Captura de pantalla del error
[ ] Log de events (descargado de scale-test.html)
[ ] Salida exacta cuando pruebas en otro software (como PuTTY)
```

### 2. Prueba Sistemática
```
1. ¿Aparece el puerto en Administrador de dispositivos?
   SÍ → Ir a paso 3 | NO → Problema de drivers
   
2. ¿Funciona en otro software (PuTTY)?
   SÍ → Problema en Tomodachi | NO → Problema hardware/drivers
   
3. ¿Qué protocolo funciona?
   ___ generic
   ___ datalogic
   ___ excell
   ___ ninguno
   
4. ¿Qué baud rate funciona?
   ___ 1200 | ___ 2400 | ___ 4800 | ___ 9600 | ___ 19200
   ___ otro: ______
```

### 3. Reportar Bug
Con la información anterior, puedes:
1. Abrir issue en GitHub
2. Contactar soporte con los detalles
3. Incluir el log descargado

---

## Recursos Útiles

### Software de Diagnóstico
- **PuTTY**: Terminal serial para probar conexión
  https://www.putty.org

- **Device Manager** (Windows): Ver puertos COM
  - Panel Control → Dispositivos y impresoras

- **Terminal** (Mac/Linux): Ver puertos ttyUSB*/ttyACM*
  ```bash
  ls /dev/tty.*
  ```

### Documentación
- [WebSerial API Spec](https://wicg.github.io/serial/)
- [MDN WebSerial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [Common Balance Protocols](https://en.wikipedia.org/wiki/Modbus)

### Marcas Comunes de Balanzas y Protocolos
| Marca | Protocolo Típico | Baud Rate |
|-------|------------------|-----------|
| Datalogic | Datalogic | 9600 |
| Excell | Excell | 1200 |
| Basculas Genéricas | Generic | 9600 |
| Mettler Toledo | Datalogic | 9600 |
| Balanzas Chinas | Generic/Excell | 9600/1200 |
| A&D | Datalogic | 9600 |

---

## Checklist Final

Antes de reportar un problema, verifica:

- [ ] Navegador es Chrome 89+, Edge 89+, u Opera 75+
- [ ] Dispositivo está conectado y visible en Administrador de dispositivos
- [ ] Probé todos los protocolos (generic, datalogic, excell)
- [ ] Probé en `scale-test.html` y funciona
- [ ] Verifiqué el manual del fabricante
- [ ] Intenté con otro cable/puerto USB
- [ ] Recarguéla página completamente (Ctrl+Shift+R)
- [ ] Limpié caché del navegador
- [ ] Reinicié el navegador completamente

Si todo lo anterior falla, contacta soporte con el log descargado de scale-test.html.
