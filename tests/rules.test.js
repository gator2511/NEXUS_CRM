import test from "node:test";
import assert from "node:assert/strict";
import {
  enquirySchema,
  can,
  transitionAllowed,
  report,
} from "../server/rules.js";
import { app } from "../server/app.js";
test("enquiry validation rejects missing consent and malformed fields", () => {
  const input = {
    full_name: "Test Student",
    email: "TEST@example.com",
    phone: "0400 000 000",
    address: "Demo Street 1",
    program_id: "10000000-0000-4000-8000-000000000001",
    consent: true,
  };
  assert.equal(enquirySchema.parse(input).email, "test@example.com");
  assert.throws(() => enquirySchema.parse({ ...input, consent: false }));
  assert.throws(() => enquirySchema.parse({ ...input, email: "invalid" }));
  assert.throws(() => enquirySchema.parse({ ...input, phone: "abc" }));
});
test("permissions and stage shortcuts", () => {
  assert.equal(can("management", "write"), false);
  assert.equal(can("management", "read"), false);
  assert.equal(can("management", "report"), true);
  assert.equal(can("unknown", "users"), false);
  assert.equal(transitionAllowed("Enquiry", "Enrolled"), false);
  assert.equal(transitionAllowed("Enrolled", "Qualified"), false);
  assert.equal(transitionAllowed("Enquiry", "Qualification review"), true);
});
test("reports use unique reached prospects rather than current stock", () => {
  const r = report(
    [
      { id: "a", stage: "Enrolled" },
      { id: "b", stage: "Closed" },
    ],
    [
      ...[
        "Enquiry",
        "Qualification review",
        "Qualified",
        "Application",
        "Offer",
        "Enrolled",
      ].map((to_stage) => ({ prospect_id: "a", to_stage })),
      { prospect_id: "a", to_stage: "Qualified" },
      { prospect_id: "b", to_stage: "Enquiry" },
      { prospect_id: "b", from_stage: "Enquiry", to_stage: "Closed" },
    ],
  );
  assert.equal(r.total, 2);
  assert.equal(r.conversions[0].rate, 50);
  assert.equal(r.conversions[1].rate, 100);
  assert.equal(r.dropouts.Enquiry, 1);
  assert.equal(report([], []).conversions[0].rate, null);
});
test("REST API fails safely and protects unauthenticated routes", async () => {
  const server = app.listen(0);
  try {
    const url = "http://127.0.0.1:" + server.address().port;
    for (const path of ["/api/prospects", "/api/reports", "/api/audit"])
      assert.equal((await fetch(url + path)).status, 401);
    const invalid = await fetch(url + "/api/enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(invalid.status, 422);
    const malformed = await fetch(url + "/api/enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.includes("SyntaxError"), false);
  } finally {
    server.close();
  }
});
test("cohort boundaries use actual timestamps and closure counts deduplicate reopened people", () => {
  const rows = [
    { id: "a", stage: "Closed", created_at: "2026-10-15T00:00:00+00:00" },
    { id: "b", stage: "Enquiry", created_at: "2026-10-16T00:00:00+00:00" },
  ];
  const history = [
    {
      prospect_id: "a",
      to_stage: "Enquiry",
      changed_at: "2026-10-15T00:00:00Z",
    },
    {
      prospect_id: "a",
      from_stage: "Enquiry",
      to_stage: "Closed",
      closed_reason: "No response",
      changed_at: "2026-10-16T00:00:00Z",
    },
    {
      prospect_id: "a",
      from_stage: "Closed",
      to_stage: "Enquiry",
      changed_at: "2026-10-17T00:00:00Z",
    },
    {
      prospect_id: "a",
      from_stage: "Enquiry",
      to_stage: "Closed",
      closed_reason: "Withdrawn",
      changed_at: "2026-10-18T00:00:00Z",
    },
  ];
  const r = report(rows, history, { from: "2026-10-15", to: "2026-10-15" });
  assert.equal(r.total, 1);
  assert.equal(r.funnel[0].closed, 1);
  assert.equal(r.funnel[0].avg_days, 1);
  assert.equal(r.closed_reasons.length, 2);
});
test("file signatures reject disguised uploads", async () => {
  const { validFile } = await import("../server/rules.js");
  assert.equal(validFile(Buffer.from("%PDF-1.7"), "application/pdf"), true);
  assert.equal(
    validFile(Buffer.from("<script>alert(1)</script>"), "application/pdf"),
    false,
  );
  assert.equal(
    validFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"),
    true,
  );
  assert.equal(validFile(Buffer.from("%PDF-1.7"), "image/jpeg"), false);
});
test("offer snapshots render to a PDF and email templates contain the correct portal route", async () => {
  const { offerPdf } = await import("../server/offer.js");
  const { emailMessage } = await import("../server/jobs.js");
  const bytes = await offerPdf({
    reference: "test-application",
    name: "Demo Student",
    program: "Demo course",
    intake: "February 2027",
    study_mode: "Online",
    issued_at: "2026-10-15",
    expires_at: "2026-10-29",
  });
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.length > 1000);
  const msg = emailMessage({
    template: "Document rejected",
    payload: {
      name: "Demo Student",
      document: "Transcript",
      reason: "Blurry image",
    },
  });
  assert.match(msg.text, /Blurry image/);
  assert.match(msg.text, /\/student/);
});
test("legacy withdrawal history remains a confirmed exit in v2 reports", () => {
  const r = report(
    [{ id: "old", stage: "Closed" }],
    [
      { prospect_id: "old", to_stage: "Enquiry" },
      { prospect_id: "old", from_stage: "Enquiry", to_stage: "Withdrawn" },
    ],
  );
  assert.equal(r.dropouts.Enquiry, 1);
  assert.equal(r.closed_reasons[0].reason, "Withdrawn");
});
