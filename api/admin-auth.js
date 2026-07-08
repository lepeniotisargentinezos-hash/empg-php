'use strict';

function getAdminSecret() {
  return process.env.ANALYTICS_SECRET || process.env.ADMIN_SECRET || '';
}

function allowOpenAdmin() {
  return process.env.CREDPIX_ALLOW_OPEN_ADMIN === '1';
}

function verifyAdminAuth(headerValue, queryValue) {
  const secret = getAdminSecret();
  if (!secret) return allowOpenAdmin();
  const token = String(headerValue || queryValue || '').trim();
  return token === secret;
}

function getIngestSecret() {
  return process.env.ANALYTICS_INGEST_KEY || getAdminSecret();
}

function verifyIngestAuth(headerValue) {
  const explicit = process.env.ANALYTICS_INGEST_KEY || '';
  if (!explicit) return true;
  if (allowOpenAdmin()) return true;
  return String(headerValue || '').trim() === explicit;
}

module.exports = {
  getAdminSecret,
  allowOpenAdmin,
  verifyAdminAuth,
  verifyIngestAuth,
};
