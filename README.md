# ResuML

ResuML checks how well a resume matches a job description. Paste or upload both, and it gives you a match score, the keywords you're missing, what your resume already does well, and specific edits to make. It can also rewrite weak bullet points, plan a skill-gap roadmap and suggest interview questions.

**Live:** https://resu-ml.vercel.app/

## Features

- **Reviewer personas.** ResuML reads the job description first and picks a reviewer suited to it: tech recruiter, ML hiring manager, campus recruiter, career-change coach, business-roles recruiter or a general ATS reviewer. You can also choose one yourself.
- **Match score** out of 100, with a breakdown for skills, experience, projects, education and formatting.
- **Verified missing keywords.** Every keyword the model reports as missing is checked against both texts. If it's already in the resume, or not in the job description at all, it's flagged instead of shown as a gap.
- **Skill coverage score.** A rule-based score shown next to the model's score, with a note when the two disagree.
- **Deep dive**, generated on demand: bullet point rewrites, a skill-gap roadmap, likely interview questions and a cover letter opener.
- **PDF upload** (or drag and drop) for both the resume and the job description.
- **History** of past analyses, stored in your browser.
- **Export** to PDF (including every deep-dive section you generated), Markdown or JSON.
- Light and dark themes.

## How it works

Each analysis makes two Gemini calls:

1. **Profile the job description:** role, seniority, domain, must-have and nice-to-have skills, and the reviewer persona that fits best.
2. **Review the resume** as that persona, against the extracted skills.

The response is then checked without AI. Each "missing" keyword is looked up in the resume and the job description, and the must-have skills are matched in the resume to produce the coverage score.

## Prompt design

The prompts live in `js/prompts.js` and follow the same structure: role, task, output format, rules.

- Gemini's `responseSchema` enforces the JSON shape, so the response never has to be parsed out of free text.
- A short few-shot example sets the expected level of detail.
- A scoring rubric with explicit score bands keeps results consistent between runs.
- The resume and job description are wrapped in tags, and the model is told to ignore any instructions inside them (protection against prompt injection).
- Every result stores the prompt version that produced it.

## Tech stack

- HTML, CSS and JavaScript (ES modules, no framework, no build step)
- Google Gemini API (`gemini-3.5-flash-lite`)
- pdf.js for reading PDFs, lottie-web for animations
- Vercel for hosting and the serverless API proxy

## Running locally

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com).
2. Create your local config and add the key. `js/config.local.js` is git-ignored.
   ```bash
   cp js/config.local.example.js js/config.local.js
   ```
3. Serve the folder. Browsers don't load ES modules from `file://`.
   ```bash
   python3 -m http.server 8000
   ```
4. Open http://localhost:8000

## Deployment

The site runs on Vercel with no build step. The API key is set as the `GEMINI_API_KEY` environment variable. On any host other than localhost, the app sends its requests to `/api/gemini` instead of Google, so the key never reaches the browser.

The proxy (`api/gemini.js`):
- only forwards same-origin requests for `gemini-3.5-flash-lite`;
- limits the request size;
- allows each IP 20 requests a minute.

## Project structure

```
index.html              page markup and icon sprite
css/tokens.css          colors for the light and dark themes
css/styles.css          layout, components and print styles
js/main.js              app controller
js/config.js            settings and key loading
js/prompts.js           prompts and response schemas
js/personas.js          reviewer personas
js/gemini.js            Gemini API client
js/scoring.js           keyword check and skill coverage
js/render.js            results rendering
js/pdf.js               PDF text extraction
js/history.js           saved analyses (localStorage)
js/export.js            PDF, Markdown and JSON export
js/icons.js             icon helper
js/animations.js        Lottie loader
assets/lottie/          loading and upload animations
api/gemini.js           Vercel serverless proxy
```

---

Built by Dikshit Bhatta · ApnoAI AI/ML Intern · November 2026
