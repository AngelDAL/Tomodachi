SELECT
  p.product_id,
  p.product_name,
  p.hidden_in_pos,
  p.discontinued_at
FROM products p
WHERE p.store_id = 1
  AND (
    p.status = 'active'
    AND p.hidden_in_pos = 0
  )
ORDER BY p.product_name ASC;
