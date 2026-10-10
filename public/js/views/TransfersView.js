import { api } from '../api.js';
import { fmt, sortRows, todayStr, formatDate, relativeLabel } from '../helpers.js';
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
    sortedRows() {
      return sortRows(this.items, this.sort.key, this.sort.dir, this.sort.type);
    }
  },
  async mounted() {
    await this.loadData();
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
          <span class="view-count">{{ items.length }}</span>
        </div>
        <div class="view-header-right">
          <button class="btn-primary" @click="openModal">+ Nouveau transfert</button>
          <button class="btn-secondary" @click="refresh" :disabled="loading">⟳ Actualiser</button>
        </div>
      </div>

      <div class="panel">
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
                <td colspan="8" class="empty"><span class="big">—</span>Aucun transfert</td>
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
                  <button class="btn-secondary btn-small" @click="editTransfer(t)">✏️</button>
                  <button class="btn-danger btn-small" @click="deleteTransfer(t.id)">🗑️</button>
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