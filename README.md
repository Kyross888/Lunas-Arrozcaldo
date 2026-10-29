# Luna's POS — Ilonggo Legacy

A web-based Point of Sale (POS) system for **Luna's Arrozcaldo**, a classic Ilonggo restaurant with branches across Iloilo City.

## Features

- 🖥️ **POS Terminal** — order and checkout interface
- 📊 **Dashboard** — today's revenue, orders, top products
- 📦 **Inventory** — stock levels and low-stock alerts
- 👥 **Customers** — records and order history
- 📈 **Sales Reports & Analytics**
- 🔐 **Role-based login** (admin/staff) with Google Sign-In
- 🏪 **Multi-branch** — 8 branches, staff are locked to their own branch
- 📱 **PWA** — installable on mobile/desktop

## Tech Stack

- **Hosting:** Vercel (static pages + Node.js serverless functions in `api/`)
- **Database:** MongoDB Atlas
- **Frontend:** Vanilla HTML/CSS/JS
- **Auth:** signed HTTP-only cookie (JWT) + Google OAuth

## Deploy

### 1. MongoDB Atlas
1. Create a free cluster at <https://cloud.mongodb.com>.
2. **Database Access** → add a user with a password.
3. **Network Access** → allow `0.0.0.0/0` (Vercel uses changing IPs).
4. **Connect → Drivers** → copy the connection string. (Pick the Singapore region for the cluster — the Vercel functions are set to Singapore `sin1` in `vercel.json`.)

### 2. Create the data (once)
```bash
npm install
MONGODB_URI="mongodb+srv://USER:PASS@CLUSTER.mongodb.net/?retryWrites=true&w=majority" npm run seed
```
This creates indexes, the 8 branches and — only if no admin exists yet — an admin login (`admin@lunas.com` / `admin123`; change it in **Settings** right away, or set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before seeding).

### 3. Vercel
1. Push this folder to a GitHub repository.
2. In Vercel: **Add New → Project** → import the repo (leave the defaults — no build step).
3. Add **Environment Variables**:

| Name | Value |
|------|-------|
| `MONGODB_URI` | your Atlas connection string |
| `MONGODB_DB` | `lunas_pos` |
| `JWT_SECRET` | a long random string (`openssl rand -hex 32`) |

4. Deploy. Open the Vercel URL → log in.
5. For Google Sign-In see [GOOGLE_SETUP.md](GOOGLE_SETUP.md) (add your Vercel URL as an authorized origin).

## Run locally
```bash
cp .env.example .env.local   # fill in values
npm run dev                  # http://localhost:3000
```

## Moving your existing Supabase/PostgreSQL data (optional)
```bash
npm install pg --no-save
PG_URL="postgresql://..." MONGODB_URI="mongodb+srv://..." node scripts/migrate-from-postgres.js
```
Existing users keep their passwords (PHP bcrypt hashes work as-is). The script clears nothing and refuses to run if the target collections already contain data.

## How the pieces map
- Pages are in `public/`. Old `*.php` addresses still work (`vercel.json` rewrites them), so bookmarks and the installed PWA keep working.
- Each former PHP endpoint is now `api/<name>.js`; the browser code (`public/js/api.js`) is unchanged.
- Orders store their line items inside the order document (`items`), so an order is saved atomically.

## Notes
- Vercel request bodies are limited to ~4.5 MB, so product photos must be smaller than that (they are stored inside the product document).
- Password reset still sends its email from the browser through EmailJS, as before.
