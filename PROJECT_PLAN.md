# Sistema de Punto de Venta (POS) - Tomodachi

## 📋 Descripción del Proyecto

Sistema de punto de venta multiusuario y multitienda desarrollado con tecnologías web nativas (PHP, MySQL, JavaScript, HTML, CSS) sin frameworks, permitiendo gestión completa de inventarios, ventas, usuarios y reportes.

---

## 🏗️ Arquitectura del Sistema

### Stack Tecnológico
- **Backend**: PHP 8.x (puro, sin frameworks)
- **Base de Datos**: MySQL 8.x
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Comunicación**: API REST con fetch API
- **Seguridad**: Prepared statements PDO para prevención de SQL injection

### Estructura de Directorios
```
Tomodachi/
├── config/
│   ├── database.php          # Configuración de conexión DB
│   └── constants.php          # Constantes del sistema
├── api/
│   ├── auth/
│   │   ├── login.php
│   │   ├── logout.php
│   │   └── verify_session.php
│   ├── users/
│   │   ├── create.php
│   │   ├── read.php
│   │   ├── update.php
│   │   └── delete.php
│   ├── stores/
│   │   ├── create.php
│   │   ├── read.php
│   │   └── update.php
│   ├── inventory/
│   │   ├── products.php
│   │   ├── categories.php
│   │   ├── stock.php
│   │   └── scanner.php
│   ├── sales/
│   │   ├── create_sale.php
│   │   ├── get_sales.php
│   │   └── sale_details.php
│   └── cash_register/
│       ├── open_register.php
│       ├── close_register.php
│       └── cash_movements.php
├── includes/
│   ├── Database.class.php     # Clase para manejo de DB
│   ├── Auth.class.php          # Autenticación
│   ├── Validator.class.php     # Validación de datos
│   └── Response.class.php      # Respuestas JSON estandarizadas
├── public/
│   ├── css/
│   │   ├── main.css
│   │   ├── login.css
│   │   └── dashboard.css
│   ├── js/
│   │   ├── app.js
│   │   ├── api.js             # Cliente API
│   │   ├── scanner.js         # Lector QR/Barras
│   │   ├── sales.js
│   │   └── inventory.js
│   ├── assets/
│   │   └── images/
│   ├── login.html
│   ├── dashboard.html
│   ├── inventory.html
│   ├── sales.html
│   └── reports.html
├── database/
│   └── schema.sql             # Esquema de base de datos
└── README.md
```

---

## 🗄️ Diseño de Base de Datos

### Tablas Principales

#### 1. **stores** (Tiendas)
```sql
- store_id (PK, INT, AUTO_INCREMENT)
- store_name (VARCHAR 100)
- address (VARCHAR 255)
- phone (VARCHAR 20)
- status (ENUM: 'active', 'inactive')
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### 2. **users** (Usuarios)
```sql
- user_id (PK, INT, AUTO_INCREMENT)
- store_id (FK -> stores)
- username (VARCHAR 50, UNIQUE)
- password_hash (VARCHAR 255)
- full_name (VARCHAR 100)
- email (VARCHAR 100)
- role (ENUM: 'admin', 'manager', 'cashier')
- status (ENUM: 'active', 'inactive')
- created_at (TIMESTAMP)
- last_login (TIMESTAMP)
```

#### 3. **categories** (Categorías de productos)
```sql
- category_id (PK, INT, AUTO_INCREMENT)
- category_name (VARCHAR 100)
- description (TEXT)
- created_at (TIMESTAMP)
```

#### 4. **products** (Productos)
```sql
- product_id (PK, INT, AUTO_INCREMENT)
- category_id (FK -> categories)
- product_name (VARCHAR 150)
- description (TEXT)
- barcode (VARCHAR 50, UNIQUE)
- qr_code (VARCHAR 100, UNIQUE)
- price (DECIMAL 10,2)
- cost (DECIMAL 10,2)
- min_stock (INT)
- status (ENUM: 'active', 'inactive')
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### 5. **inventory** (Inventario por tienda)
```sql
- inventory_id (PK, INT, AUTO_INCREMENT)
- store_id (FK -> stores)
- product_id (FK -> products)
- current_stock (INT)
- last_updated (TIMESTAMP)
- UNIQUE(store_id, product_id)
```

