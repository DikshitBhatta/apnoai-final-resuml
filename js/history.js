// Saved analyses, kept in localStorage (this browser only).

import { CONFIG } from './config.js';

const KEY = 'resuml.history.v1';

export function loadHistory() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function write(items) {
  // If storage is full, drop the oldest entries until it fits.
  for (let list = items; list.length; list = list.slice(0, -1)) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch { /* quota exceeded or storage blocked */ }
  }
  return false;
}

/** Inserts or updates an entry (matched by id); newest first. */
export function saveToHistory(entry) {
  const items = loadHistory().filter(item => item.id !== entry.id);
  return write([entry, ...items].slice(0, CONFIG.historyLimit));
}

export function removeFromHistory(id) {
  write(loadHistory().filter(item => item.id !== id));
}

export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
