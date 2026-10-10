const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, rm.name AS raw_material_name, rm.unit, pkg.name AS packaging_name
       FROM purchases p
       JOIN raw_materials rm ON rm.id = p.raw_material_id
       LEFT JOIN packaging pkg ON pkg.id = p.packaging_id
       ORDER BY p.purchase_date DESC, p.id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// body: { purchase_date, raw_material_id, packaging_id, quantity, quantity_brut, supplier, note }
// packaging_id: 1=SAC (default), 2=VRAC
// quantity = poids NET réel (poids de pesée), utilisé pour tous les calculs de stock.
// quantity_brut = poids BRUT déclaré (bon de livraison / ERP), purement informatif, jamais utilisé dans les calculs.
// Purchases always land in CENTRAL (MULTI materials) or the GLOBAL pool.
router.post('/', async (req, res) => {
  const { purchase_date, raw_material_id, packaging_id, quantity, quantity_brut, supplier, note } = req.body;
  if (!purchase_date || !raw_material_id || !quantity) {
    return res.status(400).json({ error: 'purchase_date, raw_material_id and quantity are required' });
  }

  const pkgId = Number(packaging_id) || 1;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[rm]] = await conn.query(
      'SELECT stock_mode FROM raw_materials WHERE id = ? FOR UPDATE',
      [raw_material_id]
    );
    if (!rm) throw new Error('Raw material not found');

    const [result] = await conn.query(
      `INSERT INTO purchases (purchase_date, raw_material_id, packaging_id, quantity, quantity_brut, supplier, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [purchase_date, raw_material_id, pkgId, quantity, quantity_brut || null, supplier || null, note || null]
    );

    let poolLocationCode;
    if (rm.stock_mode === 'GLOBAL') {
      poolLocationCode = 'GLOBAL';
      await conn.query(
        `UPDATE raw_materials SET current_stock = current_stock + ? WHERE id = ?`,
        [quantity, raw_material_id]
      );
    } else {
      poolLocationCode = 'CENTRAL';
      await conn.query(
        `INSERT INTO raw_material_stock (raw_material_id, location_id, packaging_id, quantity)
         VALUES (?, (SELECT id FROM stock_locations WHERE code = 'CENTRAL'), ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
        [raw_material_id, pkgId, quantity, quantity]
      );
      await conn.query(
        `UPDATE raw_materials rm
         SET rm.current_stock = (
           SELECT COALESCE(SUM(quantity),0) FROM raw_material_stock WHERE raw_material_id = rm.id
         )
         WHERE rm.id = ?`,
        [raw_material_id]
      );
    }

    await conn.query(
      `INSERT INTO stock_movements
        (movement_date, material_type, material_id, packaging_id, pool_location_id, executed_by_location_id, movement_type, quantity, reference_id, remark)
       VALUES (?, 'RAW', ?, ?, (SELECT id FROM stock_locations WHERE code = ?), NULL, 'PURCHASE', ?, ?, ?)`,
      [purchase_date, raw_material_id, pkgId, poolLocationCode, quantity, result.insertId, `Purchase from ${supplier || 'unknown supplier'}`]
    );

    await conn.commit();
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Delete a purchase (reverses stock + logs a correcting movement)
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[purchase]] = await conn.query('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
    if (!purchase) {
      await conn.rollback();
      return res.status(404).json({ error: 'purchase not found' });
    }

    const [[rm]] = await conn.query(
      'SELECT stock_mode FROM raw_materials WHERE id = ? FOR UPDATE',
      [purchase.raw_material_id]
    );

    const pkgId = purchase.packaging_id || 1;
    let poolLocationCode;
    if (rm.stock_mode === 'GLOBAL') {
      poolLocationCode = 'GLOBAL';
      await conn.query(
        `UPDATE raw_materials SET current_stock = current_stock - ? WHERE id = ?`,
        [purchase.quantity, purchase.raw_material_id]
      );
    } else {
      poolLocationCode = 'CENTRAL';
      await conn.query(
        `UPDATE raw_material_stock
         SET quantity = quantity - ?
         WHERE raw_material_id = ? AND location_id = (SELECT id FROM stock_locations WHERE code = 'CENTRAL') AND packaging_id = ?`,
        [purchase.quantity, purchase.raw_material_id, pkgId]
      );
      await conn.query(
        `UPDATE raw_materials rm
         SET rm.current_stock = (
           SELECT COALESCE(SUM(quantity),0) FROM raw_material_stock WHERE raw_material_id = rm.id
         )
         WHERE rm.id = ?`,
        [purchase.raw_material_id]
      );
    }

    await conn.query(
      `INSERT INTO stock_movements
        (material_type, material_id, packaging_id, pool_location_id, executed_by_location_id, movement_type, quantity, reference_id, remark)
       VALUES ('RAW', ?, ?, (SELECT id FROM stock_locations WHERE code = ?), NULL, 'ADJUSTMENT', ?, ?, 'Reversal of deleted purchase')`,
      [purchase.raw_material_id, pkgId, poolLocationCode, -purchase.quantity, purchase.id]
    );

    await conn.query('DELETE FROM purchases WHERE id = ?', [req.params.id]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;