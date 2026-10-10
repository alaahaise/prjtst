const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sa.*, pkg.name AS packaging_name
       FROM stock_adjustments sa
       LEFT JOIN packaging pkg ON pkg.id = sa.packaging_id
       ORDER BY sa.adjustment_date DESC, sa.id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// body: { adjustment_date, material_type, material_id, packaging_id, quantity, reason, remark }
// quantity can be negative (decrease) or positive (increase).
// packaging_id is only meaningful for RAW materials with MULTI stock_mode.
router.post('/', async (req, res) => {
  const { adjustment_date, material_type, material_id, packaging_id, quantity, reason, remark } = req.body;
  if (!adjustment_date || !material_type || !material_id || quantity === undefined || !reason || !remark) {
    return res.status(400).json({ error: 'adjustment_date, material_type, material_id, quantity, reason and remark are required' });
  }

  const pkgId = Number(packaging_id) || 1;
  const table = material_type === 'RAW' ? 'raw_materials' : 'finished_products';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO stock_adjustments (adjustment_date, material_type, material_id, packaging_id, quantity, reason, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [adjustment_date, material_type, material_id, pkgId, quantity, reason, remark]
    );

    await conn.query(
      `UPDATE ${table} SET current_stock = current_stock + ? WHERE id = ?`,
      [quantity, material_id]
    );

    // For MULTI raw materials, also adjust the per-location-packaging row (default CENTRAL)
    if (material_type === 'RAW') {
      const [[rm]] = await conn.query('SELECT stock_mode FROM raw_materials WHERE id = ?', [material_id]);
      if (rm && rm.stock_mode === 'MULTI') {
        await conn.query(
          `INSERT INTO raw_material_stock (raw_material_id, location_id, packaging_id, quantity)
           VALUES (?, (SELECT id FROM stock_locations WHERE code = 'CENTRAL'), ?, ?)
           ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
          [material_id, pkgId, quantity, quantity]
        );
        // Recompute total from location rows
        await conn.query(
          `UPDATE raw_materials rm
           SET rm.current_stock = (SELECT COALESCE(SUM(quantity),0) FROM raw_material_stock WHERE raw_material_id = rm.id)
           WHERE rm.id = ?`,
          [material_id]
        );
      }
    }

    await conn.query(
      `INSERT INTO stock_movements (movement_date, material_type, material_id, packaging_id, movement_type, quantity, reference_id, remark)
       VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, ?)`,
      [adjustment_date, material_type, material_id, pkgId, quantity, result.insertId, `${reason}: ${remark}`]
    );

    await conn.commit();
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;