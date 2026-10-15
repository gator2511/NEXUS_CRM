// Explicit fictional demo adapter. Never used by the production REST API.
import {
  can,
  report,
  enquirySchema,
  stages,
  qualificationLevels,
  programAutomationSchema,
} from "../server/rules.js";
const uid = () => crypto.randomUUID(),
  now = () => new Date().toISOString();
export const demoPrograms = [
  "Diploma of Business",
  "Diploma of Information Technology",
  "Certificate III in Early Childhood Education and Care",
  "Diploma of Community Services",
].map((name, i) => ({
  id: `10000000-0000-4000-8000-00000000000${i + 1}`,
  name,
  min_qualification_level: 1,
  language_requirements: { IELTS: 6, PTE: 50, TOEFL: 60 },
  brochure_url: null,
}));
export function initialState() {
  const state = {
    prospects: [],
    history: [],
    audit: [],
    emails: [],
    documents: [],
    intakes: demoPrograms.map((g) => ({
      id: uid(),
      program_id: g.id,
      name: "February 2027 (demo)",
      start_date: "2027-02-22",
    })),
    types: demoPrograms.flatMap((g) =>
      [
        "Passport or photo ID",
        "Academic transcript",
        "English test result",
      ].map((name) => ({ id: uid(), program_id: g.id, name, required: true })),
    ),
    staff: [
      {
        id: "demo-staff",
        full_name: "Alex Morgan",
        role: "recruitment",
        active: true,
      },
    ],
  };
  for (const [i, name] of [
    "Amelia Wilson",
    "Oliver Chen",
    "Isabella Patel",
    "Noah Williams",
    "Mia Thompson",
    "Ethan Nguyen",
    "Ava Martin",
    "Lucas Brown",
  ].entries()) {
    const stage = stages[i % stages.length];
    const g = demoPrograms[i % 4];
    const p = {
      id: uid(),
      full_name: name,
      email:
        i === 0
          ? "student@example.com"
          : name.toLowerCase().replace(" ", ".") + "@example.com",
      phone: "040000000" + i,
      address: "10 Example Street, Demo City",
      assigned_staff_id: "demo-staff",
      cycle: 1,
      stage,
      closed_reason: stage === "Closed" ? "No response" : null,
      created_at: new Date(Date.now() - i * 86400000).toISOString(),
      stage_entered_at: now(),
      enquiries: [
        {
          id: uid(),
          program_id: g.id,
          programs: g,
          source: "Website",
          message: "Please send entry requirements and intake dates.",
          enquiry_date: now(),
        },
      ],
      applications: [],
      qualifications: [],
      followups: [],
      notes: [],
    };
    state.prospects.push(p);
    for (const s of stage === "Closed"
      ? ["Enquiry", "Closed"]
      : stages.slice(0, stages.indexOf(stage) + 1)) {
      state.history.push({
        id: uid(),
        prospect_id: p.id,
        from_stage:
          state.history.filter((h) => h.prospect_id === p.id).at(-1)
            ?.to_stage || null,
        to_stage: s,
        changed_at: p.created_at,
        closed_reason: p.closed_reason,
        cycle: 1,
      });
    }
    if (["Qualified", "Application", "Offer", "Enrolled"].includes(stage)) {
      const a = {
        id: uid(),
        program_id: g.id,
        programs: g,
        cycle: 1,
        status:
          stage === "Qualified"
            ? "Draft"
            : stage === "Application"
              ? "Submitted"
              : "Accepted",
        intake_id: state.intakes.find((i) => i.program_id === g.id).id,
        details: {},
        enrolments:
          stage === "Enrolled" ? [{ enrolment_date: p.created_at }] : [],
      };
      p.current_application_id = a.id;
      p.applications.push(a);
      if (["Offer", "Enrolled"].includes(stage))
        a.offer_snapshot = {
          reference: a.id,
          name: p.full_name,
          program: g.name,
          intake: "February 2027 (demo)",
          issued_at: now(),
          expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
        };
      a.offer_expires_at = a.offer_snapshot?.expires_at;
    }
    if (stage === "Qualification review")
      p.qualifications.push({
        id: uid(),
        cycle: 1,
        program_id: g.id,
        submitted_at: now(),
        auto_result: "Review",
        auto_reasons: ["English evidence needs review"],
        details: {
          highest_qualification: "Diploma",
          institution: "Demo College",
          year_completed: 2025,
          language_test_type: "None taken",
          intake_id: state.intakes.find((i) => i.program_id === g.id).id,
        },
      });
  }
  return state;
}
export function demoRequest(state, path, method, body = {}, profile) {
  const courses = (state.programs ||= structuredClone(demoPrograms));
  const addAudit = (p, action) =>
    state.audit.unshift({
      id: uid(),
      prospect_id: p.id,
      action,
      actor_type: profile?.role === "student" ? "student" : "staff",
      logged_at: now(),
      detail: body,
      staff_users: { full_name: profile?.full_name || "Public enquiry" },
    });
  const email = (p, template, extra = {}) =>
    state.emails.unshift({
      id: uid(),
      prospect_id: p.id,
      recipient: p.email,
      template,
      status: "Logged",
      attempts: 0,
      created_at: now(),
      payload: extra,
    });
  const stage = (p, target, reason) => {
    state.history.push({
      id: uid(),
      prospect_id: p.id,
      from_stage: p.stage,
      to_stage: target,
      closed_reason: reason,
      changed_at: now(),
      cycle: p.cycle,
    });
    p.stage = target;
    p.closed_reason = target === "Closed" ? reason : null;
    p.stage_entered_at = now();
    if (target === "Closed") {
      const a = p.applications.find((a) => a.id === p.current_application_id);
      if (a && a.status !== "Rejected") a.status = "Withdrawn";
      p.followups.forEach((f) => (f.completed = true));
    }
    addAudit(p, "Stage changed");
  };
  const task = (p, title, kind) => {
    if (!p.followups.some((t) => t.kind === kind && !t.completed))
      p.followups.push({
        id: uid(),
        title,
        kind,
        staff_id: p.assigned_staff_id,
        due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
        completed: false,
      });
  };
  const checklist = (p, a) =>
    state.types
      .filter(
        (t) =>
          t.program_id === a?.program_id &&
          !(
            t.name === "English test result" &&
            p.qualifications.find((q) => q.cycle === p.cycle)?.details
              .language_test_type === "None taken"
          ),
      )
      .map((t) => ({
        ...t,
        document:
          state.documents.find(
            (d) =>
              d.application_id === a.id &&
              d.document_type_id === t.id &&
              !["Uploading", "Superseded"].includes(d.status),
          ) || null,
      }));
  const createApplication = (p, gid, intake_id) => {
    const a = {
      id: uid(),
      program_id: gid,
      programs: courses.find((g) => g.id === gid),
      cycle: p.cycle,
      status: "Draft",
      intake_id,
      details: {},
      enrolments: [],
    };
    p.applications.push(a);
    p.current_application_id = a.id;
    return a;
  };
  if (/^\/programs\/[^/]+\/automation$/.test(path) && method === "POST") {
    if (!can(profile?.role, "users")) throw Error("Admin access required");
    const course = courses.find((g) => g.id === path.split("/")[2]);
    if (!course) throw Error("Program not found");
    Object.assign(course, programAutomationSchema.parse(body));
    return course;
  }
  if (path === "/programs") return courses;
  if (path === "/enquiries") {
    const input = enquirySchema.parse(body);
    let p = state.prospects.find((p) => p.email === input.email);
    const duplicate = !!p;
    if (!p) {
      p = {
        ...input,
        id: uid(),
        stage: "Enquiry",
        cycle: 1,
        stage_entered_at: now(),
        created_at: now(),
        assigned_staff_id: "demo-staff",
        enquiries: [],
        applications: [],
        qualifications: [],
        followups: [],
        notes: [],
      };
      state.prospects.unshift(p);
      state.history.push({
        prospect_id: p.id,
        to_stage: "Enquiry",
        changed_at: now(),
        cycle: 1,
      });
    } else if (p.stage === "Closed") {
      p.cycle++;
      p.current_application_id = null;
      stage(p, "Enquiry");
    }
    const id = uid();
    p.enquiries.unshift({
      ...input,
      id,
      programs: courses.find((g) => g.id === input.program_id),
      source: "Website",
      enquiry_date: now(),
      duplicate_flag: duplicate,
    });
    email(p, "Brochure");
    return {
      reference: id,
      message:
        "Enquiry received. Sign in to the demo student portal with " + p.email,
    };
  }
  if (!profile) throw Error("Sign in required");
  if (path === "/me") return profile;
  if (path.startsWith("/reports")) {
    if (!can(profile.role, "report")) throw Error("Forbidden");
    const params = new URLSearchParams(path.split("?")[1]);
    return report(state.prospects, state.history, Object.fromEntries(params));
  }
  if (path === "/staff") return state.staff;
  if (path === "/prospects") {
    if (!can(profile.role, "read")) throw Error("Forbidden");
    return structuredClone(state.prospects);
  }
  if (path === "/audit") {
    if (!can(profile.role, "audit")) throw Error("Forbidden");
    return state.audit;
  }
  if (path === "/emails") {
    if (!can(profile.role, "read")) throw Error("Forbidden");
    return state.emails;
  }
  if (path === "/jobs/run") {
    if (!can(profile.role, "jobs")) throw Error("Forbidden");
    let closed = 0,
      reminders = 0,
      escalated = 0;
    const remind = (p, template, key, extra = {}) => {
      if (state.emails.some((e) => e.dedupe_key === key)) return;
      email(p, template, extra);
      state.emails[0].dedupe_key = key;
      reminders++;
    };
    const elapsed = (d) => (Date.now() - Date.parse(d)) / 86400000;
    for (const p of state.prospects) {
      const a = p.applications.find((a) => a.id === p.current_application_id);
      const age = elapsed(p.stage_entered_at);
      const event = p.id + ":" + p.cycle;
      if (
        (p.stage === "Enquiry" && age >= 14) ||
        (p.stage === "Qualified" && age >= 30)
      ) {
        stage(p, "Closed", "No response");
        email(p, "Closed");
        closed++;
      } else if (
        (p.stage === "Enquiry" && age >= 3) ||
        (p.stage === "Qualified" && age >= 7)
      )
        remind(
          p,
          p.stage === "Enquiry" ? "Details reminder" : "Application reminder",
          event + ":" + p.stage,
        );
      else if (p.stage === "Offer" && a?.offer_expires_at) {
        if (Date.parse(a.offer_expires_at) <= Date.now()) {
          stage(p, "Closed", "Offer lapsed");
          email(p, "Offer lapsed");
          closed++;
        } else if (Date.parse(a.offer_expires_at) - Date.now() <= 7 * 86400000)
          remind(p, "Offer reminder", a.id + ":offer-reminder");
      } else if (p.stage === "Application") {
        const rejected = state.documents
          .filter((d) => d.application_id === a?.id && d.status === "Rejected")
          .sort(
            (a, b) => Date.parse(a.reviewed_at) - Date.parse(b.reviewed_at),
          )[0];
        if (rejected && elapsed(rejected.reviewed_at) >= 21) {
          stage(p, "Closed", "No response");
          email(p, "Closed");
          closed++;
        } else if (rejected && elapsed(rejected.reviewed_at) >= 5)
          remind(p, "Document reminder", rejected.id + ":reminder");
      }
      for (const f of p.followups.filter(
        (f) => !f.completed && !f.escalated_at,
      )) {
        const due = new Date(f.due_at);
        let n = 0;
        while (n < 2) {
          due.setUTCDate(due.getUTCDate() + 1);
          if (![0, 6].includes(due.getUTCDay())) n++;
        }
        if (due <= new Date()) {
          f.escalated_at = now();
          email(p, "Task escalation", { task: f.title });
          escalated++;
        }
      }
    }
    return { closed, reminders, escalated, delivery: { logged: reminders } };
  }
  if (path.startsWith("/applications/")) {
    if (!can(profile.role, "read")) throw Error("Forbidden");
    const aid = path.split("/")[2];
    const p = state.prospects.find((p) =>
      p.applications.some((a) => a.id === aid),
    );
    return p
      ? checklist(
          p,
          p.applications.find((a) => a.id === aid),
        )
      : [];
  }
  if (profile.role === "student") {
    const p = state.prospects.find((p) => p.email === profile.email);
    if (!p) throw Error("Submit an enquiry with this demo email first");
    const a = p.applications.find((a) => a.id === p.current_application_id);
    const q = p.qualifications.find((q) => q.cycle === p.cycle);
    const gid =
      (q?.submitted_at ? q.program_id : null) || p.enquiries[0].program_id;
    if (path === "/student")
      return structuredClone({
        prospect: {
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          stage: p.stage,
          closed_reason: p.closed_reason,
        },
        program: courses.find((g) => g.id === (a?.program_id || gid)),
        intakes: state.intakes.filter(
          (i) => i.program_id === (a?.program_id || gid),
        ),
        qualification: q || null,
        application: a || null,
        checklist: a ? checklist(p, a) : [],
        enrolment: a?.enrolments?.[0] || null,
      });
    const operation = path.split("/").at(-1);
    if (["qualification_draft", "qualification_submit"].includes(operation)) {
      if (p.stage !== "Enquiry") throw Error("Already submitted");
      const value = q || { id: uid(), cycle: p.cycle, program_id: gid };
      value.program_id = gid;
      value.details = body;
      if (!q) p.qualifications.push(value);
      if (operation === "qualification_submit") {
        if (
          !body.institution ||
          !body.highest_qualification ||
          !body.year_completed ||
          !body.language_test_type ||
          !body.intake_id ||
          (body.language_test_type !== "None taken" &&
            (body.language_score == null || !body.test_date))
        )
          throw Error("Complete all academic and language fields");
        stage(p, "Qualification review");
        const course = courses.find((g) => g.id === gid);
        const threshold =
          course?.language_requirements?.[body.language_test_type];
        const academicFail =
          qualificationLevels.indexOf(body.highest_qualification) + 1 <
          course?.min_qualification_level;
        const margin = body.language_test_type === "IELTS" ? 0.5 : 5;
        value.auto_result = academicFail
          ? "Fail"
          : threshold == null || !course?.min_qualification_level
            ? "Review"
            : body.language_score >= threshold
              ? "Pass"
              : body.language_score >= threshold - margin
                ? "Review"
                : "Fail";
        value.submitted_at = now();
        value.auto_reasons = [
          value.auto_result === "Pass"
            ? "All configured entry criteria met"
            : academicFail
              ? "Academic qualification is below the program minimum"
              : "English evidence requires staff review",
        ];
        if (value.auto_result === "Pass") {
          stage(p, "Qualified");
          createApplication(p, gid, body.intake_id);
          email(p, "Qualified");
        } else {
          task(p, "Review qualification", "Qualification");
          email(p, "Qualification review");
        }
      }
    } else if (
      ["application_draft", "application_submit"].includes(operation)
    ) {
      if (p.stage !== "Qualified") throw Error("Application cannot be edited");
      const current = a || createApplication(p, gid, null);
      if (operation === "application_submit") {
        if (
          [
            "date_of_birth",
            "nationality",
            "emergency_contact_name",
            "emergency_contact_phone",
            "study_mode",
            "intake_id",
          ].some((k) => !body[k])
        )
          throw Error("Complete every application field");
        if (checklist(p, current).some((c) => c.required && !c.document))
          throw Error("Upload every required document");
        current.status = "Submitted";
        current.submitted_date = now();
        stage(p, "Application");
        task(p, "Verify documents", "Documents");
        email(p, "Application received");
      }
      current.details = body;
      current.intake_id = body.intake_id;
    } else if (path === "/uploads/prepare") {
      if (!a) throw Error("Save application details first");
      const entry = checklist(p, a).find((t) => t.id === body.document_type_id);
      if (
        !entry ||
        !(
          p.stage === "Qualified" ||
          (p.stage === "Application" && entry.document?.status === "Rejected")
        )
      )
        throw Error("Upload is not allowed");
      const id = uid();
      state.documents.push({
        ...body,
        id,
        application_id: a.id,
        status: "Uploading",
      });
      return { id, path: id, token: "demo" };
    } else if (path.startsWith("/uploads/") && operation === "complete") {
      const d = state.documents.find(
        (d) => d.id === path.split("/")[2] && d.application_id === a?.id,
      );
      if (!d) throw Error("Upload not found");
      state.documents
        .filter(
          (x) =>
            x.id !== d.id &&
            x.application_id === a.id &&
            x.document_type_id === d.document_type_id,
        )
        .forEach((x) => (x.status = "Superseded"));
      d.status = "Pending";
      if (p.stage === "Application")
        task(p, "Verify replacement documents", "Documents");
    } else if (operation === "offer_accept") {
      if (p.stage === "Enrolled") return { ok: true };
      if (p.stage !== "Offer" || new Date(a.offer_expires_at) <= new Date())
        throw Error("No valid offer");
      a.enrolments = [{ enrolment_date: now() }];
      stage(p, "Enrolled");
      email(p, "Enrolment confirmation");
    } else if (operation === "offer_decline") {
      if (p.stage !== "Offer") throw Error("No open offer");
      stage(p, "Closed", "Offer declined");
    } else if (operation === "withdraw") {
      if (["Enrolled", "Closed"].includes(p.stage))
        throw Error("Cannot withdraw");
      stage(p, "Closed", "Withdrawn");
    } else throw Error("Unknown student action");
    addAudit(p, operation);
    return { ok: true };
  }
  if (!can(profile.role, "write")) throw Error("Forbidden");
  const [, , id, operation] = path.split("/");
  const p = state.prospects.find((p) => p.id === id);
  if (!p) throw Error("Prospect not found");
  const a = p.applications.find((a) => a.id === p.current_application_id);
  if (operation === "update") Object.assign(p, body);
  else if (operation === "qualification_decision") {
    if (p.stage !== "Qualification review") throw Error("Not awaiting review");
    const q = p.qualifications.find((q) => q.cycle === p.cycle);
    if (body.decision === "approve") {
      stage(p, "Qualified");
      createApplication(p, q.program_id, q.details.intake_id);
      email(p, "Qualified");
    } else {
      if (!body.note) throw Error("Reason required");
      stage(p, "Closed", "Not eligible");
      email(p, "Not eligible");
    }
    q.decision = body.decision;
    q.review_note = body.note;
    p.followups
      .filter((f) => f.kind === "Qualification")
      .forEach((f) => (f.completed = true));
  } else if (operation === "document_review") {
    const d = state.documents.find(
      (d) => d.id === body.document_id && d.application_id === a?.id,
    );
    if (p.stage !== "Application" || d?.status !== "Pending")
      throw Error("Not ready for review");
    if (body.status === "Rejected" && !body.note)
      throw Error("Reason required");
    Object.assign(d, {
      status: body.status,
      rejection_reason: body.note,
      reviewed_at: now(),
    });
    a.status = "Under Review";
    if (body.status === "Rejected") email(p, "Document rejected");
    if (
      !state.documents.some(
        (d) => d.application_id === a.id && d.status === "Pending",
      )
    )
      p.followups
        .filter((f) => f.kind === "Documents")
        .forEach((f) => (f.completed = true));
    if (
      checklist(p, a).every(
        (c) => !c.required || c.document?.status === "Verified",
      )
    )
      task(p, "Decide application", "Decision");
  } else if (operation === "application_decision") {
    if (p.stage !== "Application") throw Error("Not ready for decision");
    if (body.decision === "accept") {
      if (
        checklist(p, a).some(
          (c) => c.required && c.document?.status !== "Verified",
        )
      )
        throw Error("Verify all required documents");
      a.status = "Accepted";
      a.offer_expires_at = new Date(Date.now() + 14 * 86400000).toISOString();
      a.offer_snapshot = {
        reference: a.id,
        name: p.full_name,
        program: a.programs.name,
        intake: state.intakes.find((i) => i.id === a.intake_id)?.name,
        study_mode: a.details.study_mode,
        issued_at: now(),
        expires_at: a.offer_expires_at,
      };
      stage(p, "Offer");
      p.followups.forEach((f) => (f.completed = true));
      email(p, "Offer");
    } else {
      if (!body.note) throw Error("Reason required");
      a.status = "Rejected";
      stage(p, "Closed", "Application rejected");
      email(p, "Application rejected");
    }
  } else if (operation === "close") stage(p, "Closed", body.reason);
  else if (operation === "note")
    p.notes.unshift({ id: uid(), body: body.body, created_at: now() });
  else if (operation === "followup")
    p.followups.push({
      id: uid(),
      ...body,
      staff_id: p.assigned_staff_id,
      completed: false,
    });
  else if (operation === "complete_followup") {
    const f = p.followups.find((f) => f.id === body.followup_id);
    if (!f) throw Error("Follow-up missing");
    f.completed = true;
  } else throw Error("Unknown operation");
  addAudit(p, operation);
  return { ok: true };
}
