const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// List all, with per-location breakdown (NULL for GLOBAL materials)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
SELECT
  rm.id, rm.name, rm.unit, rm.stock_mode, rm.storage_location,
  rm.minimum_stock, rm.current_stock AS total_stock, rm.active, rm.created_at,
  SUM(CASE WHEN sl.code = 'CENTRAL' THEN rms.quantity ELSE 0 END) AS central_stock,
  SUM(CASE WHEN sl.code = 'UNITE_A' THEN rms.quantity ELSE 0 END) AS unite_a_stock,
  SUM(CASE WHEN sl.code = 'UNITE_B' THEN rms.quantity ELSE 0 END) AS unite_b_stock
FROM raw_materials rm
LEFT JOIN raw_material_stock rms ON rms.raw_material_id = rm.id
LEFT JOIN stock_locations sl ON sl.id = rms.location_id
WHERE rm.active = TRUE
GROUP BY rm.id, rm.name, rm.unit, rm.stock_mode, rm.storage_location,
         rm.minimum_stock, rm.current_stock, rm.active, rm.created_at
ORDER BY rm.name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new raw material
// body: { name, unit, storage_location, minimum_stock, initial_stock, stock_mode, packaging_id }
// packaging_id: 1=SAC (default), 2=VRAC. Used when recording the initial stock location row.
router.post('/', async (req, res) => {
  const { name, unit, storage_location, minimum_stock, initial_stock, stock_mode, packaging_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const mode = stock_mode === 'GLOBAL' ? 'GLOBAL' : 'MULTI';
  const pkgId = Number(packaging_id) || 1;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const stock = Number(initial_stock || 0);

    const [result] = await conn.query(
      `INSERT INTO raw_materials (name, unit, storage_location, minimum_stock, current_stock, stock_mode)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, unit || 'Q', storage_location || null, minimum_stock || 0, stock, mode]
    );

    if (stock !== 0) {
      let poolLocationCode = 'GLOBAL';
      if (mode === 'MULTI') {
        poolLocationCode = 'CENTRAL';
        await conn.query(
          `INSERT INTO raw_material_stock (raw_material_id, location_id, packaging_id, quantity)
           VALUES (?, (SELECT id FROM stock_locations WHERE code = 'CENTRAL'), ?, ?)
           ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
          [result.insertId, pkgId, stock, stock]
        );
      }
      await conn.query(
        `INSERT INTO stock_movements (material_type, material_id, packaging_id, pool_location_id, movement_type, quantity, reference_id, remark)
         VALUES ('RAW', ?, ?, (SELECT id FROM stock_locations WHERE code = ?), 'INITIAL', ?, ?, 'Initial stock on creation')`,
        [result.insertId, pkgId, poolLocationCode, stock, result.insertId]
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

// Update raw material metadata
router.put('/:id', async (req, res) => {
  const { name, unit, storage_location, minimum_stock, active } = req.body;
  try {
    await pool.query(
      `UPDATE raw_materials SET
        name = COALESCE(?, name),
        unit = COALESCE(?, unit),
        storage_location = COALESCE(?, storage_location),
        minimum_stock = COALESCE(?, minimum_stock),
        active = COALESCE(?, active)
       WHERE id = ?`,
      [name, unit, storage_location, minimum_stock, active, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Low stock alerts
router.get('/alerts/low-stock', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM raw_materials
       WHERE active = TRUE AND current_stock <= minimum_stock
       ORDER BY (current_stock - minimum_stock) ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily grouped stock report — packaging is a real dimension now, no name-sniffing.
// Each group row exposes:
//   unite_a_stock, unite_b_stock  (summed across all packagings at that location)
//   central_sac_stock, central_vrac_stock  (CENTRAL stock split by packaging)
// The "Autre" category is gone.
router.get('/grouped-totals', async (req, res) => {
  try {
    // Fetch per-material, per-location, per-packaging quantities
    const [rows] = await pool.query(`
      SELECT
        rm.id, rm.name, rm.unit, rm.minimum_stock, rm.stock_mode, rm.current_stock,
        rm.group_id,
        COALESCE(mg.name, rm.name) AS group_name,
        sl.code AS location_code,
        pkg.id   AS packaging_id,
        pkg.name AS packaging_name,
        rms.quantity
      FROM raw_materials rm
      LEFT JOIN material_groups mg ON mg.id = rm.group_id
      LEFT JOIN raw_material_stock rms ON rms.raw_material_id = rm.id
      LEFT JOIN stock_locations sl ON sl.id = rms.location_id
      LEFT JOIN packaging pkg ON pkg.id = rms.packaging_id
      WHERE rm.active = TRUE
    `);

    // Build groups
   const groupMeta = new Map(); // groupKey -> { group_name, unit, minimum_stock }
const groupStockMap = new Map(); // groupKey -> { unite_a, unite_b, central_sac, central_vrac }
const countedMinimumStock = new Set(); // Keeps track of materials already counted

for (const r of rows) {
  const groupKey = r.group_id !== null ? `g${r.group_id}` : `m${r.id}`;

  if (!groupMeta.has(groupKey)) {
    groupMeta.set(groupKey, {
      group_key: groupKey,
      group_name: r.group_name,
      unit: r.unit,
      minimum_stock: 0
    });

    groupStockMap.set(groupKey, {
      unite_a: 0,
      unite_b: 0,
      central_sac: 0,
      central_vrac: 0,
      global_total: 0
    });
  }

  const meta = groupMeta.get(groupKey);

  // Only add minimum_stock once per raw material
  const minimumStockKey = `${groupKey}_${r.id}`;
  if (!countedMinimumStock.has(minimumStockKey)) {
    meta.minimum_stock += Number(r.minimum_stock || 0);
    countedMinimumStock.add(minimumStockKey);
  }

  const stock = groupStockMap.get(groupKey);
  const qty = Number(r.quantity || 0);

  if (r.stock_mode === 'GLOBAL') {
    // GLOBAL materials have no per-location rows; their total is in current_stock.
    // Avoid double-counting: only add once (when location_code is null, i.e. no rms row).
    if (!r.location_code) {
      stock.global_total += Number(r.current_stock || 0);
    }
  } else {
    if (r.location_code === 'UNITE_A') {
      stock.unite_a += qty;
    } else if (r.location_code === 'UNITE_B') {
      stock.unite_b += qty;
    } else if (r.location_code === 'CENTRAL') {
      if (r.packaging_name === 'VRAC') {
        stock.central_vrac += qty;
      } else {
        stock.central_sac += qty; // SAC or any other packaging defaults to SAC column
      }
    }
  }
}

    // For GLOBAL materials that have no rms rows we need a fallback
    // (the loop above catches them via the `!r.location_code` guard, but materials
    //  with GLOBAL mode AND rms rows would be counted twice — prevent that by
    //  re-computing GLOBAL totals from current_stock directly in a second pass)
    const globalMaterials = [...new Set(rows.filter(r => r.stock_mode === 'GLOBAL').map(r => r.id))];
    const globalTotals = new Map();
    for (const r of rows) {
      if (r.stock_mode === 'GLOBAL' && !globalTotals.has(r.id)) {
        globalTotals.set(r.id, Number(r.current_stock || 0));
      }
    }
    // Reset global_total and recompute cleanly
    for (const r of rows) {
      if (r.stock_mode === 'GLOBAL') {
        const groupKey = r.group_id !== null ? `g${r.group_id}` : `m${r.id}`;
        groupStockMap.get(groupKey).global_total = 0; // will be set below
      }
    }
    for (const r of rows) {
      if (r.stock_mode === 'GLOBAL') {
        const groupKey = r.group_id !== null ? `g${r.group_id}` : `m${r.id}`;
        const stock = groupStockMap.get(groupKey);
        if (!globalTotals.has(`done_${r.id}`)) {
          stock.global_total += Number(r.current_stock || 0);
          globalTotals.set(`done_${r.id}`, true);
        }
      }
    }

    const result = [...groupMeta.entries()].map(([key, meta]) => {
      const s = groupStockMap.get(key);
      const total = s.unite_a + s.unite_b + s.central_sac + s.central_vrac + s.global_total;
      return {
        group_key: key,
        group_name: meta.group_name,
        unit: meta.unit,
        unite_a_stock: s.unite_a,
        unite_b_stock: s.unite_b,
        central_sac_stock: s.central_sac,
        central_vrac_stock: s.central_vrac,
        total_stock: total,
        minimum_stock: meta.minimum_stock,
        low_stock: total <= meta.minimum_stock
      };
    }).sort((a, b) => a.group_name.localeCompare(b.group_name));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;