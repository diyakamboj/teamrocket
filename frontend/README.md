# ResumeIQ Assistant

Build a modern web app called "ResumeIQ" — an AI-powered Resume Screening 

Assistant for recruiters.

DESIGN DIRECTION (inspired by modern SaaS dashboards, but original):

- Clean, card-based layout with generously rounded corners (16-20px radius), 

  soft layered shadows, and lots of whitespace

- Light mode default with a dark mode toggle

- Color palette: white/very light gray background, deep navy text, and a 

  single accent color of indigo-violet used for primary buttons, active 

  states, and chart highlights. Use soft pastel tints of the accent for 

  badges and tags. Do NOT copy any existing template's exact colors.

- Typography: modern geometric sans-serif (e.g., Plus Jakarta Sans or 

  Inter), bold headings, comfortable line height

- Left sidebar navigation with icons + labels, collapsible

- Top bar with search, notifications, and user avatar

PAGES & FEATURES:

1. Dashboard (Hiring Insights)

   - Stat cards: total candidates, avg match score, top skill, resumes 

     processed

   - Charts: skill distribution bar chart, candidate score distribution, 

     experience-level breakdown

   - "Qualification gaps" insight card with AI-generated summary text

2. Bulk Resume Upload (must handle high volume)

   - Drag-and-drop upload zone that accepts MANY PDF resumes at once 

     (support selecting entire folders / 100+ files in one batch), 

     including scanned documents

   - Batch summary bar: total files, queued, processing, completed, 

     failed — with an overall progress bar

   - Per-file status list showing each resume moving through stages: 

     Queued → Uploading → OCR → AI Parsing → Complete (or Failed)

   - Failed files show an error reason and a "Retry" button; also 

     include "Retry all failed" and "Cancel remaining" actions

   - Duplicate detection: flag files with the same name/candidate and 

     let the recruiter skip or replace

   - The list must stay smooth with 100+ rows (use pagination or 

     virtualized scrolling) and allow filtering by status

   - Recruiters can navigate to other pages while processing continues; 

     show a small persistent progress indicator in the sidebar

   - When a batch finishes, show a completion toast with 

     "View ranked candidates" shortcut

3. Job Description Analysis

   - Textarea to paste a job description + "Analyze" button

   - Results shown as editable requirement cards grouped by category: 

     Skills, Experience, Education, Certifications

   - Recruiters can add, edit, or remove requirements before screening

4. Candidate Ranking (main page)

   - Sortable table of candidates: rank, name, overall score (circular 

     progress ring), and per-category mini score bars

   - Must scale to hundreds of candidates: pagination, search, and 

     filters (by score range, skill, experience level)

   - Adjustable score weight sliders in a side panel (Skills / Experience 

     / Education / Certifications / Projects) that re-rank the list live

   - Blind Review Mode toggle that hides names, photos, and contact info, 

     replacing names with "Candidate #1", "Candidate #2"

   - Expandable row: explanation of the ranking (strengths, gaps, 

     transferable skills) plus evidence chips like 

     "Python — Built automation scripts | Source: SWE Internship"

5. Candidate Comparison

   - Select 2-3 candidates and view them side-by-side in columns: 

     scores, skills, experience, education, strengths/weaknesses, and 

     an AI recommendation card at the bottom

6. Recruiter Copilot

   - Slide-over chat panel (accessible from any page via a floating 

     button) where recruiters ask natural-language questions about the 

     candidate pool, with suggested prompts like "Who has the most cloud 

     experience?" and "Compare the top 3 candidates"

TECH NOTES:

- Use mock data for candidates, scores, and AI responses for now — the 

  real backend will be Python/FastAPI with Azure services later

- Simulate the bulk upload pipeline with mock async processing (staggered 

  status updates) so the UI behavior is realistic

- Fully responsive; sidebar collapses to icons on smaller screens

- Smooth micro-interactions: hover states on cards, animated score rings, 

  slider changes animate the re-ranking

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4b38fb76-e80b-481c-844f-28c466a9d594).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
