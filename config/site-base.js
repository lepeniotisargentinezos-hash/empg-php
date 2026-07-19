/**
 * Base do funil — detecta a pasta e isola /empa de /empa2 (mesmo domínio).
 *
 * Opcional (antes deste script):
 *   <script>window.CREDPIX_BASE_PATH='/empa2';</script>
 * Ou .env + config/site-base.php (BASE_PATH=/empa2)
 */
(function (win) {
  'use strict';

  var LOCK_PREFIX = 'credpix_locked_base:';
  var TIKTOK_BASE = win.CREDPIX_TIKTOK_BASE || '/empa2';
  var GOOGLE_BASE = win.CREDPIX_GOOGLE_BASE || '/empa';

  /**
   * TikTok (ttclid) → funil empa2. Google fica em /empa.
   * Troca só o prefixo /empa → /empa2 na mesma etapa (wizard, checkout, upsell…).
   */
  function hasTtclid() {
    try {
      var q = new URLSearchParams(win.location.search || '');
      if (q.get('ttclid')) return true;
    } catch (e) {
      if ((win.location.search || '').indexOf('ttclid=') !== -1) return true;
    }
    try {
      var i, key, raw, data;
      for (i = 0; i < win.sessionStorage.length; i++) {
        key = win.sessionStorage.key(i);
        if (!key) continue;
        if (
          key.indexOf('tracking_params') === -1 &&
          key !== 'credpix_tracking_params'
        ) {
          continue;
        }
        raw = win.sessionStorage.getItem(key);
        if (!raw) continue;
        data = JSON.parse(raw);
        if (data && data.ttclid) return true;
      }
    } catch (e2) {}
    return false;
  }

  function redirectTiktokFromEmpaToEmpa2() {
    if (!hasTtclid()) return false;
    var loc = win.location;
    if (!loc || !loc.pathname) return false;

    var pathname = loc.pathname.replace(/\\/g, '/');
    var googleBase = normalizeBase(GOOGLE_BASE);
    var tiktokBase = normalizeBase(TIKTOK_BASE);

    if (!googleBase || !tiktokBase || googleBase === tiktokBase) return false;
    if (pathname.indexOf(tiktokBase) === 0) return false;
    if (pathname !== googleBase && pathname.indexOf(googleBase + '/') !== 0) {
      return false;
    }

    var newPath = pathname.replace(
      new RegExp('^' + googleBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\/|$)'),
      tiktokBase
    );
    var target =
      loc.origin + newPath + (loc.search || '') + (loc.hash || '');
    if (target === loc.href) return false;
    loc.replace(target);
    return true;
  }

  if (redirectTiktokFromEmpaToEmpa2()) {
    return;
  }

  function normalizeBase(raw) {
    if (raw === null || raw === undefined) return '';
    var p = String(raw).trim();
    if (!p || p === '/' || p === 'auto') return '';
    if (p.charAt(0) !== '/') p = '/' + p;
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p;
  }

  function baseToSlug(base) {
    return base ? base.replace(/\//g, '_') : '_root';
  }

  function lockStorageKey(base) {
    return LOCK_PREFIX + (base ? base : '__root__');
  }

  function pathnameOnBase(pathname, base) {
    var p = (pathname || '').replace(/\\/g, '/');
    if (!base) {
      return (
        p === '/' ||
        p === '/index.html' ||
        /^\/(?:type|pay|up|config|js|admin|api)(?:\/|$)/.test(p)
      );
    }
    return p === base || p.indexOf(base + '/') === 0;
  }

  function writeLock(base) {
    try {
      win.sessionStorage.setItem(lockStorageKey(base), '1');
    } catch (e) {}
  }

  function readLockForPathname(pathname) {
    try {
      var i;
      var key;
      var base;
      for (i = 0; i < win.sessionStorage.length; i++) {
        key = win.sessionStorage.key(i);
        if (!key || key.indexOf(LOCK_PREFIX) !== 0) continue;
        base = key.slice(LOCK_PREFIX.length);
        if (base === '__root__') base = '';
        else base = normalizeBase(base);
        if (pathnameOnBase(pathname, base)) return base;
      }
    } catch (e) {}
    return '';
  }

  var PATH_MARKERS = [
    '/type/wizard',
    '/type/api',
    '/pay/api',
    '/pay/checkout',
    '/config/site-base.js',
    '/config/site-base.php',
    '/config/cpf-token.js',
    '/config/google-pixels.json',
    '/api/google-pixels.php',
    '/api/google-pixels.json',
    '/js/credpix-boot.js',
    '/js/credpix-utm.js',
    '/js/credpix-view-counter.js',
    '/js/credpix-view-counter.php',
    '/js/credpix-utm.php',
    '/js/credpix-analytics.js',
    '/js/app.js',
    '/pay/js/google-pixels.js',
    '/up/',
    '/admin/',
    '/api/google-pixels',
    '/api/analytics',
    '/api/consultar-cpf',
    '/api/pix.php',
    '/css/',
    '/images/',
  ];

  var SCRIPT_MARKERS = [
    '/config/site-base.js',
    '/config/site-base.php',
    '/config/cpf-token.js',
    '/js/credpix-boot.js',
    '/js/credpix-utm.js',
    '/js/credpix-view-counter.js',
    '/js/credpix-view-counter.php',
    '/js/credpix-utm.php',
    '/js/credpix-analytics.js',
    '/js/app.js',
    '/pay/js/google-pixels.js',
  ];

  function detectFromScriptSrc() {
    var scripts = win.document.getElementsByTagName('script');
    var i, j, src, path, idx;

    var cur = win.document.currentScript;
    if (cur && cur.src) {
      for (j = 0; j < SCRIPT_MARKERS.length; j++) {
        try {
          path = new URL(cur.src, win.location.href).pathname;
          idx = path.indexOf(SCRIPT_MARKERS[j]);
          if (idx > 0) return path.slice(0, idx);
        } catch (e) {}
      }
    }

    for (i = 0; i < scripts.length; i++) {
      src = scripts[i].src || '';
      if (!src) continue;
      for (j = 0; j < SCRIPT_MARKERS.length; j++) {
        try {
          path = new URL(src, win.location.href).pathname;
          idx = path.indexOf(SCRIPT_MARKERS[j]);
          if (idx > 0) return path.slice(0, idx);
        } catch (e) {}
      }
    }
    return '';
  }

  function detectFromPathname(pathname) {
    var p = (pathname || '').replace(/\\/g, '/');
    var i, idx;
    for (i = 0; i < PATH_MARKERS.length; i++) {
      idx = p.indexOf(PATH_MARKERS[i]);
      if (idx > 0) return p.slice(0, idx);
    }
    var seg = p.match(/^(\/[^/]+)\/(?:up|pay|type|config|js|admin|api|css|images)\//);
    if (seg) return seg[1];
    if (/\/a(?:\/index\.html)?\/?$/i.test(p)) {
      return p.replace(/\/a(?:\/index\.html)?\/?$/i, '') || '';
    }
    if (p !== '/' && /\/index\.html$/i.test(p)) {
      return p.slice(0, p.lastIndexOf('/'));
    }
    if (
      p !== '/' &&
      p.endsWith('/') &&
      p.indexOf('/type/') === -1 &&
      p.indexOf('/pay/') === -1
    ) {
      return p.slice(0, -1);
    }
    if (p !== '/' && /^\/[^/]+$/.test(p)) {
      return p;
    }
    return '';
  }

  function detectCurrentBase() {
    return normalizeBase(
      detectFromScriptSrc() ||
        detectFromPathname(win.location && win.location.pathname)
    );
  }

  function clearAllLocks() {
    try {
      var toRemove = [];
      for (var k = 0; k < win.sessionStorage.length; k++) {
        var sk = win.sessionStorage.key(k);
        if (sk && sk.indexOf(LOCK_PREFIX) === 0) toRemove.push(sk);
      }
      for (var r = 0; r < toRemove.length; r++) win.sessionStorage.removeItem(toRemove[r]);
    } catch (e) {}
  }

  function resolveBasePath() {
    var pathname = win.location && win.location.pathname ? win.location.pathname : '';
    var preset = win.CREDPIX_BASE_PATH;
    /* preset definido explicitamente (inclusive '' para root) */
    if (preset !== undefined && preset !== null && preset !== 'auto') {
      var forced = normalizeBase(preset);
      clearAllLocks();   /* limpa locks antigos de /empg ou outros */
      writeLock(forced);
      return forced;
    }

    var detected = detectCurrentBase();
    if (detected) {
      writeLock(detected);
      return detected;
    }

    return readLockForPathname(pathname);
  }

  function storageKey(name) {
    var base = win.CREDPIX_BASE_PATH || '';
    return 'credpix:' + baseToSlug(base) + ':' + String(name || '');
  }

  win.CREDPIX_PUBLIC_ORIGIN =
    win.CREDPIX_PUBLIC_ORIGIN ||
    (win.location ? win.location.origin : '');
  win.CREDPIX_BASE_PATH = resolveBasePath();
  win.credpixResolveBasePath = resolveBasePath;
  win.credpixGetBasePath = function () {
    return win.CREDPIX_BASE_PATH || '';
  };
  win.credpixLockBasePath = function (base) {
    var b = normalizeBase(base);
    win.CREDPIX_BASE_PATH = b;
    writeLock(b);
    return b;
  };
  win.credpixStorageKey = storageKey;
  win.credpixCookiePath = function () {
    var b = win.CREDPIX_BASE_PATH || '';
    return b || '/';
  };

  function loadUtmifyGooglePixel() {
    var pixelId = String(win.CREDPIX_UTMIFY_GOOGLE_PIXEL_ID || '').trim();
    if (!pixelId) return;
    if (win.location && /^\/admin(?:\/|$)/.test(win.location.pathname || '')) return;
    if (win.__credpixUtmifyGooglePixelLoaded) return;
    win.__credpixUtmifyGooglePixelLoaded = true;
    win.googlePixelId = pixelId;
    var script = win.document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = 'https://cdn.utmify.com.br/scripts/pixel/pixel-google.js';
    win.document.head.appendChild(script);
  }

  loadUtmifyGooglePixel();
})(window);
