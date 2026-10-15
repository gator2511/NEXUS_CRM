# API and workflow contract (v2)

JSON requests use Content-Type application/json. Protected endpoints require an Authorization bearer token from Supabase Auth; staff roles and active status are checked on every request. Students must have a confirmed email and a matching enquiry. Errors are safe JSON messages; validation 422, missing session 401, role denial 403, workflow/database rejection 400, unexpected errors 500. Client API bodies are limited to 64 KB. File content never passes through a JSON request.

| Method | Route                           | Purpose                                                                            |
| ------ | ------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | /api/health                     | Public configuration flags only                                                    |
| GET    | /api/programs                   | Public active programs                                                             |
| POST   | /api/enquiries                  | Name, email, telephone, address, program_id, consent:true and optional message     |
| GET    | /api/me                         | Active staff profile                                                               |
| GET    | /api/student                    | Sanitized, own-record workspace (no internal staff notes/decision note)            |
| POST   | /api/student/:action            | Student actions below                                                              |
| POST   | /api/uploads/prepare            | document_type_id, file_name, mime_type, size_bytes → unique signed upload ticket   |
| POST   | /api/uploads/:id/complete       | Validate actual stored bytes and finalize own upload                               |
| GET    | /api/documents/:id              | Permission-checked short-lived private download URL                                |
| GET    | /api/offers/:id/pdf             | Staff or owning current student application: generated PDF from immutable snapshot |
| GET    | /api/staff                      | Staff roster; admins also see inactive profiles                                    |
| GET    | /api/prospects                  | Staff prospect records with all linked attempts                                    |
| GET    | /api/applications/:id/checklist | Staff program checklist and current documents                                      |
| POST   | /api/prospects/:id/:action      | Controlled staff actions below                                                     |
| GET    | /api/audit                      | Latest 500 audit events                                                            |
| GET    | /api/emails                     | Latest 200 delivery metadata rows; no tokens or bodies                             |
| GET    | /api/reports?from=&to=          | Aggregate inputs filtered by prospect creation-date cohort                         |
| POST   | /api/jobs/run                   | Management/admin confirmed workflow checks + email delivery                        |
| GET    | /api/cron                       | Cron-secret authenticated scheduler endpoint                                       |
| POST   | /api/staff/:id                  | Admin role/active status changes                                                   |

Student actions: qualification_draft, qualification_submit, application_draft, application_submit, offer_accept, offer_decline, withdraw. Draft forms allow valid partial data; submission enforces all required fields and current program/intake constraints in PostgreSQL. Qualification fields: highest_qualification, institution, year_completed, optional result, language_test_type, language_score, test_date, intake_id. Application fields: date_of_birth, nationality, emergency_contact_name, emergency_contact_phone, study_mode, intake_id.

Staff actions: update (contact/assignee), qualification_decision (approve/reject + note), document_review (document_id + Verified/Rejected + note), application_decision (accept/reject + note), close (Withdrawn/No response), note, followup and complete_followup. Raw stage jumps and the old staff enrol endpoint are intentionally removed. Database functions enforce all rules even if the REST layer is bypassed.

## State and evidence

Enquiry submission creates a prospect/enquiry and brochure outbox event; repeated normalized email links to the existing identity without overwriting it. Phone punctuation is normalized for duplicate review. New prospects go to the least-loaded active recruiter, counting non-terminal records. Concurrent assignments are serialized. A repeated enquiry for a Closed prospect starts a new attempt; an active prospect keeps its current state.

Academic submission: Enquiry → Qualification review. Configured academic minimum and English test thresholds determine Pass, Review or Fail. IELTS borderline margin is 0.5; PTE/TOEFL margin 5. Missing criteria/no test requires staff review. A Fail never rejects automatically. Pass or staff approval → Qualified and a Draft application. Staff rejection → Closed / Not eligible, with a reason.

Application submission requires details, an open intake for the same program and all required current uploads → Application. Required document checklist must be configured. Documents begin Uploading, finalize as Pending, then staff marks Verified or Rejected (reason mandatory). Only rejected documents can be replaced after submission. “None taken” excludes the English test result checklist item after staff eligibility review. Application acceptance requires all required documents Verified → Offer, with a 14-day deadline and immutable snapshot. Student acceptance before expiry → Enrolled; repeated acceptance does not add a second enrolment. Student decline/withdrawal and staff closure use structured reasons. Closed attempts can restart via new enquiry; Enrolled cannot be reopened through this release.

Every mutation locks the prospect and commits business changes, task/history/audit/outbox records together. Staff and student direct table writes are not granted. Service-only upload finalization is reachable only after server checks the authenticated upload owner and actual content. Private storage insert/read policies are scoped to server-prepared paths and appropriate record access. Superseded objects are retained as versions.

## Automation

| Rule                             | Reminder               | Closure / action                       |
| -------------------------------- | ---------------------- | -------------------------------------- |
| Enquiry details missing          | 3 elapsed days         | Close at 14 days: No response          |
| Qualified application incomplete | 7 elapsed days         | Close at 30 days: No response          |
| Rejected document outstanding    | 5 elapsed days         | Close at 21 days: No response          |
| Offer                            | 7 days before deadline | Close at expiry: Offer lapsed          |
| Staff task                       | —                      | Escalate 2 working days after due date |

Working days are Monday–Friday in Australia/Darwin, without a public-holiday calendar. Event dedupe keys and serialized jobs prevent duplicate queue entries/closures. No manager available: task remains eligible for escalation later. Network delivery uses a leased outbox, provider idempotency key and bounded retries; a provider failure does not turn a saved decision into an API failure.

## Reporting semantics

Date filters select prospects by original creation date (inclusive from/to calendar dates interpreted as UTC boundaries); all historical attempts for those prospects are included. Reached/moved/closed totals are distinct prospects per stage; one prospect can appear in multiple closure-reason groups after reopening, so reason-group totals must not be summed as unique people. Current stock counts present stage. Conversion is unique next-stage reached / unique preceding-stage reached. Confirmed drop-off is unique closures from that stage / unique stage reached. Average duration includes completed stage visits; current unfinished visits are excluded. No denominator displays an em dash, not an invented percentage. Management receives IDs/stages/timestamps rather than contact information.
