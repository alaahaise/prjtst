const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all receipts
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT pr.*, fp.name AS product_name, fp.unit
      FROM production_receipts pr
      JOIN finished_products fp ON fp.id = pr.product_id
      ORDER BY pr.receipt_date DESC, pr.id DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST – create receipt
router.post('/', async (req, res) => {
  const { product_id, quantity, receipt_date, note } = req.body;
  if (!product_id || !quantity || !receipt_date) {
    return res.status(400).json({ error: 'product_id, quantity, receipt_date required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Insert receipt
    const [result] = await conn.query(
      `INSERT INTO production_receipts (product_id, quantity, receipt_date, note)
       VALUES (?, ?, ?, ?)`,
      [product_id, quantity, receipt_date, note || null]
    );

    // Increase R stock
    await conn.query(
      `UPDATE finished_products SET current_stock = current_stock + ? WHERE id = ?`,
      [quantity, product_id]
    );

    await conn.commit();
    res.status(201).json({ id: result.insertId, success: true });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// PUT – update receipt (reverse old, apply new)
router.put('/:id', async (req, res) => {
  const receiptId = req.params.id;
  const { product_id, quantity, receipt_date, note } = req.body;
  if (!product_id || !quantity || !receipt_date) {
    return res.status(400).json({ error: 'product_id, quantity, receipt_date required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Get original receipt
    const [[original]] = await conn.query(
      'SELECT * FROM production_receipts WHERE id = ? FOR UPDATE',
      [receiptId]
    );
    if (!original) throw new Error('Receipt not found');

    // If product changed, reverse old stock from old product
    if (original.product_id !== product_id) {
      await conn.query(
        `UPDATE finished_products SET current_stock = current_stock - ? WHERE id = ?`,
        [original.quantity, original.product_id]
      );
      // Add to new product
      await conn.query(
        `UPDATE finished_products SET current_stock = current_stock + ? WHERE id = ?`,
        [quantity, product_id]
      );
    } else {
      // Same product: adjust by delta
      const delta = quantity - original.quantity;
      if (delta !== 0) {
        await conn.query(
          `UPDATE finished_products SET current_stock = current_stock + ? WHERE id = ?`,
          [delta, product_id]
        );
      }
    }

    // Update receipt
    await conn.query(
      `UPDATE production_receipts
       SET product_id = ?, quantity = ?, receipt_date = ?, note = ?
       WHERE id = ?`,
      [product_id, quantity, receipt_date, note || null, receiptId]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// DELETE – reverse stock and remove receipt
router.delete('/:id', async (req, res) => {
  const receiptId = req.params.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Get original receipt
    const [[original]] = await conn.query(
      'SELECT * FROM production_receipts WHERE id = ? FOR UPDATE',
      [receiptId]
    );
    if (!original) throw new Error('Receipt not found');

    // Reverse stock (subtract what was added)
    await conn.query(
      `UPDATE finished_products SET current_stock = current_stock - ? WHERE id = ?`,
      [original.quantity, original.product_id]
    );

    // Delete receipt
    await conn.query('DELETE FROM production_receipts WHERE id = ?', [receiptId]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;