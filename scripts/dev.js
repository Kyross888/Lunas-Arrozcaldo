// ============================================================
//  scripts/dev.js — tiny local server that mimics Vercel (rewrites + /api functions)
//    npm run dev     → http://localhost:3000
//  Needs MONGODB_URI and JWT_SECRET (put them in .env.local).
// ============================================================
const fs = require('fs');
const path = require('path');
const http = require('http');

// minimal .env.local loader
for (const f of ['.env.local', '.env']) {
  const p = path.join(__dirname, '..', f);
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const rewrites = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).rewrites;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };

function resolve(url) {
  const u = new URL(url, 'http://x');
  for (const r of rewrites) {
    if (r.source !== u.pathname) continue;
    if (r.has && !r.has.every((h) => h.type !== 'query' || u.searchParams.has(h.key))) continue;
    return r.destination;
  }
  return u.pathname;
}

http.createServer((req, res) => {
  const dest = resolve(req.url);
  if (dest.startsWith('/api/')) {
    try { return require(path.join(root, dest + '.js'))(req, res); }
    catch (e) { console.error(e); res.statusCode = 500; return res.end(String(e)); }
  }
  const file = path.join(pub, path.normalize(dest));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log('Luna\'s POS dev server on http://localhost:' + (process.env.PORT || 3000)));
