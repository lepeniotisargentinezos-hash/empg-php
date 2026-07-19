'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'analytics');
const PRESENCE_FILE = path.join(DATA_DIR, 'presence.json');
const PRESENCE_HISTORY_FILE = path.join(DATA_DIR, 'presence-history.json');
const PRESENCE_TTL_MS = 60 * 1000;
const ANALYTICS_TZ = process.env.CREDPIX_TZ || 'America/Sao_Paulo';

/** Centróides aproximados (lat, lon) para mapa ao vivo */
const COUNTRY_COORDS = {
  AD: [42.5063, 1.5218], AE: [23.4241, 53.8478], AO: [-11.2027, 17.8739], AR: [-38.4161, -63.6167],
  AT: [47.5162, 14.5501], AU: [-25.2744, 133.7751], BE: [50.5039, 4.4699], BO: [-16.2902, -63.5887],
  BR: [-14.235, -51.9253], CA: [56.1304, -106.3468], CH: [46.8182, 8.2275], CL: [-35.6751, -71.543],
  CN: [35.8617, 104.1954], CO: [-4.5709, -74.2973], CR: [9.7489, -83.7534], CZ: [49.8175, 15.473],
  DE: [51.1657, 10.4515], DK: [56.2639, 9.5018], DO: [18.7357, -70.1627], EC: [-1.8312, -78.1834],
  ES: [40.4637, -3.7492], FI: [61.9241, 25.7482], FR: [46.2276, 2.2137], GB: [55.3781, -3.436],
  GH: [7.9465, -1.0232], GR: [39.0742, 21.8243], GT: [15.7835, -90.2308], HK: [22.3193, 114.1694],
  HN: [15.2, -86.2419], ID: [-0.7893, 113.9213], IE: [53.4129, -8.2439], IL: [31.0461, 34.8516],
  IN: [20.5937, 78.9629], IT: [41.8719, 12.5674], JP: [36.2048, 138.2529], KR: [35.9078, 127.7669],
  MX: [23.6345, -102.5528], MY: [4.2105, 101.9758], MZ: [-18.6657, 35.5296], NG: [9.082, 8.6753],
  NL: [52.1326, 5.2913], NO: [60.472, 8.4689], NZ: [-40.9006, 174.886], PA: [8.538, -80.7821],
  PE: [-9.19, -75.0152], PH: [12.8797, 121.774], PL: [51.9194, 19.1451], PT: [39.3999, -8.2245],
  PY: [-23.4425, -58.4438], RO: [45.9432, 24.9668], RU: [61.524, 105.3188], SA: [23.8859, 45.0792],
  SE: [60.1282, 18.6435], SG: [1.3521, 103.8198], TR: [38.9637, 35.2433], TW: [23.6978, 120.9605],
  UA: [48.3794, 31.1656], US: [37.0902, -95.7129], UY: [-32.5228, -55.7658], VE: [6.4238, -66.5897],
  VN: [14.0583, 108.2772], ZA: [-30.5595, 22.9375], XX: [0, 0],
};

const products = require('../config/products');
const adminAuth = require('./admin-auth');
const utmify = require('./utmify');
const insights = require('./analytics-insights');
const leadProfile = require('./lead-profile');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const WEBHOOK_LOG = path.join(DATA_DIR, 'webhook-log.jsonl');
const BACKUP_MANIFEST = path.join(BACKUP_DIR, 'manifest.json');
const PIX_TX_DIR = path.join(ROOT, 'data', 'pix');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function eventSrc(ev) {
  return ev.traffic_src || ev.meta?.src || ev.utm_source || '';
}

function filterBySrc(events, srcFilter) {
  if (!srcFilter) return events;
  const needle = String(srcFilter).trim().toLowerCase();
  return events.filter((ev) => eventSrc(ev).toLowerCase() === needle);
}

function normalizeSiteFilter(siteFilter) {
  if (!siteFilter || typeof siteFilter !== 'object') return null;
  const siteId = String(siteFilter.site_id || '').trim().toLowerCase();
  const siteHost = String(siteFilter.site_host || '').trim().toLowerCase();
  if (!siteId && !siteHost) return null;
  return { site_id: siteId, site_host: siteHost };
}

function matchesSite(ev, siteFilter) {
  const filter = normalizeSiteFilter(siteFilter);
  if (!filter) return true;
  const actualId = String((ev && ev.site_id) || '').trim().toLowerCase();
  const actualHost = String((ev && ev.site_host) || '').trim().toLowerCase();
  if (!actualId && !actualHost) return process.env.ANALYTICS_INCLUDE_LEGACY_NO_SITE === '1';
  if (filter.site_id && actualId && filter.site_id === actualId) return true;
  if (filter.site_host && actualHost && filter.site_host === actualHost) return true;
  return false;
}

function listAvailableSrcs(events) {
  const map = {};
  for (const ev of events) {
    const src = eventSrc(ev);
    if (!src) continue;
    map[src] = (map[src] || 0) + 1;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([src, count]) => ({ src, count }));
}

