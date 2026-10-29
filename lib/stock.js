// ============================================================
//  lib/stock.js — change a product's stock, never going below 0
//  (equivalent of SQL's GREATEST(0, stock + delta))
// ============================================================
async function changeStock(products, filter, delta) {
  if (!delta) return;
  if (delta > 0) return products.updateOne(filter, { $inc: { stock: delta } });
  const r = await products.updateOne({ ...filter, stock: { $gte: -delta } }, { $inc: { stock: delta } });
  if (!r.matchedCount) await products.updateOne({ ...filter, stock: { $lt: -delta } }, { $set: { stock: 0 } });
}
module.exports = { changeStock };
