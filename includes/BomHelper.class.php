<?php
/**
 * BomHelper - Motor de Inventario por Recetas (BOM) y Unidades Comerciales (cajas/lotes)
 *
 * Centraliza la lógica de inventario compuesto:
 *   - Explosión de recetas (product_ingredients) hasta ingredientes-hoja.
 *   - Disponibilidad derivada de un ensamblado (tracking_type='recipe'):
 *     floor( min_hoja( piezas_disponibles / necesarias_por_unidad ) ).
 *   - Costo unitario ensamblado = Σ (cantidad_por_unidad × costo_pieza) a través
 *     de la receta (soporta anidamiento, con detección de ciclos).
 *   - Vista de lotes/cajas derivada: dado un total de piezas y piezas_por_caja,
 *     se presenta "cajas completas + lote abierto" (invariante: total).
 *   - Consumo / restitución de ingredientes al vender o cancelar/devolver un
 *     ensamblado (siempre dentro de la transacción del llamador).
 *
 * Modelo:
 *   - Ingrediente con cajas: current_stock = TOTAL de piezas; pieces_per_box = cajas.
 *   - Ensamblado (recipe): current_stock = 0 (ignorado); su stock se deriva de la receta.
 *   - 'none': servicio, sin inventario.
 */
require_once __DIR__ . '/../includes/Database.class.php';

class BomHelper {

    private $db;
    /** Caché por instancia de metadatos de producto: pid => [tracking_type, cost, current_stock, pieces_per_box, product_name] */
    private $_meta = [];

    public function __construct($db) {
        $this->db = $db;
    }

    /** Valida/normaliza tracking_type (backward-compat para filas sin valor). */
    public function normalizeType($t) {
        $t = (string)$t;
        return in_array($t, ['stock', 'recipe', 'component', 'none'], true) ? $t : 'stock';
    }

    /** Valida/normaliza consume_mode (backward-compat). Default FIFO. */
    public function normalizeConsume($m) {
        $m = (string)$m;
        return in_array($m, [CONSUME_FIFO, CONSUME_LIFO, CONSUME_MANUAL], true) ? $m : CONSUME_FIFO;
    }

    /**
     * Presentaciones (lotes) de un componente y su costo promedio ponderado.
     * @return array ['total'=>float, 'unit_cost'=>float, 'lots'=>[ ['lot_id','label','quantity','unit_cost'], ... ]]
     */
    public function blend($store_id, $pid) {
        $lots = $this->db->select(
            'SELECT lot_id, label, quantity, unit_cost FROM product_lots
             WHERE product_id = ? AND store_id = ? ORDER BY lot_id ASC',
            [$pid, $store_id]
        );
        $total = 0.0;
        $weighted = 0.0;
        foreach ($lots as &$L) {
            $L['quantity'] = (float)$L['quantity'];
            $L['unit_cost'] = (float)$L['unit_cost'];
            $total += $L['quantity'];
            $weighted += $L['quantity'] * $L['unit_cost'];
        }
        unset($L);
        $unit_cost = ($total > 0) ? ($weighted / $total) : 0.0;
        return ['total' => $total, 'unit_cost' => $unit_cost, 'lots' => $lots];
    }

    /**
     * Metadatos de un producto con caché por instancia.
     * @return array['product_id','tracking_type','cost','current_stock','pieces_per_box','product_name']
     */
    public function meta($store_id, $pid) {
        $pid = (int)$pid;
        if (isset($this->_meta[$pid])) {
            return $this->_meta[$pid];
        }
        $row = $this->db->selectOne(
            'SELECT product_id, tracking_type, consume_mode, cost, current_stock, pieces_per_box, product_name
             FROM products WHERE product_id = ? AND store_id = ?',
            [$pid, $store_id]
        );
        if (!$row) {
            throw new Exception("Producto no existe o no pertenece a la tienda (ID $pid)", 404);
        }
        $row['tracking_type'] = $this->normalizeType($row['tracking_type']);
        $row['consume_mode'] = $this->normalizeConsume($row['consume_mode']);
        $row['cost'] = (float)$row['cost'];
        $row['current_stock'] = (float)$row['current_stock'];
        $this->_meta[$pid] = $row;
        return $row;
    }

    /** Invalida/actualiza el caché de current_stock tras una mutación. */
    private function setCachedStock($pid, $newStock) {
        if (isset($this->_meta[$pid])) {
            $this->_meta[$pid]['current_stock'] = (float)$newStock;
        }
    }

