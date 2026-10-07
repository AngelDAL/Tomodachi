<?php
/** Pure arithmetic for quantity-based promotions; intentionally DB-free. */
class PromotionRules {
    /** Number of units charged when each complete `take` group costs `pay` units. */
    public static function paidUnitsForBulk($quantity, $take, $pay) {
        $quantity = max(0, (int)$quantity);
        $take = (int)$take;
        $pay = (int)$pay;
        if ($take < 1 || $pay < 0 || $pay >= $take) return $quantity;
        return intdiv($quantity, $take) * $pay + ($quantity % $take);
    }

    /** Number of complete bundles that can be assembled from product quantities. */
    public static function completeBundles(array $quantitiesByProduct, array $targets) {
        if (!$targets) return 0;
        $complete = PHP_INT_MAX;
        foreach ($targets as $target) {
            $id = (int)($target['product_id'] ?? 0);
            $needed = max(1, (int)($target['required_quantity'] ?? 1));
            if ($id <= 0) return 0;
            $available = max(0, (int)($quantitiesByProduct[$id] ?? 0));
            $complete = min($complete, intdiv($available, $needed));
        }
        return $complete === PHP_INT_MAX ? 0 : $complete;
    }

    /**
     * Reparto de un PAQUETE (precio fijo por set) — la regla única del sistema.
     *
     * Un paquete se forma con las unidades que piden sus objetivos; el resto del carrito
     * NO entra al paquete y se paga a precio original. Ese fue el defecto corregido el
     * 7-oct-2026: el servidor metía la línea COMPLETA al paquete, así que 3 almendras de
     * $45 con paquete "2 x $30" se cobraban a $30 en vez de $75 (la sobrante salía gratis).
     *
     * Aquí no se decide el precio de una línea completa: se devuelve, por línea,
     * cuántas unidades entran al paquete y cuánto dinero aportan. El llamador cobra
     * las sobrantes a precio original.
     *
     * @param array $coverage     objetivo => [clave de línea, ...] (líneas que lo cumplen, en orden)
     * @param array $requirements objetivo => unidades que pide ese objetivo por paquete
     * @param array $available    clave de línea => ['quantity' => float, 'original_price' => float]
     * @param float $bundlePrice  precio final de UN paquete completo
     * @return array{bundles:int, units:array, original:array, revenue:array}
     *               units[clave]    = unidades que entran al paquete
     *               original[clave] = precio original de esas unidades (base de reparto)
     *               revenue[clave]  = lo que se cobra por esas unidades ya con descuento
     */
    public static function bundleAllocation(array $coverage, array $requirements, array $available, $bundlePrice) {
        $empty = ['bundles' => 0, 'units' => [], 'original' => [], 'revenue' => []];
        if (!$coverage) return $empty;

        // 1. Cuántos paquetes se pueden armar, armándolos DE UNO EN UNO y consumiendo
        //    unidades. Contar cada objetivo por separado mentiría cuando un mismo
        //    producto cumple dos objetivos: daría unidades por duplicado.
        $quantity = [];
        $price = [];
        foreach ($available as $key => $info) {
            $quantity[$key] = (float)($info['quantity'] ?? 0);
            $price[$key] = (float)($info['original_price'] ?? 0);
        }

        $setSize = 0;
        foreach ($requirements as $i => $required) {
            $setSize += max(1, (int)$required);
        }
        if ($setSize <= 0) return $empty;

        $claimed = [];
        $bundles = 0;
        $maxSets = (int)floor(array_sum($quantity) / $setSize) + 1;
        for ($attempt = 0; $attempt < $maxSets; $attempt++) {
            $proposed = [];
            $completo = true;
            foreach ($coverage as $i => $keys) {
                $needed = max(1, (int)($requirements[$i] ?? 1));
                foreach ($keys as $key) {
                    if ($needed <= 0) break;
                    $libres = ($quantity[$key] ?? 0.0) - ($claimed[$key] ?? 0.0) - ($proposed[$key] ?? 0.0);
                    if ($libres <= 0) continue;
                    $take = min($libres, $needed);
                    $proposed[$key] = ($proposed[$key] ?? 0.0) + $take;
                    $needed -= $take;
                }
                if ($needed > 0) { $completo = false; break; }
            }
            if (!$completo) break;
            foreach ($proposed as $key => $take) {
                $claimed[$key] = ($claimed[$key] ?? 0.0) + $take;
            }
            $bundles++;
        }

        if ($bundles <= 0) return $empty;

        // 2. Reparto del precio del paquete entre las unidades que lo forman.
        $pool = 0.0;
        foreach ($claimed as $key => $units) {
            $pool += $units * ($price[$key] ?? 0.0);
        }
        $cost = $bundles * (float)$bundlePrice;
        // Un "paquete" más caro que la suma de sus partes no es una promoción:
        // no se aplica (el carrito nunca debe cobrar de más que sin promoción).
        if ($pool <= 0 || $cost > $pool) return $empty;

        $ratio = $cost / $pool;
        $result = ['bundles' => $bundles, 'units' => [], 'original' => [], 'revenue' => []];
        foreach ($claimed as $key => $units) {
            $original = $units * ($price[$key] ?? 0.0);
            $result['units'][$key] = $units;
            $result['original'][$key] = $original;
            $result['revenue'][$key] = $original * $ratio;
        }
        return $result;
    }
}
