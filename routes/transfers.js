const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

function getDestPackagingId(toLocationCode, sourcePackagingId) {
  if (toLocationCode === 'UNITE_A' || toLocationCode === 'UNITE_B') {
    return 2;
  }
  return Number(sourcePackagingId);
}

// ---------- GET ----------
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        st.id,
        DATE_FORMAT(st.transfer_date, '%Y-%m-%d') AS transfer_date,
        st.raw_material_id,
        st.packaging_id,
        st.from_location_id,
        st.to_location_id,
        st.quantity,
        st.note,
        st.created_at,
        rm.name AS raw_material_name,
        rm.unit,
        fl.code AS from_code,
        fl.name AS from_name,
        tl.code AS to_code,
        tl.name AS to_name,
        pkg.name AS packaging_name
      FROM stock_transfers st
      JOIN raw_materials rm ON rm.id = st.raw_material_id
      JOIN stock_locations fl ON fl.id = st.from_location_id
      JOIN stock_locations tl ON tl.id = st.to_location_id
      LEFT JOIN packaging pkg ON pkg.id = st.packaging_id
      ORDER BY st.transfer_date DESC, st.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET transfers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST ----------
router.post('/', async (req, res) => {
  const { transfer_date, raw_material_id, packaging_id, from_location_code, to_location_code, quantity, note } = req.body;
  if (!transfer_date || !raw_material_id || !from_location_code || !to_location_code || !quantity) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (from_location_code === to_location_code) {
    return res.status(400).json({ error: 'From and To must differ' });
  }

  const pkgId = Number(packaging_id) || 1;
  const destPkgId = getDestPackagingId(to_location_code, pkgId);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[rm]] = await conn.query(
      'SELECT stock_mode, name FROM raw_materials WHERE id = ? FOR UPDATE',
      [raw_material_id]
    );
    if (!rm) throw new Error('Raw material not found');
    if (rm.stock_mode !== 'MULTI') {
      throw new Error(`"${rm.name}" is GLOBAL stock and cannot be transferred`);
    }

    const [[fromLoc]] = await conn.query('SELECT id FROM stock_locations WHERE code = ?', [from_location_code]);
    const [[toLoc]] = await conn.query('SELECT id FROM stock_locations WHERE code = ?', [to_location_code]);
    if (!fromLoc || !toLoc) throw new Error('Unknown location code');

    await conn.query(
      `INSERT INTO raw_material_stock (raw_material_id, location_id, packaging_id, quantity)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = quantity - ?`,
      [raw_material_id, fromLoc.id, pkgId, -Number(quantity), quantity]
    );

    await conn.query(
      `INSERT INTO raw_material_stock (raw_material_id, location_id, packaging_id, quantity)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
      [raw_material_id, toLoc.id, destPkgId, quantity, quantity]
    );

    const [result] = await conn.query(
      `INSERT INTO stock_transfers (transfer_date, raw_material_id, packaging_id, from_location_id, to_location_id, quantity, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [transfer_date, raw_material_id, pkgId, fromLoc.id, toLoc.id, quantity, note || null]
    );

    // Movements
    await conn.query(
      `INSERT INTO stock_movements (movement_date, material_type, material_id, packaging_id, pool_location_id, executed_by_location_id, movement_type, quantity, reference_id, remark)
       VALUES (?, 'RAW', ?, ?, ?, NULL, 'ADJUSTMENT', ?, ?, ?)`,
      [transfer_date, raw_material_id, pkgId, fromLoc.id, -quantity, result.insertId, `Transfer out to ${to_location_code}`]
    );
    await conn.query(
      `INSERT INTO stock_movements (movement_date, material_type, material_id, packaging_id, pool_location_id, executed_by_location_id, movement_type, quantity, reference_id, remark)
       VALUES (?, 'RAW', ?, ?, ?, NULL, 'ADJUSTMENT', ?, ?, ?)`,
      [transfer_date, raw_material_id, destPkgId, toLoc.id, quantity, result.insertId, `Transfer in from ${from_location_code}`]
    );

    await conn.query(
      `UPDATE raw_materials rm
       SET rm.current_stock = (
         SELECT COALESCE(SUM(quantity), 0) FROM raw_material_stock WHERE raw_material_id = rm.id
       )
       WHERE rm.id = ?`,
      [raw_material_id]
    );

    await conn.commit();
    console.log(`[POST] Transfer created with ID ${result.insertId}`);
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    await conn.rollback();
    console.error('POST transfer error:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ---------- PUT (with full logging and date fix) ----------
router.put('/:id', async (req, res) => {
  const transferId = req.params.id;
  const { transfer_date, raw_material_id, packaging_id, from_location_code, to_location_code, quantity, note } = req.body;

  console.log(`[PUT] === START Editing transfer ${transferId} ===`);
  console.log('[PUT] Request body:', JSON.stringify(req.body, null, 2));

  if (!transfer_date || !raw_material_id || !from_location_code || !to_location_code || !quantity) {
    console.log('[PUT] ❌ Missing required fields');
    return res.status(400).json({ error: 'All fields required' });
  }
  if (from_location_code === to_location_code) {
    console.log('[PUT] ❌ From and To must differ');
    return res.status(400).json({ error: 'From and To must differ' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[original]] = await conn.query(
      `SELECT st.*, fl.code AS from_code, tl.code AS to_code
       FROM stock_transfers st
       JOIN stock_locations fl ON fl.id = st.from_location_id
       JOIN stock_locations tl ON tl.id = st.to_location_id
       WHERE st.id = ? FOR UPDATE`,
      [transferId]
    );
    if (!original) {
      console.log('[PUT] ❌ Transfer not found');
      throw new Error('Transfer not found');
    }
    console.log('[PUT] Original transfer:', JSON.stringify(original, null, 2));

    const [[fromLoc]] = await conn.query('SELECT id FROM stock_locations WHERE code = ?', [from_location_code]);
    const [[toLoc]] = await conn.query('SELECT id FROM stock_locations WHERE code = ?', [to_location_code]);
    if (!fromLoc || !toLoc) {
      console.log('[PUT] ❌ Unknown location code');
      throw new Error('Unknown location code');
    }
    console.log('[PUT] fromLoc.id:', fromLoc.id, 'toLoc.id:', toLoc.id);

    const origSrcPkg = original.packaging_id;
    const origDestPkg = getDestPackagingId(original.to_code, origSrcPkg);
    const newSrcPkg = Number(packaging_id) || 1;
    const newDestPkg = getDestPackagingId(to_location_code, newSrcPkg);

    console.log('[PUT] origSrcPkg:', origSrcPkg, 'origDestPkg:', origDestPkg);
    console.log('[PUT] newSrcPkg:', newSrcPkg, 'newDestPkg:', newDestPkg);

    // Reverse original
    console.log('[PUT] Reversing original...');
    await conn.query(
      `UPDATE raw_material_stock 
       SET quantity = quantity + ? 
       WHERE raw_material_id = ? AND location_id = ? AND packaging_id = ?`,
      [original.quantity, original.raw_material_id, original.from_location_id, origSrcPkg]
    );
    await conn.query(
      `UPDATE raw_material_stock 
       SET quantity = quantity - ? 
       WHERE raw_material_id = ? AND location_id = ? AND packaging_id = ?`,
      [original.quantity, original.raw_material_id, original.to_location_id, origDestPkg]
    );

    // Apply new
    console.log('[PUT] Applying new transfer...');
    await conn.query(
      `UPDATE raw_material_stock 
       SET quantity = quantity - ? 
       WHERE raw_material_id = ? AND location_id = ? AND packaging_id = ?`,
      [quantity, raw_material_id, fromLoc.id, newSrcPkg]
    );
    await conn.query(
      `UPDATE raw_material_stock 
       SET quantity = quantity + ? 
       WHERE raw_material_id = ? AND location_id = ? AND packaging_id = ?`,
      [quantity, raw_material_id, toLoc.id, newDestPkg]
    );

    // Update record
    console.log('[PUT] Updating transfer record...');
    const [updateResult] = await conn.query(
      `UPDATE stock_transfers
       SET transfer_date = ?, raw_material_id = ?, packaging_id = ?, from_location_id = ?, to_location_id = ?, quantity = ?, note = ?
       WHERE id = ?`,
      [transfer_date, raw_material_id, newSrcPkg, fromLoc.id, toLoc.id, quantity, note || null, transferId]
    );
    console.log('[PUT] Update result - affectedRows:', updateResult.affectedRows);
    if (updateResult.affectedRows === 0) {
      console.log('[PUT] ❌ No rows updated!');
      throw new Error('No rows updated');
    }

    // Recalc total stock
    await conn.query(
      `UPDATE raw_materials rm
       SET rm.current_stock = (
         SELECT COALESCE(SUM(quantity), 0) FROM raw_material_stock WHERE raw_material_id = rm.id
       )
       WHERE rm.id = ?`,
      [raw_material_id]
    );

    await conn.commit();
    console.log(`[PUT] ✅ Transfer ${transferId} updated successfully`);
    res.json({ success: true, id: transferId });
  } catch (err) {
    await conn.rollback();
    console.error('[PUT] ❌ Error:', err.message);
    console.error('[PUT] Stack:', err.stack);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
    console.log('[PUT] === END Editing transfer ===');
  }
});

// ---------- DELETE ----------
router.delete('/:id', async (req, res) => {
  const transferId = req.params.id;
  console.log(`[DELETE] Deleting transfer ${transferId}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[original]] = await conn.query(
      `SELECT st.*, fl.code AS from_code, tl.code AS to_code
       FROM stock_transfers st
       JOIN stock_locations fl ON fl.id = st.from_location_id
       JOIN stock_locations tl ON tl.id = st.to_location_id
       WHERE st.id = ? FOR UPDATE`,
      [transferId]
    );
    if (!original) {
      console.error(`[DELETE] Transfer ${transferId} not found`);
      throw new Error('Transfer not found');
    }
    console.log(`[DELETE] Reversing: add ${original.quantity} back to ${original.from_code}, deduct from ${original.to_code}`);
    const origSrcPkg = original.packaging_id;
    const origDestPkg = getDestPackagingId(original.to_code, origSrcPkg);

    await conn.query(
      `UPDATE raw_material_stock 
       SET quantity = quantity + ? 
       WHERE raw_material_id = ? AND location_id = ? AND packaging_id = ?`,
      [original.quantity, original.raw_material_id, original.from_location_id, origSrcPkg]
    );
    await conn.query(
      `UPDATE raw_material_stock 
       SET quantity = quantity - ? 
       WHERE raw_material_id = ? AND location_id = ? AND packaging_id = ?`,
      [original.quantity, original.raw_material_id, original.to_location_id, origDestPkg]
    );

    await conn.query('DELETE FROM stock_transfers WHERE id = ?', [transferId]);

    await conn.query(
      `UPDATE raw_materials rm
       SET rm.current_stock = (
         SELECT COALESCE(SUM(quantity), 0) FROM raw_material_stock WHERE raw_material_id = rm.id
       )
       WHERE rm.id = ?`,
      [original.raw_material_id]
    );

    await conn.commit();
    console.log(`[DELETE] Transfer ${transferId} deleted`);
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(`[DELETE] Error:`, err.message);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;