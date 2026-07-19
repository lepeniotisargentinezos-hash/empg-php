'use strict';

const https = require('https');
const crypto = require('crypto');
const products = require('../config/products');

const API_BASE = 'https://api.masterfypagamentos.com';

function getApiKey() {
  return process.env.MASTERFY_API_KEY || '';
}

function getPublicBaseUrl(req) {
  if (req) {
    const { resolvePublicOrigin } = require('./request-context');
    return resolvePublicOrigin(req);
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

function isConfigured() {
  const key = getApiKey();
  return Boolean(key && key !== 'SUA_CHAVE_DE_API');
}

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const key = getApiKey();
    if (!key) {
      return reject(new Error('MASTERFY_API_KEY não configurada'));
    }

    const data = body ? JSON.stringify(body) : '';
    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(
      {
        hostname: 'api.masterfypagamentos.com',
        path: apiPath,
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
            return reject(new Error('Resposta inválida da MasterFy'));
          }
          if (res.statusCode >= 400) {
            const detail = json.details ? JSON.stringify(json.details) : '';
            const err = new Error(
              (json.message || json.error?.message || 'Erro MasterFy') +
                (detail ? ` (${detail})` : '')
            );
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
      reject(new Error('Timeout na API MasterFy'));
    });
    if (data) req.write(data);
    req.end();
  });
}

function mapStatus(masterfyStatus) {
  if (masterfyStatus === 'PAID') return 'paid';
  if (['REFUSED', 'REFUNDED', 'CHARGEDBACK'].includes(masterfyStatus)) return 'failed';
  return 'pending';
}

function extractCopypaste(payment) {
  return payment?.data?.copypaste || payment?.data?.copyPaste || '';
}

function mainProductId() {
  const id = (process.env.MASTERFY_MAIN_PRODUCT_ID || 'prod_698630abcbdde').trim();
  return id || 'prod_698630abcbdde';
}

function isUpsellProduct(productId) {
  return productId !== mainProductId();
}

function mainProductDisplayId() {
  const fromEnv = (process.env.MASTERFY_MAIN_PRODUCT_DISPLAY_ID || '').trim();
  if (fromEnv) return fromEnv;
  if ((process.env.BASE_PATH || '').trim() === '/empa') return '6473828';
  return '';
}

function masterfyPublicName(productId, product) {
  if (isUpsellProduct(productId)) {
    return product.label || product.name || 'Produto';
  }
  const fixed = mainProductDisplayId();
  if (fixed) return `ID: ${fixed}`;
  const n = Math.floor(10000000 + Math.random() * 90000000);
  return `ID: ${n}`;
}

/**
 * @param {{ productId: string, payer: object, deviceHash?: string, utms?: object, wizardMeta?: object }} opts
 */
