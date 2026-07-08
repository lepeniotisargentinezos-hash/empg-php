'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'google-pixels.json');

const DEFAULT_PIXELS = {
  googleAds: [
    { id: 'AW-18039024616', label: 'hKx2CIeUgI8cEOjX1plD', description: '1315' },
    { id: 'AW-830291866', label: 'FlGnCIW26bUcEJr_9IsD', description: 'Gustavo' },
  ],
  ga4: [],
};

function normalizeAwId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('/')) {
    const [id] = s.split('/');
    return id.startsWith('AW-') ? id : `AW-${id.replace(/^AW-?/i, '')}`;
  }
  return s.startsWith('AW-') ? s : `AW-${s.replace(/\D/g, '')}`;
}

function normalizeLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('/')) return s.split('/').pop();
  return s;
}

function normalizeGa4(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  return s.startsWith('G-') ? s : `G-${s.replace(/^G-?/i, '')}`;
}

function normalizeConfig(raw) {
  return {
    googleAds: (raw.googleAds || [])
      .map((row) => {
        const id = normalizeAwId(row.id);
        const label = normalizeLabel(row.label);
        if (!id || !label) return null;
        const entry = { id, label };
        const desc = String(row.description || '').trim();
        if (desc) entry.description = desc.slice(0, 80);
        return entry;
      })
      .filter(Boolean),
    ga4: [...new Set((raw.ga4 || []).map(normalizeGa4).filter(Boolean))],
  };
}

function mergeGoogleAds(defaults, saved) {
  const key = (row) => `${row.id}/${row.label}`;
  const map = new Map();
  const put = (row) => {
    if (!row.id || !row.label) return;
    const k = key(row);
    const prev = map.get(k);
    const entry = { id: row.id, label: row.label };
    const desc = String(row.description || (prev && prev.description) || '').trim();
    if (desc) entry.description = desc.slice(0, 80);
    map.set(k, entry);
  };
  for (const row of defaults || []) put(row);
  for (const row of saved || []) put(row);
  return [...map.values()];
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_PIXELS, savedAt: null, fromDefaults: true };
  }
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const cfg = normalizeConfig(data);
    return {
      googleAds: cfg.googleAds,
      ga4: cfg.ga4,
      savedAt: data.savedAt || null,
      fromDefaults: false,
    };
  } catch {
    return { ...DEFAULT_PIXELS, savedAt: null, fromDefaults: true };
  }
}

function writeConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    ...normalizeConfig(config),
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return payload;
}

function sendToList(config) {
  return (config.googleAds || []).map((row) => `${row.id}/${row.label}`);
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_PIXELS,
  readConfig,
  writeConfig,
  normalizeAwId,
  normalizeLabel,
  normalizeGa4,
  sendToList,
};
