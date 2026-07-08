'use strict';

const fs = require('fs');
const path = require('path');
const leadProfile = require('./lead-profile');

const AD_SPEND_FILE = path.join(__dirname, '..', 'data', 'analytics', 'ad-spend.json');
const ALERTS_CONFIG_FILE = path.join(__dirname, '..', 'data', 'analytics', 'alerts-config.json');

const DEFAULT_ALERTS_CONFIG = {
  no_sale_hours: 2,
  stale_pix_minutes: 30,
  business_hours_start: 8,
  business_hours_end: 22,
};

function ensureInsightsDir() {
  const dir = path.dirname(AD_SPEND_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data && typeof data === 'object' ? data : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensureInsightsDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readAdSpend() {
  return readJsonFile(AD_SPEND_FILE, { by_src: {}, updated_at: null });
}

function saveAdSpend(bySrc) {
  const payload = { by_src: bySrc || {}, updated_at: Date.now() };
  writeJsonFile(AD_SPEND_FILE, payload);
  return payload;
}

function readAlertsConfig() {
  return { ...DEFAULT_ALERTS_CONFIG, ...readJsonFile(ALERTS_CONFIG_FILE, {}) };
}

function saveAlertsConfig(config) {
  const payload = { ...DEFAULT_ALERTS_CONFIG, ...config, updated_at: Date.now() };
  writeJsonFile(ALERTS_CONFIG_FILE, payload);
  return payload;
}

function formatBrl(cents) {
  return 'R$ ' + (Number(cents) / 100).toFixed(2).replace('.', ',');
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec + 's';
  const min = Math.round(sec / 60);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + 'h' + (m ? ' ' + m + 'min' : '');
}

function median(values) {
  const nums = values.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

function pctChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function buildFunnelDropoff(funnelCounts, wizardSteps = []) {
  const landing = Number(funnelCounts.landing) || 0;
  const rows = [];
  let prev = null;

  const addRow = (key, label, count, isWizardSubstep = false) => {
    const dropFromPrev =
      prev != null && prev > 0 ? Math.round(((prev - count) / prev) * 1000) / 10 : 0;
    const retainFromLanding =
      landing > 0 ? Math.round((count / landing) * 1000) / 10 : 0;
    rows.push({
      step: key,
      label,
      count,
      drop_from_prev_pct: prev == null ? 0 : dropFromPrev,
      retain_from_landing_pct: retainFromLanding,
      is_wizard_substep: isWizardSubstep,
    });
    prev = count;
  };

  addRow('landing', 'Landing', landing);

  if (wizardSteps.length) {
    for (const ws of wizardSteps) {
      addRow(
        'wizard:' + (ws.step || 'step'),
        'Wizard · ' + (ws.step_label || ws.step || 'Etapa'),
        Number(ws.sessions) || 0,
        true
      );
    }
  } else {
    addRow('wizard', 'Wizard', Number(funnelCounts.wizard) || 0);
  }

  addRow('checkout', 'Checkout', Number(funnelCounts.checkout) || 0);
  addRow('pix_generated', 'PIX gerado', Number(funnelCounts.pix_generated) || 0);
  addRow('payment_paid', 'Pago', Number(funnelCounts.payment_paid) || 0);

  return rows;
}

function buildSessionGeoMap(events) {
  const map = {};
  for (const ev of events) {
    const sid = ev.session_id;
    if (!sid) continue;
    if (!map[sid]) map[sid] = {};
    if (ev.country && ev.country !== 'XX') map[sid].country = ev.country;
    if (ev.city) map[sid].city = ev.city;
    if (ev.region) map[sid].region = ev.region;
  }
  return map;
}

function computeConversionTimes(events) {
  const sessions = {};
  for (const ev of events) {
    const sid = ev.session_id;
    if (!sid) continue;
    if (!sessions[sid]) {
      sessions[sid] = { landing: null, pix: null, paid: null };
    }
    const ts = Number(ev.ts) || 0;
    if (ev.funnel_step === 'landing' || ev.page_label === 'Landing') {
      if (sessions[sid].landing == null || ts < sessions[sid].landing) sessions[sid].landing = ts;
    }
    if (ev.type === 'pix_generated') {
      if (sessions[sid].pix == null || ts < sessions[sid].pix) sessions[sid].pix = ts;
    }
    if (ev.type === 'payment_paid') {
      if (sessions[sid].paid == null || ts < sessions[sid].paid) sessions[sid].paid = ts;
    }
  }

  const landingToPix = [];
  const pixToPaid = [];
  const landingToPaid = [];

  for (const row of Object.values(sessions)) {
    if (row.landing != null && row.pix != null && row.pix >= row.landing) {
      landingToPix.push(row.pix - row.landing);
    }
    if (row.pix != null && row.paid != null && row.paid >= row.pix) {
      pixToPaid.push(row.paid - row.pix);
    }
    if (row.landing != null && row.paid != null && row.paid >= row.landing) {
      landingToPaid.push(row.paid - row.landing);
    }
  }

  return {
    landing_to_pix_ms: median(landingToPix),
    landing_to_pix_label: formatDuration(median(landingToPix)),
    pix_to_paid_ms: median(pixToPaid),
    pix_to_paid_label: formatDuration(median(pixToPaid)),
    landing_to_paid_ms: median(landingToPaid),
    landing_to_paid_label: formatDuration(median(landingToPaid)),
    samples: {
      landing_to_pix: landingToPix.length,
      pix_to_paid: pixToPaid.length,
      landing_to_paid: landingToPaid.length,
    },
  };
}

function revenueByCountry(events, geoMap) {
  const map = {};
  for (const ev of events) {
    if (ev.type !== 'payment_paid') continue;
    const sid = ev.session_id;
    const country =
      (ev.country && ev.country !== 'XX' ? ev.country : null) ||
      (sid && geoMap[sid] && geoMap[sid].country) ||
      'XX';
    if (!map[country]) map[country] = { country, payments: 0, revenue_cents: 0 };
    map[country].payments += 1;
    map[country].revenue_cents += Number(ev.amount_cents) || 0;
  }
  return Object.values(map)
    .map((row) => ({
      ...row,
      revenue_formatted: formatBrl(row.revenue_cents),
    }))
    .sort((a, b) => b.revenue_cents - a.revenue_cents);
}

const BR_STATE_NAMES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
  SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

function stateLabel(region, country) {
  if (!region || !String(region).trim()) return 'Sem estado';
  const raw = String(region).trim();
  const upper = raw.toUpperCase();
  if (BR_STATE_NAMES[upper]) return BR_STATE_NAMES[upper];
  const m = upper.match(/^(?:BR-)?([A-Z]{2})$/);
  if (m && BR_STATE_NAMES[m[1]]) return BR_STATE_NAMES[m[1]];
  if (country && country !== 'XX' && country !== 'BR') return raw + ' (' + country + ')';
  return raw;
}

function revenueByState(events, geoMap) {
  const map = {};
  for (const ev of events) {
    if (ev.type !== 'payment_paid') continue;
    const sid = ev.session_id;
    const geo = (sid && geoMap[sid]) || {};
    const region = ev.region || geo.region || null;
    const country =
      (ev.country && ev.country !== 'XX' ? ev.country : null) ||
      geo.country ||
      'XX';
    const key = region ? String(country).toUpperCase() + '|' + region : '__unknown__';
    if (!map[key]) {
      map[key] = {
        state_key: key,
        state: region,
        country,
        state_label: stateLabel(region, country),
        payments: 0,
        revenue_cents: 0,
      };
    }
    map[key].payments += 1;
    map[key].revenue_cents += Number(ev.amount_cents) || 0;
  }
  return Object.values(map)
    .map((row) => ({
      ...row,
      revenue_formatted: formatBrl(row.revenue_cents),
    }))
    .sort((a, b) => b.revenue_cents - a.revenue_cents);
}

function topCities(events, live, geoMap) {
  const map = {};
  function bump(city, country, onlineDelta, paidDelta, cents) {
    if (!city) return;
    const key = String(city) + '|' + (country || 'XX');
    if (!map[key]) {
      map[key] = { city, country: country || 'XX', online: 0, payments: 0, revenue_cents: 0 };
    }
    map[key].online += onlineDelta;
    map[key].payments += paidDelta;
    map[key].revenue_cents += cents;
  }

  for (const row of Object.values(live?.sessions || {})) {
    if (row.city) bump(row.city, row.country, 1, 0, 0);
  }

  for (const ev of events) {
    if (ev.type !== 'payment_paid') continue;
    const geo = geoMap[ev.session_id] || {};
    const city = ev.city || geo.city;
    const country = ev.country || geo.country;
    if (city) bump(city, country, 0, 1, Number(ev.amount_cents) || 0);
  }

  return Object.values(map)
    .map((row) => ({
      ...row,
      revenue_formatted: formatBrl(row.revenue_cents),
    }))
    .sort((a, b) => b.online - a.online || b.revenue_cents - a.revenue_cents)
    .slice(0, 15);
}

function computePeriodCompare(days, readEventsFn, options, currentTotals) {
  options = options || {};
  const prevDays = days;
  let prevEvents = readEventsFn(prevDays * 2);
  if (options.src) {
    const needle = String(options.src).trim().toLowerCase();
    prevEvents = prevEvents.filter((ev) => {
      const src = ev.traffic_src || ev.meta?.src || ev.utm_source || '';
      return src.toLowerCase() === needle;
    });
  }

  const cutoff = Date.now() - days * 86400000;
  const currentEvents = prevEvents.filter((ev) => (Number(ev.ts) || 0) >= cutoff);
  const previousEvents = prevEvents.filter((ev) => {
    const ts = Number(ev.ts) || 0;
    return ts < cutoff && ts >= cutoff - days * 86400000;
  });

  function summarize(evts) {
    const paid = evts.filter((e) => e.type === 'payment_paid');
    const landing = new Set();
    for (const ev of evts) {
      if (ev.funnel_step === 'landing' || ev.page_label === 'Landing') landing.add(ev.session_id);
    }
    const revenue = paid.reduce((s, e) => s + (Number(e.amount_cents) || 0), 0);
    return {
      payments: paid.length,
      revenue_cents: revenue,
      landing: landing.size,
      conversion_rate: landing.size > 0 ? Math.round((paid.length / landing.size) * 1000) / 10 : 0,
    };
  }

  const cur = summarize(currentEvents);
  const prev = summarize(previousEvents);

  return {
    label: days === 1 ? 'vs ontem' : 'vs período anterior',
    payments: { current: cur.payments, previous: prev.payments, change_pct: pctChange(cur.payments, prev.payments) },
    revenue: {
      current_cents: cur.revenue_cents,
      previous_cents: prev.revenue_cents,
      current_formatted: formatBrl(cur.revenue_cents),
      previous_formatted: formatBrl(prev.revenue_cents),
      change_pct: pctChange(cur.revenue_cents, prev.revenue_cents),
    },
    conversion: {
      current: cur.conversion_rate,
      previous: prev.conversion_rate,
      change_pts: Math.round((cur.conversion_rate - prev.conversion_rate) * 10) / 10,
    },
    landing: { current: cur.landing, previous: prev.landing, change_pct: pctChange(cur.landing, prev.landing) },
  };
}

function statsByUtm(events) {
  const dims = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  const out = {};
  for (const dim of dims) {
    const map = {};
    for (const ev of events) {
      const val = ev[dim] || '(vazio)';
      if (!map[val]) map[val] = { value: val, sessions: new Set(), payments: 0, revenue_cents: 0 };
      map[val].sessions.add(ev.session_id);
      if (ev.type === 'payment_paid') {
        map[val].payments += 1;
        map[val].revenue_cents += Number(ev.amount_cents) || 0;
      }
    }
    out[dim] = Object.values(map)
      .map((row) => ({
        value: row.value,
        sessions: row.sessions.size,
        payments: row.payments,
        revenue_cents: row.revenue_cents,
        revenue_formatted: formatBrl(row.revenue_cents),
      }))
      .sort((a, b) => b.revenue_cents - a.revenue_cents)
      .slice(0, 12);
  }
  return out;
}

function campaignsWithRoas(campaigns, adSpend) {
  const spend = adSpend.by_src || {};
  return (campaigns || []).map((row) => {
    const spendCents = Number(spend[row.src]) || 0;
    const roas = spendCents > 0 ? Math.round((row.revenue_cents / spendCents) * 100) / 100 : null;
    const cpa = row.payments > 0 && spendCents > 0 ? Math.round(spendCents / row.payments) : null;
    return {
      ...row,
      ad_spend_cents: spendCents,
      ad_spend_formatted: formatBrl(spendCents),
      roas,
      cpa_cents: cpa,
      cpa_formatted: cpa != null ? formatBrl(cpa) : '—',
    };
  });
}

function enrichPixPending(pending, staleMinutes) {
  const now = Date.now();
  return (pending || []).map((row) => {
    const ts = Number(row.ts) || 0;
    const ageMs = now - ts;
    const ageMinutes = Math.round(ageMs / 60000);
    return {
      ...row,
      age_minutes: ageMinutes,
      age_label: ageMinutes < 60 ? ageMinutes + ' min' : Math.floor(ageMinutes / 60) + 'h ' + (ageMinutes % 60) + 'min',
      stale: ageMinutes >= staleMinutes,
    };
  });
}

function getSessionJourney(sessionId, readEventsFn, days) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const events = readEventsFn(days || 7)
    .filter((ev) => ev.session_id === sid)
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));

  if (!events.length) return null;

  const steps = events.map((ev) => ({
    ts: ev.ts,
    type: ev.type,
    page_label: ev.page_label || ev.page,
    funnel_step: ev.funnel_step || null,
    product_name: ev.product_name || null,
    amount_cents: ev.amount_cents || null,
    amount_formatted: ev.amount_cents != null ? formatBrl(ev.amount_cents) : null,
    traffic_src: ev.traffic_src || null,
    country: ev.country || null,
    city: ev.city || null,
  }));

  const first = events[0];
  const last = events[events.length - 1];
  const paid = events.find((e) => e.type === 'payment_paid');
  const pix = events.find((e) => e.type === 'pix_generated');
  const maps = leadProfileMaps(events);
  const lead = resolveLeadProfile(first, maps);

  return {
    session_id: sid,
    event_count: events.length,
    started_at: first.ts,
    last_at: last.ts,
    duration_ms: (Number(last.ts) || 0) - (Number(first.ts) || 0),
    duration_label: formatDuration((Number(last.ts) || 0) - (Number(first.ts) || 0)),
    traffic_src: first.traffic_src || null,
    utm_campaign: first.utm_campaign || null,
    country: first.country || null,
    city: first.city || null,
    converted: Boolean(paid),
    pix_generated: Boolean(pix),
    lead_age: lead.lead_age,
    lead_age_band: lead.lead_age_band,
    lead_age_label: lead.lead_age_label,
    lead_gender: lead.lead_gender,
    lead_gender_label: lead.lead_gender_label,
    steps,
  };
}

