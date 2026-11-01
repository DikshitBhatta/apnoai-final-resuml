// HTML rendering. All model output is escaped with esc() before it reaches the DOM.

import { PERSONAS } from './personas.js';
import { EXTRA_KINDS } from './prompts.js';
import { icon } from './icons.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

const items = (list, fn) => (list || []).map(fn).join('');

// Score bands, highest first. The band scale under the score ring is drawn from this list.
const BANDS = [
  { min: 80, label: 'Strong', color: 'var(--success)', message: 'Strong match. Your resume is well-optimized for this role.' },
  { min: 60, label: 'Good', color: 'var(--warning)', message: 'Good match. A few targeted edits can push it higher.' },
  { min: 40, label: 'Fair', color: 'var(--caution)', message: 'Fair match. Consider significant updates for this role.' },
  { min: 0, label: 'Low', color: 'var(--danger)', message: 'Low match. Major revisions needed, or this role may not fit yet.' },
];

const scoreTone = score => BANDS.find(b => score >= b.min);

function bandScale(score) {
  const ordered = [...BANDS].reverse();
  return `
    <div class="band-scale" role="img" aria-label="Score ${score} of 100: ${scoreTone(score).label} match">
      <div class="band-track">
        ${ordered.map((b, i) => `<span style="flex: ${(ordered[i + 1]?.min ?? 100) - b.min}; background: ${b.color};"></span>`).join('')}
        <span class="band-marker" style="left: ${score}%;"></span>
      </div>
      <div class="band-labels">
        ${ordered.map((b, i) => `<span style="flex: ${(ordered[i + 1]?.min ?? 100) - b.min};" class="${scoreTone(score) === b ? 'active' : ''}">${b.label}</span>`).join('')}
      </div>
    </div>`;
}

const barColor = v => (v >= 75 ? 'var(--success)' : v >= 50 ? 'var(--accent)' : v >= 35 ? 'var(--warning)' : 'var(--danger)');

/* Status blocks */

export function renderError(title, detail = '', iconName = 'alert-circle') {
  return `
    <div class="error-box" role="alert">
      ${icon(iconName, 'err-icon')}
      <div><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</div>
    </div>`;
}

export function renderStepItems(steps, activeIndex) {
  return steps.map((label, i) => {
    const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : '';
    return `<li class="${state}"><span class="dot">${i < activeIndex ? icon('check') : ''}</span>${esc(label)}</li>`;
  }).join('');
}

/** Loading view for the main analysis. Update the list in place with renderStepItems so the animation keeps playing. */
export function renderSteps(steps, activeIndex) {
  return `
    <div class="result-card loading-card" aria-live="polite">
      <div class="lottie loading-anim" data-lottie="analyzing"><span class="spinner"></span></div>
      <div>
        <p class="loading-title">Analyzing your resume</p>
        <ul class="steps" id="analysisSteps">${renderStepItems(steps, activeIndex)}</ul>
        <p class="hint" style="margin: 10px 0 0;">This usually takes 5-15 seconds.</p>
      </div>
    </div>`;
}

export const inlineLoading = text => `<div class="loading"><span class="spinner sm"></span> ${esc(text)}</div>`;

/* Main results */

