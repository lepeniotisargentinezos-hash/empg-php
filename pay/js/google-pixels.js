/**

 * Pixels Google — somente pay/checkout.php (produto principal + upsells PIX).

 * Lista padrão embutida; JSON no servidor (admin) mescla com os defaults.

 */

(function (global) {

  var loaded = false;

  var configCache = null;

  var scriptLoading = null;



  var DEFAULT_PIXELS = {
    googleAds: [],
    ga4: [],
  };



  /** Checkout PIX — principal e upsells usam pay/checkout.php */

  function isCheckoutPage() {

    try {

      var path = String(global.location.pathname || '').replace(/\\/g, '/');

      if (path.indexOf('checkout.php') !== -1 || path.indexOf('/pay/checkout') !== -1) {

        return true;

      }

      var id = new URLSearchParams(global.location.search || '').get('produto');

      return Boolean(id && String(id).indexOf('prod_') === 0);

    } catch (e) {

      return false;

    }

  }



  function loadScript(src) {

    return new Promise(function (resolve, reject) {

      if (document.querySelector('script[src="' + src + '"]')) {

        resolve();

        return;

      }

      var s = document.createElement('script');

      s.async = true;

      s.src = src;

      s.onload = resolve;

      s.onerror = reject;

      document.head.appendChild(s);

    });

  }



  function ensureGtag() {

    global.dataLayer = global.dataLayer || [];

    global.gtag =

      global.gtag ||

      function () {

        global.dataLayer.push(arguments);

      };

  }



  function mergeGoogleAds(defaults, saved) {

    var map = {};

    var key = function (row) { return row.id + '/' + row.label; };

    var put = function (row) {
      if (!row.id || !row.label) return;
      var k = key(row);
      var prev = map[k];
      var entry = { id: row.id, label: row.label };
      var desc = String(row.description || (prev && prev.description) || '').trim();
      if (desc) entry.description = desc.slice(0, 80);
      map[k] = entry;
    };

    (defaults || []).forEach(put);

    (saved || []).forEach(put);

    return Object.keys(map).map(function (k) { return map[k]; });

  }



  function normalizePayload(data) {

    var savedAds = Array.isArray(data.googleAds) ? data.googleAds : [];

    var ads = savedAds.filter(function (row) {

      return row && row.id && row.label;

    }).map(function (row) {

      var entry = { id: row.id, label: row.label };

      var desc = String(row.description || '').trim();

      if (desc) entry.description = desc.slice(0, 80);

      return entry;

    });

    return {

      googleAds: ads.length ? ads : DEFAULT_PIXELS.googleAds,

      ga4: Array.isArray(data.ga4) ? data.ga4 : [],

    };

  }



  function configJsonUrl() {

    var path = '/api/google-pixels.php';

    if (typeof global.credpixPath === 'function') return global.credpixPath(path);

    var base = '';

    if (typeof global.credpixGetBasePath === 'function') {

      base = global.credpixGetBasePath();

    } else {

      base = (global.CREDPIX_BASE_PATH || '').replace(/\/$/, '');

    }

    return base ? base + path : path;

  }



  function getConfig() {

    if (configCache) return Promise.resolve(configCache);

    return fetch(configJsonUrl(), { credentials: 'same-origin', cache: 'no-store' })

      .then(function (r) {

        if (!r.ok) throw new Error('no file');

        return r.json();

      })

      .then(function (data) {

        configCache = normalizePayload(data);

        return configCache;

      })

      .catch(function () {

        configCache = normalizePayload(DEFAULT_PIXELS);

        return configCache;

      });

  }



  function initGtag(config) {

    if (loaded) return Promise.resolve();

    if (!isCheckoutPage()) return Promise.resolve();

    if (scriptLoading) return scriptLoading;



    var ads = config.googleAds || [];

    var ga4 = config.ga4 || [];

    var primary =

      (ads[0] && ads[0].id) || (ga4[0] && (typeof ga4[0] === 'string' ? ga4[0] : ga4[0].id)) || null;

    if (!primary) return Promise.resolve();



    ensureGtag();

    scriptLoading = loadScript(

      'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(primary)

    )

      .then(function () {

        global.gtag('js', new Date());

        ads.forEach(function (row) {

          if (row.id) global.gtag('config', row.id);

        });

        ga4.forEach(function (id) {

          var mid = typeof id === 'string' ? id : id.id;

          if (mid) global.gtag('config', mid);

        });

        loaded = true;

      })

      .catch(function (err) {

        scriptLoading = null;

        console.warn('[Google Pixels] initGtag:', err);

      });



    return scriptLoading;

  }



  function firePaymentPixels(opts) {

    if (!isCheckoutPage()) return Promise.resolve();



    opts = opts || {};

    var value = typeof opts.value === 'number' ? opts.value : 1;

    var currency = opts.currency || 'BRL';

    var txId = opts.transactionId || '';



    return getConfig()

      .then(function (config) {

        return initGtag(config).then(function () {

          return config;

        });

      })

      .then(function (config) {

        if (!global.gtag) return;



        (config.googleAds || []).forEach(function (row) {

          if (!row.id || !row.label) return;

          global.gtag('event', 'conversion', {

            send_to: row.id + '/' + row.label,

            value: value,

            currency: currency,

            transaction_id: txId,

          });

        });



        (config.ga4 || []).forEach(function (id) {

          var mid = typeof id === 'string' ? id : id.id;

          if (!mid) return;

          global.gtag('event', 'purchase', {

            transaction_id: txId,

            value: value,

            currency: currency,

          });

        });

      })

      .catch(function (err) {

        console.warn('[Google Pixels]', err);

      });

  }



  global.CredPixGooglePixels = {

    isCheckoutPage: isCheckoutPage,

    getConfig: getConfig,

    initGtag: initGtag,

    firePaymentPixels: firePaymentPixels,

  };

})(window);