function buildTransitionSankey(transitions) {
  const nodes = new Set();
  const links = [];
  for (const row of transitions || []) {
    const parts = String(row.flow || '').split(' → ');
    if (parts.length !== 2) continue;
    const from = parts[0].trim();
    const to = parts[1].trim();
    nodes.add(from);
    nodes.add(to);
    links.push({ from, to, value: row.count || 0 });
  }
  return {
    nodes: Array.from(nodes),
    links: links.sort((a, b) => b.value - a.value).slice(0, 15),
  };
}

function hourlyActivity(events, timezone) {
  const tz = timezone || 'America/Sao_Paulo';
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: String(h).padStart(2, '0') + 'h',
    page_views: 0,
    payments: 0,
  }));

  for (const ev of events) {
    const d = new Date(Number(ev.ts) || Date.now());
    const h = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(d),
      10
    );
    if (ev.type === 'page_view') hours[h].page_views += 1;
    if (ev.type === 'payment_paid') hours[h].payments += 1;
  }

  return hours;
}

function buildSystemStatus(deps) {
  const {
    events,
    live,
    backup,
    webhookHealth,
    utmifyEnabled,
    cloudflareGeoHint,
    readWebhookLog,
  } = deps;

  let lastEventTs = null;
  for (const ev of events || []) {
    const ts = Number(ev.ts) || 0;
    if (lastEventTs == null || ts > lastEventTs) lastEventTs = ts;
  }

  const lastPaid = (events || [])
    .filter((e) => e.type === 'payment_paid')
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))[0];

  const webhooks = readWebhookLog ? readWebhookLog(5) : [];

  return {
    cloudflare_geo: cloudflareGeoHint || { ok: false },
    utmify: { enabled: Boolean(utmifyEnabled) },
    backup: backup || {},
    webhook: webhookHealth || {},
    live_total: live?.total || 0,
    last_event_at: lastEventTs,
    last_event_ago_ms: lastEventTs ? Date.now() - lastEventTs : null,
    last_sale_at: lastPaid ? Number(lastPaid.ts) : null,
    last_sale_amount: lastPaid ? formatBrl(Number(lastPaid.amount_cents) || 0) : null,
    recent_webhooks: webhooks,
  };
}

