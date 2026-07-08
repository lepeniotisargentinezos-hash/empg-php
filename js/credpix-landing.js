/**
 * Landing — só UTMs para repassar ao wizard (sem analytics, fetch patch ou hijack de título).
 */
(function (global) {
  'use strict';

  function storageKey() {
    if (typeof global.credpixStorageKey === 'function') {
      return global.credpixStorageKey('tracking_params');
    }
    return 'credpix_tracking_params';
  }

  function persistentKey() {
    return storageKey() + '_persistent';
  }

  function readJson(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      var data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, data) {
    try {
      global.localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  }

  function readStored() {
    var merged = readJson(persistentKey(), {});
    try {
      var sess = global.sessionStorage.getItem(storageKey());
      if (sess) {
        var sData = JSON.parse(sess);
        if (sData && typeof sData === 'object') {
          var k;
          for (k in sData) {
            if (Object.prototype.hasOwnProperty.call(sData, k)) merged[k] = sData[k];
          }
        }
      }
    } catch (e2) {}
    return merged;
  }

  function writeStored(data) {
    writeJson(persistentKey(), data);
    try {
      global.sessionStorage.setItem(storageKey(), JSON.stringify(data));
    } catch (e) {}
  }

  function mergeParamsFromSearch(search) {
    if (!search) return {};
    var out = {};
    try {
      var params = new URLSearchParams(search.charAt(0) === '?' ? search.slice(1) : search);
      params.forEach(function (value, key) {
        if (value !== null && value !== '') out[key] = value;
      });
    } catch (e) {}
    return out;
  }

  function mergeAllFromLocation() {
    var merged = readStored();
    var fromUrl = mergeParamsFromSearch(global.location && global.location.search);
    var key;
    for (key in fromUrl) {
      if (Object.prototype.hasOwnProperty.call(fromUrl, key)) {
        merged[key] = fromUrl[key];
      }
    }
    if (Object.keys(merged).length) writeStored(merged);
    return merged;
  }

  function getTrackingParams() {
    return mergeAllFromLocation();
  }

  function getPassThroughParams() {
    return getTrackingParams();
  }

  function appendUtms(url) {
    if (!url) return url;
    if (/^https?:\/\//i.test(url) && url.indexOf(global.location.host) === -1) {
      return url;
    }

    var params = getPassThroughParams();
    if (!Object.keys(params).length) return url;

    try {
      var base = global.location && global.location.href ? global.location.href : undefined;
      var u = new URL(url, base);
      var k;
      for (k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k) && !u.searchParams.has(k)) {
          u.searchParams.set(k, params[k]);
        }
      }
      if (/^https?:\/\//i.test(url)) return u.href;
      return u.pathname + u.search + (u.hash || '');
    } catch (e) {
      return url;
    }
  }

  mergeAllFromLocation();

  global.credpixCaptureUtms = mergeAllFromLocation;
  global.credpixGetTrackingParams = getTrackingParams;
  global.credpixGetPassThroughParams = getPassThroughParams;
  global.credpixAppendUtms = appendUtms;
})(window);
