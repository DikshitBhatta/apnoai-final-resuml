const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const ALLOWED_MODELS = new Set(['gemini-3.5-flash-lite']); // keep in sync with js/config.js
const MAX_BODY_CHARS = 100000;
const RATE_LIMIT = 20;            // requests per IP...
const RATE_WINDOW_MS = 60 * 1000; // ...per minute

// Per-instance and reset on cold start: a light guard against quota abuse, not a hard limit.
const recentRequests = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (recentRequests.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  timestamps.push(now);
  recentRequests.set(ip, timestamps);
  if (recentRequests.size > 5000) recentRequests.clear();
  return timestamps.length > RATE_LIMIT;
}

function isSameOrigin(req) {
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false; // missing or malformed Origin header
  }
}

const fail = (res, status, message) => res.status(status).json({ error: { message } });

/**
 * Vercel serverless proxy for Gemini generateContent, so the API key
 * (GEMINI_API_KEY) never reaches the browser.
 *
 * POST /api/gemini  body: { model, body }  ->  Gemini's JSON response
 *
 * Only same-origin requests for the app's model are forwarded, with a
 * per-IP rate limit.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed');
  }
  if (!isSameOrigin(req)) {
    return fail(res, 403, 'Requests are only accepted from the ResuML site.');
  }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip)) {
    return fail(res, 429, 'Too many requests. Please wait a minute and try again.');
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return fail(res, 500, 'Server is missing the GEMINI_API_KEY environment variable.');
  }
  const { model, body } = req.body || {};
  if (!ALLOWED_MODELS.has(model)) {
    return fail(res, 400, 'Model not allowed.');
  }
  if (!body || JSON.stringify(body).length > MAX_BODY_CHARS) {
    return fail(res, 400, 'Request body missing or too large.');
  }

  try {
    const upstream = await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return fail(res, 502, 'Could not reach the Gemini API.');
  }
};