function computeEnhancedAlerts(events, days, deps) {
  deps = deps || {};
  const baseAlertsFn = deps.baseAlertsFn;
  const config = { ...DEFAULT_ALERTS_CONFIG, ...(deps.config || {}) };
  const alerts = baseAlertsFn ? baseAlertsFn(events, days) : [];

  const now = Date.now();
  const paidEvents = events.filter((e) => e.type === 'payment_paid');
  const lastPaidTs = paidEvents.length
    ? Math.max(...paidEvents.map((e) => Number(e.ts) || 0))
    : null;

  if (days === 1 && lastPaidTs) {
    const hoursSince = (now - lastPaidTs) / 3600000;
    const hour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: deps.timezone || 'America/Sao_Paulo',
        hour: 'numeric',
        hour12: false,
      }).format(new Date()),
      10
    );
    if (
      hoursSince >= config.no_sale_hours &&
      hour >= config.business_hours_start &&
      hour < config.business_hours_end
    ) {
      alerts.push({
        level: 'warning',
        message:
          'Nenhuma venda nas últimas ' +
          config.no_sale_hours +
          'h (horário comercial).',
      });
    }
  }

  const stalePix = enrichPixPending(deps.pixPending || [], config.stale_pix_minutes).filter(
    (p) => p.stale
  );
  if (stalePix.length >= 2) {
    alerts.push({
      level: 'warning',
      message: stalePix.length + ' PIX pendentes há mais de ' + config.stale_pix_minutes + ' min.',
    });
  }

  const webhook = deps.webhookHealth;
  if (webhook && webhook.invalid_signature_24h > 0) {
    alerts.push({
      level: 'danger',
      message: webhook.invalid_signature_24h + ' webhook(s) com assinatura inválida em 24h.',
    });
  }

  if (deps.utmifyEnabled && deps.ordersWithFailedUtmify >= 3) {
    alerts.push({
      level: 'warning',
      message: deps.ordersWithFailedUtmify + ' pedidos com falha/envio Utmify pendente.',
    });
  }

  return alerts;
}

