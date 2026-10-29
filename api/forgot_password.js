// ============================================================
//  api/forgot_password.js — password reset (code is emailed by EmailJS from the browser)
// ============================================================
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { handler } = require('../lib/http');
const { getDb, nextId } = require('../lib/db');
const { TZ } = require('../lib/util');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

module.exports = handler(async (ctx) => {
  const db = await getDb();
  const users = db.collection('users');
  const resets = db.collection('password_resets');
  const b = ctx.body;
  const action = ctx.query.action || '';

  if (action === 'send') {
    const email = str(b.email);
    if (!email || !EMAIL_RE.test(email)) return ctx.respond({ success: false, error: 'Enter a valid email address.' }, 400);
    const user = await users.findOne({ email });
    if (!user) return ctx.respond({ success: false, error: 'No account found with that email address.' }, 404);

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await resets.deleteMany({ user_id: user.id });
    await resets.insertOne({
      id: await nextId(db, 'password_resets'), user_id: user.id, code, token: null,
      expires_at: new Date(Date.now() + 10 * 60 * 1000), used: false, created_at: new Date(),
    });

    const [local, domain] = user.email.split('@');
    const time = new Date().toLocaleString('en-US', {
      timeZone: TZ, month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    }).replace(/, (\d{2}:\d{2})/, ' $1');
    // Returns code + masked email — EmailJS sends the message from the browser
    return ctx.respond({
      success: true, email_hint: `${local[0]}***@${domain}`, to_email: user.email,
      to_name: user.first_name, passcode: code, time,
    });
  }

  if (action === 'verify') {
    const email = str(b.email), code = str(b.code);
    if (!email || !code) return ctx.respond({ success: false, error: 'Email and code are required.' }, 400);
    const user = await users.findOne({ email });
    if (!user) return ctx.respond({ success: false, error: 'Invalid request.' }, 400);

    const reset = await resets.findOne({ user_id: user.id, code, used: false, expires_at: { $gt: new Date() } });
    if (!reset) return ctx.respond({ success: false, error: 'Invalid or expired code. Please request a new one.' }, 400);

    const token = crypto.randomBytes(32).toString('hex');
    await resets.updateOne({ id: reset.id }, { $set: { token } });
    return ctx.respond({ success: true, token });
  }

  if (action === 'reset') {
    const token = str(b.token), newPw = str(b.new_password);
    if (!token || !newPw) return ctx.respond({ success: false, error: 'Token and new password required.' }, 400);
    if (newPw.length < 6) return ctx.respond({ success: false, error: 'Password must be at least 6 characters.' }, 400);

    const reset = await resets.findOneAndUpdate(
      { token, used: false, expires_at: { $gt: new Date() } }, { $set: { used: true } }, { returnDocument: 'before' }
    );
    const doc = reset && reset.value !== undefined ? reset.value : reset;
    if (!doc) return ctx.respond({ success: false, error: 'Invalid or expired token. Please restart.' }, 400);

    await users.updateOne({ id: doc.user_id }, { $set: { password: await bcrypt.hash(newPw, 10) } });
    return ctx.respond({ success: true, message: 'Password reset successfully.' });
  }

  return ctx.respond({ success: false, error: 'Unknown action.' }, 400);
});
