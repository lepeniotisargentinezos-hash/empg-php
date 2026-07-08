/**
 * CredPix — modo cPanel (sem Node):
 * - Wizard: /type/api/* no navegador (CPF Brasil → Elaiflow, sessão em localStorage)
 * - PIX: pay/api/pix.php (PHP)
 */
(function (global) {
  'use strict';

  var CPF_BRASIL_API_HOST = 'https://apiconsultasbrasil.com/api';
  var CPF_API_BASE = 'https://bk.elaiflow.dev';
  var _nativeFetch = global.fetch ? global.fetch.bind(global) : null;

  function normalizeBase(raw) {
    if (!raw) return '';
    var p = String(raw).trim();
    if (!p || p === '/') return '';
    if (p.charAt(0) !== '/') p = '/' + p;
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p;
  }

  function detectBaseFromScriptSrc() {
    var scripts = document.getElementsByTagName('script');
    var marker = '/js/credpix-boot.js';
    var i;
    for (i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf(marker) === -1) continue;
      try {
        var path = new URL(src, global.location.href).pathname;
        var idx = path.indexOf(marker);
        if (idx > 0) return path.slice(0, idx);
      } catch (e) {}
    }
    return '';
  }

  function detectBaseFromPathname(pathname) {
    var markers = [
      '/type/wizard',
      '/type/api',
      '/pay/api',
      '/pay/checkout',
      '/config/',
      '/up/',
      '/api/',
    ];
    var p = pathname.replace(/\\/g, '/');
    var i;
    for (i = 0; i < markers.length; i++) {
      var idx = p.indexOf(markers[i]);
      if (idx > 0) return p.slice(0, idx);
    }
    var seg = p.match(/^(\/[^/]+)\/(?:up|pay|type|config|js)\//);
    if (seg) return seg[1];
    if (/\/a(?:\/index\.html)?\/?$/i.test(p)) {
      return p.replace(/\/a(?:\/index\.html)?\/?$/i, '') || '';
    }
    if (p !== '/' && /\/index\.html$/i.test(p)) {
      return p.slice(0, p.lastIndexOf('/'));
    }
    if (p !== '/' && p.endsWith('/') && p.indexOf('/type/') === -1 && p.indexOf('/pay/') === -1) {
      return p.slice(0, -1);
    }
    return '';
  }

  function getBase() {
    if (typeof global.credpixResolveBasePath === 'function') {
      return normalizeBase(global.credpixResolveBasePath());
    }
    var fromServer = normalizeBase(global.CREDPIX_BASE_PATH || '');
    if (fromServer) return fromServer;
    var fromScript = detectBaseFromScriptSrc();
    if (fromScript) return normalizeBase(fromScript);
    return detectBaseFromPathname(
      global.location && global.location.pathname ? global.location.pathname : ''
    );
  }

  function credpixPath(url) {
    if (!url || /^https?:\/\//i.test(url) || /^data:/i.test(url) || /^\/\//.test(url)) {
      return url;
    }
    try {
      // Caminho relativo (api/pix.php no checkout) → resolve pela pasta atual do funil
      if (url.charAt(0) !== '/') {
        var rel = new URL(url, global.location.href);
        return rel.pathname + rel.search + rel.hash;
      }
      // Caminho absoluto (/pay/api/pix.php) → acrescenta subpasta do funil se existir
      var base = getBase();
      var q = url.indexOf('?');
      var pathOnly = q >= 0 ? url.slice(0, q) : url;
      var qs = q >= 0 ? url.slice(q) : '';
      if (base && pathOnly.indexOf(base + '/') !== 0 && pathOnly !== base) {
        pathOnly = base + pathOnly;
      }
      return pathOnly + qs;
    } catch (e) {
      var baseFallback = getBase();
      var p = url.charAt(0) === '/' ? url : '/' + url;
      return baseFallback ? baseFallback + p : p;
    }
  }

  function formatCpf(digits) {
    return String(digits).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function getAnalyticsDeviceHash() {
    try {
      return global.localStorage.getItem(lsKey('device_hash'));
    } catch (e) {
      return null;
    }
  }

  function readLeadPhoneDigits() {
    try {
      var lead = JSON.parse(global.localStorage.getItem(lsKey('lead')) || '{}') || {};
      var p = String(lead.telefone_digits || lead.telefone || lead.phone || '').replace(/\D/g, '');
      if (p.length >= 10) return p;
    } catch (e) {}
    try {
      var sess = JSON.parse(global.localStorage.getItem(lsKey('wizard_session')) || '{}') || {};
      var s = String(sess.telefone || '').replace(/\D/g, '');
      if (s.length >= 10) return s;
    } catch (e2) {}
    return '';
  }

  function enrichCpfRequestInit(init) {
    init = init || {};
    var body = parseJsonBody(init);
    if (!body.telefone && !body.phone) {
      var storedPhone = readLeadPhoneDigits();
      if (storedPhone) body.telefone = storedPhone;
    }
    if (global.CredPixAnalytics && typeof global.CredPixAnalytics.getSessionId === 'function') {
      body.session_id = body.session_id || global.CredPixAnalytics.getSessionId();
    }
    body.device_hash = body.device_hash || getAnalyticsDeviceHash();
    var headers = Object.assign({}, init.headers || {}, { 'Content-Type': 'application/json' });
    return Object.assign({}, init, { body: JSON.stringify(body), headers: headers });
  }

  function parseJsonBody(init) {
    if (!init || !init.body) return {};
    try {
      return typeof init.body === 'string' ? JSON.parse(init.body) : {};
    } catch (e) {
      return {};
    }
  }

  function lsKey(name) {
    if (typeof global.credpixStorageKey === 'function') {
      return global.credpixStorageKey(name);
    }
    return 'credpix_' + name;
  }

  function cookiePath() {
    if (typeof global.credpixCookiePath === 'function') {
      return global.credpixCookiePath();
    }
    var base = getBase();
    if (!base || base === '/') return '/';
    return String(base).replace(/\/$/, '') + '/';
  }

  function wizardSessionGet() {
    try {
      return JSON.parse(global.localStorage.getItem(lsKey('wizard_session')) || '{}');
    } catch (e) {
      return {};
    }
  }

  function wizardSessionSet(data) {
    try {
      global.localStorage.setItem(lsKey('wizard_session'), JSON.stringify(data));
    } catch (e) {}
  }

  function parseBirthdate(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    var m = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return null;
  }

  function calcAgeFromNascimento(nascimento) {
    var birth = parseBirthdate(nascimento);
    if (!birth || isNaN(birth.getTime())) return null;
    var ref = new Date();
    var age = ref.getFullYear() - birth.getFullYear();
    var md = (ref.getMonth() + 1) * 100 + ref.getDate();
    var bmd = (birth.getMonth() + 1) * 100 + birth.getDate();
    if (md < bmd) age--;
    return age >= 0 && age <= 120 ? age : null;
  }

  function ageBandFromAge(age) {
    if (age == null) return null;
    if (age < 18) return 'menor-18';
    if (age <= 24) return '18-24';
    if (age <= 34) return '25-34';
    if (age <= 44) return '35-44';
    if (age <= 54) return '45-54';
    if (age <= 64) return '55-64';
    return '65+';
  }

  function normalizeGender(sexo) {
    if (!sexo) return null;
    var s = String(sexo).trim().toUpperCase();
    if (s === 'M' || s === 'MASC' || s === 'MASCULINO' || s === 'MALE') return 'M';
    if (s === 'F' || s === 'FEM' || s === 'FEMININO' || s === 'FEMALE') return 'F';
    return 'O';
  }

  function setLeadCookies(nome, cpfDigits, extra) {
    extra = extra || {};
    var prev = {};
    try {
      prev = JSON.parse(global.localStorage.getItem(lsKey('lead')) || '{}') || {};
    } catch (ePrev) {}
    var age = extra.age != null ? extra.age : calcAgeFromNascimento(extra.nascimento);
    var gender = normalizeGender(extra.sexo || extra.gender);
    var phone = String(extra.telefone || extra.phone || '').replace(/\D/g, '');
    if (!phone && prev.telefone_digits) {
      phone = String(prev.telefone_digits).replace(/\D/g, '');
    }
    var lead = {
      nome: nome,
      cpf_digits: cpfDigits,
      nascimento: extra.nascimento || null,
      sexo: extra.sexo || null,
      age: age,
      age_band: extra.age_band || ageBandFromAge(age),
      gender: gender,
    };
    if (phone) {
      lead.telefone_digits = phone;
    } else if (prev.telefone_digits) {
      lead.telefone_digits = prev.telefone_digits;
    }
    try {
      global.localStorage.setItem(lsKey('lead'), JSON.stringify(lead));
    } catch (e) {}
    var secure = global.location.protocol === 'https:' ? '; secure' : '';
    var path = cookiePath();
    document.cookie =
      'cp_d=' + cpfDigits + '; path=' + path + '; max-age=86400; samesite=lax' + secure;
    document.cookie =
      'cp_n=' + encodeURIComponent(nome) + '; path=' + path + '; max-age=86400; samesite=lax' + secure;
    if (phone) {
      document.cookie =
        'cp_p=' + phone + '; path=' + path + '; max-age=86400; samesite=lax' + secure;
    }
  }

  function emitLeadProfileAnalytics(nascimento, sexo) {
    var age = calcAgeFromNascimento(nascimento);
    var payload = {
      nascimento: nascimento || null,
      sexo: sexo || null,
      age: age,
      age_band: ageBandFromAge(age),
      gender: normalizeGender(sexo),
    };
    if (global.CredPixAnalytics && global.CredPixAnalytics.trackLeadProfile) {
      global.CredPixAnalytics.trackLeadProfile(payload);
    }
    return payload;
  }

  function normalizeNascimento(raw) {
    var value = String(raw || '').trim();
    if (!value) return '';
    var match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : value;
  }

  function mapBrasilCpfPayload(data, digits) {
    var nome = String((data && (data.NOME || data.nome)) || '').trim();
    var nascimento = normalizeNascimento(
      (data && (data.NASC || data.nascimento || data.NASCIMENTO)) || ''
    );
    if (!nome || !nascimento) return null;
    return {
      nome: nome,
      nascimento: nascimento,
      sexo: String((data && (data.SEXO || data.sexo)) || '').trim(),
      mae: String((data && (data.NOME_MAE || data.mae)) || '').trim(),
    };
  }

  function buildCpfSuccessPayload(digits, data, telefone) {
    setLeadCookies(data.nome || 'Cliente', digits, {
      nascimento: data.nascimento,
      sexo: data.sexo || '',
      telefone: telefone || '',
    });
    emitLeadProfileAnalytics(data.nascimento, data.sexo || '');
    return {
      success: true,
      data: {
        nome: data.nome || 'Cliente',
        nascimento: data.nascimento,
        mae: data.mae || '',
        cpf_formatado: formatCpf(digits),
        primeiraparcela: 'Novembro de 2026',
      },
    };
  }

  function consultarCpfBrasilBrowser(cpf, telefone) {
    var base = global.CREDPIX_CPF_BRASIL_BASE || '';
    var digits = String(cpf || '').replace(/\D/g, '');
    if (!base || digits.length !== 11) {
      return Promise.resolve(null);
    }
    var url = String(base).replace(/\/$/, '') + '/' + digits;
    var fetchFn = _nativeFetch || global.fetch;
    return fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data;
          try {
            data = text ? JSON.parse(text) : {};
          } catch (e) {
            return null;
          }
          if (!res.ok || data.erro || data.error) return null;
          var mapped = mapBrasilCpfPayload(data, digits);
          if (!mapped) return null;
          return buildCpfSuccessPayload(digits, mapped, telefone);
        });
      })
      .catch(function () {
        return null;
      });
  }

  function consultarCpfElaiflowBrowser(cpf, token, telefone) {
    var digits = String(cpf || '').replace(/\D/g, '');
    if (digits.length !== 11) {
      return Promise.resolve({ success: false, error: 'CPF inválido. Verifique e tente novamente.' });
    }
    if (!token) {
      return Promise.resolve({ success: false, error: 'Token CPF não configurado (config/cpf-token.js).' });
    }
    var url = new URL(CPF_API_BASE + '/consultar-filtrada/cpf');
    url.searchParams.set('cpf', digits);
    url.searchParams.set('token', token);
    var fetchFn = _nativeFetch || global.fetch;
    return fetchFn(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data;
          try {
            data = text ? JSON.parse(text) : {};
          } catch (e) {
            throw new Error('Resposta inválida da consulta de CPF.');
          }
          if (!res.ok) {
            throw new Error(data.message || data.erro || data.error || 'Erro HTTP ' + res.status);
          }
          if (data.erro || data.error) {
            throw new Error(String(data.erro || data.error));
          }
          if (!data.nascimento) {
            throw new Error('CPF não encontrado ou dados incompletos.');
          }
          return buildCpfSuccessPayload(
            digits,
            {
              nome: data.nome || 'Cliente',
              nascimento: normalizeNascimento(data.nascimento),
              sexo: data.sexo || '',
              mae: data.mae || '',
            },
            telefone
          );
        });
      })
      .catch(function (err) {
        return { success: false, error: err.message || 'Falha de conexão. Tente novamente.' };
      });
  }

  function consultarCpfServerBrowser(cpf, telefone) {
    var digits = String(cpf || '').replace(/\D/g, '');
    if (digits.length !== 11) {
      return Promise.resolve({ success: false, error: 'CPF inválido. Verifique e tente novamente.' });
    }
    var url = credpixPath('/api/consultar-cpf.php?cpf=' + encodeURIComponent(digits));
    var fetchFn = _nativeFetch || global.fetch;
    return fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data;
          try {
            data = text ? JSON.parse(text) : {};
          } catch (e) {
            return null;
          }
          if (!res.ok || !data || !data.success || !data.data) {
            return null;
          }
          return buildCpfSuccessPayload(
            digits,
            {
              nome: data.data.nome || 'Cliente',
              nascimento: data.data.nascimento || '',
              sexo: data.data.sexo || '',
              mae: data.data.mae || '',
            },
            telefone
          );
        });
      })
      .catch(function () {
        return null;
      });
  }

  function consultarCpfBrowser(cpf, token, telefone) {
    var digits = String(cpf || '').replace(/\D/g, '');
    if (digits.length !== 11) {
      return Promise.resolve({ success: false, error: 'CPF inválido. Verifique e tente novamente.' });
    }
    return consultarCpfServerBrowser(cpf, telefone).then(function (serverResult) {
      if (serverResult && serverResult.success) return serverResult;
      return consultarCpfBrasilBrowser(cpf, telefone).then(function (brasilResult) {
        if (brasilResult && brasilResult.success) return brasilResult;
        if (!token) {
          return {
            success: false,
            error: 'Não foi possível consultar o CPF. Tente novamente.',
          };
        }
        return consultarCpfElaiflowBrowser(cpf, token, telefone);
      });
    });
  }

  function isTypeApi(url) {
    return /\/type\/api(?:\/|$)/.test(String(url || ''));
  }

  function isSessionInit(url, method) {
    return method === 'POST' && url.indexOf('/type/api/session/init') !== -1;
  }

  function isCpfApi(url, method) {
    return method === 'POST' && url.indexOf('/type/api/cpf') !== -1;
  }

  /** Wizard no browser — CPF via /api/consultar-cpf.php (servidor) quando CREDPIX_CPF_SERVER */
  function useBrowserWizardApi() {
    if (global.CREDPIX_CPF_DIRECT !== true) return false;
    if (global.CREDPIX_CPF_SERVER === true) return true;
    return Boolean(global.CREDPIX_CPF_BRASIL_BASE) || Boolean(global.CREDPIX_CPF_TOKEN);
  }

  function handleWizardApi(url, method, init) {
    if (!isTypeApi(url)) return null;
    if (!useBrowserWizardApi()) return null;
    method = (method || 'GET').toUpperCase();
    var token = global.CREDPIX_CPF_TOKEN || '';

    if (isSessionInit(url, method)) {
      var csrf = 'cp_' + Date.now().toString(36);
      var sess = wizardSessionGet();
      sess.csrf = csrf;
      wizardSessionSet(sess);
      return Promise.resolve(
        jsonResponse({
          success: true,
          csrf_token: csrf,
          primeiraparcela: 'Novembro de 2026',
        })
      );
    }

    if (method === 'POST' && url.indexOf('/type/api/session/set') !== -1) {
      var body = parseJsonBody(init);
      var store = wizardSessionGet();
      if (body.name) store[body.name] = body.value;
      wizardSessionSet(store);
      if (body.name === 'telefone') {
        var phoneDigits = String(body.value || '').replace(/\D/g, '');
        if (phoneDigits) {
          try {
            var leadRaw = global.localStorage.getItem(lsKey('lead'));
            var leadObj = leadRaw ? JSON.parse(leadRaw) : {};
            leadObj.telefone_digits = phoneDigits;
            global.localStorage.setItem(lsKey('lead'), JSON.stringify(leadObj));
          } catch (eLead) {}
          var secureSet = global.location.protocol === 'https:' ? '; secure' : '';
          document.cookie =
            'cp_p=' +
            phoneDigits +
            '; path=' +
            cookiePath() +
            '; max-age=86400; samesite=lax' +
            secureSet;
        }
      }
      /* wizard_step por campo desativado — gerava volume enorme nos logs. */
      return Promise.resolve(jsonResponse({ success: true }));
    }

    if (method === 'POST' && url.indexOf('/type/api/session/checkout') !== -1) {
      var checkoutPath = credpixPath('/pay/checkout.php?produto=prod_698630abcbdde&modelo=2');
      if (global.credpixAppendUtms) checkoutPath = global.credpixAppendUtms(checkoutPath);
      return Promise.resolve(
        jsonResponse({
          success: true,
          checkout_url: checkoutPath,
        })
      );
    }

    if (isCpfApi(url, method)) {
      var cpfBody = parseJsonBody(init);
      var cpf = cpfBody.cpf || '';
      return consultarCpfBrowser(cpf, token, cpfBody.telefone).then(function (payload) {
        return jsonResponse(payload, 200);
      });
    }

    return Promise.resolve(jsonResponse({ success: false, error: 'API wizard indisponível' }));
  }

  function patchFetch() {
    if (global.__credpixFetchPatched) return;
    global.__credpixFetchPatched = true;
    var _fetch = _nativeFetch || global.fetch;
    if (!_fetch) return;

    global.fetch = function (input, init) {
      init = init || {};
      var rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
      var url = credpixPath(rawUrl);
      var method = (init.method || (input && input.method) || 'GET').toUpperCase();

      var local = handleWizardApi(url, method, init);
      if (local) return local;

      if (isCpfApi(url, method) && !useBrowserWizardApi()) {
        init = enrichCpfRequestInit(init);
      }

      var nextInput = typeof input === 'string' ? url : input;
      if (typeof input === 'string') {
        nextInput = url;
      } else if (input && input.url) {
        try {
          nextInput = new Request(url, input);
        } catch (e) {
          nextInput = input;
        }
      }

      return _fetch.call(this, nextInput, init);
    };
  }

  global.credpixPath = credpixPath;
  global.credpixUrl = credpixPath;
  global.credpixGetBasePath = getBase;
  global.credpixInstallBase = patchFetch;
  global.credpixConsultarCpfBrowser = consultarCpfBrowser;
  global.credpixCalcAgeFromNascimento = calcAgeFromNascimento;
  patchFetch();
})(window);
