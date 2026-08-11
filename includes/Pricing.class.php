<?php
/**
 * Pricing - Motor de precios del servidor (fuente de verdad)
 *
 * Replica la lógica de promociones que antes vivía SOLO en el navegador
 * (public/js/sales.js) para que el backend recalcule precios y totales
 * con datos de la BD. El servidor ya NO confía en el precio que manda
 * el cliente/agente: lo ignora y calcula desde products.price +
 * promociones activas.
 *
 * Tipos soportados (mismo comportamiento que el frontend):
 *   simple_discount : descuento fijo o % por unidad sobre productos target
 *   bulk_discount   : descuento por unidad si la cantidad total del target
 *                     alcanza min_quantity
 *   bundle          : STRICT SET — si están TODOS los targets, precio fijo
 *                     por set (bundle_price)
 *   bill_discount   : descuento sobre el total de la factura si supera
 *                     min_purchase_amount
 */
class Pricing {

    private $db;

    public function __construct($db) {
        $this->db = $db;
    }

    /**
     * Calcula líneas de venta finales a partir de items crudos del cliente.
     *
     * @param int   $store_id
     * @param array $items  [ ['product_id'=>N,'quantity'=>N], ... ]
     * @return array [
     *   'lines' => [ ['product_id','product_name','category_id','quantity',
     *                 'unit_price','discount','total','promotion_id',
     *                 'promotion_name','unit_cost','allow_negative_stock'], ... ],
     *   'subtotal' => float,   // suma de lineas (antes de descuento de factura)
     *   'discount' => float,   // descuento de factura (bill_discount)
     *   'total'    => float
     * ]
     * @throws Exception si falta stock (cuando no se permite negativo)
     */
    public function calculate($store_id, $items, $allowNegativeStock = false) {
        if (!$items || !is_array($items)) {
            return ['lines' => [], 'subtotal' => 0.0, 'discount' => 0.0, 'total' => 0.0];
        }

        // 1. Cargar productos de BD (precio real + costo + categoría)
        $ids = array_values(array_unique(array_map(function ($it) {
            return (int)($it['product_id'] ?? 0);
        }, $items)));
        $lines = [];
        foreach ($items as $it) {
            $pid = (int)($it['product_id'] ?? 0);
            $qty = (float)($it['quantity'] ?? 0);
            if ($pid <= 0 || $qty <= 0) continue;
            if (!isset($lines[$pid])) {
                $lines[$pid] = [
                    'product_id' => $pid,
                    'product_name' => 'Producto',
                    'category_id' => null,
                    'quantity' => 0.0,
                    'original_price' => 0.0,
                    'unit_cost' => 0.0,
                    'current_stock' => 0.0,
                ];
            }
            $lines[$pid]['quantity'] += $qty;
        }

        if (empty($lines)) {
            return ['lines' => [], 'subtotal' => 0.0, 'discount' => 0.0, 'total' => 0.0];
        }

        $placeholders = implode(',', array_fill(0, count($lines), '?'));
        $params = array_merge([$store_id], array_keys($lines));
        $rows = $this->db->select(
            "SELECT product_id, product_name, category_id, price, cost, current_stock, status
             FROM products WHERE store_id = ? AND product_id IN ($placeholders) AND status = 'active'",
            $params
        );
        $productMap = [];
        foreach ($rows as $r) {
            $productMap[(int)$r['product_id']] = $r;
        }

        // 2. Cargar promociones activas con targets
        $promotions = $this->loadActivePromotions($store_id);

        // 3. Construir líneas con precio base de BD
        $finalLines = [];
        foreach ($lines as $pid => $line) {
            if (!isset($productMap[$pid])) {
                throw new Exception("Producto inactivo o inexistente en esta tienda ID $pid", 404);
            }
            $p = $productMap[$pid];
            $line['product_name'] = $p['product_name'];
            $line['category_id'] = $p['category_id'] !== null ? (int)$p['category_id'] : null;
            $line['original_price'] = (float)$p['price'];
            $line['unit_cost'] = (float)($p['cost'] ?? 0);
            $line['current_stock'] = (float)$p['current_stock'];
            $line['unit_price'] = $line['original_price'];
            $line['discount'] = 0.0;
            $line['promotion_id'] = null;
            $line['promotion_name'] = null;

            // Validar stock
            if (!$allowNegativeStock && $line['current_stock'] < $line['quantity']) {
                throw new Exception("Stock insuficiente para el producto '{$line['product_name']}'. Disponible: {$line['current_stock']}", 409);
            }

            $finalLines[$pid] = $line;
        }

        // 4. Aplicar promociones (mismo orden/prioridad que el frontend)
        foreach ($promotions as $promo) {
            $type = $promo['type'];
            if ($type === 'simple_discount') {
                $this->applySimpleDiscount($finalLines, $promo);
            } elseif ($type === 'bulk_discount') {
                $this->applyBulkDiscount($finalLines, $promo);
            } elseif ($type === 'bundle') {
                $this->applyBundle($finalLines, $promo);
            }
        }

        // 5. Calcular subtotal (por línea: quantity * unit_price)
        $subtotal = 0.0;
        foreach ($finalLines as $pid => &$line) {
            $line['total'] = round($line['quantity'] * $line['unit_price'], 2);
            $subtotal += $line['total'];
            // La línea conserva su descuento por unidad * cantidad para el detalle
        }
        unset($line);

        // 6. Descuento de factura (bill_discount)
        $billDiscount = 0.0;
        $billPromo = null;
        foreach ($promotions as $promo) {
            if ($promo['type'] !== 'bill_discount') continue;
            if ($subtotal < (float)$promo['min_purchase_amount']) continue;
            $disc = 0.0;
            if ($promo['discount_type'] === 'percentage') {
                $disc = $subtotal * ((float)$promo['discount_value'] / 100);
            } else {
                $disc = (float)$promo['discount_value'];
            }
            if ($disc > $billDiscount) {
                $billDiscount = $disc;
                $billPromo = $promo;
            }
        }
        $billDiscount = round($billDiscount, 2);
        if ($billDiscount > $subtotal) $billDiscount = $subtotal;

        $total = round($subtotal - $billDiscount, 2);

        return [
            'lines' => array_values($finalLines),
            'subtotal' => round($subtotal, 2),
            'discount' => $billDiscount,
            'promotion_id' => $billPromo ? (int)$billPromo['promotion_id'] : null,
            'promotion_name' => $billPromo ? $billPromo['name'] : null,
            'total' => $total,
        ];
    }

