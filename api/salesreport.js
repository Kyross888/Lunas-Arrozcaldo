// ============================================================
//  api/salesreport.js — sales report for a date range
// ============================================================
const { handler } = require('../lib/http');
const { getDb } = require('../lib/db');
const { scopedBranchId } = require('../lib/scope');
const { todayManila, dayStart, addDays, isYmd, fmtTs, round2 } = require('../lib/util');

module.exports = handler(async (ctx) => {
  ctx.requireAuth();
  const db = await getDb();

  let from = ctx.query.date_from;
  if (!isYmd(from)) from = todayManila();
  let to = ctx.query.date_to;
  if (!isYmd(to)) to = from;

  const bid = scopedBranchId(ctx);
  const match = {
    status: 'completed',
    created_at: { $gte: dayStart(from), $lt: dayStart(addDays(to, 1)) },
    ...(bid !== null ? { branch_id: bid } : {}),
  };
  const txns = db.collection('transactions');

  const [kpi] = await txns.aggregate([
    { $match: match },
    { $group: { _id: null, total_revenue: { $sum: '$total' }, total_orders: { $sum: 1 },
                total_discounts: { $sum: { $add: ['$discount', '$coupon_discount'] } } } },
  ]).toArray();

  const rows = await txns.find(match).sort({ created_at: -1 }).toArray();
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((x) => x != null))];
  const users = await db.collection('users').find({ id: { $in: userIds } }, { projection: { id: 1, first_name: 1, last_name: 1 } }).toArray();
  const um = Object.fromEntries(users.map((u) => [u.id, u]));

  const [best] = await txns.aggregate([
    { $match: match },
    { $unwind: '$items' },
    { $group: { _id: '$items.product_name', qty: { $sum: '$items.quantity' }, pid: { $first: '$items.product_id' } } },
    { $sort: { qty: -1 } },
    { $limit: 1 },
  ]).toArray();
  let bestSeller = null;
  if (best) {
    const p = best.pid != null ? await db.collection('products').findOne({ id: best.pid }) : null;
    bestSeller = { product_name: best._id, qty: best.qty, image_path: p?.image_path ?? null, icon: p?.icon ?? null };
  }

  return ctx.respond({
    success: true,
    summary: {
      total_revenue: round2(kpi?.total_revenue), total_orders: kpi?.total_orders || 0,
      total_discounts: round2(kpi?.total_discounts),
    },
    best_seller: bestSeller,
    transactions: rows.map((t) => ({
      id: t.id, reference_no: t.reference_no, order_type: t.order_type, payment_method: t.payment_method,
      subtotal: t.subtotal, discount: t.discount, coupon_discount: t.coupon_discount, total: t.total,
      created_at: fmtTs(t.created_at),
      first_name: um[t.user_id]?.first_name ?? null, last_name: um[t.user_id]?.last_name ?? null,
      item_count: (t.items || []).length,
    })),
  });
});
