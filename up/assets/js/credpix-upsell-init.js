/**
 * Upsell: carrega site-base, utm, boot e Amung com URL absoluta (slug /ll, subdomínio).
 * Resolve 404 quando ../../../config/ não bate com a URL real.
 */
(function (global) {
  'use strict';

  function detectCredpixBase() {
    var p = (global.location.pathname || '').replace(/\\/g, '/');
    var patterns = [
      /^(.*)\/up\/upsell\/[^/]+$/i,
      /^(.*)\/up\/upsell\/backredirect\.html$/i,
      /^(.*)\/up\/obrigado\.html$/i,
    ];
    var i;
    for (i = 0; i < patterns.length; i++) {
      var m = p.match(patterns[i]);
      if (m) return m[1] || '';
    }
    return '';
  }

  function assetUrl(rel) {
    var base = detectCredpixBase();
    var path = (base ? base + '/' : '/') + String(rel || '').replace(/^\//, '');
    path = path.replace(/\/+/g, '/');
    return new URL(path, global.location.origin).href;
  }

  global.CREDPIX_UPSELL_DETECTED_BASE = detectCredpixBase();

  try {
    if (/(?:\?|&)debug_amung=1(?:&|$)/.test(global.location.search || '')) {
      global.CREDPIX_AMUNG_DEBUG = true;
    }
  } catch (e) {}

  function loadScript(url, done) {
    var s = global.document.createElement('script');
    s.src = url;
    s.async = false;
    s.onload = function () {
      if (done) done();
    };
    s.onerror = function () {
      console.error('[CredPix] 404 ou bloqueio:', url);
      if (done) done();
    };
    (global.document.head || global.document.documentElement).appendChild(s);
  }

  var steps = [
    'config/site-base.php?counter_slot=upsell',
    'js/credpix-utm.php',
    'js/credpix-boot.js',
  ];

  function runStep(i) {
    if (i >= steps.length) {
      try {
        global.dispatchEvent(new CustomEvent('credpix-upsell-ready'));
      } catch (e2) {}
      scheduleAmung();
      return;
    }
    loadScript(assetUrl(steps[i]), function () {
      runStep(i + 1);
    });
  }

  function scheduleAmung() {
    function inject() {
      loadScript(assetUrl('js/credpix-view-counter.php'));
    }
    if (global.document.body) inject();
    else global.document.addEventListener('DOMContentLoaded', inject);
  }

  runStep(0);
})(window);