    /**
     * ¿El producto se descompone en componentes? True para 'recipe' (ensamblado)
     * y para un servicio ('none') que tenga composición definida (p. ej. un pulido
     * consume cera). Un servicio SIN componentes no consume existencias.
     */
    private function isAssembly($store_id, $pid) {
        $m = $this->meta($store_id, $pid);
        if ($m['tracking_type'] === 'recipe') return true;
        if ($m['tracking_type'] === 'none') {
            $r = $this->db->selectOne('SELECT COUNT(*) AS c FROM product_ingredients WHERE product_id=?', [$pid]);
            return ((int)$r['c']) > 0;
        }
        return false;
    }

    /**
     * Explosión de una receta hasta hojas (ingredientes no-ensamblados con stock).
     * @return array  leaf_product_id => cantidad total requerida (escalada por $mult)
     * @throws Exception si hay ciclo o un ensamblado sin ingredientes.
     */
    private function explodeInto($store_id, $pid, $mult, &$leaves, &$stack) {
        $m = $this->meta($store_id, $pid);
        if ($this->isAssembly($store_id, $pid)) {
            if (isset($stack[$pid])) {
                throw new Exception("Ciclo detectado en la receta del producto #$pid", 400);
            }
            $stack[$pid] = true;
            $rows = $this->db->select(
                'SELECT component_id, quantity FROM product_ingredients WHERE product_id = ? ORDER BY recipe_id ASC',
                [$pid]
            );
            if (!$rows) {
                throw new Exception("El producto ensamblado #$pid no tiene ingredientes definidos", 400);
            }
            foreach ($rows as $r) {
                $this->explodeInto($store_id, (int)$r['component_id'], $mult * (float)$r['quantity'], $leaves, $stack);
            }
            unset($stack[$pid]);
        } elseif ($m['tracking_type'] !== 'none') {
            // Hoja de stock (ingrediente real). Un servicio puro ('none' sin composición)
            // no consume existencias.
            $leaves[$pid] = ($leaves[$pid] ?? 0.0) + $mult;
        }
    }

    /** Cantidad por hoja para UNA unidad del ensamblado. */
    public function leavesForUnit($store_id, $product_id) {
        $leaves = [];
        $stack = [];
        $this->explodeInto($store_id, $product_id, 1.0, $leaves, $stack);
        return $leaves;
    }

    /**
     * Costo unitario del producto:
     *   - stock/none → products.cost
     *   - recipe → Σ (qty_por_unidad × costo) recursivo sobre la receta.
     */
    public function unitCost($store_id, $product_id) {
        $stack = [];
        return (float)$this->costInto($store_id, $product_id, $stack);
    }

    private function costInto($store_id, $pid, &$stack) {
        $m = $this->meta($store_id, $pid);
        if ($m['tracking_type'] === TRACKING_COMPONENT) {
            return $this->blend($store_id, $pid)['unit_cost'];
        }
        if (!$this->isAssembly($store_id, $pid)) {
            return $m['cost'];
        }
        if (isset($stack[$pid])) {
            throw new Exception("Ciclo detectado en la receta del producto #$pid", 400);
        }
        $stack[$pid] = true;
        $rows = $this->db->select(
            'SELECT component_id, quantity FROM product_ingredients WHERE product_id = ?',
            [$pid]
        );
        $cost = 0.0;
        foreach ($rows as $r) {
            $cost += (float)$r['quantity'] * $this->costInto($store_id, (int)$r['component_id'], $stack);
        }
        unset($stack[$pid]);
        return $cost;
    }

