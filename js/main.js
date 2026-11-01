/*
 * App controller. Flow: JD profile (step A) -> reviewer persona -> analysis
 * (step B) -> rule-based checks -> render -> save to history.
 */

import { CONFIG, HAS_CREDENTIALS, IS_LOCAL } from './config.js';
import { AUTO_PERSONA, PERSONAS, PERSONA_IDS } from './personas.js';
import {
  PROMPT_VERSION, PROFILE_SCHEMA, PROFILER_SYSTEM, ANALYSIS_SCHEMA, EXTRA_KINDS,
  buildProfilerUser, buildAnalysisSystem, buildExtraSystem, wrapInputs,
} from './prompts.js';
import { generateJSON, onRequest } from './gemini.js';
import { extractPdfText } from './pdf.js';
import { verifyKeywords, skillCoverage, hybridScore, clampScore } from './scoring.js';
import { loadHistory, saveToHistory, removeFromHistory, clearHistory } from './history.js';
import { copyMarkdown, downloadJSON, printPDF } from './export.js';
import { icon } from './icons.js';
import { mountAnimations } from './animations.js';
import {
  esc, renderError, renderSteps, renderStepItems, inlineLoading, renderResults, renderExtra,
  renderPrintExtras, renderHistory,
} from './render.js';

const $ = id => document.getElementById(id);
const els = {
  resume: $('resume'),
  jobDesc: $('jobDesc'),
  persona: $('persona'),
  analyzeBtn: $('analyzeBtn'),
  results: $('results'),
  requestCount: $('requestCount'),
  drawer: $('historyDrawer'),
  backdrop: $('drawerBackdrop'),
  historyList: $('historyList'),
  historyCount: $('historyCount'),
  themeBtn: $('themeBtn'),
  toast: $('toast'),
};

const state = {
  current: null,      // the result currently on screen
  activeTab: Object.keys(EXTRA_KINDS)[0],
  busy: false,
};

/* Small helpers */

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

function setBusy(busy) {
  state.busy = busy;
  els.analyzeBtn.disabled = busy;
  els.analyzeBtn.innerHTML = busy
    ? '<span class="spinner sm"></span> Analyzing...'
    : `Analyze resume ${icon('arrow-right')}`;
  els.results.querySelectorAll('[data-action]').forEach(btn => {
    if (!btn.dataset.action.startsWith('export') && btn.dataset.action !== 'tab') btn.disabled = busy;
  });
}

function errorDetail(err) {
  return [err.hint, err.status ? `HTTP ${err.status}` : ''].filter(Boolean).join(' · ');
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

/* Setup */

function fillPersonaSelect() {
  els.persona.innerHTML = [
    `<option value="${AUTO_PERSONA}">Auto: detect from job description</option>`,
    ...PERSONA_IDS.map(id => `<option value="${id}">${esc(PERSONAS[id].label)}</option>`),
  ].join('');
}

/* Theme */

const THEME_KEY = 'resuml.theme';

function effectiveTheme() {
  const set = document.documentElement.getAttribute('data-theme');
  if (set) return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  els.themeBtn.innerHTML = effectiveTheme() === 'dark' ? `${icon('sun')} Light` : `${icon('moon')} Dark`;
}

function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked */ }
  applyTheme(next);
}

/* Inputs: char count + PDF upload */

function updateCount(textarea) {
  $(`${textarea.id}Count`).textContent = `${textarea.value.length.toLocaleString()} characters`;
}

const dropDefaults = {};

/** Shows the dropzone as idle, reading a file, or loaded (with a check animation). */
function setDropState(textarea, state, file) {
  const id = textarea.id;
  const [drop, iconEl, title, hint] = ['Drop', 'DzIcon', 'File', 'Hint'].map(suffix => $(`${id}${suffix}`));
  drop.classList.toggle('loaded', state === 'loaded');
  if (state === 'idle') {
    iconEl.innerHTML = dropDefaults[id].icon;
    title.innerHTML = dropDefaults[id].title;
    hint.textContent = dropDefaults[id].hint;
  } else if (state === 'reading') {
    iconEl.innerHTML = '<span class="spinner sm"></span>';
    title.textContent = `Reading ${file.name}…`;
  } else {
    iconEl.innerHTML = `<span class="lottie dz-anim" data-lottie="success" data-loop="false">${icon('check-circle')}</span>`;
    title.textContent = file.name;
    hint.textContent = `${textarea.value.length.toLocaleString()} characters extracted. Drop another PDF to replace it.`;
    mountAnimations(iconEl);
  }
}

async function loadPdfInto(file, textarea) {
  setDropState(textarea, 'reading', file);
  try {
    textarea.value = await extractPdfText(file);
    updateCount(textarea);
    setDropState(textarea, 'loaded', file);
  } catch (err) {
    setDropState(textarea, 'idle');
    toast(err.message);
  }
}

