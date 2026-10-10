import { api } from '../api.js';
import { fmt } from '../helpers.js';

export default {
  name: 'DashboardView',
  data() {
    return {
      summary: null,
      lowStock: [],
      loading: true
    };
  },
  async mounted() {
    await this.load();
  },
  methods: {
    fmt,
    async load() {
      this.loading = true;
      try {
        this.summary = await api('/movements/dashboard/summary');
        this.lowStock = await api('/raw-materials/alerts/low-stock');
      } finally {
        this.loading = false;
      }
    },
    shortBy(m) {
      return Number(m.minimum_stock) - Number(m.current_stock);
    }
  },
  template: `
<div>
  <div class="panel">
    <h2>Aperçu du jour</h2>
    <div class="stats-grid" v-if="summary">
      <div class="stat-card stat-card-main">
        <div class="stat-icon">📦</div>
        <div class="stat-content">
          <span class="stat-number">{{ summary.raw_material_count }}</span>
          <span class="stat-label">Matières premières</span>
        </div>
      </div>
      <div class="stat-card stat-card-main">
        <div class="stat-icon">🏷️</div>
        <div class="stat-content">
          <span class="stat-number">{{ summary.finished_product_count }}</span>
          <span class="stat-label">Produits finis</span>
        </div>
      </div>
      <div class="stat-card" :class="summary.low_stock_count > 0 ? 'stat-card-main' : 'stat-card-unit'">
        <div class="stat-icon">⚠️</div>
        <div class="stat-content">
          <span class="stat-number">{{ summary.low_stock_count }}</span>
          <span class="stat-label">Articles en stock bas</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Low stock alerts – keep as is -->
  <div class="panel">
    <div class="panel-head">
      <h2>Alertes de stock bas</h2>
      <span class="count">{{ lowStock.length }} article{{ lowStock.length === 1 ? '' : 's' }}</span>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Matière</th>
          <th>Emplacement</th>
          <th class="num-cell">Actuel</th>
          <th class="num-cell">Minimum</th>
          <th class="num-cell">Manque</th>
        </tr></thead>
        <tbody>
          <tr v-if="!lowStock.length"><td colspan="5" class="empty"><span class="big">—</span>Rien en dessous du stock minimum</td></tr>
          <tr v-for="m in lowStock" :key="m.id">
            <td class="text">{{ m.name }}</td>
            <td class="text">{{ m.storage_location || '—' }}</td>
            <td class="num-cell low">{{ fmt(m.current_stock) }} {{ m.unit }}</td>
            <td class="num-cell">{{ fmt(m.minimum_stock) }} {{ m.unit }}</td>
            <td class="num-cell low">{{ fmt(shortBy(m)) }} {{ m.unit }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
  `
};
