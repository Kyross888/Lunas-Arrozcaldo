// ============================================================
//  api/google_auth.js — Google Sign-In / Sign-Up
//  The browser sends the Google OAuth access_token; we verify it
//  server-side with Google, so nobody can log in as someone else
//  just by posting an email address.
// ============================================================
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { handler } = require('../lib/http');
const { getDb, nextId } = require('../lib/db');
const { BRANCH_KEYS } = require('../lib/util');

const str = (v) => (typeof v === 'string' ? v.trim() : '');

async function verifyGoogle(accessToken) {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!r.ok) return null;
  const info = await r.json();
  return info && info.sub && info.email && info.email_verified !== false ? info : null;
}

module.exports = handler(async (ctx) => {
  const b = ctx.body;
  const accessToken = str(b.access_token);
  if (!accessToken) return ctx.respond({ success: false, error: 'Missing Google credentials.' }, 400);

  const g = await verifyGoogle(accessToken);
  if (!g) return ctx.respond({ success: false, error: 'Google could not verify your sign-in. Please try again.' }, 401);

  const google_id = g.sub, email = g.email;
  const firstName = g.given_name || str(b.first_name);
  const lastName = g.family_name || str(b.last_name);
  const picture = g.picture || '';
  const role = str(b.role) === 'admin' ? 'admin' : 'staff';
  const registerOnly = !!b.register_only;
  const plainPw = str(b.password);

  const db = await getDb();
  const users = db.collection('users');
  const user = await users.findOne({ email });

  if (user) {
    if (!user.google_id) {
      const set = { google_id, picture };
      if (plainPw) set.password = await bcrypt.hash(plainPw, 10);
      await users.updateOne({ id: user.id }, { $set: set });
    } else if (plainPw && !(await bcrypt.compare(plainPw, user.password))) {
      await users.updateOne({ id: user.id }, { $set: { password: await bcrypt.hash(plainPw, 10) } });
    }
    if (registerOnly)
      return ctx.respond({ success: false, error: 'An account with this email already exists. Please sign in instead.' }, 409);

    const su = { id: user.id, name: `${user.first_name} ${user.last_name}`, email: user.email, role: user.role, branch_id: user.branch_id ?? null };
    ctx.login(su);
    return ctx.respond({ success: true, user: su });
  }

  // New user via Google
  const branch_id = BRANCH_KEYS[str(b.branch)] || null;
  const hash = await bcrypt.hash(plainPw || crypto.randomBytes(16).toString('hex'), 10);
  const id = await nextId(db, 'users');
  await users.insertOne({
    id, first_name: firstName, last_name: lastName, email, password: hash, role,
    employee_id: str(b.employee_id) || null, phone: null, branch_id,
    google_id, picture, created_at: new Date(),
  });
  if (registerOnly) return ctx.respond({ success: true, message: 'Account created successfully.' });

  const su = { id, name: `${firstName} ${lastName}`, email, role, branch_id };
  ctx.login(su);
  return ctx.respond({ success: true, user: su });
});