function wireInput(textarea) {
  const id = textarea.id;
  const card = textarea.closest('.card');
  const drop = $(`${id}Drop`);
  dropDefaults[id] = { icon: $(`${id}DzIcon`).innerHTML, title: $(`${id}File`).innerHTML, hint: $(`${id}Hint`).textContent };

  textarea.addEventListener('input', () => updateCount(textarea));
  $(`${id}Pdf`).addEventListener('change', e => {
    if (e.target.files[0]) loadPdfInto(e.target.files[0], textarea);
    e.target.value = '';
  });
  // The whole card accepts a dropped PDF; the dropzone shows the highlight.
  card.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) drop.classList.remove('dragover'); });
  card.addEventListener('drop', e => {
    drop.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) { e.preventDefault(); loadPdfInto(file, textarea); }
  });
  updateCount(textarea);
}

/* Analysis flow */

function validate(resume, jd) {
  if (!resume || !jd) return ['Please fill in both fields', 'Paste or upload your resume AND the job description.', 'alert-triangle'];
  if (resume.length < CONFIG.minInputChars || jd.length < CONFIG.minInputChars) return ['Content too short', 'Paste the full resume and complete job description for an accurate analysis.', 'alert-triangle'];
  if (resume.length > CONFIG.maxInputChars || jd.length > CONFIG.maxInputChars) return ['Content too long', `Keep each field under ${CONFIG.maxInputChars.toLocaleString()} characters.`, 'alert-triangle'];
  if (!HAS_CREDENTIALS) return ['API key missing', 'Copy js/config.local.example.js to js/config.local.js and paste your Gemini key from aistudio.google.com.', 'key'];
  return null;
}

/** Runs the analysis prompt (step B) and the keyword check. */
async function runAnalysis({ model, personaId, profile, resume, jd }) {
  const { data, latencyMs } = await generateJSON({
    model,
    system: buildAnalysisSystem(personaId, profile),
    user: wrapInputs(resume, jd),
    schema: ANALYSIS_SCHEMA,
  });
  const analysis = normalizeAnalysis(data);
  return { analysis, latencyMs, guard: verifyKeywords(analysis.missing_keywords, resume, jd) };
}

function normalizeAnalysis(raw) {
  const list = v => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const sections = raw.section_scores || {};
  return {
    ats_score: clampScore(raw.ats_score),
    summary: String(raw.summary || 'No summary provided.'),
    strengths: list(raw.strengths),
    missing_keywords: list(raw.missing_keywords),
    improvements: list(raw.improvements),
    section_scores: Object.fromEntries(['skills', 'experience', 'projects', 'education', 'formatting'].map(k => [k, clampScore(sections[k])])),
  };
}

function normalizeProfile(raw) {
  const list = v => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    role_title: String(raw.role_title || 'Untitled role'),
    seniority: String(raw.seniority || 'mid'),
    domain: String(raw.domain || 'General'),
    must_have_skills: list(raw.must_have_skills),
    nice_to_have_skills: list(raw.nice_to_have_skills),
    suggested_persona: PERSONAS[raw.suggested_persona] ? raw.suggested_persona : 'general_ats',
    persona_reason: String(raw.persona_reason || ''),
  };
}

async function analyze() {
  if (state.busy) return;
  const resume = els.resume.value.trim();
  const jd = els.jobDesc.value.trim();
  const invalid = validate(resume, jd);
  if (invalid) {
    els.results.innerHTML = renderError(...invalid);
    return;
  }

  const { model } = CONFIG;
  const chosen = els.persona.value;
  const steps = ['Reading the job description', 'Choosing the reviewer persona', 'Evaluating your resume', 'Verifying keywords & scoring'];
  setBusy(true);
  els.results.innerHTML = renderSteps(steps, 0);
  mountAnimations(els.results);
  els.results.firstElementChild.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  const showStep = (labels, index) => { $('analysisSteps').innerHTML = renderStepItems(labels, index); };

  try {
    // Step A: profile the JD (always runs: its skills feed the rule-based checks)
    const { data: rawProfile } = await generateJSON({
      model,
      system: PROFILER_SYSTEM,
      user: buildProfilerUser(resume, jd),
      schema: PROFILE_SCHEMA,
      temperature: 0,
    });
    const profile = normalizeProfile(rawProfile);
    const personaId = chosen === AUTO_PERSONA ? profile.suggested_persona : chosen;
    showStep(steps.map((s, i) => (i === 1 ? `Persona: ${PERSONAS[personaId].label}` : s)), 2);

    // Step B: analysis with that persona
    const run = await runAnalysis({ model, personaId, profile, resume, jd });
    showStep(steps, 3);

    const coverage = skillCoverage(profile, resume);
    state.current = {
      id: newId(),
      createdAt: new Date().toISOString(),
      promptVersion: PROMPT_VERSION,
      inputs: { resume, jd },
      model,
      personaId,
      personaSource: chosen === AUTO_PERSONA ? 'auto' : 'user',
      profile,
      ...run,
      coverage,
      hybrid: hybridScore(run.analysis.ats_score, coverage.score),
      extras: {},
    };
    showCurrent();
    persist();
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    els.results.innerHTML = renderError('Analysis failed', [err.message, errorDetail(err)].filter(Boolean).join(' '));
  } finally {
    setBusy(false);
  }
}

