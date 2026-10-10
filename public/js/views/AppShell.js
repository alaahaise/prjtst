import { authState, logout } from '../auth.js';
import { toastState } from '../toast.js';

export default {
  name: 'AppShell',
  data() {
    return {
      authState,
      toastState,
      navItems: [
        { path: '/dashboard', label: 'Tableau de bord' },
        { path: '/daily-stock', label: 'Stock quotidien' },
        { path: '/materials', label: 'Matières premières' },
        { path: '/products', label: 'Produits finis' },
        { path: '/recipes', label: 'Formules' },
        { path: '/purchases', label: 'Achats' },
        { path: '/production', label: 'Production' },
        { path: '/sales', label: 'Ventes' },
        { path: '/adjustments', label: 'Ajustements' },
        { path: '/transfers', label: 'Transferts' },
        { path: '/ledger', label: 'Grand livre' }
      ]
    };
  },
  methods: {
    logout() {
      logout();
      this.$router.push('/login');
      // Optional: hard refresh to clear any cached state
      // window.location.reload();
    },
    userInitial() {
      if (!this.authState.user) return '?';
      const name = this.authState.user.username || this.authState.user.name || this.authState.user.email || 'U';
      return name.charAt(0).toUpperCase();
    }
  },
  template: `
    <header>
      <div class="brand">
        <!-- Use your custom logo image -->
        <img src="/images/logo.png" alt="CASPM"  style="border-radius: 6px;">
        <div>
          <h1>CASPM</h1>
          <div class="tagline">Gestion de stock</div>
        </div>
      </div>
      <div class="sub">
        <span class="day">{{ new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }}</span>
        <span class="user-chip">
          <span>{{ userInitial() }}</span>
          {{ authState.user ? (authState.user.username || authState.user.name || authState.user.email) : 'Invité' }}
          <button class="logout-btn" @click="logout">Déconnexion</button>
        </span>
      </div>
    </header>

    <nav>
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        exact-active-class="active"
      >
        {{ item.label }}
      </router-link>
    </nav>

    <main>
      <router-view></router-view>
    </main>

    <div id="toastHost">
      <div
        v-for="t in toastState.items"
        :key="t.id"
        class="toast"
        :class="t.ok ? 'ok' : 'err'"
      >
        {{ t.text }}
      </div>
    </div>
  `
};