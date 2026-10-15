import express from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  can,
  programAutomationSchema,
  enquirySchema,
  report,
  staffActions,
  studentActions,
  fileTypes,
  validFile,
} from "./rules.js";
import { database, serviceDatabase, check, wrap } from "./db.js";
import { offerPdf } from "./offer.js";
import { runJobs, dispatchEmails } from "./jobs.js";
export const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
  next();
});
app.use(express.json({ limit: "64kb" }));
app.get("/api/health", (req, res) =>
  res.json({
    status: "ok",
    configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    workflow_service: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  }),
);
app.get(
  "/api/programs",
  wrap(async (req, res) =>
    res.json(
      check(
        await database()
          .from("programs")
          .select("*")
          .eq("active", true)
          .order("name"),
      ),
    ),
  ),
);
async function reply(res, value, status = 200) {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY)
    await dispatchEmails().catch(() => {});
  return res.status(status).json(value);
}
app.post(
  "/api/enquiries",
  wrap(async (req, res) => {
    const input = enquirySchema.parse(req.body);
    return reply(
      res,
      check(await database().rpc("submit_enquiry", { input })),
      201,
    );
  }),
);
app.get(
  "/api/cron",
  wrap(async (req, res) => {
    const supplied = req.headers.authorization || "";
    const expected = "Bearer " + (process.env.CRON_SECRET || "");
    if (
      !process.env.CRON_SECRET ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      return res.status(401).json({ error: "Unauthorized" });
    res.json(await runJobs());
  }),
);
app.use(
  "/api",
  wrap(async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ error: "Sign in required" });
    req.db = database(token);
    const { data, error } = await req.db.auth.getUser(token);
    if (error || !data.user)
      return res.status(401).json({ error: "Session expired" });
    req.user = data.user;
    const result = await req.db
      .from("staff_users")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();
    if (result.error)
      throw Object.assign(Error("Unable to verify account access"), {
        status: 403,
      });
    req.profile = result.data;
    if (req.profile && !req.profile.active)
      return res.status(403).json({ error: "Account disabled" });
    next();
  }),
);
const permit = (p) => (req, res, next) =>
  can(req.profile?.role, p)
    ? next()
    : res
        .status(403)
        .json({ error: "You do not have permission for this action" });
