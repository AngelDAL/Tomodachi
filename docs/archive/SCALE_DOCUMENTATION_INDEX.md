# 📚 Índice Completo - Documentación de Balanzas en Tomodachi

## 🎯 Comienza Aquí

### Para Usuarios Finales
**👉 Empezar**: [QUICK_START.md](QUICK_START.md) - 5 minutos para configurar
```
- Cómo conectar tu balanza
- Cómo usar en Punto de Venta
- Soluciones rápidas a problemas comunes
```

### Para Técnicos
**👉 Referencia**: [SCALE_INTEGRATION_GUIDE.md](SCALE_INTEGRATION_GUIDE.md) - Guía técnica completa
```
- Requisitos del sistema
- Configuración por protocolo
- Documentación de APIs
- Especificaciones técnicas
```

---

## 📁 Estructura de Archivos

### Código (Implementación)

#### ScaleManager (Núcleo)
📄 **`public/js/scale-manager.js`** (340 líneas)
- Clase principal para control de balanzas
- Soporte para 3 protocolos de balanzas
- Sistema de eventos con listeners
- Métodos de conexión/desconexión
- Simulador integrado para pruebas
```javascript
// Uso básico:
const scale = new ScaleManager();
scale.setProtocol('generic');
await scale.requestPort();
scale.on('onWeight', (data) => console.log(data.weight));
```

#### Herramienta de Prueba
📄 **`public/scale-test.html`** (400 líneas)
- Interfaz completa para probar balanzas
- Selector de protocolo
- Monitor de peso en tiempo real
- Simulador para pruebas sin hardware
- Registro de eventos y exportación
- **Acceso**: http://localhost/Tomodachi/public/scale-test.html

### Integración en Punto de Venta

#### Página Principal
📄 **`public/sales.html`**
```html
<!-- Nuevo elemento agregado -->
<button id="toggleScaleBtn" class="btn-scale">
  <i class="fas fa-weight-hanging"></i>
</button>
<div id="scaleStatusIndicator" class="scale-status-indicator">
  <i class="fas fa-balance-scale"></i>
  <span id="scaleStatus">Desconectado</span>
</div>
```

#### Lógica JavaScript
📄 **`public/js/sales.js`** (nuevas funciones)
```javascript
// Nuevas funciones agregadas:
initScaleManager()              // Inicializa escala
showScaleProtocolDialog()       // Selector de protocolo
loadScaleManagerScript()        // Carga el módulo
promptBulkQuantity()            // Abierto con lectura de balanza
useBulkScaleWeight()            // Auto-completa peso
closeBulkModal()                // Cierra limpiamente
```

#### Estilos CSS
📄 **`public/css/sales.css`**
```css
.btn-scale               /* Botón de balanza */
.btn-scale.connected    /* Estilo cuando conectada */
.scale-status-indicator /* Indicador de estado */
.scale-status-indicator.connected /* Estilo conectada */
```

---

## 📖 Documentación

### Para Comenzar Rápido
📄 **`QUICK_START.md`** ⭐ COMIENZA AQUÍ
- Los 3 pasos para empezar
- Cheat sheet de protocolos
- Problemas comunes y soluciones rápidas
- Configuración inicial
- Video tutorial paso a paso

### Guía Técnica Completa
📄 **`SCALE_INTEGRATION_GUIDE.md`** 
- Descripción general del sistema
- Requisitos de hardware y software
- Especificaciones de 3 protocolos
- Configuración paso a paso
- Guía de calibración
- Integración API (para desarrolladores)
- Especificaciones técnicas de WebSerial
- FAQ detalladas

### Referencia de Herramientas
📄 **`SCALE_TOOLS_README.md`**
- Acceso rápido a herramientas
- Pasos básicos de cada herramienta
- Navegadores requeridos
- Enlaces directos

### Solución de Problemas
📄 **`SCALE_TROUBLESHOOTING.md`** 🆘 CUANDO ALGO FALLA
- WebSerial API no soportada
- Puerto COM no aparece
- Detecta puerto pero no lee
- Números erráticos
- Desconexiones frecuentes
- Peso no se auto-completa
- Diagnóstico completo
- Checklist final

### Resumen de Implementación
📄 **`SCALE_IMPLEMENTATION_SUMMARY.md`**
- Qué se implementó
- Cómo usar
- Configuración por protocolo
- Arquitectura técnica
- Flujo de datos
- Clases y métodos
- Requisitos del navegador
- Archivos modificados

