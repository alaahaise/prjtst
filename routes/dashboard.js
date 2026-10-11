const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;

// Raw materials shown in the "stock par emplacement" chart (display order). Edit this list to change the chart.
const KEY_MATERIALS = ['Mais', 'Soja', 'Calcaire', 'Son Fin'];
const LOW_STOCK_LIMIT = 12;
const TREND_MONTHS = 12;

/**
 * Work out every date window the dashboard needs for a given month.
 * - "current" runs from the 1st to `ref` (today, or month-end for a past month)
 * - "previous" is the month before, cut at the same day-of-month, so the comparison is like-for-like
 */
function buildPeriods(monthParam) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let y = today.getFullYear();
  let m = today.getMonth();

  const match = /^(\d{4})-(\d{2})$/.exec(monthParam || '');
  if (match) {
    const cy = Number(match[1]);
    const cm = Number(match[2]) - 1;
    if (cm >= 0 && cm <= 11 && new Date(cy, cm, 1) <= today) { y = cy; m = cm; }
  }

  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const ref = end < today ? end : today;
  const elapsed = ref.getDate();

  const prevStart = new Date(y, m - 1, 1);
  const prevEnd = new Date(y, m, 0);
  // In-progress month: cut last month at the same day so the comparison is like-for-like.
  // Finished month: compare against the whole previous month.
  const isCurrentMonth = end >= today;
  const prevRef = isCurrentMonth
    ? new Date(prevStart.getFullYear(), prevStart.getMonth(), Math.min(elapsed, prevEnd.getDate()))
    : prevEnd;

  return {
    month: `${y}-${pad(m + 1)}`,
    isCurrentMonth,
    elapsed,
    daysInMonth: end.getDate(),
    prevDays: prevEnd.getDate(),
    start: ymd(start), ref: ymd(ref), end: ymd(end),
    prevStart: ymd(prevStart), prevRef: ymd(prevRef), prevEnd: ymd(prevEnd),
    histStart: ymd(new Date(y, m - 3, 1)),
    prevMonthKeys: [1, 2, 3].map(i => {
      const d = new Date(y, m - i, 1);
      return { ym: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, days: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() };
    }),
    trendStart: ymd(new Date(y, m - (TREND_MONTHS - 1), 1)),
    trendMonths: Array.from({ length: TREND_MONTHS }, (_, i) => {
      const d = new Date(y, m - (TREND_MONTHS - 1) + i, 1);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    })
  };
}

function cumulative(rows, totalDays, upTo) {
  const perDay = new Array(totalDays).fill(0);
  for (const r of rows) perDay[r.d - 1] += num(r.kg);
  let run = 0;
  return perDay.map((v, i) => {
    if (i >= upTo) return null;
    run += v;
    return round2(run);
  });
}

