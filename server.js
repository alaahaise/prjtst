require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const authMiddleware = require('./middleware/authMiddleware');

const authRoutes = require('./routes/auth');
const rawMaterialsRoutes = require('./routes/rawMaterials');
const finishedProductsRoutes = require('./routes/finishedProducts');
const recipesRoutes = require('./routes/recipes');
const purchasesRoutes = require('./routes/purchases');
const productionRoutes = require('./routes/production');
const salesRoutes = require('./routes/sales');
const adjustmentsRoutes = require('./routes/adjustments');
const movementsRoutes = require('./routes/movements');
const transfersRoutes = require('./routes/transfers');
const productionReceiptsRoutes = require('./routes/productionReceipts');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

app.use(express.json());
app.use(cookieParser());

/* ---- Public auth endpoints (no token required) ---- */
app.use('/api/auth', authRoutes);

/* ---- Everything else under /api requires a valid session ---- */
app.use('/api', authMiddleware);
app.use('/api/raw-materials', rawMaterialsRoutes);
app.use('/api/finished-products', finishedProductsRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/adjustments', adjustmentsRoutes);
app.use('/api/movements', movementsRoutes);
app.use('/api/transfers', transfersRoutes);
app.use('/api/production-receipts', productionReceiptsRoutes);
app.use('/api/dashboard', dashboardRoutes);

/* ---- Static frontend (Vue app, loaded via native ES modules — no build step) ---- */
app.use(express.static(path.join(__dirname, 'public')));

/* ---- SPA fallback: any non-API GET route returns index.html so Vue Router
        can handle paths like /dashboard, /materials, /login directly and on refresh ---- */
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`CASPM server running on http://${HOST}:${PORT}`));