    private function loadActivePromotions($store_id) {
        $rows = $this->db->select(
            "SELECT * FROM promotions
             WHERE store_id = ? AND is_active = 1 AND start_date <= NOW() AND end_date >= NOW()
             ORDER BY promotion_id ASC",
            [$store_id]
        );
        foreach ($rows as &$promo) {
            $targets = $this->db->select(
                "SELECT product_id, category_id FROM promotion_targets WHERE promotion_id = ?",
                [(int)$promo['promotion_id']]
            );
            $promo['targets'] = array_map(function ($t) {
                return [
                    'product_id' => $t['product_id'] !== null ? (int)$t['product_id'] : null,
                    'category_id' => $t['category_id'] !== null ? (int)$t['category_id'] : null,
                ];
            }, $targets);
            $promo['discount_type'] = $promo['discount_type'] ?? 'fixed_amount';
            $promo['discount_value'] = (float)$promo['discount_value'];
            $promo['min_quantity'] = (int)($promo['min_quantity'] ?? 1);
            $promo['min_purchase_amount'] = (float)($promo['min_purchase_amount'] ?? 0);
        }
        return $rows;
    }

    private function isTarget($line, $promo) {
        foreach ($promo['targets'] as $t) {
            if ($t['product_id'] !== null && (int)$line['product_id'] === $t['product_id']) return true;
            if ($t['category_id'] !== null && $line['category_id'] !== null && (int)$line['category_id'] === $t['category_id']) return true;
        }
        return false;
    }

