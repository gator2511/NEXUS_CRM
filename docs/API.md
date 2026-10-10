# REST API and business rules

All JSON requests use `Content-Type: application/json`. Staff endpoints use `Authorization: Bearer <Supabase access token>`. Errors return `{ "error": "safe message" }`. Validation returns 422, unauthenticated access 401, forbidden actions 403, database/workflow rejection 400 and unexpected errors 500. Responses use no-store cache headers.

| Method | Route | Permission / purpose |
|---|---|---|
| GET | `/api/health` | Public, configuration status only |
| GET | `/api/programs` | Public active programs |
| POST | `/api/enquiries` | Public submission; required `full_name,email,phone,address,program_id,consent:true`, optional `message` |
| GET | `/api/me` | Active staff profile |
| GET | `/api/staff` | Record readers; admins see inactive staff too |
| GET | `/api/prospects` | Staff records with enquiries, applications/enrolments, notes and follow-ups |
| GET | `/api/audit` | Staff audit access; newest 500 entries |
| GET | `/api/reports` | Staff and management; aggregate stage, reached, conversion and dropout counts |
| POST | `/api/prospects/:uuid/update` | Name, email, phone, address, nullable assigned_staff_id |
| POST | `/api/prospects/:uuid/stage` | `stage` Qualified/Withdrawn/Closed and `reason` |
| POST | `/api/prospects/:uuid/application` | `program_id` |
| POST | `/api/prospects/:uuid/application_status` | `application_id`, `status` |
| POST | `/api/prospects/:uuid/enrol` | `application_id`, ISO `enrolment_date` |
| POST | `/api/prospects/:uuid/note` | `body` |
| POST | `/api/prospects/:uuid/followup` | `title`, ISO timestamp `due_at` |
| POST | `/api/prospects/:uuid/complete_followup` | `followup_id` |
| POST | `/api/staff/:uuid` | Admin only; `role`, boolean `active` |

## Workflow decisions

New prospect: Enquiry. Existing matched prospect retains its stage/contact details; each valid repeated submission adds an enquiry. Exact normalized email is the match key. Exact stored phone collision with another prospect is a review flag. Different phone formatting is not normalized or auto-merged. Public responses never disclose whether an email already exists.

Enquiry → Qualified requires valid stored contact data and a staff decision reason of at least three characters. Program enrolment eligibility is not inferred from contact fields. Qualified → Application happens automatically when a valid program application is created. One application per prospect/program. Application progression is Draft → Submitted → Under Review → Accepted/Rejected. Submission date is recorded on Submitted. Enrolment requires Accepted and a prospect in Application; a single enrolment per application changes the prospect to Enrolled. Active stages can move to Withdrawn/Closed with a reason. Final stages cannot be reopened through this release. Rejection keeps the prospect in Application until staff closes/withdraws or pursues another program.

Each mutation locks the prospect and performs workflow changes plus audit/history inserts in a single PostgreSQL transaction. An exception rolls everything back. Database RLS and function role checks apply to calls bypassing the REST layer. No authenticated table write grants are issued.

## Reporting

Current counts describe the present stage of each prospect. Reached counts are distinct prospect IDs in stage history. All-time conversion = unique prospects reaching the next stage / unique prospects reaching the preceding stage; no denominator displays an em dash. Historical Closed/Withdrawn events grouped by prior stage are confirmed exits. These are all-time progression measures, not time-window cohort rates or forecasts. Management's reporting function returns IDs/stages/history only, not contact details. History is append-only through application access.
