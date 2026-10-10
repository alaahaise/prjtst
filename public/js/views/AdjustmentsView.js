import { api } from '../api.js';
import { fmt, sortRows, matchesText, inRange, exportCSV, todayStr, formatDate, relativeLabel } from '../helpers.js';
import { toast } from '../toast.js';

const REASONS = ['Inventaire', 'Correction de production', 'Endommagé', 'Perdu', 'Transfert', 'Correction ERP', 'Autre'];

export default {
  name: 'AdjustmentsView',
  data() {
    return {
      materials: [],
      products: [],
      items: [],
      reasons: REASONS,
      typeFilter: '',
      reasonFilter: '',
      search: '',
      from: '',
      to: '',
      sort: { key: 'adjustment_date', type: 'date', dir: -1 },
      form: { adjustment_date: todayStr(), material_type: 'RAW', material_id: '', packaging_id: '1', quantity: '', reason: REASONS[0], remark: '' },
      msg: { text: '', ok: true, show: false }
    };
  },
  computed: {
    materialOptions() {
      return this.form.material_type === 'RAW' ? this.materials : this.products;
    },
    filtered() {
      const rows = this.items.filter(a =>
        (!this.typeFilter || a.material_type === this.typeFilter) &&
        (!this.reasonFilter || a.reason === this.reasonFilter) &&
        matchesText(a, ['material_name', 'remark', 'reason'], this.search.trim()) &&
        inRange(a.adjustment_date, this.from, this.to));
      return sortRows(rows, this.sort.key, this.sort.dir, this.sort.type);
    }
  },
  watch: {
    'form.material_type'() {
      this.form.material_id = this.materialOptions[0]?.id || '';
    }
  },
  async mounted() {
    this.materials = await api('/raw-materials');
    this.products = await api('/finished-products');
    this.form.material_id = this.materialOptions[0]?.id || '';
    await this.load();
  },
  methods: {
    fmt, formatDate, relativeLabel,
    async load() {
      this.items = await api('/adjustments');
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
        await api('/adjustments', { method: 'POST', body: JSON.stringify(this.form) });
        this.showMsg('Ajustement enregistré.');
        toast('Ajustement enregistré');
        await this.load();
      } catch (err) {
        this.showMsg(err.message, false);
      }
    },
    doExport() {
      exportCSV('adjustments.csv', ['Date', 'Type', 'Matiere', 'Conditionnement', 'Quantite', 'Raison', 'Remarque'],
        this.filtered.map(a => [a.adjustment_date?.slice(0, 10), a.material_type, a.material_name || '', a.packaging_name || '', a.quantity, a.reason, a.remark]));
    }
  },
  template: `
    <div>
      <div class="panel">
        <h2>Enregistrer un ajustement de stock</h2>
        <form @submit.prevent="submit">
          <label>Date<input v-model="form.adjustment_date" type="date" required></label>
          <label>Type de matière
            <select v-model="form.material_type">
              <option value="RAW">Matière première</option>
              <option value="FINISHED">Produit fini</option>
            </select>
          </label>
          <label>Matière
            <select v-model="form.material_id" required>
              <option v-for="m in materialOptions" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </label>
          <label v-if="form.material_type === 'RAW'">Conditionnement
            <select v-model="form.packaging_id">
              <option value="1">SAC</option>
              <option value="2">VRAC</option>
            </select>
          </label>
          <label>Quantité (utiliser un nombre négatif pour diminuer)<input v-model.number="form.quantity" type="number" step="0.001" required></label>
          <label>Raison
            <select v-model="form.reason">
              <option v-for="r in reasons" :key="r">{{ r }}</option>
            </select>
          </label>
          <label>Remarque<input v-model="form.remark" required></label>
          <button class="primary" type="submit">Enregistrer</button>
        </form>
        <div class="msg" :class="{ show: msg.show, ok: msg.ok, err: !msg.ok }">{{ msg.text }}</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">Ajustements</h2>
          <span class="count">{{ filtered.length }} sur {{ items.length }}</span>
        </div>
        <div class="toolbar">
          <div class="search-wrap">
            <span class="ic"><svg-icon name="search" /></span>
            <input type="search" v-model="search" placeholder="Rechercher par matière, raison, remarque…">
          </div>
          <select v-model="typeFilter">
            <option value="">Tous les types</option>
            <option value="RAW">Matière première</option>
            <option value="FINISHED">Produit fini</option>
          </select>
          <select v-model="reasonFilter">
            <option value="">Toutes les raisons</option>
            <option v-for="r in reasons" :key="r">{{ r }}</option>
          </select>
          <div class="date-range">du <input type="date" v-model="from"> au <input type="date" v-model="to"></div>
          <span class="spacer"></span>
          <button class="ghost small-btn" type="button" @click="doExport">Exporter CSV</button>
        </div>
        <div class="scroll-table"><table>
          <thead><tr>
            <th :class="sortClass('adjustment_date')" @click="toggleSort('adjustment_date','date')">Date</th>
            <th :class="sortClass('material_type')" @click="toggleSort('material_type','text')">Type</th>
            <th :class="sortClass('material_name')" @click="toggleSort('material_name','text')">Matière</th>
            <th :class="sortClass('packaging_name')" @click="toggleSort('packaging_name','text')">Conditionnement</th>
            <th class="num-cell" :class="sortClass('quantity')" @click="toggleSort('quantity','number')">Qté</th>
            <th :class="sortClass('reason')" @click="toggleSort('reason','text')">Raison</th>
            <th>Remarque</th>
          </tr></thead>
          <tbody>
            <tr v-if="!filtered.length"><td colspan="7" class="empty"><span class="big">—</span>Aucun ajustement ne correspond — enregistrez-en un ci-dessus ou effacez les filtres</td></tr>
            <tr v-for="a in filtered" :key="a.id">
              <td>
                <div class="date-cell">
                  <span class="d">{{ formatDate(a.adjustment_date) }}</span>
                  <span v-if="relativeLabel(a.adjustment_date)" class="rel" :class="relativeLabel(a.adjustment_date).cls">{{ relativeLabel(a.adjustment_date).text }}</span>
                </div>
              </td>
              <td><span class="pill" :class="a.material_type">{{ a.material_type }}</span></td>
              <td class="text">{{ a.material_name || '—' }}</td>
              <td>
                <span v-if="a.material_type === 'RAW' && a.packaging_name" class="pill" :class="a.packaging_name">{{ a.packaging_name }}</span>
                <span v-else>—</span>
              </td>
              <td class="num-cell" :class="a.quantity >= 0 ? 'pos' : 'neg'">{{ a.quantity >= 0 ? '+' : '' }}{{ fmt(a.quantity) }}</td>
              <td class="text">{{ a.reason }}</td>
              <td class="text">{{ a.remark }}</td>
            </tr>
          </tbody>
        </table></div>
      </div>
    </div>
  `
};