function showCurrent() {
  els.results.innerHTML = renderResults(state.current, { activeTab: state.activeTab });
}

function persist() {
  if (!saveToHistory(state.current)) toast('Could not save to history (browser storage is full or blocked).');
  refreshHistory();
}

/* Deep dive */

async function runPanelTask(panelId, loadingText, task) {
  if (state.busy || !state.current) return;
  const panel = $(panelId);
  setBusy(true);
  panel.innerHTML = inlineLoading(loadingText);
  try {
    panel.innerHTML = await task();
    persist();
  } catch (err) {
    panel.innerHTML = renderError(err.message, errorDetail(err));
  } finally {
    setBusy(false);
  }
}

function generateExtra(kind) {
  const cur = state.current;
  return runPanelTask('extraPanel', `Generating ${EXTRA_KINDS[kind].label}…`, async () => {
    const { data } = await generateJSON({
      model: cur.model,
      system: buildExtraSystem(kind, cur.personaId, cur.profile, cur.analysis),
      user: wrapInputs(cur.inputs.resume, cur.inputs.jd),
      schema: EXTRA_KINDS[kind].schema,
      temperature: kind === 'cover_letter' ? 0.7 : 0.4,
    });
    cur.extras[kind] = data;
    return renderExtra(cur, kind);
  });
}

function fillPrintExtras() {
  const target = $('printExtras');
  if (target && state.current) target.innerHTML = renderPrintExtras(state.current);
}

function switchTab(kind) {
  state.activeTab = kind;
  els.results.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.kind === kind));
  $('extraPanel').innerHTML = renderExtra(state.current, kind);
  setBusy(state.busy);
}

/* History drawer */

function refreshHistory() {
  const entries = loadHistory();
  els.historyList.innerHTML = renderHistory(entries);
  els.historyCount.textContent = entries.length ? `${entries.length} saved` : '';
}

function openDrawer(open) {
  els.drawer.hidden = !open;
  els.backdrop.hidden = !open;
  if (open) { refreshHistory(); $('closeHistoryBtn').focus(); }
}

function openHistoryEntry(id) {
  const entry = loadHistory().find(e => e.id === id);
  if (!entry) return;
  state.current = entry;
  els.resume.value = entry.inputs.resume;
  els.jobDesc.value = entry.inputs.jd;
  updateCount(els.resume);
  updateCount(els.jobDesc);
  setDropState(els.resume, 'idle');
  setDropState(els.jobDesc, 'idle');
  openDrawer(false);
  showCurrent();
  els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* Event wiring */

const actions = {
  extra: btn => generateExtra(btn.dataset.kind),
  tab: btn => switchTab(btn.dataset.kind),
  'export-pdf': () => printPDF(),
  'export-md': () => copyMarkdown(state.current).then(() => toast('Report copied as Markdown'), () => toast('Clipboard blocked by the browser')),
  'export-json': () => downloadJSON(state.current),
  new: () => {
    els.results.innerHTML = '';
    els.jobDesc.value = '';
    updateCount(els.jobDesc);
    setDropState(els.jobDesc, 'idle');
    state.current = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    els.jobDesc.focus();
  },
  'history-open': btn => openHistoryEntry(btn.dataset.id),
  'history-delete': btn => { removeFromHistory(btn.dataset.id); refreshHistory(); },
};

function onAction(e) {
  const btn = e.target.closest('[data-action]');
  if (btn && !btn.disabled && actions[btn.dataset.action]) actions[btn.dataset.action](btn);
}

function init() {
  let savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch { /* storage blocked */ }
  applyTheme(savedTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(null));

  fillPersonaSelect();
  wireInput(els.resume);
  wireInput(els.jobDesc);
  refreshHistory();
  $('promptVersion').textContent = PROMPT_VERSION;

  onRequest(n => { els.requestCount.textContent = `API requests this session: ${n}`; });
  els.analyzeBtn.addEventListener('click', analyze);
  els.results.addEventListener('click', onAction);
  els.historyList.addEventListener('click', onAction);
  els.themeBtn.addEventListener('click', toggleTheme);
  // Printing (Save as PDF button or Cmd/Ctrl+P) includes every generated deep-dive tab, not only the open one.
  window.addEventListener('beforeprint', fillPrintExtras);
  $('historyBtn').addEventListener('click', () => openDrawer(true));
  $('closeHistoryBtn').addEventListener('click', () => openDrawer(false));
  els.backdrop.addEventListener('click', () => openDrawer(false));
  $('clearHistoryBtn').addEventListener('click', () => {
    if (confirm('Delete all saved analyses from this browser?')) { clearHistory(); refreshHistory(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !els.drawer.hidden) openDrawer(false); });

  if (!HAS_CREDENTIALS && IS_LOCAL) {
    els.results.innerHTML = renderError('API key missing', 'Copy js/config.local.example.js to js/config.local.js and paste your Gemini key from aistudio.google.com, then reload.', 'key');
  }
}

init();
