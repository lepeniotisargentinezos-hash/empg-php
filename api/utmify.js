'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const products = require('../config/products');

function isEnabled() {
  const token = process.env.UTMIFY_API_TOKEN || '';
  if (!token) return false;
  return (process.env.UTMIFY_ENABLED || '1') !== '0';
}

function platformName() {
  const name = (process.env.UTMIFY_PLATFORM || 'CredPix').trim();
  return name || 'CredPix';
}

function clientIp(req) {
  if (!req || !req.headers) return null;
  const raw =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.socket?.remoteAddress ||
    '';
  const ip = String(raw).split(',')[0].trim();
  return ip || null;
}

function nullable(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function tsUtc(unixSeconds) {
  return new Date((unixSeconds || Math.floor(Date.now() / 1000)) * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

function parsePaidAt(paidAt) {
  if (paidAt == null || paidAt === '') return null;
  if (typeof paidAt === 'number') {
    return paidAt > 9999999999 ? Math.floor(paidAt / 1000) : paidAt;
  }
  const ts = Date.parse(String(paidAt));
  return Number.isNaN(ts) ? null : Math.floor(ts / 1000);
}

function trackingParams(utms) {
  utms = utms || {};
  return {
    src: nullable(utms.src),
    sck: nullable(utms.sck),
    utm_source: nullable(utms.utm_source),
    utm_campaign: nullable(utms.utm_campaign),
    utm_medium: nullable(utms.utm_medium),
    utm_content: nullable(utms.utm_content),
    utm_term: nullable(utms.utm_term),
  };
}

function commission(totalCents) {
  const fixed = Math.max(0, Number(process.env.UTMIFY_GATEWAY_FEE_CENTS) || 0);
  const pct = Math.max(0, Number(process.env.UTMIFY_GATEWAY_FEE_PERCENT) || 0);
  const variable = pct > 0 ? Math.round(totalCents * (pct / 100)) : 0;
  let gatewayFee = Math.min(totalCents, fixed + variable);
  let userCommission = Math.max(0, totalCents - gatewayFee);
  if (userCommission === 0 && totalCents > 0) {
    userCommission = totalCents;
    gatewayFee = 0;
  }
  return {
    totalPriceInCents: totalCents,
    gatewayFeeInCents: gatewayFee,
    userCommissionInCents: userCommission,
  };
}

function buildPayload(orderId, status, tx) {
  const productId = String(tx.product_id || '');
  const product = products[productId];
  const amountCents = Number(tx.amount_cents) || product?.amountCents || 0;
  const productName = product?.name || productId || 'Produto';

  let createdUnix = Number(tx.created) || Math.floor(Date.now() / 1000);
  if (createdUnix > 9999999999) createdUnix = Math.floor(createdUnix / 1000);

  let approvedUnix = null;
  if (status === 'paid') {
    approvedUnix = parsePaidAt(tx.paid_at) || Math.floor(Date.now() / 1000);
  }

  const payer = tx.payer || {};
  const payload = {
    orderId,
    platform: platformName(),
    paymentMethod: 'pix',
    status,
    createdAt: tsUtc(createdUnix),
    approvedDate: approvedUnix != null ? tsUtc(approvedUnix) : null,
    refundedAt: null,
    customer: {
      name: String(payer.name || 'Cliente'),
      email: String(payer.email || 'cliente@email.com'),
      phone: String(payer.phone || '').replace(/\D/g, '') || null,
      document: String(payer.document || '').replace(/\D/g, '') || null,
      country: 'BR',
      ip: nullable(tx.client_ip),
    },
    products: [
      {
        id: productId || orderId,
        name: productName,
        planId: null,
        planName: null,
        quantity: 1,
        priceInCents: amountCents,
      },
    ],
    trackingParameters: trackingParams(tx.utms),
    commission: commission(amountCents),
  };

  if (tx.mock || process.env.UTMIFY_IS_TEST === '1') {
    payload.isTest = true;
  }

  return payload;
}

function logEntry(entry) {
  const dir = path.join(ROOT, 'data', 'utmify');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'log-' + new Date().toISOString().slice(0, 10) + '.jsonl');
  fs.appendFileSync(file, JSON.stringify({ ...entry, logged_at: new Date().toISOString() }) + '\n');
}

function send(payload) {
  if (!isEnabled()) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'disabled' });
  }

  const token = process.env.UTMIFY_API_TOKEN || '';
  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.utmify.com.br',
        path: '/api-credentials/orders',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-token': token,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 20000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            json = raw;
          }
          const result = {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            http: res.statusCode,
            orderId: payload.orderId,
            status: payload.status,
            response: json,
          };
          logEntry({ direction: 'out', payload, result });
          resolve(result);
        });
      }
    );
    req.on('error', (err) => {
      const result = { ok: false, error: err.message, orderId: payload.orderId, status: payload.status };
      logEntry({ direction: 'out', payload, result });
      resolve(result);
    });
    req.write(body);
    req.end();
  });
}

function txContext(payer, body, productId, amountCents, extra) {
  return {
    product_id: productId,
    amount_cents: amountCents,
    payer,
    utms: body.utms && typeof body.utms === 'object' ? body.utms : {},
    client_ip: extra?.client_ip || null,
    created: Date.now(),
    ...(extra || {}),
  };
}

async function notifyPixGenerated(orderId, tx) {
  if (!isEnabled()) return { ok: false, skipped: true };
  if (tx.utmify_waiting_sent) return { ok: true, skipped: true, reason: 'already_sent' };
  const result = await send(buildPayload(orderId, 'waiting_payment', tx));
  if (result.ok) {
    tx.utmify_waiting_sent = true;
    tx.utmify_waiting_at = Math.floor(Date.now() / 1000);
  }
  return result;
}

async function notifyPixPaid(orderId, tx, paidAtUnix) {
  if (!isEnabled()) return { ok: false, skipped: true };
  if (tx.utmify_paid_sent) return { ok: true, skipped: true, reason: 'already_sent' };
  if (paidAtUnix != null) tx.paid_at = paidAtUnix;
  const result = await send(buildPayload(orderId, 'paid', tx));
  if (result.ok) {
    tx.utmify_paid_sent = true;
    tx.utmify_paid_at = Math.floor(Date.now() / 1000);
  }
  return result;
}

function loadTxFile(orderId) {
  if (!orderId) return null;
  const safe = String(orderId).replace(/[^a-zA-Z0-9._-]/g, '');
  const file = path.join(ROOT, 'data', 'pix', safe + '.json');
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function orderStatus(orderId) {
  const tx = loadTxFile(orderId);
  if (!tx) {
    return { waiting_sent: false, paid_sent: false, tx_found: false };
  }
  return {
    waiting_sent: !!tx.utmify_waiting_sent,
    paid_sent: !!tx.utmify_paid_sent,
    tx_found: true,
  };
}

module.exports = {
  isEnabled,
  buildPayload,
  send,
  txContext,
  notifyPixGenerated,
  notifyPixPaid,
  clientIp,
  orderStatus,
};
