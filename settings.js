// ============================================================
//  api/settings.js — store settings (GCash QR code)
//  get_qr    : any logged-in user  → the QR for their branch (falls back to the default one)
//  set_qr    : admin only (multipart "image", optional branch_id; blank = all branches)
//  reset_qr  : admin only → go back to the default picture
// ============================================================
const { handler } = require('../lib/http');
const { getDb } = require('../lib/db');
const { isAdmin } = require('../lib/scope');

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const MAX_BYTES = 3 * 1024 * 1024;

module.exports = handler(async (ctx) => {
  const user = ctx.requireAuth();
  const db = await getDb();
  const col = db.collection('settings');
  const action = ctx.query.action || 'get_qr';

  const parseBranch = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  if (action === 'get_qr') {
    const bid = isAdmin(user) ? parseBranch(ctx.query.branch_id) : parseBranch(user.branch_id);
    let doc = bid ? await col.findOne({ key: 'gcash_qr', branch_id: bid }) : null;
    let source = doc ? 'branch' : null;
    if (!doc) { doc = await col.findOne({ key: 'gcash_qr', branch_id: null }); if (doc) source = 'default'; }
    return ctx.respond({ success: true, image: doc ? doc.value : null, source: source || 'none' });
  }

  if (!isAdmin(user)) return ctx.respond({ success: false, error: 'Only an admin can change the GCash QR code.' }, 403);
  const input = Object.keys(ctx.form).length ? ctx.form : ctx.body;
  const bid = parseBranch(input.branch_id);

  if (action === 'set_qr') {
    const f = ctx.files.image;
    if (!f) return ctx.respond({ success: false, error: 'Please choose a picture.' }, 400);
    const ext = (f.filename || '').split('.').pop().toLowerCase();
    if (!MIME[ext]) return ctx.respond({ success: false, error: 'Use a PNG, JPG or WEBP picture.' }, 400);
    if (f.buffer.length > MAX_BYTES) return ctx.respond({ success: false, error: 'Picture is too big (max 3 MB).' }, 400);
    const value = `data:${MIME[ext]};base64,${f.buffer.toString('base64')}`;
    await col.updateOne({ key: 'gcash_qr', branch_id: bid }, { $set: { value, updated_at: new Date() } }, { upsert: true });
    return ctx.respond({ success: true, message: 'GCash QR code saved.' });
  }

  if (action === 'reset_qr') {
    await col.deleteOne({ key: 'gcash_qr', branch_id: bid });
    return ctx.respond({ success: true, message: 'GCash QR code reset.' });
  }

  return ctx.respond({ success: false, error: 'Unknown action.' }, 400);
});
