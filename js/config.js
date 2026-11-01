/*
 * App settings. On localhost the Gemini key is read from js/config.local.js
 * (git-ignored). Everywhere else requests go through the /api/gemini proxy,
 * which holds the key server-side.
 */

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', ''];
export const IS_LOCAL = LOCAL_HOSTS.includes(location.hostname);

let localKey = '';
if (IS_LOCAL) {
  try {
    ({ GEMINI_API_KEY: localKey = '' } = await import('./config.local.js'));
  } catch {
    // No local config file: the app will show the "API key missing" message.
  }
}

export const CONFIG = {
  apiKey: localKey === 'YOUR_API_KEY_HERE' ? '' : localKey.trim(),
  useProxy: !IS_LOCAL,
  proxyUrl: '/api/gemini',
  apiBase: 'https://generativelanguage.googleapis.com/v1beta',

  // Flash-Lite has the highest free-tier limits. api/gemini.js only forwards
  // this model, so keep the two in sync.
  model: 'gemini-3.5-flash-lite',

  temperature: 0.3,
  minInputChars: 50,
  maxInputChars: 30000,
  maxRetries: 2,
  maxRetryWaitMs: 20000,
  historyLimit: 20,
};

export const HAS_CREDENTIALS = CONFIG.useProxy || Boolean(CONFIG.apiKey);
