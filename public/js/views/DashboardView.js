import { api } from '../api.js';
import { fmt } from '../helpers.js';
import ChartCanvas from '../components/ChartCanvas.js';

const UNIT = 'Q';
const RED = '#e5342a';
const RED_SOFT = 'rgba(229, 52, 42, 0.12)';
const RED_LIGHT = 'rgba(229, 52, 42, 0.35)';
const GREY = '#b9b9c4';
const DARK = '#15151b';
const BLUE = '#2563eb';
const AMBER = '#d99a2e';
const HISTORY_COLORS = [BLUE, AMBER];

const UNIT_LABELS = { UNITE_A: 'Unité A', UNITE_B: 'Unité B' };

function monthLabel(ym, opts = { month: 'short', year: '2-digit' }) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', opts);
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function dayRange(from, to) {
  const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
  return a.getDate() + '–' + b.getDate() + ' ' + b.toLocaleDateString('fr-FR', { month: 'short' });
}

// Horizontal charts (indexAxis 'y') keep their value on x; vertical charts keep it on y.
const valueOf = (ctx) => (ctx.chart.options.indexAxis === 'y' ? ctx.parsed.x : ctx.parsed.y);
const tipQ = (ctx) => ' ' + ctx.dataset.label + ' : ' + fmt(valueOf(ctx)) + ' ' + UNIT;
const tickQ = (v) => fmt(v);