function dedupePayments(events) {
  const seen = new Set();
  return events.filter((ev) => {
    if (ev.type !== 'payment_paid') return true;
    const id =
      ev.meta?.payment_id ||
      ev.meta?.transaction_id ||
      `${ev.session_id}_${ev.product_id}_${Math.floor(Number(ev.ts) / 60000)}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function appendWebhookLog(row) {
  ensureDir();
  const line = JSON.stringify({ ts: Date.now(), ...row }) + '\n';
  fs.appendFileSync(WEBHOOK_LOG, line, 'utf8');
}

function readWebhookLog(limit) {
  if (!fs.existsSync(WEBHOOK_LOG)) return [];
  const lines = fs.readFileSync(WEBHOOK_LOG, 'utf8').split('\n').filter(Boolean);
  return lines
    .slice(-(limit || 500))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function webhookHealth() {
  const rows = readWebhookLog(1000);
  const now = Date.now();
  const dayAgo = now - 86400000;
  let count24h = 0;
  let invalid24h = 0;
  let paid24h = 0;
  let lastAt = null;
  let lastPaidAt = null;
  let lastStatus = null;

  for (const row of rows) {
    const ts = Number(row.ts) || 0;
    if (lastAt === null || ts > lastAt) {
      lastAt = ts;
      lastStatus = row.status || null;
    }
    if (ts < dayAgo) continue;
    count24h += 1;
    if (!row.signature_valid) invalid24h += 1;
    if (row.status === 'paid') {
      paid24h += 1;
      if (lastPaidAt === null || ts > lastPaidAt) lastPaidAt = ts;
    }
  }

  const secretConfigured = Boolean(process.env.WEBHOOK_SECRET);
  return {
    secret_configured: secretConfigured,
    healthy: secretConfigured && (count24h === 0 || invalid24h === 0),
    webhooks_24h: count24h,
    invalid_signature_24h: invalid24h,
    paid_webhooks_24h: paid24h,
    last_webhook_at: lastAt,
    last_paid_at: lastPaidAt,
    last_status: lastStatus,
  };
}

function runBackup() {
  ensureDir();
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = todayKey() + '_' + new Date().toISOString().slice(11, 16).replace(':', '');
  const dest = path.join(BACKUP_DIR, stamp);
  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const file of fs.readdirSync(DATA_DIR)) {
    if (file === 'backups') continue;
    if (!/\.(jsonl|json)$/.test(file)) continue;
    fs.copyFileSync(path.join(DATA_DIR, file), path.join(dest, file));
    copied.push(file);
  }
  const manifest = {
    created_at: new Date().toISOString(),
    folder: stamp,
    files: copied,
  };
  fs.writeFileSync(BACKUP_MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

function getBackupStatus() {
  if (!fs.existsSync(BACKUP_MANIFEST)) {
    return { last_backup_at: null, files: 0, folder: null };
  }
  try {
    const m = JSON.parse(fs.readFileSync(BACKUP_MANIFEST, 'utf8'));
    return {
      last_backup_at: m.created_at || null,
      files: (m.files || []).length,
      folder: m.folder || null,
    };
  } catch {
    return { last_backup_at: null, files: 0, folder: null };
  }
}

function maybeAutoBackup() {
  const status = getBackupStatus();
  const today = todayKey();
  if (status.last_backup_at && String(status.last_backup_at).startsWith(today)) {
    return status;
  }
  return runBackup();
}

const UPSELL_PRODUCTS = {
  up1: 'prod_698630b497231',
  up2: 'prod_698630bd7f9da',
  up3: 'prod_698630c55ec79',
  up4: 'prod_698630ccf2e75',
  up5: 'prod_698630d77a0fa',
  up6: 'prod_698630dfecd3d',
  up7: 'prod_698630e72dede',
  up8: 'prod_698630eebfb78',
  up9: 'prod_698630f633cec',
  up10: 'prod_698630ff20897',
  up11: 'prod_69863107b709d',
  up12: 'prod_698631105cc74',
  up13: 'prod_6986311823cf5',
  up14: 'prod_698631218da01',
  up15: 'prod_69863128c6fb7',
  up16: 'prod_6986313159696',
  up17: 'prod_6986313997fb8',
  up18: 'prod_69863146b1a52',
  up19: 'prod_6986313fbc20c',
  up20: 'prod_6986314e1cdab',
};

function upsellReport(events) {
  const rows = {};
  for (let i = 1; i <= 20; i++) {
    rows[i] = { upsell: i, views: 0, clicks: 0, payments: 0, revenue_cents: 0 };
  }
  const productToUp = {};
  for (const [key, pid] of Object.entries(UPSELL_PRODUCTS)) {
    productToUp[pid] = parseInt(key.replace('up', ''), 10);
  }
  productToUp['prod_698630abcbdde'] = 0;

  for (const ev of events) {
    if (ev.type === 'page_view') {
      const m = String(ev.page_label || '').match(/^Upsell (\d+)$/);
      if (m) rows[parseInt(m[1], 10)].views += 1;
    }
    if (ev.type === 'upsell_click') {
      const key = ev.meta?.upsell_key || ev.meta?.upsell;
      const n = key ? parseInt(String(key).replace(/\D/g, ''), 10) : 0;
      if (rows[n]) rows[n].clicks += 1;
    }
    if (ev.type === 'payment_paid' && ev.product_id) {
      const n = productToUp[ev.product_id];
      if (n && rows[n]) {
        rows[n].payments += 1;
        rows[n].revenue_cents += Number(ev.amount_cents) || 0;
      }
    }
  }

  return Object.values(rows).map((r) => ({
    ...r,
    take_rate: r.views > 0 ? Math.round((r.payments / r.views) * 1000) / 10 : 0,
    revenue_formatted: 'R$ ' + (r.revenue_cents / 100).toFixed(2).replace('.', ','),
  }));
}

function wizardStepStats(events) {
  const labels = {
    valor_emprestimo: 'Valor do empréstimo',
    valor: 'Valor',
    finalidade: 'Finalidade',
    ocupacao: 'Ocupação',
    profissao: 'Profissão',
    renda: 'Renda',
    cpf: 'CPF',
    documento: 'CPF',
    nome: 'Nome',
    name: 'Nome',
    nascimento: 'Nascimento',
    telefone: 'Telefone',
    email: 'E-mail',
    cep: 'CEP',
    endereco: 'Endereço',
    banco: 'Banco',
    agencia: 'Agência',
    conta: 'Conta',
  };
  const canonical = [
    'valor_emprestimo', 'valor', 'finalidade', 'ocupacao', 'profissao', 'renda',
    'cpf', 'documento', 'nome', 'name', 'nascimento', 'telefone', 'email',
    'cep', 'endereco', 'banco', 'agencia', 'conta',
  ];
  const stepLabel = (step) => {
    const key = String(step || '').toLowerCase();
    if (labels[key]) return labels[key];
    const pretty = key.replace(/_/g, ' ');
    return pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : 'Etapa';
  };

  const steps = {};
  const firstTs = {};
  for (const ev of events) {
    if (ev.type !== 'wizard_step') continue;
    const name = ev.meta?.field || ev.meta?.step || 'desconhecido';
    if (!steps[name]) steps[name] = new Set();
    steps[name].add(ev.session_id);
    const ts = Number(ev.ts) || 0;
    if (!firstTs[name] || (ts > 0 && ts < firstTs[name])) firstTs[name] = ts;
  }

  const names = Object.keys(steps).sort((a, b) => {
    const ia = canonical.indexOf(String(a).toLowerCase());
    const ib = canonical.indexOf(String(b).toLowerCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return (firstTs[a] || Number.MAX_SAFE_INTEGER) - (firstTs[b] || Number.MAX_SAFE_INTEGER);
  });

  const max = Math.max(1, ...names.map((n) => steps[n].size));
  return names.map((name, idx) => {
    const sessions = steps[name].size;
    const prev = idx > 0 ? steps[names[idx - 1]].size : sessions;
    const dropoff =
      prev > 0 ? Math.round(((prev - sessions) / prev) * 1000) / 10 : 0;
    return {
      step: name,
      step_label: stepLabel(name),
      sessions,
      pct_of_top: Math.round((sessions / max) * 100),
      dropoff_from_prev: idx === 0 ? 0 : dropoff,
    };
  });
}

function statsBySrc(events) {
  const map = {};
  for (const ev of events) {
    const src = eventSrc(ev) || '(direto)';
    if (!map[src]) {
      map[src] = {
        src,
        sessions: new Set(),
        landing: new Set(),
        payments: new Set(),
        revenue_cents: 0,
      };
    }
    map[src].sessions.add(ev.session_id);
    if (ev.funnel_step === 'landing' || ev.page_label === 'Landing') {
      map[src].landing.add(ev.session_id);
    }
    if (ev.type === 'payment_paid') {
      map[src].payments.add(ev.session_id);
      map[src].revenue_cents += Number(ev.amount_cents) || 0;
    }
  }
  return Object.values(map)
    .map((row) => {
      const landing = row.landing.size;
      const paid = row.payments.size;
      return {
        src: row.src,
        sessions: row.sessions.size,
        landing,
        payments: paid,
        revenue_cents: row.revenue_cents,
        revenue_formatted: 'R$ ' + (row.revenue_cents / 100).toFixed(2).replace('.', ','),
        conversion_rate: landing > 0 ? Math.round((paid / landing) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.revenue_cents - a.revenue_cents);
}

function securityStatus() {
  return {
    analytics_secret: Boolean(process.env.ANALYTICS_SECRET),
    webhook_secret: Boolean(process.env.WEBHOOK_SECRET),
    open_admin: adminAuth.allowOpenAdmin(),
    payment_mock: process.env.PAYMENT_MOCK === '1',
    cpf_client_direct: process.env.CPF_CLIENT_DIRECT === '1',
    masterfy_configured: Boolean(process.env.MASTERFY_API_KEY && process.env.MASTERFY_API_KEY !== 'SUA_CHAVE_DE_API'),
  };
}

function verifyAuth(headerValue, queryValue) {
  return adminAuth.verifyAdminAuth(headerValue, queryValue);
}

function verifyIngestAuth(headerValue) {
  return adminAuth.verifyIngestAuth(headerValue);
}

function todayKey(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function eventsFile(dateKey) {
  return path.join(DATA_DIR, `events-${dateKey}.jsonl`);
}

function normalizePage(rawPage) {
  const page = String(rawPage || '/').split('?')[0].split('#')[0];
  return page || '/';
}

function pageLabel(page) {
  const p = normalizePage(page);
  if (/\/index\.html$/i.test(p) || p.endsWith('/a') || /\/a\/index\.html$/i.test(p)) {
    return 'Landing';
  }
  if (p.includes('/type/wizard')) return 'Wizard';
  if (p.includes('/pay/checkout')) return 'Checkout PIX';
  if (p.includes('/up/obrigado')) return 'Router Upsell';
  if (p.includes('/up/upsell/backredirect')) return 'Back Redirect';
  const upMatch = p.match(/\/up(\d+)\.html/i);
  if (upMatch) return `Upsell ${upMatch[1]}`;
  if (p.includes('/admin/')) return 'Admin';
  return p.replace(/^\/[^/]+/, '').replace(/^\//, '') || 'Início';
}

function funnelStepFromPage(page) {
  const label = pageLabel(page);
  if (label === 'Landing') return 'landing';
  if (label === 'Wizard') return 'wizard';
  if (label === 'Checkout PIX') return 'checkout';
  if (label.startsWith('Upsell')) return 'upsell';
  if (label === 'Router Upsell') return 'upsell_router';
  return null;
}

function sanitizeEvent(input) {
  const ts = Number(input.ts) || Date.now();
  const type = String(input.type || 'page_view').slice(0, 64);
  const page = normalizePage(input.page || input.path || '/');
  const productId = input.product_id ? String(input.product_id).slice(0, 64) : null;
  let amountCents = input.amount_cents != null ? Number(input.amount_cents) : null;
  if (productId && products[productId] && (amountCents == null || Number.isNaN(amountCents))) {
    amountCents = products[productId].amountCents;
  }

  return {
    ts,
    type,
    session_id: String(input.session_id || 'anon').slice(0, 64),
    browser_session_id: input.browser_session_id ? String(input.browser_session_id).slice(0, 64) : null,
    device_hash: input.device_hash ? String(input.device_hash).slice(0, 64) : null,
    site_id: input.site_id ? String(input.site_id).slice(0, 96) : null,
    site_host: input.site_host ? String(input.site_host).slice(0, 128) : null,
    site_origin: input.site_origin ? String(input.site_origin).slice(0, 255) : null,
    page,
    page_label: input.page_label || pageLabel(page),
    funnel_step: input.funnel_step || funnelStepFromPage(page),
    base_path: input.base_path ? String(input.base_path).slice(0, 32) : null,
    referrer: input.referrer ? String(input.referrer).slice(0, 512) : null,
    utm_source: input.utm_source ? String(input.utm_source).slice(0, 128) : null,
    utm_medium: input.utm_medium ? String(input.utm_medium).slice(0, 128) : null,
    utm_campaign: input.utm_campaign ? String(input.utm_campaign).slice(0, 128) : null,
    utm_content: input.utm_content ? String(input.utm_content).slice(0, 128) : null,
    traffic_src: input.traffic_src ? String(input.traffic_src).slice(0, 128) : null,
    country: input.country ? String(input.country).slice(0, 2).toUpperCase() : null,
    city: input.city ? String(input.city).slice(0, 128) : null,
    region: input.region ? String(input.region).slice(0, 128) : null,
    continent: input.continent ? String(input.continent).slice(0, 2).toUpperCase() : null,
    product_id: productId,
    product_name: productId && products[productId] ? products[productId].name : null,
    amount_cents: amountCents != null && !Number.isNaN(amountCents) ? Math.round(amountCents) : null,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
    ...leadProfile.sanitizeEventFields(leadProfile.profileFromEvent(input)),
  };
}

function clientGeoFromRequest(req) {
  if (!req || !req.headers) {
    return { country: 'XX', continent: null, city: null, region: null, source: 'unknown', header: 'CF-IPCountry' };
  }
  const h = req.headers;
  const pick = (...keys) => {
    for (const key of keys) {
      const val = h[key] || h[key.toLowerCase()];
      if (val) return String(val).trim();
    }
    return '';
  };

  const countryRaw = pick('cf-ipcountry', 'CF-IPCountry', 'x-country-code', 'x-appengine-country');
  let country = countryRaw.slice(0, 2).toUpperCase();
  if (!country || country === 'XX' || country === 'T1') country = 'XX';

  const continentRaw = pick('cf-ipcontinent', 'CF-IPContinent');
  const continent = continentRaw ? continentRaw.slice(0, 2).toUpperCase() : null;

  return {
    country,
    continent: continent || null,
    city: pick('cf-ipcity', 'CF-IPCity') || null,
    region: pick('cf-region-code', 'cf-region', 'CF-Region') || null,
    ip: pick('cf-connecting-ip', 'CF-Connecting-IP', 'true-client-ip') || null,
    cf_ray: pick('cf-ray', 'CF-RAY') || null,
    source: country !== 'XX' ? 'cloudflare' : 'unknown',
    header: 'CF-IPCountry',
  };
}

function clientCountryFromRequest(req) {
  return clientGeoFromRequest(req).country;
}

function hourKeyLocal(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ANALYTICS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}`;
}

function readPresenceHistory() {
  ensureDir();
  if (!fs.existsSync(PRESENCE_HISTORY_FILE)) return { hours: {} };
  try {
    const data = JSON.parse(fs.readFileSync(PRESENCE_HISTORY_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : { hours: {} };
  } catch {
    return { hours: {} };
  }
}

function writePresenceHistory(data) {
  ensureDir();
  fs.writeFileSync(PRESENCE_HISTORY_FILE, JSON.stringify(data), 'utf8');
}

function prunePresenceHistory(hist) {
  if (!hist.hours) hist.hours = {};
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  for (const key of Object.keys(hist.hours)) {
    const d = new Date(key.replace('T', ' ') + ':00:00');
    if (Number.isNaN(d.getTime()) || d.getTime() < cutoff) {
      delete hist.hours[key];
    }
  }
}

function recordPresenceSample(totalOnline) {
  const count = Math.max(0, Number(totalOnline) || 0);
  const hist = readPresenceHistory();
  if (!hist.hours) hist.hours = {};
  const hourKey = hourKeyLocal(new Date());
  const bucket = hist.hours[hourKey] || { sum: 0, count: 0, max: 0, min: count };
  bucket.sum += count;
  bucket.count += 1;
  bucket.max = Math.max(bucket.max, count);
  bucket.min = Math.min(bucket.min == null ? count : bucket.min, count);
  hist.hours[hourKey] = bucket;
  prunePresenceHistory(hist);
  writePresenceHistory(hist);
}

function buildPresenceHistory24h() {
  const hist = readPresenceHistory();
  const hours = hist.hours || {};
  const now = new Date();
  const result = [];
  for (let i = 23; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 60 * 60 * 1000);
    const key = hourKeyLocal(d);
    const bucket = hours[key];
    const label = new Intl.DateTimeFormat('pt-BR', {
      timeZone: ANALYTICS_TZ,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
    result.push({
      hour: key,
      label,
      avg: bucket ? Math.round((bucket.sum / bucket.count) * 10) / 10 : 0,
      max: bucket ? bucket.max : 0,
      min: bucket ? bucket.min : 0,
      samples: bucket ? bucket.count : 0,
    });
  }
  return result;
}

function liveGeoPoints(byCountry) {
  return Object.entries(byCountry || {})
    .filter(([code, count]) => count > 0 && code !== 'XX')
    .map(([country, count]) => {
      const coords = COUNTRY_COORDS[country] || COUNTRY_COORDS.XX;
      return { country, count, lat: coords[0], lon: coords[1] };
    })
    .sort((a, b) => b.count - a.count);
}

function enrichLivePresence(active) {
  const byPage = {};
  const bySrc = {};
  const byCountry = {};
  const byContinent = {};

  for (const row of Object.values(active)) {
    const pageKey = row.page_label || row.page || 'Desconhecido';
    byPage[pageKey] = (byPage[pageKey] || 0) + 1;

    const src = row.traffic_src || '(sem src)';
    bySrc[src] = (bySrc[src] || 0) + 1;

    const country = row.country || 'XX';
    byCountry[country] = (byCountry[country] || 0) + 1;

    if (row.continent) {
      const cont = String(row.continent).toUpperCase();
      byContinent[cont] = (byContinent[cont] || 0) + 1;
    }
  }

  const geo = liveGeoPoints(byCountry);
  const unknown = byCountry.XX || 0;

  return {
    total: Object.keys(active).length,
    by_page: byPage,
    by_src: bySrc,
    by_country: byCountry,
    by_continent: byContinent,
    geo,
    geo_meta: {
      provider: 'cloudflare',
      header: 'CF-IPCountry',
      mapped: geo.length,
      unknown,
    },
    history_24h: buildPresenceHistory24h(),
    sessions: active,
    updated_at: Date.now(),
    timezone: ANALYTICS_TZ,
  };
}

function appendEvent(rawEvent, ingestContext) {
  ensureDir();
  let raw = rawEvent && typeof rawEvent === 'object' ? { ...rawEvent } : {};
  const site = ingestContext && ingestContext.site;
  if (site && typeof site === 'object' && !raw.site_id && !raw.site_host) {
    raw = { ...raw, ...site };
  }
  let event = sanitizeEvent(raw);
  if (event.type === 'page_view' && pageViewExistsNear(event, 5000)) {
    return { type: event.type, skipped: true, reason: 'duplicate_page_view' };
  }
  event = insights.attachGeoToEvent(event, ingestContext);
  const line = JSON.stringify(event) + '\n';
  fs.appendFileSync(eventsFile(todayKey(new Date(event.ts))), line, 'utf8');

  if (event.type === 'heartbeat' || event.type === 'page_view') {
    const geo = (ingestContext && ingestContext.geo) || { country: ingestContext?.country || 'XX' };
    updatePresence(
      event.session_id,
      event.page,
      event.page_label,
      event.base_path,
      event.traffic_src,
      geo
    );
  }

  return event;
}

function appendEvents(events, ingestContext) {
  if (!Array.isArray(events)) return [];
  return events.map((ev) => appendEvent(ev, ingestContext));
}

function readPresence() {
  ensureDir();
  if (!fs.existsSync(PRESENCE_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(PRESENCE_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writePresence(data) {
  ensureDir();
  fs.writeFileSync(PRESENCE_FILE, JSON.stringify(data), 'utf8');
}

function updatePresence(sessionId, page, pageLabelValue, basePath, trafficSrc, geo) {
  const now = Date.now();
  const all = readPresence();
  const sid = String(sessionId);
  const prev = all[sid] || {};

  if (typeof geo === 'string') {
    geo = { country: geo };
  }
  geo = geo && typeof geo === 'object' ? geo : {};

  let incomingCountry = String(geo.country || 'XX').slice(0, 2).toUpperCase();
  if (!incomingCountry || incomingCountry === 'T1') incomingCountry = 'XX';
  const resolvedCountry = incomingCountry !== 'XX' ? incomingCountry : prev.country || 'XX';

  const incomingContinent = geo.continent ? String(geo.continent).slice(0, 2).toUpperCase() : null;
  const resolvedContinent = incomingContinent || prev.continent || null;

  all[sid] = {
    page: normalizePage(page),
    page_label: pageLabelValue || pageLabel(page),
    base_path: basePath || null,
    traffic_src: trafficSrc || prev.traffic_src || null,
    country: resolvedCountry,
    continent: resolvedContinent,
    city: geo.city || prev.city || null,
    region: geo.region || prev.region || null,
    geo_source: geo.source || prev.geo_source || null,
    last_seen: now,
  };

  const cutoff = now - PRESENCE_TTL_MS;
  for (const [key, row] of Object.entries(all)) {
    if (!row || !row.last_seen || row.last_seen < cutoff) {
      delete all[key];
    }
  }
  writePresence(all);

  const activeCount = Object.values(all).filter((row) => row && row.last_seen >= cutoff).length;
  recordPresenceSample(activeCount);
  return all;
}

function getLivePresence() {
  const now = Date.now();
  const cutoff = now - PRESENCE_TTL_MS;
  const all = readPresence();
  const active = {};

  for (const [sid, row] of Object.entries(all)) {
    if (!row || !row.last_seen || row.last_seen < cutoff) continue;
    active[sid] = row;
  }

  return enrichLivePresence(active);
}

function listEventFiles(days) {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('events-') && f.endsWith('.jsonl'));
  files.sort();
  if (!days || days <= 0) return files;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffKey = todayKey(cutoff);
  return files.filter((f) => {
    const key = f.slice('events-'.length, -'.jsonl'.length);
    return key >= cutoffKey;
  });
}

function readEventsFromFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const events = [];
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return events;
}

function pageViewExistsNear(event, windowMs) {
  if (!event || event.type !== 'page_view') return false;
  const file = eventsFile(todayKey(new Date(Number(event.ts) || Date.now())));
  if (!fs.existsSync(file)) return false;
  const ts = Number(event.ts) || Date.now();
  const sessionId = String(event.session_id || 'anon');
  const page = normalizePage(event.page || '/');
  const siteFilter = normalizeSiteFilter({ site_id: event.site_id || '', site_host: event.site_host || '' });
  for (const row of readEventsFromFile(file)) {
    if (!row || row.type !== 'page_view') continue;
    if (String(row.session_id || '') !== sessionId) continue;
    if (normalizePage(row.page || '/') !== page) continue;
    if (!matchesSite(row, siteFilter)) continue;
    const prevTs = Number(row.ts) || 0;
    if (Math.abs(ts - prevTs) <= (windowMs || 5000)) return true;
  }
  return false;
}

function readEventsForDateKey(dateKey) {
  return readEventsFromFile(eventsFile(dateKey));
}

function readEvents(days) {
  const files = listEventFiles(days);
  const events = [];
  for (const file of files) {
    events.push(...readEventsFromFile(path.join(DATA_DIR, file)));
  }
  return events;
}

function uniqueSessions(events, filterFn) {
  const set = new Set();
  for (const ev of events) {
    if (filterFn && !filterFn(ev)) continue;
    if (ev.session_id) set.add(ev.session_id);
  }
  return set.size;
}

function sumRevenue(events) {
  let total = 0;
  const byProduct = {};
  for (const ev of events) {
    if (ev.type !== 'payment_paid') continue;
    const cents = Number(ev.amount_cents) || 0;
    total += cents;
    const key = ev.product_name || ev.product_id || 'Outro';
    byProduct[key] = (byProduct[key] || 0) + cents;
  }
  return { total, byProduct };
}

function revenueTimeline(events, days) {
  const byHour = {};
  const byDay = {};
  for (const ev of events) {
    if (ev.type !== 'payment_paid') continue;
    const cents = Number(ev.amount_cents) || 0;
    const d = new Date(Number(ev.ts) || Date.now());
    const hourKey =
      String(d.getDate()).padStart(2, '0') +
      '/' +
      String(d.getMonth() + 1).padStart(2, '0') +
      ' ' +
      String(d.getHours()).padStart(2, '0') +
      'h';
    const dayKey = todayKey(d);
    byHour[hourKey] = (byHour[hourKey] || 0) + cents;
    byDay[dayKey] = (byDay[dayKey] || 0) + cents;
  }

  const hourRows = Object.entries(byHour)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(days <= 1 ? -24 : undefined)
    .map(([label, cents]) => ({
      label,
      amount_cents: cents,
      amount_formatted: 'R$ ' + (cents / 100).toFixed(2).replace('.', ','),
    }));

  const dayRows = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, cents]) => ({
      label,
      amount_cents: cents,
      amount_formatted: 'R$ ' + (cents / 100).toFixed(2).replace('.', ','),
    }));

  return { by_hour: hourRows, by_day: dayRows };
}

function funnelByBase(events) {
  const bases = {};
  function ensure(base) {
    const key = base || '/ (raiz)';
    if (!bases[key]) {
      bases[key] = {
        base_path: key,
        page_views: 0,
        landing: new Set(),
        payment_paid: new Set(),
        revenue_cents: 0,
      };
    }
    return bases[key];
  }

  for (const ev of events) {
    const row = ensure(ev.base_path);
    if (ev.type === 'page_view') {
      row.page_views += 1;
      if (ev.page_label === 'Landing' || ev.funnel_step === 'landing') {
        row.landing.add(ev.session_id);
      }
    }
    if (ev.funnel_step === 'landing') row.landing.add(ev.session_id);
    if (ev.type === 'payment_paid') {
      row.payment_paid.add(ev.session_id);
      row.revenue_cents += Number(ev.amount_cents) || 0;
    }
  }

  return Object.values(bases)
    .map((row) => {
      const landing = row.landing.size;
      const paid = row.payment_paid.size;
      return {
        base_path: row.base_path,
        page_views: row.page_views,
        landing,
        payments: paid,
        revenue_cents: row.revenue_cents,
        revenue_formatted: 'R$ ' + (row.revenue_cents / 100).toFixed(2).replace('.', ','),
        conversion_rate: landing > 0 ? Math.round((paid / landing) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.revenue_cents - a.revenue_cents);
}

function computeAlerts(events, days) {
  const alerts = [];
  const pixCount = events.filter((e) => e.type === 'pix_generated').length;
  const orders = buildOrdersList(events);
  const paidCount = orders.length;
  const revenue = sumRevenue(events).total;

  if (pixCount >= 3 && paidCount / pixCount < 0.2) {
    alerts.push({
      level: 'warning',
      message:
        'Menos de 20% dos PIX gerados viraram pedido pago (' +
        paidCount +
        ' de ' +
        pixCount +
        ').',
    });
  }

  const pending = buildPixPending(events);
  if (pending.length >= 3) {
    alerts.push({
      level: 'info',
      message: pending.length + ' PIX ainda sem confirmação de pagamento no período.',
    });
  }

  if (days === 1) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yOrders = buildOrdersList(readEventsForDateKey(todayKey(yesterday)));
    const yRev = yOrders.reduce((s, o) => s + o.amount_cents, 0);
    if (yRev > 5000 && revenue < yRev * 0.5) {
      alerts.push({ level: 'warning', message: 'Receita de pedidos hoje abaixo de 50% de ontem.' });
    }
  }

  if (!alerts.length) {
    alerts.push({
      level: 'ok',
      message: paidCount
        ? paidCount + ' pedido(s) · ' + formatBrl(revenue)
        : 'Nenhum pedido pago no período.',
    });
  }

  return alerts;
}

function exportOrdersCsv(days, options) {
  options = options || {};
  const stats = aggregateStats(days, options);
  const cols = ['datetime', 'site_id', 'site_host', 'product', 'amount', 'src', 'campaign', 'transaction_id'];
  const esc = (val) => {
    const s = val == null ? '' : String(val);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [cols.join(',')];
  for (const o of stats.orders || []) {
    lines.push(
      [
        esc(new Date(Number(o.ts) || 0).toLocaleString('pt-BR')),
        esc(o.site_id || ''),
        esc(o.site_host || ''),
        esc(o.product_name),
        esc(o.amount_formatted),
        esc(o.traffic_src),
        esc(o.utm_campaign || ''),
        esc(o.transaction_id || ''),
      ].join(',')
    );
  }
  return lines.join('\n');
}

function exportEventsCsv(days, options) {
  options = options || {};
  const siteFilter = normalizeSiteFilter(options.siteFilter || null);
  const events = readEvents(days).filter((ev) => matchesSite(ev, siteFilter));
  const cols = [
    'ts',
    'type',
    'site_id',
    'site_host',
    'site_origin',
    'session_id',
    'page',
    'page_label',
    'base_path',
    'traffic_src',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'product_name',
    'amount_cents',
  ];
  const esc = (val) => {
    const s = val == null ? '' : String(val);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [cols.join(',')];
  for (const ev of events) {
    lines.push(
      cols
        .map((c) => {
          if (c === 'ts') return esc(new Date(Number(ev.ts) || 0).toISOString());
          return esc(ev[c]);
        })
        .join(',')
    );
  }
  return lines.join('\n');
}

function formatBrl(cents) {
  return 'R$ ' + (Number(cents) / 100).toFixed(2).replace('.', ',');
}

function buildOrdersList(events, profileMaps) {
  profileMaps = profileMaps || insights.leadProfileMaps([]);
  return dedupePayments(events.filter((e) => e.type === 'payment_paid'))
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
    .map((ev, index) => ({
      order_num: index + 1,
      ts: ev.ts,
      product_name: ev.product_name || ev.product_id || 'Produto',
      product_id: ev.product_id || null,
      amount_cents: Number(ev.amount_cents) || 0,
      amount_formatted: formatBrl(Number(ev.amount_cents) || 0),
      traffic_src: eventSrc(ev) || '(direto)',
      utm_campaign: ev.utm_campaign || null,
      utm_source: ev.utm_source || null,
      utm_medium: ev.utm_medium || null,
      utm_content: ev.utm_content || null,
      session_id: ev.session_id || null,
      country: ev.country || null,
      site_id: ev.site_id || null,
      site_host: ev.site_host || null,
      site_origin: ev.site_origin || null,
      transaction_id: ev.meta?.transaction_id || ev.meta?.payment_id || null,
      utmify: utmify.orderStatus(ev.meta?.transaction_id || ev.meta?.payment_id || null),
      ...insights.resolveLeadProfile(ev, profileMaps),
    }));
}

function eventTxId(ev) {
  if (!ev) return null;
  const meta = ev.meta && typeof ev.meta === 'object' ? ev.meta : {};
  for (const key of ['transaction_id', 'payment_id', 'masterfy_id']) {
    if (meta[key]) return String(meta[key]).trim().toLowerCase();
  }
  const sid = String(ev.session_id || '');
  for (const prefix of ['pix_', 'webhook_']) {
    if (sid.startsWith(prefix)) {
      const rest = sid.slice(prefix.length).trim();
      if (rest) return rest.toLowerCase();
    }
  }
  return null;
}

function pendingFromTxStore(days, paidTxIds, srcFilter, productFilter, siteFilter) {
  if (!fs.existsSync(PIX_TX_DIR)) return [];
  const cutoffSec = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = [];
  for (const file of fs.readdirSync(PIX_TX_DIR)) {
    if (!file.endsWith('.json')) continue;
    const fname = file.slice(0, -5);
    if (fname.startsWith('mf_')) continue;
    const normId = fname.toLowerCase();
    if (paidTxIds.has(normId)) continue;
    let tx;
    try {
      tx = JSON.parse(fs.readFileSync(path.join(PIX_TX_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    if (!tx || typeof tx !== 'object') continue;
    if (!matchesSite(tx, siteFilter)) continue;
    if (String(tx.status || 'pending') !== 'pending') continue;
    let created = Number(tx.created) || 0;
    if (created > 9999999999) created = Math.floor(created / 1000);
    if (created > 0 && created < cutoffSec) continue;
    const productId = String(tx.product_id || '');
    const productCfg = productId ? products[productId] : null;
    const productName = productCfg ? productCfg.name : productId || 'PIX';
    if (productFilter && productName !== productFilter && productId !== productFilter) continue;
    const utms = tx.utms && typeof tx.utms === 'object' ? tx.utms : {};
    const src = String(utms.src || '');
    if (srcFilter && src.toLowerCase() !== String(srcFilter).trim().toLowerCase()) continue;
    const amount = Number(tx.amount_cents) || 0;
    const stat = fs.statSync(path.join(PIX_TX_DIR, file));
    const ts = created > 0 ? created * 1000 : stat.mtimeMs;
    rows.push({
      ts,
      product_name: productName,
      product_id: productId || null,
      amount_cents: amount,
      amount_formatted: formatBrl(amount),
      transaction_id: fname,
      site_id: tx.site_id || null,
      site_host: tx.site_host || null,
      site_origin: tx.site_origin || null,
      traffic_src: src || '(direto)',
      session_id: 'pix_' + fname,
      utmify: utmify.orderStatus(fname),
    });
  }
  return rows;
}

function buildPixPending(events, allEvents, days, srcFilter, productFilter, profileMaps, siteFilter) {
  const config = insights.readAlertsConfig();
  const paidSource = allEvents && allEvents.length ? allEvents : events;
  profileMaps = profileMaps || insights.leadProfileMaps(allEvents || events);
  days = days || 7;
  const paidTxIds = new Set();
  for (const ev of paidSource) {
    if (ev.type !== 'payment_paid') continue;
    const id = eventTxId(ev);
    if (id) paidTxIds.add(id);
  }
  const byId = new Map();
  for (const ev of events) {
    if (ev.type !== 'pix_generated') continue;
    if (!matchesSite(ev, siteFilter)) continue;
    const id = eventTxId(ev);
    if (!id || paidTxIds.has(id)) continue;
    const row = {
      ts: Number(ev.ts) || 0,
      product_name: ev.product_name || ev.product_id || 'PIX',
      product_id: ev.product_id || null,
      amount_cents: Number(ev.amount_cents) || 0,
      amount_formatted: formatBrl(Number(ev.amount_cents) || 0),
      transaction_id: id,
      site_id: ev.site_id || null,
      site_host: ev.site_host || null,
      site_origin: ev.site_origin || null,
      traffic_src: eventSrc(ev) || '(direto)',
      session_id: ev.session_id || 'pix_' + id,
      utmify: utmify.orderStatus(id),
      ...insights.resolveLeadProfile(ev, profileMaps),
    };
    const existing = byId.get(id);
    if (!existing || row.ts >= existing.ts) byId.set(id, row);
  }
  for (const row of pendingFromTxStore(days, paidTxIds, srcFilter || null, productFilter || null, siteFilter)) {
    const id = String(row.transaction_id || '').toLowerCase();
    if (!id || paidTxIds.has(id)) continue;
    const existing = byId.get(id);
    if (!existing || row.ts >= existing.ts) byId.set(id, row);
  }
  const rows = Array.from(byId.values())
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  return insights.enrichPixPending(rows, config.stale_pix_minutes);
}

function listProductFilters(events) {
  const map = {};
  for (const ev of events) {
    if (ev.type !== 'payment_paid') continue;
    const name = ev.product_name || ev.product_id || 'Outro';
    map[name] = (map[name] || 0) + 1;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([product, count]) => ({ product, count }));
}

function filterOrdersByProduct(orders, productFilter) {
  if (!productFilter) return orders;
  return orders.filter((o) => o.product_name === productFilter || o.product_id === productFilter);
}

function aggregateStats(days, options) {
  options = options || {};
  maybeAutoBackup();
  const siteFilter = normalizeSiteFilter(options.siteFilter || null);
  let allEvents = readEvents(days).filter((ev) => matchesSite(ev, siteFilter));
  const availableSrcs = listAvailableSrcs(allEvents);
  let events = dedupePayments(allEvents);
  if (options.src) events = filterBySrc(events, options.src);
  if (options.product) {
    events = events.filter((ev) => {
      if (ev.type === 'payment_paid' || ev.type === 'pix_generated') {
        return (ev.product_name || ev.product_id) === options.product;
      }
      return true;
    });
  }
  const pageViews = {};
  const pageUniques = {};
  const transitions = {};
  const sources = {};
  const funnel = {
    landing: new Set(),
    wizard: new Set(),
    checkout: new Set(),
    pix_generated: new Set(),
    payment_paid: new Set(),
    upsell: new Set(),
  };

  for (const ev of events) {
    if (ev.type === 'page_view') {
      const label = ev.page_label || pageLabel(ev.page);
      pageViews[label] = (pageViews[label] || 0) + 1;
      if (!pageUniques[label]) pageUniques[label] = new Set();
      pageUniques[label].add(ev.session_id);

      if (ev.referrer) {
        const from = pageLabel(ev.referrer);
        const to = label;
        const key = `${from} → ${to}`;
        transitions[key] = (transitions[key] || 0) + 1;
      }

      const src = ev.traffic_src || ev.utm_source || '(direto)';
      sources[src] = (sources[src] || 0) + 1;
    }

    if (ev.type === 'funnel_step' && ev.funnel_step && funnel[ev.funnel_step]) {
      funnel[ev.funnel_step].add(ev.session_id);
    }
    if (ev.funnel_step && funnel[ev.funnel_step]) {
      funnel[ev.funnel_step].add(ev.session_id);
    }
    if (ev.type === 'pix_generated') funnel.pix_generated.add(ev.session_id);
    if (ev.type === 'payment_paid') funnel.payment_paid.add(ev.session_id);
  }

  const revenue = sumRevenue(events);
  const profileMaps = insights.leadProfileMaps(allEvents);
  const ordersAll = buildOrdersList(events, profileMaps);
  const ordersFiltered = filterOrdersByProduct(ordersAll, options.product || null);
  const pixPending = buildPixPending(events, allEvents, days, options.src || null, options.product || null, profileMaps, siteFilter);
  const landingCount = funnel.landing.size || uniqueSessions(events, (e) => e.type === 'page_view' && e.page_label === 'Landing');
  const paidCount = ordersAll.length;
  const pixGenCount = funnel.pix_generated.size || events.filter((e) => e.type === 'pix_generated').length;

  const pageStats = Object.keys(pageViews)
    .sort((a, b) => pageViews[b] - pageViews[a])
    .map((label) => ({
      page: label,
      views: pageViews[label],
      unique: pageUniques[label] ? pageUniques[label].size : 0,
    }));

  const transitionStats = Object.entries(transitions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([flow, count]) => ({ flow, count }));

  const sourceStats = Object.entries(sources)
    .sort((a, b) => b[1] - a[1])
    .map(([source, visits]) => ({ source, visits }));

  const revenueByProduct = Object.entries(revenue.byProduct)
    .sort((a, b) => b[1] - a[1])
    .map(([product, cents]) => ({
      product,
      amount_cents: cents,
      amount_formatted: 'R$ ' + (cents / 100).toFixed(2).replace('.', ','),
    }));

  const recent = events
    .slice(-50)
    .reverse()
    .map((ev) => ({
      ts: ev.ts,
      type: ev.type,
      page_label: ev.page_label,
      product_name: ev.product_name,
      amount_cents: ev.amount_cents,
      utm_source: ev.utm_source,
      traffic_src: ev.traffic_src,
    }));

  const timeline = revenueTimeline(events, days);
  const funnelCompare = funnelByBase(events);
  const funnelCounts = {
    landing: funnel.landing.size,
    wizard: funnel.wizard.size,
    checkout: funnel.checkout.size,
    pix_generated: funnel.pix_generated.size,
    payment_paid: funnel.payment_paid.size,
  };
  const geoMap = insights.buildSessionGeoMap(allEvents);
  const live = getLivePresence();
  const adSpend = insights.readAdSpend();
  const campaignsBase = statsBySrc(events);
  const ordersWithFailedUtmify = ordersAll.filter(
    (o) => utmify.isEnabled() && o.utmify && (!o.utmify.paid_sent || !o.utmify.waiting_sent)
  ).length;
  const alerts = insights.computeEnhancedAlerts(events, days, {
    baseAlertsFn: computeAlerts,
    config: insights.readAlertsConfig(),
    timezone: ANALYTICS_TZ,
    pixPending,
    webhookHealth: webhookHealth(),
    utmifyEnabled: utmify.isEnabled(),
    ordersWithFailedUtmify,
  });
  const wizardSteps = wizardStepStats(events);

  return {
    period_days: days,
    filter_src: options.src || null,
    filter_product: options.product || null,
    available_srcs: availableSrcs,
    available_products: listProductFilters(events),
    totals: {
      events: events.length,
      page_views: events.filter((e) => e.type === 'page_view').length,
      unique_sessions: uniqueSessions(events),
      pix_generated: pixGenCount,
      pix_pending: pixPending.length,
      payments: paidCount,
      revenue_cents: revenue.total,
      revenue_formatted: formatBrl(revenue.total),
      avg_ticket_cents: paidCount ? Math.round(revenue.total / paidCount) : 0,
      avg_ticket_formatted: paidCount ? formatBrl(Math.round(revenue.total / paidCount)) : 'R$ 0,00',
      pix_to_paid_rate: pixGenCount > 0 ? Math.round((paidCount / pixGenCount) * 1000) / 10 : 0,
      conversion_rate: landingCount > 0 ? Math.round((paidCount / landingCount) * 1000) / 10 : 0,
    },
    filter_site_id: siteFilter && siteFilter.site_id,
    filter_site_host: siteFilter && siteFilter.site_host,
    orders: ordersFiltered,
    pix_pending: pixPending,
    funnel: {
      ...funnelCounts,
      upsell: funnel.upsell.size,
      dropoff: insights.buildFunnelDropoff(funnelCounts, wizardSteps),
    },
    conversion_times: insights.computeConversionTimes(events),
    period_compare: insights.computePeriodCompare(days, readEvents, options, null),
    revenue_by_state: insights.revenueByState(events, geoMap),
    top_cities: insights.topCities(events, live, geoMap),
    utm_breakdown: insights.statsByUtm(events),
    demographics: insights.computeDemographics(events, ordersAll),
    transition_sankey: insights.buildTransitionSankey(transitionStats),
    hourly_activity: insights.hourlyActivity(events, ANALYTICS_TZ),
    ad_spend: adSpend,
    pages: pageStats,
    transitions: transitionStats,
    sources: sourceStats,
    revenue_by_product: revenueByProduct,
    revenue_timeline: timeline,
    funnel_by_base: funnelCompare,
    alerts,
    wizard_steps: wizardSteps,
    upsell_report: upsellReport(events),
    campaigns: insights.campaignsWithRoas(campaignsBase, adSpend),
    backup: getBackupStatus(),
    recent,
    live,
    system: insights.buildSystemStatus({
      events: allEvents,
      live,
      backup: getBackupStatus(),
      webhookHealth: webhookHealth(),
      utmifyEnabled: utmify.isEnabled(),
      cloudflareGeoHint: { ok: true, header: 'CF-IPCountry' },
      readWebhookLog,
    }),
    webhooks_recent: readWebhookLog(20),
    utmify: { enabled: utmify.isEnabled() },
  };
}

function getSessionJourney(sessionId, days) {
  return insights.getSessionJourney(sessionId, readEvents, days || 7);
}

function logPaymentFromWebhook(paymentId, status, txData, signatureValid) {
  appendWebhookLog({
    payment_id: paymentId,
    status,
    signature_valid: signatureValid !== false,
    ok: true,
  });
  if (status !== 'paid') return null;
  return appendEvent({
    type: 'payment_paid',
    ts: Date.now(),
    session_id: 'webhook_' + paymentId,
    browser_session_id: txData && txData.browser_session_id,
    device_hash: txData && txData.device_hash,
    base_path: txData && txData.base_path,
    site_id: txData && txData.site_id,
    site_host: txData && txData.site_host,
    site_origin: txData && txData.site_origin,
    product_id: txData && txData.product_id,
    amount_cents: txData && txData.amount_cents,
    meta: { payment_id: paymentId, source: 'webhook' },
  });
}

module.exports = {
  DATA_DIR,
  verifyAuth,
  verifyIngestAuth,
  clientCountryFromRequest,
  clientGeoFromRequest,
  appendEvent,
  appendEvents,
  appendWebhookLog,
  readWebhookLog,
  getLivePresence,
  aggregateStats,
  getSessionJourney,
  exportEventsCsv,
  exportOrdersCsv,
  runBackup,
  getBackupStatus,
  webhookHealth,
  logPaymentFromWebhook,
  pageLabel,
  sanitizeEvent,
  readAdSpend: insights.readAdSpend,
  saveAdSpend: insights.saveAdSpend,
  readAlertsConfig: insights.readAlertsConfig,
  saveAlertsConfig: insights.saveAlertsConfig,
};
