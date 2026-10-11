import { api } from '../api.js';
import { fmt, sortRows, matchesText, inRange, exportCSV, formatDate, relativeLabel } from '../helpers.js';
import { toast } from '../toast.js';
import TransferModal from '../components/TransferModal.js';

export default {
  name: 'TransfersView',
  components: {
    TransferModal
  },
  data() {
    return {
      materials: [],
      items: [],
      search: '',
      from: '',
      to: '',
      fromFilter: '',
      toFilter: '',
      sort: { key: 'transfer_date', type: 'date', dir: -1 },
      showModal: false,
      editingTransfer: null,
      loading: false
    };
  },
  computed: {
    multiMaterials() {
      return this.materials.filter(m => m.stock_mode === 'MULTI');
    },
    fromCodes() {
      return [...new Set(this.items.map(t => t.from_code).filter(Boolean))].sort();
    },
    toCodes() {
      return [...new Set(this.items.map(t => t.to_code).filter(Boolean))].sort();
    },
    sortedRows() {
      const rows = this.items.filter(t =>
        matchesText(t, ['raw_material_name', 'note', 'from_code', 'from_name', 'to_code', 'to_name', 'packaging_name'], this.search.trim()) &&
        (!this.fromFilter || t.from_code === this.fromFilter) &&
        (!this.toFilter || t.to_code === this.toFilter) &&
        inRange(t.transfer_date, this.from, this.to));
      return sortRows(rows, this.sort.key, this.sort.dir, this.sort.type);
    }
  },
  async mounted() {
    await this.loadData();
    // opened from the dashboard quick action
    if (this.$route.query.new) { this.openModal(); this.$router.replace({ query: {} }); }
  },
  methods: {
    fmt, formatDate, relativeLabel,
    async loadData() {
      this.loading = true;
      try {
        const [materials, items] = await Promise.all([
          api('/raw-materials'),
          api('/transfers')
        ]);
        console.log('Transfers loaded:', items);
        this.materials = materials;
        this.items = [...items]; // Force reactivity
      } catch (err) {
        console.error('Load error:', err);
        toast('Erreur de chargement', false);
      } finally {
        this.loading = false;
      }
    },
    async refresh() {
      await this.loadData();
    },
    toggleSort(key, type) {
      if (this.sort.key === key) this.sort.dir *= -1;
      else this.sort = { key, type, dir: 1 };
    },
    sortClass(key) {
      if (this.sort.key !== key) return '';
      return this.sort.dir === 1 ? 'sort-asc' : 'sort-desc';
    },
    clearFilters() {
      this.search = ''; this.from = ''; this.to = ''; this.fromFilter = ''; this.toFilter = '';
    },
    doExport() {
      exportCSV('transferts.csv', ['Date', 'Matiere', 'Conditionnement', 'De', 'Vers', 'Quantite', 'Unite', 'Note'],
        this.sortedRows.map(t => [t.transfer_date, t.raw_material_name, t.packaging_name || '', t.from_code, t.to_code, t.quantity, t.unit, t.note || '']));
    },
    openModal() {
      this.editingTransfer = null;
      this.showModal = true;
    },
    editTransfer(transfer) {
      console.log('Editing transfer:', transfer);
      this.editingTransfer = transfer;
      this.showModal = true;
    },
    closeModal() {
      this.showModal = false;
      this.editingTransfer = null;
    },
    async deleteTransfer(id) {
      if (!confirm('Supprimer ce transfert ?')) return;
      try {
        console.log('Deleting transfer:', id);
        await api(`/transfers/${id}`, { method: 'DELETE' });
        toast('Transfert supprimé');
        await this.refresh();
      } catch (err) {
        console.error('Delete error:', err);
        toast(err.message || 'Erreur', false);
      }
    },
    onSaved() {
      console.log('Transfer saved, refreshing list...');
      this.refresh();
    }
  },
  template: `
    <div>
      <div class="view-header">
        <div class="view-header-left">
          <h1>Transferts</h1>
          <span class="view-count">{{ sortedRows.length === items.length ? items.length : sortedRows.length + ' / ' + items.length }}</span>
        </div>
        <div class="view-header-right">
          <button class="btn-primary" @click="openModal">+ Nouveau transfert</button>
          <button class="btn-secondary" @click="refresh" :disabled="loading"><svg-icon name="refresh" /> Actualiser</button>
        </div>
      </div>

      <div class="panel">
        <div class="toolbar">
          <div class="search-wrap">
            <span class="ic"><svg-icon name="search" /></span>
            <input type="search" v-model="search" placeholder="Rechercher par matière, note, lieu…">
          </div>
          <div class="date-range">
            <input type="date" v-model="from" title="Du">
            <span>→</span>
            <input type="date" v-model="to" title="Au">
          </div>
          <select v-model="fromFilter">
            <option value="">De : tous</option>
            <option v-for="c in fromCodes" :key="c" :value="c">{{ c }}</option>
          </select>
          <select v-model="toFilter">
            <option value="">Vers : tous</option>
            <option v-for="c in toCodes" :key="c" :value="c">{{ c }}</option>
          </select>
          <button class="btn-secondary btn-small" type="button" @click="clearFilters">Effacer filtres</button>
          <span class="spacer"></span>
          <button class="ghost small-btn" type="button" @click="doExport"><svg-icon name="download" /> CSV</button>
        </div>
        <div class="scroll-table">
          <table>
            <thead>
              <tr>
                <th :class="sortClass('transfer_date')" @click="toggleSort('transfer_date','date')">Date</th>
                <th :class="sortClass('raw_material_name')" @click="toggleSort('raw_material_name','text')">Matière</th>
                <th :class="sortClass('packaging_name')" @click="toggleSort('packaging_name','text')">Conditionnement</th>
                <th :class="sortClass('from_code')" @click="toggleSort('from_code','text')">De</th>
                <th :class="sortClass('to_code')" @click="toggleSort('to_code','text')">Vers</th>
                <th class="num-cell" :class="sortClass('quantity')" @click="toggleSort('quantity','number')">Qté</th>
                <th>Note</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!sortedRows.length">
                <td colspan="8" class="empty"><span class="big">—</span>{{ items.length ? 'Aucun transfert ne correspond aux filtres' : 'Aucun transfert' }}</td>
              </tr>
              <tr v-for="t in sortedRows" :key="t.id">
                <td>
                  <div class="date-cell">
                    <span class="d">{{ formatDate(t.transfer_date) }}</span>
                    <span v-if="relativeLabel(t.transfer_date)" class="rel" :class="relativeLabel(t.transfer_date).cls">{{ relativeLabel(t.transfer_date).text }}</span>
                  </div>
                </td>
                <td class="text">{{ t.raw_material_name }}</td>
                <td><span v-if="t.packaging_name" class="pill" :class="t.packaging_name">{{ t.packaging_name }}</span><span v-else>—</span></td>
                <td class="text">{{ t.from_code }}</td>
                <td class="text">{{ t.to_code }}</td>
                <td class="num-cell">{{ fmt(t.quantity) }} {{ t.unit }}</td>
                <td class="text">{{ t.note || '—' }}</td>
                <td>
                  <button class="btn-secondary btn-small" @click="editTransfer(t)" title="Modifier"><svg-icon name="pencil" /></button>
                  <button class="btn-danger btn-small" @click="deleteTransfer(t.id)" title="Supprimer"><svg-icon name="trash" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <TransferModal
        :show="showModal"
        :materials="materials"
        :transfer="editingTransfer"
        :edit-mode="!!editingTransfer"
        @close="closeModal"
        @saved="onSaved"
      />
    </div>
  `
};