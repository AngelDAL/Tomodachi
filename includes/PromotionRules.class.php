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
}