    private function discountFor($promo, $price) {
        $disc = 0.0;
        if ($promo['discount_type'] === 'percentage') {
            $disc = $price * ($promo['discount_value'] / 100);
        } else {
            $disc = $promo['discount_value'];
        }
        return $disc;
    }

    private function applyToLine(&$line, $promo, $discount) {
        $newPrice = $line['original_price'] - $discount;
        if ($newPrice < 0) $newPrice = 0;
        if ($newPrice < $line['unit_price']) {
            $line['unit_price'] = round($newPrice, 2);
            $line['discount'] = round($discount, 2);
            $line['promotion_id'] = (int)$promo['promotion_id'];
            $line['promotion_name'] = $promo['name'];
        }
    }

    private function applySimpleDiscount(&$lines, $promo) {
        foreach ($lines as &$line) {
            if (!$this->isTarget($line, $promo)) continue;
            $this->applyToLine($line, $promo, $this->discountFor($promo, $line['original_price']));
        }
        unset($line);
    }

    private function applyBulkDiscount(&$lines, $promo) {
        $eligible = array_filter($lines, function ($l) use ($promo) {
            return $this->isTarget($l, $promo);
        });
        $totalQty = array_sum(array_column($eligible, 'quantity'));
        if ($totalQty >= $promo['min_quantity']) {
            foreach ($lines as &$line) {
                if (!$this->isTarget($line, $promo)) continue;
                $this->applyToLine($line, $promo, $this->discountFor($promo, $line['original_price']));
            }
            unset($line);
        }
    }

    /**
     * Bundle STRICT SET: requiere que estén presentes TODOS los targets.
     * Cada set completo cuesta bundle_price; el descuento por set se reparte
     * proporcionalmente al precio original de cada línea target.
     */
    private function applyBundle(&$lines, $promo) {
        $targets = $promo['targets'];
        if (!$targets) return;

        // Encontrar líneas que cumplen cada target
        $coverage = [];
        $potential = PHP_INT_MAX;
        foreach ($targets as $i => $t) {
            $matches = array_filter($lines, function ($l) use ($t) {
                if ($t['product_id'] !== null && (int)$l['product_id'] === $t['product_id']) return true;
                if ($t['category_id'] !== null && $l['category_id'] !== null && (int)$l['category_id'] === $t['category_id']) return true;
                return false;
            });
            $qtyForTarget = array_sum(array_column($matches, 'quantity'));
            if ($qtyForTarget <= 0) {
                $potential = 0;
                break;
            }
            $potential = min($potential, (int)floor($qtyForTarget));
            $coverage[$i] = $matches;
        }

        if ($potential <= 0 || $potential === PHP_INT_MAX) return;
        $numBundles = $potential;

        $bundlePrice = (float)$promo['discount_value'];
        $totalBundleCost = $numBundles * $bundlePrice;

        // Suma de precios originales de las líneas que participan (por target)
        $originalSum = 0.0;
        $seen = [];
        foreach ($coverage as $i => $matches) {
            foreach ($matches as $line) {
                $key = $line['product_id'];
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $originalSum += $line['original_price'] * $line['quantity'];
            }
        }
        if ($originalSum <= 0) return;

        // Repartir el ahorro proporcionalmente
        $savings = max(0.0, $originalSum - $totalBundleCost);
        foreach ($coverage as $i => $matches) {
            foreach ($matches as $line) {
                $key = $line['product_id'];
                if (!isset($lines[$key])) continue;
                $share = $line['original_price'] * $line['quantity'] / $originalSum;
                $lineDiscount = $savings * $share / $line['quantity'];
                $newPrice = $line['original_price'] - $lineDiscount;
                if ($newPrice < 0) $newPrice = 0;
                if ($newPrice < $lines[$key]['unit_price']) {
                    $lines[$key]['unit_price'] = round($newPrice, 2);
                    $lines[$key]['discount'] = round($lineDiscount, 2);
                    $lines[$key]['promotion_id'] = (int)$promo['promotion_id'];
                    $lines[$key]['promotion_name'] = $promo['name'];
                }
            }
        }
    }
}
