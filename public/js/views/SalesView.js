import { api } from '../api.js';
import { fmt, sortRows, matchesText, inRange, exportCSV, todayStr, formatDate, relativeLabel } from '../helpers.js';
import { toast } from '../toast.js';

export default {
  name: 'SalesView',
  data() {
    return {
      products: [],
      items: [],
      search: '',
      from: '',
      to: '',
      sort: { key: 'sale_date', type: 'date', dir: -1 },
      form: { sale_date: todayStr(), finished_product_id: '', quantity: '', customer: '', note: '' },
      msg: { text: '', ok: true, show: false }
    };
  },
  computed: {
    filtered() {
      const rows = this.items.filter(s =>
        matchesText(s, ['finished_product_name', 'customer', 'note'], this.search.trim()) &&
        inRange(s.sale_date, this.from, this.to));
      return sortRows(rows, this.sort.key, this.sort.dir, this.sort.type);
    }
  },
  async mounted() {
    this.products = await api('/finished-products');
    if (this.products.length) this.form.finished_product_id = this.products[0].id;
    await this.load();
  },
  methods: {
    fmt, formatDate, relativeLabel,
    async load() {
      this.items = await api('/sales');
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
        await api('/sales', { method: 'POST', body: JSON.stringify(this.form) });
        this.showMsg('Vente enregistrée et stock mis à jour.');
        toast('Vente enregistrée');
        await this.load();
      } catch (err) {
        this.showMsg(err.message, false);
      }
    },
    doExport() {
      exportCSV('sales.csv', ['Date', 'Produit', 'Quantite', 'Unite', 'Client', 'Note'],
        this.filtered.map(s => [s.sale_date?.slice(0, 10), s.finished_product_name, s.quantity, s.unit, s.customer || '', s.note || '']));
    }
  },
  template: `
    <div>
      <div class="panel">
        <h2>Enregistrer une vente</h2>
        <form @submit.prevent="submit">
          <label>Date<input v-model="form.sale_date" type="date" required></label>
          <label>Produit fini
            <select v-model="form.finished_product_id" required>
              <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label>Quantité<input v-model.number="form.quantity" type="number" step="0.01" required></label>
          <label>Client<input v-model="form.customer"></label>
          <label>Note<input v-model="form.note"></label>
          <button class="primary" type="submit">Enregistrer</button>
        </form>
        <div class="msg" :class="{ show: msg.show, ok: msg.ok, err: !msg.ok }">{{ msg.text }}</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">Ventes</h2>
          <span class="count">{{ filtered.length }} sur {{ items.length }}</span>
        </div>
        <div class="toolbar">
          <div class="search-wrap"><span class="ic"><svg-icon name="search" /></span><input type="search" v-model="search" placeholder="Rechercher par produit, client, note…"></div>
          <div class="date-range">du <input type="date" v-model="from"> au <input type="date" v-model="to"></div>
          <span class="spacer"></span>
          <button class="ghost small-btn" type="button" @click="doExport">Exporter CSV</button>
        </div>
        <div class="scroll-table"><table>
          <thead><tr>
            <th :class="sortClass('sale_date')" @click="toggleSort('sale_date','date')">Date</th>
            <th :class="sortClass('finished_product_name')" @click="toggleSort('finished_product_name','text')">Produit</th>
            <th class="num-cell" :class="sortClass('quantity')" @click="toggleSort('quantity','number')">Qté</th>
            <th :class="sortClass('customer')" @click="toggleSort('customer','text')">Client</th>
          </tr></thead>
          <tbody>
            <tr v-if="!filtered.length"><td colspan="4" class="empty"><span class="big">—</span>Aucune vente ne correspond — enregistrez-en une ci-dessus ou effacez les filtres</td></tr>
            <tr v-for="s in filtered" :key="s.id">
              <td>
                <div class="date-cell">
                  <span class="d">{{ formatDate(s.sale_date) }}</span>
                  <span v-if="relativeLabel(s.sale_date)" class="rel" :class="relativeLabel(s.sale_date).cls">{{ relativeLabel(s.sale_date).text }}</span>
                </div>
              </td>
              <td class="text">{{ s.finished_product_name }}</td>
              <td class="num-cell neg">-{{ fmt(s.quantity) }} {{ s.unit }}</td>
              <td class="text">{{ s.customer || '—' }}</td>
            </tr>
          </tbody>
        </table></div>
      </div>
    </div>
  `
};
