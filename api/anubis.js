'use strict';

const https = require('https');
const products = require('../config/products');

function getPublicKey() {
  return (process.env.ANUBIS_PUBLIC_KEY || '').trim();
}

function getSecretKey() {
  return (process.env.ANUBIS_SECRET_KEY || '').trim();
}

function isConfigured() {
  return Boolean(getPublicKey() && getSecretKey());
}

function authHeader() {
  return 'Basic ' + Buffer.from(getPublicKey() + ':' + getSecretKey()).toString('base64');
}

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      return reject(new Error('ANUBIS_PUBLIC_KEY ou ANUBIS_SECRET_KEY não configurados'));
    }
    const data = body ? JSON.stringify(body) : '';
    const headers = {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(
      {
        hostname: 'api.anubispay.com',
        path: '/v1' + apiPath,
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
            return reject(new Error('Resposta inválida da Anubis'));
          }
          if (res.statusCode >= 400) {
            console.log('[anubis] resposta erro:', JSON.stringify(json));
            const err = new Error(json.message || json.error || `Erro Anubis HTTP ${res.statusCode}`);
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
      reject(new Error('Timeout na API Anubis'));
    });
    if (data) req.write(data);
    req.end();
  });
}

function mapStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'PAID') return 'paid';
  if (['REFUSED', 'REFUNDED', 'CHARGEBACK', 'PRECHARGEBACK', 'EXPIRED', 'ERROR'].includes(s)) return 'failed';
  return 'pending';
}

function extractPixCode(response) {
  return (
    response?.data?.pix?.qr_code ||
    response?.data?.pix?.copyPasteCode ||
    response?.pix?.qr_code ||
    response?.pix?.copyPasteCode ||
    response?.pix?.qrCode ||
    response?.qrCode ||
    ''
  );
}

function extractPaymentId(response) {
  return String(response?.data?.id || response?.id || response?.Id || '');
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

async function createPixPayment(opts) {
  const product = products[opts.productId];
  if (!product) throw new Error('Produto não configurado: ' + opts.productId);

  const payer = opts.payer || {};
  const taxId = String(payer.document || payer.taxId || '').replace(/\D/g, '');
  if (taxId.length !== 11 && taxId.length !== 14) {
    throw new Error('Documento do pagador inválido');
  }

  const externalRef = `${opts.productId}_${opts.deviceHash || 'web'}_${Date.now()}`;
  const baseUrl = getPublicBaseUrl(opts.req);
  const webhookUrl = `${baseUrl}/pay/api/webhook-anubis.php`;
  const mainProdId = (process.env.ANUBIS_MAIN_PRODUCT_ID || process.env.MASTERFY_MAIN_PRODUCT_ID || 'prod_698630abcbdde').trim();
  const isUpsell = opts.productId !== mainProdId;
  const publicName = isUpsell ? (product.label || product.name || 'Produto') : 'Principal';

  const phone = String(payer.phone || payer.telefone || '11999999999').replace(/\D/g, '');

  const isHttps = webhookUrl.startsWith('https://');
  const docType = taxId.length === 14 ? 'cnpj' : 'cpf';
  let phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.startsWith('55') && phoneDigits.length > 11) {
    phoneDigits = phoneDigits.slice(2);
  }
  if (phoneDigits.length < 10) phoneDigits = '11999999999';

  const payload = {
    amount: product.amountCents,
    payment_method: 'pix',
    ...(isHttps ? { postback_url: webhookUrl } : {}),
    customer: {
      name: payer.name || 'Cliente',
      document: { type: docType, number: taxId },
      email: payer.email || 'cliente@email.com',
      phone: phoneDigits,
    },
    items: [{ title: publicName, unit_price: product.amountCents, quantity: 1 }],
    metadata: {
      provider_name: 'CredPix',
      external_code: externalRef,
      step: product.step || 'main',
    },
  };

  console.log('[anubis] payload enviado:', JSON.stringify(payload));
  const response = await apiRequest('POST', '/payment-transaction/create', payload);
  console.log('[anubis] resposta:', JSON.stringify(response));
  const pixCode = extractPixCode(response);
  if (!pixCode) throw new Error('Anubis: PIX sem código copypaste na resposta');

  const paymentId = extractPaymentId(response);
  if (!paymentId) throw new Error('Anubis: ID de transação não retornado');

  return {
    payment_id: paymentId,
    external_ref: externalRef,
    status: mapStatus(response?.data?.status || response.status || response.Status),
    amount_cents: product.amountCents,
    qr_code: pixCode,
    gateway: 'anubis',
    raw: response,
  };
}

async function getPayment(paymentId) {
  const res = await apiRequest('GET', `/payment-transaction/info/${encodeURIComponent(paymentId)}`);
  // Normaliza: retorna data se existir, senão o próprio objeto
  return res.data ? Object.assign({ _raw: res }, res.data) : res;
}

module.exports = { isConfigured, createPixPayment, getPayment, mapStatus };
