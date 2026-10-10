import { authState, logout } from '../auth.js';
import { toastState } from '../toast.js';

export default {
  name: 'AppShell',
  data() {
    return {
      authState,
      toastState,
      sidebarOpen: false,
      navItems: [
        { path: '/dashboard', label: 'Tableau de bord', icon: '📊' },
        { path: '/daily-stock', label: 'Stock quotidien', icon: '📈' },
        { path: '/materials', label: 'Matières premières', icon: '📦' },
        { path: '/products', label: 'Produits finis', icon: '🏷️' },
        { path: '/recipes', label: 'Formules', icon: '📜' },
        { path: '/purchases', label: 'Achats', icon: '🛒' },
        { path: '/production', label: 'Production', icon: '⚙️' },
        { path: '/sales', label: 'Ventes', icon: '💰' },
        { path: '/adjustments', label: 'Ajustements', icon: '🔧' },
        { path: '/transfers', label: 'Transferts', icon: '🔄' },
        { path: '/ledger', label: 'Grand livre', icon: '📒' }
      ]
    };
  },
  watch: {
    // close the drawer automatically whenever the route changes
    '$route'() {
      this.sidebarOpen = false;
    }
  },
  methods: {
    logout() {
      logout();
      this.$router.push('/login');
    },
    userInitial() {
      if (!this.authState.user) return '?';
      const name = this.authState.user.username || this.authState.user.name || this.authState.user.email || 'U';
      return name.charAt(0).toUpperCase();
    },
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
    },
    closeSidebar() {
      this.sidebarOpen = false;
    }
  },
  template: `
    <div id="caspm-app">
      <!-- TOP BAR -->
      <header class="caspm-topbar">
        <div class="caspm-brand">
          <button class="caspm-menu-btn" @click="toggleSidebar" aria-label="Menu">☰</button>
          <img src="/images/logo.png" alt="CASPM" style="border-radius:6px; max-height:36px; width:auto;">
          <div>
            <h1>STOCK.</h1>
            <span class="caspm-tagline">GESTION DE STOCK</span>
          </div>
        </div>
        <div class="caspm-topbar-right">
          <span class="caspm-day">{{ new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }}</span>
          <span class="caspm-user-chip">
            <span class="caspm-avatar">{{ userInitial() }}</span>
            {{ authState.user ? (authState.user.username || authState.user.name || authState.user.email) : 'Invité' }}
            <button class="caspm-logout-btn" @click="logout">Déconnexion</button>
          </span>
        </div>
      </header>

      <div class="caspm-body">
        <!-- MOBILE BACKDROP -->
        <div
          class="caspm-sidebar-backdrop"
          :class="{ show: sidebarOpen }"
          @click="closeSidebar"
        ></div>

        <!-- SIDEBAR -->
        <nav class="caspm-sidebar" :class="{ open: sidebarOpen }">
          <div class="caspm-sidebar-label">MENU</div>
          <router-link
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            exact-active-class="active"
            @click="closeSidebar"
          >
            <span class="caspm-nav-icon">{{ item.icon }}</span>
            <span class="caspm-nav-label">{{ item.label }}</span>
          </router-link>
        </nav>

        <!-- CONTENT -->
        <main class="caspm-content">
          <router-view></router-view>
        </main>
      </div>

      <!-- TOAST -->
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
    </div>
  `
};