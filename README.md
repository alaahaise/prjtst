#  — Vue + Express, with authentication

This restructures the single-file app into a routed Vue 3 frontend served by your
existing Express backend, with login-gated access.

## What's new vs. what's unchanged

**New:**
- `middleware/authMiddleware.js` — verifies a JWT cookie on protected `/api/*` routes
- `routes/auth.js` — `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `scripts/createUser.js` — CLI to create/reset a login
- `users` table in `schema.sql`
- The entire `public/` folder — now a Vue 3 app (see below) instead of one `index.html`
- `server.js` — added cookie parsing, mounted `/api/auth` as public, protected the rest,
  added a SPA fallback so `/materials`, `/production`, etc. work on direct load/refresh

**Unchanged — bring these back in from your current project:**
- `routes/rawMaterials.js`, `finishedProducts.js`, `recipes.js`, `purchases.js`,
  `production.js`, `sales.js`, `adjustments.js`, `movements.js`
- `db/pool.js` if you already have one (I included a placeholder using `mysql2/promise`
  in case you don't — delete mine if you do)
- The rest of your `schema.sql` (raw_materials, finished_products, recipes, etc.) —
  just append it below the new `users` table

## Why Vue with no build step

Vue 3 and Vue Router are loaded as native ES modules straight from a CDN via an
import map in `public/index.html`. Your own files just write ordinary
`import { createApp } from 'vue'`. There's no Vite/webpack, no `npm run build`,
no `dist/` folder — you deploy `public/` exactly like you do today, just with more
files in it instead of one.

## Routing

Real paths now exist for every section:
`/dashboard`, `/daily-stock`, `/materials`, `/products`, `/recipes`, `/purchases`,
`/production`, `/sales`, `/adjustments`, `/transfers`, `/ledger`, plus `/login`.

A Vue Router navigation guard (`public/js/router.js`) redirects to `/login` if
there's no active session, and back to `/dashboard` if an already-logged-in user
hits `/login`.

## Setup

```bash
npm install
cp .env.example .env        # fill in DB credentials and a real JWT_SECRET
mysql < schema.sql          # adds the users table (append your existing schema below it)
node scripts/createUser.js admin your_password admin
npm start
```

Then visit `http://localhost:3000` — you'll land on `/login`.

## Auth design

- Password hashed with bcrypt, stored in `users.password_hash`
- On login, the server signs a JWT (`{ id, username, role }`) and sets it as an
  `httpOnly` cookie (`token`), so client-side JS never touches the raw token
- Every `/api/*` route except `/api/auth/*` runs through `authMiddleware`, which
  verifies the cookie and attaches `req.user`
- No changes needed to your existing route handlers — they're mounted behind the
  middleware as-is, and can read `req.user` later if you want to log who did what
- Sessions last 12h (`expiresIn: '12h'` in `routes/auth.js`) — adjust to taste

## Structure

```
public/
├── index.html            # SPA shell + import map
├── css/theme.css          # your current design, unchanged
└── js/
    ├── main.js            # creates and mounts the Vue app
    ├── router.js          # routes + auth guard
    ├── App.js             # root component (just <router-view/>)
    ├── api.js             # fetch wrapper (sends cookie, handles 401)
    ├── auth.js            # reactive auth state, login()/logout()/fetchMe()
    ├── toast.js            # reactive toast queue
    ├── helpers.js          # fmt/sort/filter/CSV/print — ported 1:1 from your original JS
    └── views/
        ├── LoginView.js
        ├── AppShell.js     # header + nav + <router-view/> outlet
        ├── DashboardView.js
        ├── DailyStockView.js
        ├── MaterialsView.js
        ├── ProductsView.js
        ├── RecipesView.js
        ├── PurchasesView.js
        ├── ProductionView.js
        ├── SalesView.js
        ├── AdjustmentsView.js
        ├── TransfersView.js
        └── LedgerView.js
```

Every view calls the exact same API endpoints your original `index.html` did —
only the rendering layer changed, from manual DOM string-building to Vue templates.
Search, sort, date-range filters, CSV export, grouping (Production & Ledger), the
recipe editor, and the printable report generator are all preserved.
