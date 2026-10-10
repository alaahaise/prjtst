const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// Helper: production always uses VRAC (2)
function getPackagingId(materialId, locationCode, userPackaging) {
  return 2;
}

// ---------- GET (list) – unchanged ----------
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, fp.name AS finished_product_name, fp.unit, sl.code AS location_code, sl.name AS location_name
       FROM production p
       JOIN finished_products fp ON fp.id = p.finished_product_id
       LEFT JOIN stock_locations sl ON sl.id = p.location_id
       ORDER BY p.production_date DESC, p.id DESC`
    );

    for (const row of rows) {
      const [items] = await pool.query(
        `SELECT pi.*, rm.name AS raw_material_name, rm.unit, pkg.name AS packaging_name
         FROM production_items pi
         JOIN raw_materials rm ON rm.id = pi.raw_material_id
         LEFT JOIN packaging pkg ON pkg.id = pi.packaging_id
         WHERE pi.production_id = ?`,
        [row.id]
      );
      row.items_used = items;
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST (create) – unchanged ----------
router.post('/', async (req, res) => {
  const { production_date, finished_product_id, quantity_produced, recipe_id, note, location_code, items } = req.body;

  if (!production_date || !finished_product_id || !quantity_produced || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'production_date, finished_product_id, quantity_produced and at least one raw material item are required'
    });
  }
  if (!['UNITE_A', 'UNITE_B'].includes(location_code)) {
    return res.status(400).json({ error: 'location_code must be UNITE_A or UNITE_B' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[execLoc]] = await conn.query(
      'SELECT id FROM stock_locations WHERE code = ?', [location_code]
    );
    if (!execLoc) throw new Error('Unknown location_code');
    const execLocationId = execLoc.id;

    // Insert production (T record)
    const [result] = await conn.query(
      `INSERT INTO production (production_date, finished_product_id, quantity_produced, recipe_id, note, location_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [production_date, finished_product_id, quantity_produced, recipe_id || null, note || null, execLocationId]
    );
    const productionId = result.insertId;

    // Insert production items and adjust raw material stock + movements
    for (const item of items) {
      const pkgId = getPackagingId(item.raw_material_id, location_code, item.packaging_id);

      await conn.query(
        `INSERT INTO production_items (production_id, raw_material_id, packaging_id, quantity_used) VALUES (?, ?, ?, ?)`,
        [productionId, item.raw_material_id, pkgId, item.quantity_used]
      );

      // Deduct raw stock
      const [[rm]] = await conn.query(
        'SELECT stock_mode FROM raw_materials WHERE id = ?',
        [item.raw_material_id]
      );

      if (rm.stock_mode === 'GLOBAL') {
        await conn.query(
          `UPDATE raw_materials SET current_stock = current_stock - ? WHERE id = ?`,
          [item.quantity_used, item.raw_material_id]
        );
      } else {
        await conn.query(
          `INSERT INTO raw_material_stock (raw_material_id, location_id, packaging_id, quantity)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = quantity - ?`,
          [item.raw_material_id, execLocationId, pkgId, -Number(item.quantity_used), item.quantity_used]
        );
        await conn.query(
          `UPDATE raw_materials rm
           SET rm.current_stock = (
             SELECT COALESCE(SUM(quantity), 0) FROM raw_material_stock WHERE raw_material_id = rm.id
           )
           WHERE rm.id = ?`,
          [item.raw_material_id]
        );
      }

      // Insert RAW movement (PRODUCTION_OUT) – uses production_date
      await conn.query(
        `INSERT INTO stock_movements
          (movement_date, material_type, material_id, packaging_id, movement_type, quantity, reference_id, remark, pool_location_id, executed_by_location_id)
         VALUES (?, 'RAW', ?, ?, 'PRODUCTION_OUT', ?, ?, ?, ?, ?)`,
        [production_date, item.raw_material_id, pkgId, -item.quantity_used, productionId,
         `Consumed in production by ${location_code}`, execLocationId, execLocationId]
      );
    }

    // Insert FINISHED movement (PRODUCTION_IN) – uses production_date
    await conn.query(
      `INSERT INTO stock_movements
        (movement_date, material_type, material_id, movement_type, quantity, reference_id, remark, pool_location_id, executed_by_location_id)
       VALUES (?, 'FINISHED', ?, 'PRODUCTION_IN', ?, ?, ?, NULL, ?)`,
      [production_date, finished_product_id, quantity_produced, productionId,
       `Output of production by ${location_code}`, execLocationId]
    );

    await conn.commit();
    res.status(201).json({ id: productionId });
  } catch (err) {
    await conn.rollback();
    console.error('POST production error:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ---------- PUT (edit) – with logging and FIXED recalc ----------
router.put('/:id', async (req, res) => {
  const productionId = req.params.id;
  const { production_date, finished_product_id, quantity_produced, recipe_id, note, location_code, items } = req.body;

  console.log(`[PUT] === Editing production ${productionId} ===`);
  console.log('[PUT] Received items:', JSON.stringify(items, null, 2));

  if (!production_date || !finished_product_id || !quantity_produced || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'production_date, finished_product_id, quantity_produced and at least one raw material item are required'
    });
  }
  if (!['UNITE_A', 'UNITE_B'].includes(location_code)) {
    return res.status(400).json({ error: 'location_code must be UNITE_A or UNITE_B' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Get existing production
    const [[oldProd]] = await conn.query(
      `SELECT p.*, sl.code as location_code FROM production p
       LEFT JOIN stock_locations sl ON sl.id = p.location_id
       WHERE p.id = ?`,
      [productionId]
    );
    if (!oldProd) throw new Error('Production not found');

    // 2. Get existing items
    const [oldItems] = await conn.query(
      `SELECT * FROM production_items WHERE production_id = ?`,
      [productionId]
    );
    console.log('[PUT] Old items:', oldItems);
    const oldMap = new Map(oldItems.map(i => [i.raw_material_id, i]));

    // 3. Get new location
    const [[execLoc]] = await conn.query(
      'SELECT id FROM stock_locations WHERE code = ?', [location_code]
    );
    if (!execLoc) throw new Error('Unknown location_code');
    const execLocationId = execLoc.id;

    // 4. Build new items map
    const newItemMap = new Map();
    for (const item of items) {
      const pkgId = getPackagingId(item.raw_material_id, location_code, item.packaging_id);
      newItemMap.set(item.raw_material_id, {
        ...item,
        packaging_id: pkgId,
        quantity_used: Number(item.quantity_used)
      });
    }
    console.log('[PUT] New items map:', Array.from(newItemMap.entries()));

    // 5. Reverse old raw material consumption (add back to stock)
    for (const [rmId, oldItem] of oldMap) {
      const pkgId = oldItem.packaging_id || 1;
      const [[rm]] = await conn.query('SELECT stock_mode FROM raw_materials WHERE id = ?', [rmId]);

      if (rm.stock_mode === 'GLOBAL') {
        console.log(`[PUT] Reversing GLOBAL ${rmId}: +${oldItem.quantity_used}`);
        await conn.query(
          `UPDATE raw_materials SET current_stock = current_stock + ? WHERE id = ?`,
          [oldItem.quantity_used, rmId]
        );
      } else {
        await conn.query(
          `INSERT INTO raw_material_stock (raw_material_id, location_id, packaging_id, quantity)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
          [rmId, oldProd.location_id, pkgId, oldItem.quantity_used, oldItem.quantity_used]
        );
      }
    }

    // 6. Apply new raw material consumption (deduct from stock)
    for (const [rmId, newItem] of newItemMap) {
      const pkgId = newItem.packaging_id || 1;
      const [[rm]] = await conn.query('SELECT stock_mode FROM raw_materials WHERE id = ?', [rmId]);

      if (rm.stock_mode === 'GLOBAL') {
        console.log(`[PUT] Applying GLOBAL ${rmId}: -${newItem.quantity_used}`);
        await conn.query(
          `UPDATE raw_materials SET current_stock = current_stock - ? WHERE id = ?`,
          [newItem.quantity_used, rmId]
        );
      } else {
        await conn.query(
          `INSERT INTO raw_material_stock (raw_material_id, location_id, packaging_id, quantity)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = quantity - ?`,
          [rmId, execLocationId, pkgId, -Number(newItem.quantity_used), newItem.quantity_used]
        );
      }
    }

    // 7. Recalc total stock ONLY for MULTI materials – FIXED!
    const allMaterialIds = [...new Set([...oldMap.keys(), ...newItemMap.keys()])];
    for (const id of allMaterialIds) {
      const [[rm]] = await conn.query('SELECT stock_mode FROM raw_materials WHERE id = ?', [id]);
      if (rm && rm.stock_mode === 'MULTI') {
        console.log(`[PUT] Recalculating MULTI ${id} from raw_material_stock`);
        await conn.query(
          `UPDATE raw_materials rm
           SET rm.current_stock = (
             SELECT COALESCE(SUM(quantity), 0) FROM raw_material_stock WHERE raw_material_id = rm.id
           )
           WHERE rm.id = ?`,
          [id]
        );
      }
      // GLOBAL materials are already updated in steps 5/6 – do NOT recalc.
    }

    // 8. Delete old production_items and insert new ones
    await conn.query(`DELETE FROM production_items WHERE production_id = ?`, [productionId]);
    for (const item of items) {
      const pkgId = getPackagingId(item.raw_material_id, location_code, item.packaging_id);
      await conn.query(
        `INSERT INTO production_items (production_id, raw_material_id, packaging_id, quantity_used) VALUES (?, ?, ?, ?)`,
        [productionId, item.raw_material_id, pkgId, item.quantity_used]
      );
    }

    // 9. Delete old stock_movements for this production
    await conn.query(
      `DELETE FROM stock_movements WHERE reference_id = ? AND movement_type IN ('PRODUCTION_IN', 'PRODUCTION_OUT')`,
      [productionId]
    );

    // 10. Insert new RAW movements (PRODUCTION_OUT) with updated production_date
    for (const item of items) {
      const pkgId = getPackagingId(item.raw_material_id, location_code, item.packaging_id);
      await conn.query(
        `INSERT INTO stock_movements
          (movement_date, material_type, material_id, packaging_id, movement_type, quantity, reference_id, remark, pool_location_id, executed_by_location_id)
         VALUES (?, 'RAW', ?, ?, 'PRODUCTION_OUT', ?, ?, ?, ?, ?)`,
        [production_date, item.raw_material_id, pkgId, -item.quantity_used, productionId,
         `Consumed in production by ${location_code}`, execLocationId, execLocationId]
      );
    }

    // 11. Insert new FINISHED movement (PRODUCTION_IN) with updated production_date
    await conn.query(
      `INSERT INTO stock_movements
        (movement_date, material_type, material_id, movement_type, quantity, reference_id, remark, pool_location_id, executed_by_location_id)
       VALUES (?, 'FINISHED', ?, 'PRODUCTION_IN', ?, ?, ?, NULL, ?)`,
      [production_date, finished_product_id, quantity_produced, productionId,
       `Output of production by ${location_code}`, execLocationId]
    );

    // 12. Update production record
    await conn.query(
      `UPDATE production SET
        production_date = ?,
        finished_product_id = ?,
        quantity_produced = ?,
        recipe_id = ?,
        note = ?,
        location_id = ?
       WHERE id = ?`,
      [production_date, finished_product_id, quantity_produced, recipe_id || null, note || null, execLocationId, productionId]
    );

    await conn.commit();
    console.log(`[PUT] ✅ Production ${productionId} updated successfully`);
    res.json({ success: true, id: productionId });
  } catch (err) {
    await conn.rollback();
    console.error(`[PUT] ❌ Error:`, err.message);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ---------- DELETE – reverse stock, delete production and movements ----------
router.delete('/:id', async (req, res) => {
  const productionId = req.params.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[prod]] = await conn.query(
      `SELECT p.*, sl.id as location_id FROM production p
       LEFT JOIN stock_locations sl ON sl.id = p.location_id
       WHERE p.id = ?`,
      [productionId]
    );
    if (!prod) throw new Error('Production not found');

    const [items] = await conn.query(
      `SELECT pi.*, rm.stock_mode FROM production_items pi
       JOIN raw_materials rm ON rm.id = pi.raw_material_id
       WHERE pi.production_id = ?`,
      [productionId]
    );

    // Reverse raw material consumption (add back to stock)
    for (const item of items) {
      if (item.stock_mode === 'GLOBAL') {
        await conn.query(
          `UPDATE raw_materials SET current_stock = current_stock + ? WHERE id = ?`,
          [item.quantity_used, item.raw_material_id]
        );
      } else {
        await conn.query(
          `INSERT INTO raw_material_stock (raw_material_id, location_id, packaging_id, quantity)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
          [item.raw_material_id, prod.location_id, item.packaging_id, item.quantity_used, item.quantity_used]
        );
        await conn.query(
          `UPDATE raw_materials rm
           SET rm.current_stock = (
             SELECT COALESCE(SUM(quantity), 0) FROM raw_material_stock WHERE raw_material_id = rm.id
           )
           WHERE rm.id = ?`,
          [item.raw_material_id]
        );
      }
    }

    // Delete stock_movements for this production
    await conn.query(
      `DELETE FROM stock_movements WHERE reference_id = ? AND movement_type IN ('PRODUCTION_IN', 'PRODUCTION_OUT')`,
      [productionId]
    );

    await conn.query(`DELETE FROM production_items WHERE production_id = ?`, [productionId]);
    await conn.query(`DELETE FROM production WHERE id = ?`, [productionId]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('DELETE error:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ---------- Variance report – unchanged ----------
router.get('/:id/variance', async (req, res) => {
  try {
    const [[prod]] = await pool.query('SELECT * FROM production WHERE id = ?', [req.params.id]);
    if (!prod) return res.status(404).json({ error: 'production run not found' });
    if (!prod.recipe_id) return res.json({ note: 'No recipe linked to this production run', actual: [] });

    const [planned] = await pool.query(
      `SELECT ri.raw_material_id, rm.name, rm.unit,
              (ri.quantity_per_1000kg * ? / 1000) AS planned_quantity
       FROM recipe_items ri
       JOIN raw_materials rm ON rm.id = ri.raw_material_id
       WHERE ri.recipe_id = ?`,
      [prod.quantity_produced, prod.recipe_id]
    );

    const [actual] = await pool.query(
      `SELECT raw_material_id, SUM(quantity_used) AS actual_quantity FROM production_items WHERE production_id = ? GROUP BY raw_material_id`,
      [req.params.id]
    );

    const actualMap = new Map(actual.map(a => [a.raw_material_id, a.actual_quantity]));
    const variance = planned.map(p => {
      const actualQty = actualMap.get(p.raw_material_id) || 0;
      return {
        raw_material_id: p.raw_material_id,
        name: p.name,
        unit: p.unit,
        planned_quantity: Number(p.planned_quantity),
        actual_quantity: Number(actualQty),
        variance: Number(actualQty) - Number(p.planned_quantity)
      };
    });

    res.json(variance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;