import { api } from '../api.js';
import { fmt, printReport } from '../helpers.js';
import { toast } from '../toast.js';

export default {
  name: 'DailyStockView',
  data() {
    return {
      rawRows: [],
      finishedRows: []
    };
  },
  async mounted() {
    await this.load();
  },
  methods: {
    fmt,
    async load() {
      try {
        this.rawRows = await api('/raw-materials/grouped-totals');
      } catch (err) {
        this.rawRows = [];
        toast('Impossible de charger le stock quotidien des matières premières : ' + err.message, false);
      }
      try {
        this.finishedRows = await api('/finished-products/grouped-totals');
      } catch {
        this.finishedRows = [];
      }
    },
    printRaw() {
      printReport('État du jour — Matières premières', [
        { key: 'group_name', label: 'Désignation' },
        { key: 'unite_a_display', label: 'Unité A', num: true },
        { key: 'unite_b_display', label: 'Unité B', num: true },
        { key: 'vrac_display', label: 'Vrac (central)', num: true },
        { key: 'sac_display', label: 'Sac (central)', num: true },
        { key: 'total_display', label: 'Total', num: true },
        { key: 'note_display', label: 'Note' }
      ], this.rawRows.map(r => ({
        group_name: r.group_name,
        unite_a_display: fmt(r.unite_a_stock),
        unite_b_display: fmt(r.unite_b_stock),
        vrac_display: fmt(r.central_vrac_stock),
        sac_display: fmt(r.central_sac_stock),
        total_display: `${fmt(r.total_stock)} ${r.unit}`,
        note_display: r.low_stock ? 'manque de matière' : ''
      })));
    },
    printFinished() {
      printReport('État du jour — Produits finis', [
        { key: 'group_name', label: 'Produit' },
        { key: 'variants_display', label: 'Détail' },
        { key: 'total_stock_display', label: 'Stock total', num: true }
      ], this.finishedRows.map(r => ({
        group_name: r.group_name,
        variants_display: (r.variants && r.variants.includes(' + ')) ? r.variants : '—',
        total_stock_display: `${fmt(r.total_stock)} ${r.unit}`
      })));
    }
  },
  template: `
    <div>
      <div class="panel">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">État du jour — Matières premières</h2>
          <span class="count">{{ rawRows.length }} lignes</span>
        </div>
        <p style="font-family:'IBM Plex Mono',monospace; font-size:11px; opacity:.55; margin:0 0 12px;">
          Stock regroupé par matière. Colonne Sac / Vrac = conditionnement au stock central.
        </p>
        <div class="toolbar">
          <span class="spacer"></span>
          <button class="ghost small-btn" type="button" @click="printRaw">🖨 Imprimer ce rapport</button>
        </div>
        <div class="tbl-wrap">
          <table class="daily-table">
            <thead>
              <tr class="group-row">
                <th rowspan="2" style="text-align:left;">Désignation</th>
                <th class="grp-celon" colspan="2">Celon</th>
                <th class="grp-stock" colspan="2">Stockage Central</th>
                <th class="grp-total num-cell" rowspan="2">Total</th>
                <th rowspan="2">Note</th>
              </tr>
              <tr class="group-row">
                <th class="grp-celon num-cell">Unité A</th>
                <th class="grp-celon num-cell">Unité B</th>
                <th class="grp-stock num-cell">Vrac</th>
                <th class="grp-stock num-cell">Sac</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!rawRows.length"><td colspan="7" class="empty"><span class="big">—</span>Aucune matière première</td></tr>
              <tr v-for="r in rawRows" :key="r.group_name" :class="r.low_stock ? 'low-row' : ''">
                <td class="text">{{ r.group_name }}</td>
                <td class="num-cell">{{ fmt(r.unite_a_stock) }}</td>
                <td class="num-cell">{{ fmt(r.unite_b_stock) }}</td>
                <td class="num-cell">{{ fmt(r.central_vrac_stock) }}</td>
                <td class="num-cell">{{ fmt(r.central_sac_stock) }}</td>
                <td class="num-cell"><strong>{{ fmt(r.total_stock) }}</strong> {{ r.unit }}</td>
                <td><span v-if="r.low_stock" class="note-missing">manque de matière</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2 style="margin:0;border:none;padding:0;">État du jour — Produits finis</h2>
          <span class="count">{{ finishedRows.length }} lignes</span>
        </div>
        <div class="toolbar">
          <span class="spacer"></span>
          <button class="ghost small-btn" type="button" @click="printFinished">🖨 Imprimer ce rapport</button>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th>Produit / Groupe</th><th>Détail (variantes)</th><th class="num-cell">Stock total</th>
            </tr></thead>
            <tbody>
              <tr v-if="!finishedRows.length"><td colspan="3" class="empty"><span class="big">—</span>Aucun produit fini</td></tr>
              <tr v-for="r in finishedRows" :key="r.group_name">
                <td class="text">{{ r.group_name }}</td>
                <td class="text" style="opacity:.6; font-size:12px;">{{ (r.variants && r.variants.includes(' + ')) ? r.variants : '—' }}</td>
                <td class="num-cell">{{ fmt(r.total_stock) }} {{ r.unit }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
};
