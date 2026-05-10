-- Backfill product_media from product.image_url for rows that pre-date the
-- WC import's product_media materialisation pass. After this runs, every
-- product with image_url IS NOT NULL will have at least one product_media
-- row marked is_primary=true at sort_order=0, so the product detail page
-- and WC sync see a consistent shape.
--
-- Re-runnable: the WHERE clause skips products that already have any
-- product_media row, so applying this twice is a no-op.

INSERT INTO product_media (instance_id, product_id, image_url, is_primary, sort_order)
SELECT p.instance_id, p.product_id, p.image_url, true, 0
FROM product p
WHERE p.image_url IS NOT NULL
  AND p.image_url <> ''
  AND NOT EXISTS (
    SELECT 1 FROM product_media pm
    WHERE pm.product_id = p.product_id
  );
