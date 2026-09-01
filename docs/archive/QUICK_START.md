# 🚀 INICIO RÁPIDO - Balanzas en Tomodachi

## En 5 minutos, comienza a usar balanzas

### ¿Tienes todo?
- ✅ Balanza conectada por USB/Serial
- ✅ Chrome 89+, Edge 89+, u Opera 75+
- ✅ Acceso a Tomodachi en navegador

### Los 3 Pasos

#### 1️⃣ Prueba tu Balanza (2 min)
Abre esta herramienta interactiva en tu navegador:
```
http://localhost/Tomodachi/public/scale-test.html
```

**En la herramienta:**
1. Selecciona protocolo (empieza con "Genérico")
2. Presiona "Conectar"
3. Selecciona tu balanza en el menú
4. Coloca peso en la balanza
5. ¿Ves el número? ✓ ¡Funciona!

Si no ves el número:
- Intenta los otros protocolos (Datalogic, Excell)
- O mira SCALE_TROUBLESHOOTING.md

#### 2️⃣ Conecta en Punto de Venta (1 min)
1. Abre: http://localhost/Tomodachi/public/sales.html
2. Busca botón ⚖️ en la barra superior
3. Presiona botón ⚖️
4. Selecciona el mismo protocolo que funcionó
5. Indicador debe decir "Conectada" ✓

#### 3️⃣ Vende a Granel (2 min)
1. Busca un producto marcado como "a granel" en inventario
2. Agrégalo al carrito
3. Aparecerá modal pidiendo cantidad
4. Verás el peso en tiempo real
5. Presiona "Usar Peso de Balanza" para auto-completar
6. ¡Listo! Vende como siempre

---

## Cheat Sheet - Protocolos

No sabes cuál protocolo tienes? Prueba en este orden:

| # | Protocolo | Cuando Usar | Baud Rate |
|---|-----------|------------|-----------|
| 1 | **Genérico** | Balanzas básicas / No sabes | 9600 |
| 2 | **Datalogic** | Balanzas profesionales | 9600 |
| 3 | **Excell** | Balanzas chinas / Excell | 1200 |

En scale-test.html prueba los tres automáticamente hasta encontrar el correcto.

---

## Problemas Comunes (y Soluciones Rápidas)

### "No aparece mi balanza en el selector"
👉 Desconecta y reconecta el cable USB

### "Dice conectada pero no ve pesos"
👉 Intenta otro protocolo en scale-test.html

### "Error: WebSerial no soportado"
👉 Usa Chrome, Edge, u Opera (no Firefox)

### "Funciona en scale-test.html pero no en Ventas"
👉 Recarga la página de Ventas (Ctrl+F5)

### "La balanza muestra números raros"
👉 Probablemente protocolo incorrecto - intenta otro

---

## Configuración Inicial (Primera Vez)

### Si tu balanza es NUEVA

1. **Abre Inventario**
   - http://localhost/Tomodachi/public/inventory.html

2. **Edita un Producto**
   - Busca producto que venderás a granel
   - Presiona editar

3. **Marca como Granel**
   - Chequea: "Producto a Granel"
   - Selecciona unidad: kg (o la que uses)
   - Guarda

4. **Repite** con otros productos a granel

5. **Ahora en Ventas**
   - Busca ese producto
   - Debería mostrar opción especial para cantidad

---

## Video Tutorial (Paso a Paso)

```
1. PREPARACIÓN (30 seg)
   ├─ Conecta balanza por USB
   ├─ Abre Chrome/Edge
   └─ Ve a scale-test.html

2. PRUEBA (1 min)
   ├─ Selecciona protocolo
   ├─ Presiona Conectar
   ├─ Coloca peso
   └─ Confirma que ves número

3. INTEGRACIÓN (1 min)
   ├─ Ve a sales.html
   ├─ Presiona botón ⚖️
   └─ Selecciona protocolo

4. OPERACIÓN (2 min)
   ├─ Busca producto a granel
   ├─ Presiona para agregar
   ├─ Presiona "Usar Peso de Balanza"
   ├─ Confirma cantidad
   └─ ¡A vender!
```

---

## Atajos Útiles

### En scale-test.html
- **Conectar**: Botón grande azul
- **Simular peso**: Campo numérico + botón "Simular"
- **Ver logs**: Scroll en área gris
- **Descargar diagnóstico**: Botón "Descargar"

### En sales.html
- **Balanza**: Botón ⚖️ en barra superior derecha
- **Estado**: Verde = conectada, Gris = desconectada
- **Peso actual**: Muestra en tiempo real cuando conectada

### En Inventario
- **Marcar granel**: Checkbox en edición de producto
- **Unidad**: Dropdown (kg, g, L, mL, lb, oz, pza, m)

---

## FAQ Rápidas

**P: ¿Funciona con cualquier balanza?**
R: Con la mayoría. Si envía datos por puerto COM, probablemente sí.

**P: ¿Necesito HTTPS?**
R: No en localhost. En producción sí.

**P: ¿Se pierden datos si se desconecta?**
R: No. Puedes ingresar peso manualmente.

**P: ¿Puedo usar múltiples balanzas?**
R: Actualmente una a la vez. Desconecta para cambiar.

**P: ¿Los datos se envían a internet?**
R: No. Todo local, entre tu navegador y la balanza.

**P: ¿Es gratis?**
R: Sí. WebSerial API es estándar del navegador.

---

## Próximos Pasos

### Más Documentación
- `SCALE_INTEGRATION_GUIDE.md` - Guía técnica completa
- `SCALE_TROUBLESHOOTING.md` - Solución de problemas
- `SCALE_EXAMPLES.js` - Ejemplos de código
- `SCALE_IMPLEMENTATION_SUMMARY.md` - Resumen técnico

### Para Técnicos
- Mira `scale-manager.js` para entender cómo funciona
- `scale-test.html` es buen ejemplo de uso
- `sales.js` muestra integración en POS

### Para Vendedores
- Simplemente usa sales.html como siempre
- El botón ⚖️ hace el trabajo automático
- Sin nada especial que aprender

---

## 🆘 Soporte

Si algo no funciona:

1. **Intenta scale-test.html** - Diagnostica ahí primero
2. **Lee SCALE_TROUBLESHOOTING.md** - Responde a casi todo
3. **Descarga el log** - En scale-test.html presiona "Descargar"
4. **Reporta con el log** - Ayuda a diagnosticar

---

## Checklist de Configuración

- [ ] Balanza conectada por USB/Serial
- [ ] Navegador Chrome 89+ (u otro compatible)
- [ ] Acceso a Tomodachi
- [ ] Abierto scale-test.html
- [ ] Seleccionado protocolo correcto
- [ ] Conectado exitosamente
- [ ] Viendo pesos en tiempo real
- [ ] Productos marcados como granel en Inventario
- [ ] Vendiendo desde sales.html
- [ ] Auto-completando pesos con balanza

---

## ¡Listo! 🎉

Ya está todo configurado. 

**Ahora:**
- 📊 Ve a sales.html
- 🔍 Busca productos a granel
- ⚖️ Deja que la balanza haga el trabajo

Ahorra tiempo, reduce errores, vende más rápido.

---

**Última actualización**: 2024
**Versión**: 1.0
**Navegadores**: Chrome 89+, Edge 89+, Opera 75+
**Tiempo de setup**: ~5 minutos

