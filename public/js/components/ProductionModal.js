import { api } from '../api.js';
import { toast } from '../toast.js';
import { todayStr } from '../helpers.js';

export default {
  name: 'ProductionModal',
  props: {
    show: Boolean,
    materials: Array,
    products: Array,
    recipes: Array,
    production: Object,
    editMode: Boolean
  },
  emits: ['close', 'saved'],
  data() {
    return {
      loading: false,
      entries: [],
      editingId: null,
      commonDate: todayStr(),
    };
  },
  computed: {
    filteredMaterials() {
      return (search) => {
        if (!search || typeof search !== 'string') return this.materials || [];
        const q = search.toLowerCase();
        return (this.materials || []).filter(m =>
          m.name.toLowerCase().includes(q) ||
          (m.code && m.code.toLowerCase().includes(q))
        );
      };
    },
    filteredProducts() {
      return (search) => {
        if (!search || typeof search !== 'string') return this.products || [];
        const q = search.toLowerCase();
        return (this.products || []).filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.code && p.code.toLowerCase().includes(q))
        );
      };
    },
    filteredRecipes() {
      return (search) => {
        if (!search || typeof search !== 'string') return this.recipes || [];
        const q = search.toLowerCase();
        return (this.recipes || []).filter(r =>
          r.finished_product_name.toLowerCase().includes(q)
        );
      };
    },
    canSave() {
      if (this.editMode) {
        return this.entries.length === 1 &&
               this.entries.every(e => this.isEntryValid(e));
      }
      return this.entries.length > 0 &&
             this.entries.every(e => this.isEntryValid(e));
    }
  },
  watch: {
    show(val) {
      if (val) this.initEntries();
    },
    editMode(val) {
      if (val && this.production) this.loadEditData();
    },
    production: {
      handler(val) {
        if (this.editMode && val) this.loadEditData();
      },
      immediate: true,
      deep: true
    }
  },
  methods: {
    getPackagingId() { return 2; },

    isEntryValid(entry) {
      return entry.production_date &&
             entry.location_code &&
             entry.finished_product_id &&
             entry.quantity_produced &&
             entry.itemRows.length > 0 &&
             entry.itemRows.every(i => i.material_id && i.qty);
    },

    createEmptyEntry() {
      return {
        production_date: todayStr(),
        location_code: 'UNITE_A',
        finished_product_id: '',
        quantity_produced: '',
        recipe_id: '',
        note: '',
        itemRows: [],
        productSearch: '',
        recipeSearch: '',
        showProductsList: false,
        showRecipesList: false
      };
    },

    initEntries() {
      if (this.editMode && this.production) {
        this.loadEditData();
      } else {
        this.entries = [this.createEmptyEntry()];
        this.commonDate = todayStr();
        this.editingId = null;
      }
    },

    // ✅ DATE FIX – parse as Date and format in local time
    loadEditData() {
      if (!this.production) return;
      this.editingId = this.production.id;
      let rawDate = this.production.production_date;
      let dateStr = '';
      // If it's a string or Date, convert to Date object
      let dateObj = new Date(rawDate);
      if (!isNaN(dateObj)) {
        // Use local methods to get the date as the user sees it
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
      }
      // Fallback
      if (!dateStr || dateStr.length !== 10) dateStr = todayStr();
      this.commonDate = dateStr;

      const entry = {
        production_date: dateStr,
        location_code: this.production.location_code || 'UNITE_A',
        finished_product_id: this.production.finished_product_id || '',
        quantity_produced: this.production.quantity_produced || '',
        recipe_id: this.production.recipe_id || '',
        note: this.production.note || '',
        itemRows: (this.production.items_used || []).map(i => ({
          material_id: i.raw_material_id || '',
          qty: Number(i.quantity_used) || '',
          search: i.raw_material_name || '',
          showList: false
        })),
        productSearch: '',
        recipeSearch: '',
        showProductsList: false,
        showRecipesList: false
      };
      const product = this.products.find(p => p.id == entry.finished_product_id);
      entry.productSearch = product ? product.name : '';
      const recipe = this.recipes.find(r => r.id == entry.recipe_id);
      entry.recipeSearch = recipe ? recipe.finished_product_name : '';
      this.entries = [entry];
    },

    addEntry() {
      this.entries.push(this.createEmptyEntry());
    },

    removeEntry(index) {
      if (this.entries.length > 1) {
        this.entries.splice(index, 1);
      } else {
        toast('Vous devez avoir au moins une production', false);
      }
    },

    addMaterialRow(entry) {
      entry.itemRows.push({ material_id: '', qty: '', search: '', showList: false });
    },

    removeMaterialRow(entry, idx) {
      entry.itemRows.splice(idx, 1);
    },

    selectMaterial(entry, idx, materialId, materialName) {
      entry.itemRows[idx].material_id = materialId;
      entry.itemRows[idx].search = materialName;
      entry.itemRows[idx].showList = false;
    },

    updateQty(entry, idx, value) {
      entry.itemRows[idx].qty = value;
    },

    async fillFromRecipe(entry) {
      if (!entry.recipe_id || !entry.quantity_produced) {
        toast("Sélectionnez une Formule et la quantité produite d'abord", false);
        return;
      }
      try {
        this.loading = true;
        const scaled = await api(`/recipes/${entry.recipe_id}/scale/${entry.quantity_produced}`);
        entry.itemRows = scaled.map(s => {
          const material = this.materials.find(m => m.id === s.raw_material_id);
          return {
            material_id: s.raw_material_id,
            qty: Number(s.scaled_quantity).toFixed(2),
            search: material ? material.name : '',
            showList: false
          };
        });
        toast('Matières premières chargées depuis la formule');
      } catch (err) {
        toast('Erreur lors du chargement de la formule', false);
      } finally {
        this.loading = false;
      }
    },

    delayedHide(entry, field) {
      setTimeout(() => {
        entry[field] = false;
      }, 200);
    },

    async saveAll() {
      if (!this.canSave) {
        toast('Veuillez remplir tous les champs obligatoires pour chaque production', false);
        return;
      }
      this.loading = true;
      let successCount = 0;
      try {
        if (this.editMode && this.editingId) {
          const entry = this.entries[0];
          const payload = {
            production_date: entry.production_date,
            finished_product_id: entry.finished_product_id,
            quantity_produced: entry.quantity_produced,
            recipe_id: entry.recipe_id || null,
            note: entry.note || null,
            location_code: entry.location_code,
            items: entry.itemRows
              .filter(i => i.material_id && i.qty)
              .map(i => ({
                raw_material_id: Number(i.material_id),
                quantity_used: Number(i.qty),
                packaging_id: this.getPackagingId()
              }))
          };
          console.log('[Frontend] PUT payload:', JSON.stringify(payload, null, 2));
          await api(`/production/${this.editingId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          successCount = 1;
          toast('Production modifiée !');
        } else {
          for (const entry of this.entries) {
            const payload = {
              production_date: entry.production_date,
              finished_product_id: entry.finished_product_id,
              quantity_produced: entry.quantity_produced,
              recipe_id: entry.recipe_id || null,
              note: entry.note || null,
              location_code: entry.location_code,
              items: entry.itemRows
                .filter(i => i.material_id && i.qty)
                .map(i => ({
                  raw_material_id: Number(i.material_id),
                  quantity_used: Number(i.qty),
                  packaging_id: this.getPackagingId()
                }))
            };
            console.log('[Frontend] POST payload:', JSON.stringify(payload, null, 2));
            await api('/production', {
              method: 'POST',
              body: JSON.stringify(payload)
            });
            successCount++;
          }
          toast(`${successCount} production(s) enregistrée(s) !`);
        }
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
      this.editingId = null;
    },

    close() {
      this.resetForm();
      this.$emit('close');
    }
  },
  template: `
    <div v-if="show" class="modal-overlay" @click.self="close">
      <div class="modal-content" style="max-width: 900px;">
        <div class="modal-header">
          <h2>{{ editMode ? 'Modifier la production' : 'Nouvelles productions' }}</h2>
          <button class="modal-close" @click="close">×</button>
        </div>

        <div class="modal-body">
<div class="modal-body">
  <div v-for="(entry, idx) in entries" :key="idx" class="entry-block">
    <div class="entry-header">
      <span class="entry-badge">{{ idx + 1 }}</span>
      <h3>Production {{ idx + 1 }}{{ entries.length > 1 ? ' sur ' + entries.length : '' }}</h3>
      <button class="btn-danger btn-small" @click="removeEntry(idx)" :disabled="entries.length === 1 || editMode">×</button>
    </div>

            <div class="form-grid">
              <div class="form-group">
                <label>Date de production *</label>
                <input type="date" v-model="entry.production_date" required>
              </div>

              <div class="form-group">
                <label>Unité *</label>
                <select v-model="entry.location_code" required>
                  <option value="UNITE_A">Unité A</option>
                  <option value="UNITE_B">Unité B</option>
                </select>
              </div>

              <div class="form-group">
                <label>Produit fini *</label>
                <div class="search-select">
                  <input 
                    type="text" 
                    v-model="entry.productSearch" 
                    placeholder="Rechercher un produit..."
                    @focus="entry.showProductsList = true"
                    @blur="delayedHide(entry, 'showProductsList')"
                  >
                  <div v-if="entry.showProductsList && filteredProducts(entry.productSearch).length" class="search-select-dropdown">
                    <div 
                      v-for="p in filteredProducts(entry.productSearch)" 
                      :key="p.id"
                      @mousedown="() => { entry.finished_product_id = p.id; entry.productSearch = p.name; entry.showProductsList = false; }"
                      class="search-select-item"
                    >
                      {{ p.name }}
                      <span v-if="p.code" class="search-select-code">{{ p.code }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label>Quantité produite *</label>
                <input type="number" step="0.01" v-model="entry.quantity_produced" required>
              </div>

              <div class="form-group">
                <label>Formule utilisée</label>
                <div class="search-select">
                  <input 
                    type="text" 
                    v-model="entry.recipeSearch" 
                    placeholder="Rechercher une formule..."
                    @focus="entry.showRecipesList = true"
                    @blur="delayedHide(entry, 'showRecipesList')"
                  >
                  <div v-if="entry.showRecipesList && filteredRecipes(entry.recipeSearch).length" class="search-select-dropdown">
                    <div 
                      v-for="r in filteredRecipes(entry.recipeSearch)" 
                      :key="r.id"
                      @mousedown="() => { entry.recipe_id = r.id; entry.recipeSearch = r.finished_product_name; entry.showRecipesList = false; }"
                      class="search-select-item"
                    >
                      {{ r.finished_product_name }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="form-group full-width">
                <label>Note</label>
                <input type="text" v-model="entry.note" placeholder="Optionnel...">
              </div>
            </div>

            <div class="materials-section">
              <h4>Matières premières utilisées *</h4>
              <button class="btn-secondary btn-small" @click="fillFromRecipe(entry)" :disabled="loading">
                ⚡ Remplir depuis la formule
              </button>

              <div v-for="(row, ridx) in entry.itemRows" :key="ridx" class="material-row">
                <div class="search-select material-select">
                  <input 
                    type="text" 
                    placeholder="Rechercher une matière..."
                    v-model="row.search"
                    @focus="row.showList = true"
                    @blur="delayedHide(row, 'showList')"
                  >
                  <div v-if="row.showList && filteredMaterials(row.search).length" class="search-select-dropdown">
                    <div 
                      v-for="m in filteredMaterials(row.search)" 
                      :key="m.id"
                      @mousedown="() => { selectMaterial(entry, ridx, m.id, m.name); }"
                      class="search-select-item"
                    >
                      {{ m.name }}
                      <span v-if="m.code" class="search-select-code">{{ m.code }}</span>
                    </div>
                  </div>
                </div>
                <input 
                  type="number" 
                  step="0.01" 
                  placeholder="Qté utilisée" 
                  :value="row.qty"
                  @input="updateQty(entry, ridx, $event.target.value)"
                >
                <button class="btn-danger btn-small" @click="removeMaterialRow(entry, ridx)">×</button>
              </div>
              <button class="btn-secondary btn-small" @click="addMaterialRow(entry)">+ Ajouter une matière</button>
            </div>
          </div>

          <button v-if="!editMode" class="btn-secondary" @click="addEntry" style="width:100%;">
            + Ajouter une autre production
          </button>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" @click="close">Annuler</button>
          <button class="btn-primary" @click="saveAll" :disabled="!canSave || loading">
            {{ loading ? 'Enregistrement...' : (editMode ? 'Modifier' : 'Enregistrer ' + entries.length + ' production(s)') }}
          </button>
        </div>
      </div>
    </div>
  `
};