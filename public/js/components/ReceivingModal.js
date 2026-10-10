import { api } from '../api.js';
import { toast } from '../toast.js';
import { todayStr } from '../helpers.js';

const SAC_TO_Q = 0.5; // 1 sac = 0.5 quintal

export default {
  name: 'ReceivingModal',
  props: {
    show: Boolean,
    products: Array
  },
  emits: ['close', 'saved'],
  data() {
    return {
      loading: false,
      entries: [],
      commonDate: todayStr()
    };
  },
  computed: {
    canSave() {
      return this.entries.length > 0 &&
             this.entries.every(e =>
               e.product_id &&
               e.quantity &&
               Number(e.quantity) > 0 &&
               e.unit
             );
    }
  },
  watch: {
    show(val) {
      if (val) {
        this.initEntries();
      }
    }
  },
  methods: {
    fmt(value) {
      return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    },
    filteredProducts(search) {
      if (!search) return this.products || [];
      const q = search.toLowerCase();
      return (this.products || []).filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.code && p.code.toLowerCase().includes(q))
      );
    },
    createEmptyEntry() {
      return {
        product_id: '',
        productSearch: '',
        showList: false,
        unit: 'UNITE_A',
        quantitySac: '',
        quantity: '' // this is what's saved, in Q (quintal)
      };
    },
    initEntries() {
      this.entries = [this.createEmptyEntry()];
      this.commonDate = todayStr();
    },
    addEntry() {
      this.entries.push(this.createEmptyEntry());
    },
    removeEntry(index) {
      if (this.entries.length > 1) {
        this.entries.splice(index, 1);
      } else {
        toast('Vous devez avoir au moins une réception', false);
      }
    },
    selectProduct(index, productId, productName) {
      this.entries[index].product_id = productId;
      this.entries[index].productSearch = productName;
      this.entries[index].showList = false;
    },
    // ---- Sac ⇄ Quintal calculator ----
    onSacInput(index, rawVal) {
      const entry = this.entries[index];
      entry.quantitySac = rawVal;
      const sac = parseFloat(rawVal);
      entry.quantity = isNaN(sac) ? '' : this.round2(sac * SAC_TO_Q);
    },
    onQuantityInput(index, rawVal) {
      const entry = this.entries[index];
      entry.quantity = rawVal;
      const q = parseFloat(rawVal);
      entry.quantitySac = isNaN(q) ? '' : this.round2(q / SAC_TO_Q);
    },
    round2(n) {
      return Math.round(n * 100) / 100;
    },
    async saveAll() {
      if (!this.canSave) {
        toast('Veuillez remplir tous les champs obligatoires', false);
        return;
      }

      this.loading = true;
      let successCount = 0;
      try {
        for (const entry of this.entries) {
          const payload = {
            product_id: Number(entry.product_id),
            quantity: Number(entry.quantity), // always saved in Q
            receipt_date: this.commonDate,
            note: entry.unit
          };
          await api('/production-receipts', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          successCount++;
        }
        toast(`${successCount} réception(s) enregistrée(s) !`);
        this.$emit('saved');
        this.resetForm();
        this.$emit('close');
      } catch (err) {
        toast(`Erreur après ${successCount} enregistrements: ${err.message}`, false);
      } finally {
        this.loading = false;
      }
    },
    resetForm() {
      this.entries = [];
      this.commonDate = todayStr();
    },
    close() {
      this.resetForm();
      this.$emit('close');
    }
  },
  template: `
    <div v-if="show" class="modal-overlay" @click.self="close">
      <div class="modal-content" style="max-width: 720px;">
        <div class="modal-header">
          <h2><svg-icon name="package" /> Réceptionner en stock</h2>
          <button class="modal-close" @click="close">×</button>
        </div>

        <div class="modal-body">

          <!-- Shared date, its own row -->
          <div class="form-group" style="max-width:220px; margin-bottom:18px;">
            <label>Date de réception</label>
            <input type="date" v-model="commonDate" required>
          </div>

          <div
            v-for="(entry, idx) in entries"
            :key="idx"
            style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:16px; margin-bottom:14px; background:var(--bg);"
          >
            <div class="entry-header" style="margin-bottom:12px;">
              <h3 style="margin:0; font-size:13.5px;">Réception #{{ idx + 1 }}</h3>
              <button class="btn-danger btn-small" @click="removeEntry(idx)" :disabled="entries.length === 1">×</button>
            </div>

            <!-- Row 1: product, full width -->
            <div class="form-group" style="margin-bottom:12px;">
              <label>Produit *</label>
              <div class="search-select">
                <input
                  type="text"
                  v-model="entry.productSearch"
                  placeholder="Rechercher un produit..."
                  @focus="entry.showList = true"
                  @blur="window.setTimeout(() => entry.showList = false, 200)"
                >
                <div v-if="entry.showList && filteredProducts(entry.productSearch).length" class="search-select-dropdown">
                  <div
                    v-for="p in filteredProducts(entry.productSearch)"
                    :key="p.id"
                    @mousedown="() => { selectProduct(idx, p.id, p.name); }"
                    class="search-select-item"
                  >
                    {{ p.name }}
                    
                  </div>
                </div>
              </div>
            </div>

            <!-- Row 2: storage zone -->
            <div class="form-group" style="max-width:220px; margin-bottom:14px;">
              <label>Zone de stockage *</label>
              <select v-model="entry.unit" required>
                <option value="UNITE_A">Unité A</option>
                <option value="UNITE_B">Unité B</option>
              </select>
            </div>

            <!-- Row 3: sac ⇄ quintal calculator, grouped -->
            <div style="border:1px solid var(--border-soft); border-radius:var(--radius-sm); padding:12px 14px; background:#fff;">
              <div style="font-size:11px; font-weight:700; color:var(--text-faint); text-transform:uppercase; letter-spacing:.4px; margin-bottom:10px;">
                Quantité — 1 sac = 0.5 Q
              </div>
              <div style="display:flex; align-items:flex-end; gap:10px; flex-wrap:wrap;">
                <label style="flex:1; min-width:110px;">
                  Sacs
                  <input
                    type="number"
                    step="1"
                    min="0"
                    :value="entry.quantitySac"
                    @input="onSacInput(idx, $event.target.value)"
                    placeholder="0"
                  >
                </label>
                <div style="padding-bottom:10px; font-size:16px; color:var(--text-faint);">=</div>
                <label style="flex:1; min-width:110px;">
                  Quintaux (Q) *
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    :value="entry.quantity"
                    @input="onQuantityInput(idx, $event.target.value)"
                    required
                  >
                </label>
              </div>
            </div>
          </div>

          <button class="btn-secondary" @click="addEntry" style="width:100%;">
            + Ajouter une autre réception
          </button>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" @click="close">Annuler</button>
          <button class="btn-primary" @click="saveAll" :disabled="!canSave || loading">
            {{ loading ? 'Enregistrement...' : 'Enregistrer ' + entries.length + ' réception(s)' }}
          </button>
        </div>
      </div>
    </div>
  `
};