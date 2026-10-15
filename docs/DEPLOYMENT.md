# Deploy / upgrade Nexus CRM v2

## 1. Database migration

Back up the database and test the upgrade in a separate Supabase project first. Database installation and migration scripts are single-use, not idempotent. The migration is wrapped in one transaction.

**Existing v1 project**

1. Run `supabase/migrations/002_student_workflow.sql` in the SQL editor. Do not run `schema-v1.sql` again.
2. Run `supabase/storage.sql` once to configure the private bucket and policies.
3. Configure real program criteria, intake dates, brochure URLs and document checklists through the SQL editor. `supabase/demo-config.sql` is optional fictional demonstration data only.

**New empty project**

Run `supabase/schema-v1.sql`, then `supabase/migrations/002_student_workflow.sql`, then `supabase/storage.sql` in that order. `supabase/schema.sql` is a psql entry point using `\ir`; Supabase's SQL editor does not interpret those psql directives, so use the individual files there.

The upgrade preserves UUIDs, enquiries, applications, enrolments, notes and previous audit/history records. It makes these explicit mappings:

| v1 record                                             | v2 mapping                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Withdrawn prospect                                    | Closed with reason Withdrawn; migration history event added                                                                                                                      |
| Closed without structured reason                      | Closed / Legacy closure                                                                                                                                                          |
| Application stage + any unfinished legacy application | Qualified / Draft so the student can complete new mandatory details and documents; the previous application snapshot/status is preserved in audit and a migration event is added |
| Enrolled                                              | Remains enrolled                                                                                                                                                                 |
| Multiple applications                                 | All retained; latest becomes current; earlier attempts remain visible                                                                                                            |

Existing active records receive a fresh automation grace period at upgrade, so introducing the new rules does not immediately close old records. Their original chronology remains in stage history.

A fresh enquiry for a Closed prospect increments its attempt number and clears only the current application pointer. Old qualifications, documents, letters and decisions remain intact.

## 2. Supabase Auth

Enable email/password student signup **and enable email confirmation**. Configure Auth Site URL and allowlisted redirects to your HTTPS origin, including `/student` for email confirmation and password recovery. Configure Supabase Auth SMTP for reliable verification/reset delivery. Auth emails are separate from the CRM's Resend recruitment emails.

Students create Auth accounts only. Do not install a trigger that creates privileged `staff_users` profiles from public signup metadata. The application never trusts signup metadata for roles. The student workspace checks `auth.users.email_confirmed_at` and links only the same verified email. If email confirmation is disabled in the Supabase project, Auth can auto-confirm addresses: that would defeat proof of mailbox ownership. Verify this setting in the smoke test.

Create/invite staff Auth accounts using the dashboard, then insert their profiles with the Auth UUID:

```sql
insert into public.staff_users(id,full_name,role,active)
values ('AUTH-USER-UUID','Staff Full Name','admin',true);
```

Roles: recruitment, administration, management, admin. Recruitment and administration can manage records. Management has aggregate reports and explicit workflow-job execution, without contact-record access. Admin also manages existing staff roles/active status. An admin cannot change their own access through this interface. Staff accounts should be created administratively, not through student signup.

## 3. Private documents

`storage.sql` creates `nexus-documents` as a private bucket, with a 10 MB/file limit and PDF/JPEG/PNG MIME types. Student uploads use short-lived signed tickets for server-created paths. Upload goes directly from the browser to Storage, avoiding the serverless request body limit. API finalization downloads the bytes, checks the actual signature/size and then invokes a service-only transactional function. Student or staff downloads require authenticated permission checks and produce short-lived private URLs.

Student objects are immutable. Replacement uploads create a new object/version; superseded records remain as evidence. Failed/unfinalized uploads remain in Uploading status and cannot appear on a document checklist. Administrators should periodically remove orphan Uploading objects older than their chosen retention period with the Storage API, after confirming no upload is active. Do not delete Storage object rows directly with SQL. File signatures are basic type checks, not malware scanning; configure additional content scanning if required for real applicant files.

## 4. Vercel and environment variables

Import `gator2511/NEXUS_CRM`, root `/`, Vite preset, Node.js 24, `npm run build`, output `dist`. `vercel.json` configures API/SPA routing and a 60-second function duration.

