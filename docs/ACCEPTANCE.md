# Acceptance and workflow evidence

The original FR-01–FR-20 staff CRM remains covered, with the student workflow added after review of Kenil-1912/nexus-crm commit 8c4a404ddb05398a053c25f6be43097235688fe3. This is an independent integration into React/REST/Supabase, preserving notes, assignments, CSV export, admin permissions and audit history.

| Area                      | Automated verification                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| v1 compatibility          | Original PostgreSQL lifecycle/security tests against preserved schema-v1.sql                                                   |
| In-place upgrade          | Legacy Withdrawn mapping preserves record; migration remains one transaction                                                   |
| Student identity          | Unverified identity and unmatched account denied; student cannot call private stage/email helpers                              |
| Qualification             | Draft, required-data rejection, auto-pass, missing-criteria human review                                                       |
| Documents and application | Missing upload blocks submission; service-only finalization; rejection/replacement/versioning; required verification gate      |
| Offers/enrolment          | Acceptance produces snapshot, student accept produces exactly one enrolment; terminal withdrawal denied                        |
| Authorization             | Management cannot read prospects or mutate records; direct table write denied; student ownership restrictions                  |
| Automation                | Threshold reminders, dedupe, no-response closing, reopening attempts, escalation, outbox claim/lease and retry                 |
| REST, files, reports      | Unauthenticated endpoints, safe malformed JSON, validation, file signatures, cohort boundaries, PDF output and email templates |
| Rendered React workflow   | Student academic form → application form → three uploads → submission → staff verification → offer issue → student enrolment   |
| Management UI             | Aggregate reports/automation available, contact tools absent                                                                   |

Commands: npm test; npm run build. Tests use PGlite with a mock Supabase auth schema/roles and JSDOM for interactive React rendering. No real emails are sent by tests. Private Storage policy syntax is supplied for Supabase; its hosted API is not emulated by PGlite. PDF bytes are generated/tested locally.

Still requiring a configured deployment: live Auth confirmation/reset, real private Storage ticket/finalize/download calls, verified email provider delivery, Vercel routing/cron, desktop/mobile visual browser checks, backup restore and performance checks. Tests do not claim a production security audit or operational SLA. All sample data/criteria are fictional; real RIC program, eligibility, offer and retention configuration is not fabricated.
