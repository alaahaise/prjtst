import { api } from '../api.js';
import { fmt, sortRows, matchesText, inRange, exportCSV, todayStr, formatDate, relativeLabel } from '../helpers.js';
import { toast } from '../toast.js';
import { openReport, printReport } from '../report.js';
import ProductionModal from '../components/ProductionModal.js';

export default {
  name: 'ProductionView',
  components: {
    ProductionModal
  },
  data() {
    return {
      items: [],
      materials: [],
      products: [],
      recipes: [],
      loading: false,
      
      // Filters
      search: '',
      from: '',
      to: '',
      period: 'month',
      filterUnit: [],
      filterProduct: [],
      unitSearch: '',
      productSearch: '',
      
      // Grouping
      groupBy: 'none',
      
      // Sorting
      sortKey: 'production_date',
      sortDir: -1,
      sortType: 'date',

      // Sorting (grouped view)
      groupSortKey: 'total_produced',
      groupSortDir: -1,
      groupSortType: 'number',
      
      // Modal
      showModal: false,
      editing: null,
      
      // Report settings
      reportSettings: {
        company_name: 'CASPM',
        report_title: '',
        footer_note: 'Confidentiel — usage interne'
      }
};
  },
  watch: {
    // when the grouping changes, pick a sensible default order
    groupBy(v) {
      if (['day', 'month', 'year'].includes(v)) {
        this.groupSortKey = 'sort_key'; this.groupSortType = 'text'; this.groupSortDir = -1; // newest first
      } else if (v !== 'none') {
        this.groupSortKey = 'total_produced'; this.groupSortType = 'number'; this.groupSortDir = -1;
      }
    }
  },
  computed: {
    units() {
      return [...new Set(this.items.map(r => r.location_code).filter(Boolean))];
    },
    filteredUnits() {
      if (!this.unitSearch) return this.units;
      const q = this.unitSearch.toLowerCase();
      return this.units.filter(u => u.toLowerCase().includes(q));
    },
    filteredProducts() {
      if (!this.productSearch) return this.products;
      const q = this.productSearch.toLowerCase();
      return this.products.filter(p => 
        p.name.toLowerCase().includes(q) || 
        (p.code && p.code.toLowerCase().includes(q))
      );
    },
    filtered() {
      let rows = this.items.filter(r =>
        matchesText(r, ['finished_product_name', 'note'], this.search.trim()) &&
        inRange(r.production_date, this.from, this.to) &&
        (this.filterUnit.length === 0 || this.filterUnit.includes(String(r.location_code))) &&
        (this.filterProduct.length === 0 || this.filterProduct.includes(String(r.finished_product_id)))
      );
      return sortRows(rows, this.sortKey, this.sortDir, this.sortType);
    },
    groupedRows() {
      if (this.groupBy === 'none') return null;
      
      const map = new Map();
      for (const r of this.filtered) {
        let key, label;
        switch (this.groupBy) {
          case 'product':
            key = r.finished_product_id;
            label = r.finished_product_name;
            break;
          case 'unit':
            key = r.location_code || '—';
            label = r.location_code || '—';
            break;
          case 'day':
            key = r.production_date?.slice(0, 10);
            label = formatDate(r.production_date);
            break;
          case 'month':
            const d = new Date(r.production_date);
            key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
            break;
          case 'year':
            const y = new Date(r.production_date);
            key = String(y.getFullYear());
            label = String(y.getFullYear());
            break;
        }
        if (!map.has(key)) {
          map.set(key, { group_label: label, runs: 0, total_produced: 0, unit: r.unit, materialsMap: new Map(), sort_key: key });
        }
        const g = map.get(key);
        g.runs += 1;
        g.total_produced += Number(r.quantity_produced);
        (r.items_used || []).forEach(i => {
          if (!g.materialsMap.has(i.raw_material_name)) {
            g.materialsMap.set(i.raw_material_name, { qty: 0, unit: i.unit });
          }
          g.materialsMap.get(i.raw_material_name).qty += Number(i.quantity_used);
        });
      }
const rows = [...map.values()].map(g => ({
        group_label: g.group_label,
        runs: g.runs,
        total_produced: g.total_produced,
        unit: g.unit,
        // chronological groups sort on their YYYY-MM / YYYY-MM-DD key, not on the French label
        sort_key: ['day', 'month', 'year'].includes(this.groupBy) ? g.sort_key : g.group_label,
        materials: [...g.materialsMap.entries()]
          .map(([name, v]) => ({ name, qty: v.qty, unit: v.unit }))
          .sort((a, b) => b.qty - a.qty)
      }));
      return sortRows(rows, this.groupSortKey, this.groupSortDir, this.groupSortType);
    },
    summaryStats() {
      const rows = this.filtered;
      const totalRuns = rows.length;
      const totalProduced = rows.reduce((s, r) => s + Number(r.quantity_produced), 0);
      const byUnit = {};
      rows.forEach(r => {
        const u = r.location_code || '—';
        byUnit[u] = (byUnit[u] || 0) + Number(r.quantity_produced);
      });
      return { totalRuns, totalProduced, byUnit };
    },
    materialsBreakdown() {
      const totals = new Map();
      this.filtered.forEach(r => {
        (r.items_used || []).forEach(i => {
          if (!totals.has(i.raw_material_name)) {
            totals.set(i.raw_material_name, { qty: 0, unit: i.unit });
          }
          totals.get(i.raw_material_name).qty += Number(i.quantity_used);
        });
      });
      return [...totals.entries()]
        .map(([name, v]) => ({ name, qty: v.qty, unit: v.unit }))
        .sort((a, b) => b.qty - a.qty);
    }
  },
  async mounted() {
    await this.loadData();
    this.applyPeriod();
  },
  methods: {
    fmt, formatDate, relativeLabel,
    
    async loadData() {
      this.loading = true;
      try {
        const [materials, products, recipes, items] = await Promise.all([
          api('/raw-materials'),
          api('/finished-products'),
          api('/recipes'),
          api('/production')
        ]);
        this.materials = materials;
        this.products = products;
        this.recipes = recipes;
        this.items = items;
      } catch (err) {
        toast('Erreur lors du chargement des données', false);
      } finally {
        this.loading = false;
      }
    },
    
    async refresh() {
      await this.loadData();
    },
    
    applyPeriod() {
      const today = new Date();
      if (this.period === 'today') {
        this.from = this.to = todayStr();
      } else if (this.period === 'month') {
        this.from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
        this.to = todayStr();
      } else if (this.period === 'year12') {
        const d = new Date(today);
        d.setMonth(d.getMonth() - 12);
        this.from = d.toISOString().slice(0, 10);
        this.to = todayStr();
      } else if (this.period === 'all') {
        this.from = '';
        this.to = '';
      }
    },
    
    markCustom() {
      this.period = 'custom';
    },
    
    toggleSort(key, type) {
      if (this.sortKey === key) {
        this.sortDir *= -1;
      } else {
        this.sortKey = key;
        this.sortType = type;
        this.sortDir = 1;
      }
    },
    
    sortClass(key) {
      if (this.sortKey !== key) return '';
      return this.sortDir === 1 ? 'sort-asc' : 'sort-desc';
    },

toggleGroupSort(key, type) {
      if (this.groupSortKey === key) {
        this.groupSortDir *= -1;
      } else {
        this.groupSortKey = key;
        this.groupSortType = type;
        this.groupSortDir = 1;
      }
    },

    groupSortClass(key) {
      if (this.groupSortKey !== key) return '';
      return this.groupSortDir === 1 ? 'sort-asc' : 'sort-desc';
    },
    
    openModal() {
      this.editing = null;
      this.showModal = true;
    },
    
    editProduction(prod) {
      this.editing = prod;
      this.showModal = true;
    },
    
    closeModal() {
      this.showModal = false;
      this.editing = null;
    },
    
    onProductionSaved() {
      this.refresh();
    },
    
    async deleteProduction(id) {
      if (!confirm('Voulez-vous vraiment supprimer cette production ?')) return;
      try {
        await api(`/production/${id}`, { method: 'DELETE' });
        toast('Production supprimée');
        await this.refresh();
      } catch (err) {
        toast(err.message || 'Erreur lors de la suppression', false);
      }
    },
    
    exportCSV() {
      if (this.groupBy !== 'none' && this.groupedRows) {
        exportCSV('production_grouped.csv',
          ['Groupe', 'Lots', 'Total produit', 'Unité', 'Matières consommées'],
          this.groupedRows.map(g => [
            g.group_label,
            g.runs,
            fmt(g.total_produced),
            g.unit || '',
            (g.materials || []).map(m => `${m.name}: ${fmt(m.qty)} ${m.unit}`).join('; ')
          ])
        );
      } else {
        exportCSV('production.csv',
          ['Date', 'Unité', 'Produit', 'Quantité', 'Unité de mesure', 'Matières utilisées'],
          this.filtered.map(r => [
            r.production_date?.slice(0, 10),
            r.location_code,
            r.finished_product_name,
            fmt(r.quantity_produced),
            r.unit,
            (r.items_used || []).map(i => `${i.raw_material_name}: ${fmt(i.quantity_used)} ${i.unit}`).join('; ')
          ])
        );
      }
    },
    buildReportBody() {
      const periodLabel = `${this.from || 'Début'} → ${this.to || "Aujourd'hui"}`;
      const generatedAt = new Date().toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
      const { totalRuns, totalProduced, byUnit } = this.summaryStats;

      const unitStatsHtml = Object.entries(byUnit)
        .map(([u, v]) => `<div class="rpt-stat"><span class="num">${fmt(v)}</span><span class="lbl">${u}</span></div>`)
        .join('');

      let mainTableHtml;
      if (this.groupBy === 'none') {
        mainTableHtml = `<table class="rpt-table"><thead><tr><th>Date</th><th>Unité</th><th>Produit</th><th class="num">Quantité</th></tr></thead><tbody>${
          this.filtered.map(r => `<tr><td>${formatDate(r.production_date)}</td><td>${r.location_code || '—'}</td><td>${r.finished_product_name}</td><td class="num">${fmt(r.quantity_produced)} ${r.unit}</td></tr>`).join('')
        }</tbody></table>`;
      } else {
        mainTableHtml = `<table class="rpt-table"><thead><tr><th>Groupe</th><th class="num">Lots</th><th class="num">Total produit</th><th>Matières consommées</th></tr></thead><tbody>${
          (this.groupedRows || []).map(g => `<tr><td>${g.group_label}</td><td class="num">${g.runs}</td><td class="num">${fmt(g.total_produced)} ${g.unit || ''}</td><td>${(g.materials || []).map(m => `${m.name}: ${fmt(m.qty)} ${m.unit}`).join(', ')}</td></tr>`).join('')
        }</tbody></table>`;
      }

      const materials = this.materialsBreakdown;
      const materialsTableHtml = materials.length
        ? `<table class="rpt-table"><thead><tr><th>Matière première</th><th class="num">Total consommé</th></tr></thead><tbody>${
            materials.map(m => `<tr><td>${m.name}</td><td class="num">${fmt(m.qty)} ${m.unit}</td></tr>`).join('')
          }</tbody></table>`
        : '<p style="font-size:12px;color:#9a9aa6;">Aucune donnée de matières pour cette période.</p>';

      const companyName = this.reportSettings.company_name.trim() || 'CASPM';
      const customTitle = this.reportSettings.report_title.trim();
      const footerNote = this.reportSettings.footer_note.trim() || 'Confidentiel — usage interne';
      const titleLine = customTitle || `Rapport de production — ${this.groupBy !== 'none' ? 'Groupé' : 'Détail'}`;

      return {
        title: titleLine,
        html: `
          <div class="rpt-header">
            <div class="rpt-company">${companyName}</div>
            <div class="rpt-title">${titleLine}</div>
            <div class="rpt-meta"><span>Période : ${periodLabel}</span><span>${generatedAt}</span></div>
          </div>
          <div class="rpt-summary">
            <div class="rpt-stat"><span class="num">${totalRuns}</span><span class="lbl">Lots dans la plage</span></div>
            <div class="rpt-stat"><span class="num">${fmt(totalProduced)}</span><span class="lbl">Total produit</span></div>
            ${unitStatsHtml}
          </div>
          <div class="rpt-section-title">Détail de la production</div>
          ${mainTableHtml}
          <div class="rpt-section-title">Matières premières consommées</div>
          ${materialsTableHtml}
          <div class="rpt-footer"><span>${footerNote}</span></div>
        `
      };
    },

    generateReport() {
      const { title, html } = this.buildReportBody();
      if (!openReport(html, title)) {
        toast('Veuillez autoriser les pop-ups pour voir le rapport', false);
      }
    },

    exportPrintReport() {
      const { title, html } = this.buildReportBody();
      if (!printReport(html, title)) {
        toast('Veuillez autoriser les pop-ups pour imprimer', false);
      }
    }
  },
  template: `
    <div>
      <!-- Header with action buttons -->
      <div class="view-header">
        <div class="view-header-left">
          <h1>Production</h1>
        </div>
        <div class="view-header-right">
          <button class="btn-primary" @click="openModal">+ Nouvelle production</button>
          <button class="btn-secondary" @click="refresh" :disabled="loading"><svg-icon name="refresh" /> Actualiser</button>
        </div>
      </div>


      <!-- Filters & toolbar -->
      <div class="toolbar">
        <div class="search-wrap">
          <span class="ic"><svg-icon name="search" /></span>
          <input type="search" v-model="search" placeholder="Rechercher par produit, note...">
        </div>
        
        <select v-model="period" @change="applyPeriod" class="filter-select">
          <option value="today">Aujourd'hui</option>
          <option value="month">Ce mois-ci</option>
          <option value="year12">12 derniers mois</option>
          <option value="all">Toutes les données</option>
          <option value="custom">Personnalisé</option>
        </select>
        
        <div class="date-range">
          <input type="date" v-model="from" @change="markCustom" placeholder="De">
          <span>→</span>
          <input type="date" v-model="to" @change="markCustom" placeholder="À">
        </div>

        <div class="filter-group">
          <select v-model="filterUnit" multiple size="1" class="filter-select-sm">
            <option v-for="u in filteredUnits" :key="u" :value="u">{{ u }}</option>
          </select>
        </div>

        <div class="filter-group">
          <select v-model="filterProduct" multiple size="1" class="filter-select-sm">
            <option v-for="p in filteredProducts" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
          </select>
        </div>

        <select v-model="groupBy" class="filter-select">
          <option value="none">Pas de regroupement</option>
          <option value="day">Par jour</option>
          <option value="month">Par mois</option>
          <option value="year">Par année</option>
          <option value="product">Par produit</option>
          <option value="unit">Par unité</option>
        </select>

        <div class="toolbar-actions">
          <button class="btn-secondary btn-small" @click="exportCSV"><svg-icon name="download" /> CSV</button>
          <button class="btn-secondary btn-small" @click="generateReport"><svg-icon name="file-text" /> Rapport</button>
          <button class="btn-secondary btn-small" @click="exportPrintReport"><svg-icon name="printer" /> Imprimer</button>
        </div>
      </div>

      <!-- Production table -->
      <div class="table-container">
        <div class="scroll-table">
          <table class="production-table">
            <thead>
              <tr v-if="groupBy === 'none'">
                <th :class="sortClass('production_date')" @click="toggleSort('production_date','date')">Date</th>
                <th :class="sortClass('location_code')" @click="toggleSort('location_code','text')">Atelier</th>
                <th :class="sortClass('finished_product_name')" @click="toggleSort('finished_product_name','text')">Produit</th>
                <th class="num-cell" :class="sortClass('quantity_produced')" @click="toggleSort('quantity_produced','number')">Quantité</th>
                <th>Matières utilisées</th>
                <th>Actions</th>
              </tr>
              <tr v-else>
                <th :class="groupSortClass('sort_key')" @click="toggleGroupSort('sort_key','text')">Groupe</th>
                <th class="num-cell" :class="groupSortClass('runs')" @click="toggleGroupSort('runs','number')">Lots</th>
                <th class="num-cell" :class="groupSortClass('total_produced')" @click="toggleGroupSort('total_produced','number')">Total produit</th>
                <th>Matières consommées</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filtered.length">
                <td :colspan="groupBy === 'none' ? 6 : 4" class="empty">
                  <span class="empty-icon"><svg-icon name="inbox" /></span>
                  <span>Aucun lot de production trouvé</span>
                  <span class="empty-hint">Ajustez vos filtres ou créez une nouvelle production</span>
                </td>
              </tr>
              <tr v-for="r in (groupBy === 'none' ? filtered : groupedRows)" :key="r.id || r.group_label">
                <template v-if="groupBy === 'none'">
                  <td>
                    <div class="date-cell">
                      <span class="d">{{ formatDate(r.production_date) }}</span>
                      <span v-if="relativeLabel(r.production_date)" class="rel" :class="relativeLabel(r.production_date).cls">{{ relativeLabel(r.production_date).text }}</span>
                    </div>
                  </td>
                  <td>
                    <span class="location-badge" :class="r.location_code === 'UNITE_A' ? 'unit-a' : 'unit-b'">
                      {{ r.location_code || '—' }}
                    </span>
                  </td>
                  <td class="product-name">{{ r.finished_product_name }}</td>
                  <td class="num-cell pos">+{{ fmt(r.quantity_produced) }} <span class="unit-label">{{ r.unit }}</span></td>
                  <td class="materials-cell">
                    <div class="materials-list">
                      <span v-for="(item, idx) in (r.items_used || [])" :key="idx" class="material-tag">
                        {{ item.raw_material_name }}
                        <span class="material-qty">{{ fmt(item.quantity_used) }} {{ item.unit }}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <button class="btn-secondary btn-small" @click="editProduction(r)">Modifier</button>
                    <button class="btn-danger btn-small" @click="deleteProduction(r.id)">Supprimer</button>
                  </td>
                </template>
                <template v-else>
                  <td class="text">{{ r.group_label }}</td>
                  <td class="num-cell">{{ r.runs }}</td>
                  <td class="num-cell pos">+{{ fmt(r.total_produced) }} {{ r.unit || '' }}</td>
                  <td class="materials-cell">
                    <div class="materials-list">
                      <span v-for="(item, idx) in (r.materials || [])" :key="idx" class="material-tag">
                        {{ item.name }}
                        <span class="material-qty">{{ fmt(item.qty) }} {{ item.unit }}</span>
                      </span>
                      <span v-if="!(r.materials || []).length" class="empty-hint">—</span>
                    </div>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <!-- Production Modal -->
      <ProductionModal
        :show="showModal"
        :materials="materials"
        :products="products"
        :recipes="recipes"
        :production="editing"
        :edit-mode="!!editing"
        @close="closeModal"
        @saved="onProductionSaved"
      />
    </div>
  `
};