const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM finished_products WHERE active = TRUE ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, unit, initial_stock } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const stock = Number(initial_stock || 0);

    const [result] = await conn.query(
      `INSERT INTO finished_products (name, unit, current_stock) VALUES (?, ?, ?)`,
      [name, unit || 'Kg', stock]
    );

    if (stock !== 0) {
      await conn.query(
        `INSERT INTO stock_movements (material_type, material_id, movement_type, quantity, reference_id, remark)
         VALUES ('FINISHED', ?, 'INITIAL', ?, ?, 'Initial stock on creation')`,
        [result.insertId, stock, result.insertId]
      );
    }

    await conn.commit();
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const { name, unit, active } = req.body;
  try {
    await pool.query(
      `UPDATE finished_products SET
        name = COALESCE(?, name),
        unit = COALESCE(?, unit),
        active = COALESCE(?, active)
       WHERE id = ?`,
      [name, unit, active, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Daily stock report: combined totals per finished-product group (e.g. variants that share
// a group_id are summed into one row). Finished products have no per-location stock table —
// current_stock is a single global number — so unlike raw materials there is no Unité A/B split here.
router.get('/grouped-totals', async (req, res) => {
  try {
    const [members] = await pool.query(`
      SELECT fp.id, fp.name, fp.unit, fp.current_stock, fp.group_id,
             COALESCE(fpg.name, fp.name) AS group_name
      FROM finished_products fp
      LEFT JOIN finished_product_groups fpg ON fpg.id = fp.group_id
      WHERE fp.active = TRUE
    `);

    const groups = new Map();
    for (const m of members) {
      // Same namespacing rule as raw materials: a real group uses 'g{group_id}',
      // a solo product uses 'm{product_id}' — these are separate id sequences.
      const groupKey = m.group_id !== null ? `g${m.group_id}` : `m${m.id}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { group_key: groupKey, group_name: m.group_name, unit: m.unit, total_stock: 0, variants: [] });
      }
      const g = groups.get(groupKey);
      g.total_stock += Number(m.current_stock || 0);
      g.variants.push(m.name);
    }

    const rows = [...groups.values()]
      .map(g => ({ ...g, variants: g.variants.sort().join(' + ') }))
      .sort((a, b) => a.group_name.localeCompare(b.group_name));

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
