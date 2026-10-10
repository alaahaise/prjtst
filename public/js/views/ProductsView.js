import { api } from '../api.js';
import { fmt, sortRows, matchesText, exportCSV, todayStr, formatDate, inRange } from '../helpers.js';
import { toast } from '../toast.js';
import ReceivingModal from '../components/ReceivingModal.js';

export default {
  name: 'ProductsView',
  components: {
    ReceivingModal
  },
  data() {
    return {
      items: [],
      search: '',
      sort: { key: 'name', type: 'text', dir: 1 },
      // Product creation
      form: { name: '', unit: 'Q', initial_stock: 0 },
      showAddProductModal: false,
      addingProduct: false,
      // Tab switcher: 'products' | 'receipts'
      activeTab: 'products',
      // Receipt history filters
      receiptSearch: '',
      receiptFrom: '',
      receiptTo: '',
      filterReceiptProduct: [],
      filterReceiptUnit: [],

      // Product list filter (Tous les produits finis tab)
      filterProduct: [],
      // Modal for receiving
      showReceivingModal: false,
      // Edit modal
      showEditModal: false,
      editingReceipt: null,
      receipts: [],
      msg: { text: '', ok: true, show: false }
    };
  },
  computed: {
filtered() {
      const rows = this.items.filter(p =>
        matchesText(p, ['name'], this.search.trim()) &&
        (this.filterProduct.length === 0 || this.filterProduct.includes(String(p.id)))
      );
      return sortRows(rows, this.sort.key, this.sort.dir, this.sort.type);
    },
filteredReceipts() {
      let rows = this.receipts;

      if (this.receiptSearch.trim()) {
        const q = this.receiptSearch.toLowerCase();
        rows = rows.filter(r => r.product_name.toLowerCase().includes(q));
      }

      rows = rows.filter(r => inRange(r.receipt_date, this.receiptFrom, this.receiptTo));

      rows = rows.filter(r =>
        this.filterReceiptProduct.length === 0 || this.filterReceiptProduct.includes(String(r.product_id))
      );

      rows = rows.filter(r =>
        this.filterReceiptUnit.length === 0 || this.filterReceiptUnit.includes(r.note)
      );

      return rows;
    }
  },
  async mounted() {
    await this.load();
  },
  methods: {
    fmt,
    formatDate,
    async load() {
      try {
        const [products, receipts] = await Promise.all([
          api('/finished-products'),
          api('/production-receipts')
        ]);
        this.items = products;
        this.receipts = receipts;
      } catch (err) {
        toast('Erreur de chargement', false);
      }
    },
    toggleSort(key, type) {
      if (this.sort.key === key) this.sort.dir *= -1;
      else this.sort = { key, type, dir: 1 };
    },
    sortClass(key) {
      if (this.sort.key !== key) return '';
      return this.sort.dir === 1 ? 'sort-asc' : 'sort-desc';
    },
    showMsg(text, ok = true) {
      this.msg = { text, ok, show: true };
      setTimeout(() => { this.msg.show = false; }, 4000);
    },
    openAddProductModal() {
      this.form = { name: '', unit: 'Q', initial_stock: 0 };
      this.showAddProductModal = true;
    },
    closeAddProductModal() {
      this.showAddProductModal = false;
    },
    async submitProduct() {
      this.addingProduct = true;
      try {
        await api('/finished-products', { method: 'POST', body: JSON.stringify(this.form) });
        toast('Produit fini enregistré');
        this.closeAddProductModal();
        await this.load();
      } catch (err) {
        toast(err.message, false);
      } finally {
        this.addingProduct = false;
      }
    },
    openReceivingModal() {
      this.showReceivingModal = true;
    },
    closeReceivingModal() {
      this.showReceivingModal = false;
    },
    onReceiptSaved() {
      this.load();
    },
    // ---- Edit / Delete ----
    openEditReceipt(receipt) {
      const formattedReceipt = { ...receipt };
      if (formattedReceipt.receipt_date) {
        if (typeof formattedReceipt.receipt_date === 'string') {
          formattedReceipt.receipt_date = formattedReceipt.receipt_date.slice(0, 10);
        } else if (formattedReceipt.receipt_date instanceof Date) {
          const d = formattedReceipt.receipt_date;
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          formattedReceipt.receipt_date = `${year}-${month}-${day}`;
        }
      }
      this.editingReceipt = formattedReceipt;
      this.showEditModal = true;
    },
    closeEditModal() {
      this.showEditModal = false;
      this.editingReceipt = null;
    },
    async saveEditReceipt() {
      if (!this.editingReceipt.product_id || !this.editingReceipt.quantity) {
        toast('Remplissez tous les champs', false);
        return;
      }
      try {
        await api(`/production-receipts/${this.editingReceipt.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            product_id: this.editingReceipt.product_id,
            quantity: this.editingReceipt.quantity,
            receipt_date: this.editingReceipt.receipt_date,
            note: this.editingReceipt.note
          })
        });
        toast('Réception modifiée');
        this.closeEditModal();
        await this.load();
      } catch (err) {
        toast(err.message, false);
      }
    },
    async deleteReceipt(id) {
      if (!confirm('Supprimer cette réception ?')) return;
      try {
        await api(`/production-receipts/${id}`, { method: 'DELETE' });
        toast('Réception supprimée');
        await this.load();
      } catch (err) {
        toast(err.message, false);
      }
    },
    doExport() {
      exportCSV('finished_products.csv', ['Nom', 'Stock actuel', 'Unite'],
        this.filtered.map(p => [p.name, p.current_stock, p.unit]));
    }
  },
  template: `
    <div>
      <!-- Header -->
      <div class="view-header">
        <div class="view-header-left">
          <h1>Produits finis</h1>
          <span class="view-count">{{ items.length }}</span>
        </div>
        <div class="view-header-right">
          <button class="btn-primary" @click="openReceivingModal">+ Mettre à jour le stock</button>
          <button class="btn-secondary" @click="openAddProductModal">Ajouter un nouveau produit</button>
          <button class="btn-secondary" @click="load">⟳ Actualiser</button>
        </div>
      </div>

      <!-- TAB SWITCHER -->
      <div class="tab-switcher">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'products' }"
          @click="activeTab = 'products'"
        >
          Tous les produits finis
          <span class="tab-count">{{ items.length }}</span>
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'receipts' }"
          @click="activeTab = 'receipts'"
        >
          📋 Historique des réceptions
          <span class="tab-count">{{ receipts.length }}</span>
        </button>
      </div>

      <!-- PRODUCT LIST -->
      <div class="panel" v-if="activeTab === 'products'">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">Tous les produits finis</h2>
          <span class="count">{{ filtered.length }} sur {{ items.length }}</span>
        </div>
<div class="toolbar">
          <div class="search-wrap"><span class="ic">⌕</span><input type="search" v-model="search" placeholder="Rechercher par nom…"></div>
          <div class="filter-group">
            <select v-model="filterProduct" multiple size="1" class="filter-select-sm">
              <option v-for="p in items" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
            </select>
          </div>
          <span class="spacer"></span>
          <button class="ghost small-btn" type="button" @click="doExport">Exporter CSV</button>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th :class="sortClass('name')" @click="toggleSort('name','text')">Nom</th>
              <th class="num-cell" :class="sortClass('current_stock')" @click="toggleSort('current_stock','number')">Stock actuel</th>
              <th :class="sortClass('unit')" @click="toggleSort('unit','text')">Unité</th>
            </tr></thead>
            <tbody>
              <tr v-if="!filtered.length"><td colspan="3" class="empty"><span class="big">—</span>Aucun produit</td></tr>
              <tr v-for="p in filtered" :key="p.id">
                <td class="text">{{ p.name }}</td>
                <td class="num-cell">{{ fmt(p.current_stock) }}</td>
                <td class="text">{{ p.unit }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- RECEIPT HISTORY -->
      <div class="panel" v-if="activeTab === 'receipts'">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">📋 Historique des réceptions</h2>
          <span class="count">{{ filteredReceipts.length }} sur {{ receipts.length }}</span>
        </div>

<div class="toolbar">
          <div class="search-wrap">
            <span class="ic">⌕</span>
            <input type="search" v-model="receiptSearch" placeholder="Rechercher par produit…">
          </div>
          <div class="date-range">
            <input type="date" v-model="receiptFrom" placeholder="De">
            <span>→</span>
            <input type="date" v-model="receiptTo" placeholder="À">
          </div>
          <div class="filter-group">
            <select v-model="filterReceiptProduct" multiple size="1" class="filter-select-sm">
              <option v-for="p in items" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
            </select>
          </div>
          <div class="filter-group">
            <select v-model="filterReceiptUnit" multiple size="1" class="filter-select-sm">
              <option value="UNITE_A">Unité A</option>
              <option value="UNITE_B">Unité B</option>
            </select>
          </div>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th>Date</th>
              <th>Produit</th>
              <th class="num-cell">Qté</th>
              <th>Unité</th>
              <th>Actions</th>
            </tr></thead>
            <tbody>
              <tr v-if="!filteredReceipts.length"><td colspan="5" class="empty">Aucune réception</td></tr>
              <tr v-for="r in filteredReceipts" :key="r.id">
                <td>{{ formatDate(r.receipt_date) }}</td>
                <td>{{ r.product_name }}</td>
                <td class="num-cell pos">+{{ fmt(r.quantity) }} {{ r.unit }}</td>
                <td>{{ r.note || '—' }}</td>
                <td>
                  <button class="btn-secondary btn-small" @click="openEditReceipt(r)">✏️</button>
                  <button class="btn-danger btn-small" @click="deleteReceipt(r.id)">🗑️</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- RECEIVING MODAL -->
      <ReceivingModal
        :show="showReceivingModal"
        :products="items"
        @close="closeReceivingModal"
        @saved="onReceiptSaved"
      />

      <!-- ADD PRODUCT MODAL -->
      <div v-if="showAddProductModal" class="modal-overlay" @click.self="closeAddProductModal">
        <div class="modal-content" style="max-width: 440px;">
          <div class="modal-header">
            <h2>+ Ajouter un produit fini</h2>
            <button class="modal-close" @click="closeAddProductModal">×</button>
          </div>
          <div class="modal-body">
            <form @submit.prevent="submitProduct">
              <div class="form-group">
                <label>Nom</label>
                <input v-model="form.name" required autofocus>
              </div>
              <div class="form-group">
                <label>Stock initial (Q)</label>
                <input v-model.number="form.initial_stock" type="number" step="0.01">
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" @click="closeAddProductModal">Annuler</button>
            <button class="btn-primary" @click="submitProduct" :disabled="!form.name || addingProduct">
              {{ addingProduct ? 'Enregistrement...' : 'Enregistrer' }}
            </button>
          </div>
        </div>
      </div>

      <!-- EDIT RECEIPT MODAL -->
      <div v-if="showEditModal" class="modal-overlay" @click.self="closeEditModal">
        <div class="modal-content" style="max-width: 500px;">
          <div class="modal-header">
            <h2>Modifier la réception</h2>
            <button class="modal-close" @click="closeEditModal">×</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Produit</label>
              <select v-model="editingReceipt.product_id" class="form-control">
                <option v-for="p in items" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div class="form-group">
              <label>Quantité</label>
              <input type="number" step="0.01" v-model="editingReceipt.quantity" class="form-control">
            </div>
            <div class="form-group">
              <label>Date</label>
              <input type="date" v-model="editingReceipt.receipt_date" class="form-control">
            </div>
            <div class="form-group">
              <label>Unité (note)</label>
              <select v-model="editingReceipt.note" class="form-control">
                <option value="UNITE_A">Unité A</option>
                <option value="UNITE_B">Unité B</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" @click="closeEditModal">Annuler</button>
            <button class="btn-primary" @click="saveEditReceipt">Enregistrer</button>
          </div>
        </div>
      </div>
    </div>
  `
};