#### 6. **inventory_movements** (Movimientos de inventario)
```sql
- movement_id (PK, INT, AUTO_INCREMENT)
- store_id (FK -> stores)
- product_id (FK -> products)
- user_id (FK -> users)
- movement_type (ENUM: 'entry', 'exit', 'adjustment', 'sale', 'return')
- quantity (INT)
- previous_stock (INT)
- new_stock (INT)
- notes (TEXT)
- created_at (TIMESTAMP)
```

#### 7. **cash_registers** (Cajas registradoras)
```sql
- register_id (PK, INT, AUTO_INCREMENT)
- store_id (FK -> stores)
- user_id (FK -> users)
- opening_date (DATETIME)
- closing_date (DATETIME)
- initial_amount (DECIMAL 10,2)
- final_amount (DECIMAL 10,2)
- expected_amount (DECIMAL 10,2)
- difference (DECIMAL 10,2)
- status (ENUM: 'open', 'closed')
- notes (TEXT)
```

#### 8. **sales** (Ventas)
```sql
- sale_id (PK, INT, AUTO_INCREMENT)
- store_id (FK -> stores)
- user_id (FK -> users)
- register_id (FK -> cash_registers)
- sale_date (DATETIME)
- subtotal (DECIMAL 10,2)
- tax (DECIMAL 10,2)
- discount (DECIMAL 10,2)
- total (DECIMAL 10,2)
- payment_method (ENUM: 'cash', 'card', 'transfer', 'mixed')
- status (ENUM: 'completed', 'cancelled', 'refunded')
- created_at (TIMESTAMP)
```

#### 9. **sale_details** (Detalle de ventas)
```sql
- detail_id (PK, INT, AUTO_INCREMENT)
- sale_id (FK -> sales)
- product_id (FK -> products)
- quantity (INT)
- unit_price (DECIMAL 10,2)
- subtotal (DECIMAL 10,2)
- discount (DECIMAL 10,2)
- total (DECIMAL 10,2)
```

#### 10. **cash_movements** (Movimientos de caja)
```sql
- movement_id (PK, INT, AUTO_INCREMENT)
- register_id (FK -> cash_registers)
- user_id (FK -> users)
- movement_type (ENUM: 'entry', 'withdrawal', 'sale')
- amount (DECIMAL 10,2)
- description (VARCHAR 255)
- created_at (TIMESTAMP)
```

---

## 🔐 Sistema de Autenticación y Seguridad

### Características de Seguridad
1. **Passwords**: Hash con `password_hash()` y `password_verify()`
2. **SQL Injection**: Uso exclusivo de prepared statements con PDO
3. **Sessions**: Gestión segura con regeneración de ID
4. **CSRF Protection**: Tokens para formularios críticos
5. **XSS Prevention**: Sanitización de inputs con `htmlspecialchars()`
6. **Rate Limiting**: Control de intentos de login

### Roles y Permisos
- **Admin**: Acceso total, gestión de tiendas y usuarios
- **Manager**: Gestión de inventario, ventas, reportes de su tienda
- **Cashier**: Realizar ventas, consultar productos, abrir/cerrar caja

---

## 📦 Módulos Principales

### 1. **Módulo de Autenticación**
**Funcionalidades:**
- Login con usuario/contraseña
- Verificación de sesión activa
- Logout seguro
- Recuperación de contraseña (opcional)

**APIs:**
- `POST /api/auth/login.php`
- `GET /api/auth/verify_session.php`
- `POST /api/auth/logout.php`

---

### 2. **Módulo de Usuarios**
**Funcionalidades:**
- Crear usuarios por tienda
- Asignar roles y permisos
- Activar/desactivar usuarios
- Historial de actividad