### Ejemplos de Código
📄 **`SCALE_EXAMPLES.js`** 
10 ejemplos completos:
1. Uso básico
2. Captura en campo de entrada
3. Selector de protocolo dinámico
4. Lectura persistente (WeightMonitor class)
5. Formulario con captura automática
6. Cambiar protocolo en tiempo real
7. Múltiples listeners
8. Manejo de errores robusto
9. Guardar peso en base de datos
10. Pruebas automatizadas

---

## 🔧 Referencia Técnica

### WebSerial API
Estándar W3C para acceso a puertos COM desde navegadores modernos
- **Especificación**: https://wicg.github.io/serial/
- **MDN Docs**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
- **Navegadores**: Chrome 89+, Edge 89+, Opera 75+
- **Requerimientos**: HTTPS (excepto localhost)

### Protocolos Soportados

#### Genérico
- Velocidad: 9600 baud
- Bits: 8, Paridad: None, Stop: 1
- Formato: `1234.56\r\n`
- Más compatible con balanzas básicas

#### Datalogic
- Velocidad: 9600 baud
- Bits: 8, Paridad: Odd, Stop: 2
- Formato: `ST,GS,1234.56,g\r\n`
- Balanzas profesionales Datalogic

#### Excell
- Velocidad: 1200 baud
- Bits: 8, Paridad: None, Stop: 1
- Formato: `+1234.56g\r`
- Balanzas Excell y marcas chinas

---

## 📊 Diagrama de Flujo

```
┌─────────────────────────────────────────┐
│    Hardware Balanza Conectado USB       │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│   WebSerial API (Navegador)             │
│   - Chrome 89+, Edge 89+, Opera 75+     │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│   ScaleManager (JavaScript Class)       │
│   - requestPort()                       │
│   - connect() / disconnect()            │
│   - startReading()                      │
│   - simulateWeight()                    │
└────────────────┬────────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
         ▼                ▼
    Parsers         Event System
    - Generic      - onConnect
    - Datalogic    - onWeight
    - Excell       - onError
                   - onDisconnect
         │                │
         └───────┬────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│   Aplicación Tomodachi                  │
│   - sales.js                            │
│   - Módulo de Inventario                │
│   - scale-test.html                     │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│   Usuario (Vendedor)                    │
│   - Ver peso en tiempo real             │
│   - Auto-completar cantidad             │
│   - Vender productos a granel           │
└─────────────────────────────────────────┘
```

---

## 🚀 Guía de Inicio Rápido por Rol

### Vendedor / Operador
1. Lee: [QUICK_START.md](QUICK_START.md)
2. Abre: http://localhost/Tomodachi/public/scale-test.html
3. Conecta balanza
4. Ve a: http://localhost/Tomodachi/public/sales.html
5. Presiona botón ⚖️
6. ¡Comienza a vender!

Si hay problemas:
- Revisa: [SCALE_TROUBLESHOOTING.md](SCALE_TROUBLESHOOTING.md)

### Administrador de Sistema
1. Lee: [SCALE_INTEGRATION_GUIDE.md](SCALE_INTEGRATION_GUIDE.md)
2. Verifica requisitos del navegador
3. Instala navegador Chrome 89+ o Edge 89+
4. Habilita HTTPS si es necesario
5. Configura productos como "a granel" en inventario
6. Capacita a vendedores usando [QUICK_START.md](QUICK_START.md)

### Desarrollador
1. Lee: [SCALE_IMPLEMENTATION_SUMMARY.md](SCALE_IMPLEMENTATION_SUMMARY.md)
2. Revisa: `public/js/scale-manager.js`
3. Estudia: [SCALE_EXAMPLES.js](SCALE_EXAMPLES.js)
4. Modifica según necesidades
5. Prueba en: `public/scale-test.html`

---

## 📋 Checklist de Configuración

### Primera Configuración
- [ ] Leer QUICK_START.md
- [ ] Instalar Chrome 89+ (u otro navegador compatible)
- [ ] Conectar balanza por USB
- [ ] Abrir scale-test.html
- [ ] Seleccionar protocolo
- [ ] Confirmar lectura de pesos
- [ ] Marcar productos como "a granel" en Inventario
- [ ] Probar en sales.html

### Antes de Usar en Producción
- [ ] Probar con múltiples balanzas (si aplica)
- [ ] Confirmar protocolos correctos
- [ ] Entrenar vendedores
- [ ] Limpiar caché del navegador
- [ ] Documentar protocolo en inventario

