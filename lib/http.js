// ============================================================
//  lib/http.js — request/response helpers + cookie session (JWT)
// ============================================================
const jwt = require('jsonwebtoken');
const Busboy = require('busboy');
const { getDb } = require('./db');

const COOKIE = 'lunas_session';
const SESSION_DAYS = 365;         // stay logged in for a year (browsers cap cookies at ~400 days)
const REFRESH_AFTER_SEC = 86400;  // rolling: renew the cookie (and re-check the account) once a day of use

class Done extends Error {}

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET environment variable is not set.');
  return s;
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    if (req.body && typeof req.body === 'object') return resolve(Buffer.from(JSON.stringify(req.body)));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(req, raw) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = {};
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 4 * 1024 * 1024 } });
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        if (chunks.length) files[name] = { buffer: Buffer.concat(chunks), filename: info.filename, mime: info.mimeType };
      });
    });
    bb.on('close', () => resolve({ fields, files }));
    bb.on('error', reject);
    bb.end(raw);
  });
}

/**
 * Wrap an endpoint. The handler receives a ctx with:
 *   query, body (JSON), form (multipart fields), files, user (session or null),
 *   respond(data, code), requireAuth(), login(user), logout()
 * respond() ends the request (like PHP's exit).
 */
function handler(fn) {
  return async (req, res) => {
    const ctx = {};
    const send = (data, code = 200) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.end(JSON.stringify(data));
      throw new Done();
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      ctx.req = req; ctx.res = res;
      ctx.query = Object.fromEntries(url.searchParams.entries());
      ctx.method = req.method;
      ctx.respond = send;
      ctx.body = {}; ctx.form = {}; ctx.files = {};

      if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const ct = (req.headers['content-type'] || '').toLowerCase();
        const raw = await readRaw(req);
        if (ct.startsWith('multipart/form-data')) {
          const { fields, files } = await parseMultipart(req, raw);
          ctx.form = fields; ctx.files = files;
        } else if (raw.length) {
          try { ctx.body = JSON.parse(raw.toString('utf8')) || {}; } catch { ctx.body = {}; }
        }
      }

      // ── session ──
      const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.VERCEL === '1';
      const cookieOpts = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
      const setCookie = (val, maxAgeSec) =>
        res.setHeader('Set-Cookie', `${COOKIE}=${val}; ${cookieOpts}; Max-Age=${maxAgeSec}`);

      const issue = (user) => {
        const token = jwt.sign({ u: user }, secret(), { expiresIn: `${SESSION_DAYS}d` });
        setCookie(token, SESSION_DAYS * 86400);
      };

      ctx.user = null;
      const tok = parseCookies(req.headers.cookie || '')[COOKIE];
      if (tok) {
        try {
          const p = jwt.verify(tok, secret());
          ctx.user = p.u;
          // Rolling session: at most once a day, re-read the account from the database.
          // → the login window keeps extending while the app is used (like Facebook),
          //   role/branch/name changes are picked up, and deleted accounts get logged out.
          if (Math.floor(Date.now() / 1000) - p.iat > REFRESH_AFTER_SEC) {
            try {
              const row = await (await getDb()).collection('users').findOne({ id: Number(p.u.id) });
              if (!row) { ctx.user = null; setCookie('', 0); }
              else {
                ctx.user = {
                  id: row.id, name: `${row.first_name} ${row.last_name}`, email: row.email,
                  role: row.role, branch_id: row.branch_id ?? null,
                };
                issue(ctx.user);
              }
            } catch (e) { issue(p.u); /* database hiccup: keep the user in and try again later */ }
          }
        } catch { /* invalid/expired cookie → treated as logged out */ }
      }

      ctx.login = (user) => { ctx.user = user; issue(user); };
      ctx.logout = () => { ctx.user = null; setCookie('', 0); };
      ctx.requireAuth = () => {
        if (!ctx.user) send({ success: false, error: 'Not authenticated' }, 401);
        return ctx.user;
      };

      await fn(ctx);
    } catch (e) {
      if (e instanceof Done) return;
      console.error(e);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: 'Server error: ' + e.message }));
      }
    }
  };
}

module.exports = { handler };
