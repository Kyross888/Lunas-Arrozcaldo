// ============================================================
//  api/customers.js — CRUD for customer records
// ============================================================
const { handler } = require('../lib/http');
const { getDb, nextId } = require('../lib/db');
const { clean, fmtTs } = require('../lib/util');

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toBranch = (v) => (v === null || v === undefined || v === '' ? null : parseInt(v, 10) || null);

module.exports = handler(async (ctx) => {
  const db = await getDb();
  const customers = db.collection('customers');
  const action = ctx.query.action || 'list';
  const id = parseInt(ctx.query.id, 10) || 0;

  if (action === 'list') {
    ctx.requireAuth();
    const filter = {};
    const s = ctx.query.search;
    if (s) {
      const re = { $regex: escRe(s), $options: 'i' };
      filter.$or = [{ name: re }, { email: re }, { phone: re }];
    }
    const [rows, branches] = await Promise.all([
      customers.find(filter).toArray(),
      db.collection('branches').find({}).toArray(),
    ]);
    const bn = Object.fromEntries(branches.map((b) => [b.id, b.name]));
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return ctx.respond({
      success: true,
      data: rows.map((c) => ({ ...clean(c), branch_name: bn[c.branch_id] ?? null })),
    });
  }

  if (action === 'get') {
    ctx.requireAuth();
    const c = await customers.findOne({ id });
    if (!c) return ctx.respond({ success: false, error: 'Customer not found.' }, 404);
    const recent = await db.collection('transactions')
      .find({ customer_id: id }, { projection: { reference_no: 1, total: 1, order_type: 1, created_at: 1 } })
      .sort({ created_at: -1 }).limit(10).toArray();
    return ctx.respond({
      success: true,
      data: { ...clean(c), recent_transactions: recent.map(({ _id, created_at, ...r }) => ({ ...r, created_at: fmtTs(created_at) })) },
    });
  }

  if (action === 'create') {
    ctx.requireAuth();
    const b = ctx.body;
    const name = String(b.name || '').trim();
    if (!name) return ctx.respond({ success: false, error: 'Name is required.' }, 400);
    const newId = await nextId(db, 'customers');
    await customers.insertOne({
      id: newId, name, email: String(b.email || '').trim(), phone: String(b.phone || '').trim(),
      branch_id: toBranch(b.branch_id), created_at: new Date(),
    });
    return ctx.respond({ success: true, id: newId });
  }

  if (action === 'update') {
    ctx.requireAuth();
    const set = {};
    for (const f of ['name', 'email', 'phone', 'branch_id']) {
      if (f in ctx.body) set[f] = f === 'branch_id' ? toBranch(ctx.body[f]) : ctx.body[f];
    }
    if (!Object.keys(set).length) return ctx.respond({ success: false, error: 'Nothing to update.' }, 400);
    await customers.updateOne({ id }, { $set: set });
    return ctx.respond({ success: true });
  }

  if (action === 'delete') {
    ctx.requireAuth();
    await customers.deleteOne({ id });
    // keep order history, just unlink (matches the old ON DELETE SET NULL)
    await db.collection('transactions').updateMany({ customer_id: id }, { $set: { customer_id: null } });
    return ctx.respond({ success: true });
  }

  return ctx.respond({ success: false, error: 'Unknown action.' }, 400);
});
