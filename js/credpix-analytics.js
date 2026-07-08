/**
 * CredPix — analytics interno do funil (page views, conversões).
 */
(function (global) {
  'use strict';

  var _sessionId = null;
  var _loaded = false;
  var _lastPageView = { page: '', ts: 0 };
  var PAGE_VIEW_DEDUPE_MS = 45000;

  function skipTracking() {
    var path = (global.location && global.location.pathname) || '';
    return path.indexOf('/admin/') !== -1;
  }

  function getBase() {
    if (typeof global.credpixGetBasePath === 'function') {
      return global.credpixGetBasePath();
    }
    return global.CREDPIX_BASE_PATH || '';
  }

  function apiUrl() {
    var base = getBase();
    if (typeof global.credpixPath === 'function') {
      return global.credpixPath('/api/analytics.php');
    }
    return (base || '') + '/api/analytics.php';
  }

  function sessionKey() {
    if (typeof global.credpixStorageKey === 'function') {
      return global.credpixStorageKey('analytics_session');
    }
    return 'credpix_analytics_session';
  }

  function getSessionId() {
    if (_sessionId) return _sessionId;
    try {
      var stored = global.sessionStorage.getItem(sessionKey());
      if (stored) {
        _sessionId = stored;
        return _sessionId;
      }
    } catch (e) {}

    var id = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    _sessionId = id;
    try {
      global.sessionStorage.setItem(sessionKey(), id);
    } catch (e2) {}
    return id;
  }

  function getDeviceHash() {
    var key =
      typeof global.credpixStorageKey === 'function'
        ? global.credpixStorageKey('device_hash')
        : 'device_hash';
    try {
      var existing = global.localStorage.getItem(key);
      if (existing) return existing;
      var hash = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      global.localStorage.setItem(key, hash);
      return hash;
    } catch (e) {
      return null;
    }
  }

  function getUtms() {
    if (typeof global.credpixGetTrackingParams === 'function') {
      var p = global.credpixGetTrackingParams();
      return {
        traffic_src: p.src ? String(p.src).trim() : null,
        utm_source: p.utm_source || null,
        utm_medium: p.utm_medium || null,
        utm_campaign: p.utm_campaign || null,
        utm_content: p.utm_content || null,
        first_touch_src: p.first_touch_src || null,
        first_touch_utm_campaign: p.first_touch_utm_campaign || null,
        first_touch_utm_medium: p.first_touch_utm_medium || null,
        first_touch_utm_content: p.first_touch_utm_content || null,
      };
    }
    return { traffic_src: null };
  }

  function currentPage() {
    return (global.location && global.location.pathname) || '/';
  }

  function referrerPage() {
    try {
      if (!global.document.referrer) return null;
      var ref = new URL(global.document.referrer);
      if (ref.origin !== global.location.origin) return global.document.referrer;
      return ref.pathname + ref.search;
    } catch (e) {
      return global.document.referrer || null;
    }
  }

  function buildPayload(type, extra) {
    var utms = getUtms();
    var payload = {
      ts: Date.now(),
      type: type,
      session_id: getSessionId(),
      browser_session_id: getSessionId(),
      device_hash: getDeviceHash(),
      page: currentPage(),
      base_path: getBase() || null,
      referrer: referrerPage(),
      traffic_src: utms.traffic_src,
      utm_source: utms.utm_source,
      utm_medium: utms.utm_medium,
      utm_campaign: utms.utm_campaign,
      utm_content: utms.utm_content,
      first_touch_src: utms.first_touch_src,
      first_touch_utm_campaign: utms.first_touch_utm_campaign,
      first_touch_utm_medium: utms.first_touch_utm_medium,
      first_touch_utm_content: utms.first_touch_utm_content,
    };
    if (extra && typeof extra === 'object') {
      var k;
      for (k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) {
          payload[k] = extra[k];
        }
      }
    }
    return payload;
  }

  function sendEvents(events) {
    if (skipTracking()) return;
    var list = Array.isArray(events) ? events : [events];
    if (!list.length) return;

    var body = JSON.stringify({ events: list });
    var url = apiUrl();

    try {
      if (global.navigator && global.navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (global.navigator.sendBeacon(url, blob)) return;
      }
    } catch (e) {}

    if (global.fetch) {
      global.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
      }).catch(function () {});
    }
  }

  function track(type, extra) {
    sendEvents(buildPayload(type, extra));
  }

  function normalizeLeadGender(sexo) {
    if (!sexo) return null;
    var s = String(sexo).trim().toUpperCase();
    if (s === 'M' || s === 'MASC' || s === 'MASCULINO' || s === 'MALE') return 'M';
    if (s === 'F' || s === 'FEM' || s === 'FEMININO' || s === 'FEMALE') return 'F';
    return 'O';
  }

  function trackLeadProfile(profile) {
    profile = profile || {};
    var sexo = profile.sexo || profile.gender || null;
    track('lead_profile', {
      funnel_step: 'wizard',
      nascimento: profile.nascimento || null,
      sexo: sexo,
      lead_age: profile.lead_age != null ? profile.lead_age : profile.age,
      lead_age_band: profile.lead_age_band || profile.age_band || null,
      lead_gender: profile.lead_gender || profile.gender || normalizeLeadGender(sexo),
    });
  }

  function trackPageView() {
    var page = currentPage();
    var now = Date.now();
    if (_lastPageView.page === page && (now - _lastPageView.ts) < PAGE_VIEW_DEDUPE_MS) {
      return;
    }
    _lastPageView = { page: page, ts: now };
    track('page_view');
  }

  function init() {
    if (_loaded || skipTracking()) return;
    _loaded = true;
    trackPageView();
  }

  global.CredPixAnalytics = {
    track: track,
    trackLeadProfile: trackLeadProfile,
    trackPageView: trackPageView,
    getSessionId: getSessionId,
    init: init,
  };

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