app.get("/api/me", (req, res) =>
  req.profile
    ? res.json(req.profile)
    : res.status(403).json({ error: "Staff access required" }),
);
app.get(
  "/api/student",
  wrap(async (req, res) =>
    res.json(check(await req.db.rpc("student_workspace"))),
  ),
);
app.post(
  "/api/student/:action",
  wrap(async (req, res) => {
    const schema = studentActions[req.params.action];
    if (!schema)
      return res.status(404).json({ error: "Unknown student action" });
    await reply(
      res,
      check(
        await req.db.rpc("student_action", {
          operation: req.params.action,
          input: schema.parse(req.body),
        }),
      ),
    );
  }),
);
app.post(
  "/api/uploads/prepare",
  wrap(async (req, res) => {
    if (req.profile)
      return res.status(403).json({ error: "Student access required" });
    const input = z
      .object({
        document_type_id: z.uuid(),
        file_name: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .transform((v) =>
            v
              .split(/[\\/]/)
              .pop()
              .replace(/[^\p{L}\p{N} ._()-]/gu, ""),
          ),
        mime_type: z.enum(fileTypes),
        size_bytes: z.number().int().min(1).max(10485760),
      })
      .parse(req.body);
    const ticket = check(
      await req.db.rpc("student_action", {
        operation: "document_prepare",
        input,
      }),
    );
    const signed = check(
      await req.db.storage
        .from("nexus-documents")
        .createSignedUploadUrl(ticket.path),
    );
    res.json({ ...ticket, token: signed.token });
  }),
);
app.post(
  "/api/uploads/:id/complete",
  wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    if (req.profile)
      return res.status(403).json({ error: "Student access required" });
    const d = check(
      await req.db
        .from("documents")
        .select("*")
        .eq("id", id)
        .eq("student_id", req.user.id)
        .single(),
    );
    const file = check(
      await req.db.storage.from("nexus-documents").download(d.storage_path),
    );
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length !== d.size_bytes || !validFile(buffer, d.mime_type))
      return res.status(422).json({
        error:
          "File content does not match its declared PDF/JPG/PNG format or size",
      });
    res.json(
      check(
        await serviceDatabase().rpc("finalize_document", {
          did: id,
          owner_uuid: req.user.id,
        }),
      ),
    );
  }),
);
app.get(
  "/api/documents/:id",
  wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const d = check(
      await req.db.from("documents").select("*").eq("id", id).single(),
    );
    if (["Uploading", "Superseded"].includes(d.status))
      return res.status(403).json({ error: "Document is not available" });
    const signed = check(
      await req.db.storage
        .from("nexus-documents")
        .createSignedUrl(d.storage_path, 60, { download: d.file_name }),
    );
    res.json({ url: signed.signedUrl });
  }),
);
app.get(
  "/api/offers/:id/pdf",
  wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    let a;
    if (can(req.profile?.role, "read"))
      a = check(
        await req.db.from("applications").select("*").eq("id", id).single(),
      );
    else {
      const workspace = check(await req.db.rpc("student_workspace"));
      if (workspace.application?.id !== id)
        return res.status(403).json({ error: "Offer not available" });
      a = workspace.application;
    }
    if (!a.offer_snapshot)
      return res.status(404).json({ error: "No offer letter" });
    const buffer = await offerPdf(a.offer_snapshot);
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="RIC-offer.pdf"',
      })
      .send(buffer);
  }),
);
app.get(
  "/api/staff",
  permit("read"),
  wrap(async (req, res) => {
    let q = req.db.from("staff_users").select("id,full_name,role,active");
    if (req.profile.role !== "admin") q = q.eq("active", true);
    res.json(check(await q));
  }),
);
app.get(
  "/api/prospects",
  permit("read"),
  wrap(async (req, res) =>
    res.json(
      check(
        await req.db
          .from("prospects")
          .select(
            "*,enquiries(*,programs(name)),applications:applications!applications_prospect_id_fkey(*,programs(name),enrolments(*)),qualifications(*),followups(*),notes(*)",
          )
          .order("created_at", { ascending: false }),
      ),
    ),
  ),
);
app.get(
  "/api/applications/:id/checklist",
  permit("read"),
  wrap(async (req, res) => {
    const a = check(
      await req.db
        .from("applications")
        .select("id,program_id,prospect_id,cycle")
        .eq("id", z.uuid().parse(req.params.id))
        .single(),
    );
    const types = check(
      await req.db
        .from("document_types")
        .select("*")
        .eq("program_id", a.program_id),
    );
    const docs = check(
      await req.db
        .from("documents")
        .select("*")
        .eq("application_id", a.id)
        .in("status", ["Pending", "Verified", "Rejected"]),
    );
    const q = check(
      await req.db
        .from("qualifications")
        .select("details")
        .eq("prospect_id", a.prospect_id)
        .eq("cycle", a.cycle)
        .maybeSingle(),
    );
    res.json(
      types
        .filter(
          (t) =>
            !(
              t.name === "English test result" &&
              q?.details.language_test_type === "None taken"
            ),
        )
        .map((t) => ({
          ...t,
          document: docs.find((d) => d.document_type_id === t.id) || null,
        })),
    );
  }),
);
app.get(
  "/api/audit",
  permit("audit"),
  wrap(async (req, res) =>
    res.json(
      check(
        await req.db
          .from("audit_log")
          .select("*,staff_users(full_name)")
          .order("logged_at", { ascending: false })
          .limit(500),
      ),
    ),
  ),
);
app.get(
  "/api/emails",
  permit("read"),
  wrap(async (req, res) =>
    res.json(
      check(
        await req.db
          .from("email_outbox")
          .select(
            "id,prospect_id,recipient,template,status,attempts,created_at,sent_at,last_error",
          )
          .order("created_at", { ascending: false })
          .limit(200),
      ),
    ),
  ),
);
app.get(
  "/api/reports",
  permit("report"),
  wrap(async (req, res) => {
    const dates = z
      .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
      .parse(req.query);
    if (dates.from && dates.to && dates.from > dates.to)
      return res
        .status(422)
        .json({ error: "Start date must precede end date" });
    const data = check(await req.db.rpc("recruitment_report"));
    res.json(report(data.prospects, data.history, dates));
  }),
);
app.post(
  "/api/jobs/run",
  permit("jobs"),
  wrap(async (req, res) => res.json(await runJobs())),
);
app.post(
  "/api/prospects/:id/:action",
  permit("write"),
  wrap(async (req, res) => {
    const schema = staffActions[req.params.action];
    if (!schema) return res.status(404).json({ error: "Unknown action" });
    await reply(
      res,
      check(
        await req.db.rpc("crm_action", {
          prospect_uuid: z.uuid().parse(req.params.id),
          operation: req.params.action,
          input: schema.parse(req.body),
        }),
      ),
    );
  }),
);
app.post(
  "/api/programs/:id/automation",
  permit("users"),
  wrap(async (req, res) =>
    res.json(
      check(
        await req.db.rpc("configure_program", {
          program_uuid: z.uuid().parse(req.params.id),
          input: programAutomationSchema.parse(req.body),
        }),
      ),
    ),
  ),
);
app.post(
  "/api/staff/:id",
  permit("users"),
  wrap(async (req, res) =>
    res.json(
      check(
        await req.db.rpc("manage_staff", {
          staff_uuid: z.uuid().parse(req.params.id),
          input: z
            .object({
              role: z.enum([
                "recruitment",
                "administration",
                "management",
                "admin",
              ]),
              active: z.boolean(),
            })
            .parse(req.body),
        }),
      ),
    ),
  ),
);
app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) =>
  res.status(err instanceof z.ZodError ? 422 : err.status || 500).json({
    error:
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : err.type === "entity.parse.failed"
          ? "Invalid JSON request"
          : err.status
            ? err.message
            : "An unexpected error occurred. Please try again.",
  }),
);
