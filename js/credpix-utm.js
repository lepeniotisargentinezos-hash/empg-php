/**
 * Persiste parâmetros da URL (UTMs, src, etc.) e repassa nas navegações do funil.
 * Usa localStorage (persistente) + sessionStorage (sessão da aba).
 */
(function (global) {
  'use strict';

  /** Título do HTML antes de Amung/outros scripts alterarem document.title */
  var INITIAL_TITLE = (function () {
    if (!global.document) return '';
    var el = global.document.querySelector('title');
    return el && el.textContent ? String(el.textContent).trim() : '';
  })();

  /** src da URL no instante em que o script carrega (antes de storage / Amung). */
  var INLINE_SRC = (function () {
    if (global.CREDPIX_SRC_FROM_URL) {
      return String(global.CREDPIX_SRC_FROM_URL).trim();
    }
    try {
      var params = new URLSearchParams(
        global.location && global.location.search ? global.location.search : ''
      );
      return (params.get('src') || '').trim();
    } catch (e) {
      return '';
    }
  })();

  function storageKey() {
    if (typeof global.credpixStorageKey === 'function') {
      return global.credpixStorageKey('tracking_params');
    }
    return 'credpix_tracking_params';
  }

  function persistentKey() {
    return storageKey() + '_persistent';
  }

  function firstTouchKey() {
    return storageKey() + '_first_touch';
  }

  function pageBaseTitleKey() {
    var path = (global.location && global.location.pathname) || '';
    return storageKey() + '_page_base_' + path.toLowerCase().replace(/[^\w]+/g, '_').slice(0, 96);
  }

  function readPageBaseTitle() {
    try {
      var v = global.sessionStorage.getItem(pageBaseTitleKey());
      return v ? String(v).trim() : '';
    } catch (e) {
      return '';
    }
  }

  function persistPageBaseTitle(base) {
    if (!base || isPoisonedBaseTitle(base)) return;
    try {
      global.sessionStorage.setItem(pageBaseTitleKey(), base);
    } catch (e) {}
  }

  function readJson(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      var data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, data) {
    try {
      global.localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  }

  function readStored() {
    var merged = readJson(persistentKey(), {});
    try {
      var sess = global.sessionStorage.getItem(storageKey());
      if (sess) {
        var sData = JSON.parse(sess);
        if (sData && typeof sData === 'object') {
          var k;
          for (k in sData) {
            if (Object.prototype.hasOwnProperty.call(sData, k)) merged[k] = sData[k];
          }
        }
      }
    } catch (e2) {}
    return merged;
  }

  function writeStored(data) {
    writeJson(persistentKey(), data);
    try {
      global.sessionStorage.setItem(storageKey(), JSON.stringify(data));
    } catch (e) {}
  }

  function readFirstTouch() {
    return readJson(firstTouchKey(), {});
  }

  function captureFirstTouch(params) {
    if (!params || typeof params !== 'object') return;
    var existing = readFirstTouch();
    if (existing.captured_at) return;
    var hasSignal = params.src || params.utm_source || params.utm_campaign || params.utm_medium;
    if (!hasSignal) return;
    writeJson(firstTouchKey(), {
      captured_at: Date.now(),
      src: params.src || null,
      utm_source: params.utm_source || null,
      utm_medium: params.utm_medium || null,
      utm_campaign: params.utm_campaign || null,
      utm_content: params.utm_content || null,
    });
  }

  function readFbCookies() {
    var out = {};
    try {
      global.document.cookie.split(';').forEach(function (c) {
        var parts = c.trim().split('=');
        var name = parts[0];
        var val = parts.slice(1).join('=');
        if ((name === '_fbc' || name === '_fbp') && val && !out[name]) {
          out[name] = decodeURIComponent(val);
        }
      });
    } catch (e) {}
    return out;
  }

  function mergeParamsFromSearch(search) {
    if (!search) return {};
    var out = {};
    try {
      var params = new URLSearchParams(search.charAt(0) === '?' ? search.slice(1) : search);
      params.forEach(function (value, key) {
        if (value !== null && value !== '') out[key] = value;
      });
    } catch (e) {}
    return out;
  }

  function mergeAllFromLocation() {
    var merged = readStored();
    var fromUrl = mergeParamsFromSearch(global.location && global.location.search);
    var key;
    for (key in fromUrl) {
      if (Object.prototype.hasOwnProperty.call(fromUrl, key)) {
        merged[key] = fromUrl[key];
      }
    }
    var fb = readFbCookies();
    for (key in fb) {
      if (Object.prototype.hasOwnProperty.call(fb, key) && !merged[key]) {
        merged[key] = fb[key];
      }
    }
    captureFirstTouch(merged);
    if (Object.keys(merged).length) writeStored(merged);
    return merged;
  }

  function getTrackingParams() {
    var merged = mergeAllFromLocation();
    var ft = readFirstTouch();
    merged.first_touch_src = ft.src || null;
    merged.first_touch_utm_source = ft.utm_source || null;
    merged.first_touch_utm_medium = ft.utm_medium || null;
    merged.first_touch_utm_campaign = ft.utm_campaign || null;
    merged.first_touch_utm_content = ft.utm_content || null;
    merged.first_touch_at = ft.captured_at || null;
    return merged;
  }

  function getPassThroughParams() {
    var p = getTrackingParams();
    var out = {};
    var k;
    for (k in p) {
      if (Object.prototype.hasOwnProperty.call(p, k) && k.indexOf('first_touch_') !== 0) {
        out[k] = p[k];
      }
    }
    return out;
  }

  function appendUtms(url) {
    if (!url) return url;
    if (/^https?:\/\//i.test(url) && url.indexOf(global.location.host) === -1) {
      return url;
    }

    var params = getPassThroughParams();
    if (!Object.keys(params).length) return url;

    try {
      var base = global.location && global.location.href ? global.location.href : undefined;
      var u = new URL(url, base);
      var k;
      for (k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k) && !u.searchParams.has(k)) {
          u.searchParams.set(k, params[k]);
        }
      }
      if (/^https?:\/\//i.test(url)) return u.href;
      return u.pathname + u.search + (u.hash || '');
    } catch (e) {
      return url;
    }
  }

  function getSrc() {
    if (INLINE_SRC) return INLINE_SRC;
    var p = getTrackingParams();
    return p.src ? String(p.src).trim() : '';
  }

  function isWizardPath() {
    var path = (global.location && global.location.pathname) || '';
    return /\/type\/wizard/i.test(path);
  }

  function canonicalBaseTitle() {
    if (global.CREDPIX_BASE_PAGE_TITLE) {
      var forced = String(global.CREDPIX_BASE_PAGE_TITLE).trim();
      if (forced && !isPoisonedBaseTitle(forced)) return forced;
    }
    var meta = global.document.querySelector('meta[name="credpix-base-title"]');
    if (meta && meta.getAttribute('content')) {
      var metaTitle = String(meta.getAttribute('content')).trim();
      if (metaTitle && !isPoisonedBaseTitle(metaTitle)) return metaTitle;
    }
    return '';
  }

  function isSrcOnlyTitle(current, src) {
    if (!current || !src) return false;
    current = String(current).trim();
    src = String(src).trim();
    if (current === src) return true;
    if (current === srcSuffix(src).trim()) return true;
    return false;
  }

  function srcSuffix(src) {
    return src ? ' - ' + src : '';
  }

  function getTitleElement() {
    return global.document ? global.document.querySelector('title') : null;
  }

  function titleFromPath() {
    var path = (global.location && global.location.pathname) || '';
    if (/\/type\/wizard/i.test(path)) return 'CredPix · Wizard';
    if (/\/pay\/checkout/i.test(path)) return 'Pagamento PIX';
    if (/\/up\/(upsell|obrigado)/i.test(path)) return '';
    return 'CredPix · Empréstimo Pessoal';
  }

  function isUpsellPath() {
    var path = (global.location && global.location.pathname) || '';
    return /\/up\/(upsell|obrigado)/i.test(path);
  }

  function titleFromElement() {
    var el = getTitleElement();
    if (!el) return '';
    var text = (el.textContent || '').trim();
    var src = getSrc();
    if (!text || (src && text === src)) return '';
    if (src && text.endsWith(srcSuffix(src))) {
      text = text.slice(0, -srcSuffix(src).length).trim();
    }
    return text;
  }

  function isPoisonedBaseTitle(base) {
    if (!base) return true;
    var src = getSrc();
    if (src && base === src) return true;
    if (isUpsellPath() && base === 'CredPix · Empréstimo Pessoal') return true;
    return false;
  }

  function resolveDefaultBaseTitle() {
    if (isWizardPath()) {
      var wizardBase = canonicalBaseTitle() || titleFromPath();
      if (wizardBase) return wizardBase;
    }
    var canonical = canonicalBaseTitle();
    if (canonical) return canonical;
    var el = getTitleElement();
    if (el) {
      var stored = el.getAttribute('data-credpix-base-title');
      if (stored) {
        stored = String(stored).trim();
        if (stored && !isPoisonedBaseTitle(stored)) return stored;
      }
    }
    var meta = global.document.querySelector('meta[name="credpix-base-title"]');
    if (meta && meta.getAttribute('content')) {
      var metaTitle = String(meta.getAttribute('content')).trim();
      if (metaTitle && !isPoisonedBaseTitle(metaTitle)) return metaTitle;
    }
    var pageBase = readPageBaseTitle();
    if (pageBase && !isPoisonedBaseTitle(pageBase)) return pageBase;
    if (INITIAL_TITLE && !isPoisonedBaseTitle(INITIAL_TITLE)) return INITIAL_TITLE;
    var fromPath = titleFromPath();
    if (fromPath && !isPoisonedBaseTitle(fromPath)) return fromPath;
    return '';
  }

  function captureBaseTitle() {
    var el = getTitleElement();
    if (!el) return;

    var stored = el.getAttribute('data-credpix-base-title');
    if (stored && !isPoisonedBaseTitle(String(stored).trim())) return;
    if (stored) el.removeAttribute('data-credpix-base-title');

    var src = getSrc();
    var text = (el.textContent || global.document.title || '').trim();

    if (src && text === src) {
      text = resolveDefaultBaseTitle();
    } else if (src && text.endsWith(srcSuffix(src))) {
      text = text.slice(0, -srcSuffix(src).length).trim();
    }

    if (!text || (src && text === src)) {
      text = titleFromElement() || resolveDefaultBaseTitle();
    }

    if (text && !isPoisonedBaseTitle(text)) {
      el.setAttribute('data-credpix-base-title', text);
      persistPageBaseTitle(text);
    }
  }

  function getBaseTitle() {
    if (isWizardPath()) {
      var forced = canonicalBaseTitle() || 'CredPix · Wizard';
      if (forced && !isPoisonedBaseTitle(forced)) return forced;
    }
    var el = getTitleElement();
    var stored = el ? el.getAttribute('data-credpix-base-title') || '' : '';
    stored = stored ? String(stored).trim() : '';
    if (stored && !isPoisonedBaseTitle(stored)) return stored;
    var fromEl = titleFromElement();
    if (fromEl && !isPoisonedBaseTitle(fromEl)) return fromEl;
    var resolved = resolveDefaultBaseTitle();
    if (resolved && !isPoisonedBaseTitle(resolved)) return resolved;
    return '';
  }

  function resolveBaseForSrc() {
    if (isWizardPath()) {
      return canonicalBaseTitle() || 'CredPix · Wizard';
    }
    var base = getBaseTitle();
    if (base) return base;
    return 'CredPix';
  }

  function stripSrcSuffix(title, src) {
    if (!title || !src) return title || '';
    var suffix = srcSuffix(src);
    return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
  }

  function applySrcTitle() {
    if (!global.document) return;
    var src = getSrc();
    if (!src) return;

    captureBaseTitle();

    var suffix = srcSuffix(src);
    var base = resolveBaseForSrc();

    var desired = base + suffix;
    var current = (global.document.title || '').trim();

    if (current === desired) return;

    if (isSrcOnlyTitle(current, src) || !current) {
      global.document.title = desired;
      return;
    }

    if (current.endsWith(suffix)) {
      var stripped = stripSrcSuffix(current, src);
      if (stripped && stripped !== src) {
        base = stripped;
        desired = base + suffix;
      }
    }

    global.document.title = desired;
  }

  function installTitleObserver() {
    if (!global.MutationObserver) return;
    var el = getTitleElement();
    if (!el) return;
    var applying = false;
    new MutationObserver(function () {
      if (applying) return;
      applying = true;
      try {
        applySrcTitle();
      } finally {
        applying = false;
      }
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  /** Amung pode sobrescrever o título depois do d.js assíncrono. */
  function installTitleRetry() {
    if (!getSrc() || !global.setInterval) return;
    var ticks = 0;
    var maxTicks = 45;
    var timer = global.setInterval(function () {
      ticks += 1;
      applySrcTitle();
      if (ticks >= maxTicks) global.clearInterval(timer);
    }, 1000);
  }

  /** Reaplica quando Amung usa document.title = src sem mutar o nó <title>. */
  function installTitleGuard() {
    if (global.__credpixTitleGuardInstalled) return;
    var proto = Document.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'title');
    if (!desc || typeof desc.set !== 'function' || typeof desc.get !== 'function') return;
    global.__credpixTitleGuardInstalled = true;
    var nativeGet = desc.get;
    var nativeSet = desc.set;
    var guardLock = false;
    Object.defineProperty(proto, 'title', {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () {
        return nativeGet.call(this);
      },
      set: function (value) {
        nativeSet.call(this, value);
        if (guardLock || !getSrc()) return;
        var val = String(value || '').trim();
        var src = getSrc();
        var suffix = srcSuffix(src);
        if (!isSrcOnlyTitle(val, src) && (!suffix || !val.endsWith(suffix))) return;
        guardLock = true;
        try {
          global.setTimeout(function () {
            try {
              applySrcTitle();
            } finally {
              guardLock = false;
            }
          }, 0);
        } catch (e) {
          guardLock = false;
        }
      },
    });
  }

  function whenTitleReady(fn) {
    var attempts = 0;
    function tick() {
      attempts += 1;
      var meta = global.document.querySelector('meta[name="credpix-base-title"]');
      var hasMeta = meta && String(meta.getAttribute('content') || '').trim();
      if (titleFromElement() || hasMeta || attempts >= 60) {
        fn();
        return;
      }
      global.setTimeout(tick, 50);
    }
    tick();
  }

  function isInternalUrl(href) {
    if (!href || href.charAt(0) === '#') return false;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
    if (/^https?:\/\//i.test(href)) {
      try {
        return new URL(href).host === global.location.host;
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  function patchLinkHref(anchor) {
    if (!anchor || !anchor.getAttribute) return;
    var href = anchor.getAttribute('href');
    if (!isInternalUrl(href)) return;
    var patched = appendUtms(href);
    if (patched && patched !== href) anchor.setAttribute('href', patched);
  }

  function patchAllLinks() {
    if (!global.document || !global.document.querySelectorAll) return;
    var links = global.document.querySelectorAll('a[href]');
    var i;
    for (i = 0; i < links.length; i++) patchLinkHref(links[i]);
  }

  function installLinkInterceptor() {
    if (!global.document || !global.document.addEventListener) return;
    global.document.addEventListener(
      'click',
      function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
        var href = a.getAttribute('href');
        if (!isInternalUrl(href)) return;
        var patched = appendUtms(href);
        if (patched && patched !== href) {
          a.setAttribute('href', patched);
          if (!ev.defaultPrevented && ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
            ev.preventDefault();
            global.location.href = patched;
          }
        }
      },
      true
    );
  }

  function bootTrackingUi() {
    function initTrackingUi() {
      whenTitleReady(function () {
        captureBaseTitle();
        applySrcTitle();
        installTitleObserver();
        installTitleRetry();
        patchAllLinks();
      });
    }
    if (!global.document) return;
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', initTrackingUi);
    } else {
      initTrackingUi();
    }
    installLinkInterceptor();
  }

  mergeAllFromLocation();
  installTitleGuard();
  bootTrackingUi();
  if (getSrc()) {
    applySrcTitle();
    global.setTimeout(applySrcTitle, 0);
    global.setTimeout(applySrcTitle, 250);
    global.setTimeout(applySrcTitle, 1500);
  }
  if (global.addEventListener) {
    global.addEventListener('pageshow', function (ev) {
      if (getSrc()) applySrcTitle();
    });
  }

  global.credpixCaptureUtms = mergeAllFromLocation;
  global.credpixGetTrackingParams = getTrackingParams;
  global.credpixGetPassThroughParams = getPassThroughParams;
  global.credpixAppendUtms = appendUtms;
  global.credpixGetSrc = getSrc;
  global.credpixApplySrcTitle = applySrcTitle;
  global.credpixPatchAllLinks = patchAllLinks;

  (function loadAnalytics() {
    if (!global.document || !global.document.head) return;
    var scripts = global.document.getElementsByTagName('script');
    var i;
    for (i = 0; i < scripts.length; i++) {
      if ((scripts[i].src || '').indexOf('credpix-analytics.js') !== -1) return;
    }
    var base = '';
    if (typeof global.credpixPath === 'function') {
      base = global.credpixPath('/js/credpix-analytics.js');
    } else {
      base = (global.CREDPIX_BASE_PATH || '') + '/js/credpix-analytics.js';
    }
    var el = global.document.createElement('script');
    el.src = base;
    el.async = true;
    global.document.head.appendChild(el);
  })();
})(window);
