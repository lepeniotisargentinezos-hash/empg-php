'use strict';

const CPF_BRASIL_API_HOST = 'https://apiconsultasbrasil.com/api';
const CPF_API_BASE = 'https://bk.elaiflow.dev';
const VERONX_HOST = 'veronx.site';

function getBrasilKey() {
  return process.env.CPF_BRASIL_API_KEY || '';
}

function getToken() {
  return process.env.CPF_API_TOKEN || '';
}

function isBrasilConfigured() {
  return Boolean(getBrasilKey());
}

function isElaiflowConfigured() {
  const token = getToken();
  return Boolean(token && token !== 'SEU_TOKEN_AQUI' && token !== 'SEU_TOKEN_ELAIFLOW');
}

function useVeronxFallback() {
  return process.env.REMOTE_CPF !== '0';
}

function clientDirectEnabled() {
  return process.env.CPF_CLIENT_DIRECT !== '0';
}

function formatCpf(digits) {
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function normalizeNascimento(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : value;
}

function mapBrasilResponse(data, digits) {
  const nome = String(data.NOME || data.nome || '').trim();
  const nascimento = normalizeNascimento(data.NASC || data.nascimento || data.NASCIMENTO || '');
  if (!nome || !nascimento) return null;
  return {
    cpf: digits,
    nome,
    mae: String(data.NOME_MAE || data.mae || '').trim(),
    sexo: String(data.SEXO || data.sexo || '').trim(),
    nascimento,
  };
}

const ERROR_MESSAGES = {
  invalid_format: 'CPF inválido. Verifique e tente novamente.',
  missing_birthdate: 'CPF não encontrado ou dados incompletos.',
  missing_token: 'API de CPF não configurada (CPF_BRASIL_API_KEY / CPF_API_TOKEN).',
  network: 'Falha de conexão. Tente novamente.',
  json_parse: 'Resposta inválida da consulta de CPF.',
  http_error: 'Erro ao consultar CPF. Tente novamente.',
  api_error: 'CPF não encontrado.',
};

async function consultarCpfBrasil(cpf) {
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length !== 11) {
    return { ok: false, reason: 'invalid_format' };
  }

  const key = getBrasilKey();
  if (!key) {
    return {
      ok: false,
      reason: 'missing_token',
      message: 'Defina CPF_BRASIL_API_KEY no .env.',
    };
  }

  const url = `${CPF_BRASIL_API_HOST}/${encodeURIComponent(key)}/cpf/${encodeURIComponent(digits)}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; credpix-consulta-cpf-brasil/1.0)',
      },
      signal: AbortSignal.timeout(25000),
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, reason: 'json_parse', status: res.status, message: text.slice(0, 200) };
    }

    if (!res.ok) {
      return {
        ok: false,
        reason: 'http_error',
        status: res.status,
        message: data?.message || data?.erro || data?.error || text.slice(0, 200),
      };
    }

    if (data?.erro || data?.error) {
      return {
        ok: false,
        reason: 'api_error',
        message: String(data.erro || data.error),
      };
    }

    const mapped = mapBrasilResponse(data, digits);
    if (!mapped) {
      return { ok: false, reason: 'missing_birthdate', data };
    }

    return { ok: true, data: mapped };
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      message: err?.message || 'Timeout na consulta',
    };
  }
}

/**
 * API secundária: Elaiflow — GET, cpf só dígitos, token na query (não Bearer).
 */
async function consultarCpf(cpf) {
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length !== 11) {
    return { ok: false, reason: 'invalid_format' };
  }

  const token = getToken();
  if (!token || token === 'SEU_TOKEN_AQUI' || token === 'SEU_TOKEN_ELAIFLOW') {
    return {
      ok: false,
      reason: 'missing_token',
      message: 'Defina CPF_API_TOKEN no .env ou nas variáveis de ambiente.',
    };
  }

  const url = new URL(`${CPF_API_BASE}/consultar-filtrada/cpf`);
  url.searchParams.set('cpf', digits);
  url.searchParams.set('token', token);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; credpix-consulta-cpf/1.0)',
      },
      signal: AbortSignal.timeout(25000),
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, reason: 'json_parse', status: res.status, message: text.slice(0, 200) };
    }

    if (!res.ok) {
      return {
        ok: false,
        reason: 'http_error',
        status: res.status,
        message: data?.message || data?.erro || data?.error || text.slice(0, 200),
      };
    }

    if (data?.erro || data?.error) {
      return {
        ok: false,
        reason: 'api_error',
        message: String(data.erro || data.error),
      };
    }

    if (!data?.nascimento) {
      return { ok: false, reason: 'missing_birthdate', data };
    }

    return {
      ok: true,
      data: {
        cpf: digits,
        nome: data.nome || 'Cliente',
        mae: data.mae || '',
        sexo: data.sexo || '',
        nascimento: normalizeNascimento(data.nascimento),
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      message: err?.message || 'Timeout na consulta',
    };
  }
}

/** Formato esperado pelo wizard (/type/api/cpf) */
function toWizardResponse(result) {
  if (!result.ok) {
    const msg =
      result.message ||
      ERROR_MESSAGES[result.reason] ||
      'Não foi possível consultar o CPF.';
    return { success: false, error: msg };
  }

  const d = result.data;
  return {
    success: true,
    data: {
      nome: d.nome,
      nascimento: d.nascimento,
      sexo: d.sexo || '',
      mae: d.mae,
      cpf_formatado: formatCpf(d.cpf),
      primeiraparcela: 'Novembro de 2026',
    },
  };
}

function postVeronx(path, body, csrf, cookieHeader) {
  const https = require('https');
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve) => {
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      Accept: 'application/json',
    };
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (csrf) headers['X-CSRF-Token'] = csrf;

    const req = https.request(
      { hostname: VERONX_HOST, path, method: 'POST', headers, timeout: 25000 },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(buf);
          } catch {
            resolve({ ok: false, reason: 'json_parse' });
            return;
          }
          const setCookie = res.headers['set-cookie'];
          const cookies = setCookie
            ? setCookie.map((c) => c.split(';')[0]).join('; ')
            : cookieHeader || '';
          resolve({ ok: true, data: parsed, cookies, status: res.statusCode });
        });
      }
    );
    req.on('error', (err) => {
      resolve({ ok: false, reason: 'network', message: err?.message || '' });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, reason: 'network', message: 'Timeout na consulta' });
    });
    req.write(data);
    req.end();
  });
}

async function lookupCpfFromVeronx(cpf) {
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length !== 11) {
    return { success: false, error: ERROR_MESSAGES.invalid_format };
  }

  const init = await postVeronx('/type/api/session/init', '{}', '', '');
  if (!init.ok || !init.data?.csrf_token) {
    return {
      success: false,
      error: init.message || 'Não foi possível iniciar consulta de CPF.',
    };
  }

  const csrf = init.data.csrf_token;
  const cpfRes = await postVeronx(
    '/type/api/cpf',
    { cpf: digits, csrf_token: csrf },
    csrf,
    init.cookies
  );

  if (!cpfRes.ok) {
    return { success: false, error: ERROR_MESSAGES.network };
  }

  const payload = cpfRes.data;
  if (payload?.success && payload.data) {
    return payload;
  }
  return {
    success: false,
    error: payload?.error || 'CPF não encontrado.',
  };
}

async function lookupCpfForWizard(cpf) {
  if (isBrasilConfigured()) {
    const brasil = await consultarCpfBrasil(cpf);
    if (brasil.ok) return toWizardResponse(brasil);
    console.warn('[CPF Brasil]', brasil.reason, brasil.message || '');
  }

  if (isElaiflowConfigured()) {
    const result = await consultarCpf(cpf);
    if (result.ok) return toWizardResponse(result);
    console.warn('[CPF Elaiflow]', result.reason, result.message || '');
    if (useVeronxFallback()) return lookupCpfFromVeronx(cpf);
    return toWizardResponse(result);
  }

  if (useVeronxFallback()) {
    return lookupCpfFromVeronx(cpf);
  }

  return toWizardResponse({
    ok: false,
    reason: 'missing_token',
    message: 'Defina CPF_BRASIL_API_KEY ou CPF_API_TOKEN no .env.',
  });
}

async function consultarCpfWithFallback(cpf) {
  if (isBrasilConfigured()) {
    const brasil = await consultarCpfBrasil(cpf);
    if (brasil.ok) return brasil;
  }

  if (isElaiflowConfigured()) {
    const result = await consultarCpf(cpf);
    if (result.ok) return result;
    if (!useVeronxFallback()) return result;
  } else if (!useVeronxFallback()) {
    return {
      ok: false,
      reason: 'missing_token',
      message: 'Defina CPF_BRASIL_API_KEY ou CPF_API_TOKEN no .env.',
    };
  }

  const wizard = await lookupCpfFromVeronx(cpf);
  if (!wizard.success) {
    return {
      ok: false,
      reason: 'api_error',
      message: wizard.error || 'CPF não encontrado.',
    };
  }
  const d = wizard.data;
  const digits = String(cpf).replace(/\D/g, '');
  return {
    ok: true,
    data: {
      cpf: digits,
      nome: d.nome || 'Cliente',
      mae: d.mae || '',
      sexo: d.sexo || '',
      nascimento: d.nascimento,
    },
  };
}

module.exports = {
  CPF_BRASIL_API_HOST,
  CPF_API_BASE,
  consultarCpfBrasil,
  consultarCpf,
  consultarCpfWithFallback,
  toWizardResponse,
  lookupCpfForWizard,
  isBrasilConfigured,
  isElaiflowConfigured,
  useVeronxFallback,
  clientDirectEnabled,
  getBrasilKey,
  getToken,
};
