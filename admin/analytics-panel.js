/**
 * CredPix Analytics — painel (insights, pedidos, campanhas, drill-down).
 */
(function (global) {
  'use strict';

  var helpers = {};
  var state = {
    section: 'overview',
    lastSaleAt: null,
    ordersQuery: '',
    ordersUtmifyFilter: 'all',
  };

  function h() {
    return helpers;
  }

  function esc(s) {
    return h().esc ? h().esc(s) : String(s == null ? '' : s);
  }

  function escAttr(s) {
    return esc(s)
      .replace(/\r/g, '&#13;')
      .replace(/\n/g, '&#10;');
  }

  function asList(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') return Object.values(data);
    return [];
  }

  function safePanelRender(label, fn) {
    try {
      fn();
    } catch (err) {
      console.error('[CredpixAnalyticsPanel:' + label + ']', err);
    }
  }

  function fmtChange(pct, suffix) {
    suffix = suffix || '%';
    if (pct == null || pct === 0) return '<span class="trend flat">—</span>';
    var cls = pct > 0 ? 'up' : 'down';
    var sign = pct > 0 ? '+' : '';
    return '<span class="trend ' + cls + '">' + sign + pct + suffix + '</span>';
  }

  function emptyHtml(type, title, hint) {
    if (h().chartEmpty) return h().chartEmpty(type, title, hint);
    return '<div class="chart-empty" data-empty-type="' + esc(type || 'chart') + '"><strong>' +
      esc(title || 'Sem dados') + '</strong>' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>';
  }

  function txIdCell(id) {
    if (!id) return '—';
    return '<span class="tx-id-wrap"><span class="tx-id" title="' + escAttr(id) + '">' + esc(id) +
      '</span><button type="button" class="tx-copy" data-copy="' + escAttr(id) + '" title="Copiar">⎘</button></span>';
  }

  function timelineIcon(type) {
    if (type === 'payment_paid') return '✓';
    if (type === 'pix_generated') return '₽';
    if (type === 'page_view') return '◉';
    return '·';
  }

  function renderFunnelDropoff(containerId, dropoff) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var rows = dropoff || [];
    if (!rows.length) {
      el.innerHTML = emptyHtml('funnel', 'Sem dados de funil', 'Aguardando tráfego no período.');
      return;
    }
    el.innerHTML =
      '<div class="table-wrap"><table class="insight-table"><thead><tr><th>Etapa</th><th>Sessões</th><th>Queda vs anterior</th><th>Retenção vs landing</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var rowCls = r.is_wizard_substep ? 'dropoff-wizard' : 'dropoff-section';
        return '<tr class="' + rowCls + '"><td><strong>' + esc(r.label) + '</strong></td><td class="num">' + r.count +
          '</td><td class="num">' + (r.drop_from_prev_pct || 0) + '%</td><td class="num">' +
          (r.retain_from_landing_pct || 0) + '%</td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function renderConversionTimes(containerId, ct) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!ct) {
      el.innerHTML = '<div class="chart-empty">Tempo de conversão aparece quando há sessões com landing, PIX e pagamento.</div>';
      return;
    }
    el.innerHTML =
      '<div class="mini-kpi-row">' +
      '<div class="mini-kpi"><span>Landing → PIX</span><strong>' + esc(ct.landing_to_pix_label || '—') + '</strong><small>' +
        (ct.samples && ct.samples.landing_to_pix ? ct.samples.landing_to_pix + ' amostras' : '') + '</small></div>' +
      '<div class="mini-kpi"><span>PIX → Pago</span><strong>' + esc(ct.pix_to_paid_label || '—') + '</strong><small>' +
        (ct.samples && ct.samples.pix_to_paid ? ct.samples.pix_to_paid + ' amostras' : '') + '</small></div>' +
      '<div class="mini-kpi"><span>Landing → Pago</span><strong>' + esc(ct.landing_to_paid_label || '—') + '</strong><small>' +
        (ct.samples && ct.samples.landing_to_paid ? ct.samples.landing_to_paid + ' amostras' : '') + '</small></div>' +
      '</div>';
  }

  function renderHourlyActivity(containerId, hours) {
    if (typeof window.renderHourlyActivityChart === 'function') {
      window.renderHourlyActivityChart(containerId, hours);
      return;
    }
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '<div class="chart-empty">Gráfico por hora indisponível</div>';
  }

  function renderPixHourlyConversion(containerId, data) {
    var el = document.getElementById(containerId);
    if (!el) return;
    data = data || {};
    var rows = data.hours || [];
    var totals = data.totals || {};
    var totalGen = rows.reduce(function (s, r) { return s + (r.pix_generated || 0); }, 0);
    if (!rows.length || totalGen === 0) {
      el.innerHTML = '<div class="chart-empty">Nenhum PIX gerado no período para comparar por horário.</div>';
      return;
    }
    var maxGen = Math.max(1, rows.reduce(function (m, r) { return Math.max(m, r.pix_generated || 0); }, 1));
    var maxConv = Math.max(1, rows.reduce(function (m, r) { return Math.max(m, r.conversion_rate || 0); }, 1));
    el.innerHTML =
      '<div class="mini-kpi-row" style="margin-bottom:14px">' +
      '<div class="mini-kpi"><span>PIX gerados</span><strong>' + (totals.pix_generated || 0) + '</strong></div>' +
      '<div class="mini-kpi"><span>PIX pagos</span><strong>' + (totals.pix_paid || 0) + '</strong><small>' +
        (totals.pix_pending || 0) + ' pendente(s)</small></div>' +
      '<div class="mini-kpi"><span>Conversão geral</span><strong>' + (totals.conversion_rate || 0) + '%</strong></div>' +
      '</div>' +
      '<div class="hourly-chart"><div class="hourly-grid">' + rows.map(function (r) {
        var genH = Math.max(3, Math.round(((r.pix_generated || 0) / maxGen) * 100));
        var payH = Math.max(3, Math.round(((r.pix_paid || 0) / maxGen) * 100));
        var tip = esc(r.label) + '<br>' + (r.pix_generated || 0) + ' gerados · ' + (r.pix_paid || 0) + ' pagos' +
          '<br>' + (r.pix_pending || 0) + ' pendentes<br><strong>' + (r.conversion_rate || 0) + '% conv.</strong>';
        return '<div class="hourly-col" tabindex="0"><div class="hourly-tip">' + tip + '</div><div class="hourly-bars">' +
          '<div class="hourly-bar pix-gen" style="height:' + genH + '%"></div>' +
          '<div class="hourly-bar pix-pay" style="height:' + payH + '%"></div>' +
          '</div><span class="hourly-label">' + esc(r.label) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="hourly-legend">' +
      '<span><i class="dot" style="background:#f59e0b"></i> Gerados</span>' +
      '<span><i class="dot pay"></i> Pagos</span></div>' +
      '<div class="conv-rate-line">' + rows.map(function (r) {
        var h = Math.max(4, Math.round(((r.conversion_rate || 0) / maxConv) * 100));
        return '<div class="conv-rate-col" title="' + esc(r.label) + ': ' + (r.conversion_rate || 0) + '%">' +
          '<div class="conv-rate-bar" style="height:' + h + '%"></div>' +
          '<span class="hourly-label">' + esc(r.label) + '</span></div>';
      }).join('') + '</div>' +
      '<p style="margin:10px 0 0;font-size:11px;color:var(--text-muted)">Faixa azul = taxa de conversão (pago ÷ gerado) naquela hora.</p>';
  }

  function renderMainPriceComparison(containerId, cmp) {
    var el = document.getElementById(containerId);
    if (!el) return;
    cmp = cmp || {};
    var tiers = cmp.tiers || [];
    if (!cmp.has_data) {
      el.innerHTML = '<div class="chart-empty">Sem PIX do checkout principal (R$ 29,86 ou R$ 39,86) no período filtrado.</div>';
      return;
    }
    var winner = cmp.winner_label || '';
    el.innerHTML =
      '<div class="price-compare-grid">' + tiers.map(function (t) {
        var isWin = winner && t.label === winner;
        return '<div class="price-compare-card' + (isWin ? ' is-winner' : '') + '">' +
          '<h4>' + esc(t.label) + (isWin ? ' · melhor receita' : '') + '</h4>' +
          '<div class="mini-kpi-row" style="grid-template-columns:1fr 1fr">' +
          '<div class="mini-kpi"><span>PIX gerados</span><strong>' + (t.pix_generated || 0) + '</strong></div>' +
          '<div class="mini-kpi"><span>Pagos</span><strong>' + (t.pix_paid || 0) + '</strong><small>' +
            (t.conversion_rate || 0) + '% conv.</small></div>' +
          '</div>' +
          '<div class="mini-kpi-row" style="grid-template-columns:1fr 1fr;margin-top:8px">' +
          '<div class="mini-kpi"><span>Receita</span><strong>' + esc(t.revenue_formatted || '—') + '</strong></div>' +
          '<div class="mini-kpi"><span>Receita / PIX</span><strong>' + esc(t.revenue_per_pix_formatted || '—') + '</strong>' +
            '<small>' + (t.pix_pending || 0) + ' pendente(s)</small></div>' +
          '</div></div>';
      }).join('') + '</div>' +
      '<div class="price-compare-insight">' + esc(cmp.insight || '') +
      '<br><small style="opacity:0.85">Baseado em receita real (PIX pagos). Não separa custo de tráfego por preço; use junto com ROAS por campanha.</small></div>';
  }

  function renderLandingBase(containerId, rows) {
    var el = document.getElementById(containerId);
    if (!el) return;
    rows = rows || [];
    if (!rows.length) {
      el.innerHTML = '<div class="chart-empty">Nenhuma landing registrada</div>';
      return;
    }
    el.innerHTML =
      '<div class="table-wrap"><table><thead><tr><th>Base path</th><th>Landing</th><th>Pagos</th><th>Receita</th><th>Conv.</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><code>' + esc(r.base_path) + '</code></td><td class="num">' + r.landing +
          '</td><td class="num">' + r.payments + '</td><td class="num">' + esc(r.revenue_formatted) +
          '</td><td class="num">' + r.conversion_rate + '%</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderRevenueByState(containerId, rows) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var all = rows || [];
    var known = all.filter(function (r) {
      return (r.revenue_cents || 0) > 0 && r.state_key !== '__unknown__' && (r.state || r.state_label);
    });
    rows = known.length ? known : all.filter(function (r) {
      return (r.revenue_cents || 0) > 0;
    });
    if (!rows.length) {
      el.innerHTML = '<div class="chart-empty">Estado aparece nos pedidos pagos com geo Cloudflare (CF-Region). Gere PIX novo após o deploy.</div>';
      return;
    }
    var max = Math.max(1, rows[0] && rows[0].revenue_cents || 1);
    el.innerHTML = rows.slice(0, 10).map(function (r) {
      var pct = Math.round((r.revenue_cents / max) * 100);
      var label = r.state_label || r.state || '—';
      return '<div class="country-row"><span>' + esc(label) + ' · ' + r.payments + ' pedido(s)</span>' +
        '<strong>' + esc(r.revenue_formatted) + '</strong><div class="bar-track"><div class="bar-fill" style="width:' +
        pct + '%"></div></div></div>';
    }).join('');
  }

  function renderUtmBreakdown(containerId, utm) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!utm) {
      el.innerHTML = emptyHtml('chart', 'Sem UTM no período', 'Dados aparecem quando há utm_source, medium, campaign ou content nos eventos.');
      return;
    }
    var dims = [
      { key: 'utm_source', label: 'Source' },
      { key: 'utm_medium', label: 'Medium' },
      { key: 'utm_campaign', label: 'Campaign' },
      { key: 'utm_content', label: 'Content' },
    ];
    el.innerHTML = dims.map(function (d) {
      var rows = utm[d.key] || [];
      return '<div class="utm-block"><h4>' + d.label + '</h4>' +
        (rows.length
          ? '<div class="table-wrap"><table><thead><tr><th>Valor</th><th>Sessões</th><th>Pedidos</th><th>Receita</th></tr></thead><tbody>' +
            rows.slice(0, 6).map(function (r) {
              return '<tr><td>' + esc(r.value) + '</td><td class="num">' + r.sessions +
                '</td><td class="num">' + r.payments + '</td><td class="num">' + esc(r.revenue_formatted) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<div class="chart-empty">—</div>') +
        '</div>';
    }).join('');
  }

  function buildFilterQuery() {
    var daysEl = document.getElementById('periodSelect');
    var q = 'days=' + encodeURIComponent(daysEl ? daysEl.value : 1);
    var map = [
      ['srcFilter', 'src'],
      ['productFilter', 'product'],
      ['utmCampaignFilter', 'utm_campaign'],
      ['utmMediumFilter', 'utm_medium'],
      ['utmContentFilter', 'utm_content'],
    ];
    map.forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el && el.value) q += '&' + pair[1] + '=' + encodeURIComponent(el.value);
    });
    return q;
  }

  function downloadCsvBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function exportEventsCsv() {
    var daysEl = document.getElementById('periodSelect');
    var days = daysEl ? daysEl.value : 1;
    fetch(h().apiBase() + '?export=csv&' + buildFilterQuery(), { headers: h().authHeaders() })
      .then(function (res) {
        if (res.status === 401) throw new Error('auth');
        if (!res.ok) throw new Error('Export falhou');
        return res.blob();
      })
      .then(function (blob) { downloadCsvBlob(blob, 'credpix-eventos-' + days + 'd.csv'); })
      .catch(function (err) {
        if (err.message === 'auth') {
          alert('Sessão expirada — faça login novamente');
          return;
        }
        alert(err.message || 'Erro ao exportar eventos');
      });
  }

  function updateOrdersCount(stats, rows) {
    var el = document.getElementById('ordersCount');
    if (el) el.textContent = (rows ? rows.length : (stats.orders || []).length) + ' pedido(s)';
  }

  function diagPageUrl() {
    if (h().diagPageUrl) return h().diagPageUrl();
    if (window.credpixPath) return window.credpixPath('/admin/analytics-diag.html');
    return (window.CREDPIX_BASE_PATH || '') + '/admin/analytics-diag.html';
  }

  function renderAdSpendPanel(containerId, campaigns, adSpend, availableSrcs) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var spend = (adSpend && adSpend.by_src) || {};
    var saved = {};
    el.querySelectorAll('input[data-src]').forEach(function (inp) {
      if (inp.value !== '') saved[inp.getAttribute('data-src')] = inp.value;
    });
    var srcSet = {};
    (campaigns || []).forEach(function (c) { if (c.src) srcSet[c.src] = true; });
    Object.keys(spend).forEach(function (s) { srcSet[s] = true; });
    (availableSrcs || []).forEach(function (r) { if (r.src) srcSet[r.src] = true; });
    var srcs = Object.keys(srcSet).sort();
    if (!srcs.length) {
      el.innerHTML =
        '<div class="chart-empty">Nenhuma campanha (src) no período. Use o parâmetro <code>src</code> na URL do tráfego.</div>' +
        '<div class="ad-spend-custom" style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
        '<label style="flex:1;min-width:140px"><span style="display:block;font-size:12px;margin-bottom:4px;color:var(--text-secondary)">Nova src</span>' +
        '<input type="text" id="adSpendCustomSrc" placeholder="ex: facebook"></label>' +
        '<label style="width:120px"><span style="display:block;font-size:12px;margin-bottom:4px;color:var(--text-secondary)">R$</span>' +
        '<input type="number" step="0.01" min="0" id="adSpendCustomVal" placeholder="0,00"></label>' +
        '<button type="button" class="btn btn-ghost" id="adSpendAddSrcBtn">Adicionar</button>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost" id="saveAdSpendBtn">Salvar investimentos</button>';
      return;
    }
    el.innerHTML =
      '<p class="panel-note">Investimento manual por src (em reais). Todas as campanhas conhecidas + valores já salvos.</p>' +
      '<div class="ad-spend-grid">' +
      srcs.map(function (src) {
        var val = saved[src] != null ? saved[src]
          : (spend[src] != null ? (Number(spend[src]) / 100).toFixed(2) : '');
        return '<label><span>' + esc(src) + '</span><input type="number" step="0.01" min="0" data-src="' +
          escAttr(src) + '" value="' + escAttr(val) + '" placeholder="0,00"></label>';
      }).join('') +
      '</div>' +
      '<div class="ad-spend-custom" style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
      '<label style="flex:1;min-width:140px"><span style="display:block;font-size:12px;margin-bottom:4px;color:var(--text-secondary)">Nova src</span>' +
      '<input type="text" id="adSpendCustomSrc" placeholder="ex: facebook"></label>' +
      '<label style="width:120px"><span style="display:block;font-size:12px;margin-bottom:4px;color:var(--text-secondary)">R$</span>' +
      '<input type="number" step="0.01" min="0" id="adSpendCustomVal" placeholder="0,00"></label>' +
      '<button type="button" class="btn btn-ghost" id="adSpendAddSrcBtn">Adicionar</button>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost" id="saveAdSpendBtn">Salvar investimentos</button>';
  }

  function renderSystemStatus(containerId, sys) {
    var el = document.getElementById(containerId);
    if (!el || !sys) return;
    var fmtAgo = h().fmtAgo || function (ms) {
      if (!ms) return '—';
      var min = Math.round(ms / 60000);
      if (min < 60) return min + ' min';
      return Math.round(min / 60) + 'h';
    };
    var wh = sys.webhook || {};
    var storage = sys.storage || {};
    var storageCls = storage.level === 'critical' ? 'bad' : (storage.level === 'warn' ? 'warn' : 'ok');
    var cf = sys.cloudflare_geo || {};
    var cfTitle = cf.paid_total != null
      ? ('Geo em ' + (cf.coverage_pct || 0) + '% dos ' + cf.paid_total + ' pagos')
      : 'Cloudflare geo';
    var cacheNote = (h().currentStats && h().currentStats._cache && h().currentStats._cache.hit)
      ? ' · cache ' + (h().currentStats._cache.age_sec || 0) + 's'
      : '';
    var diagLink = (storage.level === 'warn' || storage.level === 'critical')
      ? ' · <a href="' + esc(diagPageUrl()) + '" style="color:var(--accent)">Diagnóstico</a>'
      : '';
    el.innerHTML =
      '<span class="status-pill ' + (cf.ok ? 'ok' : 'warn') + '" title="' + esc(cfTitle) + '">CF Geo ' +
        (cf.coverage_pct != null ? cf.coverage_pct + '%' : '') + '</span>' +
      '<span class="status-pill ' + (sys.utmify && sys.utmify.enabled ? 'ok' : 'warn') + '">Utmify</span>' +
      '<span class="status-pill ' + (wh.healthy !== false ? 'ok' : 'bad') + '">Webhooks</span>' +
      '<span class="status-pill ' + storageCls + '">Log hoje ' + esc(storage.today_bytes_human || '—') + '</span>' +
      '<span class="status-pill ok">Tracking otimizado</span>' +
      '<span class="status-text">Último evento há ' + fmtAgo(sys.last_event_ago_ms) +
      (sys.last_sale_at ? ' · Última venda ' + esc(sys.last_sale_amount || '') : '') +
      cacheNote + diagLink + '</span>';
  }

  function renderLiveNavBadge(live) {
    var badge = document.getElementById('liveNavBadge');
    if (!badge) return;
    var total = live && live.enabled !== false ? (live.total || 0) : 0;
    if (total > 0) {
      badge.textContent = String(total);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderLiveVisitors(containerId, live) {
    var el = document.getElementById(containerId);
    if (!el) return;
    live = live || {};
    if (live.disabled) {
      el.innerHTML = '<div class="chart-empty">Live desligado. Defina <code>ANALYTICS_LIVE=1</code> no .env para visitantes em tempo real.</div>';
      return;
    }
    var sessions = live.sessions || [];
    el.innerHTML =
      '<div class="mini-kpi-row">' +
      '<div class="mini-kpi"><span>Online agora</span><strong>' + (live.total || 0) + '</strong></div>' +
      '<div class="mini-kpi"><span>Sessões ativas</span><strong>' + sessions.length + '</strong></div>' +
      '</div>' +
      (sessions.length
        ? '<div class="live-chips" style="margin-top:12px">' + sessions.slice(0, 12).map(function (s) {
          return '<span class="chip">' + esc(s.page_label || s.page || '—') +
            (s.city ? ' · ' + esc(s.city) : '') + '</span>';
        }).join('') + '</div>'
        : '<div class="chart-empty" style="margin-top:12px">Nenhum visitante ativo no momento</div>');
  }

  function renderTopCities(containerId, rows) {
    var el = document.getElementById(containerId);
    if (!el) return;
    rows = rows || [];
    if (!rows.length) {
      el.innerHTML = '<div class="chart-empty">Cidades aparecem com geo Cloudflare nos eventos de pagamento ou live.</div>';
      return;
    }
    var max = Math.max(1, rows[0].revenue_cents || rows[0].online || 1);
    el.innerHTML = rows.slice(0, 10).map(function (r) {
      var score = Math.max(r.revenue_cents || 0, (r.online || 0) * 1000);
      var pct = Math.round((score / max) * 100);
      return '<div class="country-row"><span>' + esc(r.city) + ' (' + esc(r.country || '—') + ') · ' +
        r.payments + ' pago(s)' + (r.online ? ' · ' + r.online + ' online' : '') + '</span>' +
        '<strong>' + esc(r.revenue_formatted || '—') + '</strong>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div></div>';
    }).join('');
  }

  function renderPageFlow(containerId, sankey, transitions) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var links = (sankey && sankey.links) || [];
    if (!links.length && transitions && transitions.length) {
      links = transitions.slice(0, 12).map(function (t) {
        var parts = String(t.flow || '').split(' → ');
        return { from: parts[0] || '?', to: parts[1] || '?', value: t.count || 0 };
      });
    }
    if (!links.length) {
      el.innerHTML = '<div class="chart-empty">Fluxo entre páginas aparece com navegação registrada no período.</div>';
      return;
    }
    var max = Math.max(1, links[0].value || 1);
    el.innerHTML = links.slice(0, 12).map(function (l) {
      var pct = Math.round(((l.value || 0) / max) * 100);
      return '<div class="flow-row"><span>' + esc(l.from) + '</span>' +
        '<div class="flow-bar-wrap"><div class="flow-bar" style="width:' + Math.max(pct, 6) + '%"></div>' +
        '<span>' + l.value + '</span></div><span>→ ' + esc(l.to) + '</span></div>';
    }).join('');
  }

  function renderAlertsConfigPanel(stats) {
    var el = document.getElementById('alertsConfigPanel');
    if (!el) return;
    var cfg = stats.alerts_config || {};
    el.innerHTML =
      '<p class="panel-note">Limites dos alertas automáticos no painel (horário comercial America/Sao_Paulo).</p>' +
      '<div class="ad-spend-grid">' +
      '<label><span>Horas sem venda (alerta)</span><input type="number" min="1" max="24" id="alertNoSaleHours" value="' +
        esc(cfg.no_sale_hours != null ? cfg.no_sale_hours : 2) + '"></label>' +
      '<label><span>PIX stale (minutos)</span><input type="number" min="5" max="240" id="alertStalePix" value="' +
        esc(cfg.stale_pix_minutes != null ? cfg.stale_pix_minutes : 30) + '"></label>' +
      '<label><span>Comercial início (h)</span><input type="number" min="0" max="23" id="alertBizStart" value="' +
        esc(cfg.business_hours_start != null ? cfg.business_hours_start : 8) + '"></label>' +
      '<label><span>Comercial fim (h)</span><input type="number" min="1" max="24" id="alertBizEnd" value="' +
        esc(cfg.business_hours_end != null ? cfg.business_hours_end : 22) + '"></label>' +
      '</div><button type="button" class="btn btn-ghost" id="saveAlertsConfigBtn">Salvar alertas</button>';
  }

  function saveAlertsConfig() {
    var payload = {
      no_sale_hours: parseInt(document.getElementById('alertNoSaleHours').value, 10) || 2,
      stale_pix_minutes: parseInt(document.getElementById('alertStalePix').value, 10) || 30,
      business_hours_start: parseInt(document.getElementById('alertBizStart').value, 10) || 8,
      business_hours_end: parseInt(document.getElementById('alertBizEnd').value, 10) || 22,
    };
    fetch(h().apiBase(), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, h().authHeaders()),
      body: JSON.stringify({ action: 'alerts_config', config: payload }),
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (!data.success) throw new Error(data.error || 'Falha ao salvar');
      if (h().reloadStats) h().reloadStats();
    }).catch(function (err) { alert(err.message || 'Erro ao salvar alertas'); });
  }

  function renderUtmifyPanel(stats) {
    var failuresEl = document.getElementById('utmifyFailuresPanel');
    var logsEl = document.getElementById('utmifyLogsPanel');
    if (!failuresEl && !logsEl) return;
    var enabled = stats.utmify && stats.utmify.enabled;
    var failures = stats.utmify_failures || [];
    if (failuresEl) {
      if (!enabled) {
        failuresEl.innerHTML = '<div class="chart-empty">Utmify desligado — configure <code>UTMIFY_API_TOKEN</code> no .env</div>';
      } else if (!failures.length) {
        failuresEl.innerHTML = '<div class="chart-empty">Todos os pedidos do período com envio Utmify OK ✓</div>';
      } else {
        failuresEl.innerHTML =
          '<div class="table-wrap"><table><thead><tr><th>Transação</th><th>Produto</th><th>Valor</th><th>Waiting</th><th>Paid</th><th></th></tr></thead><tbody>' +
          failures.map(function (f) {
            return '<tr><td class="tx-id">' + esc(f.transaction_id || '—') + '</td><td>' + esc(f.product_name || '—') +
              '</td><td class="num">' + esc(f.amount_formatted || '—') + '</td><td>' +
              (f.waiting_sent ? '<span class="badge ok">✓</span>' : '<span class="badge bad">✗</span>') + '</td><td>' +
              (f.paid_sent ? '<span class="badge ok">✓</span>' : '<span class="badge bad">✗</span>') + '</td><td>' +
              '<button type="button" class="btn btn-ghost utmify-retry-btn" data-tx="' + esc(f.transaction_id || '') +
              '">Reenviar</button></td></tr>';
          }).join('') + '</tbody></table></div>';
      }
    }
    if (logsEl) {
      logsEl.innerHTML = '<div class="chart-empty">Carregando logs Utmify…</div>';
      if (!enabled) {
        logsEl.innerHTML = '<div class="chart-empty">—</div>';
        return;
      }
      fetch(h().apiBase() + '?action=utmify_logs&limit=25', { headers: h().authHeaders() })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var logs = (data.logs || []).slice(0, 25);
          if (!logs.length) {
            logsEl.innerHTML = '<div class="chart-empty">Nenhum log em data/utmify/</div>';
            return;
          }
          logsEl.innerHTML =
            '<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Order</th><th>Status</th><th>HTTP</th><th>OK</th></tr></thead><tbody>' +
            logs.map(function (row) {
              var res = row.result || {};
              var payload = row.payload || {};
              return '<tr><td class="tx-id">' + esc((row.logged_at || '').slice(0, 19)) + '</td><td class="tx-id">' +
                esc(payload.orderId || res.orderId || '—') + '</td><td>' + esc(payload.status || res.status || '—') +
                '</td><td class="num">' + esc(res.http != null ? res.http : '—') + '</td><td>' +
                (res.ok ? '<span class="badge ok">✓</span>' : '<span class="badge bad">✗</span>') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        })
        .catch(function () {
          logsEl.innerHTML = '<div class="chart-empty">Erro ao carregar logs</div>';
        });
    }
  }

  function retryUtmify(txId) {
    if (!txId) return;
    fetch(h().apiBase(), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, h().authHeaders()),
      body: JSON.stringify({ action: 'utmify_retry', transaction_id: txId }),
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (!data.ok && !data.success) throw new Error(data.error || 'Falha no reenvio');
      if (h().reloadStats) h().reloadStats();
    }).catch(function (err) { alert(err.message || 'Erro ao reenviar Utmify'); });
  }

  function renderOverviewPanels(stats) {
    stats = stats || {};
    safePanelRender('dropoff', function () {
      renderFunnelDropoff('funnelDropoffPanel', stats.funnel && stats.funnel.dropoff);
    });
    safePanelRender('conversion', function () { renderConversionTimes('conversionTimesPanel', stats.conversion_times); });
    safePanelRender('hourly', function () { renderHourlyActivity('hourlyActivityChart', stats.hourly_activity || []); });
    safePanelRender('pix-hourly', function () {
      if (typeof global.renderPixHourlyConversionChart === 'function') {
        global.renderPixHourlyConversionChart('pixHourlyConversionChart', stats.pix_hourly_conversion || {});
      } else {
        renderPixHourlyConversion('pixHourlyConversionChart', stats.pix_hourly_conversion || {});
      }
    });
    safePanelRender('price-compare', function () {
      if (typeof global.renderMainPriceComparisonChart === 'function') {
        global.renderMainPriceComparisonChart('mainPriceComparisonPanel', stats.main_price_comparison || {});
      } else {
        renderMainPriceComparison('mainPriceComparisonPanel', stats.main_price_comparison || {});
      }
    });
    safePanelRender('demographics', function () {
      renderDemographics('demographicsPanel', 'demographicsPaidChart', stats.demographics || {});
    });
    safePanelRender('geo-state', function () { renderRevenueByState('revenueByStatePanel', stats.revenue_by_state || []); });
    safePanelRender('landing', function () { renderLandingBase('landingBaseTable', stats.funnel_by_base || []); });
    safePanelRender('cities', function () { renderTopCities('topCitiesPanel', stats.top_cities || []); });
    safePanelRender('flow', function () {
      renderPageFlow('pageFlowPanel', stats.transition_sankey, stats.transitions || []);
    });
    safePanelRender('live', function () { renderLiveVisitors('liveVisitorsPanel', stats.live || {}); });
    safePanelRender('alerts-config', function () { renderAlertsConfigPanel(stats); });
    safePanelRender('live-badge', function () { renderLiveNavBadge(stats.live || {}); });
  }

  function renderOverviewInsights(stats) {
    renderOverviewPanels(stats);
  }

  function renderWebhooksPanel(containerId, rows) {
    var el = document.getElementById(containerId);
    if (!el) return;
    rows = rows || [];
    if (!rows.length) {
      el.innerHTML = '<div class="chart-empty">Nenhum webhook registrado</div>';
      return;
    }
    var fmtDate = h().fmtDate || function (ts) { return new Date(Number(ts)).toLocaleString('pt-BR'); };
    el.innerHTML =
      '<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Status</th><th>Assinatura</th><th>ID</th></tr></thead><tbody>' +
      rows.slice(0, 15).map(function (r) {
        var sig;
        if (r.verify_method === 'api') {
          sig = '<span class="badge warn" title="Sem X-Signature; confirmado via API MasterFy">API OK</span>';
        } else if (r.verify_method === 'local') {
          sig = '<span class="badge warn" title="Sem X-Signature; PIX gerado por nós (data/pix)">Local OK</span>';
        } else if (r.signature_valid === false) {
          var tip = [r.reason, r.api_reason, r.local_reason].filter(Boolean).join(' · ');
          sig = '<span class="badge bad" title="' + esc(tip || 'invalid') + '">Rejeitado</span>';
        } else {
          sig = '<span class="badge ok">HMAC OK</span>';
        }
        return '<tr><td>' + fmtDate(r.ts) + '</td><td>' + esc(r.status || '—') + '</td><td>' + sig +
          '</td><td class="tx-id">' + esc(r.payment_id || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function filterOrders(orders) {
    var q = (state.ordersQuery || '').toLowerCase().trim();
    var uf = state.ordersUtmifyFilter;
    return asList(orders).filter(function (o) {
      if (!o || typeof o !== 'object') return false;
      if (uf === 'failed') {
        if (o.utmify && o.utmify.paid_sent && o.utmify.waiting_sent) return false;
      } else if (uf === 'ok') {
        if (!o.utmify || !o.utmify.paid_sent || !o.utmify.waiting_sent) return false;
      }
      if (!q) return true;
      var hay = [o.product_name, o.traffic_src, o.utm_campaign, o.transaction_id, o.amount_formatted, o.session_id]
        .join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function exportFilteredOrders() {
    var stats = h().currentStats;
    if (!stats) {
      alert('Carregue os dados antes de exportar');
      return;
    }
    var rows = filterOrders(stats.orders || []);
    if (!rows.length) {
      alert('Nenhum pedido para exportar com os filtros atuais');
      return;
    }
    var fmtDate = h().fmtDate || function (ts) { return new Date(Number(ts)).toLocaleString('pt-BR'); };
    var header = ['#', 'Data', 'Produto', 'Valor', 'Idade', 'Sexo', 'src', 'Campanha', 'Transacao'];
    var lines = [header.join(';')];
    rows.forEach(function (o) {
      lines.push([
        o.order_num,
        fmtDate(o.ts),
        o.product_name || '',
        o.amount_formatted || '',
        leadAgeLabel(o),
        leadGenderLabel(o),
        o.traffic_src || '',
        o.utm_campaign || '',
        o.transaction_id || '',
      ].map(function (cell) {
        return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
      }).join(';'));
    });
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'credpix-pedidos-filtrados.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 0);
  }

  function renderDemographics(containerId, chartId, demo) {
    var el = document.getElementById(containerId);
    if (!el) return;
    demo = demo || {};
    var hasLeads = (demo.verified_leads || 0) > 0;
    var hasPaidProfile = (demo.paid_with_profile || 0) > 0;
    var hasPaidBands = (demo.age_bands_paid || []).length > 0;
    if (!hasLeads && !hasPaidProfile && !hasPaidBands) {
      var totalPaid = demo.payments_total || 0;
      var hint = totalPaid > 0
        ? totalPaid + ' pedido(s) no período sem idade/sexo nos registros antigos. Novos PIX após o deploy incluem perfil quando o CPF é consultado no wizard.'
        : 'Consulte CPF no wizard (idade/sexo) e confirme pagamentos no período.';
      el.innerHTML = '<div class="chart-empty">' + esc(hint) + '</div>';
      var chartEmpty = document.getElementById(chartId);
      if (chartEmpty) {
        chartEmpty.innerHTML = totalPaid > 0
          ? '<div class="chart-empty">Sem faixa etária — perfil não estava gravado nos pagamentos recuperados.</div>'
          : '<div class="chart-empty">Sem pedidos pagos com perfil no período</div>';
      }
      return;
    }
    if (hasLeads) {
      el.innerHTML =
        '<div class="mini-kpi-row">' +
        '<div class="mini-kpi"><span>CPFs verificados</span><strong>' + (demo.verified_leads || 0) + '</strong></div>' +
        '<div class="mini-kpi"><span>Idade média</span><strong>' + (demo.avg_age != null ? demo.avg_age + ' anos' : '—') + '</strong></div>' +
        '<div class="mini-kpi"><span>Pagos c/ perfil</span><strong>' + (demo.paid_with_profile || 0) + '</strong>' +
          '<small>' + (demo.avg_age_paid != null ? 'média ' + demo.avg_age_paid + ' anos' : '') + '</small></div>' +
        '</div>' +
        renderDemoBars('Leads verificados', demo.age_bands || []) +
        renderDemoGender('Sexo (leads)', demo.gender || []);
    } else {
      el.innerHTML =
        '<div class="mini-kpi-row">' +
        '<div class="mini-kpi"><span>Pagos c/ perfil</span><strong>' + (demo.paid_with_profile || 0) + '</strong>' +
          '<small>' + (demo.avg_age_paid != null ? 'média ' + demo.avg_age_paid + ' anos' : '') + '</small></div>' +
        '</div>';
    }

    var chartEl = document.getElementById(chartId);
    if (chartEl) {
      var paidBands = demo.age_bands_paid || [];
      if (!paidBands.length) {
        chartEl.innerHTML = '<div class="chart-empty">Nenhum pedido pago com idade registrada</div>';
      } else {
        chartEl.innerHTML = renderDemoBars('', paidBands, true) +
          renderDemoGender('Sexo (pagos)', demo.gender_paid || []);
      }
    }
  }

  function renderDemoBars(title, rows, chartMode) {
    rows = rows || [];
    if (!rows.length) {
      return title ? '<div class="chart-empty" style="margin-top:12px">Sem faixas etárias</div>' : '';
    }
    var max = Math.max(1, rows.reduce(function (m, r) { return Math.max(m, r.count || 0); }, 1));
    var html = title ? '<h4 style="margin:16px 0 8px;font-size:12px;color:var(--text-muted)">' + esc(title) + '</h4>' : '';
    html += rows.map(function (r) {
      var pct = Math.round(((r.count || 0) / max) * 100);
      return '<div class="country-row"><span>' + esc(r.label || r.band) + '</span><strong>' + r.count +
        '</strong><div class="bar-track"><div class="bar-fill" style="width:' + Math.max(pct, 4) + '%"></div></div></div>';
    }).join('');
    return chartMode ? html : '<div style="margin-top:8px">' + html + '</div>';
  }

  function renderDemoGender(title, rows) {
    rows = rows || [];
    if (!rows.length) return '';
    return '<h4 style="margin:16px 0 8px;font-size:12px;color:var(--text-muted)">' + esc(title) + '</h4>' +
      '<div class="live-chips">' + rows.map(function (r) {
        return '<span class="chip">' + esc(r.label) + ': <strong>' + r.count + '</strong></span>';
      }).join('') + '</div>';
  }

  function leadAgeLabel(row) {
    if (row.lead_age != null) return String(row.lead_age) + ' anos';
    return row.lead_age_label && row.lead_age_label !== '—' ? row.lead_age_label : '—';
  }

  function leadGenderLabel(row) {
    return row.lead_gender_label && row.lead_gender_label !== '—'
      ? row.lead_gender_label
      : (row.lead_gender === 'M' ? 'M' : row.lead_gender === 'F' ? 'F' : row.lead_gender === 'O' ? 'Outro' : '—');
  }

  function buildOrderRow(o, utmifyOn, renderUtmifyBadges, fmtDate) {
    return '<tr class="session-row" data-session="' + escAttr(o.session_id || '') + '"><td class="num">' + esc(o.order_num) +
      '</td><td>' + fmtDate(o.ts) + '</td><td>' + esc(o.product_name) + '</td><td class="num">' + esc(o.amount_formatted) +
      '</td><td class="num">' + esc(leadAgeLabel(o)) + '</td><td>' + esc(leadGenderLabel(o)) +
      '</td><td>' + esc(o.traffic_src) + '</td><td>' + esc(o.utm_campaign || '—') + '</td><td>' +
      renderUtmifyBadges(o.utmify, utmifyOn) + '</td><td>' + txIdCell(o.transaction_id) + '</td></tr>';
  }

  function renderOrdersTableFiltered(stats) {
    var tbody = document.getElementById('ordersTable');
    if (!tbody) return;
    stats = stats || {};
    var utmifyOn = stats.utmify && stats.utmify.enabled;
    var renderUtmifyBadges = h().renderUtmifyBadges || function () { return '—'; };
    var fmtDate = h().fmtDate || function (ts) { return new Date(Number(ts)).toLocaleString('pt-BR'); };
    var rows = filterOrders(stats.orders || []);
    updateOrdersCount(stats, rows);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="chart-empty">Nenhum pedido encontrado</td></tr>';
      return;
    }
    var html = [];
    rows.forEach(function (o) {
      try {
        html.push(buildOrderRow(o, utmifyOn, renderUtmifyBadges, fmtDate));
      } catch (rowErr) {
        console.error('[CredpixAnalyticsPanel:order-row]', rowErr, o);
      }
    });
    tbody.innerHTML = html.length
      ? html.join('')
      : '<tr><td colspan="10" class="chart-empty">Erro ao exibir pedidos — recarregue a página</td></tr>';
  }

  function pendingAgeCell(p) {
    return leadAgeLabel(p);
  }

  function renderPixPendingWithAge(stats) {
    var tbody = document.getElementById('pixPendingTable');
    var alertEl = document.getElementById('pixPendingAlert');
    if (!tbody) return;
    var utmifyOn = stats.utmify && stats.utmify.enabled;
    var renderUtmifyBadges = h().renderUtmifyBadges || function () { return '—'; };
    var fmtDate = h().fmtDate || function (ts) { return new Date(Number(ts)).toLocaleString('pt-BR'); };
    var rows = asList(stats.pix_pending);
    var totals = stats.totals || {};
    var staleCount = rows.filter(function (p) { return p && p.stale; }).length;
    if (alertEl) {
      if (!rows.length) {
        alertEl.innerHTML = '';
      } else {
        var cls = staleCount >= 2 ? 'pix-stuck-alert danger' : staleCount >= 1 ? 'pix-stuck-alert' : 'pix-stuck-alert';
        alertEl.innerHTML = '<div class="' + cls + '">' + rows.length + ' PIX pendente(s) · ' +
          esc(totals.pix_pending_value_formatted || 'R$ 0,00') + ' parado(s)' +
          (staleCount ? ' · ' + staleCount + ' há mais tempo (alerta)' : '') + '</div>';
      }
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="chart-empty">Nenhum PIX pendente</td></tr>';
      return;
    }
    var html = [];
    rows.forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      try {
        var pixBadge;
        if (!utmifyOn) {
          pixBadge = '<span class="badge warn">Off</span>';
        } else if (!p.utmify || !p.utmify.tx_found) {
          pixBadge = '<span class="badge warn">—</span>';
        } else if (p.utmify.waiting_sent) {
          pixBadge = '<span class="badge ok">PIX ✓</span>';
        } else {
          pixBadge = '<span class="badge bad">PIX ✗</span>';
        }
        var pixAgeCls = p.stale ? ' style="color:var(--warning);font-weight:700"' : '';
        html.push('<tr class="session-row" data-session="' + escAttr(p.session_id || '') + '"><td>' + fmtDate(p.ts) +
          '</td><td>' + esc(p.product_name) + '</td><td class="num">' + esc(p.amount_formatted) +
          '</td><td class="num">' + esc(leadAgeLabel(p)) + '</td><td>' + esc(leadGenderLabel(p)) +
          '</td><td class="num"' + pixAgeCls + '>' + esc(p.age_label || '—') + (p.stale ? ' ⚠' : '') +
          '</td><td>' + esc(p.traffic_src) +
          '</td><td>' + pixBadge +
          '</td><td>' + txIdCell(p.transaction_id) + '</td></tr>');
      } catch (rowErr) {
        console.error('[CredpixAnalyticsPanel:pix-row]', rowErr, p);
      }
    });
    tbody.innerHTML = html.length
      ? html.join('')
      : '<tr><td colspan="9" class="chart-empty">Erro ao exibir PIX pendentes — recarregue a página</td></tr>';
  }

  function renderCampaignsExtended(stats) {
    var tbody = document.getElementById('campaignsTable');
    if (!tbody) return;
    stats = stats || {};
    var camps = asList(stats.campaigns);
    if (!camps.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="chart-empty">Nenhuma campanha no período</td></tr>';
      return;
    }
    var html = [];
    camps.forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      try {
        html.push('<tr class="src-row" data-src="' + escAttr(r.src || '') + '" style="cursor:pointer"><td><strong>' + esc(r.src) +
          '</strong></td><td class="num">' + esc(r.sessions) + '</td><td class="num">' + esc(r.landing) + '</td><td class="num">' +
          esc(r.payments) + '</td><td class="num">' + esc(r.revenue_formatted) + '</td><td class="num">' + esc(r.conversion_rate) +
          '%</td><td class="num">' + esc(r.ad_spend_formatted || '—') + '</td><td class="num">' +
          (r.roas != null ? esc(r.roas) + 'x' : '—') + '</td><td class="num">' + esc(r.cpa_formatted || '—') + '</td></tr>');
      } catch (rowErr) {
        console.error('[CredpixAnalyticsPanel:campaign-row]', rowErr, r);
      }
    });
    tbody.innerHTML = html.length
      ? html.join('')
      : '<tr><td colspan="9" class="chart-empty">Erro ao exibir campanhas — recarregue a página</td></tr>';
  }

  function renderCampaignsPanels(stats) {
    stats = stats || {};
    safePanelRender('ad-spend', function () {
      renderAdSpendPanel('adSpendPanel', stats.campaigns, stats.ad_spend, stats.available_srcs);
    });
    safePanelRender('utm-breakdown', function () { renderUtmBreakdown('utmBreakdownPanel', stats.utm_breakdown); });
    safePanelRender('campaigns-table', function () { renderCampaignsExtended(stats); });
    safePanelRender('webhooks', function () { renderWebhooksPanel('webhooksPanel', stats.webhooks_recent); });
  }

  function checkNewSale(sys) {
    if (!sys || !sys.last_sale_at) return;
    if (state.lastSaleAt && sys.last_sale_at > state.lastSaleAt) {
      showSaleToast(sys.last_sale_amount || 'Nova venda');
    }
    state.lastSaleAt = sys.last_sale_at;
  }

  function showSaleToast(msg) {
    var el = document.getElementById('saleToast');
    if (!el) return;
    el.innerHTML = '<span class="sale-toast-icon">💰</span><span>Venda confirmada · ' + esc(msg) + '</span>';
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 5000);
  }

  function openSessionModal(sessionId) {
    if (!sessionId || !h().apiBase) return;
    var modal = document.getElementById('sessionModal');
    var body = document.getElementById('sessionModalBody');
    if (!modal || !body) return;
    modal.classList.remove('hidden');
    body.innerHTML = '<div class="chart-empty">Carregando jornada…</div>';
    var days = document.getElementById('periodSelect') ? document.getElementById('periodSelect').value : 7;
    fetch(h().apiBase() + '?action=session&session_id=' + encodeURIComponent(sessionId) + '&days=' + days, {
      headers: h().authHeaders(),
    }).then(function (res) {
      if (res.status === 401) throw new Error('auth');
      if (!res.ok) throw new Error('Erro ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data.success || !data.journey) {
        body.innerHTML = '<div class="chart-empty">Sessão não encontrada no período</div>';
        return;
      }
      var j = data.journey;
      var fmtDate = h().fmtDate || function (ts) { return new Date(Number(ts)).toLocaleString('pt-BR'); };
      var extNote = j.extended_search
        ? '<p class="panel-note" style="margin-bottom:12px">Jornada encontrada fora do período filtrado (busca estendida 90 dias).</p>'
        : '';
      body.innerHTML = extNote +
        '<div class="session-meta">' +
        '<div><strong>src</strong> ' + esc(j.traffic_src || '—') + '</div>' +
        '<div><strong>campanha</strong> ' + esc(j.utm_campaign || '—') + '</div>' +
        '<div><strong>geo</strong> ' + esc(j.city || j.country || '—') + '</div>' +
        '<div><strong>idade</strong> ' + esc(j.lead_age != null ? j.lead_age + ' anos' : (j.lead_age_label || '—')) + '</div>' +
        '<div><strong>sexo</strong> ' + esc(j.lead_gender_label || '—') + '</div>' +
        '<div><strong>duração</strong> ' + esc(j.duration_label) + '</div>' +
        '<div><strong>convertido</strong> ' + (j.converted ? 'Sim' : 'Não') + '</div></div>' +
        '<ol class="session-timeline-v2">' + (j.steps || []).map(function (s) {
          var isPaid = s.type === 'payment_paid';
          return '<li class="' + (isPaid ? 'is-paid' : '') + '">' +
            '<div class="tl-icon">' + timelineIcon(s.type) + '</div>' +
            '<div class="tl-body"><span class="t">' + fmtDate(s.ts) + '</span> ' +
            '<span class="type">' + esc(s.type) + '</span><br>' +
            esc(s.page_label || '') + (s.amount_formatted ? ' · <strong>' + esc(s.amount_formatted) + '</strong>' : '') +
            '</div></li>';
        }).join('') + '</ol>';
    }).catch(function (err) {
      if (err.message === 'auth') {
        body.innerHTML = '<div class="chart-empty">Sessão expirada — recarregue a página</div>';
        return;
      }
      body.innerHTML = '<div class="chart-empty">Erro ao carregar sessão</div>';
    });
  }

  function saveAdSpend() {
    var inputs = document.querySelectorAll('#adSpendPanel input[data-src]');
    var bySrc = {};
    inputs.forEach(function (inp) {
      var src = inp.getAttribute('data-src');
      var reais = parseFloat(String(inp.value).replace(',', '.')) || 0;
      if (src) bySrc[src] = Math.round(Math.max(0, reais) * 100);
    });
    var customSrc = document.getElementById('adSpendCustomSrc');
    var customVal = document.getElementById('adSpendCustomVal');
    if (customSrc && customVal && customSrc.value.trim()) {
      bySrc[customSrc.value.trim()] = Math.round(Math.max(0, parseFloat(String(customVal.value).replace(',', '.')) || 0) * 100);
    }
    fetch(h().apiBase(), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, h().authHeaders()),
      body: JSON.stringify({ action: 'ad_spend', by_src: bySrc }),
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (!data.success) throw new Error(data.error || 'Falha ao salvar');
      if (h().reloadStats) h().reloadStats();
    }).catch(function (err) {
      alert(err.message || 'Erro ao salvar investimentos');
    });
  }

  function bindEvents() {
    document.addEventListener('click', function (e) {
      if (e.target.id === 'saveAdSpendBtn') saveAdSpend();
      if (e.target.id === 'saveAlertsConfigBtn') saveAlertsConfig();
      if (e.target.id === 'adSpendAddSrcBtn') {
        var srcInp = document.getElementById('adSpendCustomSrc');
        var valInp = document.getElementById('adSpendCustomVal');
        if (!srcInp || !srcInp.value.trim()) return;
        var stats = h().currentStats;
        if (stats) {
          var camps = (stats.campaigns || []).slice();
          camps.push({ src: srcInp.value.trim() });
          var srcName = srcInp.value.trim();
          renderAdSpendPanel('adSpendPanel', camps, stats.ad_spend, stats.available_srcs);
          var inputs = document.querySelectorAll('#adSpendPanel input[data-src]');
          for (var i = 0; i < inputs.length; i++) {
            if (inputs[i].getAttribute('data-src') === srcName && valInp) {
              inputs[i].value = valInp.value;
              break;
            }
          }
        }
      }
      if (e.target.classList.contains('utmify-retry-btn')) {
        retryUtmify(e.target.getAttribute('data-tx'));
      }
      if (e.target.classList.contains('tx-copy')) {
        var val = e.target.getAttribute('data-copy') || '';
        if (val && navigator.clipboard) {
          navigator.clipboard.writeText(val).catch(function () {});
        }
      }
      if (e.target.id === 'sidebarToggle') {
        document.body.classList.toggle('sidebar-open');
      }
      if (e.target.id === 'sessionModalClose' || e.target.classList.contains('modal-backdrop')) {
        document.getElementById('sessionModal').classList.add('hidden');
      }
      var row = e.target.closest('.session-row');
      if (row) {
        var sid = row.getAttribute('data-session');
        if (sid && sid.trim()) openSessionModal(sid);
      }
    });

    var ordersSearch = document.getElementById('ordersSearch');
    if (ordersSearch) {
      ordersSearch.addEventListener('input', function () {
        state.ordersQuery = ordersSearch.value;
        if (h().currentStats) {
          renderOrdersTableFiltered(h().currentStats);
          updateOrdersCount(h().currentStats, filterOrders(h().currentStats.orders || []));
        }
      });
    }
    var ordersUtmFilter = document.getElementById('ordersUtmifyFilter');
    if (ordersUtmFilter) {
      ordersUtmFilter.addEventListener('change', function () {
        state.ordersUtmifyFilter = ordersUtmifyFilter.value;
        if (h().currentStats) {
          renderOrdersTableFiltered(h().currentStats);
          updateOrdersCount(h().currentStats, filterOrders(h().currentStats.orders || []));
        }
      });
    }

  }

  function renderOrdersTables(stats) {
    renderOrdersTableFiltered(stats);
    renderPixPendingWithAge(stats);
  }

  function render(stats) {
    h().currentStats = stats;

    safePanelRender('system', function () { renderSystemStatus('systemStatusBar', stats.system); });
    safePanelRender('orders', function () { renderOrdersTableFiltered(stats); });
    safePanelRender('pix', function () { renderPixPendingWithAge(stats); });
    safePanelRender('utmify', function () { renderUtmifyPanel(stats); });
    safePanelRender('sale-toast', function () { checkNewSale(stats.system); });
  }

  function onSectionChange(name) {
    state.section = name || 'overview';
  }

  function init(hObj) {
    helpers = hObj || {};
    bindEvents();
  }

  global.CredpixAnalyticsPanel = {
    init: init,
    render: render,
    renderOverviewInsights: renderOverviewInsights,
    renderOverviewPanels: renderOverviewPanels,
    renderPixHourlyConversion: renderPixHourlyConversion,
    renderMainPriceComparison: renderMainPriceComparison,
    renderOrdersTables: renderOrdersTables,
    renderCampaignsPanels: renderCampaignsPanels,
    onSectionChange: onSectionChange,
    exportFilteredOrders: exportFilteredOrders,
    exportEventsCsv: exportEventsCsv,
    getFilteredOrders: function (stats) { return filterOrders((stats || h().currentStats || {}).orders || []); },
  };
})(window);