    /**
     * Disponibilidad y costo derivados de un producto.
     * - Para 'recipe': min sobre hojas de floor(piezas / necesarias_por_unidad).
     * - Para 'stock': current_stock tal cual.
     * - Para 'none': infinito (no controlable).
     * @return array ['available','limiting','unit_cost','ingredients','derived']
     */
    public function availability($store_id, $product_id) {
        $m = $this->meta($store_id, $product_id);
        if ($m['tracking_type'] === TRACKING_COMPONENT) {
            $b = $this->blend($store_id, $product_id);
            return [
                'available' => $b['total'],
                'limiting' => null,
                'unit_cost' => $b['unit_cost'],
                'ingredients' => [],
                'derived' => false,
                'tracking_type' => 'component',
                'lots' => $b['lots'],
            ];
        }
        if (!$this->isAssembly($store_id, $product_id)) {
            $available = ($m['tracking_type'] === 'none')
                ? PHP_INT_MAX
                : (float)$m['current_stock'];
            return [
                'available' => $available,
                'limiting' => null,
                'unit_cost' => $m['cost'],
                'ingredients' => [],
                'derived' => false,
                'tracking_type' => $m['tracking_type'],
            ];
        }
        $leaves = $this->leavesForUnit($store_id, $product_id);
        $unit = PHP_INT_MAX;
        $limiting = null;
        $ingredients = [];
        foreach ($leaves as $lid => $need) {
            $lm = $this->meta($store_id, $lid);
            $avail = (float)$lm['current_stock'];
            if ($lm['tracking_type'] === TRACKING_COMPONENT) {
                // Hoja=componente: su disponible es la Σ de sus presentaciones.
                $avail = $this->blend($store_id, $lid)['total'];
            }
            $units = ($need > 0) ? (int)floor($avail / $need) : PHP_INT_MAX;
            $ingredients[] = [
                'product_id' => $lid,
                'name' => $lm['product_name'],
                'needed_per_unit' => $need,
                'available_pieces' => $avail,
                'units_possible' => $units,
            ];
            if ($need > 0 && $units < $unit) {
                $unit = $units;
                $limiting = $lm['product_name'];
            }
        }
        if ($unit === PHP_INT_MAX) {
            // Sin ingredientes de stock (p. ej. receta de solo servicios) → sin límite.
            $unit = PHP_INT_MAX;
        }
        return [
            'available' => $unit,
            'limiting' => $limiting,
            'unit_cost' => $this->unitCost($store_id, $product_id),
            'ingredients' => $ingredients,
            'derived' => true,
            'tracking_type' => $m['tracking_type'],
        ];
    }

    /**
     * Vista de lotes/cajas derivada a partir del total de piezas y piezas_por_caja.
     *   $ppb > 0: cajas_completas = floor(total/ppb); lote_abierto = total mod ppb.
     *   $ppb <= 0: sin seguimiento por cajas (total = piezas sueltas).
     */
    public function deriveLots($total, $ppb) {
        $total = (float)$total;
        $ppb = (int)(($ppb === null) ? 0 : $ppb);
        if ($ppb > 0) {
            $full = (int)floor($total / $ppb);
            $open = $total - ($full * $ppb);
        } else {
            $full = 0;
            $open = $total;
        }
        return [
            'total' => $total,
            'full_boxes' => $full,
            'opened' => $open,
            'pieces_per_box' => $ppb,
        ];
    }

    /**
     * Consume ingredientes-hoja de un ensamblado (venta). Debe llamarse DENTRO de
     * una transacción abierta. Registra movimiento 'exit' por ingrediente-hoja.
     * No valida stock (ya lo hizo Pricing); solo aplica el descuento.
     * @param float $qty  unidades del ensamblado vendidas.
     * @param array $lotOverrides  [product_id => lot_id] selección explícita de presentación
     *                             (utilizado en modo 'manual' de ese componente).
     */
    public function consumeForSale($db, $store_id, $user_id, $sale_id, $product_id, $qty, $lotOverrides = []) {
        $leaves = [];
        $stack = [];
        $this->explodeInto($store_id, $product_id, (float)$qty, $leaves, $stack);
        foreach ($leaves as $lid => $need) {
            $m = $this->meta($store_id, $lid);
            if ($m['tracking_type'] === 'none') continue;
            if ($m['tracking_type'] === TRACKING_COMPONENT) {
                $this->consumeLots($db, $store_id, $user_id, $lid, $need, 'Compone venta #'.$sale_id, $m['consume_mode'], $lotOverrides[$lid] ?? null);
                continue;
            }
            $prev = $m['current_stock'];
            $new = $prev - $need;
            $db->update(
                'UPDATE products SET current_stock = ?, updated_at = NOW() WHERE product_id = ? AND store_id = ?',
                [$new, $lid, $store_id]
            );
            $db->insert(
                'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',
                [$store_id, $lid, $user_id, MOVEMENT_EXIT, $need, $prev, $new, 'Compone venta #'.$sale_id]
            );
            $this->setCachedStock($lid, $new);
        }
    }

