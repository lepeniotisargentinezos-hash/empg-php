'use strict';

const https = require('https');
const crypto = require('crypto');
const products = require('../config/products');

const API_HOST = 'api.novuspagamentos.com';
const API_BASE_PATH = '/api/v2';

function getApiKey() {
  return (process.env.NOVUS_API_KEY || '').trim();
}

function getWebhookSecret() {
  return (process.env.NOVUS_WEBHOOK_SECRET || '').trim();
}

function isConfigured() {
  const key = getApiKey();
  return Boolean(key && key !== 'SUA_CHAVE_DE_API' && key !== 'SUA_NOVUS_API_KEY');
}

function uuidV4() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function apiRequest(method, apiPath, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const key = getApiKey();
    if (!key) {
      return reject(new Error('NOVUS_API_KEY não configurada'));
    }

    const data = body ? JSON.stringify(body) : '';
    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    const req = https.request(
      {
        hostname: API_HOST,
        path: API_BASE_PATH + apiPath,
        method,
        headers,
        timeout: 30000,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json;
          try {
            json = buf ? JSON.parse(buf) : {};
          } catch {
            return reject(new Error('Resposta inválida da Novus'));
          }
          if (res.statusCode >= 400) {
            const msg = json.message || json.error?.message || json.error || `Erro Novus HTTP ${res.statusCode}`;
            const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
            err.status = res.statusCode;
            err.body = json;
            return reject(err);
          }
          resolve(json);
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na API Novus'));
    });
    if (data) req.write(data);
    req.end();
  });
}

function mapStatus(status) {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'paid') return 'paid';
  if (
    ['refused', 'failed', 'canceled', 'cancelled', 'chargedback', 'chargeback',
     'expired', 'blocked', 'refunded', 'processing_error'].includes(s)
  ) {
    return 'failed';
  }
  return 'pending';
}

function extractPixCode(response) {
  const data = response?.data || response || {};
  return (
    data?.pix?.qrcode ||
    data?.pix?.qr_code ||
    data?.pix?.copyPasteCode ||
    data?.pix?.copy_paste ||
    data?.qr_code_pix ||
    data?.qrcode ||
    response?.qr_code_pix ||
    ''
  );
}

function extractPaymentId(response) {
  const data = response?.data || response || {};
  return String(data.invoice_id || data.id || response?.id || '');
}

