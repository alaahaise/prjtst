import { api } from '../api.js';
import { fmt, sortRows, matchesText, inRange, exportCSV, formatDate, relativeLabel, printReport } from '../helpers.js';

export default {
  name: 'LedgerView',
  data() {
    return {
      items: [],
      loading: false,
      // Pagination
      page: 1,
      limit: 10000000000000000,
      total: 0,
      totalPages: 0,
      // Filters
      search: '',
      from: '',
      to: '',
      materialFilter: '',
      typeFilter: '',
      movementFilter: '',
      executedByFilter: '',
      // Grouping
      grpMaterial: false,
      grpType: false,
      grpExecutedBy: false,
      grpDate: 'none',
      // Sorting
      sort: { key: 'movement_date', type: 'date', dir: -1 },
      groupSort: { key: 'total_qty', type: 'number', dir: -1 }
    };
  },
  computed: {
    materialNames() {
      return [...new Set(this.items.map(m => m.material_name).filter(Boolean))].sort();
    },
    executedByCodes() {
      return [...new Set(this.items.map(m => m.executed_by_code).filter(Boolean))].sort();
    },
    grouping() {
      return this.grpMaterial || this.grpType || this.grpExecutedBy || this.grpDate !== 'none';
    },
    filtered() {
      const rows = this.items.filter(m =>
        matchesText(m, ['remark', 'material_name'], this.search.trim()) &&
        (!this.materialFilter || m.material_name === this.materialFilter) &&
        (!this.typeFilter || m.material_type === this.typeFilter) &&
        (!this.movementFilter || m.movement_type === this.movementFilter) &&
        (!this.executedByFilter || m.executed_by_code === this.executedByFilter) &&
        inRange(m.movement_date, this.from, this.to)
      );
      return sortRows(rows, this.sort.key, this.sort.dir, this.sort.type);
    },
    groupedRows() {
      const map = new Map();
      this.filtered.forEach(r => {
        const { key, label } = this.groupKey(r);
        if (!map.has(key)) {
          map.set(key, {
            group_label: label,
            movements: 0,
            in_qty: 0,
            out_qty: 0,
            total_qty: 0,
            unit: r.unit
          });
        }
        const g = map.get(key);
        g.movements++;
        g.total_qty += Number(r.quantity);
        if (r.quantity >= 0) g.in_qty += Number(r.quantity);
        else g.out_qty += Number(r.quantity);
      });
      return sortRows([...map.values()], this.groupSort.key, this.groupSort.dir, this.groupSort.type);
    },
    totalIn() {
      return this.filtered.reduce((s, m) => s + (Number(m.quantity) > 0 ? Number(m.quantity) : 0), 0);
    },
    totalOut() {
      return this.filtered.reduce((s, m) => s + (Number(m.quantity) < 0 ? Number(m.quantity) : 0), 0);
    },
    totalNet() {
      return this.totalIn + this.totalOut;
    }
  },
  async mounted() {
    await this.load();
  },
  methods: {
    fmt,
    formatDate,
    relativeLabel,
async load() {
  this.loading = true;
  try {
    const params = new URLSearchParams();
    if (this.from) params.append('from', this.from);
    if (this.to) params.append('to', this.to);
    if (this.typeFilter) params.append('material_type', this.typeFilter);
    if (this.movementFilter) params.append('movement_type', this.movementFilter);
    if (this.limit) params.append('limit', this.limit);
    if (this.page) params.append('page', this.page);
    const url = `/movements?${params.toString()}`;
    const response = await api(url);
    
    // Handle both paginated { data, total } and plain array
    if (Array.isArray(response)) {
      this.items = response;
      this.total = response.length;
      this.totalPages = 1;
    } else {
      this.items = response.data || [];
      this.total = response.total || 0;
      this.totalPages = response.totalPages || 0;
    }
    console.log(`Loaded ${this.items.length} movements (page ${this.page}/${this.totalPages})`);
  } catch (err) {
    console.error('Load error:', err);
    this.items = [];
    this.total = 0;
    this.totalPages = 0;
  } finally {
    this.loading = false;
  }
},
    prevPage() {
      if (this.page > 1) {
        this.page--;
        this.load();
      }
    },
    nextPage() {
      if (this.page < this.totalPages) {
        this.page++;
        this.load();
      }
    },
    clearFilters() {
      this.search = '';
      this.from = '';
      this.to = '';
      this.materialFilter = '';
      this.typeFilter = '';
      this.movementFilter = '';
      this.executedByFilter = '';
      this.grpMaterial = false;
      this.grpType = false;
      this.grpExecutedBy = false;
      this.grpDate = 'none';
      this.page = 1;
      this.load();
    },
    groupKey(row) {
      const parts = [], labels = [];
      if (this.grpDate !== 'none') {
        const d = new Date(row.movement_date);
        if (this.grpDate === 'day') {
          parts.push(row.movement_date?.slice(0, 10));
          labels.push(formatDate(row.movement_date));
        } else if (this.grpDate === 'month') {
          parts.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
          labels.push(d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
        } else if (this.grpDate === 'year') {
          parts.push(String(d.getFullYear()));
          labels.push(String(d.getFullYear()));
        }
      }
      if (this.grpMaterial) { parts.push(row.material_name || '—'); labels.push(row.material_name || '—'); }
      if (this.grpType) { parts.push(row.material_type || '—'); labels.push(row.material_type || '—'); }
      if (this.grpExecutedBy) { parts.push(row.executed_by_code || '—'); labels.push(row.executed_by_code || '—'); }
      return { key: parts.join('|'), label: labels.join(' · ') };
    },
    toggleSort(key, type) {
      if (this.grouping) {
        if (this.groupSort.key === key) this.groupSort.dir *= -1;
        else this.groupSort = { key, type, dir: 1 };
      } else {
        if (this.sort.key === key) this.sort.dir *= -1;
        else this.sort = { key, type, dir: 1 };
      }
    },
    sortClass(key) {
      const s = this.grouping ? this.groupSort : this.sort;
      if (s.key !== key) return '';
      return s.dir === 1 ? 'sort-asc' : 'sort-desc';
    },
    doExport() {
      if (!this.grouping) {
        exportCSV('ledger.csv',
          ['Date', 'Matiere', 'Type', 'Conditionnement', 'Pool', 'Execute par', 'Mouvement', 'Quantite', 'Remarque'],
          this.filtered.map(m => [
            m.movement_date?.slice(0, 10),
            m.material_name || '',
            m.material_type,
            m.packaging_name || '',
            m.pool_location_code || '',
            m.executed_by_code || '',
            m.movement_type,
            m.quantity,
            m.remark || ''
          ])
        );
      } else {
        exportCSV('ledger_grouped.csv',
          ['Groupe', 'Mouvements', 'Entrees', 'Sorties', 'Net'],
          this.groupedRows.map(g => [g.group_label, g.movements, g.in_qty, g.out_qty, g.total_qty])
        );
      }
    },
    doPrint() {
      if (!this.grouping) {
        printReport('Journal des mouvements de stock',
          [
            { key: 'date_display', label: 'Date' },
            { key: 'material_name', label: 'Matière' },
            { key: 'material_type', label: 'Type' },
            { key: 'movement_type', label: 'Mouvement' },
            { key: 'quantity', label: 'Qté', num: true },
            { key: 'remark', label: 'Remarque' }
          ],
          this.filtered.map(m => ({ ...m, date_display: formatDate(m.movement_date) }))
        );
      } else {
        printReport('Journal des mouvements de stock — Groupé',
          [
            { key: 'group_label', label: 'Groupe' },
            { key: 'movements', label: 'Mouvements', num: true },
            { key: 'in_qty', label: 'Entrées', num: true },
            { key: 'out_qty', label: 'Sorties', num: true },
            { key: 'total_qty', label: 'Net', num: true }
          ],
          this.groupedRows
        );
      }
    }
  },
  template: `
    <div>
      <div class="panel">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">📒 Journal des mouvements de stock</h2>
          <span class="count">{{ items.length }} sur {{ total }}</span>
        </div>

        <!-- Toolbar with filters -->
        <div class="toolbar">
          <div class="search-wrap">
            <span class="ic">⌕</span>
            <input type="search" v-model="search" placeholder="Rechercher par matière ou remarque…">
          </div>

          <div class="date-range">
            <input type="date" v-model="from" placeholder="De">
            <span>→</span>
            <input type="date" v-model="to" placeholder="À">
          </div>

          <select v-model="typeFilter">
            <option value="">Tous types</option>
            <option value="RAW">Matière première</option>
            <option value="FINISHED">Produit fini</option>
          </select>

          <select v-model="movementFilter">
            <option value="">Tous mouvements</option>
            <option value="INITIAL">Initial</option>
            <option value="PURCHASE">Achat</option>
            <option value="PRODUCTION_IN">Entrée production</option>
            <option value="PRODUCTION_OUT">Sortie production</option>
            <option value="SALE">Vente</option>
            <option value="ADJUSTMENT">Ajustement</option>
          </select>

          <button class="btn-secondary btn-small" @click="load" :disabled="loading">
            ⟳ {{ loading ? 'Chargement…' : 'Actualiser' }}
          </button>
          <button class="btn-secondary btn-small" @click="clearFilters">Effacer filtres</button>
        </div>

        <!-- Advanced grouping & export -->
        <div class="toolbar">
          <div class="group-controls">
            <span class="grp-label">Grouper par :</span>
            <label class="chk"><input type="checkbox" v-model="grpMaterial"> Matière</label>
            <label class="chk"><input type="checkbox" v-model="grpType"> Type</label>
            <label class="chk"><input type="checkbox" v-model="grpExecutedBy"> Exécuté par</label>
            <select v-model="grpDate">
              <option value="none">Pas de regroupement</option>
              <option value="day">Jour</option>
              <option value="month">Mois</option>
              <option value="year">Année</option>
            </select>
          </div>
          <span class="spacer"></span>
          <button class="ghost small-btn" @click="doExport">📥 CSV</button>
          <button class="ghost small-btn" @click="doPrint">🖨️ Imprimer</button>
        </div>

        <!-- Table -->
        <div class="scroll-table">
          <table>
            <thead>
              <tr v-if="!grouping">
                <th :class="sortClass('movement_date')" @click="toggleSort('movement_date','date')">Date</th>
                <th :class="sortClass('material_name')" @click="toggleSort('material_name','text')">Matière</th>
                <th :class="sortClass('material_type')" @click="toggleSort('material_type','text')">Type</th>
                <th :class="sortClass('packaging_name')" @click="toggleSort('packaging_name','text')">Conditionnement</th>
                <th :class="sortClass('pool_location_code')" @click="toggleSort('pool_location_code','text')">Pool</th>
                <th :class="sortClass('executed_by_code')" @click="toggleSort('executed_by_code','text')">Exécuté par</th>
                <th :class="sortClass('movement_type')" @click="toggleSort('movement_type','text')">Mouvement</th>
                <th class="num-cell" :class="sortClass('quantity')" @click="toggleSort('quantity','number')">Qté</th>
                <th>Remarque</th>
              </tr>
              <tr v-else>
                <th :class="sortClass('group_label')" @click="toggleSort('group_label','text')">Groupe</th>
                <th class="num-cell" :class="sortClass('movements')" @click="toggleSort('movements','number')">Mouvements</th>
                <th class="num-cell" :class="sortClass('in_qty')" @click="toggleSort('in_qty','number')">Entrées</th>
                <th class="num-cell" :class="sortClass('out_qty')" @click="toggleSort('out_qty','number')">Sorties</th>
                <th class="num-cell" :class="sortClass('total_qty')" @click="toggleSort('total_qty','number')">Net</th>
                <th :class="sortClass('unit')" @click="toggleSort('unit','text')">Unité</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filtered.length">
                <td :colspan="grouping ? 6 : 9" class="empty">
                  <span class="big">—</span>Aucun mouvement – ajustez les filtres
                </td>
              </tr>
              <tr v-for="m in filtered" :key="m.id" v-if="!grouping">
                <td>
                  <div class="date-cell">
                    <span class="d">{{ formatDate(m.movement_date) }}</span>
                    <span v-if="relativeLabel(m.movement_date)" class="rel" :class="relativeLabel(m.movement_date).cls">{{ relativeLabel(m.movement_date).text }}</span>
                  </div>
                </td>
                <td class="text">{{ m.material_name || '—' }}</td>
                <td><span class="pill" :class="m.material_type">{{ m.material_type }}</span></td>
                <td>
                  <span v-if="m.material_type === 'RAW' && m.packaging_name" class="pill" :class="m.packaging_name">{{ m.packaging_name }}</span>
                  <span v-else>—</span>
                </td>
                <td class="text">{{ m.pool_location_code || '—' }}</td>
                <td class="text"><span v-if="m.executed_by_code" class="pill FINISHED">{{ m.executed_by_code }}</span><span v-else>—</span></td>
                <td class="text">{{ m.movement_type }}</td>
                <td class="num-cell" :class="m.quantity >= 0 ? 'pos' : 'neg'">{{ m.quantity >= 0 ? '+' : '' }}{{ fmt(m.quantity) }}</td>
                <td class="text">{{ m.remark || '—' }}</td>
              </tr>
              <tr v-for="g in groupedRows" :key="g.group_label" v-if="grouping">
                <td class="text">{{ g.group_label }}</td>
                <td class="num-cell">{{ g.movements }}</td>
                <td class="num-cell pos">+{{ fmt(g.in_qty) }}</td>
                <td class="num-cell neg">{{ fmt(g.out_qty) }}</td>
                <td class="num-cell" :class="g.total_qty >= 0 ? 'pos' : 'neg'">{{ g.total_qty >= 0 ? '+' : '' }}{{ fmt(g.total_qty) }}</td>
                <td class="text">{{ g.unit || '—' }}</td>
              </tr>
            </tbody>
            <tfoot v-if="!grouping && filtered.length">
              <tr style="font-weight:bold; border-top:2px solid var(--ink);">
                <td colspan="7" style="text-align:right;">TOTAL</td>
                <td class="num-cell">{{ fmt(totalNet) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- Pagination controls -->
        <div v-if="totalPages > 1" style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding:8px 0; border-top:1px solid var(--rule);">
          <div>
            <button class="btn-secondary btn-small" @click="prevPage" :disabled="page === 1 || loading">◀ Précédent</button>
            <span style="margin:0 12px; font-size:13px;">Page {{ page }} / {{ totalPages }}</span>
            <button class="btn-secondary btn-small" @click="nextPage" :disabled="page === totalPages || loading">Suivant ▶</button>
          </div>
          <div style="font-size:12px; opacity:0.6;">
            {{ total }} mouvements au total
          </div>
        </div>
      </div>
    </div>
  `
};