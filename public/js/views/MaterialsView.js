import { api } from '../api.js';
import { fmt, sortRows, matchesText, exportCSV } from '../helpers.js';
import { toast } from '../toast.js';

export default {
  name: 'MaterialsView',
  data() {
    return {
      items: [],
      search: '',
      statusFilter: '',
      sort: { key: 'name', type: 'text', dir: 1 },
      form: { name: '', unit: 'Q', stock_mode: 'MULTI', minimum_stock: 0 },
      msg: { text: '', ok: true, show: false }
    };
  },
  computed: {
    filtered() {
      let rows = this.items.filter(m => matchesText(m, ['name', 'storage_location'], this.search.trim()));
      if (this.statusFilter === 'low') rows = rows.filter(m => Number(m.total_stock) <= Number(m.minimum_stock));
      if (this.statusFilter === 'ok') rows = rows.filter(m => Number(m.total_stock) > Number(m.minimum_stock));
      return sortRows(rows, this.sort.key, this.sort.dir, this.sort.type);
    }
  },
  async mounted() {
    await this.load();
  },
  methods: {
    fmt,
    async load() {
      this.items = await api('/raw-materials');
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
    async submit() {
      try {
        await api('/raw-materials', { method: 'POST', body: JSON.stringify(this.form) });
        this.showMsg('Matière première enregistrée.');
        toast('Matière première enregistrée');
        this.form = { name: '', unit: 'Q', stock_mode: 'MULTI', minimum_stock: 0 };
        await this.load();
      } catch (err) {
        this.showMsg(err.message, false);
      }
    },
    doExport() {
      exportCSV('raw_materials.csv',
        ['Nom', 'Mode', 'Central', 'Unite A', 'Unite B', 'Stock total', 'Stock minimum', 'Unite'],
        this.filtered.map(m => [m.name, m.stock_mode, m.central_stock || 0, m.unite_a_stock || 0, m.unite_b_stock || 0, m.total_stock, m.minimum_stock, m.unit])
      );
    }
  },
  template: `
    <div>
      <div class="panel">
        <h2>Ajouter une matière première</h2>
        <form @submit.prevent="submit">
          <label>Nom<input v-model="form.name" required></label>
          <label>Unité<input v-model="form.unit"></label>
          <label>Mode de stock
            <select v-model="form.stock_mode">
              <option value="MULTI">Multi-emplacement (Central/A/B)</option>
              <option value="GLOBAL">Global (pool unique partagé)</option>
            </select>
          </label>
          <label>Stock minimum<input v-model.number="form.minimum_stock" type="number" step="0.01"></label>
          <button class="primary" type="submit">Enregistrer</button>
        </form>
        <div class="msg" :class="{ show: msg.show, ok: msg.ok, err: !msg.ok }">{{ msg.text }}</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">Toutes les matières premières</h2>
          <span class="count">{{ filtered.length }} sur {{ items.length }}</span>
        </div>
        <div class="toolbar">
          <div class="search-wrap"><span class="ic">⌕</span><input type="search" v-model="search" placeholder="Rechercher par nom ou emplacement…"></div>
          <select v-model="statusFilter">
            <option value="">Tous les niveaux de stock</option>
            <option value="low">Stock bas uniquement</option>
            <option value="ok">OK uniquement</option>
          </select>
          <span class="spacer"></span>
          <button class="ghost small-btn" type="button" @click="doExport">Exporter CSV</button>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th data-key="name" :class="sortClass('name')" @click="toggleSort('name','text')">Nom</th>
              <th data-key="stock_mode" :class="sortClass('stock_mode')" @click="toggleSort('stock_mode','text')">Mode</th>
              <th class="num-cell" :class="sortClass('central_stock')" @click="toggleSort('central_stock','number')">Central</th>
              <th class="num-cell" :class="sortClass('unite_a_stock')" @click="toggleSort('unite_a_stock','number')">Unité A</th>
              <th class="num-cell" :class="sortClass('unite_b_stock')" @click="toggleSort('unite_b_stock','number')">Unité B</th>
              <th class="num-cell" :class="sortClass('total_stock')" @click="toggleSort('total_stock','number')">Total</th>
              <th class="num-cell" :class="sortClass('minimum_stock')" @click="toggleSort('minimum_stock','number')">Minimum</th>
              <th :class="sortClass('unit')" @click="toggleSort('unit','text')">Unité</th>
            </tr></thead>
            <tbody>
              <tr v-if="!filtered.length"><td colspan="8" class="empty"><span class="big">—</span>Aucune matière première ne correspond — ajoutez-en une ci-dessus ou effacez les filtres</td></tr>
              <tr v-for="m in filtered" :key="m.id">
                <td class="text">{{ m.name }}</td>
                <td><span class="pill" :class="m.stock_mode === 'GLOBAL' ? 'muted' : 'FINISHED'">{{ m.stock_mode }}</span></td>
                <td class="num-cell">{{ m.stock_mode === 'GLOBAL' ? '—' : fmt(m.central_stock || 0) }}</td>
                <td class="num-cell">{{ m.stock_mode === 'GLOBAL' ? '—' : fmt(m.unite_a_stock || 0) }}</td>
                <td class="num-cell">{{ m.stock_mode === 'GLOBAL' ? '—' : fmt(m.unite_b_stock || 0) }}</td>
                <td class="num-cell" :class="{ low: Number(m.total_stock) <= Number(m.minimum_stock) }">{{ fmt(m.total_stock) }} {{ m.unit }}</td>
                <td class="num-cell">{{ fmt(m.minimum_stock) }}</td>
                <td class="text">{{ m.unit }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
};
