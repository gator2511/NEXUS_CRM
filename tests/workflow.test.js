import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
export async function setup() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  await db.exec(
    (await read("supabase/schema-v1.sql")).replace(
      "create extension if not exists pgcrypto;",
      "",
    ),
  );
  return db;
}
const staff = "20000000-0000-4000-8000-000000000001",
  manager = "20000000-0000-4000-8000-000000000002",
  student = "30000000-0000-4000-8000-000000000001",
  other = "30000000-0000-4000-8000-000000000002";
const claim = async (db, id, role = "authenticated") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id || "",
  ]);
  await db.exec("set role " + role);
};
const rpc = async (db, name, args = []) => {
  const result = await db.query(
    `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
    args,
  );
  return result.rows[0].result;
};
const j = JSON.stringify;
test("v1 records migrate without losing legacy history and enrolments", async () => {
  const db = await setup();
  try {
    await db.exec(
      "insert into prospects(full_name,email,phone,address,stage) values('Old Withdrawn','old@example.com','0400000000','Example Street','Withdrawn')",
    );
    const gid = (await db.query("select id from programs limit 1")).rows[0].id;
    const enrolled = (
      await db.query(
        "insert into prospects(full_name,email,phone,address,stage) values('Already Enrolled','enrolled@example.com','0400000001','Example Street','Enrolled') returning id",
      )
    ).rows[0].id;
    const aid = (
      await db.query(
        "insert into applications(prospect_id,program_id,status) values($1,$2,'Accepted') returning id",
        [enrolled, gid],
      )
    ).rows[0].id;
    await db.query(
      "insert into enrolments(application_id,enrolment_date) values($1,'2026-10-01')",
      [aid],
    );
    const legacy = (
      await db.query(
        "insert into prospects(full_name,email,phone,address,stage) values('Pending Legacy','pending@example.com','0400000002','Example Street','Application') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into applications(prospect_id,program_id,status) values($1,$2,'Accepted')",
      [legacy, gid],
    );
    await db.exec(await read("supabase/migrations/002_student_workflow.sql"));
    assert.equal(
      (
        await db.query(
          "select closed_reason from prospects where email='old@example.com'",
        )
      ).rows[0].closed_reason,
      "Withdrawn",
    );
    assert.equal(
      (await db.query("select stage from prospects where id=$1", [enrolled]))
        .rows[0].stage,
      "Enrolled",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from enrolments where application_id=$1",
          [aid],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select stage from prospects where id=$1", [legacy]))
        .rows[0].stage,
      "Qualified",
    );
    assert.equal(
      (
        await db.query(
          "select detail->'old_application'->>'status' old_status from audit_log where prospect_id=$1 and action='Legacy application migrated'",
          [legacy],
        )
      ).rows[0].old_status,
      "Accepted",
    );
  } finally {
    await db.close();
  }
});
test("full verified student workflow, staff document decisions, enrolment and RLS", async () => {
  const db = await setup();
  try {
    await db.exec(await read("supabase/migrations/002_student_workflow.sql"));
    await db.exec(await read("supabase/demo-config.sql"));
    await db.exec(
      "create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant insert,select on storage.objects to authenticated;",
    );
    await db.exec(await read("supabase/storage.sql"));
    for (const [id, email] of [
      [staff, "staff@example.com"],
      [manager, "manager@example.com"],
      [student, "student@example.com"],
      [other, "other@example.com"],
    ])
      await db.query("insert into auth.users values($1,$2,now())", [id, email]);
    await db.query(
      "insert into staff_users values($1,'Recruiter','recruitment',true),($2,'Manager','management',true)",
      [staff, manager],
    );
    const gid = (
      await db.query("select id from programs order by name limit 1")
    ).rows[0].id;
    const intake = (
      await db.query("select id from intakes where program_id=$1 limit 1", [
        gid,
      ])
    ).rows[0].id;
    await claim(db, null, "anon");
    await rpc(db, "submit_enquiry", [
      j({
        full_name: "Demo Student",
        email: "STUDENT@example.com",
        phone: "0400 000 000",
        address: "10 Example Street",
        program_id: gid,
        consent: true,
      }),
    ]);
    await assert.rejects(() => rpc(db, "student_workspace"));
    await claim(db, other);
    await assert.rejects(() => rpc(db, "student_workspace"));
    await claim(db, student);
    let w = await rpc(db, "student_workspace");
    assert.equal(w.prospect.stage, "Enquiry");
    const pid = w.prospect.id;
    await assert.rejects(() =>
      rpc(db, "student_action", ["offer_accept", "{}"]),
    );
    await assert.rejects(() =>
      rpc(db, "student_action", ["qualification_submit", "{}"]),
    );
    const qualification = {
      highest_qualification: "Diploma",
      institution: "Demo College",
      year_completed: 2025,
      language_test_type: "IELTS",
      language_score: 7,
      test_date: new Date().toISOString().slice(0, 10),
      intake_id: intake,
    };
    await rpc(db, "student_action", [
      "qualification_draft",
      j({ institution: "Partial" }),
    ]);
    await rpc(db, "student_action", ["qualification_submit", j(qualification)]);
    w = await rpc(db, "student_workspace");
    assert.equal(w.prospect.stage, "Qualified");
    const aid = w.application.id;
    await assert.rejects(() =>
      rpc(db, "student_action", ["qualification_submit", j(qualification)]),
    );
    const details = {
      date_of_birth: "2000-01-01",
      nationality: "Australian",
      emergency_contact_name: "Demo Parent",
      emergency_contact_phone: "0400000000",
      study_mode: "Online",
      intake_id: intake,
    };
    await assert.rejects(() =>
      rpc(db, "student_action", ["application_submit", j(details)]),
    );
    for (const t of w.checklist) {
      const ticket = await rpc(db, "student_action", [
        "document_prepare",
        j({
          document_type_id: t.id,
          file_name: "demo.pdf",
          mime_type: "application/pdf",
          size_bytes: 10,
        }),
      ]);
      await db.query(
        "insert into storage.objects(bucket_id,name) values($1,$2)",
        ["nexus-documents", ticket.path],
      );
      await assert.rejects(() =>
        db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
          "nexus-documents",
          "someone-else/path",
        ]),
      );
      await assert.rejects(() =>
        rpc(db, "finalize_document", [ticket.id, student]),
      );
      await claim(db, null, "service_role");
      await rpc(db, "finalize_document", [ticket.id, student]);
      await claim(db, student);
    }
    await rpc(db, "student_action", ["application_submit", j(details)]);
    w = await rpc(db, "student_workspace");
    assert.equal(w.prospect.stage, "Application");
    await claim(db, manager);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from prospects")).rows.length, 0);
    await assert.rejects(() =>
      rpc(db, "crm_action", [
        pid,
        "application_decision",
        j({ decision: "accept" }),
      ]),
    );
    await claim(db, staff);
    await assert.rejects(() =>
      rpc(db, "crm_action", [
        pid,
        "application_decision",
        j({ decision: "accept" }),
      ]),
    );
    const docs = (
      await db.query("select id from documents where application_id=$1", [aid])
    ).rows;
    await rpc(db, "crm_action", [
      pid,
      "document_review",
      j({
        document_id: docs[0].id,
        status: "Rejected",
        note: "Please upload a clearer copy",
      }),
    ]);
    await claim(db, student);
    w = await rpc(db, "student_workspace");
    const rejected = w.checklist.find((t) => t.document?.status === "Rejected");
    const ticket = await rpc(db, "student_action", [
      "document_prepare",
      j({
        document_type_id: rejected.id,
        file_name: "replacement.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
      }),
    ]);
    await claim(db, null, "service_role");
    await rpc(db, "finalize_document", [ticket.id, student]);
    await claim(db, staff);
    for (const d of (
      await db.query(
        "select id from documents where application_id=$1 and status='Pending'",
        [aid],
      )
    ).rows)
      await rpc(db, "crm_action", [
        pid,
        "document_review",
        j({ document_id: d.id, status: "Verified" }),
      ]);
    await rpc(db, "crm_action", [
      pid,
      "application_decision",
      j({ decision: "accept", note: "All evidence verified" }),
    ]);
    await claim(db, student);
    w = await rpc(db, "student_workspace");
    assert.equal(w.prospect.stage, "Offer");
    assert.ok(w.application.offer_snapshot.reference);
    await rpc(db, "student_action", ["offer_accept", "{}"]);
    await rpc(db, "student_action", ["offer_accept", "{}"]);
    w = await rpc(db, "student_workspace");
    assert.equal(w.prospect.stage, "Enrolled");
    assert.ok(w.enrolment);
    await assert.rejects(() => rpc(db, "student_action", ["withdraw", "{}"]));
    await assert.rejects(() =>
      db.query("update prospects set stage='Enquiry'"),
    );
    await claim(db, manager);
    const r = await rpc(db, "recruitment_report");
    assert.equal(r.prospects.length, 1);
    assert.equal(r.prospects[0].email, undefined);
    await claim(db, null, "service_role");
    const emails = await db.query(
      "select count(*)::int n from claim_emails(25)",
    );
    assert.ok(emails.rows[0].n > 0);
  } finally {
    await db.close();
  }
});
test("automation thresholds, one-time reminders, retry leases, closures, escalation and reopening", async () => {
  const db = await setup();
  try {
    await db.exec(await read("supabase/migrations/002_student_workflow.sql"));
    await db.exec(await read("supabase/demo-config.sql"));
    await db.query("insert into auth.users values($1,$2,now()),($3,$4,now())", [
      staff,
      "staff@example.com",
      manager,
      "manager@example.com",
    ]);
    await db.query(
      "insert into staff_users values($1,'Recruiter','recruitment',true),($2,'Manager','management',true)",
      [staff, manager],
    );
    const gid = (await db.query("select id from programs limit 1")).rows[0].id;
    const input = {
      full_name: "Reminder Student",
      email: "reminder@example.com",
      phone: "0400000001",
      address: "Demo Street 1",
      program_id: gid,
      consent: true,
    };
    await claim(db, null, "anon");
    await rpc(db, "submit_enquiry", [j(input)]);
    await claim(db, null, "service_role");
    const first = await rpc(db, "run_workflow_jobs");
    assert.deepEqual(first, { closed: 0, reminders: 0, escalated: 0 });
    await claim(db, null, "postgres");
    await db.exec(
      "update prospects set stage_entered_at=now()-interval '4 days'",
    );
    await claim(db, null, "service_role");
    const reminder = await rpc(db, "run_workflow_jobs");
    assert.equal(reminder.reminders, 1);
    assert.equal((await rpc(db, "run_workflow_jobs")).reminders, 0);
    const rows = (await db.query("select * from claim_emails(25)")).rows;
    assert.equal(rows.length, 2);
    assert.equal(
      (await db.query("select * from claim_emails(25)")).rows.length,
      0,
    );
    const email = rows[0];
    await rpc(db, "finish_email", [
      email.id,
      "99999999-9999-4999-8999-999999999999",
      "Sent",
      null,
    ]);
    await claim(db, null, "postgres");
    assert.equal(
      (
        await db.query("select status from email_outbox where id=$1", [
          email.id,
        ])
      ).rows[0].status,
      "Sending",
    );
    await claim(db, null, "service_role");
    await rpc(db, "finish_email", [
      email.id,
      email.claim_token,
      "Failed",
      "Provider temporarily unavailable",
    ]);
    await claim(db, null, "postgres");
    await db.exec(
      "update email_outbox set next_attempt_at=now()-interval '1 minute' where status='Failed'",
    );
    await claim(db, null, "service_role");
    const retry = (await db.query("select * from claim_emails(25)")).rows;
    assert.equal(retry.length, 1);
    assert.equal(retry[0].attempts, 2);
    await rpc(db, "finish_email", [
      retry[0].id,
      retry[0].claim_token,
      "Sent",
      null,
    ]);
    await claim(db, null, "postgres");
    const pid = (await db.query("select id from prospects")).rows[0].id;
    await db.query(
      "insert into followups(prospect_id,staff_id,title,due_at) values($1,$2,'Overdue task',now()-interval '6 days')",
      [pid, staff],
    );
    await claim(db, null, "service_role");
    assert.equal((await rpc(db, "run_workflow_jobs")).escalated, 1);
    assert.equal((await rpc(db, "run_workflow_jobs")).escalated, 0);
    await claim(db, null, "postgres");
    await db.exec(
      "update prospects set stage_entered_at=now()-interval '15 days'",
    );
    await claim(db, null, "service_role");
    assert.equal((await rpc(db, "run_workflow_jobs")).closed, 1);
    assert.equal((await rpc(db, "run_workflow_jobs")).closed, 0);
    await claim(db, null, "anon");
    await assert.rejects(() => rpc(db, "run_workflow_jobs"));
    await claim(db, null, "postgres");
    await db.exec(
      "update enquiries set enquiry_date=now()-interval '2 minutes'",
    );
    await claim(db, null, "anon");
    await rpc(db, "submit_enquiry", [j(input)]);
    await claim(db, null, "postgres");
    const p = (await db.query("select * from prospects")).rows[0];
    assert.equal(p.stage, "Enquiry");
    assert.equal(p.cycle, 2);
    assert.equal(p.closed_reason, null);
    assert.ok(
      (
        await db.query(
          "select count(*)::int n from stage_history where to_stage='Closed'",
        )
      ).rows[0].n > 0,
    );
  } finally {
    await db.close();
  }
});
test("unverified accounts and helper bypasses are blocked; missing criteria go to human review", async () => {
  const db = await setup();
  try {
    await db.exec(await read("supabase/migrations/002_student_workflow.sql"));
    await db.query("insert into auth.users values($1,$2,null)", [
      student,
      "student@example.com",
    ]);
    const gid = (await db.query("select id from programs limit 1")).rows[0].id;
    await claim(db, null, "anon");
    await rpc(db, "submit_enquiry", [
      j({
        full_name: "Unverified Student",
        email: "student@example.com",
        phone: "0400000001",
        address: "Demo Street 1",
        program_id: gid,
        consent: true,
      }),
    ]);
    await claim(db, student);
    await assert.rejects(() => rpc(db, "student_workspace"));
    await assert.rejects(async () =>
      rpc(db, "wf_stage", [
        (await db.query("select gen_random_uuid() id")).rows[0].id,
        "Qualified",
        null,
      ]),
    );
    await assert.rejects(async () =>
      rpc(db, "wf_email", [
        (await db.query("select gen_random_uuid() id")).rows[0].id,
        "Offer",
        "fake",
        "{}",
        null,
      ]),
    );
    await claim(db, null, "postgres");
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [student],
    );
    await db.query(
      "insert into intakes(program_id,name,start_date) values($1,'Test intake','2027-01-01')",
      [gid],
    );
    const intake = (await db.query("select id from intakes")).rows[0].id;
    await claim(db, student);
    await rpc(db, "student_action", [
      "qualification_submit",
      j({
        highest_qualification: "Diploma",
        institution: "Demo College",
        year_completed: 2025,
        language_test_type: "None taken",
        intake_id: intake,
      }),
    ]);
    const w = await rpc(db, "student_workspace");
    assert.equal(w.prospect.stage, "Qualification review");
    assert.equal(w.qualification.auto_result, "Review");
    await claim(db, null, "postgres");
    await db.query(
      "insert into auth.users values($1,'staff@example.com',now())",
      [staff],
    );
    await db.query(
      "insert into staff_users values($1,'Reviewer','recruitment',true)",
      [staff],
    );
    await claim(db, staff);
    await rpc(db, "crm_action", [
      w.prospect.id,
      "qualification_decision",
      j({ decision: "approve", note: "Internal review note" }),
    ]);
    await claim(db, student);
    const approved = await rpc(db, "student_workspace");
    assert.equal(approved.prospect.stage, "Qualified");
    assert.ok(approved.application);
    assert.equal(approved.qualification.review_note, undefined);
    assert.equal(approved.qualification.reviewed_by, undefined);
    await rpc(db, "student_action", ["withdraw", "{}"]);
    await claim(db, null, "postgres");
    await db.exec(
      "update enquiries set enquiry_date=now()-interval '2 minutes'",
    );
    await db.query(
      "update programs set min_qualification_level=5,language_requirements='{}' where id=$1",
      [gid],
    );
    await claim(db, null, "anon");
    await rpc(db, "submit_enquiry", [
      j({
        full_name: "Unverified Student",
        email: "student@example.com",
        phone: "0400000001",
        address: "Demo Street 1",
        program_id: gid,
        consent: true,
      }),
    ]);
    await claim(db, student);
    await rpc(db, "student_action", [
      "qualification_submit",
      j({
        highest_qualification: "Diploma",
        institution: "Demo College",
        year_completed: 2025,
        language_test_type: "None taken",
        intake_id: intake,
      }),
    ]);
    const failed = await rpc(db, "student_workspace");
    assert.equal(failed.qualification.auto_result, "Fail");
    assert.equal(failed.prospect.stage, "Qualification review");
    await claim(db, staff);
    await assert.rejects(() =>
      rpc(db, "crm_action", [
        w.prospect.id,
        "qualification_decision",
        j({ decision: "reject", note: "" }),
      ]),
    );
    await rpc(db, "crm_action", [
      w.prospect.id,
      "qualification_decision",
      j({ decision: "reject", note: "Academic entry requirements not met" }),
    ]);
    await claim(db, student);
    const rejected = await rpc(db, "student_workspace");
    assert.equal(rejected.prospect.closed_reason, "Not eligible");
  } finally {
    await db.close();
  }
});
test("offer expiry, application and rejected-document automation follow distinct deadlines", async () => {
  const db = await setup();
  try {
    await db.exec(await read("supabase/migrations/002_student_workflow.sql"));
    await db.exec(await read("supabase/demo-config.sql"));
    await db.query("insert into auth.users values($1,$2,now())", [
      student,
      "student@example.com",
    ]);
    const gid = (await db.query("select id from programs limit 1")).rows[0].id;
    const dtype = (
      await db.query(
        "select id from document_types where program_id=$1 limit 1",
        [gid],
      )
    ).rows[0].id;
    const fixture = async (stage, age) => {
      const p = (
        await db.query(
          "insert into prospects(full_name,email,phone,address,stage,stage_entered_at) values('Time Test',$1,'0400000001','Demo Street',$2,now()-$3::interval) returning id",
          [crypto.randomUUID() + "@example.com", stage, age],
        )
      ).rows[0].id;
      const a = (
        await db.query(
          "insert into applications(prospect_id,program_id,status) values($1,$2,$3) returning id",
          [
            p,
            gid,
            stage === "Offer"
              ? "Accepted"
              : stage === "Qualified"
                ? "Draft"
                : "Under Review",
          ],
        )
      ).rows[0].id;
      await db.query(
        "update prospects set current_application_id=$1 where id=$2",
        [a, p],
      );
      return { p, a };
    };
    const qualified = await fixture("Qualified", "8 days");
    const offer = await fixture("Offer", "8 days");
    await db.query(
      "update applications set offer_expires_at=now()+interval '6 days' where id=$1",
      [offer.a],
    );
    const docs = await fixture("Application", "8 days");
    await db.query(
      "insert into documents(application_id,document_type_id,student_id,storage_path,file_name,mime_type,size_bytes,status,rejection_reason,reviewed_at) values($1,$2,$3,'test/path','demo.pdf','application/pdf',10,'Rejected','Unclear',now()-interval '6 days')",
      [docs.a, dtype, student],
    );
    await claim(db, null, "service_role");
    const first = await rpc(db, "run_workflow_jobs");
    assert.equal(first.reminders, 3);
    assert.equal((await rpc(db, "run_workflow_jobs")).reminders, 0);
    await claim(db, null, "postgres");
    await db.query(
      "update prospects set stage_entered_at=now()-interval '31 days' where id=$1",
      [qualified.p],
    );
    await db.query(
      "update applications set offer_expires_at=now()-interval '1 minute' where id=$1",
      [offer.a],
    );
    await db.exec("update documents set reviewed_at=now()-interval '22 days'");
    await claim(db, null, "service_role");
    assert.equal((await rpc(db, "run_workflow_jobs")).closed, 3);
    await claim(db, null, "postgres");
    assert.equal(
      (
        await db.query("select closed_reason from prospects where id=$1", [
          offer.p,
        ])
      ).rows[0].closed_reason,
      "Offer lapsed",
    );
    assert.equal(
      (await db.query("select status from applications where id=$1", [offer.a]))
        .rows[0].status,
      "Withdrawn",
    );
  } finally {
    await db.close();
  }
});

test("course automation configuration is admin-only, audited and drives enquiry brochure payloads", async () => {
  const db = await setup();
  try {
    await db.exec(await read("supabase/migrations/002_student_workflow.sql"));
    await db.exec(await read("supabase/migrations/003_course_automations.sql"));
    await db.exec(await read("supabase/migrations/003_course_automations.sql"));
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'admin@example.com',now()),($2,'student@example.com',now())",
      [staff, student],
    );
    await db.query(
      "insert into staff_users(id,full_name,role) values($1,'Admin','admin')",
      [staff],
    );
    const gid = (await db.query("select id from programs limit 1")).rows[0].id;
    const config = {
      min_qualification_level: 2,
      language_requirements: { IELTS: 6, PTE: 50 },
      brochure_url: "https://example.com/business.pdf",
    };
    await claim(db, student);
    await assert.rejects(
      rpc(db, "configure_program", [gid, j(config)]),
      /Admin access required/,
    );
    await claim(db, staff);
    await assert.rejects(
      rpc(db, "configure_program", [
        gid,
        j({ ...config, brochure_url: "javascript:alert(1)" }),
      ]),
    );
    await assert.rejects(
      rpc(db, "configure_program", [
        gid,
        j({ ...config, language_requirements: { IELTS: 99 } }),
      ]),
    );
    await rpc(db, "configure_program", [gid, j(config)]);
    await claim(db, null, "postgres");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from audit_log where action='Program automation configured'",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await rpc(db, "wf_eligibility", [
          gid,
          j({
            highest_qualification: "Diploma",
            language_test_type: "IELTS",
            language_score: 6,
          }),
        ])
      ).result,
      "Pass",
    );
    assert.equal(
      (
        await rpc(db, "wf_eligibility", [
          gid,
          j({
            highest_qualification: "Year 12 or equivalent",
            language_test_type: "IELTS",
            language_score: 6,
          }),
        ])
      ).result,
      "Fail",
    );
    assert.equal(
      (
        await rpc(db, "wf_eligibility", [
          gid,
          j({
            highest_qualification: "Diploma",
            language_test_type: "None taken",
          }),
        ])
      ).result,
      "Review",
    );
    await claim(db, null, "anon");
    const enquiry = {
      full_name: "New Student",
      email: "new@example.com",
      phone: "0400000000",
      address: "Example Street",
      program_id: gid,
      consent: true,
    };
    await rpc(db, "submit_enquiry", [j(enquiry)]);
    await claim(db, null, "postgres");
    const email = (
      await db.query("select * from email_outbox where template='Brochure'")
    ).rows[0];
    assert.equal(email.recipient, enquiry.email);
    assert.equal(email.payload.brochure_url, config.brochure_url);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from followups where kind like 'Brochure missing:%'",
        )
      ).rows[0].n,
      0,
    );
    await db.query("update programs set brochure_url=null where id=$1", [gid]);
    await claim(db, null, "anon");
    await rpc(db, "submit_enquiry", [
      j({ ...enquiry, email: "missing@example.com" }),
    ]);
    await claim(db, null, "postgres");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from followups where kind like 'Brochure missing:%'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
