const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  const {
    from,
    to,
    material_type,
    material_id,
    movement_type,
    page,
    limit
  } = req.query;

  // Pagination defaults
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 100;
  const offset = (pageNum - 1) * limitNum;

  // Base query – material name & unit depend on type
  let sql = `
    SELECT
      sm.id,
      sm.movement_date,
      sm.material_type,
      sm.material_id,
      COALESCE(rm.name, fp.name) AS material_name,
      COALESCE(rm.unit, fp.unit) AS unit,
      sm.movement_type,
      sm.quantity,
      pkg.name AS packaging_name,
      pool_loc.code AS pool_location_code,
      pool_loc.name AS pool_location_name,
      exec_loc.code AS executed_by_code,
      exec_loc.name AS executed_by_name,
      sm.reference_id,
      sm.remark,
      sm.created_at
    FROM stock_movements sm
    LEFT JOIN raw_materials    rm ON sm.material_type = 'RAW'      AND rm.id = sm.material_id
    LEFT JOIN finished_products fp ON sm.material_type = 'FINISHED' AND fp.id = sm.material_id
    LEFT JOIN packaging pkg ON pkg.id = sm.packaging_id
    LEFT JOIN stock_locations pool_loc ON pool_loc.id = sm.pool_location_id
    LEFT JOIN stock_locations exec_loc ON exec_loc.id = sm.executed_by_location_id
    WHERE 1=1
  `;
  const params = [];

  // Filters
  if (from) {
    sql += ' AND DATE(sm.movement_date) >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND DATE(sm.movement_date) <= ?';
    params.push(to);
  }
  if (material_type) {
    sql += ' AND sm.material_type = ?';
    params.push(material_type);
  }
  if (material_id && material_type) {
    sql += ' AND sm.material_id = ?';
    params.push(material_id);
  }
  if (movement_type) {
    sql += ' AND sm.movement_type = ?';
    params.push(movement_type);
  }

  // Count total (for pagination)
  const countSql = sql.replace(
    /SELECT[\s\S]*?FROM/,
    'SELECT COUNT(*) AS total FROM'
  );
  const [countResult] = await pool.query(countSql, params);
  const total = countResult[0]?.total || 0;

  // Order and paginate
  sql += ' ORDER BY sm.movement_date DESC, sm.id DESC LIMIT ? OFFSET ?';
  params.push(limitNum, offset);

  const [rows] = await pool.query(sql, params);

  res.json({
    data: rows,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum)
  });
});

// Dashboard summary (unchanged)
router.get('/dashboard/summary', async (req, res) => {
  try {
    const [[rawCount]] = await pool.query('SELECT COUNT(*) AS c FROM raw_materials WHERE active = TRUE');
    const [[fpCount]] = await pool.query('SELECT COUNT(*) AS c FROM finished_products WHERE active = TRUE');
    const [[lowStock]] = await pool.query(
      'SELECT COUNT(*) AS c FROM raw_materials WHERE active = TRUE AND current_stock <= minimum_stock'
    );
    const [[purchasesToday]] = await pool.query(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM purchases WHERE purchase_date = CURDATE()"
    );
    const [[salesToday]] = await pool.query(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM sales WHERE sale_date = CURDATE()"
    );
    const [[producedToday]] = await pool.query(
      "SELECT COALESCE(SUM(quantity_produced),0) AS total FROM production WHERE production_date = CURDATE()"
    );

    res.json({
      raw_material_count: rawCount.c,
      finished_product_count: fpCount.c,
      low_stock_count: lowStock.c,
      purchases_today: Number(purchasesToday.total) || 0,
      sales_today: Number(salesToday.total) || 0,
      produced_today: Number(producedToday.total) || 0
    });
  } catch (err) {
    console.error('Dashboard summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;