function eventLeadFields(ev) {
  if (ev.lead_age != null || ev.lead_age_band || ev.lead_gender) {
    const age = ev.lead_age != null ? Number(ev.lead_age) : null;
    const band = ev.lead_age_band || leadProfile.ageBand(age);
    const gender = leadProfile.normalizeGender(ev.lead_gender);
    return {
      lead_age: age != null && age >= 0 && age <= 120 ? age : null,
      lead_age_band: band,
      lead_gender: gender,
      lead_age_label: leadProfile.ageBandLabel(band),
      lead_gender_label: leadProfile.genderLabel(gender),
    };
  }
  return {
    lead_age: null,
    lead_age_band: null,
    lead_gender: null,
    lead_age_label: '—',
    lead_gender_label: '—',
  };
}

function leadProfileMaps(events) {
  const bySession = {};
  const byDevice = {};
  for (const ev of events) {
    const fields = eventLeadFields(ev);
    if (fields.lead_age == null && !fields.lead_gender) continue;
    if (ev.session_id) bySession[String(ev.session_id)] = fields;
    if (ev.device_hash) byDevice[String(ev.device_hash)] = fields;
  }
  return { by_session: bySession, by_device: byDevice };
}

function resolveLeadProfile(ev, maps) {
  const direct = eventLeadFields(ev);
  if (direct.lead_age != null || direct.lead_gender) return direct;
  const device = String(ev.device_hash || '');
  if (device && maps.by_device[device]) return maps.by_device[device];
  const session = String(ev.session_id || '');
  if (session && maps.by_session[session]) return maps.by_session[session];
  return direct;
}

