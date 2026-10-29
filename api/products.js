// ============================================================
//  api/products.js — full CRUD for inventory
// ============================================================
const { handler } = require('../lib/http');
const { getDb, nextId } = require('../lib/db');
const { isAdmin, scopedBranchId, assertBranchAccess } = require('../lib/scope');
const { clean, round2 } = require('../lib/util');
const { changeStock } = require('../lib/stock');

const CAT_ORDER = ['Breakfast', 'Merienda', 'Burgers And Sandwiches', 'Rice Meal', 'Native', 'Dessert', 'Drinks'];
const CATEGORIES = new Set(CAT_ORDER);
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toBool = (v) => !(v === false || v === 'false' || v === '0' || v === 0 || v === 'f');

/** Uploaded image → base64 data URI (stored in the document). Returns null if no/invalid file. */
function imageDataUri(file) {
  if (!file) return null;
  const ext = (file.filename || '').split('.').pop().toLowerCase();
  if (!MIME[ext]) return false; // invalid
  return `data:${MIME[ext]};base64,${file.buffer.toString('base64')}`;
}

module.exports = handler(async (ctx) => {
  const db = await getDb();
  const products = db.collection('products');
  const action = ctx.query.action || 'list';
  // multipart (FormData) → ctx.form, otherwise JSON → ctx.body
  const input = Object.keys(ctx.form).length ? ctx.form : ctx.body;
  const isMultipart = Object.keys(ctx.form).length > 0;

  const assertProductAccess = async (id) => {
    const row = await products.findOne({ id });
    if (!row) ctx.respond({ success: false, error: 'Product not found.' }, 404);
    assertBranchAccess(ctx, row.branch_id);
    return row;
  };

  if (action === 'list') {
    ctx.requireAuth();
    const filter = { is_active: true };
    if (ctx.query.category) filter.category = ctx.query.category;
    if (ctx.query.search) filter.name = { $regex: escRe(ctx.query.search), $options: 'i' };
    const bid = scopedBranchId(ctx);
    if (bid !== null) filter.branch_id = bid;

    const rows = await products.find(filter).toArray();
    const rank = (c) => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };
    rows.sort((a, b) => rank(a.category) - rank(b.category) || String(a.name).localeCompare(String(b.name)));
    return ctx.respond({ success: true, data: rows.map(clean) });
  }

  if (action === 'get') {
    ctx.requireAuth();
    const p = await products.findOne({ id: parseInt(ctx.query.id, 10) || 0, is_active: true });
    if (!p) return ctx.respond({ success: false, error: 'Product not found.' }, 404);
    assertBranchAccess(ctx, p.branch_id);
    return ctx.respond({ success: true, data: clean(p) });
  }

  if (action === 'create') {
    const user = ctx.requireAuth();
    const name = String(input.name || '').trim();
    const category = String(input.category || 'Breakfast').trim();
    const price = parseFloat(input.price) || 0;
    const stock = parseInt(input.stock, 10) || 0;
    let branch_id = input.branch_id ? parseInt(input.branch_id, 10) : null;
    const icon = input.icon || null;

    if (!name || price < 0) return ctx.respond({ success: false, error: 'Name and a valid price are required.' }, 400);
    if (!CATEGORIES.has(category)) return ctx.respond({ success: false, error: 'Invalid category.' }, 400);

    // Staff → own branch only. Admin picks a branch; blank = add to EVERY branch.
    if (!isAdmin(user)) {
      if (!user.branch_id) return ctx.respond({ success: false, error: 'Your account has no branch assigned.' }, 403);
      branch_id = Number(user.branch_id);
    }

    let image_path = null;
    if (ctx.files.image) {
      image_path = imageDataUri(ctx.files.image);
      if (image_path === false) return ctx.respond({ success: false, error: 'Invalid image type.' }, 400);
    }

    const targets = branch_id
      ? [branch_id]
      : (await db.collection('branches').find({}, { projection: { id: 1 } }).sort({ id: 1 }).toArray()).map((b) => b.id);

    const firstId = await nextId(db, 'products', targets.length);
    const docs = targets.map((bid, i) => ({
      id: firstId + i, name, category, price: round2(price), stock, image_path, icon,
      branch_id: bid, is_active: true, created_at: new Date(),
    }));
    if (docs.length) await products.insertMany(docs);
    return ctx.respond({ success: true, id: firstId, message: 'Product added.' });
  }

  if (action === 'update') {
    ctx.requireAuth();
    const id = parseInt(ctx.query.id, 10) || 0;
    await assertProductAccess(id);

    const allowed = isMultipart
      ? ['name', 'category', 'price', 'stock', 'icon', 'branch_id', 'is_active']
      : ['name', 'category', 'price', 'stock', 'image_path', 'icon', 'branch_id', 'is_active'];
    const set = {};
    for (const f of allowed) {
      if (isMultipart ? (input[f] !== undefined && input[f] !== '') : (f in input)) {
        let v = input[f];
        if (f === 'price') v = round2(parseFloat(v));
        else if (f === 'stock') v = parseInt(v, 10) || 0;
        else if (f === 'branch_id') v = v === null || v === '' ? null : parseInt(v, 10);
        else if (f === 'is_active') v = toBool(v);
        else if (f === 'category' && !CATEGORIES.has(v)) return ctx.respond({ success: false, error: 'Invalid category.' }, 400);
        set[f] = v;
      }
    }
    if (!isAdmin(ctx.user)) delete set.branch_id; // staff can't move a product to another branch

    if (ctx.files.image) {
      const uri = imageDataUri(ctx.files.image);
      if (uri) set.image_path = uri;
    }
    if (!Object.keys(set).length) return ctx.respond({ success: false, error: 'Nothing to update.' }, 400);

    await products.updateOne({ id }, { $set: set });
    return ctx.respond({ success: true, message: 'Product updated.' });
  }

  if (action === 'adjust_stock') {
    ctx.requireAuth();
    const id = parseInt(ctx.query.id, 10) || 0;
    await assertProductAccess(id);
    const delta = parseInt(ctx.body.delta, 10) || 0;
    await changeStock(products, { id }, delta);
    return ctx.respond({ success: true, message: 'Stock adjusted.' });
  }

  if (action === 'delete') {
    ctx.requireAuth();
    const id = parseInt(ctx.query.id, 10) || 0;
    await assertProductAccess(id);
    await products.updateOne({ id }, { $set: { is_active: false } });
    return ctx.respond({ success: true, message: 'Product removed.' });
  }

  return ctx.respond({ success: false, error: 'Unknown action.' }, 400);
});
