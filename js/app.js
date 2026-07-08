(function () {
  'use strict';

  var _wizardNavLock = 0;

  function getSiteOrigin() {
    if (window.CREDPIX_PUBLIC_ORIGIN) {
      return String(window.CREDPIX_PUBLIC_ORIGIN).replace(/\/$/, '');
    }
    return window.location.origin;
  }

  function buildWizardUrl(sliderValue) {
    var val = String(sliderValue || '6500');

    if (typeof window.credpixPath === 'function') {
      var path = window.credpixPath('/type/wizard/');
      var u = new URL(path, window.location.href);
      u.searchParams.set('valor', val);
      if (window.credpixAppendUtms) {
        return window.credpixAppendUtms(u.href);
      }
      return u.href;
    }

    var base = '';
    if (typeof window.credpixGetBasePath === 'function') {
      base = window.credpixGetBasePath();
    } else {
      base = (window.CREDPIX_BASE_PATH || '').replace(/\/$/, '');
    }

    var wizardPath = (base ? base : '') + '/type/wizard/';
    var u2 = new URL(wizardPath, getSiteOrigin());
    u2.searchParams.set('valor', val);
    var out = u2.href;
    if (window.credpixAppendUtms) {
      out = window.credpixAppendUtms(out);
    }
    return out;
  }

  function goToWizard(sliderValue) {
    var now = Date.now();
    if (now - _wizardNavLock < 1200) return;
    _wizardNavLock = now;

    try {
      var k =
        typeof window.credpixStorageKey === 'function'
          ? window.credpixStorageKey('valor_emprestimo')
          : 'valor_emprestimo';
      localStorage.setItem(k, String(sliderValue || '6500'));
    } catch (e) {}

    window.location.assign(buildWizardUrl(sliderValue));
  }

  function bindWizardGo(el, getValue) {
    if (!el) return;

    function run(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      goToWizard(getValue());
    }

    el.addEventListener('click', run);
  }

  function initSidebar() {
    function toggle(open) {
      document.getElementById('sidebar')?.classList.toggle('open', open);
      document.getElementById('sidebar-overlay')?.classList.toggle('show', open);
    }
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.closest('[data-sidebar-open]')) toggle(true);
      if (t.closest('[data-sidebar-close]')) toggle(false);
    });
  }

  function initSimulator() {
    var slider = document.querySelector('[data-simulador-slider]');
    var amount = document.querySelector('[data-simulador-amount]');
    var btn = document.querySelector('[data-simulador-btn]');
    if (!slider || !amount || !btn) return;

    function getVal() {
      return slider.value;
    }

    function update() {
      var val = parseInt(slider.value, 10);
      amount.textContent = 'R$ ' + val.toLocaleString('pt-BR');
      var min = parseInt(slider.min, 10);
      var max = parseInt(slider.max, 10);
      var pct = ((val - min) / (max - min)) * 100;
      slider.style.background =
        'linear-gradient(to right, #045acd ' + pct + '%, rgba(4,90,205,0.18) ' + pct + '%)';

      if (btn.tagName === 'A') {
        btn.setAttribute('href', buildWizardUrl(val));
      }
    }

    slider.addEventListener('input', update);
    bindWizardGo(btn, getVal);

    document.querySelectorAll('[data-hero-cta]').forEach(function (el) {
      bindWizardGo(el, getVal);
    });

    update();
  }

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      if (a.hasAttribute('data-hero-cta') || a.hasAttribute('data-simulador-btn')) return;
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href');
        if (!id || id === '#') return;
        var el = document.querySelector(id);
        if (!el) return;
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function boot() {
    initSidebar();
    initSimulator();
    initSmoothScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
