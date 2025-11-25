<?php
/**
 * Script de reparación de datos
 * Ejecutar una vez para asegurar que los productos tengan store_id correcto
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';

try {
    $db = new Database();
    
    echo "<h1>Diagnóstico de Productos</h1>";
    
    // 1. Verificar si la columna existe (si no falla el select)
    try {
        $products = $db->select("SELECT product_id, product_name, store_id FROM products LIMIT 5");
        echo "<p>✅ La columna store_id existe.</p>";
        
        // 2. Contar productos sin tienda asignada (store_id = 0)
        $orphaned = $db->selectOne("SELECT COUNT(*) as count FROM products WHERE store_id = 0");
        $count = $orphaned['count'];
        
        if ($count > 0) {
            echo "<p>⚠️ Se encontraron <strong>$count</strong> productos con store_id = 0.</p>";
            
            // 3. Corregir asignando a tienda 1
            $db->update("UPDATE products SET store_id = 1 WHERE store_id = 0");
            echo "<p>✅ Se han asignado $count productos a la Tienda Principal (ID 1).</p>";
        } else {
            echo "<p>✅ Todos los productos tienen una tienda asignada.</p>";
        }
        
        // 4. Mostrar muestra de datos
        $sample = $db->select("SELECT product_id, product_name, store_id FROM products LIMIT 5");
        echo "<pre>";
        print_r($sample);
        echo "</pre>";
        
    } catch (Exception $e) {
        echo "<p>❌ Error: " . $e->getMessage() . "</p>";
        echo "<p>Es probable que la migración de base de datos no se haya ejecutado completamente.</p>";
    }
    
} catch (Exception $e) {
    echo "Error de conexión: " . $e->getMessage();
}
