/**
 * Contador de visitas (waust.at / amung) — funil CredPix.
 * Padrão: emnads233310 | Checkout: emnads233311 | Upsells: emnads233312
 *
 * d.js do Amung exige script inline dentro de um nó no body (parentNode);
 * injetar só no <head> causa: Cannot read properties of null (reading 'parentNode').
 */
(function (global) {
  'use strict';

  try {
    if (global.location && /(?:\?|&)debug_amung=1(?:&|$)/.test(global.location.search || '')) {
      global.CREDPIX_AMUNG_DEBUG = true;
    }
  } catch (e) {}

  function envCode(key, fallback) {
    if (global[key]) {
      var v = String(global[key]).trim();
      if (v) return v;
    }
    return fallback;
  }

  var DEFAULT_CODE = envCode('CREDPIX_AMUNG_FUNIL', 'emnads233310');
  var CHECKOUT_CODE = envCode('CREDPIX_AMUNG_CHECKOUT', 'emnads233311');
  var UPSELL_CODE = envCode('CREDPIX_AMUNG_UPSELL', 'emnads233312');

  function isUpsellPath(path) {
    return (
      /\/up\/upsell\//i.test(path) ||
      /\/up\/obrigado/i.test(path) ||
      /\/up\/upsell\/backredirect/i.test(path) ||
      /\/up\d+\.html/i.test(path)
    );
  }

  function resolveCode() {
    if (global.CREDPIX_VIEW_COUNTER_CODE) {
      return String(global.CREDPIX_VIEW_COUNTER_CODE).trim();
    }
    var path = (global.location && global.location.pathname) || '';
    if (isUpsellPath(path)) {
      return UPSELL_CODE;
    }
    if (/\/pay\/checkout/i.test(path)) {
      return CHECKOUT_CODE;
    }
    return DEFAULT_CODE;
  }

  function loadViewCounter(code) {
    code = String(code || resolveCode() || DEFAULT_CODE).trim();
    if (!code) return false;

    var scriptId = '_wau_dyn_' + code.replace(/\W/g, '');
    if (document.getElementById(scriptId)) return true;

    var parent = document.body || document.documentElement;
    if (!parent) return false;

    var wrap = document.createElement('div');
    wrap.id = 'credpix-amung-' + scriptId;
    wrap.style.cssText =
      'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    wrap.setAttribute('aria-hidden', 'true');

    var inline = document.createElement('script');
    inline.id = scriptId;
    inline.textContent =
      'var _wau = _wau || []; _wau.push(["dynamic", "' +
      code.replace(/\\/g, '').replace(/"/g, '') +
      '", "2ha", "c4302bffffff", "small"]);';

    var external = document.createElement('script');
    external.async = true;
    external.src = 'https://waust.at/d.js';

    wrap.appendChild(inline);
    wrap.appendChild(external);
    parent.appendChild(wrap);
    return true;
  }

  function boot() {
    var attempts = 0;
    var maxAttempts = 240;

    function run() {
      attempts += 1;
      if (loadViewCounter()) {
        if (global.CREDPIX_AMUNG_DEBUG) {
          console.info('[CredPix Amung] Contador ativo:', resolveCode());
        }
        return;
      }
      if (attempts < maxAttempts) global.setTimeout(run, 50);
      else if (global.CREDPIX_AMUNG_DEBUG) {
        console.warn('[CredPix Amung] Falha ao injetar (sem body ou código vazio).');
      }
    }

    function start() {
      if (document.body) run();
      else global.setTimeout(start, 25);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
    global.addEventListener('load', function () {
      loadViewCounter();
    });
  }

  boot();

  global.credpixLoadViewCounter = loadViewCounter;
})(window);