async function createPixPayment(opts) {
  const product = products[opts.productId];
  if (!product) {
    throw new Error('Produto não configurado: ' + opts.productId);
  }

  const payer = opts.payer || {};
  const taxId = String(payer.document || payer.taxId || '').replace(/\D/g, '');
  if (taxId.length !== 11 && taxId.length !== 14) {
    throw new Error('Documento do pagador inválido');
  }

  const baseUrl = getPublicBaseUrl(opts.req);
  const notificationUrl = (process.env.MASTERFY_NOTIFICATION_URL || '').trim() || `${baseUrl}/pay/api/webhook.php`;
  const publicName = masterfyPublicName(opts.productId, product);
  let site = opts.site || {};
  try {
    const { siteContext } = require('./request-context');
    site = { ...siteContext(opts.req), ...site };
  } catch {}
  const siteRef = String(site.site_host || site.site_id || 'site').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48) || 'site';
  const externalRef = `${siteRef}_${opts.productId}_${opts.deviceHash || 'web'}_${Date.now()}`;

  const wizardMeta = opts.wizardMeta || {};
  const sellerTaxId = (process.env.MASTERFY_SELLER_TAX_ID || '').trim();
  const sellerEmail = (process.env.MASTERFY_SELLER_EMAIL || '').trim();

  const innerMetadata = Object.assign(
    {
      provider_name: 'CredPix',
      external_code: externalRef,
      step: product.step || 'main',
      nome_produto: product.name,
      referencia_produto: product.ref || product.step || 'main',
      site_id: site.site_id || '',
      site_host: site.site_host || '',
      site_origin: site.site_origin || '',
      site: site.site_id || '',
      dominio: site.site_host || '',
      dominio_origem: site.site_origin || '',
    },
    wizardMeta
  );

  const masterfyMetadata = {
    provider: 'CredPix',
    orderId: externalRef,
    site_id: site.site_id || '',
    site_host: site.site_host || '',
    site_origin: site.site_origin || '',
    site: site.site_id || '',
    dominio: site.site_host || '',
    extra: JSON.stringify(innerMetadata),
  };
  if (sellerTaxId) masterfyMetadata.sellerTaxId = sellerTaxId;
  if (sellerEmail) masterfyMetadata.sellerEmail = sellerEmail;

  const payload = {
    amount: product.amountCents,
    currency: 'BRL',
    method: 'PIX',
    description: publicName,
    externalRef,
    payer: {
      name: payer.name || 'Cliente',
      taxId,
      email: payer.email || 'cliente@email.com',
      phone: '+55' + String(payer.phone || payer.telefone || '11999999999').replace(/\D/g, ''),
    },
    items: [
      {
        quantity: 1,
        name: publicName,
        price: product.amountCents,
        type: 'DIGITAL',
      },
    ],
    metadata: masterfyMetadata,
  };

  if (baseUrl.startsWith('https://')) {
    payload.notificationUrl = notificationUrl;
  }

  const payment = await apiRequest('POST', '/v1/payment', payload);
  const copypaste = extractCopypaste(payment);

  if (!copypaste) {
    throw new Error('PIX sem código copypaste na resposta');
  }

  return {
    payment_id: payment.id,
    external_ref: externalRef,
    status: mapStatus(payment.status),
    amount_cents: product.amountCents,
    masterfy_public_name: publicName,
    qr_code: copypaste,
    raw: payment,
  };
}

async function getPayment(paymentId) {
  return apiRequest('GET', `/v1/payment/${encodeURIComponent(paymentId)}`);
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return signatureHeader === expected;
  }
}

function parseWebhookPayload(body) {
  const status = mapStatus(body.status);
  const copypaste = extractCopypaste(body);
  return {
    payment_id: body.id,
    status,
    qr_code: copypaste,
    raw: body,
  };
}

function extractSiteMetadata(body) {
  const candidates = [
    body && body.metadata,
    body && body.data && body.data.metadata,
    body && body.payment && body.payment.metadata,
  ];
  for (const metadata of candidates) {
    if (!metadata || typeof metadata !== 'object') continue;
    if (metadata.extra && typeof metadata.extra === 'object') return normalizeSiteMetadata(metadata.extra);
    if (typeof metadata.extra === 'string' && metadata.extra) {
      try {
        const decoded = JSON.parse(metadata.extra);
        if (decoded && typeof decoded === 'object') return normalizeSiteMetadata(decoded);
      } catch {}
    }
    if (metadata.site_id || metadata.site_host || metadata.site || metadata.dominio) return normalizeSiteMetadata(metadata);
  }
  return null;
}

function normalizeSiteMetadata(metadata) {
  return {
    ...metadata,
    site_id: metadata.site_id || metadata.site || '',
    site_host: metadata.site_host || metadata.dominio || '',
    site_origin: metadata.site_origin || metadata.dominio_origem || '',
  };
}

module.exports = {
  API_BASE,
  isConfigured,
  getPublicBaseUrl,
  createPixPayment,
  getPayment,
  mapStatus,
  verifyWebhookSignature,
  parseWebhookPayload,
  extractSiteMetadata,
};