export default {
  name: 'DashboardView',
  components: { ChartCanvas },
  data() {
    const now = new Date();
    const current = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    return {
      month: current, maxMonth: current, d: null, loading: true, error: '',
      compare: 'prev',     // cumulative chart: 'prev' = last month only, 'three' = last 3 months
      trendRange: 6,       // monthly chart: 6 or 12 months
      stockMode: 'qty'     // stock chart: 'qty' = quantities, 'pct' = split by location in %
    };
  },
  async mounted() { await this.load(); },
  computed: {
    UNIT() { return UNIT; },
    periodLabel() {
      if (!this.d) return '';
      const p = this.d.period;
      return dayRange(p.from, p.to) + ' ' + monthLabel(p.month, { year: 'numeric' }) +
        '  vs  ' + dayRange(p.prevFrom, p.prevTo);
    },
    curName() { return this.d ? monthLabel(this.d.period.month, { month: 'long' }) : ''; },
    prevName() { return this.d ? monthLabel(shiftMonth(this.d.period.month, -1), { month: 'long' }) : ''; },
    hasHistory() { return !!this.d && this.d.dailyCumulative.history.length > 0; },
    cumulativeTitle() {
      if (this.compare === 'three' && this.hasHistory) {
        return 'Production cumulée — ' + this.curName + ' vs ' + (this.d.dailyCumulative.history.length + 1) + ' mois précédents';
      }
      return 'Production cumulée — ' + this.curName + ' vs ' + this.prevName;
    },
    kpis() {
      if (!this.d) return [];
      const k = this.d.kpis;
      const proj = k.production.projectedKg;
      return [
        {
          label: 'Production', icon: 'settings', value: fmt(k.production.kg), unit: UNIT,
          delta: this.delta(k.production.kg, k.production.prevKg),
          foot: k.production.runs + ' production' + (k.production.runs > 1 ? 's' : '') +
            (proj !== null ? ' · projection fin de mois ' + fmt(proj) + ' ' + UNIT : '')
        },
        {
          label: 'Matières consommées', icon: 'package', value: fmt(k.consumption.value), unit: UNIT,
          delta: this.delta(k.consumption.value, k.consumption.prev, true),
          foot: 'Mois précédent : ' + fmt(k.consumption.prev)
        },
        {
          label: 'Achats matières', icon: 'shopping-cart', value: fmt(k.purchases.value), unit: UNIT,
          delta: this.delta(k.purchases.value, k.purchases.prev, true),
          foot: 'Mois précédent : ' + fmt(k.purchases.prev)
        },
        {
          label: 'Stock bas', icon: 'alert', value: String(k.lowStockCount),
          unit: 'article' + (k.lowStockCount > 1 ? 's' : ''),
          delta: null, foot: 'Matières sous le minimum', danger: k.lowStockCount > 0
        }
      ];
    },
    cumulativeChart() {
      const c = this.d.dailyCumulative;
      const line = (label, data, color, extra = {}) => ({
        label, data, borderColor: color, fill: false, tension: 0.25, pointRadius: 0, pointHoverRadius: 4,
        borderWidth: 2, spanGaps: false, ...extra
      });
      const datasets = [
        line(this.curName, c.current, RED, { backgroundColor: RED_SOFT, fill: true, borderWidth: 2.5 }),
        line(this.prevName, c.previous, GREY, { borderDash: [6, 5] })
      ];
      if (this.compare === 'three') {
        c.history.forEach((h, i) => {
          datasets.push(line(monthLabel(h.month, { month: 'long' }), h.cumulative, HISTORY_COLORS[i % HISTORY_COLORS.length], { borderDash: [2, 4] }));
        });
      }
      return {
        data: { labels: c.labels, datasets },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', align: 'end', labels: { pointStyle: 'line', boxWidth: 26 } },
            tooltip: {
              callbacks: {
                title: (items) => 'Jour ' + items[0].label,
                label: (ctx) => ctx.parsed.y === null ? '' : tipQ(ctx)
              }
            }
          },
          scales: {
            x: { grid: { display: false }, title: { display: true, text: 'Jour du mois' } },
            y: { beginAtZero: true, ticks: { callback: tickQ }, title: { display: true, text: UNIT + ' cumulés' } }
          }
        }
      };
    },
    trendRows() {
      // last N months, without the empty months before the first production
      const rows = this.d.monthlyTrend.slice(-this.trendRange);
      const first = rows.findIndex(r => r.kg > 0 || r.runs > 0);
      return first > 0 ? rows.slice(first) : rows;
    },
    trendChart() {
      const t = this.trendRows;
      const last = t.length - 1;
      return {
        data: {
          labels: t.map(r => monthLabel(r.month)),
          datasets: [
            { type: 'bar', label: 'Production', data: t.map(r => r.kg), yAxisID: 'y', borderRadius: 6, maxBarThickness: 46,
              backgroundColor: t.map((_, i) => i === last ? RED : RED_LIGHT) },
            { type: 'line', label: 'Nombre de productions', data: t.map(r => r.runs), yAxisID: 'y1', borderColor: DARK,
              backgroundColor: DARK, borderWidth: 2, tension: 0.25, pointRadius: 3 }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', align: 'end' },
            tooltip: {
              callbacks: {
                label: (ctx) => ctx.dataset.yAxisID === 'y1'
                  ? ' ' + ctx.dataset.label + ' : ' + ctx.parsed.y
                  : tipQ(ctx)
              }
            }
          },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { callback: tickQ }, position: 'left' },
            y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { precision: 0 } }
          }
        }
      };
    },
    unitChart() {
      const u = this.d.byUnit;
      return {
        data: {
          labels: u.map(r => UNIT_LABELS[r.code] || r.code),
          datasets: [
            { label: this.curName, data: u.map(r => r.current), backgroundColor: RED, borderRadius: 6, maxBarThickness: 60 },
            { label: this.prevName, data: u.map(r => r.previous), backgroundColor: GREY, borderRadius: 6, maxBarThickness: 60 }
          ]
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: tipQ } } },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: tickQ } } }
        }
      };
    },
    productsChart() {
      const p = this.d.topProducts;
      return {
        data: {
          labels: p.map(r => r.name),
          datasets: [
            { label: this.curName, data: p.map(r => r.current), backgroundColor: RED, borderRadius: 4 },
            { label: this.prevName, data: p.map(r => r.previous), backgroundColor: GREY, borderRadius: 4 }
          ]
        },
        options: {
          indexAxis: 'y',
          interaction: { mode: 'index', axis: 'y', intersect: false },
          plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: tipQ } } },
          scales: { x: { beginAtZero: true, ticks: { callback: tickQ } }, y: { grid: { display: false } } }
        }
      };
    },
    stockChart() {
      const s = this.d.stockByLocation;
      const pct = this.stockMode === 'pct';
      const series = [
        ['Stock Central', 'central', DARK],
        ['Unité A', 'unite_a', RED],
        ['Unité B', 'unite_b', BLUE],
        ['Pool global', 'pool', GREY]
      ];
      const sumOf = (r) => series.reduce((acc, [, key]) => acc + Math.max(0, r[key]), 0);
      return {
        data: {
          labels: s.map(r => [r.name, fmt(r.total) + ' ' + UNIT]),
          datasets: series.map(([label, key, color]) => ({
            label, backgroundColor: color, borderRadius: 3, maxBarThickness: 38,
            raw: s.map(r => r[key]),
            data: s.map(r => pct ? (sumOf(r) ? (Math.max(0, r[key]) / sumOf(r)) * 100 : 0) : r[key])
          }))
        },
        options: {
          indexAxis: 'y',
          interaction: { mode: 'index', axis: 'y', intersect: false },
          plugins: {
            legend: { position: 'top', align: 'end' },
            tooltip: {
              filter: (item) => item.parsed.x !== 0,
              callbacks: {
                title: (items) => items[0].chart.data.labels[items[0].dataIndex][0],
                label: (ctx) => {
                  const raw = fmt(ctx.dataset.raw[ctx.dataIndex]) + ' ' + UNIT;
                  return pct ? ' ' + ctx.dataset.label + ' : ' + ctx.parsed.x.toFixed(1) + ' %  (' + raw + ')'
                             : ' ' + ctx.dataset.label + ' : ' + raw;
                }
              }
            }
          },
          scales: {
            x: pct
              ? { stacked: true, min: 0, max: 100, ticks: { callback: (v) => v + '%' } }
              : { stacked: true, ticks: { callback: tickQ } },
            y: { stacked: true, grid: { display: false } }
          }
        }
      };
    }
  },
  methods: {
    fmt,
    async load() {
      this.loading = true;
      this.error = '';
      try {
        this.d = await api('/dashboard?month=' + encodeURIComponent(this.month));
        this.month = this.d.period.month;
        if (!this.hasHistory) this.compare = 'prev';
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },
    // neutral = true for figures where "more" isn't automatically good or bad (purchases, consumption)
    delta(cur, prev, neutral = false) {
      cur = Number(cur) || 0;
      prev = Number(prev) || 0;
      if (!cur && !prev) return { text: '—', cls: '' };
      if (!prev) return { text: 'Nouveau', cls: neutral ? '' : 'up' };
      const pct = ((cur - prev) / prev) * 100;
      if (Math.abs(pct) < 0.05) return { text: '0%', cls: '' };
      const cls = neutral ? '' : (pct > 0 ? 'up' : 'down');
      return { text: (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%', cls };
    },
    stockPct(m) {
      return m.minimum > 0 ? Math.max(0, Math.min(100, (m.current / m.minimum) * 100)) : 0;
    },
    stockStatus(m) {
      if (m.current <= 0) return { label: 'Rupture', cls: 'danger' };
      if (m.minimum > 0 && m.current / m.minimum < 0.25) return { label: 'Critique', cls: 'danger' };
      return { label: 'Bas', cls: 'warn' };
    }
  },
  template: `
<div>
  <div class="dash-head">
    <div>
      <h1>Tableau de bord</h1>
      <div class="dash-sub" v-if="d">{{ periodLabel }}</div>
    </div>
    <div class="dash-controls">
      <input type="month" v-model="month" :max="maxMonth" @change="load" aria-label="Mois">
      <button class="btn-secondary" @click="load" :disabled="loading"><svg-icon name="refresh" /> Actualiser</button>
    </div>
  </div>

  <div class="dash-quick">
    <span class="dash-quick-label">Actions rapides</span>
    <router-link class="qbtn primary" :to="{ path: '/production', query: { new: 1 } }"><svg-icon name="settings" /> Nouvelle production</router-link>
    <router-link class="qbtn" :to="{ path: '/purchases' }"><svg-icon name="shopping-cart" /> Nouvel achat</router-link>
    <router-link class="qbtn" :to="{ path: '/transfers', query: { new: 1 } }"><svg-icon name="arrow-left-right" /> Nouveau transfert</router-link>
  </div>

  <div class="panel" v-if="error"><div class="empty"><span class="big">!</span>{{ error }}</div></div>

  <div v-else-if="d" :class="{ 'dash-loading': loading }">
    <div class="dash-kpis">
      <div class="kpi" v-for="k in kpis" :key="k.label">
        <div class="kpi-top">
          <span class="kpi-label">{{ k.label }}</span>
          <span class="kpi-icon" :class="{ danger: k.danger }"><svg-icon :name="k.icon" /></span>
        </div>
        <div class="kpi-value">{{ k.value }}<small>{{ k.unit }}</small></div>
        <div class="kpi-meta">
          <span class="delta" :class="k.delta.cls" v-if="k.delta">{{ k.delta.text }}</span>
          <span class="kpi-foot">{{ k.foot }}</span>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>{{ cumulativeTitle }}</h2>
        <div class="panel-tools">
          <div class="seg" v-if="hasHistory">
            <button :class="{ active: compare === 'prev' }" @click="compare = 'prev'">Mois précédent</button>
            <button :class="{ active: compare === 'three' }" @click="compare = 'three'">Plus de mois</button>
          </div>
          <span class="count">à jour du {{ d.period.elapsed }}</span>
        </div>
      </div>
      <chart-canvas type="line" :height="340" :data="cumulativeChart.data" :options="cumulativeChart.options" />
    </div>

    <div class="dash-row">
      <div class="panel">
        <div class="panel-head">
          <h2>Production mensuelle</h2>
          <div class="seg">
            <button :class="{ active: trendRange === 6 }" @click="trendRange = 6">6 mois</button>
            <button :class="{ active: trendRange === 12 }" @click="trendRange = 12">12 mois</button>
          </div>
        </div>
        <chart-canvas type="bar" :data="trendChart.data" :options="trendChart.options" />
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Production par unité</h2><span class="count">même période</span></div>
        <chart-canvas type="bar" :data="unitChart.data" :options="unitChart.options" />
      </div>
    </div>

    <div class="dash-row">
      <div class="panel">
        <div class="panel-head">
          <h2>Stock matières par emplacement</h2>
          <div class="seg">
            <button :class="{ active: stockMode === 'qty' }" @click="stockMode = 'qty'">Quantités</button>
            <button :class="{ active: stockMode === 'pct' }" @click="stockMode = 'pct'">Répartition %</button>
          </div>
        </div>
        <chart-canvas type="bar" :height="300" :data="stockChart.data" :options="stockChart.options" />
        <p class="dash-note">Pool global : matières suivies sans répartition par unité (ex. Maïs, Calcaire).</p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Top produits fabriqués</h2><span class="count">même période</span></div>
        <chart-canvas type="bar" :height="332" :data="productsChart.data" :options="productsChart.options" />
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>Alertes de stock bas</h2>
        <div class="panel-tools">
          <span class="count">{{ d.lowStock.length }} sur {{ d.kpis.lowStockCount }}</span>
          <router-link class="qbtn small" to="/materials">Voir les matières →</router-link>
        </div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th>Matière</th>
            <th>Niveau</th>
            <th class="num-cell">Actuel</th>
            <th class="num-cell">Minimum</th>
            <th class="num-cell">Manque</th>
          </tr></thead>
          <tbody>
            <tr v-if="!d.lowStock.length"><td colspan="5" class="empty"><span class="big">—</span>Rien en dessous du stock minimum</td></tr>
            <tr v-for="m in d.lowStock" :key="m.id">
              <td class="text">{{ m.name }}</td>
              <td>
                <div class="level">
                  <div class="stock-bar"><span :style="{ width: stockPct(m) + '%' }"></span></div>
                  <span class="chip" :class="stockStatus(m).cls">{{ stockStatus(m).label }}</span>
                </div>
              </td>
              <td class="num-cell low">{{ fmt(m.current) }} {{ m.unit }}</td>
              <td class="num-cell">{{ fmt(m.minimum) }} {{ m.unit }}</td>
              <td class="num-cell low">{{ fmt(m.minimum - m.current) }} {{ m.unit }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="dash-note" v-if="d.kpis.lowStockCount > d.lowStock.length">
        + {{ d.kpis.lowStockCount - d.lowStock.length }} autre(s) article(s) sous le minimum.
      </p>
    </div>
  </div>

  <div class="panel" v-else><div class="empty">Chargement…</div></div>
</div>
  `
};