**APIs:**
- `POST /api/users/create.php`
- `GET /api/users/read.php?store_id={id}`
- `PUT /api/users/update.php`
- `DELETE /api/users/delete.php`

---

### 3. **Módulo de Tiendas**
**Funcionalidades:**
- Registro de sucursales
- Configuración por tienda
- Estadísticas generales

**APIs:**
- `POST /api/stores/create.php`
- `GET /api/stores/read.php`
- `PUT /api/stores/update.php`

---

### 4. **Módulo de Inventario**
**Funcionalidades:**
- Alta/baja de productos
- Gestión de categorías
- Control de stock por tienda
- Alertas de stock mínimo
- Escaneo de códigos QR/barras
- Movimientos de inventario (entradas/salidas)
- Transferencias entre tiendas (opcional)

**APIs:**
- `POST /api/inventory/products.php` (crear)
- `GET /api/inventory/products.php?store_id={id}` (listar)
- `PUT /api/inventory/products.php` (actualizar)
- `POST /api/inventory/stock.php` (ajustar stock)
- `GET /api/inventory/scanner.php?code={barcode}` (buscar por código)

**Frontend:**
- Tabla de productos con búsqueda/filtros
- Formulario de alta de productos
- Lector de códigos con cámara (usando `getUserMedia API`)
- Modal de ajuste de inventario

---

### 5. **Módulo de Ventas**
**Funcionalidades:**
- Interfaz de punto de venta
- Búsqueda rápida de productos
- Escaneo de códigos en tiempo real
- Cálculo automático de totales
- Aplicación de descuentos
- Múltiples métodos de pago
- Impresión de tickets (opcional)
- Cancelación/devolución de ventas

**APIs:**
- `POST /api/sales/create_sale.php`
- `GET /api/sales/get_sales.php?store_id={id}&date={date}`
- `GET /api/sales/sale_details.php?sale_id={id}`
- `POST /api/sales/cancel_sale.php`

**Frontend:**
- Carrito de compra dinámico
- Escáner de productos
- Calculadora de cambio
- Resumen de venta

---

### 6. **Módulo de Caja**
**Funcionalidades:**
- Apertura de caja con fondo inicial
- Registro de ventas en turno
- Entradas/salidas de efectivo
- Cierre de caja con arqueo
- Cálculo de diferencias
- Historial de cortes

**APIs:**
- `POST /api/cash_register/open_register.php`
- `POST /api/cash_register/close_register.php`
- `POST /api/cash_register/cash_movements.php`
- `GET /api/cash_register/current_register.php`

**Frontend:**
- Modal de apertura/cierre de caja
- Tabla de movimientos del día
- Formulario de arqueo

---

### 7. **Módulo de Reportes**
**Funcionalidades:**
- Ventas por período
- Productos más vendidos
- Ventas por usuario/tienda
- Inventario actual
- Historial de movimientos
- Exportación a CSV/PDF (opcional)

**APIs:**
- `GET /api/reports/sales.php?start_date={}&end_date={}`
- `GET /api/reports/inventory.php?store_id={}`
- `GET /api/reports/top_products.php`

---

## 🎯 Funcionalidad de Escaneo QR/Códigos de Barras

### Implementación Frontend (JavaScript)

**Tecnologías:**
- **HTML5 getUserMedia API**: Acceso a cámara
- **Librerías sugeridas**:
  - `html5-qrcode` (lightweight, sin dependencias)
  - `QuaggaJS` (códigos de barras)
  - `jsQR` (QR codes)

**Flujo de escaneo:**
1. Usuario activa cámara desde interfaz de venta o inventario
2. JavaScript captura video en tiempo real
3. Librería detecta código en frame
4. Se envía código a API para búsqueda
5. Sistema agrega producto al carrito/inventario automáticamente

