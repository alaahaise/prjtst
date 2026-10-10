const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, fp.name AS finished_product_name, fp.unit
       FROM sales s
       JOIN finished_products fp ON fp.id = s.finished_product_id
       ORDER BY s.sale_date DESC, s.id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// body: { sale_date, finished_product_id, quantity, customer, note }
router.post('/', async (req, res) => {
  const { sale_date, finished_product_id, quantity, customer, note } = req.body;
  if (!sale_date || !finished_product_id || !quantity) {
    return res.status(400).json({ error: 'sale_date, finished_product_id and quantity are required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

const [[fp]] = await conn.query(
      'SELECT current_stock, name FROM finished_products WHERE id = ? FOR UPDATE',
      [finished_product_id]
    );
    if (!fp) throw new Error('Finished product not found');

    const [result] = await conn.query(
      `INSERT INTO sales (sale_date, finished_product_id, quantity, customer, note)
       VALUES (?, ?, ?, ?, ?)`,
      [sale_date, finished_product_id, quantity, customer || null, note || null]
    );

    await conn.query(
      `UPDATE finished_products SET current_stock = current_stock - ? WHERE id = ?`,
      [quantity, finished_product_id]
    );

    await conn.query(
      `INSERT INTO stock_movements (movement_date, material_type, material_id, movement_type, quantity, reference_id, remark)
       VALUES (?, 'FINISHED', ?, 'SALE', ?, ?, ?)`,
      [sale_date, finished_product_id, -quantity, result.insertId, `Sale to ${customer || 'unknown customer'}`]
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

module.exports = router;
