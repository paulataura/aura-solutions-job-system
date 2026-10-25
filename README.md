# Aura Solutions Job System

Job management for Aura Solutions Group Limited: jobs, operators, job sheets and Waste Transfer Notes.
Hosted on GitHub Pages; data in Supabase (project "Job Sheets").

## Where things are

| Path | What it is |
| --- | --- |
| `app/` | **The new app (v1).** Operator job view and management review. Open `/app/` |
| `app/js/operator.js` | Operator screens: My jobs, brief, arrive, work, waste loads + WTN, disposal, sign-off, submit |
| `app/js/review.js` | Management: review lists, review screen, approve, send back, documents |
| `app/js/documents.js` | Job sheet and WTN layout, legal checks, PDF output |
| `app/js/supa.js` | Every database and storage call |
| `supabase/migrations/` | Database changes, in date order |
| `index.html`, `job.html`, `Aura_Solutions_Supabase_Test_v32_40_…_v3.html` | The previous app, still live until the switch-over |
| `archive/old-builds/` | Earlier copies of the previous app, kept for reference only |

## Rules for changes

- One live version. Change the files in `app/`; never copy the app to a new file name.
- Database changes go in a new dated file in `supabase/migrations/`.
- WTNs can't be issued unless every legally required field is present (`wtnProblems` in `documents.js`).

## Job statuses

`issued` → `on_site` (operator arrives) → `returned` (operator submits; awaiting review) → `reviewed` (approved, documents created) → `closed`.
The office can send a job back (`returned` → `on_site`) with a note. `aborted` = stopped on site with a reason.
