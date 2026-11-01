// Report export: print to PDF, copy as Markdown, download as JSON.

import { PERSONAS } from './personas.js';
import { EXTRA_KINDS } from './prompts.js';

const list = items => items.map(i => `- ${i}`).join('\n');

export function toMarkdown(result) {
  const { analysis: a, profile: p, guard, coverage, hybrid } = result;
  const lines = [
    `# ResuML report: ${p.role_title}`,
    '',
    `- Date: ${new Date(result.createdAt).toLocaleString()}`,
    `- Evaluated as: ${PERSONAS[result.personaId].label} (${result.personaSource})`,
    `- Model: ${result.model} · Prompt ${result.promptVersion}`,
    '',
    `## Scores`,
    `- ATS match (LLM): **${a.ats_score}/100**`,
    `- Skill coverage (rule-based): ${coverage.score}/100 (${coverage.mustFound}/${coverage.mustTotal} must-haves)`,
    `- Blended: ${hybrid.blended}/100`,
    `- Keyword precision: ${guard.precision}%`,
    '',
    `## Summary`,
    a.summary,
    '',
    `## Section breakdown`,
    list(Object.entries(a.section_scores).map(([k, v]) => `${k}: ${v}`)),
    '',
    `## Strengths`,
    list(a.strengths),
    '',
    `## Missing keywords`,
    list(guard.items.map(i => `${i.keyword}${i.status === 'verified' ? '' : ` (flagged: ${i.status.replace(/_/g, ' ')})`}`)),
    '',
    `## Improvements`,
    list(a.improvements),
  ];

  for (const [kind, data] of Object.entries(result.extras || {})) {
    lines.push('', `## ${EXTRA_KINDS[kind].label}`, extraToMarkdown(kind, data));
  }
  return lines.join('\n');
}

function extraToMarkdown(kind, data) {
  switch (kind) {
    case 'star_rewrite':
      return data.rewrites.map(r => `- Before: ${r.original}\n  After: **${r.rewritten}**\n  _${r.why}_`).join('\n');
    case 'skill_gap':
      return [
        list(data.gaps.map(g => `[${g.priority}] ${g.skill}: ${g.why}`)),
        '',
        list(data.roadmap.map(r => `${r.timeframe}: ${r.focus} → ${r.milestone} (${r.resources.join('; ')})`)),
      ].join('\n');
    case 'interview':
      return data.questions.map((q, i) => `${i + 1}. ${q.question} _(${q.type.replace(/_/g, ' ')})_\n   Tip: ${q.answer_tip}`).join('\n');
    case 'cover_letter':
      return data.opening;
    default:
      return '';
  }
}

export async function copyMarkdown(result) {
  await navigator.clipboard.writeText(toMarkdown(result));
}

export function downloadJSON(result) {
  const { inputs, ...report } = result; // keep the raw resume out of the shared file
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: `resuml-${slug(result.profile.role_title)}.json` });
  link.click();
  URL.revokeObjectURL(url);
}

/** Opens the print dialog in light theme; "Save as PDF" is a built-in destination. */
export function printPDF() {
  const root = document.documentElement;
  const previous = root.getAttribute('data-theme');
  root.setAttribute('data-theme', 'light');
  window.addEventListener('afterprint', () => {
    if (previous) root.setAttribute('data-theme', previous);
    else root.removeAttribute('data-theme');
  }, { once: true });
  window.print();
}

const slug = s => (s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