**Código ejemplo (estructura básica):**
```javascript
// js/scanner.js
async function startScanner() {
    const scanner = new Html5QrcodeScanner("scanner-container", {
        fps: 10,
        qrbox: 250
    });
    
    scanner.render(onScanSuccess, onScanError);
}

function onScanSuccess(decodedText) {
    searchProductByCode(decodedText);
}
```

---

## 🔄 Flujos de Trabajo Principales

### Flujo 1: Realizar una Venta
1. Cajero abre caja al inicio del turno
2. Accede al módulo de ventas
3. Escanea productos o busca manualmente
4. Sistema valida stock disponible
5. Productos se agregan al carrito
6. Cajero aplica descuentos (si tiene permisos)
7. Selecciona método de pago
8. Sistema procesa venta:
   - Guarda venta en BD
   - Reduce inventario automáticamente
   - Registra movimiento de caja
   - Genera ticket
9. Imprime/muestra ticket

### Flujo 2: Cierre de Caja
1. Cajero solicita cierre de caja
2. Sistema muestra resumen del día:
   - Ventas totales
   - Entradas/salidas de efectivo
   - Total esperado
3. Cajero ingresa monto físico contado
4. Sistema calcula diferencia
5. Se registra cierre con observaciones
6. Reporte de corte generado

### Flujo 3: Ajuste de Inventario
1. Manager accede a inventario
2. Busca producto a ajustar
3. Ingresa nueva cantidad y motivo
4. Sistema registra:
   - Stock anterior
   - Stock nuevo
   - Usuario responsable
   - Timestamp
5. Se actualiza inventario

### Flujo 4: Alta de Producto
1. Manager crea nuevo producto
2. Asigna categoría y precios
3. Genera/asigna código de barras/QR
4. Define stock inicial por tienda
5. Sistema valida duplicados
6. Producto disponible para venta

---

## 🛡️ Validaciones y Prevención SQL Injection

### Clase Database (PDO con Prepared Statements)

```php
// includes/Database.class.php
class Database {
    private $conn;
    
    public function query($sql, $params = []) {
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }
    
    public function select($sql, $params = []) {
        $stmt = $this->query($sql, $params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    
    public function insert($sql, $params = []) {
        $this->query($sql, $params);
        return $this->conn->lastInsertId();
    }
}
```

### Ejemplo de Uso Seguro

```php
// ❌ INCORRECTO (vulnerable a SQL injection)
$sql = "SELECT * FROM users WHERE username = '$username'";

// ✅ CORRECTO (prepared statement)
$sql = "SELECT * FROM users WHERE username = ?";
$result = $db->select($sql, [$username]);
```

### Validaciones en Clase Validator

```php
// includes/Validator.class.php
class Validator {
    public static function sanitizeString($data) {
        return htmlspecialchars(strip_tags(trim($data)));
    }
    
    public static function validateEmail($email) {
        return filter_var($email, FILTER_VALIDATE_EMAIL);
    }
    
    public static function validateNumeric($number, $min = null, $max = null) {
        if (!is_numeric($number)) return false;
        if ($min !== null && $number < $min) return false;
        if ($max !== null && $number > $max) return false;
        return true;
    }
}
```

---

## 📱 Interfaz de Usuario (UI/UX)

### Pantallas Principales

1. **Login**: Formulario simple con usuario/contraseña
2. **Dashboard**: Resumen de ventas del día, alertas, accesos rápidos
3. **Punto de Venta**: Grid de productos + carrito + escáner
4. **Inventario**: Tabla con búsqueda, filtros por categoría/stock
5. **Reportes**: Gráficos y tablas con filtros de fecha
6. **Configuración**: Gestión de usuarios, tiendas, categorías

### Consideraciones de Diseño
- **Responsive**: Adaptable a tablets (uso en tiendas)
- **Teclado shortcuts**: Para agilizar ventas
- **Búsqueda rápida**: Autocompletado en inputs
- **Feedback visual**: Notificaciones de éxito/error
- **Accesibilidad**: Contraste adecuado, tamaños de fuente

---

## 🚀 Plan de Implementación

