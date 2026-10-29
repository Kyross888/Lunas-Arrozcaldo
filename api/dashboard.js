// ============================================================
//  api/dashboard.js — KPI / chart data (today + last 7 days)
// ============================================================
const { handler } = require('../lib/http');
const { getDb } = require('../lib/db');
const { scopedBranchId } = require('../lib/scope');
const { todayManila, dayStart, addDays, DAY_EXPR, round2 } = require('../lib/util');

module.exports = handler(async (ctx) => {
  const db = await getDb();
  const action = ctx.query.action;
  ctx.requireAuth();

  const bid = scopedBranchId(ctx);
  const branch = bid !== null ? { branch_id: bid } : {};
  const today = todayManila();
  const todayRange = { $gte: dayStart(today), $lt: dayStart(addDays(today, 1)) };
  const txns = db.collection('transactions');

  if (action === 'kpis') {
    const [agg] = await txns.aggregate([
      { $match: { status: 'completed', created_at: todayRange, ...branch } },
      { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
    ]).toArray();
    const prod = db.collection('products');
    const [low, out] = await Promise.all([
      prod.countDocuments({ is_active: true, stock: { $gt: 0, $lte: 10 }, ...branch }),
      prod.countDocuments({ is_active: true, stock: 0, ...branch }),
    ]);
    return ctx.respond({
      success: true,
      revenue_today: round2(agg?.revenue), orders_today: agg?.orders || 0,
      low_stock: low, out_of_stock: out,
    });
  }

  if (action === 'revenue_trend') {
    const rows = await txns.aggregate([
      { $match: { status: 'completed', created_at: { $gte: dayStart(addDays(today, -6)) }, ...branch } },
      { $group: { _id: DAY_EXPR, revenue: { $sum: '$total' } } },
      { $sort: { _id: 1 } },
    ]).toArray();
    return ctx.respond({ success: true, data: rows.map((r) => ({ day: r._id, revenue: round2(r.revenue) })) });
  }

  if (action === 'order_sources') {
    const rows = await txns.aggregate([
      { $match: { status: 'completed', created_at: todayRange, ...branch } },
      { $group: { _id: '$order_type', value: { $sum: 1 } } },
    ]).toArray();
    return ctx.respond({ success: true, data: rows.map((r) => ({ label: r._id, value: r.value })) });
  }

  if (action === 'top_products') {
    const rows = await txns.aggregate([
      { $match: { status: 'completed', created_at: todayRange, ...branch } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product_name', total_qty: { $sum: '$items.quantity' }, total_revenue: { $sum: '$items.line_total' } } },
      { $sort: { total_qty: -1 } },
      { $limit: 5 },
    ]).toArray();
    return ctx.respond({ success: true, data: rows.map((r) => ({ name: r._id, total_qty: r.total_qty, total_revenue: round2(r.total_revenue) })) });
  }

  if (action === 'peak_hour') {
    const rows = await txns.aggregate([
      { $match: { status: 'completed', created_at: todayRange, ...branch } },
      { $group: { _id: { $hour: { date: '$created_at', timezone: 'Asia/Manila' } }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray();
    return ctx.respond({ success: true, data: rows.map((r) => ({ hour: r._id, orders: r.orders })) });
  }

  return ctx.respond({ success: false, error: 'Unknown action.' }, 400);
});
