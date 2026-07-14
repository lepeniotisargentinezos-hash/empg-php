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
    ordersPage: 1,
    pixPendingPage: 1,
  };
  var ORDERS_PAGE_SIZE = 10;
  var PIX_PENDING_PAGE_SIZE = 7;

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
    var CHART_H = 80;

    var pGen  = totals.pix_generated || 0;
    var pPaid = totals.pix_paid      || 0;
    var pPend = totals.pix_pending   || 0;
    var pConv = totals.conversion_rate || 0;

    /* ── KPI cards ── */
    var out = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">' +
      '<div style="flex:1;min-width:80px;padding:10px 14px;background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.22);border-radius:10px">' +
        '<div style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">PIX gerados</div>' +
        '<div style="font-size:24px;font-weight:700;color:#f59e0b;line-height:1">' + pGen + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:80px;padding:10px 14px;background:rgba(34,197,94,.09);border:1px solid rgba(34,197,94,.22);border-radius:10px">' +
        '<div style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">PIX pagos</div>' +
        '<div style="font-size:24px;font-weight:700;color:#22c55e;line-height:1">' + pPaid + '</div>' +
        (pPend ? '<div style="font-size:10px;color:#f59e0b;margin-top:3px;font-weight:500">' + pPend + ' pendente' + (pPend !== 1 ? 's' : '') + '</div>' : '') +
      '</div>' +
      '<div style="flex:1;min-width:80px;padding:10px 14px;background:rgba(99,102,241,.09);border:1px solid rgba(99,102,241,.22);border-radius:10px">' +
        '<div style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Conversão</div>' +
        '<div style="font-size:24px;font-weight:700;color:#6366f1;line-height:1">' + pConv + '%</div>' +
      '</div>' +
    '</div>';

    /* ── Bar chart ── */
    out += '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">' +
      '<div style="display:flex;gap:3px;align-items:flex-end;min-width:' + Math.max(440, rows.length * 20) + 'px;padding:4px 2px 0">';

    rows.forEach(function (r) {
      var gen     = r.pix_generated  || 0;
      var paid    = r.pix_paid       || 0;
      var pending = r.pix_pending    || 0;
      var conv    = r.conversion_rate || 0;
      var genH    = gen  > 0 ? Math.max(5, Math.round((gen  / maxGen) * CHART_H)) : 0;
      var payH    = paid > 0 ? Math.max(5, Math.round((paid / maxGen) * CHART_H)) : 0;
      var hasAct  = gen > 0;
      var tip = esc(r.label) + ': ' + gen + ' gerados · ' + paid + ' pagos' +
        (pending ? ' · ' + pending + ' pendentes' : '') + ' · ' + conv + '% conv.';

      out += '<div style="flex:1;min-width:14px;display:flex;flex-direction:column;align-items:center;cursor:default" title="' + tip + '">';
      out += '<div style="position:relative;width:100%;height:' + CHART_H + 'px">';
      /* generated bar (amber, semi-transparent background) */
      if (genH > 0) {
        out += '<div style="position:absolute;bottom:0;left:0;right:0;height:' + genH + 'px;border-radius:4px 4px 2px 2px;' +
          'background:linear-gradient(180deg,rgba(252,211,77,.9),rgba(245,158,11,.45))"></div>';
      } else {
        out += '<div style="position:absolute;bottom:0;left:0;right:0;height:3px;border-radius:2px;background:rgba(255,255,255,.05)"></div>';
      }
      /* paid bar (green, solid, narrower, overlaid) */
      if (payH > 0) {
        out += '<div style="position:absolute;bottom:0;left:18%;right:18%;height:' + payH + 'px;border-radius:4px 4px 2px 2px;' +
          'background:linear-gradient(180deg,#86efac,#22c55e)"></div>';
      }
      out += '</div>';
      out += '<div style="font-size:9px;margin-top:4px;font-weight:' + (hasAct ? '600' : '400') + ';' +
        'color:' + (hasAct ? 'var(--text-secondary)' : 'rgba(148,163,184,.25)') + ';letter-spacing:-.01em">' +
        esc(r.label) + '</div>';
      out += '</div>';
    });

    out += '</div>';

    /* ── Legend ── */
    out += '<div style="display:flex;gap:14px;margin-top:10px;padding:0 2px">' +
      '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted)">' +
        '<i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:linear-gradient(135deg,#fcd34d,#f59e0b)"></i> Gerados' +
      '</span>' +
      '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted)">' +
        '<i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#22c55e"></i> Pagos (sobreposto)' +
      '</span>' +
    '</div>';

    out += '</div>'; /* overflow-x wrapper */

    el.innerHTML = out;
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
      { key: 'utm_source',   label: 'Source',   icon: '🌐' },
      { key: 'utm_medium',   label: 'Medium',   icon: '📣' },
      { key: 'utm_campaign', label: 'Campaign', icon: '🎯' },
      { key: 'utm_content',  label: 'Content',  icon: '🖼' },
    ];

    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">' +
      dims.map(function (d) {
        var rows = (utm[d.key] || []).slice(0, 7);
        var maxSess = Math.max(1, rows.reduce(function (m, r) { return Math.max(m, r.sessions || 0); }, 1));
        var totalSess = rows.reduce(function (s, r) { return s + (r.sessions || 0); }, 0);

        var body = !rows.length
          ? '<div style="padding:14px 0;font-size:12px;color:var(--text-muted);text-align:center">—</div>'
          : rows.map(function (r) {
              var pct = Math.max(4, Math.round(((r.sessions || 0) / maxSess) * 100));
              var label = r.value && r.value !== '' ? r.value : '(direto)';
              var hasPaid = (r.payments || 0) > 0;
              return '<div style="margin-bottom:9px">' +
                '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;gap:8px">' +
                  '<span style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0" title="' + esc(label) + '">' + esc(label) + '</span>' +
                  '<span style="font-size:11px;color:var(--text-muted);white-space:nowrap;flex-shrink:0">' +
                    (r.sessions || 0) + ' sess' +
                    (hasPaid ? ' · <span style="color:#22c55e">' + r.payments + ' pago' + (r.payments > 1 ? 's' : '') + '</span>' : '') +
                  '</span>' +
                '</div>' +
                '<div style="height:5px;border-radius:999px;background:var(--bg-elevated);overflow:hidden">' +
                  '<div style="height:100%;width:' + pct + '%;border-radius:999px;background:' +
                    (hasPaid ? 'linear-gradient(90deg,#6366f1,#22c55e)' : 'linear-gradient(90deg,var(--accent),#06b6d4)') +
                  '"></div>' +
                '</div>' +
              '</div>';
            }).join('');

        return '<div style="background:linear-gradient(145deg,rgba(18,26,46,.98),rgba(13,19,33,.95));border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)">' +
            '<span style="font-size:15px">' + d.icon + '</span>' +
            '<span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)">' + esc(d.label) + '</span>' +
            (totalSess ? '<span style="margin-left:auto;font-size:11px;color:var(--text-muted)">' + totalSess + ' sessões</span>' : '') +
          '</div>' +
          body +
        '</div>';
      }).join('') +
    '</div>';
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

    /* build src map with campaign data */
    var srcMap = {};
    (campaigns || []).forEach(function (c) {
      if (!c.src) return;
      srcMap[c.src] = { sessions: c.sessions || 0, payments: c.payments || 0, revenue_cents: c.revenue_cents || 0, roas: c.roas };
    });
    Object.keys(spend).forEach(function (s) { if (!srcMap[s]) srcMap[s] = { sessions: 0, payments: 0, revenue_cents: 0 }; });
    (availableSrcs || []).forEach(function (r) { if (r.src && !srcMap[r.src]) srcMap[r.src] = { sessions: r.sessions || 0, payments: 0, revenue_cents: 0 }; });
    var srcs = Object.keys(srcMap).sort();

    var addRowHtml =
      '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--border);background:rgba(255,255,255,.015)">' +
        '<div style="flex:1;min-width:140px">' +
          '<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:5px">Nova src</div>' +
          '<input type="text" id="adSpendCustomSrc" placeholder="ex: facebook" style="width:100%;margin:0">' +
        '</div>' +
        '<div style="width:120px">' +
          '<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:5px">Investimento R$</div>' +
          '<input type="number" step="0.01" min="0" id="adSpendCustomVal" placeholder="0,00" style="width:100%;margin:0">' +
        '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="adSpendAddSrcBtn" style="white-space:nowrap">＋ Adicionar</button>' +
      '</div>';

    var saveRowHtml =
      '<div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 16px;border-top:1px solid var(--border)">' +
        '<span style="font-size:11px;color:var(--text-muted)">Os valores são salvos no servidor e usados para calcular ROAS/CPA.</span>' +
        '<button type="button" class="btn btn-primary btn-sm" id="saveAdSpendBtn">💾 Salvar</button>' +
      '</div>';

    if (!srcs.length) {
      el.innerHTML =
        '<div style="padding:16px;font-size:13px;color:var(--text-muted)">Nenhuma campanha detectada. Adicione manualmente:</div>' +
        addRowHtml + saveRowHtml;
      return;
    }

    /* header */
    var headerHtml =
      '<div style="display:grid;grid-template-columns:1fr 60px 60px 140px 90px;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.02)">' +
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)">Src</div>' +
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:right">Sessões</div>' +
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:right">Pedidos</div>' +
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:right">Investimento R$</div>' +
        '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);text-align:right">ROAS</div>' +
      '</div>';

    /* rows */
    var rowsHtml = srcs.map(function (src) {
      var d   = srcMap[src] || {};
      var val = saved[src] != null ? saved[src]
        : (spend[src] != null ? (Number(spend[src]) / 100).toFixed(2) : '');
      var spendCents = spend[src] != null ? Number(spend[src]) : (val ? Math.round(parseFloat(val) * 100) : 0);
      var roas = d.roas != null ? d.roas
        : (spendCents > 0 && d.revenue_cents > 0 ? ((d.revenue_cents / spendCents)).toFixed(2) : null);
      var roasHtml = roas != null
        ? '<span style="font-size:12px;font-weight:700;color:' + (roas >= 2 ? '#22c55e' : roas >= 1 ? '#f59e0b' : '#ef4444') + '">' + roas + 'x</span>'
        : '<span style="color:var(--text-muted);font-size:12px">—</span>';
      var hasPaid = (d.payments || 0) > 0;

      return '<div style="display:grid;grid-template-columns:1fr 60px 60px 140px 90px;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(148,163,184,.06);transition:background .15s" ' +
        'onmouseover="this.style.background=\'rgba(99,102,241,.05)\'" onmouseout="this.style.background=\'\'">' +
        '<div style="display:flex;align-items:center;gap:8px;min-width:0">' +
          '<div style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:' + (hasPaid ? '#22c55e' : 'var(--text-muted)') + '"></div>' +
          '<span style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(src) + '">' + esc(src) + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);text-align:right;font-variant-numeric:tabular-nums">' + (d.sessions || 0) + '</div>' +
        '<div style="font-size:12px;text-align:right;font-variant-numeric:tabular-nums;color:' + (hasPaid ? '#22c55e' : 'var(--text-secondary)') + ';font-weight:' + (hasPaid ? '600' : '400') + '">' + (d.payments || 0) + '</div>' +
        '<div><input type="number" step="0.01" min="0" data-src="' + escAttr(src) + '" value="' + escAttr(val) + '" placeholder="0,00" ' +
          'style="width:100%;margin:0;font-size:13px;text-align:right;font-variant-numeric:tabular-nums"></div>' +
        '<div style="text-align:right">' + roasHtml + '</div>' +
      '</div>';
    }).join('');

    el.innerHTML =
      '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">' +
        headerHtml + rowsHtml + addRowHtml + saveRowHtml +
      '</div>';
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
    var sessions = Array.isArray(live.sessions) ? live.sessions : Object.values(live.sessions || {});
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
    var fmtAgo = h().fmtAgo || function (ts) {
      var diff = Date.now() - Number(ts);
      if (diff < 60000) return 'agora';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' min atrás';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h atrás';
      return Math.floor(diff / 86400000) + 'd atrás';
    };
    var fmtDate = h().fmtDate || function (ts) { return new Date(Number(ts)).toLocaleString('pt-BR'); };

    var STATUS_STYLE = {
      'paid':    'background:rgba(34,197,94,.15);color:#86efac;border-color:rgba(34,197,94,.3)',
      'pending': 'background:rgba(245,158,11,.13);color:#fde68a;border-color:rgba(245,158,11,.3)',
      'expired': 'background:rgba(239,68,68,.13);color:#fca5a5;border-color:rgba(239,68,68,.3)',
      'failed':  'background:rgba(239,68,68,.13);color:#fca5a5;border-color:rgba(239,68,68,.3)',
    };

    el.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px">' +
      rows.slice(0, 15).map(function (r) {
        var status   = (r.status || 'pending').toLowerCase();
        var stStyle  = STATUS_STYLE[status] || 'background:rgba(148,163,184,.1);color:var(--text-muted);border-color:var(--border)';
        var pid      = r.payment_id || '—';
        var pidShort = pid.length > 16 ? pid.slice(0, 8) + '…' + pid.slice(-6) : pid;

        var sig;
        if (r.verify_method === 'api') {
          sig = '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:999px;background:rgba(245,158,11,.13);color:#fde68a;border:1px solid rgba(245,158,11,.3)" title="Confirmado via API MasterFy">API OK</span>';
        } else if (r.verify_method === 'local') {
          sig = '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:999px;background:rgba(245,158,11,.13);color:#fde68a;border:1px solid rgba(245,158,11,.3)" title="PIX gerado localmente">Local OK</span>';
        } else if (r.signature_valid === false) {
          var tip = [r.reason, r.api_reason, r.local_reason].filter(Boolean).join(' · ');
          sig = '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:999px;background:rgba(239,68,68,.13);color:#fca5a5;border:1px solid rgba(239,68,68,.3)" title="' + escAttr(tip || 'invalid') + '">Rejeitado</span>';
        } else {
          sig = '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:999px;background:rgba(34,197,94,.13);color:#86efac;border:1px solid rgba(34,197,94,.3)">HMAC OK</span>';
        }

        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;background:rgba(255,255,255,.02);border:1px solid var(--border)">' +
          /* status dot */
          '<div style="width:7px;height:7px;border-radius:50%;flex-shrink:0;background:' +
            (status === 'paid' ? '#22c55e' : status === 'pending' ? '#f59e0b' : '#ef4444') + '"></div>' +
          /* status badge */
          '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;border:1px solid;' + stStyle + '">' + esc(status) + '</span>' +
          /* sig */
          sig +
          /* id */
          '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:var(--text-secondary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(pid) + '">' + esc(pidShort) + '</span>' +
          /* copy */
          (pid !== '—' ? '<button type="button" class="tx-copy" data-copy="' + escAttr(pid) + '" style="flex-shrink:0;border:none;background:var(--surface-hover);color:var(--text-muted);border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer" title="Copiar ID">⎘</button>' : '') +
          /* time */
          '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap;flex-shrink:0" title="' + escAttr(fmtDate(r.ts)) + '">' + esc(fmtAgo(r.ts)) + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
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
      renderPagination('ordersTablePagination', 0, 0, ORDERS_PAGE_SIZE, function () {});
      return;
    }

    /* Paginação */
    var totalPages = Math.max(1, Math.ceil(rows.length / ORDERS_PAGE_SIZE));
    if (state.ordersPage > totalPages) state.ordersPage = 1;
    var page = state.ordersPage;
    var start = (page - 1) * ORDERS_PAGE_SIZE;
    var pageRows = rows.slice(start, start + ORDERS_PAGE_SIZE);

    var html = [];
    pageRows.forEach(function (o) {
      try {
        html.push(buildOrderRow(o, utmifyOn, renderUtmifyBadges, fmtDate));
      } catch (rowErr) {
        console.error('[CredpixAnalyticsPanel:order-row]', rowErr, o);
      }
    });
    tbody.innerHTML = html.length
      ? html.join('')
      : '<tr><td colspan="10" class="chart-empty">Erro ao exibir pedidos — recarregue a página</td></tr>';

    renderPagination('ordersTablePagination', rows.length, page, ORDERS_PAGE_SIZE, function (newPage) {
      state.ordersPage = newPage;
      renderOrdersTableFiltered(h().currentStats || stats);
    });
  }

  /** Renderiza controles de paginação em um container. Cria o container se não existir. */
  function renderPagination(containerId, total, page, pageSize, onChange) {
    var container = document.getElementById(containerId);
    if (!container) {
      /* Cria dinamicamente antes da tabela pai */
      var tableId = containerId === 'ordersTablePagination' ? 'ordersTable' : 'pixPendingTable';
      var tbody = document.getElementById(tableId);
      if (!tbody) return;
      var tableWrap = tbody.closest('.table-wrap') || tbody.parentElement;
      if (!tableWrap) return;
      container = document.createElement('div');
      container.id = containerId;
      container.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px;padding:0 4px;font-size:12px;flex-wrap:wrap';
      tableWrap.parentElement.appendChild(container);
    }

    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (!total) {
      container.innerHTML = '';
      return;
    }
    var start = (page - 1) * pageSize + 1;
    var end   = Math.min(page * pageSize, total);

    function btn(txt, target, disabled) {
      return '<button type="button" data-page="' + target + '" ' + (disabled ? 'disabled' : '') +
        ' style="padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:' +
        (disabled ? 'transparent' : 'var(--surface)') + ';color:' +
        (disabled ? 'var(--text-muted)' : 'var(--text)') + ';cursor:' +
        (disabled ? 'not-allowed' : 'pointer') + ';font-size:11px;font-family:inherit">' + txt + '</button>';
    }

    /* Números — mostra até 5 páginas ao redor da atual */
    var numbers = '';
    var minP = Math.max(1, page - 2);
    var maxP = Math.min(totalPages, page + 2);
    if (minP > 1) {
      numbers += btn('1', 1, false);
      if (minP > 2) numbers += '<span style="color:var(--text-muted);padding:0 4px">…</span>';
    }
    for (var p = minP; p <= maxP; p++) {
      var isActive = p === page;
      numbers += '<button type="button" data-page="' + p + '" style="padding:5px 10px;border-radius:6px;border:1px solid ' +
        (isActive ? 'var(--accent)' : 'var(--border)') + ';background:' +
        (isActive ? 'var(--accent-soft)' : 'var(--surface)') + ';color:' +
        (isActive ? 'var(--accent)' : 'var(--text)') + ';font-weight:' + (isActive ? '700' : '500') +
        ';cursor:pointer;font-size:11px;font-family:inherit">' + p + '</button>';
    }
    if (maxP < totalPages) {
      if (maxP < totalPages - 1) numbers += '<span style="color:var(--text-muted);padding:0 4px">…</span>';
      numbers += btn(String(totalPages), totalPages, false);
    }

    container.innerHTML =
      '<span style="color:var(--text-muted)">' + start + '–' + end + ' de <strong style="color:var(--text)">' + total + '</strong></span>' +
      '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">' +
        btn('‹', Math.max(1, page - 1), page === 1) +
        numbers +
        btn('›', Math.min(totalPages, page + 1), page === totalPages) +
      '</div>';

    /* Bind clicks */
    container.querySelectorAll('button[data-page]').forEach(function (b) {
      b.addEventListener('click', function () {
        var target = parseInt(b.getAttribute('data-page'), 10);
        if (!isNaN(target)) onChange(target);
      });
    });
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
        var severity = staleCount >= 2 ? 'danger' : staleCount >= 1 ? 'warn' : 'info';
        var palette = {
          danger: { bg: 'rgba(239,68,68,.10)', border: 'rgba(239,68,68,.35)', ico: '#ef4444', title: '#fca5a5', label: 'Ação urgente' },
          warn:   { bg: 'rgba(245,158,11,.10)', border: 'rgba(245,158,11,.35)', ico: '#f59e0b', title: '#fde68a', label: 'Atenção' },
          info:   { bg: 'rgba(4,90,205,.10)',   border: 'rgba(4,90,205,.35)',   ico: '#60a5fa', title: '#93c5fd', label: 'PIX pendentes' },
        };
        var p = palette[severity];
        var totalStr = esc(totals.pix_pending_value_formatted || 'R$ 0,00');

        alertEl.innerHTML =
          '<div style="' +
            'display:flex;align-items:center;gap:16px;padding:16px 20px;' +
            'background:' + p.bg + ';border:1px solid ' + p.border + ';' +
            'border-left:4px solid ' + p.ico + ';border-radius:12px;' +
          '">' +
            /* Ícone */
            '<div style="width:44px;height:44px;border-radius:12px;background:' + p.ico + '22;border:1px solid ' + p.border + ';display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
              '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + p.ico + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' +
              '</svg>' +
            '</div>' +

            /* Texto */
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + p.title + ';margin-bottom:4px">' + p.label + '</div>' +
              '<div style="font-size:14px;color:var(--text);font-weight:500">' +
                '<strong style="font-size:16px;color:' + p.ico + '">' + rows.length + '</strong> PIX pendente' + (rows.length !== 1 ? 's' : '') +
                ' · <strong style="color:' + p.ico + '">' + totalStr + '</strong> parado' + (rows.length !== 1 ? 's' : '') +
                (staleCount ? ' · <span style="color:' + p.ico + '">⚠ ' + staleCount + ' há mais tempo</span>' : '') +
              '</div>' +
            '</div>' +

            /* Ação: scroll para a tabela */
            '<button type="button" onclick="document.getElementById(\'pixPendingTable\').closest(\'.panel\').scrollIntoView({behavior:\'smooth\',block:\'start\'})" style="' +
              'flex-shrink:0;padding:8px 14px;border-radius:8px;border:1px solid ' + p.border + ';' +
              'background:' + p.ico + '15;color:' + p.title + ';font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap' +
            '">Ver detalhes ↓</button>' +
          '</div>';
      }
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="chart-empty">Nenhum PIX pendente</td></tr>';
      renderPagination('pixPendingTablePagination', 0, 0, PIX_PENDING_PAGE_SIZE, function () {});
      return;
    }

    /* Paginação */
    var totalPagesPix = Math.max(1, Math.ceil(rows.length / PIX_PENDING_PAGE_SIZE));
    if (state.pixPendingPage > totalPagesPix) state.pixPendingPage = 1;
    var pagePix  = state.pixPendingPage;
    var startPix = (pagePix - 1) * PIX_PENDING_PAGE_SIZE;
    var pageRowsPix = rows.slice(startPix, startPix + PIX_PENDING_PAGE_SIZE);

    var html = [];
    pageRowsPix.forEach(function (p) {
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

    renderPagination('pixPendingTablePagination', rows.length, pagePix, PIX_PENDING_PAGE_SIZE, function (newPage) {
      state.pixPendingPage = newPage;
      renderPixPendingWithAge(h().currentStats || stats);
    });
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
    /* hub.html usa sessionModalContent, admin usa sessionModalBody */
    var body = document.getElementById('sessionModalContent') || document.getElementById('sessionModalBody');
    var title = document.getElementById('sessionModalTitle');
    if (!modal || !body) return;
    if (title) title.textContent = 'Jornada da sessão';
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
      var fmtAgo  = h().fmtAgo  || function () { return '—'; };

      var extNote = j.extended_search
        ? '<div style="padding:10px 14px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);border-radius:8px;margin-bottom:16px;font-size:12px;color:#fde68a">⏱ Jornada fora do período filtrado (busca estendida 90 dias).</div>'
        : '';

      /* Cabeçalho: status + valor */
      var isConv = !!j.converted;
      var statusColor = isConv ? '#22c55e' : '#f59e0b';
      var statusText  = isConv ? 'CONVERTIDO' : 'PENDENTE';
      var lastPaid = (j.steps || []).slice().reverse().find(function (s) { return s.type === 'payment_paid'; });
      var amountFmt = (lastPaid && lastPaid.amount_formatted) || j.amount_formatted || '—';

      /* Meta cliente */
      var meta = j.meta || j.wizard_meta || {};
      var phone = j.phone || meta.phone || '—';
      var pixKey = j.pix_key || meta.pix_key || '—';
      var pixType = j.pix_key_type || meta.pix_key_type || meta.tipo_pix || '—';
      var loanAmount = meta.valor_emprestimo || meta.loan_amount || '—';
      var installments = meta.num_parcelas || meta.installments || '—';
      var monthlyIncome = meta.renda_mensal || meta.monthly_income || '—';
      var incomeType = meta.tipo_renda || meta.income_type || '—';

      function section(title, rows) {
        var filtered = rows.filter(function (r) { return r[1] !== '—' && r[1] !== null && r[1] !== undefined && r[1] !== ''; });
        if (!filtered.length) return '';
        return '<div style="margin-bottom:18px">' +
          '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:10px">' + esc(title) + '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">' +
            filtered.map(function (r) {
              return '<div style="padding:10px 12px;background:rgba(4,90,205,.05);border:1px solid rgba(4,90,205,.15);border-radius:8px">' +
                '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">' + esc(r[0]) + '</div>' +
                '<div style="font-size:13px;font-weight:600;color:var(--text);word-break:break-all">' + esc(r[1]) + '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>';
      }

      /* Header — nome do cliente em destaque */
      var customerName = j.customer_name || 'Cliente';
      var initial = String(customerName).trim().charAt(0).toUpperCase() || '?';
      var header =
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:16px">' +
          '<div style="display:flex;align-items:center;gap:14px;min-width:0;flex:1">' +
            /* Avatar */
            '<div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#045acd,#0349A8);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;flex-shrink:0;box-shadow:0 4px 14px rgba(4,90,205,.35)">' + esc(initial) + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:18px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(customerName) + '</div>' +
              (j.customer_document ? '<div style="font-size:11px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;margin-top:2px">' + esc(j.customer_document) + '</div>' : '') +
            '</div>' +
          '</div>' +

          /* Status + valor */
          '<div style="text-align:right;flex-shrink:0">' +
            '<span style="font-size:10px;font-weight:800;letter-spacing:.1em;padding:4px 10px;border-radius:999px;background:' + statusColor + '22;color:' + statusColor + ';border:1px solid ' + statusColor + '44">' + statusText + '</span>' +
            '<div style="font-size:24px;font-weight:800;color:' + statusColor + ';margin-top:8px;font-variant-numeric:tabular-nums">' + esc(amountFmt) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Duração: <strong style="color:var(--text)">' + esc(j.duration_label || '—') + '</strong></div>' +
          '</div>' +
        '</div>';

      /* Timeline compacta */
      var timeline = (j.steps || []).length
        ? '<div style="margin-top:20px">' +
            '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:12px">📍 TIMELINE DA JORNADA</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px;padding-left:12px;border-left:2px solid var(--border)">' +
              j.steps.map(function (s) {
                var isPaidStep = s.type === 'payment_paid';
                var isPixStep  = s.type === 'pix_generated';
                var dotColor = isPaidStep ? '#22c55e' : isPixStep ? '#f59e0b' : '#60a5fa';
                var typeLabel = { 'page_view': '👁 Visita', 'wizard_step': '📋 Wizard', 'pix_generated': '⚡ PIX gerado', 'payment_paid': '✅ PIX pago', 'upsell_click': '⬆ Upsell', 'upsell_routed': '⬆ Upsell (view)' }[s.type] || s.type;
                return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,255,255,.02);border-radius:8px;position:relative">' +
                  '<span style="position:absolute;left:-19px;top:50%;transform:translateY(-50%);width:12px;height:12px;border-radius:50%;background:' + dotColor + ';border:3px solid var(--bg-elevated,var(--bg))"></span>' +
                  '<span style="font-size:11px;font-weight:600;color:' + dotColor + ';min-width:110px">' + typeLabel + '</span>' +
                  '<span style="font-size:11px;color:var(--text-muted);flex:1">' + esc(fmtDate(s.ts)) + '</span>' +
                  (s.page_label ? '<span style="font-size:11px;color:var(--text-secondary)">' + esc(s.page_label) + '</span>' : '') +
                  (s.amount_formatted ? '<strong style="font-size:12px;color:' + dotColor + '">' + esc(s.amount_formatted) + '</strong>' : '') +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>'
        : '';

      body.innerHTML = extNote + header +
        section('Cliente', [
          ['📱 Telefone', typeof phone === 'string' ? phone : String(phone)],
          ['✉ E-mail', j.customer_email || '—'],
          ['🎂 Idade', j.lead_age != null ? j.lead_age + ' anos' : (j.lead_age_label || '—')],
          ['⚧ Sexo', j.lead_gender_label || j.lead_gender || '—'],
          ['📍 Localização', j.city ? j.city + (j.country ? ' / ' + j.country : '') : (j.country || '—')],
        ]) +
        section('Chave PIX escolhida', [
          ['Tipo', pixType],
          ['Chave', pixKey],
        ]) +
        section('Empréstimo solicitado', [
          ['💰 Valor', loanAmount],
          ['📅 Parcelas', installments !== '—' ? installments + 'x' : '—'],
          ['💵 Renda mensal', monthlyIncome],
          ['💼 Tipo de renda', incomeType],
          ['🗓 Dia pagamento', meta.dia_pagamento || meta.payment_day || '—'],
          ['💳 Método', meta.metodo_pagamento || meta.payment_method_choice || '—'],
        ]) +
        section('Rastreio', [
          ['🎯 Fonte', j.traffic_src || '—'],
          ['📣 Campanha', j.utm_campaign || '—'],
          ['🔗 Medium', j.utm_medium || '—'],
          ['📝 Content', j.utm_content || '—'],
        ]) +
        timeline;
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
        state.ordersPage = 1;
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
        state.ordersPage = 1;
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
