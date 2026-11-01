/*
 * Rule-based checks on the model output (no API calls): verifies the reported
 * missing keywords and computes a skill-coverage score to compare with the
 * model's score.
 */

const MUST_HAVE_WEIGHT = 2;
const NICE_TO_HAVE_WEIGHT = 1;
const LLM_WEIGHT = 0.6;
const DISAGREEMENT_THRESHOLD = 25;

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compact = s => s.toLowerCase().replace(/[\s.\-_/]/g, '');

/**
 * True when `term` appears in `text` as a whole word/phrase.
 * Handles terms like "C++", "Node.js", "CI/CD" and spacing/punctuation
 * variants ("scikit learn" vs "scikit-learn", "NodeJS" vs "Node.js").
 */
export function containsTerm(text, term) {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  const lower = text.toLowerCase();
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(t)}(?![a-z0-9+#])`);
  if (pattern.test(lower)) return true;
  const c = compact(t);
  return c.length >= 4 && compact(lower).includes(c);
}

/**
 * Checks each keyword the LLM says is missing.
 * verified: in the JD and not in the resume (correct claim)
 * in_resume: the resume already contains it (hallucinated gap)
 * not_in_jd: the JD never mentions it (invented requirement)
 */
export function verifyKeywords(keywords, resume, jd) {
  const items = keywords.map(keyword => {
    const inResume = containsTerm(resume, keyword);
    const inJd = containsTerm(jd, keyword);
    const status = inResume ? 'in_resume' : inJd ? 'verified' : 'not_in_jd';
    return { keyword, status };
  });
  const verified = items.filter(i => i.status === 'verified').length;
  return {
    items,
    verified,
    precision: items.length ? Math.round((verified / items.length) * 100) : 100,
  };
}

/**
 * Rule-based skill coverage: weighted share of the JD's skills found in the
 * resume. Must-have skills count double.
 * @param {{must_have_skills: string[], nice_to_have_skills: string[]}} profile
 * @param {string} resume
 * @returns {{score: number, matched: string[], missing: string[], mustFound: number, mustTotal: number}}
 */
export function skillCoverage(profile, resume) {
  const unique = list => [...new Map(list.map(s => [s.toLowerCase(), s])).values()];
  const must = unique(profile.must_have_skills);
  const nice = unique(profile.nice_to_have_skills).filter(s => !must.some(m => m.toLowerCase() === s.toLowerCase()));
  const check = (skills, weight) => skills.map(skill => ({ skill, weight, found: containsTerm(resume, skill) }));
  const all = [...check(must, MUST_HAVE_WEIGHT), ...check(nice, NICE_TO_HAVE_WEIGHT)];

  const total = all.reduce((sum, s) => sum + s.weight, 0);
  const got = all.filter(s => s.found).reduce((sum, s) => sum + s.weight, 0);
  return {
    score: total ? Math.round((got / total) * 100) : 0,
    matched: all.filter(s => s.found).map(s => s.skill),
    missing: all.filter(s => !s.found).map(s => s.skill),
    mustFound: all.filter(s => s.found && s.weight === MUST_HAVE_WEIGHT).length,
    mustTotal: must.length,
  };
}

/**
 * Blends the model's score with rule-based coverage and flags large gaps.
 * @returns {{blended: number, gap: number, disagree: boolean}}
 */
export function hybridScore(llmScore, coverageScore) {
  return {
    blended: Math.round(LLM_WEIGHT * llmScore + (1 - LLM_WEIGHT) * coverageScore),
    gap: Math.abs(llmScore - coverageScore),
    disagree: Math.abs(llmScore - coverageScore) > DISAGREEMENT_THRESHOLD,
  };
}

export function clampScore(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
}
