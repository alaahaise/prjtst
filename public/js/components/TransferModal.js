import { api } from '../api.js';
import { toast } from '../toast.js';
import { todayStr } from '../helpers.js';

export default {
  name: 'TransferModal',
  props: {
    show: Boolean,
    materials: Array,
    transfer: Object,
    editMode: Boolean
  },
  emits: ['close', 'saved'],
  data() {
    return {
      loading: false,
      entries: [],
      commonDate: todayStr(),
      defaultFrom: 'CENTRAL',
      defaultTo: 'UNITE_A',
      editingId: null,
    };
  },
  computed: {
    multiMaterials() {
      return this.materials.filter(m => m.stock_mode === 'MULTI');
    },
    canSave() {
      return this.entries.length > 0 &&
             this.entries.every(e =>
               e.raw_material_id &&
               e.from_location_code &&
               e.to_location_code &&
               e.quantity &&
               e.from_location_code !== e.to_location_code
             );
    }
  },
  watch: {
    show(val) {
      if (val) {
        this.initEntries();
      }
    },
    transfer: {
      handler(val) {
        if (this.editMode && val) {
          this.loadEditData();
        }
      },
      immediate: true,
      deep: true
    },
    editMode(val) {
      if (val && this.transfer) {
        this.loadEditData();
      }
    }
  },
  methods: {
    getDefaultPackaging(materialId) {
      if ([1, 2, 19].includes(Number(materialId))) return 2;
      return 1;
    },
    createEmptyEntry() {
      return {
        raw_material_id: '',
        packaging_id: 1,
        from_location_code: this.defaultFrom,
        to_location_code: this.defaultTo,
        quantity: '',
        note: ''
      };
    },
    initEntries() {
      if (this.editMode && this.transfer) {
        this.loadEditData();
      } else {
        this.entries = [this.createEmptyEntry()];
        this.commonDate = todayStr();
        this.editingId = null;
      }
    },
    // ---- DATE FIX – robust extraction ----
    loadEditData() {
      if (!this.transfer) return;
      console.log('[TransferModal] Loading edit data for transfer:', this.transfer);
      this.editingId = this.transfer.id;

      // Extract date from transfer_date – works for both "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm:ss"
      let dateStr = '';
      if (this.transfer.transfer_date) {
        // If it's a string, take the first 10 characters (YYYY-MM-DD)
        if (typeof this.transfer.transfer_date === 'string') {
          dateStr = this.transfer.transfer_date.slice(0, 10);
        } else if (this.transfer.transfer_date instanceof Date) {
          // If it's a Date object, build local YYYY-MM-DD
          const d = this.transfer.transfer_date;
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          dateStr = `${year}-${month}-${day}`;
        }
      }
      // Fallback to today if invalid
      if (!dateStr || dateStr.length !== 10) {
        dateStr = todayStr();
      }
      console.log('[TransferModal] Setting date to:', dateStr);
      this.commonDate = dateStr;

      this.entries = [{
        raw_material_id: this.transfer.raw_material_id,
        packaging_id: this.transfer.packaging_id || this.getDefaultPackaging(this.transfer.raw_material_id),
        from_location_code: this.transfer.from_code,
        to_location_code: this.transfer.to_code,
        quantity: this.transfer.quantity,
        note: this.transfer.note || ''
      }];
    },
    addEntry() {
      this.entries.push(this.createEmptyEntry());
    },
    removeEntry(index) {
      if (this.entries.length > 1) {
        this.entries.splice(index, 1);
      } else {
        toast('Vous devez avoir au moins un transfert', false);
      }
    },
    onMaterialChange(index) {
      const entry = this.entries[index];
      if (entry.raw_material_id) {
        entry.packaging_id = this.getDefaultPackaging(entry.raw_material_id);
      }
    },
    async saveAll() {
      if (!this.canSave) {
        toast('Veuillez remplir tous les champs obligatoires', false);
        return;
      }

      this.loading = true;
      let successCount = 0;
      try {
        if (this.editMode && this.editingId) {
          const entry = this.entries[0];
          const payload = {
            transfer_date: this.commonDate,
            raw_material_id: Number(entry.raw_material_id),
            packaging_id: Number(entry.packaging_id),
            from_location_code: entry.from_location_code,
            to_location_code: entry.to_location_code,
            quantity: Number(entry.quantity),
            note: entry.note
          };
          console.log('[TransferModal] PUT payload:', payload);
          await api(`/transfers/${this.editingId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          successCount = 1;
          toast('Transfert modifié !');
        } else {
          for (const entry of this.entries) {
            const payload = {
              transfer_date: this.commonDate,
              raw_material_id: Number(entry.raw_material_id),
              packaging_id: Number(entry.packaging_id),
              from_location_code: entry.from_location_code,
              to_location_code: entry.to_location_code,
              quantity: Number(entry.quantity),
              note: entry.note
            };
            await api('/transfers', {
              method: 'POST',
              body: JSON.stringify(payload)
            });
            successCount++;
          }
          toast(`${successCount} transfert(s) enregistré(s) !`);
        }

        this.$emit('saved');
        this.resetForm();
        this.$emit('close');
      } catch (err) {
        console.error('[TransferModal] Save error:', err);
        toast(err.message || 'Erreur lors de l\'enregistrement', false);
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
          <h2>{{ editMode ? 'Modifier le transfert' : 'Nouveaux transferts' }}</h2>
          <button class="modal-close" @click="close">×</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>Date de transfert</label>
            <input type="date" v-model="commonDate" required>
          </div>

          <div v-for="(entry, idx) in entries" :key="idx" class="entry-block">
            <div class="entry-header">
              <h3>Transfert #{{ idx + 1 }}</h3>
              <button class="btn-danger btn-small" @click="removeEntry(idx)" :disabled="entries.length === 1">×</button>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label>Matière première *</label>
                <select v-model="entry.raw_material_id" @change="onMaterialChange(idx)" required>
                  <option value="">Sélectionner...</option>
                  <option v-for="m in multiMaterials" :key="m.id" :value="m.id">{{ m.name }}</option>
                </select>
              </div>

              <div class="form-group">
                <label>Conditionnement</label>
                <select v-model="entry.packaging_id">
                  <option value="1">SAC</option>
                  <option value="2">VRAC</option>
                </select>
              </div>

              <div class="form-group">
                <label>De *</label>
                <select v-model="entry.from_location_code" required>
                  <option value="CENTRAL">Central</option>
                  <option value="UNITE_A">Unité A</option>
                  <option value="UNITE_B">Unité B</option>
                </select>
              </div>

              <div class="form-group">
                <label>Vers *</label>
                <select v-model="entry.to_location_code" required>
                  <option value="UNITE_A">Unité A</option>
                  <option value="UNITE_B">Unité B</option>
                  <option value="CENTRAL">Central</option>
                </select>
              </div>

              <div class="form-group">
                <label>Quantité *</label>
                <input type="number" step="0.01" v-model="entry.quantity" required>
              </div>

              <div class="form-group">
                <label>Note</label>
                <input type="text" v-model="entry.note" placeholder="Optionnel">
              </div>
            </div>
          </div>

          <button class="btn-secondary" @click="addEntry" style="width:100%;" v-if="!editMode">
            + Ajouter un autre transfert
          </button>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" @click="close">Annuler</button>
          <button class="btn-primary" @click="saveAll" :disabled="!canSave || loading">
            {{ loading ? 'Enregistrement...' : (editMode ? 'Modifier' : 'Enregistrer ' + entries.length + ' transfert(s)') }}
          </button>
        </div>
      </div>
    </div>
  `
};