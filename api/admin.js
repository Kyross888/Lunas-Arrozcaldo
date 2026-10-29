// ============================================================
//  api/admin.js — admin dashboard stats (admin accounts only)
// ============================================================
const { handler } = require('../lib/http');
const { getDb } = require('../lib/db');
const { todayManila, dayStart, addDays, isYmd, DAY_EXPR, fmtTs, round2 } = require('../lib/util');

module.exports = handler(async (ctx) => {
  const user = ctx.requireAuth();
  if (user.role !== 'admin') return ctx.respond({ success: false, error: 'Admin access required.' }, 403);

  const db = await getDb();
  const txns = db.collection('transactions');
  const action = ctx.query.action || 'all_branches';
  const date = isYmd(ctx.query.date) ? ctx.query.date : todayManila();
  const dayRange = (d) => ({ $gte: dayStart(d), $lt: dayStart(addDays(d, 1)) });
  const done = { status: 'completed' };

  if (action === 'all_branches') {
    const yesterday = addDays(date, -1);
    const rows = await txns.aggregate([
      { $match: { ...done, created_at: { $gte: dayStart(yesterday), $lt: dayStart(addDays(date, 1)) } } },
      { $group: { _id: { b: '$branch_id', d: DAY_EXPR }, total: { $sum: '$total' }, n: { $sum: 1 } } },
    ]).toArray();
    const by = {};
    for (const r of rows) (by[r._id.b] ||= {})[r._id.d] = r;
    const branches = await db.collection('branches').find({}).sort({ id: 1 }).toArray();
    return ctx.respond({
      success: true,
      data: branches.map((b) => ({
        id: b.id, name: b.name, address: b.address,
        sales_today: round2(by[b.id]?.[date]?.total), orders_today: by[b.id]?.[date]?.n || 0,
        sales_yesterday: round2(by[b.id]?.[yesterday]?.total),
      })),
    });
  }

  if (action === 'branch') {
    const branchId = parseInt(ctx.query.id, 10) || 0;
    const match = { ...done, created_at: dayRange(date), ...(branchId ? { branch_id: branchId } : {}) };
    const [kpi] = await txns.aggregate([
      { $match: match }, { $group: { _id: null, sales_today: { $sum: '$total' }, orders_today: { $sum: 1 } } },
    ]).toArray();
    const rows = await txns.find(match).sort({ created_at: -1 }).limit(50).toArray();
    return ctx.respond({
      success: true,
      kpi: { sales_today: round2(kpi?.sales_today), orders_today: kpi?.orders_today || 0 },
      transactions: rows.map((t) => ({
        id: t.id, reference_no: t.reference_no, order_type: t.order_type, payment_method: t.payment_method,
        total: t.total, discount: t.discount, coupon_discount: t.coupon_discount, created_at: fmtTs(t.created_at),
        items_summary: (t.items || []).map((i) => `${i.quantity}x ${i.product_name}`).join(', ') || null,
      })),
    });
  }

  if (action === 'totals') {
    const [r] = await txns.aggregate([
      { $match: { ...done, created_at: dayRange(date) } },
      { $group: { _id: null, total_revenue: { $sum: '$total' }, total_orders: { $sum: 1 } } },
    ]).toArray();
    return ctx.respond({ success: true, data: { total_revenue: round2(r?.total_revenue), total_orders: r?.total_orders || 0 } });
  }

  if (action === 'total_discounts') {
    const d = ctx.query.date;
    const match = { ...done, ...(d && isYmd(d) ? { created_at: dayRange(d) } : {}) };
    const [r] = await txns.aggregate([
      { $match: match },
      { $group: {
          _id: null, total_discount: { $sum: '$discount' }, total_coupon_discount: { $sum: '$coupon_discount' },
          discounted_orders: { $sum: { $cond: [{ $or: [{ $gt: ['$discount', 0] }, { $gt: ['$coupon_discount', 0] }] }, 1, 0] } },
      } },
    ]).toArray();
    return ctx.respond({ success: true, data: {
      total_discount: round2(r?.total_discount), total_coupon_discount: round2(r?.total_coupon_discount),
      discounted_orders: r?.discounted_orders || 0,
    } });
  }

  if (action === 'monthly_revenue') {
    const rows = await txns.aggregate([
      { $match: done }, { $group: { _id: DAY_EXPR, revenue: { $sum: '$total' } } }, { $sort: { _id: 1 } },
    ]).toArray();
    return ctx.respond({ success: true, data: rows.map((r) => ({ day: r._id, revenue: round2(r.revenue) })) });
  }

  if (action === 'monthly_categories') {
    // Category of each sold item = category of the product with that name (counted once,
    // even though the same product exists once per branch).
    const prods = await db.collection('products').find({}, { projection: { name: 1, category: 1 } }).toArray();
    const cat = new Map();
    for (const p of prods) { const k = String(p.name).trim().toLowerCase(); if (!cat.has(k)) cat.set(k, p.category); }
    const sold = await txns.aggregate([
      { $match: done }, { $unwind: '$items' },
      { $group: { _id: '$items.product_name', rev: { $sum: '$items.line_total' } } },
    ]).toArray();
    const totals = {};
    for (const s of sold) {
      const c = cat.get(String(s._id).trim().toLowerCase());
      if (c) totals[c] = (totals[c] || 0) + s.rev;
    }
    const data = Object.entries(totals).map(([category, v]) => ({ category, total_revenue: round2(v) }))
      .sort((a, b) => b.total_revenue - a.total_revenue);
    return ctx.respond({ success: true, data });
  }

  if (action === 'top_moving') {
    const rows = await txns.aggregate([
      { $match: done }, { $unwind: '$items' },
      { $group: { _id: '$items.product_name', total_qty: { $sum: '$items.quantity' }, total_revenue: { $sum: '$items.line_total' } } },
      { $sort: { total_qty: -1 } }, { $limit: 10 },
    ]).toArray();
    return ctx.respond({ success: true, data: rows.map((r) => ({ name: r._id, total_qty: r.total_qty, total_revenue: round2(r.total_revenue) })) });
  }

  return ctx.respond({ success: false, error: 'Unknown action.' }, 400);
});
