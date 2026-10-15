# Nexus CRM — student recruitment workflow

A custom RIC recruitment CRM with a React/Vite frontend, Express REST API, Supabase Auth, PostgreSQL workflow transactions and private Supabase Storage. Vercel deployment and scheduled-job configuration are included.

**Enquiry → Qualification review → Qualified → Application → Offer → Enrolled**

All program names, demo records and sample criteria are fictional. The workflow is adapted from the [reference Nexus CRM](https://github.com/Kenil-1912/nexus-crm) at commit `8c4a404ddb05398a053c25f6be43097235688fe3`, implemented within this repository's existing Supabase architecture rather than replacing it with a second authentication system.

## What's included

- Public validated enquiries, normalized email matching, normalized-phone duplicate flags and automatic least-loaded recruiter assignment. Existing identities cannot be overwritten by public submissions.
- Verified student accounts, login, password reset and a separate student portal. A confirmed Auth email must match the enquiry before it can be linked. Student accounts never create staff profiles.
- Academic/English language details, saved drafts, program/intake validation, automatic eligibility assessment and human review of ambiguous or failing cases.
- Student application details, study mode, emergency contact, intake, save draft and submission. An application draft remains in Qualified; submission moves to Application.
- Program-specific document checklist, direct private uploads (PDF/JPG/PNG up to 10 MB), actual file signature/size checks before finalization, staff verification/rejection and student replacement of rejected documents. Versions are preserved.
- Staff application decisions, immutable offer snapshots and PDF downloads, 14-day offers, student accept/decline and idempotent enrolment. Staff acceptance alone never enrols a student.
- Withdrawal, structured closure reasons and reopening on a new enquiry. Each attempt has its own qualification/application history.
- Automatic workflow tasks, manual follow-ups, assignment/reassignment, notes, audit history, admin role/account controls, prospect search/filter and CSV exports.
- Transactional email outbox, brochure/outcome/reminder templates, Resend delivery, explicit log-only mode, retry leases and failed-delivery tasks. Network errors do not undo saved recruitment decisions.
- Scheduled reminders, no-response closures, offer expiry and overdue-task escalations. Management can run checks explicitly from Reports.
- Cohort-by-creation reports: current stage totals, unique prospects reaching stages, conversions, confirmed exits/reasons, biggest drop-off and completed-visit average time. Reports and prospects export to CSV.

## Local demo

Use Node.js 24 (also required by the included CI).

```sh
npm ci
cp .env.example .env
npm run dev
```

Open the Vite URL printed in the terminal:

| Route      | Purpose                    |
| ---------- | -------------------------- |
| `/`        | Staff login and workspace  |
| `/enquiry` | Public enquiry form        |
| `/student` | Student account and portal |

`VITE_DEMO_MODE=true` explicitly enables fictional browser-local data. Open the student portal as `student@example.com` to begin at Enquiry; sign in to the staff workspace as Recruitment to review the same records. You can also submit a new fictional enquiry and use that email in the demo student portal. Demo sign-in is a role simulation, not authentication. Demo files live in browser storage and small files work best; demo offer download opens a printable letter. PostgreSQL mode generates an actual PDF. Settings restores demo data.

## PostgreSQL mode / upgrade

See [deployment and migration instructions](docs/DEPLOYMENT.md). Existing v1 installations must apply `supabase/migrations/002_student_workflow.sql` once and configure private storage. Do not rerun the base schema on an existing database. New installations run the base, migration and storage scripts in sequence. No live database was modified by committing this code.

Set `VITE_DEMO_MODE=false` and configure Supabase, the server-only service role, Auth email confirmation and private storage. For actual email delivery, configure Resend and a verified sender; log mode never sends emails. Real RIC criteria, brochures, intakes, checklist, offer wording and privacy text require administrator configuration.

## Tests

```sh
npm test
npm run build
```

`npm test` runs Node tests (PGlite PostgreSQL migration/lifecycle/permissions/jobs, API guards, reporting, file validation, PDF and email tests) and rendered React interaction tests (student → staff → offer → enrolment and management restrictions). PGlite and JSDOM are test tools, not the production database or a browser visual check. See [acceptance evidence and remaining deployment checks](docs/ACCEPTANCE.md).

## Source map

| Path                                                   | Purpose                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `src/StaffApp.jsx`, `src/StudentApp.jsx`, `src/ui.jsx` | Separate staff/student screens and shared forms                |
| `src/data.js`, `src/demo.js`                           | REST/storage client and explicit fictional demo adapter        |
| `server/app.js`, `server/rules.js`                     | API, validation, access checks, aggregate reporting            |
| `server/jobs.js`, `server/offer.js`                    | Outbox delivery and PDF generation                             |
| `supabase/schema-v1.sql`                               | Original base schema for new installations only                |
| `supabase/migrations/002_student_workflow.sql`         | Non-destructive v1 upgrade and workflow functions              |
| `supabase/storage.sql`, `supabase/demo-config.sql`     | Private bucket policies; optional fictional catalogue settings |
| `vercel.json`, `api/index.js`                          | SPA/API routing, serverless entry and daily cron               |

This repository is deployable source, not a provisioned live service. Live Supabase Auth/Storage, Resend and Vercel integration and browser visual QA remain deployment acceptance checks. Bulk spreadsheet import and staff catalogue-editing screens are not included; the reference repository also configures catalogue data outside its staff interface.
