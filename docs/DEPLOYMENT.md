# Supabase + Vercel setup

## 1. PostgreSQL and authentication

1. Create a Supabase project. Use a new empty database for `supabase/schema.sql` (this is an initial migration, not an idempotent upgrade script).
2. Execute the entire schema in the Supabase SQL editor. The functions are transactional; clients cannot write tables directly. Never put the service-role key in the browser or this repository. The app needs only the public anon key, plus the staff's authenticated bearer token.
3. In Authentication, disable public staff signups. Create/invite each staff account. Ensure each account has a password set before using the password login.
4. Create a matching staff profile using the Auth user UUID:

```sql
insert into public.staff_users(id,full_name,role,active)
values ('AUTH-USER-UUID', 'Staff Full Name', 'admin', true);
```

Roles: `recruitment`, `administration`, `management`, `admin`. Recruitment/administration have the same capstone record permissions; management has reports only. Administrators manage existing profiles; creating authentication accounts remains a Supabase administrator operation. Configure Auth site URL/redirect URLs to the deployed HTTPS origin for invitation flows.
5. Review the fictional seeded programs. Only active programs are shown publicly. Program catalogue maintenance is performed in Supabase by the project administrator.

## 2. Vercel

Import `gator2511/NEXUS_CRM`, select the Vite preset, root directory `/`, build command `npm run build`, output `dist` and a supported Node.js runtime. The repository's `vercel.json` routes `/api/*` to the Express function and SPA paths to `index.html`.

Set these environment variables for the relevant deployment environments, then deploy:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_URL` | Same project URL, server side |
| `SUPABASE_ANON_KEY` | Same public anon key, server side |
| `VITE_DEMO_MODE` | `false` for PostgreSQL mode; `true` only for fictional demo |

The VITE values are built into the client bundle. Redeploy after changing them. Demo mode is disabled unless explicitly set to `true`. Production API requires database configuration and never falls back to local demo storage.

## 3. Smoke test

- `/api/health` reports configured true. `/enquiry` lists active programs.
- Submit fictional student data, then log in as recruiter and find the enquiry.
- Qualify with a reason, create an application, submit, review, accept and record enrolment.
- Confirm dashboard/report totals and history. Create and complete a follow-up.
- Repeat an enquiry after at least one minute with the same email: one prospect and two enquiries, with duplicate review flag. Existing identity/stage must remain unchanged.
- Log in as management: reports work; direct `/api/prospects` and mutation requests return 403.
- Sign out: protected API returns 401. Disable a staff account and verify it loses protected access.
- Verify desktop/mobile layouts, keyboard navigation and no browser console errors.

## Recovery and operational care

Before changing data/schema, export the demonstration dataset with a database-owner backup (Supabase dashboard backup/export if available on the chosen plan, or `pg_dump` using the connection string kept securely outside Git). Store the backup securely and restore into a separate test project before relying on it. Back up Auth identities/profiles consistently; table references require those UUIDs. CSV export contains only the current filtered prospect list and is not a full database backup.

Database functions limit repeated enquiries for the same email to one per minute, including direct RPC callers. This is not comprehensive bot protection. Add CAPTCHA verification and appropriate ingress throttling before public real-data use. Decide consent wording, retention, access-review process and actual qualification conditions with RIC. Free-tier capacity and availability must be checked in the hosting accounts before operational use. The capstone uses fictional data only.
