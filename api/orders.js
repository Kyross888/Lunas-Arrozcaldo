// ============================================================
//  api/orders.js — place · list · get · void · delete · restore
//  Each order embeds its line items (`items`) in one document.
// ============================================================
const crypto = require('crypto');
const { handler } = require('../lib/http');
const { getDb, nextId } = require('../lib/db');
const { isAdmin, scopedBranchId, assertBranchAccess } = require('../lib/scope');
const { fmtTs, round2 } = require('../lib/util');
const { changeStock } = require('../lib/stock');

/** Mongo document → the API shape the frontend already expects. */
function shape(t) {
  const { _id, items = [], ...rest } = t;
  return {
    ...rest,
    created_at: fmtTs(t.created_at),
    items: items.map((it) => ({ ...it, transaction_id: t.id })),
  };
}

const bumpStock = (products, productId, delta, branchFilter) =>
  changeStock(products, { id: Number(productId), ...(branchFilter ? { branch_id: branchFilter } : {}) }, delta);

module.exports = handler(async (ctx) => {
  const db = await getDb();
  const txns = db.collection('transactions');
  const products = db.collection('products');
  const action = ctx.query.action || '';
  const id = parseInt(ctx.query.id, 10) || 0;

  const assertOrderAccess = async (oid) => {
    const row = await txns.findOne({ id: oid }, { projection: { branch_id: 1 } });
    if (!row) ctx.respond({ success: false, error: 'Order not found.' }, 404);
    assertBranchAccess(ctx, row.branch_id);
  };

  // ── PLACE ───────────────────────────────────────────────
  if (action === 'place') {
    const user = ctx.requireAuth();
    const b = ctx.body;
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) return ctx.respond({ success: false, error: 'No items in order.' }, 400);

    const payment_method = b.payment_method || 'Cash';
    const gcashRef = String(b.gcash_reference || '').trim();
    const ref = payment_method === 'GCash' && gcashRef
      ? gcashRef
      : 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);

    const txnId = await nextId(db, 'transactions');
    const firstItemId = await nextId(db, 'transaction_items', items.length);
    const lines = items.map((it, i) => {
      const qty = parseInt(it.quantity, 10) || 1;
      const unit = parseFloat(it.price) || 0;
      return {
        id: firstItemId + i, product_id: it.product_id ?? null, product_name: it.name || '',
        unit_price: round2(unit), quantity: qty, line_total: round2(qty * unit),
      };
    });

    try {
      await txns.insertOne({
        id: txnId, reference_no: ref,
        branch_id: user.branch_id ?? null, user_id: user.id,
        customer_id: b.customer_id ? Number(b.customer_id) : null,
        order_type: b.order_type || 'Dine-in', payment_method,
        subtotal: round2(b.subtotal), discount: round2(b.discount),
        coupon_discount: round2(b.coupon_discount), total: round2(b.total),
        status: 'completed', created_at: new Date(), items: lines,
      });
    } catch (e) {
      if (e && e.code === 11000)
        return ctx.respond({ success: false, error: 'Order failed: that reference number was already used.' }, 409);
      throw e;
    }

    // Deduct stock (staff: only their own branch's product rows)
    const branchFilter = !isAdmin(user) && user.branch_id ? Number(user.branch_id) : null;
    await Promise.all(lines.filter((l) => l.product_id).map((l) => bumpStock(products, l.product_id, -l.quantity, branchFilter)));

    return ctx.respond({ success: true, reference_no: ref, transaction_id: txnId });
  }

  // ── LIST ────────────────────────────────────────────────
  if (action === 'list') {
    ctx.requireAuth();
    const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
    const limit = 50;
    const filter = { status: ctx.query.status === 'voided' ? 'voided' : 'completed' };
    const bid = scopedBranchId(ctx);
    if (bid !== null) filter.branch_id = bid;

    const rows = await txns.find(filter).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray();
    return ctx.respond({ success: true, data: rows.map(shape) });
  }

  // ── GET ─────────────────────────────────────────────────
  if (action === 'get') {
    ctx.requireAuth();
    const t = await txns.findOne({ id });
    if (!t) return ctx.respond({ success: false, error: 'Order not found.' }, 404);
    assertBranchAccess(ctx, t.branch_id);
    return ctx.respond({ success: true, data: shape(t) });
  }

  // ── VOID ────────────────────────────────────────────────
  if (action === 'void') {
    ctx.requireAuth();
    await assertOrderAccess(id);
    await txns.updateOne({ id }, { $set: { status: 'voided' } });
    return ctx.respond({ success: true });
  }

  // ── DELETE (recoverable: marks voided and puts stock back) ──
  if (action === 'delete') {
    ctx.requireAuth();
    if (id <= 0) return ctx.respond({ success: false, error: 'Invalid order id.' }, 400);
    await assertOrderAccess(id);
    // Atomic status flip → stock is restored exactly once even on double-clicks.
    const t = await txns.findOneAndUpdate({ id, status: 'completed' }, { $set: { status: 'voided' } }, { returnDocument: 'before' });
    const doc = t && t.value !== undefined ? t.value : t;
    if (doc) {
      await Promise.all((doc.items || []).filter((i) => i.product_id).map((i) => bumpStock(products, i.product_id, i.quantity)));
    }
    return ctx.respond({ success: true });
  }

  // ── RESTORE ─────────────────────────────────────────────
  if (action === 'restore') {
    ctx.requireAuth();
    if (id <= 0) return ctx.respond({ success: false, error: 'Invalid order id.' }, 400);
    await assertOrderAccess(id);
    const t = await txns.findOneAndUpdate({ id, status: 'voided' }, { $set: { status: 'completed' } }, { returnDocument: 'before' });
    const doc = t && t.value !== undefined ? t.value : t;
    if (doc) {
      await Promise.all((doc.items || []).filter((i) => i.product_id).map((i) => bumpStock(products, i.product_id, -i.quantity)));
    }
    return ctx.respond({ success: true });
  }

  return ctx.respond({ success: false, error: 'Unknown action.' }, 400);
});
