// ============================================================
//  scripts/migrate-from-postgres.js — one-time copy of the old Supabase/PostgreSQL data into MongoDB
//    npm install pg --no-save
//    PG_URL="postgresql://..." MONGODB_URI="mongodb+srv://..." node scripts/migrate-from-postgres.js
//  Keeps the same numeric ids, so everything stays linked. Refuses to run on a non-empty target.
// ============================================================
const { Client } = require('pg');
const { getDb } = require('../lib/db');

const num = (v) => (v === null || v === undefined ? null : Number(v));
// Old timestamps are naive Manila wall-clock times ("2026-01-31 14:05:09.123") → real Dates.
const ts = (v) => (v ? new Date(String(v).replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1') + '+08:00') : null);

(async () => {
  if (!process.env.PG_URL) throw new Error('Set PG_URL to the old PostgreSQL connection string.');
  const pg = new Client({ connectionString: process.env.PG_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const db = await getDb();

  for (const c of ['users', 'products', 'customers', 'transactions']) {
    if (await db.collection(c).countDocuments({}, { limit: 1 })) {
      throw new Error(`Target collection "${c}" is not empty — run this on a fresh database (or clear it first).`);
    }
  }

  // Every timestamp is selected as text so no time-zone conversion happens in the driver.
  const q = async (sql) => (await pg.query(sql)).rows;
  const maxId = {};
  const bump = (name, rows) => { maxId[name] = Math.max(maxId[name] || 0, ...rows.map((r) => r.id)); };

  const branches = (await q('SELECT id, name, address, created_at::text AS created_at FROM branches ORDER BY id'))
    .map((r) => ({ ...r, created_at: ts(r.created_at) }));
  const users = (await q('SELECT id, first_name, last_name, email, password, role, employee_id, phone, branch_id, google_id, picture, created_at::text AS created_at FROM users ORDER BY id'))
    .map((r) => ({ ...r, created_at: ts(r.created_at), google_id: r.google_id || null }));
  const products = (await q('SELECT id, name, category, price, stock, image_path, icon, branch_id, is_active, created_at::text AS created_at FROM products ORDER BY id'))
    .map((r) => ({ ...r, price: num(r.price), created_at: ts(r.created_at) }));
  const customers = (await q('SELECT id, name, email, phone, branch_id, created_at::text AS created_at FROM customers ORDER BY id'))
    .map((r) => ({ ...r, created_at: ts(r.created_at) }));

  const items = await q('SELECT id, transaction_id, product_id, product_name, unit_price, quantity, line_total FROM transaction_items ORDER BY id');
  bump('transaction_items', items);
  const byTxn = new Map();
  for (const it of items) {
    if (!byTxn.has(it.transaction_id)) byTxn.set(it.transaction_id, []);
    byTxn.get(it.transaction_id).push({
      id: it.id, product_id: it.product_id, product_name: it.product_name,
      unit_price: num(it.unit_price), quantity: it.quantity, line_total: num(it.line_total),
    });
  }
  const transactions = (await q('SELECT id, reference_no, branch_id, user_id, customer_id, order_type, payment_method, subtotal, discount, coupon_discount, total, status, created_at::text AS created_at FROM transactions ORDER BY id'))
    .map((r) => ({
      ...r, subtotal: num(r.subtotal), discount: num(r.discount), coupon_discount: num(r.coupon_discount), total: num(r.total),
      created_at: ts(r.created_at), items: byTxn.get(r.id) || [],
    }));

  const sets = { branches, users, products, customers, transactions };
  for (const [name, rows] of Object.entries(sets)) {
    if (name !== 'branches') bump(name, rows);
    if (rows.length) await db.collection(name).insertMany(rows);
    console.log(`✓ ${name}: ${rows.length}`);
  }
  // Auto-increment counters continue after the highest migrated id.
  for (const [name, seq] of Object.entries(maxId)) {
    await db.collection('counters').updateOne({ _id: name }, { $set: { seq } }, { upsert: true });
  }
  console.log('✓ counters set. Now run:  npm run seed   (adds indexes; skips existing branches/admin)');
  await pg.end();
  process.exit(0);
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
