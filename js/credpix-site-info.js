/**
 * Carrega dados do rodapé conforme o domínio (config/domains.json via api/site-info.php).
 */
(function (global) {
  'use strict';

  function apiUrl() {
    var path = '/api/site-info.php';
    if (typeof global.credpixPath === 'function') return global.credpixPath(path);
    var base = '';
    if (typeof global.credpixGetBasePath === 'function') {
      base = global.credpixGetBasePath();
    } else {
      base = (global.CREDPIX_BASE_PATH || '').replace(/\/$/, '');
    }
    return base ? base + path : path;
  }

  function applySiteInfo(info) {
    if (!info) return;

    document.querySelectorAll('[data-site-endereco]').forEach(function (el) {
      el.textContent = info.endereco || '';
    });
    document.querySelectorAll('[data-site-telefone]').forEach(function (el) {
      el.textContent = info.telefone || '';
    });
    document.querySelectorAll('[data-site-email]').forEach(function (el) {
      el.textContent = info.email || '';
    });
    document.querySelectorAll('[data-site-copyright]').forEach(function (el) {
      var year = new Date().getFullYear();
      var marca = info.marca || 'CredPix';
      var razao = info.razaoSocial || '';
      var cnpj = info.cnpj || '';
      el.textContent =
        '© ' +
        year +
        ' ' +
        marca +
        '. ' +
        razao +
        ' · CNPJ: ' +
        cnpj +
        '. Todos os direitos reservados.';
    });
  }

  function loadSiteInfo() {
    return fetch(apiUrl(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.success) return;
        applySiteInfo(data.siteInfo || data.default || null);
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSiteInfo);
  } else {
    loadSiteInfo();
  }

  global.CredPixSiteInfo = {
    load: loadSiteInfo,
    apply: applySiteInfo,
  };
})(window);
