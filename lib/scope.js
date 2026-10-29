// ============================================================
//  lib/scope.js — keeps every branch's data separate
//  Staff → locked to their own branch (browser input ignored).
//  Admin → sees all branches, or one via ?branch_id=
// ============================================================
const isAdmin = (u) => !!u && u.role === 'admin';

/** Branch id to filter by (null = no filter). Staff with no branch get -1 (matches nothing). */
function scopedBranchId(ctx) {
  const u = ctx.user;
  if (!u || isAdmin(u)) {
    const q = ctx.query.branch_id;
    return q ? parseInt(q, 10) || null : null;
  }
  return u.branch_id ? Number(u.branch_id) : -1;
}

/** Block staff from touching rows of another branch. */
function assertBranchAccess(ctx, rowBranchId) {
  const u = ctx.user;
  if (!u || isAdmin(u)) return;
  const mine = u.branch_id ? Number(u.branch_id) : 0;
  if (Number(rowBranchId) !== mine) {
    ctx.respond({ success: false, error: 'This record belongs to another branch.' }, 403);
  }
}

module.exports = { isAdmin, scopedBranchId, assertBranchAccess };
