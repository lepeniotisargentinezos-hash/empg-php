'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const SITES_FILE = path.join(DATA_DIR, 'hub-sites.json');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const PORT   = Number(process.env.PORT) || 3001;
const SECRET = process.env.HUB_SECRET || '';
const ANUBIS_PUBLIC_KEY = process.env.ANUBIS_PUBLIC_KEY || '';
const ANUBIS_SECRET_KEY = process.env.ANUBIS_SECRET_KEY || '';

if (!SECRET) {
  console.warn('\x1b[33mWARNING: HUB_SECRET not set — hub is open to anyone!\x1b[0m');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function readSites() {
  try {
    return JSON.parse(fs.readFileSync(SITES_FILE, 'utf8'));
  } catch {
    return { sites: [] };
  }
}

function writeSites(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SITES_FILE, JSON.stringify(data, null, 2));
}

function checkAuth(req) {
  if (!SECRET) return true;
  const raw = req.headers['x-hub-token'] || '';
  if (!raw || raw.length !== SECRET.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(raw), Buffer.from(SECRET));
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function proxyRequest(site, subPath, query, method, body) {
  return new Promise((resolve, reject) => {
    let base = site.apiUrl.replace(/\/$/, '');
    const targetStr = base + subPath + (query ? '?' + query : '');
    let target;
    try { target = new URL(targetStr); } catch (e) { return reject(e); }

    const isHttps = target.protocol === 'https:';
    const mod = isHttps ? https : http;

    const headers = {
      'X-Analytics-Token': site.token || '',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'HubServer/1.0',
    };

    let bodyBuf = null;
    if (body && method !== 'GET') {
      bodyBuf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(bodyBuf.length);
    }

    const port = target.port
      ? Number(target.port)
      : (isHttps ? 443 : 80);

    const reqOpts = {
      hostname: target.hostname,
      port,
      path: target.pathname + (target.search || ''),
      method: method || 'GET',
      headers,
      timeout: 15000,
    };

    const proxyReq = mod.request(reqOpts, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        resolve({
          status: proxyRes.statusCode,
          headers: proxyRes.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    proxyReq.on('error', reject);
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      reject(new Error('Proxy timeout'));
    });

    if (bodyBuf) proxyReq.write(bodyBuf);
    proxyReq.end();
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Root redirect
  if (pathname === '/') {
    res.writeHead(302, { Location: '/hub' });
    res.end();
    return;
  }

  // SPA entry
  if (pathname === '/hub') {
    serveStatic(res, path.join(PUBLIC, 'hub.html'));
    return;
  }

  // Static assets
  if (!pathname.startsWith('/api/')) {
    const filePath = path.join(PUBLIC, pathname);
    if (filePath.startsWith(PUBLIC) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStatic(res, filePath);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // All API routes require auth
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!checkAuth(req)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // ── AnubisPay direto (sem passar pelo PHP do site) ─────────────
  function anubisRequest(method, apiPath, body) {
    return new Promise((resolve, reject) => {
      if (!ANUBIS_PUBLIC_KEY || !ANUBIS_SECRET_KEY) {
        return reject(new Error('ANUBIS_PUBLIC_KEY ou ANUBIS_SECRET_KEY não configurados no .env do hub'));
      }
      const auth = Buffer.from(ANUBIS_PUBLIC_KEY + ':' + ANUBIS_SECRET_KEY).toString('base64');
      const data = body ? JSON.stringify(body) : '';
      const headers = {
        'Authorization': 'Basic ' + auth,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      };
      if (data) headers['Content-Length'] = Buffer.byteLength(data);

      const reqOpts = {
        hostname: 'api.anubispay.com',
        path: '/v1' + apiPath,
        method,
        headers,
        timeout: 15000,
      };

      const req = https.request(reqOpts, (r) => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(raw); } catch { json = { _raw: raw }; }
          if (r.statusCode >= 400) {
            const msg = json.message || json.error || ('HTTP ' + r.statusCode);
            return reject(new Error(msg));
          }
          resolve(json);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (data) req.write(data);
      req.end();
    });
  }

  // GET /api/anubis/balance
  if (pathname === '/api/anubis/balance' && req.method === 'GET') {
    try {
      const data = await anubisRequest('GET', '/dashboard/balance');
      res.end(JSON.stringify({ ok: true, balance: data }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /api/anubis/history
  if (pathname === '/api/anubis/history' && req.method === 'GET') {
    try {
      const limit = reqUrl.searchParams.get('limit') || '20';
      const page  = reqUrl.searchParams.get('page')  || '1';
      const data  = await anubisRequest('GET', '/wallet/transactions?type=withdrawal&per_page=' + limit + '&page=' + page);
      res.end(JSON.stringify({ ok: true, history: data }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // POST /api/anubis/withdraw
  if (pathname === '/api/anubis/withdraw' && req.method === 'POST') {
    try {
      const raw  = await readBody(req);
      const body = JSON.parse(raw);
      const amountReais = parseFloat(body.amount_reais || 0);
      const amountCents = Math.round(amountReais * 100);
      if (amountCents < 100) throw new Error('Valor mínimo de saque é R$ 1,00');
      if (!body.pix_key)    throw new Error('Informe a chave PIX');
      const payload = {
        amount:       amountCents,
        pix_key:      body.pix_key,
        pix_key_type: body.pix_key_type || 'cpf',
      };
      const data = await anubisRequest('POST', '/wallet/transaction/create/withdrawal', payload);
      res.end(JSON.stringify({ ok: true, withdrawal: data }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /api/hub/sites
  if (pathname === '/api/hub/sites' && req.method === 'GET') {
    res.end(JSON.stringify(readSites()));
    return;
  }

  // POST /api/hub/sites
  if (pathname === '/api/hub/sites' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const data = JSON.parse(raw);
      if (!Array.isArray(data.sites)) throw new Error('Invalid payload');
      writeSites(data);
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /api/proxy/:siteId/*
  const proxyMatch = pathname.match(/^\/api\/proxy\/([^/]+)(\/.*)?$/);
  if (proxyMatch) {
    const siteId = decodeURIComponent(proxyMatch[1]);
    const subPath = proxyMatch[2] || '/';
    const { sites } = readSites();
    const site = sites.find(s => s.id === siteId);

    if (!site) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Site not found: ' + siteId }));
      return;
    }

    try {
      const body = req.method !== 'GET' ? await readBody(req) : null;
      const query = reqUrl.search ? reqUrl.search.slice(1) : '';
      const result = await proxyRequest(site, subPath, query, req.method, body);
      res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'Proxy error: ' + e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\x1b[32m✓ Hub Server running → http://0.0.0.0:${PORT}/hub\x1b[0m`);
  if (!SECRET) console.warn('\x1b[33m  Configure HUB_SECRET no .env antes de subir em produção!\x1b[0m');
});

server.on('error', (e) => {
  console.error('Server error:', e.message);
  process.exit(1);
});
