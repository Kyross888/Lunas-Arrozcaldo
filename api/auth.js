// ============================================================
//  api/auth.js — login · register · logout · me · change_password · update_profile
// ============================================================
const bcrypt = require('bcryptjs');
const { handler } = require('../lib/http');
const { getDb, nextId } = require('../lib/db');
const { BRANCH_KEYS } = require('../lib/util');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const sessionUser = (u) => ({
  id: u.id,
  name: `${u.first_name} ${u.last_name}`,
  email: u.email,
  role: u.role,
  branch_id: u.branch_id ?? null,
});

module.exports = handler(async (ctx) => {
  const db = await getDb();
  const users = db.collection('users');
  const b = ctx.body;

  switch (ctx.query.action || '') {
    case 'login': {
      const email = str(b.email), password = str(b.password), role = str(b.role) || 'staff';
      if (!email || !password) return ctx.respond({ success: false, error: 'Email and password are required.' }, 400);

      const user = await users.findOne({ email, role });
      if (!user) return ctx.respond({ success: false, error: 'Invalid credentials.' }, 401);

      if (!(await bcrypt.compare(password, user.password))) {
        if (user.google_id) {
          return ctx.respond({ success: false, error: 'This account uses Google Sign-In. Use "Continue with Google" or reset your password to set one.' }, 401);
        }
        return ctx.respond({ success: false, error: 'Invalid credentials.' }, 401);
      }
      const su = sessionUser(user);
      ctx.login(su);
      return ctx.respond({ success: true, user: su });
    }

    case 'register': {
      const first_name = str(b.first_name), last_name = str(b.last_name);
      const email = str(b.email), password = str(b.password);
      const role = str(b.role) === 'admin' ? 'admin' : 'staff';
      const branch = str(b.branch), employee_id = str(b.employee_id);

      if (!first_name || !last_name || !email || !password)
        return ctx.respond({ success: false, error: 'All fields are required.' }, 400);
      if (!EMAIL_RE.test(email))
        return ctx.respond({ success: false, error: 'Enter a valid email address.' }, 400);
      if (await users.findOne({ email }, { projection: { id: 1 } }))
        return ctx.respond({ success: false, error: 'Email already registered.' }, 409);

      let branch_id = null;
      if (branch) {
        if (BRANCH_KEYS[branch]) branch_id = BRANCH_KEYS[branch];
        else {
          const br = await db.collection('branches').findOne({ name: branch });
          branch_id = br ? br.id : null;
        }
      }

      await users.insertOne({
        id: await nextId(db, 'users'),
        first_name, last_name, email,
        password: await bcrypt.hash(password, 10),
        role, employee_id: employee_id || null, phone: null, branch_id,
        google_id: null, picture: null,
        created_at: new Date(),
      });
      return ctx.respond({ success: true, message: 'Account created successfully.' });
    }

    case 'logout':
      ctx.logout();
      return ctx.respond({ success: true });

    case 'me': {
      if (!ctx.user) return ctx.respond({ success: false, error: 'Not logged in.' }, 401);
      const u = { ...ctx.user };
      if (u.branch_id) {
        const br = await db.collection('branches').findOne({ id: Number(u.branch_id) });
        u.branch_name = br ? br.name : null;
      } else u.branch_name = null;
      return ctx.respond({ success: true, user: u });
    }

    case 'change_password': {
      const user = ctx.requireAuth();
      const cur = str(b.current_password), next = str(b.new_password);
      if (!cur || !next) return ctx.respond({ success: false, error: 'Both fields are required.' }, 400);

      const row = await users.findOne({ id: Number(user.id) });
      if (!row || !(await bcrypt.compare(cur, row.password)))
        return ctx.respond({ success: false, error: 'Current password is incorrect.' }, 401);

      await users.updateOne({ id: Number(user.id) }, { $set: { password: await bcrypt.hash(next, 10) } });
      return ctx.respond({ success: true, message: 'Password updated successfully.' });
    }

    case 'update_profile': {
      const user = ctx.requireAuth();
      const fullName = str(b.full_name).replace(/\s+/g, ' ');
      if (!fullName) return ctx.respond({ success: false, error: 'Full name is required.' }, 400);
      if (fullName.length > 160) return ctx.respond({ success: false, error: 'Name is too long.' }, 400);

      const pos = fullName.lastIndexOf(' ');
      const first = pos === -1 ? fullName : fullName.slice(0, pos);
      const last = pos === -1 ? '' : fullName.slice(pos + 1);

      await users.updateOne({ id: Number(user.id) }, { $set: { first_name: first, last_name: last } });
      ctx.login({ ...user, name: fullName });
      return ctx.respond({ success: true, name: fullName });
    }

    default:
      return ctx.respond({ success: false, error: 'Unknown action.' }, 400);
  }
});