export function renderResults(result, { activeTab }) {
  const { analysis: a, profile: p, guard, coverage, hybrid } = result;
  const tone = scoreTone(a.ats_score);

  return `
    <div class="result-card">
      <h4>${icon('target')} ATS match score
        <span class="h4-note">Reviewed as ${esc(PERSONAS[result.personaId]?.label || result.personaId)} · ${result.personaSource === 'auto' ? 'auto-selected' : 'your choice'}</span>
      </h4>
      <div class="score-layout">
        <div class="score-circle">
          <svg class="score-ring" viewBox="0 0 120 120" aria-hidden="true">
            <circle class="track" cx="60" cy="60" r="56"/>
            <circle class="value" cx="60" cy="60" r="56" pathLength="100" stroke-dasharray="${a.ats_score} 100" style="stroke: ${tone.color};"/>
          </svg>
          <div class="score-number" style="color: ${tone.color};">${a.ats_score}</div>
          <div class="score-label">out of 100</div>
        </div>
        <div>
          <p class="score-message">${tone.message}</p>
          ${bandScale(a.ats_score)}
          <div class="stat-tiles">
            <div class="stat" title="Rule-based: share of the JD's skills found word-for-word in your resume (must-haves count double).">
              <div class="label">Skill coverage</div>
              <div class="value">${coverage.score}</div>
              <div class="sub">${coverage.mustFound}/${coverage.mustTotal} must-haves found</div>
            </div>
            <div class="stat" title="60% LLM score + 40% rule-based skill coverage.">
              <div class="label">Blended score</div>
              <div class="value">${hybrid.blended}</div>
              <div class="sub">LLM + rule-based</div>
            </div>
            <div class="stat" title="Share of the AI's 'missing keywords' that are really in the JD and really absent from your resume.">
              <div class="label">Keyword precision</div>
              <div class="value">${guard.precision}%</div>
              <div class="sub">${guard.verified}/${guard.items.length} verified</div>
            </div>
          </div>
          ${hybrid.disagree ? `<div class="note">${icon('alert-triangle')}<span>The AI score and the rule-based coverage differ by ${hybrid.gap} points. The AI may be reading context the keyword check can't see (or vice versa), so review the sections below before trusting either number.</span></div>` : ''}
        </div>
      </div>
    </div>

    <div class="result-grid">
      <div class="result-card">
        <h4>${icon('align-left')} AI summary</h4>
        <p style="font-size: 15px;">${esc(a.summary)}</p>
      </div>
      <div class="result-card">
        <h4>${icon('bar-chart')} Section breakdown</h4>
        <div class="bars">
          ${items(Object.entries(a.section_scores), ([name, v]) => `
            <div class="bar-row">
              <span style="text-transform: capitalize;">${esc(name)}</span>
              <div class="bar-track"><div class="bar-fill" style="width: ${v}%; background: ${barColor(v)};"></div></div>
              <span class="num">${v}</span>
            </div>`)}
        </div>
      </div>
    </div>

    <div class="result-grid">
      <div class="result-card">
        <h4>${icon('check-circle')} What your resume does well</h4>
        <ul class="insight-list">${items(a.strengths, s => `<li>${esc(s)}</li>`)}</ul>
      </div>
      <div class="result-card">
        <h4>${icon('trending-up')} Recommended improvements</h4>
        <ul class="insight-list improvement-list">${items(a.improvements, s => `<li>${esc(s)}</li>`)}</ul>
      </div>
    </div>

    <div class="result-card">
      <h4>${icon('key')} Missing keywords</h4>
      <div class="keyword-list">
        ${items(guard.items, k => k.status === 'verified'
          ? `<span class="chip verified" title="Found in the JD, absent from your resume">${icon('check')} ${esc(k.keyword)}</span>`
          : `<span class="chip flagged" title="${k.status === 'in_resume' ? 'Already in your resume: the AI got this one wrong' : 'Not found in the job description'}">${icon('alert-triangle')} ${esc(k.keyword)}</span>`)}
      </div>
      <div class="legend">
        <span><span class="chip verified">${icon('check')}</span> verified missing</span>
        <span><span class="chip flagged">${icon('alert-triangle')}</span> flagged: already in resume or not in JD</span>
      </div>
      <h4 style="margin-top: 22px;">${icon('list-checks')} JD skill checklist <span class="tag muted">rule-based</span></h4>
      <div class="keyword-list">
        ${items(coverage.matched, s => `<span class="chip matched">${icon('check')} ${esc(s)}</span>`)}
        ${items(coverage.missing, s => `<span class="chip missing">${icon('x')} ${esc(s)}</span>`)}
      </div>
    </div>

    <div class="result-card">
      <h4>${icon('layers')} Deep dive</h4>
      <div class="tabs no-print" role="tablist">
        ${Object.entries(EXTRA_KINDS).map(([kind, spec]) => `
          <button class="tab ${kind === activeTab ? 'active' : ''}" role="tab" data-action="tab" data-kind="${kind}">${esc(spec.label)}</button>`).join('')}
      </div>
      <div id="extraPanel" class="tab-panel no-print">${renderExtra(result, activeTab)}</div>
      <div id="printExtras" class="print-only"></div>
    </div>

    <div class="result-card no-print">
      <div class="toolbar">
        <button class="btn primary" data-action="export-pdf">${icon('download')} Save as PDF</button>
        <button class="btn" data-action="export-md">${icon('copy')} Copy Markdown</button>
        <button class="btn" data-action="export-json">${icon('braces')} Download JSON</button>
        <span class="sep"></span>
        <button class="btn ghost" data-action="new">${icon('plus')} New analysis</button>
      </div>
    </div>

    <div class="tips-box success no-print">
      ${icon('flag', 'callout-icon')}
      <div><strong>Next steps:</strong> Add the verified missing keywords where you genuinely have the experience, apply the improvements, then run the analysis again to see your score move.</div>
    </div>`;
}

/* Deep-dive tabs */

export function renderExtra(result, kind) {
  const data = result.extras?.[kind];
  if (!data) {
    return `
      <div class="empty-state">
        <p>${esc(EXTRA_KINDS[kind].task)}</p>
        <button class="btn primary" data-action="extra" data-kind="${kind}">Generate ${esc(EXTRA_KINDS[kind].label)} ${icon('arrow-right')}</button>
      </div>`;
  }
  switch (kind) {
    case 'star_rewrite':
      return items(data.rewrites, r => `
        <div class="rewrite">
          <div class="before">${esc(r.original)}</div>
          <div class="after">${icon('arrow-right')} ${esc(r.rewritten)}</div>
          <div class="why">${esc(r.why)}</div>
        </div>`) + '<p class="hint">Replace [placeholders] with your real numbers. Never submit made-up metrics.</p>';
    case 'skill_gap':
      return `
        <div class="keyword-list" style="margin-bottom: 16px;">
          ${items(data.gaps, g => `<span class="chip ${g.priority === 'high' ? 'missing' : g.priority === 'medium' ? 'flagged' : ''}" style="text-decoration: none;" title="${esc(g.why)}">${esc(g.priority)} · ${esc(g.skill)}</span>`)}
        </div>
        ${items(data.roadmap, r => `
          <div class="roadmap-step">
            <div class="when">${esc(r.timeframe)}</div>
            <div><strong>${esc(r.focus)}</strong><br><span class="with-icon">${icon('flag')} ${esc(r.milestone)}</span><br><span class="hint">${esc(r.resources.join(' · '))}</span></div>
          </div>`)}`;
    case 'interview':
      return items(data.questions, (q, i) => `
        <div class="qa">
          <div class="q">${i + 1}. ${esc(q.question)} <span class="tag muted">${esc(q.type.replace(/_/g, ' '))}</span></div>
          <div class="meta">Why they ask: ${esc(q.why_asked)}</div>
          <div class="meta with-icon">${icon('message')} ${esc(q.answer_tip)}</div>
        </div>`);
    case 'cover_letter':
      return `<div class="letter">${esc(data.opening)}</div>`;
    default:
      return '';
  }
}

/** All generated deep-dive sections, stacked, for printing. */
export function renderPrintExtras(result) {
  const done = Object.keys(EXTRA_KINDS).filter(kind => result.extras?.[kind]);
  if (!done.length) return '<p class="hint">No deep-dive sections generated yet.</p>';
  return done.map(kind => `
    <section class="print-extra">
      <h5>${esc(EXTRA_KINDS[kind].label)}</h5>
      ${renderExtra(result, kind)}
    </section>`).join('');
}

/* History drawer */

export function renderHistory(entries) {
  if (!entries.length) {
    return '<div class="empty-state"><p>No saved analyses yet. Each analysis is saved here automatically (in this browser only).</p></div>';
  }
  return entries.map(e => `
    <div class="history-item">
      <div class="title">${esc(e.profile.role_title)}</div>
      <div class="score" style="color: ${scoreTone(e.analysis.ats_score).color};">${e.analysis.ats_score}</div>
      <div class="meta">${esc(new Date(e.createdAt).toLocaleString())} · ${esc(PERSONAS[e.personaId]?.label || e.personaId)} · ${esc(e.model)}</div>
      <div class="actions">
        <button class="btn" data-action="history-open" data-id="${esc(e.id)}">Open</button>
        <button class="btn danger" data-action="history-delete" data-id="${esc(e.id)}">${icon('trash')} Delete</button>
      </div>
    </div>`).join('');
}