function computeDemographics(events, orders) {
  const bandOrder = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'menor-18'];
  const emptyBands = Object.fromEntries(bandOrder.map((b) => [b, 0]));
  let verified = 0;
  const ages = [];
  const bands = { ...emptyBands };
  const gender = { M: 0, F: 0, O: 0 };

  for (const ev of events) {
    if (ev.type !== 'lead_profile') continue;
    const p = eventLeadFields(ev);
    if (p.lead_age == null && !p.lead_gender) continue;
    verified++;
    if (p.lead_age != null) ages.push(p.lead_age);
    if (p.lead_age_band && bands[p.lead_age_band] != null) bands[p.lead_age_band]++;
    if (p.lead_gender && gender[p.lead_gender] != null) gender[p.lead_gender]++;
  }

  const paidAges = [];
  const paidBands = { ...emptyBands };
  const paidGender = { M: 0, F: 0, O: 0 };
  let paidWithProfile = 0;
  for (const order of orders) {
    if (order.lead_age == null && !order.lead_gender) continue;
    paidWithProfile++;
    if (order.lead_age != null) paidAges.push(Number(order.lead_age));
    if (order.lead_age_band && paidBands[order.lead_age_band] != null) paidBands[order.lead_age_band]++;
    if (order.lead_gender && paidGender[order.lead_gender] != null) paidGender[order.lead_gender]++;
  }

  const avg = (values) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
  const bandRows = (counts) =>
    bandOrder
      .filter((band) => (counts[band] || 0) > 0)
      .map((band) => ({ band, label: leadProfile.ageBandLabel(band), count: counts[band] }));
  const genderRows = (counts) =>
    ['M', 'F', 'O']
      .filter((g) => (counts[g] || 0) > 0)
      .map((g) => ({ gender: g, label: leadProfile.genderLabel(g), count: counts[g] }));

  return {
    verified_leads: verified,
    paid_with_profile: paidWithProfile,
    avg_age: avg(ages),
    avg_age_paid: avg(paidAges),
    age_bands: bandRows(bands),
    age_bands_paid: bandRows(paidBands),
    gender: genderRows(gender),
    gender_paid: genderRows(paidGender),
  };
}

function attachGeoToEvent(event, ingestContext) {
  const geo = ingestContext?.geo;
  if (!geo || typeof geo !== 'object') return event;
  if (geo.country && geo.country !== 'XX') event.country = geo.country;
  if (geo.city) event.city = geo.city;
  if (geo.region) event.region = geo.region;
  if (geo.continent) event.continent = geo.continent;
  return event;
}

module.exports = {
  AD_SPEND_FILE,
  readAdSpend,
  saveAdSpend,
  readAlertsConfig,
  saveAlertsConfig,
  buildFunnelDropoff,
  buildSessionGeoMap,
  computeConversionTimes,
  revenueByCountry,
  revenueByState,
  stateLabel,
  topCities,
  computePeriodCompare,
  statsByUtm,
  campaignsWithRoas,
  enrichPixPending,
  getSessionJourney,
  buildTransitionSankey,
  hourlyActivity,
  buildSystemStatus,
  computeEnhancedAlerts,
  attachGeoToEvent,
  eventLeadFields,
  leadProfileMaps,
  resolveLeadProfile,
  computeDemographics,
  formatBrl,
  formatDuration,
};
