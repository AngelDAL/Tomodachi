-- =============================================
-- Migración 039: Menú de clientes (carta digital)
-- =============================================
-- Permite armar una carta pública por QR con los productos que el dueño elija,
-- mostrando promociones y clasificaciones, sin exponer costos ni inventario.
--
-- Alcance de esta migración (Fase 1):
--   menus        -> la carta configurable
--   menu_items   -> qué entra en la carta (producto suelto, categoría o etiqueta)
--   menu_visits  -> registro mínimo de accesos, para saber si el QR se usa
--
-- Las cuentas por mesa (dining_sessions / dining_order_items / dining_tables)
-- van en una migración posterior: son otra fase y no hacen falta aquí.
--
-- Idempotente (CREATE TABLE IF NOT EXISTS), así que se puede aplicar donde ya
-- existieran. Las mismas tablas están en database/schema.sql para instalaciones
-- nuevas.
-- =============================================

-- Tabla: menus
-- La carta que el dueño arma y publica. `public_token` es lo único que viaja en
-- el QR: identifica la carta, NO autoriza nada (el flujo de pedir/cobrar tiene su
-- propio control de sesión en fases posteriores).
CREATE TABLE IF NOT EXISTS menus (
    menu_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    -- mode: cómo se comporta la carta frente al pedido
    --   menu_only     -> solo consulta (menú electrónico)
    --   order_and_pay -> el comensal pide y paga por adelantado
    --   open_tab      -> el comensal pide, consume y paga al final (cuenta)
    mode ENUM('menu_only','order_and_pay','open_tab') NOT NULL DEFAULT 'menu_only',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    public_token VARCHAR(64) NOT NULL COMMENT 'Token público que viaja en el QR',
    -- require_staff_unlock: pedir exige que el personal abra la mesa antes
    require_staff_unlock TINYINT(1) NOT NULL DEFAULT 0,
    allow_notes TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Permitir notas por platillo',
    max_open_minutes INT NOT NULL DEFAULT 180 COMMENT 'Caducidad de una cuenta abierta',
    welcome_message VARCHAR(255) NULL,
    cover_image VARCHAR(255) NULL,
    show_promotions TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_menu_public_token (public_token),
    KEY idx_menu_store (store_id, is_active),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: menu_items
-- Cada renglón mete a la carta: un producto concreto, una categoría completa o
-- una etiqueta completa. Incluir por categoría/etiqueta hace que los productos
-- nuevos entren solos, sin rearmar la carta cada vez.
CREATE TABLE IF NOT EXISTS menu_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    menu_id INT NOT NULL,
    kind ENUM('product','category','tag') NOT NULL DEFAULT 'product',
    product_id INT NULL,
    category_id INT NULL,
    tag_id INT NULL,
    section VARCHAR(80) NULL COMMENT 'Nombre de sección visible en la carta',
    display_order INT NOT NULL DEFAULT 0,
    is_featured TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Destacado en la carta',
    is_hidden TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Excluido aunque lo incluya su grupo',
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_menu_item_menu (menu_id, display_order),
    KEY idx_menu_item_product (product_id),
    KEY idx_menu_item_category (category_id),
    KEY idx_menu_item_tag (tag_id),
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES product_tags(tag_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: menu_visits
-- Conteo de accesos por QR, para que el dueño vea si la carta se está usando.
-- Se guarda un hash del identificador de origen, no la IP en claro.
CREATE TABLE IF NOT EXISTS menu_visits (
    visit_id INT AUTO_INCREMENT PRIMARY KEY,
    menu_id INT NOT NULL,
    origin_hash VARCHAR(64) NULL COMMENT 'Hash del origen (privacidad)',
    user_agent VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_menu_visit_menu (menu_id, created_at),
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