// GET /api/dashboard?month=YYYY-MM   (month optional, defaults to the current month)
router.get('/', async (req, res) => {
  try {
    const p = buildPeriods(req.query.month);
    const q = async (sql, params = []) => (await pool.query(sql, params))[0];

    const prodTotals = (from, to) => q(
      `SELECT COALESCE(SUM(quantity_produced),0) AS kg, COUNT(*) AS runs
       FROM production WHERE production_date BETWEEN ? AND ?`, [from, to]);
    const purchaseTotal = (from, to) => q(
      `SELECT COALESCE(SUM(quantity),0) AS q FROM purchases WHERE purchase_date BETWEEN ? AND ?`, [from, to]);
    const consumptionTotal = (from, to) => q(
      `SELECT COALESCE(SUM(pi.quantity_used),0) AS q
       FROM production_items pi JOIN production p ON p.id = pi.production_id
       WHERE p.production_date BETWEEN ? AND ?`, [from, to]);
    const byUnit = (from, to) => q(
      `SELECT sl.code, SUM(p.quantity_produced) AS kg
       FROM production p JOIN stock_locations sl ON sl.id = p.location_id
       WHERE p.production_date BETWEEN ? AND ? GROUP BY sl.code`, [from, to]);
    const byProduct = (from, to) => q(
      `SELECT fp.id, fp.name, SUM(p.quantity_produced) AS kg
       FROM production p JOIN finished_products fp ON fp.id = p.finished_product_id
       WHERE p.production_date BETWEEN ? AND ? GROUP BY fp.id, fp.name ORDER BY kg DESC`, [from, to]);

    const [
      curProd, prevProd, prevFullProd,
      curPurch, prevPurch, curCons, prevCons,
      dailyRows,
      trendRows, curUnits, prevUnits, curProducts, prevProducts,
      stockRows, lowStockRows, lowStockCount
    ] = await Promise.all([
      prodTotals(p.start, p.ref), prodTotals(p.prevStart, p.prevRef), prodTotals(p.prevStart, p.prevEnd),
      purchaseTotal(p.start, p.ref), purchaseTotal(p.prevStart, p.prevRef),
      consumptionTotal(p.start, p.ref), consumptionTotal(p.prevStart, p.prevRef),
      q(`SELECT DATE_FORMAT(production_date,'%Y-%m') AS ym, DAY(production_date) AS d, SUM(quantity_produced) AS kg
         FROM production WHERE production_date BETWEEN ? AND ? GROUP BY ym, d`, [p.histStart, p.ref]),
      q(`SELECT DATE_FORMAT(production_date,'%Y-%m') AS ym, SUM(quantity_produced) AS kg, COUNT(*) AS runs
         FROM production WHERE production_date BETWEEN ? AND ? GROUP BY ym`, [p.trendStart, p.end]),
      byUnit(p.start, p.ref), byUnit(p.prevStart, p.prevRef),
      byProduct(p.start, p.ref), byProduct(p.prevStart, p.prevRef),
      q(`SELECT rm.id, rm.name, rm.unit,
                SUM(CASE WHEN sl.code = 'CENTRAL' THEN rms.quantity ELSE 0 END) AS central,
                SUM(CASE WHEN sl.code = 'UNITE_A' THEN rms.quantity ELSE 0 END) AS unite_a,
                SUM(CASE WHEN sl.code = 'UNITE_B' THEN rms.quantity ELSE 0 END) AS unite_b,
                MAX(CASE WHEN rm.stock_mode = 'GLOBAL' THEN rm.current_stock ELSE 0 END) AS pool,
                rm.current_stock AS total
         FROM raw_materials rm
         LEFT JOIN raw_material_stock rms ON rms.raw_material_id = rm.id
         LEFT JOIN stock_locations sl ON sl.id = rms.location_id
         WHERE rm.active = TRUE AND rm.name IN (?)
         GROUP BY rm.id, rm.name, rm.unit, rm.current_stock
         ORDER BY FIELD(rm.name, ?)`, [KEY_MATERIALS, KEY_MATERIALS]),
      q(`SELECT id, name, unit, current_stock, minimum_stock FROM raw_materials
         WHERE active = TRUE AND current_stock <= minimum_stock
         ORDER BY (current_stock - minimum_stock) ASC, name LIMIT ${LOW_STOCK_LIMIT}`),
      q(`SELECT COUNT(*) AS c FROM raw_materials WHERE active = TRUE AND current_stock <= minimum_stock`)
    ]);

    const chartDays = Math.max(p.daysInMonth, ...p.prevMonthKeys.map(k => k.days));
    const rowsFor = (ym) => dailyRows.filter(r => r.ym === ym);
    const history = p.prevMonthKeys.slice(1).map(k => ({
      month: k.ym,
      cumulative: cumulative(rowsFor(k.ym), chartDays, k.days),
      hasData: rowsFor(k.ym).length > 0
    })).filter(h => h.hasData).map(({ month, cumulative: c }) => ({ month, cumulative: c }));
    const prodNow = curProd[0];
    const projected = p.isCurrentMonth && p.elapsed > 0
      ? round2((num(prodNow.kg) / p.elapsed) * p.daysInMonth)
      : null;

    const trendMap = new Map(trendRows.map(r => [r.ym, r]));
    const unitMap = (rows) => new Map(rows.map(r => [r.code, num(r.kg)]));
    const curU = unitMap(curUnits);
    const prevU = unitMap(prevUnits);
    const prevProductMap = new Map(prevProducts.map(r => [r.id, num(r.kg)]));

    res.json({
      period: {
        month: p.month, isCurrentMonth: p.isCurrentMonth, elapsed: p.elapsed,
        daysInMonth: p.daysInMonth, prevDays: p.prevDays,
        from: p.start, to: p.ref, prevFrom: p.prevStart, prevTo: p.prevRef
      },
      kpis: {
        production: {
          kg: num(prodNow.kg), runs: num(prodNow.runs),
          prevKg: num(prevProd[0].kg), prevRuns: num(prevProd[0].runs),
          prevMonthTotalKg: num(prevFullProd[0].kg), projectedKg: projected
        },
        consumption: { value: num(curCons[0].q), prev: num(prevCons[0].q) },
        purchases: { value: num(curPurch[0].q), prev: num(prevPurch[0].q) },
        lowStockCount: num(lowStockCount[0].c)
      },
      dailyCumulative: {
        labels: Array.from({ length: chartDays }, (_, i) => i + 1),
        current: cumulative(rowsFor(p.month), chartDays, p.elapsed),
        previous: cumulative(rowsFor(p.prevMonthKeys[0].ym), chartDays, p.prevDays),
        history
      },
      monthlyTrend: p.trendMonths.map(ym => {
        const r = trendMap.get(ym);
        return { month: ym, kg: r ? round2(num(r.kg)) : 0, runs: r ? num(r.runs) : 0 };
      }),
      byUnit: ['UNITE_A', 'UNITE_B'].map(code => ({
        code, current: round2(curU.get(code) || 0), previous: round2(prevU.get(code) || 0)
      })),
      topProducts: curProducts.slice(0, 6).map(r => ({
        name: r.name, current: round2(num(r.kg)), previous: round2(prevProductMap.get(r.id) || 0)
      })),
      stockByLocation: stockRows.map(r => ({
        name: r.name, unit: r.unit,
        central: num(r.central), unite_a: num(r.unite_a), unite_b: num(r.unite_b), pool: num(r.pool), total: num(r.total)
      })),
      lowStock: lowStockRows.map(r => ({
        id: r.id, name: r.name, unit: r.unit,
        current: num(r.current_stock), minimum: num(r.minimum_stock)
      }))
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
