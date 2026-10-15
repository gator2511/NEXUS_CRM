import { z } from "zod";
export const stages = [
  "Enquiry",
  "Qualification review",
  "Qualified",
  "Application",
  "Offer",
  "Enrolled",
  "Closed",
];
export const activeStages = stages.slice(0, 6);
export const closureReasons = [
  "No response",
  "Not eligible",
  "Application rejected",
  "Offer declined",
  "Offer lapsed",
  "Withdrawn",
];
export const permissions = {
  recruitment: ["read", "write", "report", "audit"],
  administration: ["read", "write", "report", "audit"],
  management: ["report", "jobs"],
  admin: ["read", "write", "report", "audit", "users", "jobs"],
};
export function can(role, permission) {
  return permissions[role]?.includes(permission) ?? false;
}
export const enquirySchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d ()-]{7,25}$/)
    .transform((v) => v.replace(/[ ()-]/g, "")),
  address: z.string().trim().min(5).max(500),
  program_id: z.uuid(),
  message: z.string().trim().max(2000).default(""),
  consent: z.literal(true),
});
export const qualificationLevels = [
  "Year 12 or equivalent",
  "Certificate",
  "Diploma",
  "Bachelor degree",
  "Master degree or higher",
];
export const languageTests = ["IELTS", "PTE", "TOEFL", "None taken"];
export const studyModes = ["On campus", "Online", "Blended"];
export const qualificationSchema = z.object({
  highest_qualification: z.enum(qualificationLevels).optional(),
  institution: z.string().trim().max(150).optional(),
  year_completed: z
    .number()
    .int()
    .min(1970)
    .max(new Date().getFullYear())
    .optional(),
  result: z.string().trim().max(100).optional(),
  language_test_type: z.enum(languageTests).optional(),
  language_score: z.number().min(0).max(120).optional(),
  test_date: z.iso.date().optional(),
  intake_id: z.uuid().optional(),
});
export const applicationSchema = z.object({
  date_of_birth: z.iso.date().optional(),
  nationality: z.string().trim().max(60).optional(),
  emergency_contact_name: z.string().trim().max(120).optional(),
  emergency_contact_phone: z
    .string()
    .regex(/^\+?[\d ()-]{7,25}$/)
    .optional(),
  study_mode: z.enum(studyModes).optional(),
  intake_id: z.uuid().optional(),
});
export const staffActions = {
  update: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    phone: z.string().regex(/^\+?[\d ()-]{7,25}$/),
    address: z.string().trim().min(5).max(500),
    assigned_staff_id: z.uuid().nullable(),
  }),
  qualification_decision: z.object({
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(1000).default(""),
  }),
  document_review: z.object({
    document_id: z.uuid(),
    status: z.enum(["Verified", "Rejected"]),
    note: z.string().trim().max(500).default(""),
  }),
  application_decision: z.object({
    decision: z.enum(["accept", "reject"]),
    note: z.string().trim().max(1000).default(""),
  }),
  close: z.object({ reason: z.enum(closureReasons) }),
  note: z.object({ body: z.string().trim().min(1).max(2000) }),
  followup: z.object({
    title: z.string().trim().min(1).max(200),
    due_at: z.iso.datetime(),
  }),
  complete_followup: z.object({ followup_id: z.uuid() }),
};
export const studentActions = {
  qualification_draft: qualificationSchema,
  qualification_submit: qualificationSchema,
  application_draft: applicationSchema,
  application_submit: applicationSchema,
  offer_accept: z.object({}),
  offer_decline: z.object({}),
  withdraw: z.object({}),
};
export function transitionAllowed(from, to) {
  return (
    {
      Enquiry: ["Qualification review", "Closed"],
      "Qualification review": ["Qualified", "Closed"],
      Qualified: ["Application", "Closed"],
      Application: ["Offer", "Closed"],
      Offer: ["Enrolled", "Closed"],
      Closed: ["Enquiry"],
    }[from]?.includes(to) ?? false
  );
}
// All-time/cohort-by-creation unique prospect counts; residence time includes completed visits only.
export function report(rows, history, { from, to } = {}) {
  const selected = rows.filter(
    (p) =>
      (!from || Date.parse(p.created_at) >= Date.parse(from)) &&
      (!to || Date.parse(p.created_at) < Date.parse(to) + 86400000),
  );
  const ids = new Set(selected.map((p) => p.id));
  const h = history
    .filter((x) => ids.has(x.prospect_id))
    .map((x) =>
      x.to_stage === "Withdrawn"
        ? { ...x, to_stage: "Closed", closed_reason: "Withdrawn" }
        : x,
    );
  const counts = Object.fromEntries(
    stages.map((s) => [s, selected.filter((p) => p.stage === s).length]),
  );
  const reached = Object.fromEntries(
    stages.map((s) => [
      s,
      new Set(h.filter((x) => x.to_stage === s).map((x) => x.prospect_id)).size,
    ]),
  );
  const residence = {};
  const visits = new Map();
  for (const x of [...h].sort(
    (a, b) => new Date(a.changed_at) - new Date(b.changed_at),
  )) {
    const prev = visits.get(x.prospect_id);
    if (prev && prev.to_stage !== "Closed") {
      const days =
        (Date.parse(x.changed_at) - Date.parse(prev.changed_at)) / 86400000;
      if (Number.isFinite(days)) (residence[prev.to_stage] ??= []).push(days);
    }
    visits.set(x.prospect_id, x);
  }
  const closedReasons = [];
  for (const s of activeStages)
    for (const reason of new Set(
      h
        .filter((x) => x.from_stage === s && x.to_stage === "Closed")
        .map((x) => x.closed_reason || "Legacy closure"),
    )) {
      closedReasons.push({
        stage: s,
        reason,
        count: new Set(
          h
            .filter(
              (x) =>
                x.from_stage === s &&
                x.to_stage === "Closed" &&
                (x.closed_reason || "Legacy closure") === reason,
            )
            .map((x) => x.prospect_id),
        ).size,
      });
    }
  const funnel = activeStages.map((s, i) => {
    const exited = new Set(
      h
        .filter((x) => x.from_stage === s && x.to_stage === "Closed")
        .map((x) => x.prospect_id),
    ).size;
    return {
      stage: s,
      entered: reached[s],
      current: counts[s],
      closed: exited,
      moved_on: new Set(
        h
          .filter(
            (x) => x.from_stage === s && x.to_stage === activeStages[i + 1],
          )
          .map((x) => x.prospect_id),
      ).size,
      drop_off_rate: reached[s]
        ? Math.round((exited / reached[s]) * 1000) / 10
        : null,
      avg_days: residence[s]?.length
        ? Math.round(
            (residence[s].reduce((a, b) => a + b, 0) / residence[s].length) *
              10,
          ) / 10
        : null,
    };
  });
  return {
    counts,
    total: selected.length,
    reached,
    conversions: activeStages.slice(0, -1).map((s, i) => ({
      from: s,
      to: activeStages[i + 1],
      reached: reached[s],
      converted: reached[activeStages[i + 1]],
      rate: reached[s]
        ? Math.round((reached[activeStages[i + 1]] / reached[s]) * 100)
        : null,
    })),
    dropouts: Object.fromEntries(
      funnel.filter((f) => f.closed).map((f) => [f.stage, f.closed]),
    ),
    funnel,
    closed_reasons: closedReasons,
    biggest_leak:
      [...funnel].sort((a, b) => b.closed - a.closed).find((f) => f.closed > 0)
        ?.stage || null,
  };
}
export const fileTypes = ["application/pdf", "image/jpeg", "image/png"];
export function validFile(buffer, type) {
  const sig = {
    "application/pdf": [37, 80, 68, 70, 45],
    "image/jpeg": [255, 216, 255],
    "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
  }[type];
  return !!sig && sig.every((v, i) => buffer[i] === v);
}
