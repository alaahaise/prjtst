import { api } from '../api.js';
import { fmt } from '../helpers.js';
import { toast } from '../toast.js';

export default {
  name: 'RecipesView',
  data() {
    return {
      materials: [],
      products: [],
      recipes: [],
      search: '',
      form: { finished_product_id: '', version: '1.0' },
      itemRows: [], // [{ material_id, qty }]
      editingId: null,
      msg: { text: '', ok: true, show: false }
    };
  },
  computed: {
    filteredRecipes() {
      const q = this.search.trim().toLowerCase();
      if (!q) return this.recipes;
      return this.recipes.filter(r => r.finished_product_name.toLowerCase().includes(q));
    },
    formTitle() {
      if (!this.editingId) return 'Créer une Formule (pour 1000 Q de produit fini)';
      const r = this.recipes.find(r => r.id === this.editingId);
      return r ? `Modification de la Formule — ${r.finished_product_name}` : 'Modification de la Formule';
    }
  },
  async mounted() {
    this.materials = await api('/raw-materials');
    this.products = await api('/finished-products');
    if (this.products.length) this.form.finished_product_id = this.products[0].id;
    await this.load();
  },
  methods: {
    fmt,
    async load() {
      this.recipes = await api('/recipes');
    },
    addItemRow() {
      this.itemRows.push({ material_id: this.materials[0]?.id || '', qty: '' });
    },
    removeItemRow(idx) {
      this.itemRows.splice(idx, 1);
    },
    showMsg(text, ok = true) {
      this.msg = { text, ok, show: true };
      setTimeout(() => { this.msg.show = false; }, 4000);
    },
    enterEdit(recipe) {
      this.editingId = recipe.id;
      this.form.finished_product_id = recipe.finished_product_id;
      this.form.version = recipe.version;
      this.itemRows = recipe.items.map(i => ({ material_id: i.raw_material_id, qty: i.quantity_per_1000kg }));
      this.$nextTick(() => {
        document.getElementById('recipesAnchor')?.scrollIntoView({ behavior: 'smooth' });
      });
    },
    exitEdit() {
      this.editingId = null;
      this.form = { finished_product_id: this.products[0]?.id || '', version: '1.0' };
      this.itemRows = [];
    },
    async save() {
      const items = this.itemRows
        .filter(i => i.material_id && i.qty)
        .map(i => ({ raw_material_id: i.material_id, quantity_per_1000kg: i.qty }));
      try {
        if (!this.form.finished_product_id) throw new Error('Sélectionnez un produit fini');
        if (!items.length) throw new Error('Ajoutez au moins une matière première avec une quantité');
        const payload = { finished_product_id: this.form.finished_product_id, version: this.form.version, items };
        if (this.editingId) {
          await api(`/recipes/${this.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
          this.showMsg('Formule mise à jour.');
          toast('Formule mise à jour');
          this.exitEdit();
        } else {
          await api('/recipes', { method: 'POST', body: JSON.stringify(payload) });
          this.showMsg('Formule enregistrée.');
          toast('Formule enregistrée');
          this.itemRows = [];
        }
        await this.load();
      } catch (err) {
        this.showMsg(err.message, false);
      }
    },
    async toggleActive(r) {
      try {
        await api(`/recipes/${r.id}/${r.active ? 'deactivate' : 'activate'}`, { method: 'PUT' });
        toast(r.active ? 'Formule désactivée' : 'Formule activée');
        await this.load();
      } catch (err) {
        toast(err.message, false);
      }
    },
    async remove(r) {
      if (!confirm('Supprimer cette Formule ? Cette action est irréversible.')) return;
      try {
        await api(`/recipes/${r.id}`, { method: 'DELETE' });
        toast('Formule supprimée');
        if (this.editingId === r.id) this.exitEdit();
        await this.load();
      } catch (err) {
        toast(err.message, false);
      }
    },
    materialName(id) {
      return this.materials.find(m => String(m.id) === String(id))?.name || '';
    }
  },
  template: `
    <div>
      <div class="panel" id="recipesAnchor">
        <h2>{{ formTitle }}</h2>
        <form @submit.prevent>
          <label>Produit fini
            <select v-model="form.finished_product_id" required>
              <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label>Version<input v-model="form.version"></label>
        </form>
        <div class="item-list">
          <div class="item-row" v-for="(row, idx) in itemRows" :key="idx">
            <select v-model="row.material_id">
              <option v-for="m in materials" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
            <input type="number" step="0.001" placeholder="Qté pour 1000Q" v-model="row.qty">
            <button class="ghost small-btn" type="button" @click="removeItemRow(idx)">Retirer</button>
          </div>
        </div>
        <button class="ghost small-btn" type="button" @click="addItemRow">+ Ajouter une matière première</button>
        <br><br>
        <button class="primary" type="button" @click="save">{{ editingId ? 'Mettre à jour la Formule' : 'Enregistrer la Formule' }}</button>
        <button v-if="editingId" class="ghost small-btn" type="button" @click="exitEdit">Annuler la modification</button>
        <div class="msg" :class="{ show: msg.show, ok: msg.ok, err: !msg.ok }">{{ msg.text }}</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">Formules existantes</h2>
          <span class="count">{{ filteredRecipes.length }} sur {{ recipes.length }}</span>
        </div>
        <div class="toolbar">
          <div class="search-wrap"><span class="ic"><svg-icon name="search" /></span><input type="search" v-model="search" placeholder="Rechercher par produit fini…"></div>
        </div>
        <div v-if="!filteredRecipes.length" class="empty"><span class="big">—</span>Aucune Formule ne correspond</div>
        <div v-for="r in filteredRecipes" :key="r.id" style="margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--rule);">
          <strong>{{ r.finished_product_name }}</strong>
          <span class="pill FINISHED">v{{ r.version }}</span>
          <span v-if="!r.active" class="pill muted">inactive</span>
          <table style="margin-top:8px;">
            <thead><tr><th>Matière</th><th class="num-cell">Pour 1000 Q</th></tr></thead>
            <tbody>
              <tr v-for="i in r.items" :key="i.raw_material_id">
                <td class="text">{{ i.raw_material_name }}</td>
                <td class="num-cell">{{ fmt(i.quantity_per_1000kg) }} {{ i.unit }}</td>
              </tr>
            </tbody>
          </table>
          <div style="margin-top:8px; display:flex; gap:6px;">
            <button class="ghost small-btn" type="button" @click="enterEdit(r)">Modifier</button>
            <button class="ghost small-btn" type="button" @click="toggleActive(r)">{{ r.active ? 'Désactiver' : 'Activer' }}</button>
            <button class="ghost small-btn danger" type="button" @click="remove(r)">Supprimer</button>
          </div>
        </div>
      </div>
    </div>
  `
};