### Fase 1: Fundamentos (Semana 1-2)
- [ ] Configurar estructura de directorios
- [ ] Crear esquema de base de datos
- [ ] Implementar clase Database con PDO
- [ ] Desarrollar sistema de autenticación
- [ ] Crear templates HTML base

### Fase 2: Módulos Core (Semana 3-4)
- [ ] CRUD de usuarios y tiendas
- [ ] CRUD de productos y categorías
- [ ] Sistema de inventario básico
- [ ] APIs REST para todos los módulos

### Fase 3: Punto de Venta (Semana 5-6)
- [ ] Interfaz de ventas
- [ ] Integración de escáner QR/barras
- [ ] Carrito de compra dinámico
- [ ] Procesamiento de ventas
- [ ] Sistema de caja (apertura/cierre)

### Fase 4: Reportes y Optimización (Semana 7-8)
- [ ] Módulo de reportes
- [ ] Dashboard con estadísticas
- [ ] Optimización de consultas
- [ ] Testing y corrección de bugs
- [ ] Documentación final

---

## 📚 APIs REST - Especificaciones

### Estándar de Respuestas JSON

```json
{
    "success": true,
    "message": "Operación exitosa",
    "data": { /* datos solicitados */ },
    "error": null
}
```

### Autenticación
Todas las APIs (excepto login) requieren sesión activa. Validar en cada endpoint:

```php
session_start();
if (!isset($_SESSION['user_id'])) {
    Response::error('No autorizado', 401);
}
```

### Ejemplos de Endpoints

**GET /api/inventory/products.php?store_id=1**
```json
{
    "success": true,
    "data": [
        {
            "product_id": 1,
            "product_name": "Coca Cola 600ml",
            "barcode": "7501234567890",
            "price": 15.50,
            "current_stock": 45
        }
    ]
}
```

**POST /api/sales/create_sale.php**
```json
Request:
{
    "store_id": 1,
    "items": [
        {"product_id": 1, "quantity": 2, "price": 15.50}
    ],
    "payment_method": "cash",
    "total": 31.00
}

Response:
{
    "success": true,
    "message": "Venta registrada",
    "data": {
        "sale_id": 1234,
        "ticket_number": "001-1234"
    }
}
```

---

## 🧪 Testing y Validación

### Checklist de Pruebas
- [ ] Validar prepared statements en todos los queries
- [ ] Probar inyección SQL en formularios
- [ ] Verificar sesiones y permisos por rol
- [ ] Test de concurrencia en ventas
- [ ] Validar cálculos de inventario
- [ ] Probar escáner con diferentes dispositivos
- [ ] Verificar integridad de cortes de caja

---

## 📝 Consideraciones Adicionales

### Rendimiento
- Índices en columnas de búsqueda frecuente (barcode, product_name)
- Paginación en listados grandes
- Cache de productos activos

### Escalabilidad
- Diseño permite agregar más tiendas sin modificar estructura
- Sistema de permisos extensible
- APIs desacopladas del frontend

### Backup y Seguridad
- Respaldos diarios de base de datos
- Logs de operaciones críticas
- Cifrado de contraseñas con algoritmo actual (bcrypt)

---

## 🎓 Recursos y Referencias

### Documentación Útil
- [PHP PDO Documentation](https://www.php.net/manual/es/book.pdo.php)
- [JavaScript Fetch API](https://developer.mozilla.org/es/docs/Web/API/Fetch_API)
- [HTML5 QR Code Scanner](https://github.com/mebjas/html5-qrcode)

### Buenas Prácticas
- Nunca confiar en datos del cliente
- Siempre validar en servidor (backend)
- Logs de actividad para auditoría
- Comentarios en código para mantenibilidad

---

## 📞 Notas de Desarrollo

Este documento es una guía de referencia. Cada módulo debe ser desarrollado siguiendo los principios SOLID y manteniendo el código limpio y documentado.

**Versión**: 1.0  
**Última actualización**: 21 de noviembre de 2025