| Variable                  | Scope         | Value                                                                                     |
| ------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| VITE_SUPABASE_URL         | Browser/build | Project URL                                                                               |
| VITE_SUPABASE_ANON_KEY    | Browser/build | Public anon key                                                                           |
| VITE_DEMO_MODE            | Browser/build | `false` for PostgreSQL mode                                                               |
| SUPABASE_URL              | Server        | Same project URL                                                                          |
| SUPABASE_ANON_KEY         | Server        | Public anon key                                                                           |
| SUPABASE_SERVICE_ROLE_KEY | Server only   | Service role secret: required for validated upload finalization, jobs and outbox delivery |
| APP_URL                   | Server        | Canonical deployed HTTPS origin, without trailing slash                                   |
| EMAIL_DELIVERY_MODE       | Server        | `resend` for actual email, `log` for explicit demonstration-only logging                  |
| RESEND_API_KEY            | Server        | Recruitment email provider secret                                                         |
| MAIL_FROM                 | Server        | Approved verified sending address, e.g. `RIC Admissions <admissions@your-domain>`         |
| CRON_SECRET               | Server        | Long random secret for authenticated `/api/cron` invocations                              |

Never prefix a service/provider secret with `VITE_`, commit `.env`, or paste credentials into source. Browser variables are baked into the build; redeploy after changing them. The service key is used only after student ownership validation or an authorized manager/scheduler check.

## 5. Email and scheduled jobs

Recruitment events are inserted into `email_outbox` in the same transaction as their records. Mutation API responses attempt to drain up to 25 queued events in parallel when the service key is configured. Network failure never rolls back the recruitment transaction. Scheduled and manager-invoked runs also drain the outbox. Leased rows and provider idempotency keys reduce duplicate delivery; external email delivery is not claimed to be exactly-once.

Failed deliveries are retried on subsequent invocations, no sooner than 15 minutes, up to five claims; final failure creates a staff task. An uncompleted Sending lease becomes claimable after 10 minutes. In `log` mode messages become Logged and are never sent; switching to resend does not replay Logged messages automatically.

The included cron runs once daily at 00:00 UTC (09:30 Darwin) for compatibility with a daily scheduler. Rules apply on the next run after a threshold, not at an exact minute. For the reference's six-hour cadence use an account/plan supporting `0 */6 * * *`, or a trusted scheduler calling `GET /api/cron` with `Authorization: Bearer <CRON_SECRET>`. Do not use an in-process timer in a serverless function. Provider/scheduler availability and limits depend on the hosting accounts. Manual execution is available to management/admin in Reports, behind a confirmation step.

## 6. Deployment smoke test

1. `/api/health` reports database and workflow service configured. `/enquiry` lists programs.
2. Submit fictional data, receive/log brochure event, create student account with the same email. **Before email confirmation, the portal must deny access.** Confirm, then sign in.
3. Save academic draft; submit passing data → Qualified. Test borderline/missing criteria → Qualification review → staff approve/reject with history.
4. Save application details, upload all required PDFs/JPGs/PNGs, submit → Application. A mismatched file signature must fail finalization.
5. As staff reject one document; student replaces it; staff verify all required documents and issue offer → Offer. Download a readable PDF with correct student/program/intake/expiry.
6. Accept as student → Enrolled exactly once. Test offer decline, withdrawal, expiry and a new enquiry reopening a closed record without deleting history.
7. Verify management reports but no contact editing/record read; disabled staff lose access. Confirm student A cannot access student B's uploads/offer.
8. Configure provider test recipient; verify Sent vs Logged vs Failed accurately, reminder dedupe, retries, closure reasons and escalation.
9. Check desktop/mobile layouts, keyboard navigation, upload progress/error handling, confirmation dialogs and browser console.

## Backup and recovery

Use a database-owner backup/export appropriate to your Supabase plan before migrations, retain Auth identities/profile links consistently, and back up Storage objects as well as database metadata. Restore into a separate project and check row/object references before relying on the backup. CSV exports are not full backups. Before real use agree RIC's criteria, consent wording, offer terms, retention, authorized access and abuse controls. Only fictional data is supplied here; no live RIC records or cloud credentials are committed.
