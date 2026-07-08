'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const ROUTE_MARKERS = [
  '/type/wizard',
  '/type/api',
  '/pay/api/pix.php',
  '/pay/api/webhook.php',
  '/pay/checkout.php',
  '/config/site-base.js',
  '/config/google-pixels.json',
  '/api/google-pixels.json',
  '/api/consultar-cpf.php',
  '/api/consultar-cpf',
];

function normalizeBasePath(raw) {
  if (!raw) return '';
  let p = String(raw).trim();
  if (!p || p === '/') return '';
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** Domínio público a partir da requisição (Host, HTTPS, proxy). */
function resolvePublicOrigin(req) {
  const headers = (req && req.headers) || {};
  let proto = 'http';
  const xfProto = headers['x-forwarded-proto'];
  if (xfProto) {
    proto = String(xfProto).split(',')[0].trim().toLowerCase();
  } else if (req && req.socket && req.socket.encrypted) {
    proto = 'https';
  }

  const host =
    (headers['x-forwarded-host'] && String(headers['x-forwarded-host']).split(',')[0].trim()) ||
    headers.host;

  if (!host) {
    return `http://localhost:${process.env.PORT || 3000}`;
  }

  return `${proto}://${host}`.replace(/\/$/, '');
}

/** Subpasta do funil (ex. /funil) quando não está na raiz do domínio. */
function detectBasePath(pathname) {
  const env = normalizeBasePath(process.env.BASE_PATH || '');
  if (env) return env;

  for (const marker of ROUTE_MARKERS) {
    const idx = pathname.indexOf(marker);
    if (idx > 0) return pathname.slice(0, idx);
  }

  const fromA = pathname.match(/^(.*)\/a\/?(?:index\.html)?$/);
  if (fromA && fromA[1]) return fromA[1];

  const fromIndex = pathname.match(/^(.*)\/index\.html$/);
  if (fromIndex && fromIndex[1] && fromIndex[1].indexOf('/type/') === -1) {
    return fromIndex[1];
  }

  const INTERNAL_PREFIXES = ['/type/', '/pay/', '/up/', '/admin/', '/api/', '/js/', '/css/', '/config/', '/images/', '/a/'];
  const isInternal = (p) => INTERNAL_PREFIXES.some((prefix) => p.startsWith(prefix));

  const rel = pathname.replace(/^\//, '').replace(/\/$/, '');
  if (rel && !rel.includes('.') && !isInternal(pathname)) {
    const indexPath = path.join(ROOT, rel, 'index.html');
    if (fs.existsSync(indexPath)) {
      return '/' + rel;
    }
    if (fs.existsSync(path.join(ROOT, 'index.html'))) {
      return '/' + rel;
    }
  }

  if (pathname !== '/' && pathname.endsWith('/') && !isInternal(pathname)) {
    const folder = pathname.slice(0, -1);
    if (folder && fs.existsSync(path.join(ROOT, 'index.html'))) {
      return folder;
    }
  }

  return '';
}

function stripBasePath(pathname, basePath) {
  const base = normalizeBasePath(basePath);
  if (!base) return pathname;
  if (pathname === base) return '/';
  if (pathname.startsWith(base + '/')) {
    return pathname.slice(base.length) || '/';
  }
  return pathname;
}

function withBasePath(pathname, basePath) {
  const base = normalizeBasePath(basePath);
  if (!base) return pathname;
  const p = pathname.startsWith('/') ? pathname : '/' + pathname;
  return base + p;
}

module.exports = {
  normalizeBasePath,
  resolvePublicOrigin,
  detectBasePath,
  stripBasePath,
  withBasePath,
};
