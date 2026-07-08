/**
 * Teste interno do fluxo Google Pixels + checkout (sem browser).
 * node scripts/test-google-pixels-flow.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PIXELS_SRC = fs.readFileSync(path.join(ROOT, 'pay/js/google-pixels.js'), 'utf8');

function createMockWindow(opts) {
  opts = opts || {};
  const pathname = opts.pathname || '/empa/pay/checkout.php';
  const search = opts.search || '?produto=prod_test';
  const storage = new Map();
  const scripts = [];
  const conversionEvents = [];
  let gtagScriptLoaded = false;

  const win = {
    location: { pathname, search, href: 'https://example.com' + pathname + search },
    document: {
      createElement(tag) {
        return { tagName: tag.toUpperCase(), async: false, src: '', onload: null, onerror: null };
      },
      head: {
        appendChild(el) {
          scripts.push(el);
          if (el.src && el.src.includes('googletagmanager') && typeof el.onload === 'function') {
            setTimeout(el.onload, 0);
          }
        },
      },
      querySelector(sel) {
        if (sel.indexOf('script[src="') === 0) {
          const src = sel.slice(13, -2);
          return scripts.some((s) => s.src === src) ? { src } : null;
        }
        return null;
      },
    },
    dataLayer: [],
    sessionStorage: {
      getItem(k) { return storage.has(k) ? storage.get(k) : null; },
      setItem(k, v) { storage.set(k, String(v)); },
    },
    CREDPIX_BASE_PATH: opts.basePath || '/empa',
    setTimeout: global.setTimeout.bind(global),
    clearTimeout: global.clearTimeout.bind(global),
    credpixPath(p) {
      const base = (win.CREDPIX_BASE_PATH || '').replace(/\/$/, '');
      const rel = p.charAt(0) === '/' ? p : '/' + p;
      return base ? base + rel : rel;
    },
    credpixGetBasePath() { return win.CREDPIX_BASE_PATH || ''; },
    gtag: null,
  };

  win.fetch = async (url) => {
    if (String(url).includes('google-pixels.json')) {
      if (opts.configFail) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({
          googleAds: [{ id: 'AW-111', label: 'lbl111' }],
          ga4: [],
        }),
      };
    }
    throw new Error('unexpected fetch: ' + url);
  };

  win.window = win;
  win.self = win;

  vm.runInNewContext(PIXELS_SRC, win, { filename: 'google-pixels.js' });

  win.gtag = function () {
    const args = Array.from(arguments);
    win.dataLayer.push(args);
    if (args[0] === 'event' && args[1] === 'conversion') {
      conversionEvents.push(args[2] || {});
      const cb = (args[2] || {}).event_callback;
      if (typeof cb === 'function') setTimeout(cb, 0);
    }
  };

  return { win, conversionEvents, storage, scripts };
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log('OK  ' + name);
    return true;
  } catch (e) {
    console.error('FAIL ' + name + ': ' + (e && e.message ? e.message : e));
    return false;
  }
}

async function main() {
  let passed = 0;
  let failed = 0;

  const cases = [
    ['isCheckoutPage detecta checkout.php', async () => {
      const { win } = createMockWindow({ pathname: '/empa/pay/checkout.php' });
      if (!win.CredPixGooglePixels.isCheckoutPage()) throw new Error('deveria ser checkout');
    }],
    ['configJsonUrl usa credpixPath (/empa)', async () => {
      const { win } = createMockWindow({ basePath: '/empa' });
      await win.CredPixGooglePixels.getConfig();
      const url = win.credpixPath('/config/google-pixels.json');
      if (url !== '/empa/config/google-pixels.json') throw new Error('url=' + url);
    }],
    ['fallback defaults quando JSON falha', async () => {
      const { win } = createMockWindow({ configFail: true });
      const cfg = await win.CredPixGooglePixels.getConfig();
      if (!cfg.googleAds || cfg.googleAds.length < 6) throw new Error('defaults ausentes');
    }],
    ['firePaymentPixels dispara conversion com transaction_id', async () => {
      const { win, conversionEvents } = createMockWindow({});
      await win.CredPixGooglePixels.initGtag(await win.CredPixGooglePixels.getConfig());
      await new Promise((r) => setTimeout(r, 30));
      await win.CredPixGooglePixels.firePaymentPixels({
        transactionId: 'tx_abc',
        value: 47.9,
        currency: 'BRL',
      });
      await new Promise((r) => setTimeout(r, 50));
      if (conversionEvents.length < 1) throw new Error('events=' + conversionEvents.length);
      if (conversionEvents[0].transaction_id !== 'tx_abc') throw new Error('tx id errado');
      if (conversionEvents[0].value !== 47.9) throw new Error('value errado');
    }],
    ['firePaymentPixels permite disparo repetido', async () => {
      const { win, conversionEvents } = createMockWindow({});
      await win.CredPixGooglePixels.initGtag(await win.CredPixGooglePixels.getConfig());
      await new Promise((r) => setTimeout(r, 30));
      await win.CredPixGooglePixels.firePaymentPixels({ transactionId: 'tx_dup', value: 10 });
      await new Promise((r) => setTimeout(r, 50));
      const firstBatch = conversionEvents.length;
      await win.CredPixGooglePixels.firePaymentPixels({ transactionId: 'tx_dup', value: 10 });
      await new Promise((r) => setTimeout(r, 50));
      if (firstBatch < 1) throw new Error('nenhuma conversao');
      if (conversionEvents.length <= firstBatch) {
        throw new Error('nao repetiu: ' + conversionEvents.length);
      }
    }],
    ['checkout.php: pixels no checkout, redirect 2s, sem await', async () => {
      const checkout = fs.readFileSync(path.join(ROOT, 'pay/checkout.php'), 'utf8');
      if (!checkout.includes('js/google-pixels.js')) throw new Error('sem google-pixels.js');
      if (!checkout.includes('let paymentHandled = false')) throw new Error('sem paymentHandled');
      if (checkout.includes('await window.CredPixGooglePixels.firePaymentPixels')) {
        throw new Error('nao deve await firePaymentPixels');
      }
      if (!checkout.includes('}, 2000);')) throw new Error('redirect deve ser 2s');
    }],
    ['simula fluxo checkout: pixels antes do redirect', async () => {
      const { win } = createMockWindow({});
      await new Promise((r) => setTimeout(r, 20));
      let redirectAt = null;
      let pixelsDoneAt = null;
      const upsellUrl = '/empa/up/obrigado.html';

      async function paymentConfirmed(url) {
        if (win.__paid) return;
        win.__paid = true;
        win.CredPixGooglePixels.firePaymentPixels({
          transactionId: 'tx_flow',
          value: 99,
          currency: 'BRL',
        });
        pixelsDoneAt = Date.now();
        if (!url) return;
        setTimeout(() => { redirectAt = Date.now(); }, 2000);
      }

      await paymentConfirmed(upsellUrl);
      await new Promise((r) => setTimeout(r, 2100));
      if (!pixelsDoneAt) throw new Error('pixels nao rodaram');
      if (!redirectAt) throw new Error('redirect nao ocorreu');
      if (redirectAt < pixelsDoneAt) throw new Error('redirect antes dos pixels');
    }],
  ];

  for (const [name, fn] of cases) {
    const ok = await runCase(name, fn);
    if (ok) passed++; else failed++;
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
