import { createRouter, createWebHistory } from 'vue-router';
import { authState, fetchMe } from './auth.js';

import LoginView from './views/LoginView.js';
import AppShell from './views/AppShellNew.js';
import DashboardView from './views/DashboardView.js';
import DailyStockView from './views/DailyStockView.js';
import MaterialsView from './views/MaterialsView.js';
import ProductsView from './views/ProductsView.js';
import RecipesView from './views/RecipesView.js';
import PurchasesView from './views/PurchasesView.js';
import ProductionView from './views/ProductionView.js';
import SalesView from './views/SalesView.js';
import AdjustmentsView from './views/AdjustmentsView.js';
import TransfersView from './views/TransfersView.js';
import LedgerView from './views/LedgerView.js';

const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  {
    path: '/',
    component: AppShell,
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'dashboard', component: DashboardView },
      { path: 'daily-stock', name: 'daily-stock', component: DailyStockView },
      { path: 'materials', name: 'materials', component: MaterialsView },
      { path: 'products', name: 'products', component: ProductsView },
      { path: 'recipes', name: 'recipes', component: RecipesView },
      { path: 'purchases', name: 'purchases', component: PurchasesView },
      { path: 'production', name: 'production', component: ProductionView },
      { path: 'sales', name: 'sales', component: SalesView },
      { path: 'adjustments', name: 'adjustments', component: AdjustmentsView },
      { path: 'transfers', name: 'transfers', component: TransfersView },
      { path: 'ledger', name: 'ledger', component: LedgerView }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
];

export const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to) => {
  // Make sure we've asked the server about the session at least once.
  if (!authState.checked) {
    await fetchMe();
  }

  const isPublic = to.matched.some(r => r.meta.public);

  if (!isPublic && !authState.user) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.path === '/login' && authState.user) {
    return { path: '/dashboard' };
  }
  return true;
});