### Mantenimiento Continuo
- [ ] Actualizar navegadores regularmente
- [ ] Limpiar logs ocasionalmente
- [ ] Probar conexión regularmente
- [ ] Mantener cables en buen estado

---

## 🔗 Enlaces Útiles

### Documentación
- [QUICK_START.md](QUICK_START.md) - Comienza en 5 minutos
- [SCALE_INTEGRATION_GUIDE.md](SCALE_INTEGRATION_GUIDE.md) - Guía técnica completa
- [SCALE_TROUBLESHOOTING.md](SCALE_TROUBLESHOOTING.md) - Problemas y soluciones
- [SCALE_EXAMPLES.js](SCALE_EXAMPLES.js) - 10 ejemplos de código
- [SCALE_IMPLEMENTATION_SUMMARY.md](SCALE_IMPLEMENTATION_SUMMARY.md) - Resumen técnico

### Herramientas Online
- [Herramienta de Prueba](http://localhost/Tomodachi/public/scale-test.html)
- [Punto de Venta](http://localhost/Tomodachi/public/sales.html)
- [Inventario](http://localhost/Tomodachi/public/inventory.html)

### Especificaciones Externas
- [W3C Serial API Spec](https://wicg.github.io/serial/)
- [MDN WebSerial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [Chrome WebSerial](https://developer.chrome.com/articles/serial/)

---

## 📞 Soporte y Contacto

### Si algo no funciona
1. Abre [SCALE_TROUBLESHOOTING.md](SCALE_TROUBLESHOOTING.md)
2. Ejecuta [scale-test.html](http://localhost/Tomodachi/public/scale-test.html)
3. Descarga logs
4. Reporta con la información

### Navegadores Soportados
| Navegador | Versión | Estado |
|-----------|---------|--------|
| Chrome | 89+ | ✅ Completo |
| Edge | 89+ | ✅ Completo |
| Opera | 75+ | ✅ Completo |
| Firefox | Cualquiera | ❌ No soporta |
| Safari | Cualquiera | ❌ No soporta |

---

## 📈 Estadísticas de Implementación

```
Archivos Creados:          7
Archivos Modificados:      3
Líneas de Código:          ~2000
Documentación:             ~4000 líneas
Ejemplos Incluidos:        10
Protocolos Soportados:     3
Navegadores Soportados:    3
```

---

## 🎓 Glosario

- **WebSerial API**: API para acceso a puertos COM desde navegadores
- **Baud Rate**: Velocidad de transmisión de datos (bits por segundo)
- **Protocolo**: Formato específico en que la balanza envía datos
- **COM Port**: Puerto de comunicación serie (COM1, COM3, etc)
- **Listener**: Función que se ejecuta cuando ocurre un evento
- **Callback**: Función que se ejecuta como respuesta a algo
- **Parser**: Función que convierte string a número
- **Tara/Zero**: Poner la balanza a cero (sin peso)

---

## 📝 Historial de Cambios

### v1.0 - Release Inicial
- ✨ Soporte para 3 protocolos de balanzas
- ✨ WebSerial API integration
- ✨ Herramienta de prueba completa
- ✨ Modal mejorado con auto-lectura
- ✨ Documentación técnica
- ✨ 10 ejemplos de código
- ✨ Guía de solución de problemas

---

## 🏆 Características Principales

✅ **Múltiples Protocolos** - Genérico, Datalogic, Excell
✅ **Herramienta de Prueba** - Completa con simulador
✅ **Integración POS** - Botón ⚖️ en ventas
✅ **Auto-lectura** - Peso en modal automático
✅ **Bien Documentado** - Guías, ejemplos, troubleshooting
✅ **Fácil de Usar** - 5 minutos para configurar
✅ **Código Ejemplo** - 10 ejemplos completos
✅ **Soporte Offline** - Funciona localmente sin internet

---

## 🎯 Próximos Pasos

1. **Ahora**: Lee [QUICK_START.md](QUICK_START.md)
2. **Luego**: Abre [scale-test.html](http://localhost/Tomodachi/public/scale-test.html)
3. **Después**: Usa en [sales.html](http://localhost/Tomodachi/public/sales.html)
4. **Si hay problema**: Consulta [SCALE_TROUBLESHOOTING.md](SCALE_TROUBLESHOOTING.md)

---

**Última actualización**: 2024
**Versión**: 1.0
**Estado**: ✅ Producción Lista

