# Specification acceptance mapping

| Requirements | Implementation | Evidence |
|---|---|---|
| FR-01–03 | Public enquiry, fields, consent and server/database validation | Validation and database tests; deployed form smoke test pending |
| FR-04–07 | Exact normalized email matching, phone review flag, prospect/enquiry relationships, initial stage | PostgreSQL duplicate/lifecycle tests |
| FR-08–09 | Supabase login, active profiles, REST permission checks, RLS | API unauthorized tests; PostgreSQL management/disabled role tests |
| FR-10–11 | Prospect search/filter, contact editing and staff assignment | Implemented UI/API; browser/live smoke test pending |
| FR-12 | Controlled state transitions and recorded qualification reason | PostgreSQL invalid transition and lifecycle tests |
| FR-13–15 | Program application/status/enrolment transactions | PostgreSQL lifecycle and enrolment tests |
| FR-16,20 | Linked record detail and append-only audit/history | PostgreSQL history checks; UI displays related records |
| FR-17–19 | Stage stock, distinct reached conversions, explicit exits, management reporting | Reporting unit tests and management PostgreSQL tests |

Automated verification: `npm test`, `npm run build`. SQL tested using PGlite PostgreSQL after providing mock Supabase auth schema/roles; pgcrypto extension omitted in that test environment because gen_random_uuid is built in. Live Supabase provisioning, HTTPS deployment, authentication invitation configuration, responsive visual QA and performance load checks remain environment acceptance tasks. No production performance SLA is claimed.

All seed information is fictional. No original attachment files or real student data are committed. Source follows the supplied React/REST/PostgreSQL architecture and documented role/state models.