function getPublicBaseUrl(req) {
  if (req) {
    try {
      const { resolvePublicOrigin } = require('./request-context');
      return resolvePublicOrigin(req);
    } catch {}
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

function parseCurrency(value) {
  const rawValue = String(value || '').replace(/[^\d,.]/g, '');
  const raw = rawValue.includes(',') ? rawValue.replace(/\./g, '').replace(',', '.') : rawValue;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatBrl(value) {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function firstInstallmentFromDay(dayValue) {
  const day = Number(String(dayValue || '').replace(/\D/g, ''));
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + 1);
  date.setDate(day);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return { monthYear: `${mm}/${yyyy}`, fullDate: `${dd}/${mm}/${yyyy}` };
}

function buildRecoveryMetadata(wizardMeta, payer) {
  const metadata = { nome_cliente: payer.name || 'Cliente' };
  const loanValue = parseCurrency(wizardMeta.valor_emprestimo);
  const installments = Number(String(wizardMeta.num_parcelas || '').replace(/\D/g, '')) || null;
  if (loanValue !== null) metadata.valor_emprestimo = formatBrl(loanValue);
  if (installments) metadata.num_parcelas = String(installments);
  if (loanValue !== null && installments) {
    metadata.valor_parcela = formatBrl(loanValue / installments);
    metadata.valor_total = formatBrl(loanValue);
  }
  if (wizardMeta.dia_pagamento) {
    const installmentDay = Number(String(wizardMeta.dia_pagamento).replace(/\D/g, ''));
    if (Number.isInteger(installmentDay) && installmentDay >= 1 && installmentDay <= 31) {
      metadata.dia_vencimento = String(installmentDay);
    }
    const firstInstallment = firstInstallmentFromDay(wizardMeta.dia_pagamento);
    if (firstInstallment) {
      metadata.primeira_parcela = firstInstallment.monthYear;
      metadata.primeira_parcela_data = firstInstallment.fullDate;
    }
  }
  if (wizardMeta.pix) metadata.chave_pix = String(wizardMeta.pix).slice(0, 255);
  if (wizardMeta.tipo_pix) metadata.tipo_pix = String(wizardMeta.tipo_pix);
  if (wizardMeta.metodo_pagamento) metadata.metodo_pagamento = String(wizardMeta.metodo_pagamento);
  if (wizardMeta.renda_mensal) {
    const income = parseCurrency(wizardMeta.renda_mensal);
    if (income !== null) metadata.renda_mensal = formatBrl(income);
  }
  if (wizardMeta.tipo_renda) metadata.tipo_renda = String(wizardMeta.tipo_renda);
  if (wizardMeta.telefone) metadata.telefone = String(wizardMeta.telefone).replace(/\D/g, '');
  return metadata;
}

async function createPixPayment(opts) {
  const product = products[opts.productId];
  if (!product) throw new Error('Produto não configurado: ' + opts.productId);

  const payer = opts.payer || {};
  const taxId = String(payer.document || payer.taxId || '').replace(/\D/g, '');
  if (taxId.length !== 11 && taxId.length !== 14) {
    throw new Error('Documento do pagador inválido');
  }

  const baseUrl = getPublicBaseUrl(opts.req);
  let site = opts.site || {};
  try {
    const { siteContext } = require('./request-context');
    site = { ...siteContext(opts.req), ...site };
  } catch {}
  const siteRef = String(site.site_host || site.site_id || 'site').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48) || 'site';
  const externalRef = `${siteRef}_${opts.productId}_${opts.deviceHash || 'web'}_${Date.now()}`;
  const webhookUrl = `${baseUrl}/pay/api/webhook-novus.php`;
  const mainProdId = (process.env.NOVUS_MAIN_PRODUCT_ID || process.env.MASTERFY_MAIN_PRODUCT_ID || 'prod_698630abcbdde').trim();
  const isUpsell = opts.productId !== mainProdId;
  const publicName = isUpsell ? (product.label || product.name || 'Produto') : 'Principal';

  const wizardMeta = opts.wizardMeta || {};
  const recoveryMetadata = buildRecoveryMetadata(wizardMeta, payer);

  const metadata = {
    prestador: 'CredPix',
    codigo_externo: externalRef,
    etapa: product.step || (isUpsell ? 'upsell' : 'principal'),
    nome_produto: product.name || publicName,
    referencia_produto: product.ref || product.step || opts.productId,
    site_id: site.site_id || '',
    site_host: site.site_host || '',
    site_origin: site.site_origin || '',
    site: site.site_id || '',
    dominio: site.site_host || '',
    dominio_origem: site.site_origin || '',
    ...wizardMeta,
    ...recoveryMetadata,
  };

  const payload = {
    method: 'pix',
    total_price_cents: product.amountCents,
    currency: 'BRL',
    country: 'BR',
    external_id: externalRef,
    payer: {
      name: payer.name || 'Cliente',
      cpf_cnpj: taxId,
      email: payer.email || 'cliente@email.com',
    },
    items: [{ name: publicName, unit_price: product.amountCents, quantity: 1 }],
    metadata,
  };

  if (webhookUrl.startsWith('https://')) {
    payload.postback_url = webhookUrl;
  }

  const response = await apiRequest('POST', '/invoices', payload, { idempotencyKey: uuidV4() });
  const pixCode = extractPixCode(response);
  if (!pixCode) throw new Error('Novus: PIX sem código copypaste na resposta');

  const paymentId = extractPaymentId(response);
  if (!paymentId) throw new Error('Novus: invoice_id não retornado');

  const data = response?.data || response;

  return {
    payment_id: paymentId,
    external_ref: externalRef,
    status: mapStatus(data.status),
    amount_cents: product.amountCents,
    qr_code: pixCode,
    gateway: 'novus',
    raw: response,
  };
}

async function getPayment(paymentId) {
  const res = await apiRequest('GET', `/invoices/${encodeURIComponent(paymentId)}`);
  return res.data ? Object.assign({ _raw: res }, res.data) : res;
}

/**
 * Novus: X-Webhook-Signature = HMAC-SHA256(rawBody, secret).
 * Secret = NOVUS_WEBHOOK_SECRET (global) OU NOVUS_API_KEY (per-transaction).
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) {
    return process.env.NODE_ENV !== 'production';
  }
  const secrets = [];
  const wh = getWebhookSecret();
  if (wh) secrets.push(wh);
  const api = getApiKey();
  if (api) secrets.push(api);
  if (!secrets.length) {
    return process.env.NODE_ENV !== 'production';
  }
  const candidates = [signatureHeader];
  if (signatureHeader.startsWith('sha256=')) {
    candidates.push(signatureHeader.slice(7));
  }
  for (const secret of secrets) {
    const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const b64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    for (const cand of candidates) {
      if (cand.toLowerCase() === hex) return true;
      if (cand === b64) return true;
    }
  }
  return false;
}

function parseWebhookPayload(body) {
  const data = (body && typeof body.data === 'object' && body.data) ? body.data : body;
  return {
    payment_id: String(data.invoice_id || data.id || body.invoice_id || body.id || ''),
    status: mapStatus(data.status || body.status),
    raw: body,
  };
}

function extractSiteMetadata(body) {
  const candidates = [
    body?.metadata,
    body?.data?.metadata,
    body?.invoice?.metadata,
  ];
  for (const meta of candidates) {
    if (!meta || typeof meta !== 'object') continue;
    if (meta.site_id || meta.site_host || meta.site || meta.dominio) {
      return {
        ...meta,
        site_id: meta.site_id || meta.site || '',
        site_host: meta.site_host || meta.dominio || '',
        site_origin: meta.site_origin || meta.dominio_origem || '',
      };
    }
  }
  return null;
}

function parsePaidAt(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return value > 9999999999 ? Math.floor(value / 1000) : value;
  }
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

module.exports = {
  isConfigured,
  createPixPayment,
  getPayment,
  mapStatus,
  verifyWebhookSignature,
  parseWebhookPayload,
  extractSiteMetadata,
  parsePaidAt,
};
