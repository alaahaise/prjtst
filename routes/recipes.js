const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// List recipes with their items
router.get('/', async (req, res) => {
  try {
    const [recipes] = await pool.query(
      `SELECT r.*, fp.name AS finished_product_name
       FROM recipes r
       JOIN finished_products fp ON fp.id = r.finished_product_id
       ORDER BY r.id DESC`
    );

    for (const recipe of recipes) {
      const [items] = await pool.query(
        `SELECT ri.*, rm.name AS raw_material_name, rm.unit
         FROM recipe_items ri
         JOIN raw_materials rm ON rm.id = ri.raw_material_id
         WHERE ri.recipe_id = ?`,
        [recipe.id]
      );
      recipe.items = items;
    }

    res.json(recipes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create recipe + items
// body: { finished_product_id, version, items: [{ raw_material_id, quantity_per_1000kg }] }
router.post('/', async (req, res) => {
  const { finished_product_id, version, items } = req.body;
  if (!finished_product_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'finished_product_id and at least one item are required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO recipes (finished_product_id, version) VALUES (?, ?)`,
      [finished_product_id, version || '1.0']
    );
    const recipeId = result.insertId;

    for (const item of items) {
      await conn.query(
        `INSERT INTO recipe_items (recipe_id, raw_material_id, quantity_per_1000kg) VALUES (?, ?, ?)`,
        [recipeId, item.raw_material_id, item.quantity_per_1000kg]
      );
    }

    await conn.commit();
    res.status(201).json({ id: recipeId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Update recipe metadata + fully replace its items
// body: { finished_product_id, version, active, items: [{ raw_material_id, quantity_per_1000kg }] }
router.put('/:id', async (req, res) => {
  const { finished_product_id, version, active, items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[existing]] = await conn.query('SELECT id FROM recipes WHERE id = ?', [req.params.id]);
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ error: 'Recipe not found' });
    }

    await conn.query(
      `UPDATE recipes SET
        finished_product_id = COALESCE(?, finished_product_id),
        version = COALESCE(?, version),
        active = COALESCE(?, active)
       WHERE id = ?`,
      [finished_product_id || null, version || null, active === undefined ? null : active, req.params.id]
    );

    // Replace items wholesale (cascade-safe since recipe_items has ON DELETE CASCADE on recipe_id)
    await conn.query('DELETE FROM recipe_items WHERE recipe_id = ?', [req.params.id]);
    for (const item of items) {
      await conn.query(
        `INSERT INTO recipe_items (recipe_id, raw_material_id, quantity_per_1000kg) VALUES (?, ?, ?)`,
        [req.params.id, item.raw_material_id, item.quantity_per_1000kg]
      );
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Delete a recipe outright (its recipe_items cascade-delete automatically)
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM recipes WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Recipe not found' });
    res.json({ success: true });
  } catch (err) {
    // production.recipe_id references recipes with no ON DELETE rule (=> RESTRICT)
    if (err.errno === 1451) {
      return res.status(409).json({
        error: 'This recipe is linked to existing production runs and cannot be deleted. Deactivate it instead.'
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// Get planned quantities scaled to a target production amount (in Kg)
router.get('/:id/scale/:targetKg', async (req, res) => {
  try {
    const [items] = await pool.query(
      `SELECT ri.raw_material_id, rm.name, rm.unit, ri.quantity_per_1000kg,
              (ri.quantity_per_1000kg * ? / 1000) AS scaled_quantity
       FROM recipe_items ri
       JOIN raw_materials rm ON rm.id = ri.raw_material_id
       WHERE ri.recipe_id = ?`,
      [req.params.targetKg, req.params.id]
    );
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/deactivate', async (req, res) => {
  try {
    await pool.query('UPDATE recipes SET active = FALSE WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/activate', async (req, res) => {
  try {
    await pool.query('UPDATE recipes SET active = TRUE WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;