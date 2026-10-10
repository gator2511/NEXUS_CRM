# Nexus CRM

A custom RIC student recruitment CRM built from the supplied specification. React + Vite staff/public interfaces, Express REST API, Supabase authentication and PostgreSQL transactional workflow functions. Vercel configuration is included. All seeded names, programs and contact details are fictional demonstration data; program names are not a verified RIC course catalogue.

## Features

- Public `/enquiry` form: validated name, email, telephone, address, program, message and consent.
- Case-insensitive exact-email matching: repeated enquiries link to the existing prospect without overwriting their data. Exact-phone collisions are flagged for staff review rather than merged.
- Staff login and recruitment, administration, management and administrator roles.
- Search/filter prospect database, contact editing, responsible staff assignment, CSV export and related enquiries.
- Pipeline: Enquiry → Qualified → Application → Enrolled, plus Withdrawn/Closed.
- Application states: Draft → Submitted → Under Review → Accepted/Rejected. Only accepted applications can enrol.
- Notes, dated follow-ups, completion tracking and immutable staff audit history.
- Dashboard, stage volumes, unique-prospect historical conversion rates and explicit drop-off reporting. Pending prospects are not treated as lost.
- Management receives reporting data only. Server permissions and database policies enforce restrictions even when requests bypass the UI.
- Administrator can change existing staff roles and disable/reactivate accounts; cannot change their own access.
- Responsive layouts, field labels, loading/error feedback and empty states.

## Run locally

Requires Node.js 22.12+ (tested with Node.js 24).

```sh
npm ci
cp .env.example .env
npm run dev
```

Open the Vite URL printed in the terminal. With `VITE_DEMO_MODE=true`, the app runs with fictional data stored only in that browser. No Supabase account is needed for demonstration. Demo roles simulate permissions; they are not real authentication. Restoring demo data is available in Settings.

For PostgreSQL mode, configure all four Supabase environment variables and set `VITE_DEMO_MODE=false`. See [deployment guide](docs/DEPLOYMENT.md).

```sh
npm test
npm run build
```

Tests exercise real PostgreSQL semantics through PGlite, including permissions, duplicate matching, invalid transitions, enrolment and rollback. PGlite is a test dependency only, not the production database.

## Project structure

| Path | Purpose |
|---|---|
| `src/main.jsx`, `src/style.css` | React staff workspace and public enquiry interface |
| `src/data.js` | REST client and explicitly enabled fictional demo adapter |
| `server/app.js`, `server/rules.js` | REST endpoints, authentication, input validation and reporting |
| `api/index.js` | Vercel serverless API entry |
| `supabase/schema.sql` | Tables, indexes, RLS and transactional workflow functions |
| `tests/` | PostgreSQL integration, REST security and business-rule tests |
| `docs/` | API, deployment, business rules and acceptance checklist |

## Scope and verification limits

This is a runnable capstone implementation, not an already provisioned production service. Supabase and Vercel project setup, environment values, initial staff accounts and a deployment smoke test are required. No live RIC records, credentials or deployment accounts are included. Automated tests and the production build are verified; browser visual QA and live Supabase/Vercel integration must be completed after deployment.

Outbound emails, document uploads, bulk spreadsheet imports and scheduled notifications are not part of the supplied FR-01–FR-20 acceptance requirements and are not implemented. Follow-ups are tracked in the workspace rather than sent externally. Before real applicant use, agree privacy/retention rules, eligibility criteria, hosting suitability, abuse controls and operational recovery with RIC. The qualification reason is a recorded staff decision, not automated eligibility scoring.
