// ============================================================
//  scripts/seed.js — creates indexes, the 8 branches and the default admin.
//  Safe to run more than once.
//    MONGODB_URI="mongodb+srv://..." npm run seed
//  Optional: ADMIN_EMAIL / ADMIN_PASSWORD to choose the first admin login.
// ============================================================
const bcrypt = require('bcryptjs');
const { getDb, nextId } = require('../lib/db');

const BRANCHES = [
  [1, 'Festive Mall', 'Festive Walk Mall, Iloilo City'],
  [2, 'SM Central Market', 'SM City Iloilo, Mandurriao'],
  [3, 'General Luna', 'General Luna St., Iloilo City'],
  [4, 'Jaro', 'Jaro, Iloilo City'],
  [5, 'Molo', 'Molo, Iloilo City'],
  [6, 'La Paz', 'La Paz, Iloilo City'],
  [7, 'Calumpang', 'Calumpang, Iloilo City'],
  [8, 'Tagbak', 'Tagbak, Jaro, Iloilo City'],
];

(async () => {
  const db = await getDb();

  // ── indexes ──
  const idx = async (col, keys, opts) => {
    try { await db.collection(col).createIndex(keys, opts); }
    catch (e) { console.warn(`! index on ${col} skipped: ${e.message}`); } // e.g. emulators lacking an option
  };
  await idx('users', { id: 1 }, { unique: true });
  await idx('users', { email: 1 }, { unique: true });
  await idx('users', { google_id: 1 }, { unique: true, partialFilterExpression: { google_id: { $type: 'string' } } });
  await idx('branches', { id: 1 }, { unique: true });
  await idx('products', { id: 1 }, { unique: true });
  await idx('products', { branch_id: 1, is_active: 1, category: 1 });
  await idx('customers', { id: 1 }, { unique: true });
  await idx('transactions', { id: 1 }, { unique: true });
  await idx('transactions', { reference_no: 1 }, { unique: true });
  await idx('transactions', { branch_id: 1, status: 1, created_at: -1 });
  await idx('transactions', { created_at: -1 });
  await idx('password_resets', { expires_at: 1 }, { expireAfterSeconds: 3600 });
  console.log('✓ indexes');

  // ── branches ──
  for (const [id, name, address] of BRANCHES) {
    await db.collection('branches').updateOne({ id }, { $setOnInsert: { id, name, address, created_at: new Date() } }, { upsert: true });
  }
  console.log('✓ branches');

  // ── default admin ──
  const email = process.env.ADMIN_EMAIL || 'admin@lunas.com';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  // Only when there is no admin yet — never adds a default-password admin to a migrated database.
  const hasAdmin = await db.collection('users').countDocuments({ role: 'admin' }, { limit: 1 });
  if (!hasAdmin) {
    await db.collection('users').insertOne({
      id: await nextId(db, 'users'), first_name: 'Luna', last_name: 'Admin', email,
      password: await bcrypt.hash(password, 10), role: 'admin', employee_id: null, phone: null,
      branch_id: null, google_id: null, picture: null, created_at: new Date(),
    });
    console.log(`✓ admin created: ${email} / ${password}   ← change this password after first login`);
  } else console.log('• an admin account already exists — not creating another');

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
