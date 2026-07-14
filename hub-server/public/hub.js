'use strict';
(function () {

  /* ── Estado global ────────────────────────────────────────────── */
  var state = {
    token: '',
    sites: [],
    currentSiteId: null,
    currentSubTab: 'overview',
    lastOverviewRefresh: null,
    lastSiteRefresh: null,
    overviewTimer: null,
    siteTimer: null,
    pixelsData: {},     // siteId → { google_ads:[], ga4:[] }
    editingPixels: {},  // cópia local durante edição
  };

  /* ── Utilitários ──────────────────────────────────────────────── */
  var DISPLAY_TZ = 'America/Sao_Paulo';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function fmtMoney(cents) {
    if (cents == null || isNaN(cents)) return 'R$ 0,00';
    return 'R$ ' + (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(Number(ts)).toLocaleString('pt-BR', {
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit', timeZone: DISPLAY_TZ
    });
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    return new Date(Number(ts)).toLocaleTimeString('pt-BR', {
      hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone: DISPLAY_TZ
    });
  }

  function fmtAgo(ts) {
    if (!ts) return '—';
    var diff = Date.now() - Number(ts);
    if (diff < 60000) return 'agora';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min atrás';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h atrás';
    return Math.floor(diff / 86400000) + 'd atrás';
  }

  function fmtDuration(ms) {
    if (!ms) return '—';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60); s = s % 60;
    if (m < 60) return m + 'min ' + (s ? s + 's' : '');
    var h = Math.floor(m / 60); m = m % 60;
    return h + 'h ' + (m ? m + 'min' : '');
  }

  function chartEmpty(type, title, hint) {
    return '<div class="chart-empty" data-empty-type="' + esc(type || 'chart') + '"><strong>' +
      esc(title || 'Sem dados') + '</strong>' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>';
  }

  function renderUtmifyBadges(order) {
    var s = order.utmify_status;
    if (!s || s === 'sent') return '<span class="badge ok">OK</span>';
    if (s === 'waiting_sent') return '<span class="badge warn">Enviando</span>';
    return '<span class="badge bad">Falha</span>';
  }

  function countryLabel(code) { return code || '—'; }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function showEl(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
  function hideEl(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }
  function el(id) { return document.getElementById(id); }

  function setLoadingBar(active) {
    var bar = el('loadingBar');
    if (bar) bar.classList.toggle('active', active);
  }

  /* ── Auth ─────────────────────────────────────────────────────── */
  function getToken() { return sessionStorage.getItem('hub_token') || ''; }
  function saveToken(t) { sessionStorage.setItem('hub_token', t); state.token = t; }
  function clearToken() { sessionStorage.removeItem('hub_token'); state.token = ''; }

  function apiHeaders() {
    return { 'X-Hub-Token': state.token, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  }

  async function apiFetch(path, opts) {
    var res = await fetch(path, Object.assign({ headers: apiHeaders() }, opts || {}));
    if (res.status === 401) throw new Error('auth');
    return res;
  }

  async function verifyAuth(token) {
    var t = token || state.token;
    var res = await fetch('/api/hub/sites', { headers: { 'X-Hub-Token': t, 'Accept': 'application/json' } });
    if (res.status === 401) throw new Error('auth');
    return res.json();
  }

  /* ── Sites API ────────────────────────────────────────────────── */
  async function loadSitesFromApi() {
    var res = await apiFetch('/api/hub/sites');
    var data = await res.json();
    state.sites = data.sites || [];
    return state.sites;
  }

  async function saveSites() {
    var res = await apiFetch('/api/hub/sites', {
      method: 'POST',
      body: JSON.stringify({ sites: state.sites }),
    });
    if (!res.ok) throw new Error('Falha ao salvar sites');
    return res.json();
  }

  /* ── Proxy fetch para site individual ────────────────────────── */
  function proxyUrl(siteId, subPath, params) {
    var base = '/api/proxy/' + encodeURIComponent(siteId) + subPath;
    if (params) base += '?' + params;
    return base;
  }

  async function fetchSiteStats(siteId, days, bustCache) {
    var qs = 'days=' + (days || 1);
    if (bustCache) qs += '&_t=' + Date.now(); /* força nova requisição no browser */
    var url = proxyUrl(siteId, '/api/analytics.php', qs);
    var res = await fetch(url, { headers: apiHeaders(), cache: 'no-store' });
    if (res.status === 401) throw new Error('auth');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    return data.stats || data;
  }

  async function fetchSiteHealth(siteId) {
    try {
      var res = await fetch(proxyUrl(siteId, '/api/health.php'), { headers: apiHeaders(), signal: AbortSignal.timeout(8000) });
      return res.ok;
    } catch { return false; }
  }

  async function fetchSitePixels(siteId) {
    try {
      var res = await apiFetch(proxyUrl(siteId, '/api/google-pixels.php'));
      if (!res.ok) return null;
      var data = await res.json();
      return {
        googleAds: data.googleAds || data.google_ads || [],
        ga4: data.ga4 || [],
      };
    } catch (_) { return null; }
  }

  async function saveSitePixels(siteId, data) {
    var payload = {
      googleAds: data.googleAds || data.google_ads || [],
      ga4: data.ga4 || [],
    };
    var res = await apiFetch(proxyUrl(siteId, '/api/google-pixels.php'), {
      method: 'POST', body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* ── Navegação ───────────────────────────────────────────────── */
  function showSection(name) {
    document.querySelectorAll('.section').forEach(function (s) { s.classList.remove('active'); });
    var target = el('sec-' + name);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item[data-nav]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === name);
    });
    document.querySelectorAll('.nav-item[data-site]').forEach(function (btn) {
      btn.classList.remove('active');
    });
    if (name === 'hub-overview') {
      document.querySelector('.nav-item[data-nav="hub-overview"]').classList.add('active');
    }
  }

  function showSubTab(tab) {
    state.currentSubTab = tab;
    document.querySelectorAll('.sub-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-subtab') === tab);
    });
    document.querySelectorAll('.sub-section').forEach(function (s) { s.classList.remove('active'); });
    var target = el('subsec-' + tab);
    if (target) target.classList.add('active');
  }

  /* ── Sidebar ─────────────────────────────────────────────────── */
  function renderSidebar() {
    var nav = el('sitesNav');
    if (!nav) return;

    var label = el('siteCountLabel');
    if (label) label.textContent = state.sites.length + ' site' + (state.sites.length !== 1 ? 's' : '');

    nav.innerHTML = state.sites.map(function (site) {
      return '<button type="button" class="nav-item site-nav-item" draggable="true" data-nav="site-detail" data-site="' + esc(site.id) + '" style="cursor:grab">' +
        '<span class="site-dot" id="dot-' + esc(site.id) + '"></span>' +
        '<span class="icon" style="font-size:16px">' + esc(site.icon || '🌐') + '</span>' +
        '<span style="flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(site.name) + '</span>' +
        '<span style="font-size:11px;color:var(--text-muted);opacity:.4;padding-left:4px;cursor:grab">⠿</span>' +
      '</button>';
    }).join('');

    /* Drag & drop para reordenar */
    var dragSrc = null;

    nav.querySelectorAll('.nav-item[data-site]').forEach(function (btn) {
      btn.addEventListener('click', function () { openSiteDetail(btn.getAttribute('data-site')); });

      btn.addEventListener('dragstart', function (e) {
        dragSrc = btn;
        btn.style.opacity = '.4';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', btn.getAttribute('data-site'));
      });

      btn.addEventListener('dragend', function () {
        btn.style.opacity = '';
        nav.querySelectorAll('.nav-item[data-site]').forEach(function (b) {
          b.style.outline = '';
        });
      });

      btn.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (btn !== dragSrc) {
          btn.style.outline = '2px solid var(--accent)';
          btn.style.outlineOffset = '-2px';
        }
      });

      btn.addEventListener('dragleave', function () {
        btn.style.outline = '';
      });

      btn.addEventListener('drop', function (e) {
        e.preventDefault();
        btn.style.outline = '';
        if (!dragSrc || dragSrc === btn) return;

        var fromId = dragSrc.getAttribute('data-site');
        var toId   = btn.getAttribute('data-site');
        var fromIdx = state.sites.findIndex(function (s) { return s.id === fromId; });
        var toIdx   = state.sites.findIndex(function (s) { return s.id === toId; });
        if (fromIdx === -1 || toIdx === -1) return;

        /* Reordena array */
        var moved = state.sites.splice(fromIdx, 1)[0];
        state.sites.splice(toIdx, 0, moved);

        /* Salva e re-renderiza */
        saveSites().catch(function () {});
        renderSidebar();
      });
    });
  }

  function setSiteDot(siteId, status) {
    var dot = el('dot-' + siteId);
    if (!dot) return;
    dot.className = 'site-dot ' + (status === true ? 'online' : status === false ? 'offline' : 'checking');
    var nav = dot.closest('.nav-item');
    if (nav) nav.className = nav.className.replace(/ online| offline/g, '') + (status === true ? ' online' : status === false ? ' offline' : '');
  }

  /* ── Hub Overview ────────────────────────────────────────────── */
  async function loadHubOverview() {
    if (!state.sites.length) {
      el('hubSitesGrid').innerHTML = '';
      showEl('hubEmptyState');
      hideEl('hubRankingSection');
      el('overviewDesc').textContent = 'Nenhum site cadastrado';
      return;
    }

    hideEl('hubEmptyState');
    showEl('hubRankingSection');
    var days = parseInt((el('overviewPeriod') && el('overviewPeriod').value) || '1', 10);
    var periodLabel = days === 1 ? 'hoje' : 'últimos ' + days + ' dias';
    el('overviewDesc').textContent = state.sites.length + ' site(s) · ' + periodLabel;
    setLoadingBar(true);

    var results = await Promise.allSettled(state.sites.map(async function (site) {
      var [online, statsRes] = await Promise.allSettled([
        fetchSiteHealth(site.id),
        fetchSiteStats(site.id, days, true).catch(function () { return null; }),
      ]);
      return {
        site: site,
        online: online.status === 'fulfilled' ? online.value : false,
        stats: statsRes.status === 'fulfilled' ? statsRes.value : null,
      };
    }));

    setLoadingBar(false);
    state.lastOverviewRefresh = Date.now();
    var label = el('lastRefreshLabel');
    if (label) label.textContent = 'Atualizado às ' + fmtTime(Date.now());

    var allData = results.map(function (r) { return r.value; }).filter(Boolean);

    state._lastHubDays    = days;
    state._lastHubAllData = allData;

    renderHubTotalKpis(allData, days);
    renderSiteCards(allData, days);
    renderHubAccessChart(allData, state._hubChartMode || 'pix', days);
    renderHubRanking(allData);
    loadHubRecentEvents(allData, days); /* async — sem await para não bloquear */
    updateSidebarDots(allData);
  }

  /* Taxa AnubisPay por transação (em centavos) — configurável via localStorage */
  var ANUBIS_FEE_CENTS = parseInt(localStorage.getItem('hub_anubis_fee_cents') || '705', 10);

  window.hubSetAnubisFee = function (reais) {
    var cents = Math.round(parseFloat(reais) * 100);
    if (cents >= 0) {
      localStorage.setItem('hub_anubis_fee_cents', String(cents));
      ANUBIS_FEE_CENTS = cents;
      if (state._lastHubAllData) {
        renderHubTotalKpis(state._lastHubAllData, state._lastHubDays || 1);
        renderSiteCards(state._lastHubAllData, state._lastHubDays || 1);
      }
    }
  };

  window.hubEditFee = function () {
    var current = (ANUBIS_FEE_CENTS / 100).toFixed(2).replace('.', ',');
    var input = prompt('Taxa AnubisPay por venda (R$):\n\nAtual: R$ ' + current, current);
    if (input === null) return;
    var val = parseFloat(String(input).replace(',', '.'));
    if (isNaN(val) || val < 0) { alert('Valor inválido'); return; }
    window.hubSetAnubisFee(val);
  };

  function renderHubTotalKpis(allData, days) {
    days = days || 1;
    var kpisEl = el('hubTotalKpis');
    if (!kpisEl || !allData.length) { if (kpisEl) kpisEl.classList.add('hidden'); return; }
    var totalRev = 0, totalPix = 0, totalPaid = 0, totalLive = 0, online = 0;
    allData.forEach(function (d) {
      var t = (d.stats && d.stats.totals) || {};
      totalRev  += t.revenue_cents || 0;
      totalPix  += t.pix_generated || 0;
      totalPaid += t.payments || 0;
      totalLive += (d.stats && d.stats.live && !d.stats.live.disabled) ? (d.stats.live.total || 0) : 0;
      if (d.online) online++;
    });
    var allOnline = online === allData.length;
    kpisEl.classList.remove('hidden');

    /* Paleta do site: azul #045acd, escuro #0F1B36, dourado #C28B52 */
    var BRAND  = '#045acd';
    var DARK   = '#0F1B36';
    var GOLD   = '#C28B52';

    var icons = {
      pix:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 19 6 19 18 12 22 5 18 5 6"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="5" y1="6" x2="19" y2="18"/><line x1="19" y1="6" x2="5" y2="18"/></svg>',
      check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>',
      users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      globe: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    };

    function iconBox(svg) {
      return '<div style="width:46px;height:46px;border-radius:12px;background:rgba(4,90,205,.18);border:1px solid rgba(4,90,205,.35);display:flex;align-items:center;justify-content:center;color:' + BRAND + ';margin-bottom:12px">' + svg + '</div>';
    }

    var indicators = [
      { icon: icons.pix,   label: 'PIX gerados',  val: totalPix },
      { icon: icons.check, label: 'PIX pagos',    val: totalPaid },
      { icon: icons.users, label: 'Ao vivo',      val: totalLive },
      { icon: icons.globe, label: 'Sites online', val: online + '/' + allData.length },
    ];

    kpisEl.innerHTML =
      '<div style="display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:stretch">' +

      /* Hero: Receita total */
      /* Hero: LUCRO em destaque, faturamento discreto */
      (function () {
        var totalFee   = totalPaid * ANUBIS_FEE_CENTS;
        var totalNet   = totalRev - totalFee;
        var marginPct  = totalRev > 0 ? Math.round((totalNet / totalRev) * 100) : 0;
        var netColor   = totalNet >= 0 ? '#22c55e' : '#ef4444';
        return '<div style="' +
          'background:linear-gradient(135deg,' + DARK + ' 0%,#0a1428 60%,#060e1c 100%);' +
          'border:1px solid rgba(34,197,94,.35);border-radius:var(--radius);' +
          'padding:28px 32px 24px;min-width:260px;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between' +
        '">' +
          '<div style="position:absolute;top:-40px;right:-40px;width:160px;height:160px;border-radius:50%;background:' + netColor + ';opacity:.09;pointer-events:none"></div>' +
          '<div style="position:absolute;bottom:-60px;left:-20px;width:180px;height:180px;border-radius:50%;background:' + netColor + ';opacity:.04;pointer-events:none"></div>' +
          '<div style="position:relative">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
              '<div style="font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:' + netColor + ';opacity:.9">💰 LUCRO LÍQUIDO · ' + (days === 1 ? 'HOJE' : 'ÚLTIMOS ' + days + ' DIAS') + '</div>' +
              '<button type="button" onclick="hubEditFee()" title="Editar taxa por venda" style="background:none;border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.4);border-radius:6px;padding:2px 8px;font-size:10px;cursor:pointer;font-family:inherit">⚙ taxa</button>' +
            '</div>' +
            '<div style="font-size:40px;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums;color:' + netColor + ';line-height:1;text-shadow:0 2px 20px ' + netColor + '33">' + esc(fmtMoney(totalNet)) + '</div>' +
            '<div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:8px;font-weight:500">Margem ' + marginPct + '% · ' + totalPaid + ' venda' + (totalPaid !== 1 ? 's' : '') + '</div>' +
          '</div>' +

          /* Breakdown discreto */
          '<div style="margin-top:22px;padding:14px 16px 12px;border-radius:10px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.06);position:relative">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
              '<span style="font-size:10px;color:rgba(255,255,255,.4);font-weight:500">Faturamento</span>' +
              '<span style="font-size:13px;color:rgba(255,255,255,.75);font-weight:700;font-variant-numeric:tabular-nums">' + esc(fmtMoney(totalRev)) + '</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<span style="font-size:10px;color:rgba(255,255,255,.4);font-weight:500">Taxa</span>' +
              '<span style="font-size:12px;color:#fca5a5;font-weight:600;font-variant-numeric:tabular-nums">−' + esc(fmtMoney(totalFee)) + '</span>' +
            '</div>' +
          '</div>' +

        '</div>';
      })() +

      /* Painel indicadores */
      '<div style="background:rgba(15,27,54,.6);border:1px solid rgba(4,90,205,.2);border-radius:var(--radius);padding:22px 24px;display:flex;align-items:center;justify-content:center">' +
        '<div style="display:grid;grid-template-columns:repeat(' + indicators.length + ',1fr);justify-items:center;align-items:center;width:100%">' +
        indicators.map(function (ind, i) {
          return '<div style="' +
            'padding:0 24px;' +
            (i > 0 ? 'border-left:1px solid rgba(4,90,205,.2);' : '') +
            'display:flex;flex-direction:column;align-items:center;text-align:center;width:100%' +
          '">' +
            iconBox(ind.icon) +
            '<div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:6px;font-weight:500;white-space:nowrap">' + esc(ind.label) + '</div>' +
            '<div style="font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;color:#fff;letter-spacing:-.02em;line-height:1">' + esc(ind.val) + '</div>' +
          '</div>';
        }).join('') +
        '</div>' +
      '</div>' +

      '</div>';
  }

  function renderSiteCards(allData, days) {
    days = days || 1;
    var grid = el('hubSitesGrid');
    if (!grid) return;
    if (!allData.length) { grid.innerHTML = ''; return; }

    grid.innerHTML = allData.map(function (d) {
      var site = d.site;
      var s = d.stats || {};
      var totals = s.totals || {};
      var revenue = totals.revenue_cents || 0;
      var paid = totals.payments || 0;
      var landing = totals.landing_sessions || 0;
      var pix = totals.pix_generated || 0;
      var conv = landing > 0 ? ((paid / landing) * 100).toFixed(1) : '0.0';
      var live = (s.live && s.live.total) || 0;
      var lastSale = null;
      var orders = s.orders || [];
      if (orders.length) lastSale = orders[orders.length - 1].ts || orders[orders.length - 1].paid_at;
      var hoursNoSale = lastSale ? (Date.now() - Number(lastSale)) / 3600000 : 999;
      var alertClass = !d.online ? 'bad' : hoursNoSale > 4 ? 'bad' : hoursNoSale > 2 ? 'warn' : 'ok';
      var alertLabel = !d.online ? '● Offline' : hoursNoSale > 4 ? hoursNoSale > 24 ? 'Sem vendas' : Math.floor(hoursNoSale) + 'h sem venda' : 'OK';
      var pendingPix = (s.pix_pending || []).length;
      var color = site.color || '#045acd';
      var statusColor = !d.online ? '#ef4444' : alertClass === 'warn' ? '#f59e0b' : '#22c55e';

      return '<div class="site-card" data-site="' + esc(site.id) + '" style="--card-color:' + esc(color) + ';padding:0;overflow:hidden;border-color:' + (d.online ? 'rgba(148,163,184,.12)' : 'rgba(239,68,68,.25)') + '">' +

        /* Barra topo colorida */
        '<div style="height:3px;background:linear-gradient(90deg,' + color + ',' + color + '88)"></div>' +

        '<div style="padding:18px 20px">' +

        /* Header: ícone + nome + status */
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">' +
          '<div style="width:42px;height:42px;border-radius:10px;background:' + color + '22;border:1px solid ' + color + '44;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">' + esc(site.icon || '🌐') + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(site.name) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">' + esc((site.apiUrl || '').replace(/^https?:\/\//, '')) + '</div>' +
          '</div>' +
          '<div class="status-dot ' + (d.online ? 'online' : 'offline') + '"></div>' +
        '</div>' +

        /* Lucro em destaque + faturamento pequeno */
        (function () {
          var siteFee = paid * ANUBIS_FEE_CENTS;
          var siteNet = revenue - siteFee;
          return '<div style="margin-bottom:16px">' +
            '<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px">Lucro</div>' +
            '<div style="font-size:26px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:' + (siteNet > 0 ? '#22c55e' : 'var(--text-muted)') + '">' + esc(fmtMoney(siteNet)) + '</div>' +
            (revenue > 0
              ? '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">Bruto ' + esc(fmtMoney(revenue)) + ' <span style="color:#fca5a5">−' + esc(fmtMoney(siteFee)) + '</span> taxa</div>'
              : '') +
          '</div>';
        })() +

        /* Grid 3 métricas */
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
          '<div style="background:rgba(255,255,255,.03);border-radius:8px;padding:9px 8px;text-align:center">' +
            '<div style="font-size:16px;font-weight:700;color:#f59e0b">' + esc(pix) + '</div>' +
            '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">PIX gerados</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.03);border-radius:8px;padding:9px 8px;text-align:center">' +
            '<div style="font-size:16px;font-weight:700;color:#22c55e">' + esc(paid) + '</div>' +
            '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">PIX pagos</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.03);border-radius:8px;padding:9px 8px;text-align:center">' +
            '<div style="font-size:16px;font-weight:700;color:#045acd">' + esc(conv) + '%</div>' +
            '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">Conversão</div>' +
          '</div>' +
        '</div>' +

        /* Footer */
        '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px solid var(--border)">' +
          '<span style="font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px;color:' + (live > 0 ? '#22c55e' : 'var(--text-muted)') + '">' +
            '<span style="width:7px;height:7px;border-radius:50%;background:' + (live > 0 ? '#22c55e' : 'var(--text-muted)') + ';' + (live > 0 ? 'animation:pulse .8s ease-in-out infinite;' : '') + 'display:inline-block"></span>' +
            live + ' ao vivo' +
          '</span>' +
          '<span style="font-size:11px;color:var(--text-muted)">' +
            (pendingPix ? '<span style="color:#f59e0b">⏳ ' + pendingPix + ' pendente(s)</span>' : lastSale ? 'Última venda ' + esc(fmtAgo(lastSale)) : 'Sem vendas') +
          '</span>' +
        '</div>' +

        '</div>' + /* fim padding */
      '</div>';
    }).join('');

    grid.querySelectorAll('.site-card').forEach(function (card) {
      card.addEventListener('click', function () { openSiteDetail(card.getAttribute('data-site')); });
    });
  }

  function renderHubRanking(allData) {
    var panel = el('hubRankingPanel');
    if (!panel) return;

    var sorted = allData.slice().sort(function (a, b) {
      return ((b.stats && b.stats.totals && b.stats.totals.revenue_cents) || 0) -
             ((a.stats && a.stats.totals && a.stats.totals.revenue_cents) || 0);
    });

    /* Ordena por lucro líquido em vez de receita */
    sorted = sorted.sort(function (a, b) {
      var ta = (a.stats && a.stats.totals) || {};
      var tb = (b.stats && b.stats.totals) || {};
      var netA = (ta.revenue_cents || 0) - (ta.payments || 0) * ANUBIS_FEE_CENTS;
      var netB = (tb.revenue_cents || 0) - (tb.payments || 0) * ANUBIS_FEE_CENTS;
      return netB - netA;
    });

    var maxNet   = Math.max(1, ((sorted[0] && sorted[0].stats && sorted[0].stats.totals) ? ((sorted[0].stats.totals.revenue_cents || 0) - (sorted[0].stats.totals.payments || 0) * ANUBIS_FEE_CENTS) : 1));
    var totalNet = sorted.reduce(function (s, d) {
      var t = (d.stats && d.stats.totals) || {};
      return s + ((t.revenue_cents || 0) - (t.payments || 0) * ANUBIS_FEE_CENTS);
    }, 0);

    var MEDALS = ['🥇', '🥈', '🥉'];

    panel.innerHTML = '<div style="display:flex;flex-direction:column;gap:14px">' +
      sorted.map(function (d, i) {
        var t       = (d.stats && d.stats.totals) || {};
        var rev     = t.revenue_cents || 0;
        var pix     = t.pix_generated || 0;
        var paid    = t.payments || 0;
        var net     = rev - paid * ANUBIS_FEE_CENTS;
        var color   = d.site.color || '#045acd';
        var barPct  = Math.max(4, Math.round((net / maxNet) * 100));
        var sharePct = totalNet > 0 ? Math.round((net / totalNet) * 100) : 0;
        var medal   = MEDALS[i] || ('#' + (i + 1));
        var isFirst = i === 0;

        return '<div style="' +
          'background:linear-gradient(135deg,rgba(18,26,46,.98),rgba(13,19,33,.95));' +
          'border:1px solid ' + (isFirst ? color + '55' : 'var(--border)') + ';' +
          'border-radius:12px;padding:16px 18px;position:relative;overflow:hidden;' +
          (isFirst ? 'box-shadow:0 4px 24px ' + color + '22;' : '') +
        '">' +

          /* Barra de fundo proporcional */
          '<div style="position:absolute;inset:0;width:' + barPct + '%;background:linear-gradient(90deg,' + color + '12,' + color + '04);border-radius:12px;pointer-events:none"></div>' +
          '<div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:' + color + ';border-radius:12px 0 0 12px;opacity:' + (isFirst ? '1' : '.5') + '"></div>' +

          '<div style="position:relative;display:flex;align-items:center;gap:12px">' +

            /* Medalha + posição */
            '<div style="font-size:' + (isFirst ? '22' : '18') + 'px;flex-shrink:0;width:28px;text-align:center">' + medal + '</div>' +

            /* Ícone do site */
            '<div style="width:36px;height:36px;border-radius:9px;background:' + color + '22;border:1px solid ' + color + '44;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0">' + esc(d.site.icon || '🌐') + '</div>' +

            /* Info */
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.site.name) + '</div>' +
              '<div style="display:flex;gap:10px;margin-top:3px">' +
                '<span style="font-size:11px;color:var(--text-muted)">⚡ ' + pix + ' gerados</span>' +
                '<span style="font-size:11px;color:var(--text-muted)">✅ ' + paid + ' pagos</span>' +
              '</div>' +
            '</div>' +

            /* Lucro + faturamento pequeno abaixo */
            '<div style="text-align:right;flex-shrink:0">' +
              '<div style="font-size:' + (isFirst ? '20' : '16') + 'px;font-weight:800;font-variant-numeric:tabular-nums;color:' + (net > 0 ? '#22c55e' : 'var(--text-muted)') + ';letter-spacing:-.02em">' + esc(fmtMoney(net)) + '</div>' +
              '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;font-weight:500">Bruto ' + esc(fmtMoney(rev)) + ' · ' + sharePct + '%</div>' +
            '</div>' +

          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  async function loadHubRecentEvents(allData, days) {
    days = days || 1;
    var panel = el('hubRecentEvents');
    if (!panel) return;

    /* Busca eventos frescos de cada site via endpoint sem cache */
    var allEvents = [];
    await Promise.allSettled(allData.map(async function (d) {
      try {
        var res = await fetch(
          proxyUrl(d.site.id, '/api/recent-events.php', 'limit=15&days=' + days + '&_t=' + Date.now()),
          { headers: apiHeaders(), cache: 'no-store' }
        );
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        (data.events || []).forEach(function (ev) {
          allEvents.push({
            site: d.site,
            type: ev.type === 'payment_paid' ? 'paid' : 'pix',
            ts: Number(ev.ts || 0),
            val: ev.amount_cents,
            product: ev.product_name,
            /* Dados enriquecidos do cliente */
            phone: ev.phone,
            pix_key: ev.pix_key,
            pix_key_type: ev.pix_key_type,
            valor_emprestimo: ev.valor_emprestimo,
            num_parcelas: ev.num_parcelas,
            renda_mensal: ev.renda_mensal,
            tipo_renda: ev.tipo_renda,
            dia_pagamento: ev.dia_pagamento,
            metodo_pagamento: ev.metodo_pagamento,
            lead_age: ev.lead_age,
            lead_gender: ev.lead_gender,
            transaction_id: ev.transaction_id,
            session_id: ev.session_id,
            city: ev.city,
            country: ev.country,
            traffic_src: ev.traffic_src,
          });
        });
      } catch (_) {
        /* fallback: usa stats.orders já carregados */
        var orders = (d.stats && d.stats.orders) || [];
        orders.slice(-5).forEach(function (o) {
          allEvents.push({ site: d.site, type: 'paid', ts: Number(o.ts || o.paid_at || 0), val: o.amount_cents, product: o.product_name });
        });
      }
    }));

    allEvents.sort(function (a, b) { return b.ts - a.ts; });

    if (!allEvents.length) {
      panel.innerHTML = '<div class="chart-empty" data-empty-type="orders"><strong>Sem eventos recentes</strong><small>Vendas e PIX de todos os sites aparecerão aqui.</small></div>';
      return;
    }

    /* Guarda os eventos no state para poder abrir modal por índice */
    state._lastRecentEvents = allEvents.slice(0, 15);

    panel.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">' +
      state._lastRecentEvents.map(function (ev, idx) {
        var isPaid   = ev.type === 'paid';
        var color    = ev.site.color || '#045acd';
        var typeColor = isPaid ? '#22c55e' : '#f59e0b';
        var typeBg    = isPaid ? 'rgba(34,197,94,.12)' : 'rgba(245,158,11,.12)';
        var typeBorder= isPaid ? 'rgba(34,197,94,.3)'  : 'rgba(245,158,11,.3)';
        var typeLabel = isPaid ? 'PAGO' : 'PIX';

        /* Preview inline de alguns dados do cliente */
        var previewBits = [];
        if (ev.phone)   previewBits.push('📱 ' + fmtPhone(ev.phone));
        if (ev.city)    previewBits.push('📍 ' + ev.city);
        if (ev.pix_key_type) previewBits.push('🔑 ' + ev.pix_key_type);
        var preview = previewBits.length ? previewBits.join(' · ') : ev.site.name;

        return '<div onclick="hubOpenEventModal(' + idx + ')" style="' +
          'display:flex;align-items:center;gap:10px;padding:11px 14px;' +
          'background:linear-gradient(135deg,rgba(18,26,46,.98),rgba(13,19,33,.95));' +
          'border:1px solid var(--border);border-left:3px solid ' + color + ';' +
          'border-radius:10px;transition:background .15s;cursor:pointer' +
        '" onmouseover="this.style.background=\'rgba(4,90,205,.06)\'" onmouseout="this.style.background=\'linear-gradient(135deg,rgba(18,26,46,.98),rgba(13,19,33,.95))\'">' +

          '<span style="' +
            'font-size:9px;font-weight:800;letter-spacing:.06em;padding:3px 8px;border-radius:999px;white-space:nowrap;flex-shrink:0;' +
            'background:' + typeBg + ';color:' + typeColor + ';border:1px solid ' + typeBorder +
          '">' + typeLabel + '</span>' +

          '<span style="font-size:13px;flex-shrink:0" title="' + esc(ev.site.name) + '">' + esc(ev.site.icon || '🌐') + '</span>' +

          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:12px;font-weight:500;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ev.product || '—') + '</div>' +
            '<div style="font-size:10px;color:var(--text-muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(preview) + '</div>' +
          '</div>' +

          '<span style="font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;color:' + typeColor + ';flex-shrink:0">' + fmtMoney(ev.val) + '</span>' +
          '<span style="font-size:11px;color:var(--text-muted);flex-shrink:0;min-width:48px;text-align:right">' + fmtAgo(ev.ts) + '</span>' +

        '</div>';
      }).join('') +
    '</div>';
  }

  function fmtPhone(p) {
    if (!p) return '';
    var d = String(p).replace(/\D/g, '');
    if (d.length === 13 && d.slice(0, 2) === '55') d = d.slice(2);
    if (d.length === 11) return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0,2) + ') ' + d.slice(2,6) + '-' + d.slice(6);
    return d;
  }

  function hubRenderEventModalBody(ev, journey) {
    var isPaid = ev.type === 'paid';
    var typeColor = isPaid ? '#22c55e' : '#f59e0b';
    var typeLabel = isPaid ? 'PIX PAGO' : 'PIX GERADO';

    function row(icon, label, val) {
      if (val === null || val === undefined || val === '') return '';
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:14px;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px">' + icon + ' ' + esc(label) + '</span>' +
        '<span style="font-size:13px;font-weight:600;color:var(--text);text-align:right;word-break:break-all">' + esc(val) + '</span>' +
      '</div>';
    }

    function section(title, rows) {
      var contentInner = rows.filter(Boolean).join('');
      if (!contentInner) return '';
      return '<div style="margin-bottom:20px">' +
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#60a5fa;margin-bottom:8px">' + esc(title) + '</div>' +
        contentInner +
      '</div>';
    }

    /* Mescla dados do journey (nome/CPF/email/meta) com os do evento */
    journey = journey || {};
    var customerName  = journey.customer_name || null;
    var customerDoc   = journey.customer_document || null;
    var customerEmail = journey.customer_email || null;
    var phone         = journey.phone || ev.phone || null;
    var pixKeyType    = journey.pix_key_type || ev.pix_key_type || null;
    var pixKeyRaw     = journey.pix_key || ev.pix_key || null;
    var meta          = journey.meta || {};

    var valorEmprest  = ev.valor_emprestimo || meta.valor_emprestimo || meta.loan_amount || null;
    var numParcelas   = ev.num_parcelas || meta.num_parcelas || meta.installments || null;
    var rendaMensal   = ev.renda_mensal || meta.renda_mensal || meta.monthly_income || null;
    var tipoRenda     = ev.tipo_renda || meta.tipo_renda || meta.income_type || null;
    var diaPagto      = ev.dia_pagamento || meta.dia_pagamento || meta.payment_day || null;
    var metodoPagto   = ev.metodo_pagamento || meta.metodo_pagamento || meta.payment_method_choice || null;

    var pixKeyDisplay = pixKeyRaw ? String(pixKeyRaw) : null;
    if (pixKeyDisplay && (pixKeyType === 'cpf' || pixKeyType === 'cnpj')) {
      var digits = pixKeyDisplay.replace(/\D/g, '');
      if (digits.length === 11) pixKeyDisplay = digits.slice(0,3) + '.' + digits.slice(3,6) + '.' + digits.slice(6,9) + '-' + digits.slice(9,11);
      else if (digits.length === 14) pixKeyDisplay = digits.slice(0,2) + '.' + digits.slice(2,5) + '.' + digits.slice(5,8) + '/' + digits.slice(8,12) + '-' + digits.slice(12,14);
      else pixKeyDisplay = digits;
    }

    /* Header com avatar do cliente */
    var initial = customerName ? customerName.trim().charAt(0).toUpperCase() : '?';
    var header;
    if (customerName) {
      header =
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:16px">' +
          '<div style="display:flex;align-items:center;gap:14px;min-width:0;flex:1">' +
            '<div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#045acd,#0349A8);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;flex-shrink:0;box-shadow:0 4px 14px rgba(4,90,205,.35)">' + esc(initial) + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:18px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(customerName) + '</div>' +
              (customerDoc ? '<div style="font-size:11px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;margin-top:2px">' + esc(customerDoc) + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0">' +
            '<span style="font-size:10px;font-weight:800;letter-spacing:.1em;padding:4px 10px;border-radius:999px;background:' + typeColor + '22;color:' + typeColor + ';border:1px solid ' + typeColor + '44">' + typeLabel + '</span>' +
            '<div style="font-size:22px;font-weight:800;color:' + typeColor + ';margin-top:8px;font-variant-numeric:tabular-nums">' + fmtMoney(ev.val) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">' + esc(ev.site.icon || '🌐') + ' ' + esc(ev.site.name) + '</div>' +
          '</div>' +
        '</div>';
    } else {
      header =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">' +
          '<div>' +
            '<span style="font-size:10px;font-weight:800;letter-spacing:.1em;padding:4px 10px;border-radius:999px;background:' + typeColor + '22;color:' + typeColor + ';border:1px solid ' + typeColor + '44">' + typeLabel + '</span>' +
            '<div style="font-size:22px;font-weight:800;color:' + typeColor + ';margin-top:8px;font-variant-numeric:tabular-nums">' + fmtMoney(ev.val) + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">' + fmtDate(ev.ts) + '</div>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-size:28px">' + esc(ev.site.icon || '🌐') + '</div>' +
            '<div style="font-size:12px;font-weight:600;color:var(--text)">' + esc(ev.site.name) + '</div>' +
          '</div>' +
        '</div>';
    }

    return header +
      section('Cliente', [
        row('📱', 'Telefone',   phone ? fmtPhone(phone) : null),
        row('✉',  'E-mail',     customerEmail),
        row('🎂', 'Idade',      ev.lead_age || journey.lead_age),
        row('⚧',  'Sexo',       journey.lead_gender_label || ev.lead_gender),
        row('📍', 'Cidade',     ev.city ? ev.city + (ev.country ? ' / ' + ev.country : '') : null),
      ]) +

      section('Chave PIX', [
        row('🔑', 'Tipo',       pixKeyType),
        row('#',  'Chave',      pixKeyDisplay),
      ]) +

      section('Empréstimo solicitado', [
        row('💰', 'Valor',           valorEmprest ? fmtCurrencyRaw(valorEmprest) : null),
        row('📅', 'Parcelas',        numParcelas ? numParcelas + 'x' : null),
        row('💵', 'Renda mensal',    rendaMensal ? fmtCurrencyRaw(rendaMensal) : null),
        row('💼', 'Tipo de renda',   tipoRenda),
        row('🗓', 'Dia de pagamento', diaPagto),
        row('💳', 'Método',          metodoPagto),
      ]) +

      section('Rastreio', [
        row('🎯', 'Fonte',         ev.traffic_src),
        row('#',  'Transaction ID', ev.transaction_id),
      ]);
  }

  window.hubOpenEventModal = async function (idx) {
    var ev = (state._lastRecentEvents || [])[idx];
    if (!ev) return;

    var modal = el('sessionModal');
    var body  = el('sessionModalContent') || el('sessionModalBody');
    var title = el('sessionModalTitle');
    if (!modal || !body) { alert('Modal não encontrado'); return; }
    if (title) title.textContent = 'Detalhes do cliente';
    modal.classList.remove('hidden');

    /* Render inicial com dados básicos + loader */
    body.innerHTML = hubRenderEventModalBody(ev, null) +
      '<div id="hubEventModalLoader" style="margin-top:8px;padding:10px 14px;background:rgba(4,90,205,.06);border:1px solid rgba(4,90,205,.15);border-radius:8px;font-size:11px;color:#60a5fa;text-align:center">⏳ Carregando dados do cliente…</div>';

    /* Busca a jornada completa (nome, CPF, email) */
    if (ev.session_id) {
      try {
        var res = await apiFetch(proxyUrl(ev.site.id, '/api/analytics.php', 'action=session&session_id=' + encodeURIComponent(ev.session_id) + '&days=7&_t=' + Date.now()));
        if (res.ok) {
          var data = await res.json();
          if (data.success && data.journey) {
            body.innerHTML = hubRenderEventModalBody(ev, data.journey);
            return;
          }
        }
      } catch (_) {}
    }
    /* Se não conseguiu, mostra só o que já tinha (sem loader) */
    body.innerHTML = hubRenderEventModalBody(ev, null);
  };

  function fmtCurrencyRaw(v) {
    var n = parseFloat(String(v).replace(/[^\d.,]/g, '').replace(',', '.'));
    if (isNaN(n)) return String(v);
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* ── Carteira ───────────────────────────────────────────────── */
  var carteiraState = { siteId: null };

  async function openCarteira() {
    showSection('carteira');
    loadCarteira();
  }

  async function loadCarteira() {
    var cont = el('carteiraContent');
    if (!cont) return;
    if (!state.sites.length) {
      cont.innerHTML = '<div class="chart-empty" data-empty-type="chart"><strong>Nenhum site cadastrado.</strong></div>';
      return;
    }

    cont.innerHTML = '<div class="chart-empty" data-empty-type="chart"><strong>Carregando carteira AnubisPay…</strong></div>';

    /* Chama diretamente o hub-server — sem passar pelo PHP do site */
    var bal = null, hist = null;

    try {
      var [balRes, histRes] = await Promise.allSettled([
        apiFetch('/api/anubis/balance').then(function (r) { return r.json(); }),
        apiFetch('/api/anubis/history?limit=20').then(function (r) { return r.json(); }),
      ]);
      bal  = balRes.status  === 'fulfilled' ? balRes.value  : null;
      hist = histRes.status === 'fulfilled' ? histRes.value : null;
    } catch (e) {
      bal = { ok: false, error: e.message };
    }

    if (!bal || !bal.ok) {
      var errMsg = (bal && bal.error) || 'Erro desconhecido';
      cont.innerHTML =
        '<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:var(--radius);padding:28px;text-align:center">' +
          '<div style="font-size:24px;margin-bottom:12px">⚠️</div>' +
          '<div style="font-size:14px;font-weight:700;color:#fca5a5;margin-bottom:8px">Não foi possível conectar à AnubisPay</div>' +
          '<div style="font-size:12px;background:rgba(0,0,0,.3);border-radius:8px;padding:10px 16px;color:var(--text-muted);display:inline-block;margin-top:4px">' + esc(errMsg) + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);margin-top:12px">Verifique ANUBIS_PUBLIC_KEY e ANUBIS_SECRET_KEY no <strong>.env</strong> do hub-server.</div>' +
        '</div>';
      return;
    }

    renderCarteira(null, bal, hist);
  }

  function renderCarteira(siteId, bal, hist) {
    var cont = el('carteiraContent');
    if (!cont) return;

    /* Saldo — tenta todos os campos possíveis da AnubisPay */
    var rawBal = bal && bal.ok ? (bal.balance || {}) : {};
    /* AnubisPay pode retornar { data: {...} } ou direto */
    var bd = rawBal.data || rawBal;

    function findField(obj, keys) {
      for (var k = 0; k < keys.length; k++) {
        var v = obj[keys[k]];
        if (v !== undefined && v !== null) return v;
      }
      return null;
    }

    var saldoDisp = findField(bd, ['available_amount','available','balance','amount','availableAmount','available_balance','saldo_disponivel','saldo']);
    var saldoPend = findField(bd, ['pending_amount','pending','blocked','blocked_amount','saldo_bloqueado','saldo_pendente','pendingAmount']);

    /* Converte para centavos se necessário (valores < 1000 provavelmente são em reais) */
    function toCents(v) {
      if (v === null || v === undefined) return null;
      var n = parseFloat(v);
      if (isNaN(n)) return null;
      return n < 500 && n !== 0 ? Math.round(n * 100) : Math.round(n);
    }
    saldoDisp = toCents(saldoDisp);
    saldoPend = toCents(saldoPend);

    var balError = (!bal || !bal.ok) ? (bal && bal.error ? bal.error : 'Erro ao carregar saldo') : null;
    /* Debug: mostra JSON bruto para identificar campos */
    var rawJson = JSON.stringify(rawBal, null, 2);

    /* Histórico */
    var transactions = [];
    if (hist && hist.ok) {
      var h = hist.history;
      if (Array.isArray(h)) transactions = h;
      else if (h && Array.isArray(h.data)) transactions = h.data;
      else if (h && Array.isArray(h.items)) transactions = h.items;
    }

    cont.innerHTML =

      /* ── Grid: Saldo + Formulário de saque ── */
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">' +

        /* Card saldo */
        '<div style="background:linear-gradient(135deg,#0F1B36,#0a1228);border:1px solid rgba(4,90,205,.3);border-radius:var(--radius);padding:28px;position:relative;overflow:hidden">' +
          '<div style="position:absolute;top:-40px;right:-40px;width:160px;height:160px;border-radius:50%;background:#045acd;opacity:.07;pointer-events:none"></div>' +
          '<div style="font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#60a5fa;margin-bottom:14px">SALDO DISPONÍVEL</div>' +
          (balError
            ? '<div style="color:#fca5a5;font-size:13px">⚠ ' + esc(balError) + '</div>'
            : '<div style="font-size:36px;font-weight:800;letter-spacing:-.04em;color:#fff;line-height:1;margin-bottom:8px">' +
                (saldoDisp !== null ? fmtMoney(typeof saldoDisp === 'number' && saldoDisp > 100 ? saldoDisp : saldoDisp * 100) : '—') +
              '</div>' +
              (saldoPend !== null && saldoPend > 0
                ? '<div style="font-size:12px;color:rgba(255,255,255,.4);margin-top:4px">⏳ ' + fmtMoney(typeof saldoPend === 'number' && saldoPend > 100 ? saldoPend : saldoPend * 100) + ' pendente</div>'
                : '') +
              '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(4,90,205,.2);font-size:11px;color:rgba(255,255,255,.35)">AnubisPay · Gateway ativo</div>' +
              /* Debug temporário */
              '<details style="margin-top:12px"><summary style="font-size:10px;color:rgba(255,255,255,.25);cursor:pointer">Ver resposta bruta da API</summary>' +
              '<pre style="font-size:9px;color:rgba(255,255,255,.3);overflow:auto;max-height:200px;margin-top:6px;white-space:pre-wrap">' + esc(rawJson) + '</pre></details>'
          ) +
        '</div>' +

        /* Formulário de saque */
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px">' +
          '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:18px">Solicitar saque</div>' +
          '<div style="display:flex;flex-direction:column;gap:12px">' +
            '<div><label style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Valor (R$)</label>' +
              '<input type="number" id="saqueValor" min="1" step="0.01" placeholder="0,00" style="width:100%;margin:0"></div>' +
            '<div><label style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Tipo de chave PIX</label>' +
              '<select id="saquePixTipo" style="width:100%;margin:0">' +
                '<option value="cpf">CPF</option>' +
                '<option value="cnpj">CNPJ</option>' +
                '<option value="email">E-mail</option>' +
                '<option value="phone">Telefone</option>' +
                '<option value="random">Chave aleatória</option>' +
              '</select></div>' +
            '<div><label style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Chave PIX</label>' +
              '<input type="text" id="saquePixChave" placeholder="Digite a chave PIX" style="width:100%;margin:0"></div>' +
            '<button type="button" class="btn btn-primary" id="saqueBtnConfirm" style="margin-top:4px">Solicitar saque</button>' +
            '<p id="saqueMsgOk"  class="hidden" style="font-size:12px;color:#86efac;margin:0"></p>' +
            '<p id="saqueMsgErr" class="hidden" style="font-size:12px;color:#fca5a5;margin:0"></p>' +
          '</div>' +
        '</div>' +

      '</div>' +

      /* ── Histórico de saques ── */
      '<div class="panel panel-full">' +
        '<div class="panel-head"><h3>Histórico de saques</h3><span>' + transactions.length + ' registro(s)</span></div>' +
        (transactions.length === 0
          ? '<div class="chart-empty" data-empty-type="chart"><strong>Nenhum saque encontrado</strong></div>'
          : '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>Data</th><th>Valor</th><th>Chave PIX</th><th>Status</th><th>ID</th>' +
            '</tr></thead><tbody>' +
            transactions.slice(0, 30).map(function (t) {
              var ts      = t.created_at || t.createdAt || t.date || '';
              var dateStr = ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
              var amt     = t.amount || t.value || 0;
              var amtFmt  = fmtMoney(amt > 1000 ? amt : amt * 100);
              var pix     = t.pix_key || t.pixKey || t.key || '—';
              var status  = (t.status || t.Status || 'pending').toLowerCase();
              var sColor  = status === 'paid' || status === 'completed' || status === 'approved' ? '#22c55e'
                          : status === 'pending' || status === 'processing' ? '#f59e0b' : '#ef4444';
              var tid     = t.id || t.Id || '—';
              return '<tr>' +
                '<td style="font-size:12px">' + esc(dateStr) + '</td>' +
                '<td class="num" style="font-weight:700;color:#22c55e">' + esc(amtFmt) + '</td>' +
                '<td style="font-family:monospace;font-size:11px">' + esc(String(pix).slice(0,30)) + '</td>' +
                '<td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:' + sColor + '22;color:' + sColor + ';border:1px solid ' + sColor + '44">' + esc(status) + '</span></td>' +
                '<td style="font-family:monospace;font-size:10px;color:var(--text-muted)">' + esc(String(tid).slice(0,16)) + '</td>' +
              '</tr>';
            }).join('') +
            '</tbody></table></div>'
        ) +
      '</div>';

    /* Botão de saque */
    var btn = el('saqueBtnConfirm');
    if (btn) btn.addEventListener('click', function () { confirmarSaque(siteId); });
  }

  async function confirmarSaque(siteId) {
    var valor  = parseFloat((el('saqueValor')    && el('saqueValor').value)    || '0');
    var tipo   = (el('saquePixTipo')  && el('saquePixTipo').value)  || 'cpf';
    var chave  = (el('saquePixChave') && el('saquePixChave').value.trim()) || '';

    var ok  = el('saqueMsgOk');
    var err = el('saqueMsgErr');
    if (ok)  { ok.classList.add('hidden');  ok.textContent  = ''; }
    if (err) { err.classList.add('hidden'); err.textContent = ''; }

    if (valor < 1)    { if (err) { err.textContent = 'Informe um valor mínimo de R$ 1,00'; err.classList.remove('hidden'); } return; }
    if (!chave)       { if (err) { err.textContent = 'Informe a chave PIX'; err.classList.remove('hidden'); } return; }

    if (!confirm('Confirmar saque de R$ ' + valor.toFixed(2).replace('.', ',') + ' para a chave ' + chave + '?')) return;

    var btn = el('saqueBtnConfirm');
    if (btn) { btn.disabled = true; btn.textContent = 'Processando…'; }

    try {
      var res  = await apiFetch('/api/anubis/withdraw', {
        method: 'POST',
        body: JSON.stringify({ amount_reais: valor, pix_key: chave, pix_key_type: tipo }),
      });
      var data = await res.json();
      if (data.ok) {
        if (ok) { ok.textContent = '✓ Saque solicitado com sucesso!'; ok.classList.remove('hidden'); }
        if (el('saqueValor'))    el('saqueValor').value    = '';
        if (el('saquePixChave')) el('saquePixChave').value = '';
        setTimeout(function () { loadCarteira(siteId); }, 2000);
      } else {
        if (err) { err.textContent = '✗ ' + (data.error || 'Erro ao solicitar saque'); err.classList.remove('hidden'); }
      }
    } catch (e) {
      if (err) { err.textContent = '✗ ' + e.message; err.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Solicitar saque'; }
    }
  }

  /* ── Hub Access Chart ───────────────────────────────────────── */
  window.hubChartMode = function (mode) {
    state._hubChartMode = mode;
    if (state._lastHubAllData) renderHubAccessChart(state._lastHubAllData, mode, state._lastHubDays || 1);
    /* botões */
    var btnPix = el('chartBtnPix'), btnRev = el('chartBtnRev');
    if (btnPix && btnRev) {
      var btnVis = el('chartBtnVis');
      var active = 'border:1px solid rgba(4,90,205,.6);background:rgba(4,90,205,.2);color:#60a5fa;font-weight:600';
      var idle   = 'border:1px solid rgba(255,255,255,.1);background:none;color:rgba(255,255,255,.35)';
      var base   = 'font-size:11px;padding:4px 14px;border-radius:999px;cursor:pointer;font-family:inherit;';
      btnPix.style.cssText = base + (mode === 'pix' ? active : idle);
      btnRev.style.cssText = base + (mode === 'rev' ? active : idle);
      if (btnVis) btnVis.style.cssText = base + (mode === 'vis' ? active : idle);
    }
    var sub = el('hubChartSubtitle');
    if (sub) sub.textContent = mode === 'rev' ? 'Receita por hora (R$)' : mode === 'vis' ? 'Visitantes por hora (page views)' : 'PIX gerados por hora';
  };

  function renderHubAccessChart(allData, mode, days) {
    days = days || 1;
    var cont = el('hubAccessChart');
    var wrap = el('hubAccessChartWrap');
    if (!cont || !allData.length) { if (wrap) wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');

    /* Atualiza subtítulo com período */
    var sub2 = el('hubChartSubtitle');
    if (sub2) {
      var modeLabel = mode === 'rev' ? 'Receita (R$)' : mode === 'vis' ? 'Visitantes' : 'PIX gerados';
      sub2.textContent = modeLabel + ' · ' + (days === 1 ? 'hoje' : 'últimos ' + days + ' dias') + ' · por hora';
    }

    var CHART_COLOR = '#3b82f6';

    /* Agrega dados horários incluindo visitantes */
    var hourly = [];
    for (var h = 0; h < 24; h++) hourly[h] = { h: h, pix: 0, rev: 0, visitors: 0, paid: 0 };
    allData.forEach(function (d) {
      ((d.stats && d.stats.hourly_activity) || []).forEach(function (row) {
        var hi = row.hour != null ? row.hour : 0;
        if (hi >= 0 && hi < 24) {
          hourly[hi].pix      += row.pix_generated || 0;
          hourly[hi].rev      += row.revenue_cents || 0;
          hourly[hi].visitors += row.page_views    || 0;
          hourly[hi].paid     += row.payments      || 0;
        }
      });
    });

    var vals   = hourly.map(function (h) { return mode === 'rev' ? h.rev : mode === 'vis' ? h.visitors : h.pix; });
    var maxVal = Math.max(1, Math.max.apply(null, vals));

    var W = 1000, H = 180, pL = 52, pR = 16, pT = 16, pB = 28;
    var cW = W - pL - pR, cH = H - pT - pB;

    var pts = vals.map(function (v, i) {
      return { x: pL + (i / 23) * cW, y: pT + cH - (v / maxVal) * cH };
    });

    function bezierPath(p) {
      var d = 'M ' + p[0].x.toFixed(1) + ' ' + p[0].y.toFixed(1);
      for (var i = 1; i < p.length; i++) {
        var cp = (p[i-1].x + p[i].x) / 2;
        d += ' C ' + cp.toFixed(1) + ' ' + p[i-1].y.toFixed(1) + ' ' + cp.toFixed(1) + ' ' + p[i].y.toFixed(1) + ' ' + p[i].x.toFixed(1) + ' ' + p[i].y.toFixed(1);
      }
      return d;
    }

    var line = bezierPath(pts);
    var area = line + ' L ' + pts[23].x.toFixed(1) + ' ' + (pT+cH) + ' L ' + pL + ' ' + (pT+cH) + ' Z';

    var yLabels = '', xLabels = '', xGrid = '';
    for (var yi = 0; yi <= 4; yi++) {
      var pct = yi / 4;
      var yy  = (pT + cH - pct * cH).toFixed(1);
      var yv  = maxVal * pct;
      var lbl = mode === 'rev' ? 'R$ ' + Math.round(yv / 100) : Math.round(yv) + (mode === 'vis' ? '' : '');
      yLabels += '<text x="' + (pL-6) + '" y="' + (parseFloat(yy)+3.5) + '" text-anchor="end" fill="rgba(148,163,184,.4)" font-size="9.5" font-family="JetBrains Mono,monospace">' + lbl + '</text>';
      yLabels += '<line x1="' + pL + '" y1="' + yy + '" x2="' + (W-pR) + '" y2="' + yy + '" stroke="rgba(255,255,255,.04)" stroke-width="1"/>';
    }
    for (var xi = 0; xi <= 23; xi += 2) {
      var xx = (pL + (xi/23)*cW).toFixed(1);
      xLabels += '<text x="' + xx + '" y="' + (H-6) + '" text-anchor="middle" fill="rgba(148,163,184,.4)" font-size="9.5" font-family="JetBrains Mono,monospace">' + (xi<10?'0':'') + xi + ':00</text>';
      xGrid   += '<line x1="' + xx + '" y1="' + pT + '" x2="' + xx + '" y2="' + (pT+cH) + '" stroke="rgba(255,255,255,.04)" stroke-width="1"/>';
    }

    var maxIdx = vals.indexOf(Math.max.apply(null,vals));

    cont.innerHTML =
      '<div style="position:relative">' +
      '<svg id="hubChartSvg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:180px;display:block;cursor:crosshair" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">' +
        '<defs>' +
          '<linearGradient id="hubAreaGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="' + CHART_COLOR + '" stop-opacity="0.4"/>' +
            '<stop offset="65%" stop-color="' + CHART_COLOR + '" stop-opacity="0.08"/>' +
            '<stop offset="100%" stop-color="' + CHART_COLOR + '" stop-opacity="0"/>' +
          '</linearGradient>' +
          '<filter id="hubGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
        '</defs>' +
        xGrid + yLabels +
        '<path d="' + area + '" fill="url(#hubAreaGrad)"/>' +
        '<path d="' + line + '" fill="none" stroke="' + CHART_COLOR + '" stroke-width="2.5" stroke-linecap="round" filter="url(#hubGlow)"/>' +
        '<line id="hubChartCrosshair" x1="0" y1="' + pT + '" x2="0" y2="' + (pT+cH) + '" stroke="rgba(59,130,246,.5)" stroke-width="1" stroke-dasharray="4,3" display="none"/>' +
        '<circle id="hubChartDot" cx="0" cy="0" r="5" fill="' + CHART_COLOR + '" stroke="rgba(59,130,246,.35)" stroke-width="8" display="none" filter="url(#hubGlow)"/>' +
        (maxIdx >= 0 ? '<circle cx="' + pts[maxIdx].x.toFixed(1) + '" cy="' + pts[maxIdx].y.toFixed(1) + '" r="4" fill="' + CHART_COLOR + '" stroke="rgba(59,130,246,.3)" stroke-width="7" filter="url(#hubGlow)"/>' : '') +
        xLabels +
      '</svg>' +
      '<div id="hubChartTooltip" style="display:none;position:absolute;top:10px;pointer-events:none;z-index:10;' +
        'background:rgba(10,20,40,.95);border:1px solid rgba(59,130,246,.4);border-radius:10px;padding:10px 14px;min-width:160px;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.5);backdrop-filter:blur(8px)">' +
      '</div>' +
      '</div>';

    /* Interatividade hover */
    var svg    = document.getElementById('hubChartSvg');
    var tip    = document.getElementById('hubChartTooltip');
    var cross  = document.getElementById('hubChartCrosshair');
    var dot    = document.getElementById('hubChartDot');

    if (!svg || !tip) return;

    svg.addEventListener('mousemove', function (e) {
      var rect  = svg.getBoundingClientRect();
      var relX  = (e.clientX - rect.left) / rect.width;
      var svgX  = relX * W;
      var idx   = Math.round((svgX - pL) / cW * 23);
      idx = Math.max(0, Math.min(23, idx));
      var d = hourly[idx];
      var p = pts[idx];

      cross.setAttribute('x1', p.x.toFixed(1));
      cross.setAttribute('x2', p.x.toFixed(1));
      cross.setAttribute('display', '');
      dot.setAttribute('cx', p.x.toFixed(1));
      dot.setAttribute('cy', p.y.toFixed(1));
      dot.setAttribute('display', '');

      var revFmt = 'R$ ' + (d.rev / 100).toFixed(2).replace('.', ',');
      tip.innerHTML =
        '<div style="font-size:11px;font-weight:700;color:#93c5fd;margin-bottom:8px;letter-spacing:.04em">' + (idx<10?'0':'') + idx + ':00h</div>' +
        '<div style="display:flex;flex-direction:column;gap:5px">' +
          '<div style="display:flex;justify-content:space-between;gap:16px;font-size:12px">' +
            '<span style="color:rgba(255,255,255,.5)">👁 Visitantes</span>' +
            '<strong style="color:#fff">' + d.visitors + '</strong>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;gap:16px;font-size:12px">' +
            '<span style="color:rgba(255,255,255,.5)">⚡ PIX gerados</span>' +
            '<strong style="color:#f59e0b">' + d.pix + '</strong>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;gap:16px;font-size:12px">' +
            '<span style="color:rgba(255,255,255,.5)">✅ PIX pagos</span>' +
            '<strong style="color:#22c55e">' + d.paid + '</strong>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;gap:16px;font-size:12px;border-top:1px solid rgba(255,255,255,.08);padding-top:5px;margin-top:2px">' +
            '<span style="color:rgba(255,255,255,.5)">💰 Receita</span>' +
            '<strong style="color:#3b82f6">' + revFmt + '</strong>' +
          '</div>' +
        '</div>';

      /* Posiciona o tooltip: à esquerda se cursor está na direita */
      var tipLeft = relX > 0.65 ? (e.clientX - rect.left - 180) + 'px' : (e.clientX - rect.left + 14) + 'px';
      tip.style.left = tipLeft;
      tip.style.display = 'block';
    });

    svg.addEventListener('mouseleave', function () {
      tip.style.display = 'none';
      cross.setAttribute('display', 'none');
      dot.setAttribute('display', 'none');
    });
  }

  /* ── Hub Overview Charts (legado removido) ──────────────────── */
  function renderHubBarChart(containerId, allData, field, labelFn, emptyText) {
    var el2 = el(containerId);
    if (!el2) return;
    var rows = allData.map(function (d) {
      var t = (d.stats && d.stats.totals) || {};
      return { name: d.site.name, icon: d.site.icon || '🌐', color: d.site.color || '#045acd', val: t[field] || 0, online: d.online };
    }).sort(function (a, b) { return b.val - a.val; });
    var max = Math.max(1, rows[0] ? rows[0].val : 1);
    if (!rows.some(function (r) { return r.val > 0; })) {
      el2.innerHTML = '<div class="chart-empty" data-empty-type="chart"><strong>' + esc(emptyText) + '</strong></div>';
      return;
    }
    el2.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px">' +
      rows.map(function (r) {
        var pct = Math.max(4, Math.round((r.val / max) * 100));
        return '<div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
            '<span style="font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px">' +
              '<span style="font-size:14px">' + esc(r.icon) + '</span>' + esc(r.name) +
              (!r.online ? '<span style="font-size:9px;color:#fca5a5;background:rgba(239,68,68,.15);padding:1px 6px;border-radius:4px">offline</span>' : '') +
            '</span>' +
            '<strong style="font-size:12px;color:' + r.color + '">' + esc(labelFn(r.val)) + '</strong>' +
          '</div>' +
          '<div style="height:8px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:' + r.color + ';border-radius:999px;transition:width .4s"></div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function renderHubRevenueChart(allData) {
    renderHubBarChart('hubRevenueChart', allData, 'revenue_cents', fmtMoney, 'Sem receita hoje');
  }

  function renderHubPixChart(allData) {
    renderHubBarChart('hubPixChart', allData, 'pix_generated', function (v) { return v + ' PIX'; }, 'Sem PIX gerados hoje');
  }

  function renderHubCombinedHourly(allData) {
    var cont = el('hubCombinedHourly');
    if (!cont) return;
    /* Agrega hourly_activity de todos os sites */
    var combined = [];
    for (var h = 0; h < 24; h++) {
      combined[h] = { hour: h, label: (h < 10 ? '0' : '') + h + 'h', pix_generated: 0, payments: 0, page_views: 0 };
    }
    allData.forEach(function (d) {
      var hourly = (d.stats && d.stats.hourly_activity) || [];
      hourly.forEach(function (row) {
        var h = row.hour != null ? row.hour : 0;
        if (h >= 0 && h < 24) {
          combined[h].pix_generated += row.pix_generated || 0;
          combined[h].payments      += row.payments      || 0;
          combined[h].page_views    += row.page_views    || 0;
        }
      });
    });
    var hasData = combined.some(function (h) { return h.pix_generated > 0 || h.payments > 0; });
    if (!hasData) {
      cont.innerHTML = '<div class="chart-empty" data-empty-type="chart"><strong>Sem atividade hoje</strong></div>';
      return;
    }
    /* Renderiza com o mesmo renderHourlyBars */
    renderHourlyBars(cont, combined);
    /* Adiciona legenda de sites */
    var legend = allData.map(function (d) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted)">' +
        '<span style="width:8px;height:8px;border-radius:2px;background:' + (d.site.color || '#045acd') + ';display:inline-block"></span>' +
        esc(d.site.icon || '🌐') + ' ' + esc(d.site.name) +
      '</span>';
    }).join('');
    cont.innerHTML += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">' + legend + '</div>';
  }

  function updateSidebarDots(allData) {
    allData.forEach(function (d) { setSiteDot(d.site.id, d.online); });
  }

  function updateOverviewBadge(allData) {
    var bad = allData.filter(function (d) {
      if (!d.online) return true;
      var lastSale = null;
      var orders = (d.stats && d.stats.orders) || [];
      if (orders.length) lastSale = orders[orders.length - 1].ts || orders[orders.length - 1].paid_at;
      return lastSale && (Date.now() - Number(lastSale)) / 3600000 > 4;
    }).length;
    var badge = el('overviewAlertsBadge');
    if (badge) {
      badge.textContent = bad > 0 ? bad : '';
      badge.classList.toggle('hidden', bad === 0);
    }
  }

  /* ── Site Detail ─────────────────────────────────────────────── */
  async function openSiteDetail(siteId) {
    var site = state.sites.find(function (s) { return s.id === siteId; });
    if (!site) return;

    state.currentSiteId = siteId;
    showSection('site-detail');
    showSubTab('overview');

    // Update header
    el('siteDetailName').textContent = site.name;
    var urlEl = el('siteDetailUrl');
    if (urlEl) {
      var cleanUrl = (site.apiUrl || '').replace(/\/$/, '');
      urlEl.textContent = cleanUrl.replace(/^https?:\/\//, '') + ' ↗';
      urlEl.href = cleanUrl || '#';
    }
    el('siteDetailIcon').textContent = site.icon || '🌐';
    el('siteDetailIcon').style.setProperty('--site-color', site.color || '#045acd');

    // Mark sidebar item as active
    document.querySelectorAll('.nav-item[data-site]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-site') === siteId);
    });
    document.querySelector('.nav-item[data-nav="hub-overview"]').classList.remove('active');

    // Load config into config tab
    loadSiteConfig(site);

    // Load pixels
    loadSitePixels(siteId);

    // Load env config
    loadSiteEnvConfig(siteId);

    // Fetch and render stats
    await refreshSiteDetail();

    // Start auto-refresh — 30s para dados ao vivo
    clearInterval(state.siteTimer);
    state.siteTimer = setInterval(refreshSiteDetail, 20000);
  }

  async function refreshSiteDetail() {
    if (!state.currentSiteId) return;
    var siteId = state.currentSiteId;
    var days = (el('siteDetailPeriod') && el('siteDetailPeriod').value) || '1';

    setLoadingBar(true);
    hideEl('siteStatsError');

    var statusDot = el('siteDetailStatus');
    if (statusDot) statusDot.className = 'status-dot checking';

    try {
      var [online, stats] = await Promise.allSettled([
        fetchSiteHealth(siteId),
        fetchSiteStats(siteId, days, true), /* bustCache = true */
      ]);

      var isOnline = online.status === 'fulfilled' && online.value;
      if (statusDot) statusDot.className = 'status-dot ' + (isOnline ? 'online' : 'offline');
      setSiteDot(siteId, isOnline);

      if (stats.status === 'rejected') throw stats.reason;
      var statsData = stats.value;

      state.lastSiteRefresh = Date.now();
      renderSiteStats(statsData);

    } catch (e) {
      if (statusDot) statusDot.className = 'status-dot offline';
      var errEl = el('siteStatsError');
      if (errEl) { errEl.textContent = 'Erro ao carregar: ' + e.message; showEl('siteStatsError'); }
    } finally {
      setLoadingBar(false);
    }
  }

  function renderSiteStats(stats) {
    stats = stats || {};

    // Live count badge no topo
    var liveTotal = (stats.live && !stats.live.disabled) ? (stats.live.total || 0) : 0;
    var badge = el('liveCountBadge');
    var num   = el('liveCountNum');
    if (badge && num) {
      num.textContent = liveTotal;
      if (liveTotal > 0) { badge.classList.remove('hidden'); badge.style.display = 'inline-flex'; }
      else { badge.classList.add('hidden'); }
    }

    // Init CredpixAnalyticsPanel helpers
    if (window.CredpixAnalyticsPanel) {
      CredpixAnalyticsPanel.init({
        esc: esc,
        fmtDate: fmtDate,
        fmtTime: fmtTime,
        fmtAgo: fmtAgo,
        countryLabel: countryLabel,
        chartEmpty: chartEmpty,
        apiBase: function () { return '/api/proxy/' + encodeURIComponent(state.currentSiteId) + '/api/analytics.php'; },
        authHeaders: apiHeaders,
        renderUtmifyBadges: renderUtmifyBadges,
        renderBadges: renderUtmifyBadges,
        currentStats: stats,
      });
      CredpixAnalyticsPanel.render(stats);
      CredpixAnalyticsPanel.renderOverviewInsights(stats);
      CredpixAnalyticsPanel.renderOverviewPanels(stats);
      CredpixAnalyticsPanel.renderOrdersTables(stats);
      CredpixAnalyticsPanel.renderCampaignsPanels(stats);
      CredpixAnalyticsPanel.renderPixHourlyConversion(stats);
      CredpixAnalyticsPanel.renderMainPriceComparison(stats);
    }

    // Render sections that analytics-panel.js doesn't cover directly
    renderSiteKpis(stats);
    renderOverviewFunnel(stats);
    renderOverviewInline(stats);
    renderSiteRecentFeed(stats);
    renderUpsells(stats);
  }

  function renderSystemStatusBar(sys) {
    var bar = el('siteSystemStatusBar');
    if (!bar) return;
    if (!sys) { hideEl('siteSystemStatusBar'); return; }
    showEl('siteSystemStatusBar');
    var pills = '';
    if (sys.cf_geo_pct != null) pills += '<span>CF Geo <span class="status-pill ' + (sys.cf_geo_pct >= 80 ? 'ok' : 'warn') + '">' + sys.cf_geo_pct + '%</span></span>';
    if (sys.utmify_ok != null) pills += '<span>Utmify <span class="status-pill ' + (sys.utmify_ok ? 'ok' : 'warn') + '">' + (sys.utmify_ok ? 'OK' : 'Warn') + '</span></span>';
    if (sys.webhooks_ok != null) pills += '<span>Webhooks <span class="status-pill ' + (sys.webhooks_ok ? 'ok' : 'bad') + '">' + (sys.webhooks_ok ? 'OK' : 'Bad') + '</span></span>';
    if (sys.storage_kb) pills += '<span style="color:var(--text-muted)">Storage: ' + esc(sys.storage_kb) + ' KB</span>';
    if (sys.last_event_ts) pills += '<span style="color:var(--text-muted)">Último evento: ' + esc(fmtAgo(sys.last_event_ts)) + '</span>';
    if (sys.last_sale_ts) pills += '<span style="color:var(--success);font-weight:600">Última venda ' + esc(fmtMoney(sys.last_sale_cents)) + ' · ' + esc(fmtAgo(sys.last_sale_ts)) + '</span>';
    bar.innerHTML = pills || '<span style="color:var(--text-muted)">Sistema OK</span>';
  }

  function renderSiteKpis(stats) {
    var t = stats.totals || {};
    var overviewEl = el('siteOverviewKpis');
    if (overviewEl) {
      var liveRaw = (stats.live && !stats.live.disabled) ? (stats.live.sessions || null) : null;
      /* sessions pode vir como objeto {sid: {...}} ou array — normaliza para array */
      var liveSessions = liveRaw
        ? (Array.isArray(liveRaw) ? liveRaw : Object.values(liveRaw))
        : null;

      function liveCountPage(test) {
        if (!liveSessions) return null;
        return liveSessions.filter(test).length;
      }

      var landingLive = liveCountPage(function (s) {
        var p = s.page || '';
        var l = s.page_label || '';
        /* Conta como Landing: /analise, root /, page_label Landing/Início */
        return l === 'Landing' || l === 'Início'
          || p === '/analise' || p === '/analise/' || p.indexOf('/analise/') === 0
          || p === '/' || /\/index\.html$/i.test(p);
      });

      var wizardLive = liveCountPage(function (s) {
        return (s.page_label || '') === 'Wizard' || (s.page || '').indexOf('/type/wizard') !== -1;
      });

      function liveKpi(label, liveVal, periodVal, color) {
        var isLive = liveVal !== null;
        var dot = isLive
          ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#22c55e;animation:pulse .8s ease-in-out infinite;margin-right:4px;vertical-align:middle"></span>'
          : '';
        var sub = isLive
          ? '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">ao vivo</div>'
          : '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">no período</div>';
        return '<div class="kpi" style="--kpi-accent:' + color + '">' +
          '<div class="kpi-label">' + dot + esc(label) + '</div>' +
          '<div class="kpi-value">' + esc(isLive ? liveVal : periodVal) + '</div>' +
          sub +
        '</div>';
      }

      /* Últimos timestamps: PIX gerado / PIX pago */
      var siteLastPaidTs = 0, siteLastPixTs = 0;
      (stats.orders || []).forEach(function (o) {
        var ts = Number(o.ts || o.paid_at || 0);
        if (ts > siteLastPaidTs) siteLastPaidTs = ts;
      });
      (stats.pix_pending || []).forEach(function (p) {
        var ts = Number(p.ts || p.created_at || 0);
        if (ts > siteLastPixTs) siteLastPixTs = ts;
      });
      (stats.recent || []).forEach(function (r) {
        var ts = Number(r.ts || 0);
        if (r.type === 'payment_paid' && ts > siteLastPaidTs) siteLastPaidTs = ts;
        if (r.type === 'pix_generated' && ts > siteLastPixTs) siteLastPixTs = ts;
      });

      overviewEl.innerHTML =
        liveKpi('Landing', landingLive, t.landing_sessions || 0, '#045acd') +
        liveKpi('Funil',   wizardLive,  t.wizard_sessions  || 0, '#06b6d4') +
        [
          { label:'PIX gerados',  val: t.pix_generated || 0, color:'#f59e0b', sub: siteLastPixTs  ? fmtAgo(siteLastPixTs)  : null },
          { label:'PIX pagos',    val: t.payments || 0,      color:'#22c55e', sub: siteLastPaidTs ? fmtAgo(siteLastPaidTs) : null },
          { label:'Receita',      val: fmtMoney(t.revenue_cents), color:'#22c55e' },
          { label:'Ticket médio', val: fmtMoney(t.avg_ticket_cents), color:'#045acd' },
          { label:'Conversão',    val: (t.conversion_rate || 0) + '%', color:'#06b6d4' },
        ].map(function (k) {
          return '<div class="kpi" style="--kpi-accent:' + k.color + '"><div class="kpi-label">' + esc(k.label) + '</div>' +
            '<div class="kpi-value">' + esc(k.val) + '</div>' +
            (k.sub ? '<div style="font-size:10px;color:var(--text-muted);margin-top:4px">há ' + esc(k.sub) + '</div>' : '') +
          '</div>';
        }).join('');
    }

    var campKpisEl = el('campaignsKpis');
    if (campKpisEl) {
      var campaigns = stats.campaigns || [];
      var totalInvest = campaigns.reduce(function (s, c) { return s + (c.spend_cents || 0); }, 0);
      var totalRoas = totalInvest > 0 ? (((t.revenue_cents || 0) / totalInvest)).toFixed(2) : '—';
      campKpisEl.innerHTML = [
        { label:'Campanhas ativas', val: campaigns.length, color:'#045acd' },
        { label:'Total investido', val: fmtMoney(totalInvest), color:'#f59e0b' },
        { label:'ROAS total', val: totalRoas === '—' ? '—' : totalRoas + 'x', color:'#22c55e' },
        { label:'Receita (campanha)', val: fmtMoney(t.revenue_cents), color:'#22c55e' },
      ].map(function (k) {
        return '<div class="kpi" style="--kpi-accent:' + k.color + '"><div class="kpi-label">' + esc(k.label) + '</div>' +
          '<div class="kpi-value">' + esc(k.val) + '</div></div>';
      }).join('');
    }

    var ordKpisEl = el('ordersKpis');
    if (ordKpisEl) {
      var orders = stats.orders || [];
      var pix_pending = stats.pix_pending || [];
      ordKpisEl.innerHTML = [
        { label:'Pedidos pagos', val: orders.length, color:'#22c55e' },
        { label:'PIX pendentes', val: pix_pending.length, color:'#f59e0b' },
        { label:'Receita total', val: fmtMoney(t.revenue_cents), color:'#22c55e' },
        { label:'Ticket médio', val: fmtMoney(t.avg_ticket_cents), color:'#045acd' },
      ].map(function (k) {
        return '<div class="kpi" style="--kpi-accent:' + k.color + '"><div class="kpi-label">' + esc(k.label) + '</div>' +
          '<div class="kpi-value">' + esc(k.val) + '</div></div>';
      }).join('');
    }
  }

  function renderOverviewFunnel(stats) {
    var funnelEl = el('overviewFunnel');
    if (!funnelEl) return;
    var t = stats.totals || {};
    var steps = [
      { label: 'Landing',    count: t.landing_sessions || 0, color: '#045acd' },
      { label: 'Funil',      count: t.wizard_sessions  || 0, color: '#06b6d4' },
      { label: 'PIX Gerado', count: t.pix_generated    || 0, color: '#f59e0b' },
      { label: 'PIX Pago',   count: t.payments         || 0, color: '#22c55e' },
    ].filter(function (s) { return s.count > 0; });

    if (!steps.length) {
      funnelEl.innerHTML = chartEmpty('funnel', 'Sem dados de funil', 'Aguardando eventos no período.');
      return;
    }

    var globalMax = Math.max.apply(null, steps.map(function (s) { return s.count; }));
    if (globalMax < 1) globalMax = 1;

    funnelEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px">' +
      steps.map(function (s, i) {
        var pct     = Math.max(Math.round((s.count / globalMax) * 100), 8);
        var prev    = i > 0 ? steps[i - 1].count : null;
        var anomaly = prev !== null && s.count > prev;
        var drop    = prev !== null && !anomaly ? (100 - Math.round((s.count / prev) * 100)) : 0;
        return '<div style="display:flex;align-items:center;gap:12px">' +
          '<div style="width:32px;text-align:right;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0;color:' + s.color + '">' + s.count + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;font-weight:500">' + esc(s.label) +
              (anomaly ? ' <span style="font-size:9px;color:#f59e0b;background:rgba(245,158,11,.15);padding:1px 5px;border-radius:4px">↑ direto</span>' : '') +
            '</div>' +
            '<div style="height:22px;border-radius:5px;background:rgba(255,255,255,.05);overflow:hidden;position:relative">' +
              '<div style="position:absolute;inset:0;width:' + pct + '%;background:linear-gradient(90deg,' + s.color + '66,' + s.color + '33);border-radius:5px"></div>' +
              '<div style="position:absolute;inset:0;width:' + pct + '%;background:' + s.color + ';opacity:.25;border-radius:5px"></div>' +
              '<div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:' + s.color + ';border-radius:5px 0 0 5px"></div>' +
            '</div>' +
            (drop > 0 ? '<div style="font-size:10px;color:rgba(239,68,68,.7);margin-top:2px">▼ ' + drop + '% queda</div>' : '') +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function renderOverviewInline(stats) {
    // Funnel dropoff
    var dropEl = el('funnelDropoffPanel');
    if (dropEl) {
      var dropoff = (stats.funnel && stats.funnel.dropoff) || [];
      if (!dropoff.length) {
        dropEl.innerHTML = chartEmpty('funnel', 'Sem dados');
      } else {
        dropEl.innerHTML = '<div class="table-wrap"><table class="insight-table"><thead><tr>' +
          '<th>Etapa</th><th class="num">Sessões</th><th class="num">Queda</th><th class="num">Retenção</th>' +
          '</tr></thead><tbody>' +
          dropoff.map(function (r) {
            var drop    = r.drop_from_prev_pct || 0;
            var retain  = r.retain_from_landing_pct || 0;
            var isFirst = r.step === 'landing';

            /* Queda: negativa = mais sessões que a etapa anterior (ex: funil > landing) */
            var dropCell;
            if (isFirst) {
              dropCell = '<span style="color:var(--text-muted)">—</span>';
            } else if (drop < 0) {
              dropCell = '<span style="color:#22c55e;font-weight:600">↑ entrada direta</span>';
            } else if (drop === 0) {
              dropCell = '<span style="color:var(--text-muted)">—</span>';
            } else {
              dropCell = '<span style="color:#ef4444">▼ ' + drop + '%</span>';
            }

            /* Retenção: > 100% = entrou direto sem passar pela landing */
            var retainCell;
            if (isFirst) {
              retainCell = '<span style="color:var(--text-muted)">base</span>';
            } else if (retain > 100) {
              retainCell = '<span style="color:#f59e0b" title="Mais sessões que a landing — acesso direto">↑ direto</span>';
            } else {
              retainCell = retain + '%';
            }

            return '<tr>' +
              '<td><strong>' + esc(r.label) + '</strong></td>' +
              '<td class="num" style="font-variant-numeric:tabular-nums">' + esc(r.count) + '</td>' +
              '<td class="num">' + dropCell + '</td>' +
              '<td class="num">' + retainCell + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>';
      }
    }

    // Conversion times
    var ctEl = el('conversionTimesPanel');
    if (ctEl) {
      var ct = stats.conversion_times;
      if (!ct) {
        ctEl.innerHTML = chartEmpty('chart', 'Sem dados de tempo', 'Precisa haver visitas + PIX gerados na mesma sessão para calcular.');
      } else {
        var samples = ct.samples || {};

        var CT_STEPS = [
          {
            key: 'landing_to_pix',
            title: 'Da chegada até gerar o PIX',
            explain: 'Quanto tempo o visitante passa no wizard antes de gerar o PIX',
            icon: '👀→⚡',
            val: ct.landing_to_pix_label,
            n: samples.landing_to_pix,
          },
          {
            key: 'pix_to_paid',
            title: 'Do PIX gerado até o pagamento',
            explain: 'Tempo entre gerar o QR e o cliente pagar de fato',
            icon: '⚡→✅',
            val: ct.pix_to_paid_label,
            n: samples.pix_to_paid,
          },
          {
            key: 'landing_to_paid',
            title: 'Jornada completa até pagar',
            explain: 'Tempo total desde a landing até o PIX ser confirmado',
            icon: '👀→✅',
            val: ct.landing_to_paid_label,
            n: samples.landing_to_paid,
          },
        ];

        function pluralSessions(n) {
          if (!n)  return 'sem dados ainda';
          if (n === 1) return 'baseado em 1 sessão';
          return 'baseado em ' + n + ' sessões';
        }

        ctEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px">' +
          CT_STEPS.map(function (s) {
            var has = s.val && s.val !== '—';
            var valColor = has ? '#60a5fa' : 'var(--text-muted)';
            return '<div style="padding:12px 14px;background:rgba(4,90,205,.05);border:1px solid rgba(4,90,205,.15);border-radius:10px">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
                '<div style="flex:1;min-width:0">' +
                  '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
                    '<span style="font-size:11px">' + s.icon + '</span>' +
                    '<span style="font-size:12px;font-weight:600;color:var(--text)">' + esc(s.title) + '</span>' +
                  '</div>' +
                  '<div style="font-size:10px;color:var(--text-muted);line-height:1.4">' + esc(s.explain) + '</div>' +
                '</div>' +
                '<div style="text-align:right;flex-shrink:0">' +
                  '<div style="font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;color:' + valColor + ';letter-spacing:-.02em;line-height:1">' + esc(has ? s.val : '—') + '</div>' +
                  '<div style="font-size:9px;color:var(--text-muted);margin-top:3px">' + pluralSessions(s.n) + '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '';
      }
    }

    // Hourly activity
    var hourEl = el('hourlyActivityChart');
    if (hourEl) renderHourlyBars(hourEl, stats.hourly_activity || []);

    // Demographics
    var demo = stats.demographics || {};
    var demoEl = el('demographicsPanel');
    if (demoEl) {
      if ((demo.verified_leads || 0) > 0 || (demo.paid_with_profile || 0) > 0) {
        demoEl.innerHTML = '<div class="mini-kpi-row">' +
          '<div class="mini-kpi"><span>CPFs verificados</span><strong>' + esc(demo.verified_leads || 0) + '</strong></div>' +
          '<div class="mini-kpi"><span>Idade média</span><strong>' + esc(demo.avg_age != null ? demo.avg_age + ' anos' : '—') + '</strong></div>' +
          '<div class="mini-kpi"><span>Pagos c/ perfil</span><strong>' + esc(demo.paid_with_profile || 0) + '</strong></div>' +
        '</div>';
      } else {
        demoEl.innerHTML = chartEmpty('chart', 'Sem dados demográficos', 'Consulte CPF no funil.');
      }
    }
    var demoChart = el('demographicsPaidChart');
    if (demoChart) {
      /* Agrega por idade específica a partir de stats.orders */
      var ageMap = {};
      (stats.orders || []).forEach(function (o) {
        var age = parseInt(o.lead_age || 0, 10);
        if (age > 0 && age < 120) ageMap[age] = (ageMap[age] || 0) + 1;
      });
      var ageRows = Object.keys(ageMap)
        .map(function (a) { return { age: parseInt(a, 10), count: ageMap[a] }; })
        .sort(function (a, b) { return b.count - a.count || a.age - b.age; });

      if (!ageRows.length) {
        demoChart.innerHTML = chartEmpty('chart', 'Faixa etária', 'Sem pedidos com perfil.');
      } else {
        var maxCount = Math.max.apply(null, ageRows.map(function (r) { return r.count; }));
        demoChart.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px">' +
          ageRows.map(function (r) {
            var pct = Math.max(6, Math.round((r.count / maxCount) * 100));
            return '<div style="display:grid;grid-template-columns:60px 1fr 30px;gap:10px;align-items:center;font-size:12px">' +
              '<span style="color:var(--text-secondary);font-variant-numeric:tabular-nums">' + r.age + ' anos</span>' +
              '<div style="height:6px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden">' +
                '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#045acd,#3b82f6);border-radius:999px"></div>' +
              '</div>' +
              '<strong style="font-variant-numeric:tabular-nums;text-align:right">' + r.count + '</strong>' +
            '</div>';
          }).join('') +
        '</div>';
      }
    }

    // Revenue by state
    var stateEl = el('revenueByStatePanel');
    if (stateEl) {
      var states = (stats.revenue_by_state || []).filter(function (r) { return (r.revenue_cents || 0) > 0; });
      if (!states.length) { stateEl.innerHTML = chartEmpty('geo', 'Sem dados de estado'); }
      else {
        var smax = Math.max(1, states[0].revenue_cents || 1);
        stateEl.innerHTML = states.slice(0, 10).map(function (r) {
          var pct = Math.round(((r.revenue_cents || 0) / smax) * 100);
          return '<div class="country-row"><span>' + esc(r.state_label || r.state) + ' · ' + esc(r.payments || 0) + ' pedido(s)</span>' +
            '<strong>' + esc(r.revenue_formatted || fmtMoney(r.revenue_cents)) + '</strong>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div></div>';
        }).join('');
      }
    }

    // Top cities
    var cityEl = el('topCitiesPanel');
    if (cityEl) {
      var cities = stats.top_cities || [];
      if (!cities.length) { cityEl.innerHTML = chartEmpty('geo', 'Sem dados de cidade'); }
      else {
        var cmax = Math.max(1, cities[0].revenue_cents || 1);
        cityEl.innerHTML = cities.slice(0, 10).map(function (r) {
          var pct = Math.round(((r.revenue_cents || 0) / cmax) * 100);
          return '<div class="country-row"><span>' + esc(r.city) + ' (' + esc(r.country || '—') + ')</span>' +
            '<strong>' + esc(r.revenue_formatted || fmtMoney(r.revenue_cents)) + '</strong>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div></div>';
        }).join('');
      }
    }

    // Landing base table
    var baseEl = el('landingBaseTable');
    if (baseEl) {
      var bases = stats.funnel_by_base || [];
      var liveRawSess = (stats.live && stats.live.sessions) || [];
      var liveSessions = Array.isArray(liveRawSess) ? liveRawSess : Object.values(liveRawSess);

      function liveCountForBase(basePath) {
        if (!liveSessions.length) return 0;
        return liveSessions.filter(function (s) {
          var page = s.page || '';
          if (!basePath || basePath === '/ (sem base)') return !page || page === '/';
          return page === basePath || page.startsWith(basePath + '/') || page.startsWith(basePath + '?');
        }).length;
      }

      if (!bases.length) {
        baseEl.innerHTML = chartEmpty('chart', 'Sem dados de landing');
      } else {
        var totalLive = liveSessions.length;
        baseEl.innerHTML =
          (totalLive > 0
            ? '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--text-secondary)">' +
                '<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.5);animation:pulse .8s ease-in-out infinite;display:inline-block"></span>' +
                '<strong style="color:#22c55e">' + totalLive + ' visitante' + (totalLive !== 1 ? 's' : '') + ' ao vivo</strong>' +
                '<span style="color:var(--text-muted)">distribuídos pelas rotas abaixo</span>' +
              '</div>'
            : '') +
          '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Base path</th>' +
            '<th style="text-align:center">🟢 Ao vivo</th>' +
            '<th class="num">Landing</th>' +
            '<th class="num">Pagos</th>' +
            '<th class="num">Receita</th>' +
            '<th class="num">Conv.</th>' +
          '</tr></thead><tbody>' +
          bases.map(function (r) {
            var live = liveCountForBase(r.base_path);
            var conv = r.landing > 0 ? r.conversion_rate + '%' : (r.payments > 0 ? '<span style="color:var(--text-muted)" title="Sem landing rastreada">—</span>' : '0%');
            return '<tr>' +
              '<td><code>' + esc(r.base_path) + '</code></td>' +
              '<td style="text-align:center">' +
                (live > 0
                  ? '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#22c55e">' +
                      '<span style="width:6px;height:6px;border-radius:50%;background:#22c55e;animation:pulse .8s ease-in-out infinite;display:inline-block"></span>' + live +
                    '</span>'
                  : '<span style="color:rgba(148,163,184,.3);font-size:12px">—</span>') +
              '</td>' +
              '<td class="num">' + esc(r.landing) + '</td>' +
              '<td class="num" style="' + (r.payments > 0 ? 'color:#22c55e;font-weight:600' : '') + '">' + esc(r.payments) + '</td>' +
              '<td class="num">' + esc(r.revenue_formatted || fmtMoney(r.revenue_cents)) + '</td>' +
              '<td class="num">' + conv + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>';
      }
    }

    // Page flow
    var flowEl = el('pageFlowPanel');
    if (flowEl) {
      var links = (stats.transition_sankey && stats.transition_sankey.links) || [];
      if (!links.length && (stats.transitions || []).length) {
        links = stats.transitions.slice(0, 12).map(function (t) {
          var parts = String(t.flow || '').split(' → ');
          return { from: parts[0] || '?', to: parts[1] || '?', value: t.count || 0 };
        });
      }
      if (!links.length) { flowEl.innerHTML = chartEmpty('chart', 'Sem dados de fluxo'); }
      else {
        var fmax = Math.max(1, links[0].value || 1);
        flowEl.innerHTML = links.slice(0, 12).map(function (l) {
          var pct = Math.round(((l.value || 0) / fmax) * 100);
          return '<div class="flow-row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.from) + '</span>' +
            '<div class="flow-bar-wrap"><div class="flow-bar" style="width:' + Math.max(pct, 6) + '%"></div><span>' + esc(l.value) + '</span></div>' +
            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">→ ' + esc(l.to) + '</span></div>';
        }).join('');
      }
    }

    // Live visitors
    var liveEl = el('liveVisitorsPanel');
    if (liveEl) {
      var live = stats.live || {};
      if (live.disabled) { liveEl.innerHTML = chartEmpty('chart', 'Visitantes ao vivo', 'Defina ANALYTICS_LIVE=1 no .env.'); }
      else {
        var liveRaw2 = live.sessions || [];
        var liveSess = Array.isArray(liveRaw2) ? liveRaw2 : Object.values(liveRaw2);
        liveEl.innerHTML = '<div class="mini-kpi-row"><div class="mini-kpi"><span>Online agora</span><strong>' + esc(live.total || 0) + '</strong></div></div>' +
          (liveSess.length ? '<div class="country-list">' + liveSess.slice(0,8).map(function (s) {
            return '<div class="country-row"><span>' + esc(s.page || '—') + ' · ' + esc(s.city || s.country || '—') + '</span>' +
              '<span style="color:var(--text-muted);font-size:11px">' + esc(fmtAgo(s.last_seen)) + '</span></div>';
          }).join('') + '</div>' : '');
      }
    }

    // Last event label
    var lastEvLabel = el('siteLastEventLabel');
    if (lastEvLabel && stats.system && stats.system.last_event_ts) {
      lastEvLabel.textContent = fmtAgo(stats.system.last_event_ts);
    }
  }

  function renderHourlyBars(container, hourly) {
    if (!hourly.length) {
      container.innerHTML = chartEmpty('chart', 'Atividade por hora', 'Sem dados no período.');
      return;
    }
    var hasPixGen = hourly.some(function (h) { return (h.pix_generated || 0) > 0; });
    var hasPv    = hourly.some(function (h) { return (h.page_views   || 0) > 0; });
    var hasPay   = hourly.some(function (h) { return (h.payments     || 0) > 0; });

    /* Escolhe o campo de "visitas": pix_generated se existir, page_views como fallback */
    var visitField = hasPixGen ? 'pix_generated' : 'page_views';
    var visitLabel = hasPixGen ? 'PIX gerados'   : 'Visitas';

    var mx = Math.max(1,
      Math.max.apply(null, hourly.map(function (h) { return Math.max(h[visitField] || 0, h.payments || 0); }))
    );

    container.innerHTML =
      '<div class="hourly-grid">' +
      hourly.map(function (h) {
        var vis  = h[visitField] || 0;
        var pay  = h.payments    || 0;
        var hVis = vis > 0 ? Math.max(4, Math.round((vis / mx) * 80)) : 0;
        var hPay = pay > 0 ? Math.max(4, Math.round((pay / mx) * 80)) : 0;
        var tip  = esc(h.label || h.hour + 'h') + ' — ' + visitLabel + ': ' + vis + ' · Pagos: ' + pay;
        return '<div class="hourly-col" title="' + tip + '">' +
          '<div class="hourly-bars">' +
            (hVis > 0 ? '<div class="hourly-bar pix-gen" style="height:' + hVis + 'px"></div>' : '<div class="hourly-bar pix-gen" style="height:3px;opacity:.15"></div>') +
            (hPay > 0 ? '<div class="hourly-bar pix-pay" style="height:' + hPay + 'px"></div>' : '<div class="hourly-bar pix-pay" style="height:3px;opacity:.15"></div>') +
          '</div>' +
          '<div class="hourly-label">' + esc(h.label || h.hour + 'h') + '</div>' +
        '</div>';
      }).join('') + '</div>' +
      '<div class="hourly-legend">' +
        '<span><i class="dot pix-gen"></i>' + visitLabel + '</span>' +
        '<span><i class="dot pix-pay"></i>Pagos</span>' +
      '</div>';
  }

  var PAGE_ICONS   = { 'Landing': '🏠', 'Wizard': '📋', 'Checkout PIX': '💳', 'Início': '🏠', 'Obrigado': '✅' };
  var PAGE_DISPLAY = { 'Wizard': 'Funil', 'Início': 'Landing' };
  function pageLabel(l) { return PAGE_DISPLAY[l] || l || 'Página'; }

  function renderSiteRecentFeed(stats) {
    var feedEl = el('siteRecentFeed');
    if (!feedEl) return;

    var events = [];

    /* Pagamentos confirmados */
    (stats.orders || []).forEach(function (o) {
      events.push({ type: 'paid', ts: Number(o.ts || o.paid_at || 0), label: o.product_name || 'Produto', amount: o.amount_cents, src: o.traffic_src });
    });

    /* PIX gerados/pendentes */
    (stats.pix_pending || []).forEach(function (p) {
      events.push({ type: 'pix', ts: Number(p.ts || p.created_at || 0), label: p.product_name || 'Produto', amount: p.amount_cents, src: p.traffic_src });
    });

    /* Eventos recentes do stats.recent */
    (stats.recent || []).forEach(function (r) {
      var t = r.type || '';
      if (t === 'page_view') {
        events.push({ type: 'view', ts: Number(r.ts || 0), label: r.page_label || 'Página', src: r.traffic_src || r.utm_source || null, city: r.city, country: r.country });
      } else if (t === 'wizard_step') {
        events.push({ type: 'wizard', ts: Number(r.ts || 0), label: r.page_label || 'Funil', step: r.wizard_step || null, src: r.traffic_src || null, city: r.city, country: r.country });
      }
    });

    events.sort(function (a, b) { return b.ts - a.ts; });

    if (!events.length) {
      feedEl.innerHTML = chartEmpty('orders', 'Sem eventos', 'Visitas, PIX e vendas aparecerão aqui.');
      return;
    }

    var WIZARD_STEP_LABELS = {
      valor_emprestimo:'Valor', valor:'Valor', finalidade:'Finalidade', ocupacao:'Ocupação',
      profissao:'Profissão', renda:'Renda', cpf:'CPF', documento:'CPF', nome:'Nome',
      name:'Nome', nascimento:'Nascimento', telefone:'Telefone', email:'E-mail',
      cep:'CEP', endereco:'Endereço', banco:'Banco', agencia:'Agência', conta:'Conta',
    };

    function geoTag(ev) {
      var parts = [];
      if (ev.city) parts.push(ev.city);
      else if (ev.country && ev.country !== 'XX') parts.push(ev.country);
      return parts.length ? '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap">📍 ' + esc(parts.join(', ')) + '</span>' : '';
    }

    feedEl.innerHTML = events.slice(0, 7).map(function (ev) {
      var geo = geoTag(ev);
      var srcTag = ev.src ? '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap">' + esc(ev.src) + '</span>' : '';
      var timeTag = '<span style="font-size:11px;color:var(--text-muted);margin-left:auto;white-space:nowrap;flex-shrink:0">' + fmtAgo(ev.ts) + '</span>';

      if (ev.type === 'paid') {
        return '<div class="feed-row">' +
          '<span class="feed-type paid">PAGO</span>' +
          '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">' +
            '<span style="font-size:12px;color:var(--text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ev.label) + '</span>' +
            '<div style="display:flex;gap:6px;align-items:center">' + geo + srcTag + '</div>' +
          '</div>' +
          '<span class="feed-val" style="color:var(--success);flex-shrink:0">' + fmtMoney(ev.amount) + '</span>' +
          timeTag +
        '</div>';
      }

      if (ev.type === 'pix') {
        return '<div class="feed-row">' +
          '<span class="feed-type pix">PIX</span>' +
          '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">' +
            '<span style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ev.label) + '</span>' +
            '<div style="display:flex;gap:6px;align-items:center">' + geo + srcTag + '</div>' +
          '</div>' +
          '<span class="feed-val" style="color:var(--warning);flex-shrink:0">' + fmtMoney(ev.amount) + '</span>' +
          timeTag +
        '</div>';
      }

      if (ev.type === 'wizard') {
        var stepName = ev.step ? (WIZARD_STEP_LABELS[ev.step] || ev.step.replace(/_/g,' ')) : null;
        return '<div class="feed-row" style="opacity:.85">' +
          '<span class="feed-type view">📋</span>' +
          '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">' +
            '<span style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Funil' +
              (stepName ? ' · <strong style="color:var(--text)">' + esc(stepName) + '</strong>' : '') +
            '</span>' +
            '<div style="display:flex;gap:6px;align-items:center">' + geo + srcTag + '</div>' +
          '</div>' +
          timeTag +
        '</div>';
      }

      /* page_view */
      var icon = PAGE_ICONS[ev.label] || '👁';
      return '<div class="feed-row" style="opacity:.75">' +
        '<span class="feed-type view">' + icon + '</span>' +
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">' +
          '<span style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(pageLabel(ev.label)) + '</span>' +
          '<div style="display:flex;gap:6px;align-items:center">' + geo + srcTag + '</div>' +
        '</div>' +
        timeTag +
      '</div>';
    }).join('');
  }

  function renderUpsells(stats) {
    /* upsell_report vem com todos os 20 slots — filtra só os com atividade */
    var allUpsells = stats.upsell_report || stats.upsells || [];
    var upsells = allUpsells.filter(function (u) {
      return (u.views || 0) > 0 || (u.payments || 0) > 0 || (u.revenue_cents || 0) > 0;
    });

    function upsellName(u) {
      return u.name || u.product_name ||
        ('Upsell ' + (u.upsell != null ? u.upsell : (u.index != null ? u.index : '?')));
    }

    var upsellKpisEl = el('upsellsKpis');
    if (upsellKpisEl) {
      var uRev  = allUpsells.reduce(function (s, u) { return s + (u.revenue_cents || 0); }, 0);
      var uPaid = allUpsells.reduce(function (s, u) { return s + (u.payments || 0); }, 0);
      upsellKpisEl.innerHTML = [
        { label: 'Upsells ativos',   val: upsells.length,    color: '#045acd' },
        { label: 'Receita upsells',  val: fmtMoney(uRev),   color: '#22c55e' },
        { label: 'Upsells pagos',    val: uPaid,             color: '#22c55e' },
      ].map(function (k) {
        return '<div class="kpi" style="--kpi-accent:' + k.color + '"><div class="kpi-label">' + esc(k.label) + '</div><div class="kpi-value">' + esc(k.val) + '</div></div>';
      }).join('');
    }

    var uTable = el('upsellsDetailTable');
    if (uTable) {
      if (!upsells.length) {
        uTable.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">Nenhum upsell com atividade no período</td></tr>';
      } else {
        uTable.innerHTML = upsells.map(function (u, i) {
          var take = u.views > 0 ? ((u.payments / u.views) * 100).toFixed(1) : '0.0';
          return '<tr>' +
            '<td><strong>' + esc(upsellName(u)) + '</strong></td>' +
            '<td class="num">' + esc(u.views || 0) + '</td>' +
            '<td class="num">' + esc(u.clicks || 0) + '</td>' +
            '<td class="num">' + esc(u.payments || 0) + '</td>' +
            '<td class="num">' + take + '%</td>' +
            '<td class="num">' + esc(u.revenue_formatted || fmtMoney(u.revenue_cents)) + '</td>' +
          '</tr>';
        }).join('');
      }
    }

    var mixEl = el('upsellMixChart');
    if (mixEl) {
      var t = stats.totals || {};
      var uRevTotal = allUpsells.reduce(function (s, u) { return s + (u.revenue_cents || 0); }, 0);
      var frontRev = Math.max(0, (t.revenue_cents || 0) - uRevTotal);
      if (!frontRev && !uRevTotal) {
        mixEl.innerHTML = chartEmpty('upsell', 'Sem dados');
      } else {
        var total = frontRev + uRevTotal;
        var pctFront = Math.round((frontRev / total) * 100);
        mixEl.innerHTML = '<div style="padding:12px">' +
          '<div class="country-row"><span>Front-end</span><strong>' + esc(fmtMoney(frontRev)) + '</strong>' +
          '<div class="bar-track" style="grid-column:1/-1"><div class="bar-fill" style="width:' + pctFront + '%"></div></div></div>' +
          '<div class="country-row" style="margin-top:8px"><span>Upsells</span><strong>' + esc(fmtMoney(uRevTotal)) + '</strong>' +
          '<div class="bar-track" style="grid-column:1/-1"><div class="bar-fill" style="width:' + (100 - pctFront) + '%"></div></div></div>' +
        '</div>';
      }
    }

    var topEl = el('upsellTopChart');
    if (topEl) {
      var sorted = upsells.slice().sort(function (a, b) { return (b.revenue_cents || 0) - (a.revenue_cents || 0); });
      if (!sorted.length) {
        topEl.innerHTML = chartEmpty('upsell', 'Sem upsells com receita', 'Aparecerá quando houver vendas de upsell.');
      } else {
        var topMax = Math.max(1, sorted[0].revenue_cents || 1);
        topEl.innerHTML = '<div class="country-list">' + sorted.slice(0, 8).map(function (u) {
          var pct = Math.round(((u.revenue_cents || 0) / topMax) * 100);
          return '<div class="country-row">' +
            '<span>' + esc(upsellName(u)) + '</span>' +
            '<strong>' + esc(u.revenue_formatted || fmtMoney(u.revenue_cents)) + '</strong>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '</div>';
        }).join('') + '</div>';
      }
    }
  }

  /* ── Config ──────────────────────────────────────────────────── */
  function loadSiteConfig(site) {
    var f = function (id, val) { var e = el(id); if (e) e.value = val || ''; };
    f('configName', site.name);
    f('configApiUrl', site.apiUrl);
    f('configToken', site.token);
    f('configIcon', site.icon || '🌐');
    var colorEl = el('configColor');
    if (colorEl) colorEl.value = site.color || '#045acd';
    hideEl('configSaveMsg');
  }

  async function saveCurrentSiteConfig() {
    var siteId = state.currentSiteId;
    if (!siteId) return;
    var idx = state.sites.findIndex(function (s) { return s.id === siteId; });
    if (idx === -1) return;

    state.sites[idx] = Object.assign(state.sites[idx], {
      name: el('configName').value.trim() || state.sites[idx].name,
      apiUrl: el('configApiUrl').value.trim() || state.sites[idx].apiUrl,
      token: el('configToken').value.trim() || state.sites[idx].token,
      color: el('configColor').value || state.sites[idx].color,
      icon: el('configIcon').value.trim() || state.sites[idx].icon,
    });

    await saveSites();
    renderSidebar();
    el('siteDetailName').textContent = state.sites[idx].name;
    el('siteDetailIcon').textContent = state.sites[idx].icon || '🌐';
    el('siteDetailIcon').style.setProperty('--site-color', state.sites[idx].color || '#045acd');
    var msg = el('configSaveMsg');
    if (msg) { msg.textContent = '✓ Salvo com sucesso'; showEl('configSaveMsg'); setTimeout(function () { hideEl('configSaveMsg'); }, 3000); }
  }

  async function removeCurrentSite() {
    var siteId = state.currentSiteId;
    if (!siteId || !confirm('Remover este site do hub?')) return;
    state.sites = state.sites.filter(function (s) { return s.id !== siteId; });
    await saveSites();
    renderSidebar();
    state.currentSiteId = null;
    clearInterval(state.siteTimer);
    showSection('hub-overview');
    loadHubOverview();
  }

  /* ── Pixels ──────────────────────────────────────────────────── */
  function parseAwId(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (s.indexOf('/') !== -1) {
      var p = s.split('/');
      return p[0].indexOf('AW-') === 0 ? p[0] : 'AW-' + p[0].replace(/^AW-?/i, '');
    }
    return s.indexOf('AW-') === 0 ? s : 'AW-' + s.replace(/\D/g, '');
  }

  function parseAwLabel(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (s.indexOf('/') !== -1) return s.split('/').pop();
    return s;
  }

  function parseGa4Id(raw) {
    var s = String(raw || '').trim().toUpperCase();
    if (!s) return '';
    return s.indexOf('G-') === 0 ? s : 'G-' + s.replace(/^G-?/i, '');
  }

  async function loadSitePixels(siteId) {
    try {
      var data = await fetchSitePixels(siteId);
      state.pixelsData[siteId] = data || { googleAds: [], ga4: [] };
      state.editingPixels[siteId] = JSON.parse(JSON.stringify(state.pixelsData[siteId]));
    } catch (_) {
      state.editingPixels[siteId] = { googleAds: [], ga4: [] };
    }
    renderPixelsList(siteId);
  }

  function renderPixelsList(siteId) {
    var d = state.editingPixels[siteId] || { googleAds: [], ga4: [] };
    var googleAds = d.googleAds || d.google_ads || [];
    var ga4 = d.ga4 || [];

    /* Google Ads list */
    var adsEl = el('adsPixelList');
    if (adsEl) {
      if (!googleAds.length) {
        adsEl.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Nenhuma conversão na lista.</p>';
      } else {
        adsEl.innerHTML = googleAds.map(function (row, i) {
          var desc = typeof row === 'object' ? (row.description || '') : '';
          var id   = typeof row === 'object' ? row.id    : row;
          var lbl  = typeof row === 'object' ? row.label : '';
          return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.2);border-radius:8px">' +
            '<div style="flex:1;min-width:0">' +
              '<span style="display:block;font-size:13px;font-weight:600;color:#fde68a;margin-bottom:3px">' + esc(desc || 'Sem descrição') + '</span>' +
              '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:var(--text-secondary)">' + esc(id) + (lbl ? '/' + esc(lbl) : '') + '</span>' +
            '</div>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-ads-idx="' + i + '" style="flex-shrink:0;color:#fca5a5;padding:4px 8px">✕</button>' +
          '</div>';
        }).join('');
        adsEl.querySelectorAll('[data-ads-idx]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            (state.editingPixels[siteId].googleAds || state.editingPixels[siteId].google_ads).splice(parseInt(btn.getAttribute('data-ads-idx')), 1);
            renderPixelsList(siteId);
          });
        });
      }
    }

    /* GA4 list */
    var ga4El = el('ga4PixelList');
    if (ga4El) {
      if (!ga4.length) {
        ga4El.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Nenhum GA4 na lista.</p>';
      } else {
        ga4El.innerHTML = ga4.map(function (id, i) {
          return '<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:rgba(4,90,205,.1);border:1px solid rgba(4,90,205,.25);border-radius:6px;font-size:12px;font-family:\'JetBrains Mono\',monospace">' +
            esc(id) +
            '<button type="button" data-ga4-idx="' + i + '" style="border:none;background:none;color:#fca5a5;cursor:pointer;font-size:13px;padding:0 2px">×</button>' +
          '</span>';
        }).join('');
        ga4El.querySelectorAll('[data-ga4-idx]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.editingPixels[siteId].ga4.splice(parseInt(btn.getAttribute('data-ga4-idx')), 1);
            renderPixelsList(siteId);
          });
        });
      }
    }
  }

  async function verifyPixelsOnSite() {
    var siteId = state.currentSiteId;
    if (!siteId) return;
    var out = el('pixelsVerifyResult');
    if (!out) return;
    out.classList.remove('hidden');
    out.innerHTML = '⏳ Verificando…';

    var site = state.sites.find(function (s) { return s.id === siteId; });
    if (!site) return;

    /* Testa 3 coisas em paralelo:
       1. Endpoint /api/google-pixels.php via proxy autenticado
       2. Arquivo público config/google-pixels.json (o que o navegador do site lê)
       3. checkout.php respondendo (para saber se JS de pixel vai carregar) */
    try {
      var apiRes = await apiFetch(proxyUrl(siteId, '/api/google-pixels.php'));
      var apiJson = await apiRes.json();

      /* Chamada direta ao arquivo público via proxy (bypass do PHP) */
      var pubRes = await apiFetch(proxyUrl(siteId, '/config/google-pixels.json'));
      var pubText = await pubRes.text();
      var pubJson = null;
      try { pubJson = JSON.parse(pubText); } catch (_) {}

      var ads    = (apiJson && apiJson.googleAds) || [];
      var ga4    = (apiJson && apiJson.ga4)       || [];
      var pubAds = (pubJson && pubJson.googleAds) || [];
      var pubGa4 = (pubJson && pubJson.ga4)       || [];

      var msg = '';
      msg += '📡 GET ' + esc(site.apiUrl) + '/api/google-pixels.php\n';
      msg += '   HTTP ' + apiRes.status + '\n';
      msg += '   Google Ads salvos: ' + ads.length + '\n';
      ads.forEach(function (a) { msg += '     · ' + esc(a.id) + '/' + esc(a.label) + (a.description ? ' (' + esc(a.description) + ')' : '') + '\n'; });
      msg += '   GA4 salvos: ' + ga4.length + '\n';
      ga4.forEach(function (g) { msg += '     · ' + esc(typeof g === 'string' ? g : g.id) + '\n'; });
      msg += '\n📄 GET ' + esc(site.apiUrl) + '/config/google-pixels.json (arquivo público lido pelo navegador)\n';
      msg += '   HTTP ' + pubRes.status + '\n';
      if (pubJson) {
        msg += '   Google Ads no arquivo: ' + pubAds.length + '\n';
        msg += '   GA4 no arquivo: ' + pubGa4.length + '\n';
        if (pubAds.length === 0 && ads.length > 0) {
          msg += '\n⚠ Arquivo público está VAZIO mas o endpoint tem pixels! Isso significa que o hub salvou o pixel mas o arquivo não foi atualizado. Verifique permissões de escrita.\n';
        }
        if (pubAds.length > 0) {
          msg += '\n✓ Pixels configurados no site. Eles disparam no checkout quando PIX é pago.\n';
        }
      } else {
        msg += '   ⚠ Arquivo não é JSON válido ou está inacessível\n';
        msg += '   Resposta: ' + esc(pubText.slice(0, 200)) + '\n';
      }

      msg += '\n💡 Para testar: acesse ' + esc(site.apiUrl) + '/pay/checkout.php?produto=prod_698630abcbdde e abra o DevTools > Network > filtre por "googletagmanager" ao pagar.';

      out.textContent = msg;
      scheduleVerifyHide(out);
    } catch (e) {
      out.innerHTML = '<span style="color:#fca5a5">✗ Erro: ' + esc(e.message) + '</span>';
      scheduleVerifyHide(out);
    }
  }

  var _verifyHideTimer = null;
  function scheduleVerifyHide(el2) {
    if (_verifyHideTimer) clearTimeout(_verifyHideTimer);
    el2.style.transition = 'opacity .4s ease';
    el2.style.opacity = '1';
    _verifyHideTimer = setTimeout(function () {
      el2.style.opacity = '0';
      setTimeout(function () {
        el2.classList.add('hidden');
        el2.style.opacity = '';
      }, 400);
    }, 15000);
  }

  async function savePixels() {
    var siteId = state.currentSiteId;
    if (!siteId) return;
    var d = state.editingPixels[siteId] || { googleAds: [], ga4: [] };
    var payload = {
      googleAds: (d.googleAds || d.google_ads || []).filter(function (r) {
        return r && (typeof r === 'string' ? r : r.id);
      }),
      ga4: (d.ga4 || []).filter(Boolean),
    };
    try {
      await saveSitePixels(siteId, payload);
      state.pixelsData[siteId] = JSON.parse(JSON.stringify(payload));
      var msg = el('pixelsSaveMsg');
      if (msg) { msg.textContent = '✓ Pixels salvos com sucesso'; showEl('pixelsSaveMsg'); setTimeout(function () { hideEl('pixelsSaveMsg'); }, 4000); }
    } catch (e) {
      alert('Erro ao salvar pixels: ' + e.message);
    }
  }

  /* ── Health Check ───────────────────────────────────────────── */
  var HEALTH_ROUTES = [
    /* ── Infra ───────────────────────────── */
    { path: '/api/health.php',                label: 'Health API',         critical: true,  group: 'Infra' },
    { path: '/api/analytics.php?action=ping', label: 'Analytics API',      critical: true,  group: 'Infra' },
    { path: '/config/site-base.php',          label: 'Site Base PHP',      critical: true,  group: 'Infra' },
    { path: '/js/credpix-analytics.js',       label: 'Analytics JS',       critical: true,  group: 'Infra' },
    /* ── Funil ───────────────────────────── */
    { path: '/',                              label: 'Landing page',        critical: true,  group: 'Funil' },
    { path: '/analise/',                      label: 'Rota /analise',       critical: true,  group: 'Funil' },
    { path: '/type/wizard/',                  label: 'Funil (wizard)',      critical: true,  group: 'Funil' },
    { path: '/pay/checkout.php',              label: 'Checkout PIX',        critical: true,  group: 'Funil' },
    /* ── Pagamentos ──────────────────────── */
    { path: '/pay/api/pix.php',               label: 'PIX API (gateway)',   critical: true,  group: 'Pagamento' },
    { path: '/pay/api/webhook-anubis.php',    label: 'Webhook AnubisPay',   critical: true,  group: 'Pagamento' },
    { path: '/api/anubis-health.php',         label: 'AnubisPay API ping',  critical: true,  group: 'Pagamento' },
    /* ── Integrações ─────────────────────── */
    { path: '/api/google-pixels.php',         label: 'Pixels Google API',   critical: false, group: 'Integrações' },
    { path: '/api/site-config.php',           label: 'Site Config API',     critical: false, group: 'Integrações' },
  ];

  var healthTimer = null;

  async function checkRoute(siteId, route) {
    var t0 = Date.now();
    try {
      var qs = '';
      var pathPart = route.path;
      var qi = route.path.indexOf('?');
      if (qi !== -1) { pathPart = route.path.slice(0, qi); qs = route.path.slice(qi + 1); }

      var url = proxyUrl(siteId, pathPart, qs || undefined);
      var res = await fetch(url, {
        headers: apiHeaders(),
        signal: AbortSignal.timeout(10000),
      });
      var ms = Date.now() - t0;
      var body = '';
      try { body = await res.text(); } catch (_) {}
      return { path: route.path, label: route.label, critical: route.critical, status: res.status, ms: ms, body: body.slice(0, 120) };
    } catch (e) {
      return { path: route.path, label: route.label, critical: route.critical, status: 0, ms: Date.now() - t0, body: e.message || 'Timeout/Erro de rede' };
    }
  }

  function statusClass(status) {
    if (status === 0) return 'err';
    if (status >= 200 && status < 300) return 'ok';
    if (status >= 300 && status < 400) return 'warn';
    return 'err';
  }

  function statusLabel(status) {
    if (status === 0) return 'Timeout';
    if (status === 200) return '200 OK';
    if (status === 301 || status === 302) return status + ' Redirect';
    if (status === 401) return '401 Auth';
    if (status === 403) return '403 Deny';
    if (status === 404) return '404 Not Found';
    if (status === 500) return '500 Error';
    if (status === 502) return '502 Proxy';
    return status + '';
  }

  function msColor(ms) {
    if (ms < 300) return '#22c55e';
    if (ms < 800) return '#f59e0b';
    return '#ef4444';
  }

  var GROUP_ICONS = { 'Infra': '⚙', 'Funil': '🔀', 'Pagamento': '💳', 'Integrações': '🔗', 'Outros': '📦' };

  function parseRouteDetail(r) {
    var cls = statusClass(r.status);
    var detail = '';
    if (r.path.indexOf('anubis-health') !== -1 && r.status === 200) {
      try {
        var aj = JSON.parse(r.body);
        if (aj.ok === true) { cls = 'ok'; detail = 'Auth OK · HTTP ' + (aj.api_status||'?') + ' · ' + (aj.latency_ms||'?') + 'ms'; }
        else { cls = 'err'; detail = !aj.configured ? 'Chaves não configuradas' : (aj.error || 'Falha'); }
      } catch (_) {}
    } else if (r.status === 200) {
      try {
        var jb = JSON.parse(r.body);
        if (jb.ok !== undefined) detail = jb.ok ? 'ok:true' : ('ok:false · ' + (jb.error||''));
        else if (jb.success !== undefined) detail = jb.success ? 'success:true' : ('error: ' + (jb.error||''));
      } catch (_) { detail = r.body ? r.body.slice(0,60).replace(/\s+/g,' ') : ''; }
    } else {
      detail = r.body ? r.body.slice(0,80).replace(/\s+/g,' ') : '';
    }
    return { cls: cls, detail: detail };
  }

  function renderRouteCard(r, result) {
    var id = 'hcard-' + r.path.replace(/[^a-z0-9]/gi,'_');
    if (!result) {
      return '<div id="' + id + '" style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:10px;background:rgba(255,255,255,.02);border:1px solid var(--border);margin-bottom:6px">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:rgba(4,90,205,.4);flex-shrink:0;animation:pulse .8s ease-in-out infinite"></div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:13px;font-weight:500">' + esc(r.label) + '</span>' +
            (r.critical ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(245,158,11,.15);color:#fde68a">crítico</span>' : '') +
          '</div>' +
          '<span style="font-size:11px;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted)">' + esc(r.path) + '</span>' +
        '</div>' +
        '<span style="font-size:11px;color:var(--text-muted)">checando…</span>' +
      '</div>';
    }
    var p = parseRouteDetail(result);
    var dotColor = p.cls === 'ok' ? '#22c55e' : p.cls === 'warn' ? '#f59e0b' : '#ef4444';
    var badgeBg  = p.cls === 'ok' ? 'rgba(34,197,94,.13)' : p.cls === 'warn' ? 'rgba(245,158,11,.13)' : 'rgba(239,68,68,.13)';
    var badgeColor = p.cls === 'ok' ? '#86efac' : p.cls === 'warn' ? '#fde68a' : '#fca5a5';
    var maxMs = 3000;
    var barW = Math.min(100, Math.round((result.ms / maxMs) * 100));
    var barColor = msColor(result.ms);
    return '<div id="' + id + '" style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:10px;background:rgba(255,255,255,.025);border:1px solid var(--border);margin-bottom:6px;transition:background .2s" onmouseover="this.style.background=\'rgba(4,90,205,.06)\'" onmouseout="this.style.background=\'rgba(255,255,255,.025)\'">' +
      '<div style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;' + (p.cls==='ok'?'box-shadow:0 0 6px '+dotColor+'88':'') + '"></div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:7px;margin-bottom:3px">' +
          '<span style="font-size:13px;font-weight:500;color:var(--text)">' + esc(r.label) + '</span>' +
          (r.critical ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(245,158,11,.15);color:#fde68a">crítico</span>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:10px;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted)">' + esc(r.path) + '</span>' +
          (p.detail ? '<span style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px" title="' + esc(p.detail) + '">· ' + esc(p.detail) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">' +
        '<span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;background:' + badgeBg + ';color:' + badgeColor + ';border:1px solid ' + badgeColor + '44">' + esc(statusLabel(result.status)) + '</span>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<div style="width:60px;height:3px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden">' +
            '<div style="height:100%;width:' + barW + '%;background:' + barColor + ';border-radius:999px;transition:width .4s"></div>' +
          '</div>' +
          '<span style="font-size:10px;font-variant-numeric:tabular-nums;color:' + barColor + ';font-weight:600;min-width:38px;text-align:right">' + result.ms + 'ms</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  async function runHealthCheck() {
    var siteId = state.currentSiteId;
    if (!siteId) return;
    var resultsEl = el('healthCheckResults');
    var summaryEl = el('healthSummaryBar');
    if (!resultsEl) return;

    var groups = {};
    var groupOrder = [];
    HEALTH_ROUTES.forEach(function (r) {
      var g = r.group || 'Outros';
      if (!groups[g]) { groups[g] = []; groupOrder.push(g); }
      groups[g].push(r);
    });

    /* Render skeleton */
    resultsEl.innerHTML = groupOrder.map(function (gname) {
      return '<div style="margin-bottom:22px" id="hgroup-' + esc(gname.replace(/\s/g,'_')) + '">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
          '<span style="font-size:15px">' + (GROUP_ICONS[gname]||'📦') + '</span>' +
          '<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted)">' + esc(gname) + '</span>' +
          '<div style="flex:1;height:1px;background:var(--border)"></div>' +
          '<span id="hgroup-cnt-' + esc(gname.replace(/\s/g,'_')) + '" style="font-size:10px;color:var(--text-muted)">0/' + groups[gname].length + '</span>' +
        '</div>' +
        '<div id="hgroup-rows-' + esc(gname.replace(/\s/g,'_')) + '">' +
          groups[gname].map(function (r) { return renderRouteCard(r, null); }).join('') +
        '</div>' +
      '</div>';
    }).join('');

    if (summaryEl) summaryEl.style.display = 'none';
    var lastEl = el('healthLastCheck');
    if (lastEl) lastEl.textContent = 'Verificando…';

    /* Run all checks, update each card as it completes */
    var completed = [];
    var groupDone = {};
    groupOrder.forEach(function (g) { groupDone[g] = 0; });

    await Promise.all(HEALTH_ROUTES.map(function (r) {
      var g = r.group || 'Outros';
      return checkRoute(siteId, r).then(function (result) {
        completed.push(result);
        /* Update card */
        var card = document.getElementById('hcard-' + r.path.replace(/[^a-z0-9]/gi,'_'));
        if (card) card.outerHTML = renderRouteCard(r, result);
        /* Update group counter */
        groupDone[g]++;
        var cnt = el('hgroup-cnt-' + g.replace(/\s/g,'_'));
        if (cnt) cnt.textContent = groupDone[g] + '/' + groups[g].length;
        /* Update summary progressively */
        updateSummaryBar(completed, summaryEl);
      });
    }));

    if (lastEl) lastEl.textContent = 'Verificado às ' + fmtTime(Date.now());
  }

  function updateSummaryBar(results, summaryEl) {
    if (!summaryEl || !results.length) return;
    var errs  = results.filter(function (r) { return parseRouteDetail(r).cls === 'err' && r.critical; });
    var warns = results.filter(function (r) { return parseRouteDetail(r).cls === 'warn'; });
    var oks   = results.filter(function (r) { return parseRouteDetail(r).cls === 'ok'; });
    var total = HEALTH_ROUTES.length;
    var avgMs = Math.round(results.reduce(function (s, r) { return s + r.ms; }, 0) / results.length);
    summaryEl.style.display = 'flex';
    summaryEl.className = 'health-summary-bar ' + (errs.length ? 'has-err' : 'all-ok');
    summaryEl.innerHTML =
      (errs.length
        ? '<strong style="color:#fca5a5">⚠ ' + errs.length + ' crítico(s) com erro</strong>'
        : results.length < total
          ? '<span style="color:var(--text-muted)">Verificando ' + results.length + '/' + total + '…</span>'
          : '<strong style="color:#86efac">✓ Todas as rotas críticas OK</strong>') +
      '<span style="color:var(--border)">│</span>' +
      '<span style="color:#22c55e;font-weight:600">' + oks.length + ' OK</span>' +
      (warns.length ? '<span style="color:#f59e0b;font-weight:600">  ' + warns.length + ' redirect</span>' : '') +
      ((results.length - oks.length - warns.length) > 0 ? '<span style="color:#ef4444;font-weight:600">  ' + (results.length - oks.length - warns.length) + ' erro</span>' : '') +
      '<span style="color:var(--border)">│</span>' +
      '<span style="color:var(--text-muted)">Média: <strong style="color:' + msColor(avgMs) + '">' + avgMs + 'ms</strong></span>';
  }

  /* ── ENV / Chaves ───────────────────────────────────────────── */
  async function fetchSiteEnvConfig(siteId) {
    var res = await apiFetch(proxyUrl(siteId, '/api/site-config.php'));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function saveSiteEnvConfig(siteId, updates) {
    var res = await apiFetch(proxyUrl(siteId, '/api/site-config.php'), {
      method: 'POST',
      body: JSON.stringify({ updates: updates }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function renderEnvConfigForm(data) {
    var formEl = el('envConfigForm');
    var labelEl = el('envFileLabel');
    if (!formEl) return;
    if (labelEl) labelEl.textContent = data.env_file ? '← ' + data.env_file : '';

    var config = data.config || {};
    var groups = data.groups || [];

    if (!groups.length) {
      formEl.innerHTML = '<div class="chart-empty" data-empty-type="chart"><strong>Sem grupos de configuração.</strong></div>';
      return;
    }

    formEl.innerHTML = '<div class="env-groups">' + groups.map(function (g) {
      var vars = g.vars || [];
      var fields = vars.map(function (v) {
        var val = config[v.key] !== undefined ? config[v.key] : '';
        var inputHtml = '';
        if (v.type === 'select' && Array.isArray(v.options)) {
          inputHtml = '<select data-env-key="' + esc(v.key) + '">' +
            v.options.map(function (opt) {
              return '<option value="' + esc(opt) + '"' + (opt === val ? ' selected' : '') + '>' + esc(opt) + '</option>';
            }).join('') +
          '</select>';
        } else if (v.type === 'password') {
          inputHtml = '<div class="env-field-pw">' +
            '<input type="password" data-env-key="' + esc(v.key) + '" value="' + esc(val) + '" autocomplete="off">' +
            '<button type="button" class="toggle-pw" title="Mostrar/ocultar">👁</button>' +
          '</div>';
        } else {
          inputHtml = '<input type="text" data-env-key="' + esc(v.key) + '" value="' + esc(val) + '" autocomplete="off">';
        }
        return '<div class="env-field"><label>' + esc(v.label || v.key) + '<br><span style="opacity:.55;font-weight:400">' + esc(v.key) + '</span></label>' + inputHtml + '</div>';
      }).join('');

      return '<div class="env-group">' +
        '<div class="env-group-head"><span>' + esc(g.icon || '🔑') + '</span><span>' + esc(g.label) + '</span></div>' +
        '<div class="env-group-body">' + fields + '</div>' +
      '</div>';
    }).join('') + '</div>';

    /* bind toggle-pw buttons */
    formEl.querySelectorAll('.toggle-pw').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var inp = btn.previousElementSibling;
        if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
      });
    });
  }

  async function loadSiteEnvConfig(siteId) {
    var formEl = el('envConfigForm');
    if (formEl) formEl.innerHTML = '<div class="chart-empty" data-empty-type="chart"><strong>Carregando…</strong></div>';
    try {
      var data = await fetchSiteEnvConfig(siteId);
      renderEnvConfigForm(data);
    } catch (e) {
      if (formEl) formEl.innerHTML = '<div class="chart-empty" data-empty-type="chart"><strong>Erro ao carregar: ' + esc(e.message) + '</strong><small>Verifique se o endpoint api/site-config.php existe no site.</small></div>';
    }
  }

  async function saveEnvConfig() {
    var siteId = state.currentSiteId;
    if (!siteId) return;

    var updates = {};
    document.querySelectorAll('[data-env-key]').forEach(function (inp) {
      var key = inp.getAttribute('data-env-key');
      if (key) updates[key] = inp.value;
    });

    hideEl('envSaveMsg');
    hideEl('envErrMsg');

    try {
      await saveSiteEnvConfig(siteId, updates);
      var msg = el('envSaveMsg');
      if (msg) { msg.textContent = '✓ Salvo com sucesso — reinicie o PHP para aplicar.'; showEl('envSaveMsg'); setTimeout(function () { hideEl('envSaveMsg'); }, 5000); }
    } catch (e) {
      var err = el('envErrMsg');
      if (err) { err.textContent = '✗ Erro: ' + e.message; showEl('envErrMsg'); }
    }
  }

  /* ── Add/Edit Site Modal ─────────────────────────────────────── */
  function openAddSiteModal() {
    el('modalName').value = '';
    el('modalApiUrl').value = '';
    el('modalToken').value = '';
    el('modalIcon').value = '';
    el('modalColor').value = '#045acd';
    hideEl('testResult');
    showEl('addSiteModal');
    el('modalName').focus();
  }

  function closeAddSiteModal() { hideEl('addSiteModal'); }

  async function testConnection() {
    var url = (el('modalApiUrl').value || '').trim();
    var token = (el('modalToken').value || '').trim();
    if (!url) { alert('Informe a URL da API.'); return; }

    var res = el('testResult');
    res.className = 'test-result checking';
    res.textContent = '⏳ Testando conexão…';
    showEl('testResult');

    try {
      // Create a temporary fake site entry to test
      var fakeId = '__test__';
      var existingIdx = state.sites.findIndex(function (s) { return s.id === fakeId; });
      if (existingIdx > -1) state.sites.splice(existingIdx, 1);
      state.sites.push({ id: fakeId, name: 'Test', apiUrl: url, token: token });
      await saveSites();

      var testRes = await apiFetch(proxyUrl(fakeId, '/api/health.php'));
      state.sites = state.sites.filter(function (s) { return s.id !== fakeId; });
      await saveSites();

      if (testRes.ok || testRes.status === 200) {
        res.className = 'test-result ok';
        res.textContent = '✓ Conexão OK — API respondeu normalmente.';
      } else {
        res.className = 'test-result bad';
        res.textContent = '✗ API retornou status ' + testRes.status;
      }
    } catch (e) {
      state.sites = state.sites.filter(function (s) { return s.id !== '__test__'; });
      try { await saveSites(); } catch (_) {}
      res.className = 'test-result bad';
      res.textContent = '✗ Erro: ' + e.message;
    }
  }

  async function confirmAddSite() {
    var name = (el('modalName').value || '').trim();
    var apiUrl = (el('modalApiUrl').value || '').trim();
    var token = (el('modalToken').value || '').trim();
    var icon = (el('modalIcon').value || '').trim() || '🌐';
    var color = el('modalColor').value || '#045acd';

    if (!name || !apiUrl || !token) {
      alert('Preencha nome, URL e token antes de adicionar.'); return;
    }

    var newSite = {
      id: 'site-' + uid(),
      name: name,
      apiUrl: apiUrl.replace(/\/$/, ''),
      token: token,
      icon: icon,
      color: color,
      addedAt: new Date().toISOString().slice(0, 10),
    };

    state.sites.push(newSite);
    await saveSites();
    renderSidebar();
    closeAddSiteModal();
    loadHubOverview();
  }

  /* ── Export CSV ──────────────────────────────────────────────── */
  async function exportOrdersCsv() {
    if (!state.currentSiteId) return;
    var days = (el('siteDetailPeriod') && el('siteDetailPeriod').value) || '1';
    var url = proxyUrl(state.currentSiteId, '/api/analytics.php', 'export=orders&days=' + days);
    try {
      var res = await apiFetch(url);
      var blob = await res.blob();
      var burl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = burl; a.download = 'pedidos-' + state.currentSiteId + '-' + days + 'd.csv'; a.click();
      setTimeout(function () { URL.revokeObjectURL(burl); }, 0);
    } catch (e) { alert('Erro ao exportar: ' + e.message); }
  }

  /* ── Init ────────────────────────────────────────────────────── */
  function bindEvents() {
    // Auth
    var loginBtn = el('loginBtn');
    var pwInput = el('pwInput');
    var showPwBtn = el('showPwBtn');

    if (showPwBtn) {
      showPwBtn.addEventListener('click', function () {
        pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
      });
    }

    function doLogin() {
      var pw = pwInput.value.trim();
      if (!pw) return;
      saveToken(pw);
      verifyAuth(pw).then(function (data) {
        state.sites = data.sites || [];
        showApp();
        renderSidebar();
        loadHubOverview();
        startOverviewAutoRefresh();
      }).catch(function () {
        clearToken();
        showEl('loginError');
        pwInput.value = '';
        pwInput.focus();
      });
    }

    if (loginBtn) loginBtn.addEventListener('click', doLogin);
    if (pwInput) pwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

    // Logout
    var logoutBtn = el('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      clearToken();
      clearInterval(state.overviewTimer);
      clearInterval(state.siteTimer);
      showAuth();
    });

    // Hub overview
    var refreshBtn = el('refreshOverviewBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadHubOverview);

    var overviewPeriod = el('overviewPeriod');
    if (overviewPeriod) overviewPeriod.addEventListener('change', loadHubOverview);

    var addSiteEmptyBtn = el('addSiteEmptyBtn');
    if (addSiteEmptyBtn) addSiteEmptyBtn.addEventListener('click', openAddSiteModal);

    // Site detail
    var detailRefreshBtn = el('siteDetailRefreshBtn');
    if (detailRefreshBtn) detailRefreshBtn.addEventListener('click', refreshSiteDetail);

    var periodSel = el('siteDetailPeriod');
    if (periodSel) periodSel.addEventListener('change', refreshSiteDetail);

    // Sub-tabs
    document.querySelectorAll('.sub-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-subtab');
        showSubTab(tab);
        if (tab === 'health' && state.currentSiteId) runHealthCheck();
      });
    });

    // Config
    var saveConfigBtn = el('saveConfigBtn');
    if (saveConfigBtn) saveConfigBtn.addEventListener('click', saveCurrentSiteConfig);

    var removeSiteBtn = el('removeSiteBtn');
    if (removeSiteBtn) removeSiteBtn.addEventListener('click', removeCurrentSite);

    // Pixels
    var addGadsBtn = el('addGadsPixelBtn');
    if (addGadsBtn) addGadsBtn.addEventListener('click', function () {
      var sid = state.currentSiteId;
      if (!sid) return;
      var id    = parseAwId(el('awId') ? el('awId').value : '');
      var label = parseAwLabel(el('awLabel') ? el('awLabel').value : '');
      var desc  = el('awDesc') ? String(el('awDesc').value || '').trim().slice(0, 80) : '';
      if (!id || !label) { alert('Informe o ID e o rótulo da conversão.'); return; }
      if (!state.editingPixels[sid]) state.editingPixels[sid] = { googleAds: [], ga4: [] };
      if (!state.editingPixels[sid].googleAds) state.editingPixels[sid].googleAds = [];
      var key = id + '/' + label;
      var already = (state.editingPixels[sid].googleAds || []).some(function (r) { return (r.id + '/' + r.label) === key; });
      if (already) { alert('Conversão já está na lista.'); return; }
      var row = { id: id, label: label };
      if (desc) row.description = desc;
      state.editingPixels[sid].googleAds.push(row);
      if (el('awId')) el('awId').value = '';
      if (el('awLabel')) el('awLabel').value = '';
      if (el('awDesc')) el('awDesc').value = '';
      renderPixelsList(sid);
    });

    var addGa4Btn = el('addGa4PixelBtn');
    if (addGa4Btn) addGa4Btn.addEventListener('click', function () {
      var sid = state.currentSiteId;
      if (!sid) return;
      var id = parseGa4Id(el('ga4Id') ? el('ga4Id').value : '');
      if (!id) { alert('Informe um Measurement ID válido (ex: G-XXXXXXXXXX).'); return; }
      if (!state.editingPixels[sid]) state.editingPixels[sid] = { googleAds: [], ga4: [] };
      if (!state.editingPixels[sid].ga4) state.editingPixels[sid].ga4 = [];
      if (state.editingPixels[sid].ga4.includes(id)) { alert('GA4 já está na lista.'); return; }
      state.editingPixels[sid].ga4.push(id);
      if (el('ga4Id')) el('ga4Id').value = '';
      renderPixelsList(sid);
    });

    var savePixelsBtn = el('savePixelsBtn');
    if (savePixelsBtn) savePixelsBtn.addEventListener('click', savePixels);

    var verifyPixelsBtn = el('verifyPixelsBtn');
    if (verifyPixelsBtn) verifyPixelsBtn.addEventListener('click', verifyPixelsOnSite);

    // Health check
    var runHealthBtn = el('runHealthCheckBtn');
    if (runHealthBtn) runHealthBtn.addEventListener('click', runHealthCheck);

    // ENV / Chaves
    var saveEnvBtn = el('saveEnvBtn');
    if (saveEnvBtn) saveEnvBtn.addEventListener('click', saveEnvConfig);

    var reloadEnvBtn = el('reloadEnvBtn');
    if (reloadEnvBtn) reloadEnvBtn.addEventListener('click', function () {
      if (state.currentSiteId) loadSiteEnvConfig(state.currentSiteId);
    });

    // Export
    var exportBtn = el('exportOrdersBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportOrdersCsv);

    // Add site modal
    var addSiteBtn = el('addSiteBtn');
    if (addSiteBtn) addSiteBtn.addEventListener('click', openAddSiteModal);

    var cancelBtn = el('cancelAddSiteBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeAddSiteModal);

    var confirmBtn = el('confirmAddSiteBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmAddSite);

    var testBtn = el('testConnectionBtn');
    if (testBtn) testBtn.addEventListener('click', testConnection);

    var backdrop = el('addSiteBackdrop');
    if (backdrop) backdrop.addEventListener('click', closeAddSiteModal);

    // Session modal (for analytics-panel.js)
    var sessClose = el('sessionModalClose');
    if (sessClose) sessClose.addEventListener('click', function () { hideEl('sessionModal'); });
    var sessBackdrop = el('sessionModalBackdrop');
    if (sessBackdrop) sessBackdrop.addEventListener('click', function () { hideEl('sessionModal'); });

    // Tx copy buttons (event delegation)
    document.addEventListener('click', function (e) {
      var copyBtn = e.target.closest('.tx-copy');
      if (copyBtn) {
        var text = copyBtn.getAttribute('data-copy') || '';
        navigator.clipboard.writeText(text).catch(function () {
          var ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        });
        copyBtn.textContent = '✓'; setTimeout(function () { copyBtn.textContent = '⎘'; }, 1500);
      }
    });

    // Back to top
    var backTop = el('backToTop');
    if (backTop) {
      window.addEventListener('scroll', function () { backTop.classList.toggle('visible', window.scrollY > 400); });
      backTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    }

    // Carteira nav
    var carteiraNavBtn = document.querySelector('.nav-item[data-nav="carteira"]');
    if (carteiraNavBtn) carteiraNavBtn.addEventListener('click', function () {
      clearInterval(state.siteTimer);
      state.currentSiteId = null;
      openCarteira();
    });

    var carteiraRefreshBtn = el('carteiraRefreshBtn');
    if (carteiraRefreshBtn) carteiraRefreshBtn.addEventListener('click', loadCarteira);

    // Hub overview nav
    var hubNavBtn = document.querySelector('.nav-item[data-nav="hub-overview"]');
    if (hubNavBtn) {
      hubNavBtn.addEventListener('click', function () {
        clearInterval(state.siteTimer);
        state.currentSiteId = null;
        showSection('hub-overview');
      });
    }
  }

  function showAuth() {
    el('authScreen').classList.remove('hidden');
    el('app').classList.add('hidden');
    hideEl('loginError');
    if (el('pwInput')) el('pwInput').focus();
  }

  function showApp() {
    el('authScreen').classList.add('hidden');
    el('app').classList.remove('hidden');
  }

  function startOverviewAutoRefresh() {
    clearInterval(state.overviewTimer);
    state.overviewTimer = setInterval(function () {
      if (!state.currentSiteId) loadHubOverview();
    }, 20000); /* 20s — captura pagamentos rapidamente */
  }

  /* ── Bootstrap ───────────────────────────────────────────────── */
  function init() {
    bindEvents();

    var savedToken = getToken();
    if (savedToken) {
      state.token = savedToken;
      verifyAuth(savedToken).then(function (data) {
        state.sites = data.sites || [];
        showApp();
        renderSidebar();
        loadHubOverview();
        startOverviewAutoRefresh();
      }).catch(function () {
        clearToken();
        showAuth();
      });
    } else {
      showAuth();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