    /**
     * Consume cantidades de un componente desde sus presentaciones.
     * Orden según consume_mode:
     *   fifo   → presentación más antigua (lot_id ASC).
     *   lifo   → presentación más reciente (lot_id DESC).
     *   manual → SOLO la presentación indicada en $lotId; si no se indica, cae a fifo.
     */
    private function consumeLots($db, $store_id, $user_id, $pid, $need, $note, $consumeMode = CONSUME_FIFO, $lotId = null) {
        $consumeMode = $this->normalizeConsume($consumeMode);
        if ($consumeMode === CONSUME_MANUAL && $lotId !== null) {
            $lots = $this->db->select(
                'SELECT lot_id, quantity FROM product_lots WHERE product_id=? AND store_id=? AND lot_id=? AND quantity > 0',
                [$pid, $store_id, (int)$lotId]
            );
        } else {
            $order = ($consumeMode === CONSUME_LIFO) ? 'DESC' : 'ASC';
            $lots = $this->db->select(
                'SELECT lot_id, quantity FROM product_lots WHERE product_id=? AND store_id=? AND quantity > 0 ORDER BY lot_id '.$order,
                [$pid, $store_id]
            );
        }
        $remaining = (float)$need;
        foreach ($lots as $L) {
            if ($remaining <= 0) break;
            $qty = (float)$L['quantity'];
            $use = ($qty >= $remaining) ? $remaining : $qty;
            $newQty = $qty - $use;
            $this->db->update('UPDATE product_lots SET quantity=? WHERE lot_id=?', [$newQty, (int)$L['lot_id']]);
            $this->db->insert(
                'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',
                [$store_id, $pid, $user_id, MOVEMENT_EXIT, $use, $qty, $newQty, $note]
            );
            $remaining -= $use;
        }
    }

    /**
     * Restituye ingredientes-hoja de un ensamblado (cancelación/devolución).
     * Debe llamarse DENTRO de una transacción abierta. Movimiento 'return'.
     */
    public function restoreForSale($db, $store_id, $user_id, $sale_id, $product_id, $qty, $note) {
        $leaves = [];
        $stack = [];
        $this->explodeInto($store_id, $product_id, (float)$qty, $leaves, $stack);
        foreach ($leaves as $lid => $need) {
            $m = $this->meta($store_id, $lid);
            if ($m['tracking_type'] === 'none') continue;
            if ($m['tracking_type'] === TRACKING_COMPONENT) {
                $this->restoreLots($db, $store_id, $user_id, $lid, $need, $note.' venta #'.$sale_id, $m['consume_mode']);
                continue;
            }
            $prev = $m['current_stock'];
            $new = $prev + $need;
            $db->update(
                'UPDATE products SET current_stock = ?, updated_at = NOW() WHERE product_id = ? AND store_id = ?',
                [$new, $lid, $store_id]
            );
            $db->insert(
                'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',
                [$store_id, $lid, $user_id, MOVEMENT_RETURN, $need, $prev, $new, $note.' venta #'.$sale_id]
            );
            $this->setCachedStock($lid, $new);
        }
    }

    /**
     * Restituye cantidad a un componente: la devuelve a la presentación según consume_mode
     * (fifo/manual → la más antigua; lifo → la más reciente). Si no había, crea "Reintegro".
     */
    private function restoreLots($db, $store_id, $user_id, $pid, $qty, $note, $consumeMode = CONSUME_FIFO) {
        $consumeMode = $this->normalizeConsume($consumeMode);
        $order = ($consumeMode === CONSUME_LIFO) ? 'DESC' : 'ASC';
        $first = $this->db->selectOne(
            'SELECT lot_id, quantity FROM product_lots WHERE product_id=? AND store_id=? ORDER BY lot_id '.$order.' LIMIT 1',
            [$pid, $store_id]
        );
        if ($first) {
            $newQty = (float)$first['quantity'] + (float)$qty;
            $this->db->update('UPDATE product_lots SET quantity=? WHERE lot_id=?', [$newQty, (int)$first['lot_id']]);
            $this->db->insert(
                'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',
                [$store_id, $pid, $user_id, MOVEMENT_RETURN, (float)$qty, (float)$first['quantity'], $newQty, $note]
            );
        } else {
            $this->db->insert(
                'INSERT INTO product_lots (store_id, product_id, label, quantity, unit_cost) VALUES (?,?,?,?,0)',
                [$store_id, $pid, 'Reintegro', (float)$qty]
            );
            $this->db->insert(
                'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',
                [$store_id, $pid, $user_id, MOVEMENT_RETURN, (float)$qty, 0, (float)$qty, $note]
            );
        }
    }

    /** Piezas efectivas a aplicar según si la entrada especifica cajas o piezas. */
    public function effectiveQty($boxes, $pieces, $ppb) {
        if ($boxes !== null && $boxes > 0 && (int)$ppb > 0) {
            return (float)$boxes * (int)$ppb;
        }
        return (float)$pieces;
    }
}