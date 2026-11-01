// Gemini REST client. Every model call in the app goes through generateJSON().

import { CONFIG } from './config.js';

const RETRYABLE = new Set([429, 500, 503]);
const listeners = new Set();
let requestCount = 0;

export function onRequest(fn) {
  listeners.add(fn);
}

function countRequest() {
  requestCount += 1;
  listeners.forEach(fn => fn(requestCount));
}

export class GeminiError extends Error {
  constructor(message, { status = 0, hint = '' } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.hint = hint;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* Transport */

async function post(model, body) {
  countRequest();
  if (CONFIG.useProxy) {
    return fetch(CONFIG.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, body }),
    });
  }
  return fetch(`${CONFIG.apiBase}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CONFIG.apiKey },
    body: JSON.stringify(body),
  });
}

function retryDelayMs(data, attempt) {
  // Gemini sends RetryInfo like { retryDelay: "31s" } on 429s.
  const info = data?.error?.details?.find(d => d.retryDelay);
  const seconds = info ? parseFloat(info.retryDelay) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : 2000 * 2 ** attempt;
}

function toError(status, data) {
  const raw = data?.error?.message || `Request failed (HTTP ${status})`;
  if (status === 400 && /api key/i.test(raw)) {
    return new GeminiError('Your Gemini API key was rejected.', { status, hint: 'Check js/config.local.js: copy the full key from aistudio.google.com with no spaces.' });
  }
  if (status === 403) {
    return new GeminiError('This API key is not allowed to use the Gemini API.', { status, hint: 'Enable the Generative Language API for the key\'s project, or create a new key in AI Studio.' });
  }
  if (status === 404) {
    return new GeminiError('That model is not available for your key.', { status, hint: 'Check that the model in js/config.js is available to your key.' });
  }
  if (status === 429) {
    return new GeminiError('Free-tier rate limit reached.', { status, hint: 'Wait about a minute and try again.' });
  }
  return new GeminiError(raw, { status, hint: status >= 500 ? 'Gemini is busy. Try again in a few seconds.' : '' });
}

/* Public API */

/**
 * Calls Gemini and returns the parsed JSON response. Retries 429/5xx errors
 * when the suggested wait is short.
 * @param {object} options
 * @param {string} options.model
 * @param {string} options.system  System instruction.
 * @param {string} options.user    User message.
 * @param {object} options.schema  Gemini responseSchema.
 * @param {number} [options.temperature]
 * @returns {Promise<{data: object, model: string, latencyMs: number}>}
 * @throws {GeminiError} with a user-facing message and hint.
 */
export async function generateJSON({ model, system, user, schema, temperature = CONFIG.temperature }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };

  const started = performance.now();
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await post(model, body);
    } catch {
      throw new GeminiError('Could not reach the Gemini API.', { hint: 'Check your internet connection. If you opened the file directly, run it through a local server (see README).' });
    }
    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      return { data: parseCandidate(data), model, latencyMs: Math.round(performance.now() - started) };
    }

    const wait = retryDelayMs(data, attempt);
    if (!RETRYABLE.has(response.status) || attempt >= CONFIG.maxRetries || wait > CONFIG.maxRetryWaitMs) {
      throw toError(response.status, data);
    }
    await sleep(wait);
  }
}

function parseCandidate(data) {
  if (data?.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini blocked the request (${data.promptFeedback.blockReason}).`, { hint: 'Remove unusual content from the inputs and try again.' });
  }
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text || '').join('');
  if (!text) {
    const reason = candidate?.finishReason ? ` (finish reason: ${candidate.finishReason})` : '';
    throw new GeminiError(`Gemini returned an empty response${reason}.`, { hint: 'Try again in a few seconds.' });
  }
  try {
    return JSON.parse(text);
  } catch {
    // Schema mode should prevent this; fall back to the outermost JSON object.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    throw new GeminiError('Gemini returned malformed JSON.', { hint: 'Try again. If it keeps happening, the response may be cut off: try a shorter resume.' });
  }
}
