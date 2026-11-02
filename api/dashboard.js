// ============================================================
//  api/dashboard.js — KPI / chart data (today + last 7 days)
// ============================================================
const { handler } = require('../lib/http');
const { getDb } = require('../lib/db');
const { scopedBranchId } = require('../lib/scope');
const { todayManila, dayStart, addDays, isYmd, DAY_EXPR, round2 } = require('../lib/util');

module.exports = handler(async (ctx) => {
  const db = await getDb();
  const action = ctx.query.action;
  ctx.requireAuth();

  const bid = scopedBranchId(ctx);
  const branch = bid !== null ? { branch_id: bid } : {};
  const today = todayManila();
  // Optional ?date_from=&date_to= (YYYY-MM-DD, Manila). Defaults to today.
  let from = isYmd(ctx.query.date_from) ? ctx.query.date_from : today;
  let to = isYmd(ctx.query.date_to) ? ctx.query.date_to : from;
  if (to < from) [from, to] = [to, from];
  const todayRange = { $gte: dayStart(from), $lt: dayStart(addDays(to, 1)) };
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
      { $match: { status: 'completed',
          created_at: ctx.query.date_from ? todayRange : { $gte: dayStart(addDays(today, -6)) }, ...branch } },
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

  if (action === 'category_sales') {
    const rows = await txns.aggregate([
      { $match: { status: 'completed', created_at: todayRange, ...branch } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product_id', name: { $first: '$items.product_name' }, qty: { $sum: '$items.quantity' }, revenue: { $sum: '$items.line_total' } } },
    ]).toArray();
    const ids = rows.map((r) => r._id).filter((x) => x != null);
    const prods = await db.collection('products').find({ id: { $in: ids } }, { projection: { id: 1, category: 1 } }).toArray();
    const cat = Object.fromEntries(prods.map((p) => [p.id, p.category]));
    const byCat = {};
    for (const r of rows) {
      const c = cat[r._id] || 'Other';
      byCat[c] = byCat[c] || { category: c, qty: 0, revenue: 0 };
      byCat[c].qty += r.qty; byCat[c].revenue += r.revenue;
    }
    return ctx.respond({ success: true, data: Object.values(byCat).map((c) => ({ ...c, revenue: round2(c.revenue) })) });
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
