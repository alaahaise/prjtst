import { api } from '../api.js';
import { fmt, sortRows, matchesText, inRange, exportCSV, todayStr, formatDate, relativeLabel } from '../helpers.js';
import { toast } from '../toast.js';

export default {
  name: 'PurchasesView',
  data() {
    return {
      materials: [],
      items: [],
      search: '',
      from: '',
      to: '',
      sort: { key: 'purchase_date', type: 'date', dir: -1 },
      form: { purchase_date: todayStr(), raw_material_id: '', packaging_id: '1', quantity: '', quantity_brut: '', supplier: '', note: '' },
      msg: { text: '', ok: true, show: false }
    };
  },
  computed: {
    filtered() {
      const rows = this.items.filter(p =>
        matchesText(p, ['raw_material_name', 'supplier', 'note'], this.search.trim()) &&
        inRange(p.purchase_date, this.from, this.to));
      return sortRows(rows, this.sort.key, this.sort.dir, this.sort.type);
    },
    totals() {
      return this.filtered.reduce((acc, p) => {
        acc.quantity += Number(p.quantity) || 0;
        if (p.quantity_brut != null) {
          acc.quantity_brut += Number(p.quantity_brut) || 0;
          acc.hasBrut = true;
        }
        const e = this.ecart(p);
        if (e != null) acc.ecart += e;
        return acc;
      }, { quantity: 0, quantity_brut: 0, ecart: 0, hasBrut: false });
    }
  },
  async mounted() {
    this.materials = await api('/raw-materials');
    if (this.materials.length) this.form.raw_material_id = this.materials[0].id;
    await this.load();
  },
  methods: {
    fmt, formatDate, relativeLabel,
    async load() {
      this.items = await api('/purchases');
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
        await api('/purchases', { method: 'POST', body: JSON.stringify(this.form) });
        this.showMsg('Achat enregistré et stock mis à jour.');
        toast('Achat enregistré');
        await this.load();
      } catch (err) {
        this.showMsg(err.message, false);
      }
    },
    async remove(p) {
      if (!confirm('Supprimer cet achat et annuler la mise à jour du stock ?')) return;
      try {
        await api('/purchases/' + p.id, { method: 'DELETE' });
        toast('Achat supprimé');
        await this.load();
      } catch (err) {
        toast(err.message, false);
      }
    },
    ecart(p) {
      return p.quantity_brut != null ? (Number(p.quantity_brut) - Number(p.quantity)) : null;
    },
    doExport() {
      exportCSV('purchases.csv', ['Date', 'Matiere', 'Conditionnement', 'Quantite Nette', 'Quantite Brute', 'Ecart', 'Unite', 'Fournisseur', 'Note'],
        this.filtered.map(p => [
          p.purchase_date?.slice(0, 10),
          p.raw_material_name,
          p.packaging_name || 'SAC',
          p.quantity,
          p.quantity_brut ?? '',
          this.ecart(p) ?? '',
          p.unit,
          p.supplier || '',
          p.note || ''
        ]));
    }
  },
  template: `
    <div>
      <div class="panel">
        <h2>Enregistrer un achat</h2>
        <form @submit.prevent="submit">
          <label>Date<input v-model="form.purchase_date" type="date" required></label>
          <label>Matière première
            <select v-model="form.raw_material_id" required>
              <option v-for="m in materials" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </label>
          <label>Conditionnement
            <select v-model="form.packaging_id">
              <option value="1">SAC</option>
              <option value="2">VRAC</option>
            </select>
          </label>
          <label>Quantité Nette (poids réel — utilisée pour le stock)<input v-model.number="form.quantity" type="number" step="0.001" required></label>
          <label>Quantité Brute (déclarée / bon de livraison) — optionnel<input v-model.number="form.quantity_brut" type="number" step="0.001"></label>
          <label>Fournisseur<input v-model="form.supplier"></label>
          <label>Note<input v-model="form.note"></label>
          <button class="primary" type="submit">Enregistrer</button>
        </form>
        <div class="msg" :class="{ show: msg.show, ok: msg.ok, err: !msg.ok }">{{ msg.text }}</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">Achats</h2>
          <span class="count">{{ filtered.length }} sur {{ items.length }}</span>
        </div>
        <div class="toolbar">
          <div class="search-wrap"><span class="ic">⌕</span><input type="search" v-model="search" placeholder="Rechercher par matière, fournisseur, note…"></div>
          <div class="date-range">du <input type="date" v-model="from"> au <input type="date" v-model="to"></div>
          <span class="spacer"></span>
          <button class="ghost small-btn" type="button" @click="doExport">Exporter CSV</button>
        </div>
        <div class="scroll-table"><table>
          <thead><tr>
            <th :class="sortClass('purchase_date')" @click="toggleSort('purchase_date','date')">Date</th>
            <th :class="sortClass('raw_material_name')" @click="toggleSort('raw_material_name','text')">Matière</th>
            <th :class="sortClass('packaging_name')" @click="toggleSort('packaging_name','text')">Conditionnement</th>
            <th class="num-cell" :class="sortClass('quantity')" @click="toggleSort('quantity','number')">Qté Nette</th>
            <th class="num-cell" :class="sortClass('quantity_brut')" @click="toggleSort('quantity_brut','number')">Qté Brute</th>
            <th class="num-cell">Écart</th>
            <th :class="sortClass('supplier')" @click="toggleSort('supplier','text')">Fournisseur</th>
            <th></th>
          </tr></thead>
          <tbody>
            <tr v-if="!filtered.length"><td colspan="8" class="empty"><span class="big">—</span>Aucun achat ne correspond — enregistrez-en un ci-dessus ou effacez les filtres</td></tr>
            <tr v-for="p in filtered" :key="p.id">
              <td>
                <div class="date-cell">
                  <span class="d">{{ formatDate(p.purchase_date) }}</span>
                  <span v-if="relativeLabel(p.purchase_date)" class="rel" :class="relativeLabel(p.purchase_date).cls">{{ relativeLabel(p.purchase_date).text }}</span>
                </div>
              </td>
              <td class="text">{{ p.raw_material_name }}</td>
              <td><span v-if="p.packaging_name" class="pill" :class="p.packaging_name">{{ p.packaging_name }}</span><span v-else>—</span></td>
              <td class="num-cell pos">+{{ fmt(p.quantity) }} {{ p.unit }}</td>
              <td class="num-cell">{{ p.quantity_brut != null ? fmt(p.quantity_brut) + ' ' + p.unit : '—' }}</td>
              <td class="num-cell" :class="ecart(p) != null ? (ecart(p) >= 0 ? 'pos' : 'neg') : ''">
                {{ ecart(p) != null ? (ecart(p) >= 0 ? '+' : '') + fmt(ecart(p)) : '—' }}
              </td>
              <td class="text">{{ p.supplier || '—' }}</td>
              <td><button class="ghost small-btn danger" type="button" @click="remove(p)">Supprimer</button></td>
            </tr>
          </tbody>
          <tfoot v-if="filtered.length">
            <tr class="totals-row">
              <td colspan="3">Total</td>
              <td class="num-cell pos">+{{ fmt(totals.quantity) }} {{ filtered[0].unit }}</td>
              <td class="num-cell">{{ totals.hasBrut ? fmt(totals.quantity_brut) + ' ' + filtered[0].unit : '—' }}</td>
              <td class="num-cell" :class="totals.ecart >= 0 ? 'pos' : 'neg'">
                {{ totals.hasBrut ? (totals.ecart >= 0 ? '+' : '') + fmt(totals.ecart) : '—' }}
              </td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table></div>
      </div>
    </div>
  `
};