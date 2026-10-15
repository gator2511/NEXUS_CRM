import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  GitBranch,
  ClipboardList,
  GraduationCap,
  ChartNoAxesCombined,
  History,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ChevronRight,
  LogOut,
  Mail,
  Phone,
  MapPin,
  Check,
  Menu,
  Calendar,
  ShieldCheck,
  Download,
  FileCheck,
  Send,
} from "lucide-react";
import {
  request,
  supabase,
  demo,
  resetDemo,
  downloadDocument,
  downloadOffer,
} from "./data";
import { can, stages, activeStages, closureReasons } from "../server/rules";
import {
  Alert,
  Empty,
  Modal,
  Field,
  ContactFields,
  EnquiryForm,
  fmt,
  initials,
  formObject,
  Badge,
  exportCsv,
} from "./ui";
export default function StaffApp() {
  const [profile, setProfile] = useState(null),
    [page, setPage] = useState("Dashboard"),
    [prospects, setProspects] = useState([]),
    [programs, setPrograms] = useState([]),
    [staff, setStaff] = useState([]),
    [audit, setAudit] = useState([]),
    [emails, setEmails] = useState([]),
    [stats, setStats] = useState(null),
    [selected, setSelected] = useState(null),
    [checklist, setChecklist] = useState([]),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All stages"),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState(null),
    [dates, setDates] = useState({}),
    [allTasks, setAllTasks] = useState(false);
  const current = prospects.find((p) => p.id === selected);
  const application = current?.applications.find(
    (a) => a.id === current.current_application_id,
  );
  const qualification = current?.qualifications?.find(
    (q) => q.cycle === current.cycle,
  );
  async function refresh(who = profile, range = dates) {
    const pr = await request("/programs");
    setPrograms(pr);
    if (who) {
      setStats(
        await request(
          "/reports?" + new URLSearchParams(range),
          "GET",
          null,
          who,
        ),
      );
      if (can(who.role, "read")) {
        setProspects(await request("/prospects", "GET", null, who));
        setStaff(await request("/staff", "GET", null, who));
        setEmails(await request("/emails", "GET", null, who));
      }
      if (can(who.role, "audit"))
        setAudit(await request("/audit", "GET", null, who));
    }
  }
  async function run(fn, message) {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      if (message) setNotice(message);
      return result ?? true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    request("/programs")
      .then(setPrograms)
      .catch((e) => setError(e.message));
    if (!demo && supabase) {
      supabase.auth.getSession().then(async ({ data }) => {
        if (data.session) {
          try {
            const p = await request("/me");
            setProfile(p);
            if (p.role === "management") setPage("Reports");
            await refresh(p);
          } catch (e) {
            setError(e.message);
          }
        }
      });
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        if (!session) setProfile(null);
      });
      return () => subscription.unsubscribe();
    }
  }, []);
  useEffect(() => {
    setChecklist([]);
    if (application && profile)
      request(
        "/applications/" + application.id + "/checklist",
        "GET",
        null,
        profile,
      )
        .then(setChecklist)
        .catch((e) => setError(e.message));
  }, [application, profile]);
  async function login(e) {
    e.preventDefault();
    const f = formObject(e.currentTarget);
    await run(async () => {
      let p;
      if (demo)
        p = { id: "demo-staff", full_name: "Alex Morgan", role: f.role };
      else {
        if (!supabase)
          throw Error(
            "Configure Supabase environment variables before signing in",
          );
        const { error } = await supabase.auth.signInWithPassword({
          email: f.email,
          password: f.password,
        });
        if (error) throw Error("Sign-in failed. Check your credentials.");
        p = await request("/me");
      }
      setProfile(p);
      setPage(p.role === "management" ? "Reports" : "Dashboard");
      await refresh(p);
    });
  }
  async function act(id, operation, body) {
    return run(async () => {
      await request(
        "/prospects/" + id + "/" + operation,
        "POST",
        body,
        profile,
      );
      await refresh();
      setModal(null);
    }, "Changes saved");
  }
  const alert = (
    <Alert
      error={error}
      notice={notice}
      dismiss={() => {
        setError("");
        setNotice("");
      }}
    />
  );
  const nav = [
    ["Dashboard", LayoutDashboard, "read"],
    ["Prospects", Users, "read"],
    ["Pipeline", GitBranch, "read"],
    ["Enquiries", Mail, "read"],
    ["Applications", ClipboardList, "read"],
    ["Offers", FileCheck, "read"],
    ["Enrolments", GraduationCap, "read"],
    ["Follow-ups", Calendar, "read"],
    ["Email log", Send, "read"],
    ["Reports", ChartNoAxesCombined, "report"],
    ["Audit log", History, "audit"],
    ["Settings", Settings, "report"],
  ];
  const tasks = prospects
    .flatMap((p) =>
      p.followups
        .filter(
          (f) =>
            !f.completed &&
            (allTasks ||
              f.staff_id === profile?.id ||
              profile?.role === "admin"),
        )
        .map((f) => ({ ...f, prospect: p })),
    )
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const filtered = prospects.filter(
    (p) =>
      (filter === "All stages" || p.stage === filter) &&
      (p.full_name + " " + p.email + " " + p.phone)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  if (!profile)
    return (
      <div className="login">
        <section className="login-story">
          <b className="brand">
            <span>N</span> NEXUS CRM
          </b>
          <div>
            <p className="eyebrow">RIC · STUDENT RECRUITMENT</p>
            <h1>
              Every journey.
              <br />
              Every opportunity.
              <br />
              <em>Connected.</em>
            </h1>
            <p>
              One workspace for your entire recruitment cycle.
              <br />
              From the first hello to a new beginning.
            </p>
          </div>
          <small>QUALIFICATION · APPLICATIONS · OFFERS · ENROLMENTS</small>
        </section>
        <section className="login-form">
          <div>
            <Badge value="STAFF WORKSPACE" />
            <h2>Welcome to Nexus</h2>
            <p className="muted">Sign in to manage student recruitment.</p>
            {alert}
            <form onSubmit={login}>
              {demo ? (
                <>
                  <div className="alert">
                    Fictional browser-local demonstration. No real
                    authentication or email delivery.
                  </div>
                  <label>
                    Explore as
                    <select name="role">
                      <option value="recruitment">Recruitment staff</option>
                      <option value="administration">
                        Administration staff
                      </option>
                      <option value="management">
                        RIC management (reports & automation)
                      </option>
                      <option value="admin">Administrator</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <Field
                    label="Email"
                    name="email"
                    type="email"
                    required
                    autoComplete="username"
                  />
                  <Field
                    label="Password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                </>
              )}
              <button disabled={busy} className="primary full">
                {busy ? "Signing in…" : "Open workspace"}{" "}
                <ArrowUpRight size={16} />
              </button>
            </form>
            <div className="auth-links">
              <Link to="/enquiry">Submit an enquiry</Link>
              <Link to="/student">Student portal</Link>
            </div>
            <small className="muted">
              <ShieldCheck size={14} /> Protected staff access · Role-based
              permissions
            </small>
          </div>
        </section>
      </div>
    );
  const runChecks = () =>
    run(async () => {
      const result = await request("/jobs/run", "POST", {}, profile);
      await refresh();
      setNotice(
        `Checks complete: ${result.reminders} reminder(s) queued, ${result.closed} closed, ${result.escalated} escalated. Delivery: ${JSON.stringify(result.delivery)}`,
      );
    });
  return (
    <div className="app">
      <aside className={mobile ? "open" : ""}>
        <b className="brand">
          <span>N</span> NEXUS <small>CRM</small>
        </b>
        <div className="workspace">
          RIC Recruitment <span>WORKSPACE</span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {nav
            .filter((n) => can(profile.role, n[2]))
            .map(([name, Icon]) => (
              <button
                key={name}
                className={page === name && !current ? "active" : ""}
                onClick={() => {
                  setPage(name);
                  setSelected(null);
                  setMobile(false);
                }}
              >
                <Icon size={18} />
                {name}
                {name === "Follow-ups" && tasks.length > 0 && (
                  <small>{tasks.length}</small>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user">
            <span className="avatar">{initials(profile.full_name)}</span>
            <div>
              <b>{profile.full_name}</b>
              <small>{profile.role}</small>
            </div>
            <button
              title="Sign out"
              onClick={async () => {
                if (!demo) await supabase.auth.signOut();
                setProfile(null);
                setSelected(null);
                setProspects([]);
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-button"
            aria-label="Open menu"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <b>{current ? "Prospect details" : page}</b>
          </div>
          <div className="top-right">
            {demo && <span className="demo-pill">FICTIONAL DEMO</span>}
            <Link to="/student">Student portal</Link>
            <span className="avatar small">{initials(profile.full_name)}</span>
          </div>
        </header>
        <div className="content">
          {alert}
          {current ? (
            <>
              <button className="text" onClick={() => setSelected(null)}>
                ← Back to {page.toLowerCase()}
              </button>
              <div className="page-head">
                <div className="profile-title">
                  <span className="avatar large">
                    {initials(current.full_name)}
                  </span>
                  <div>
                    <h1>{current.full_name}</h1>
                    <p>
                      {current.email} · Attempt {current.cycle} · Created{" "}
                      {fmt(current.created_at)}
                    </p>
                  </div>
                </div>
                <button
                  disabled={busy}
                  onClick={() => setModal({ type: "edit", p: current })}
                >
                  Edit prospect
                </button>
              </div>
              <div className="detail-grid">
                <section className="card">
                  <h3>Recruitment journey</h3>
                  <div className="journey">
                    {activeStages.map((s, i) => (
                      <div
                        key={s}
                        className={
                          activeStages.indexOf(current.stage) >= i ? "done" : ""
                        }
                      >
                        <span>{i + 1}</span>
                        <small>{s}</small>
                      </div>
                    ))}
                  </div>
                  <Badge value={current.stage} />
                  {current.closed_reason && (
                    <p>Closed: {current.closed_reason}</p>
                  )}
                  <h3>Contact information</h3>
                  <p>
                    <Mail size={15} />
                    {current.email}
                  </p>
                  <p>
                    <Phone size={15} />
                    {current.phone}
                  </p>
                  <p>
                    <MapPin size={15} />
                    {current.address}
                  </p>
                  <p className="muted">
                    Assigned to{" "}
                    {staff.find((s) => s.id === current.assigned_staff_id)
                      ?.full_name || "Unassigned"}
                  </p>
                  <p className="muted">
                    Student account:{" "}
                    {current.student_id ? "Linked" : "Awaiting verified signup"}
                  </p>
                  <h3>Enquiries</h3>
                  {current.enquiries.map((e) => (
                    <div className="entry" key={e.id}>
                      <b>{e.programs?.name}</b>
                      <p>{e.message}</p>
                      <small>
                        {fmt(e.enquiry_date)} · {e.source}{" "}
                        {e.duplicate_flag && "· Duplicate review required"}
                      </small>
                    </div>
                  ))}
                  <h3>Qualification assessment</h3>
                  {qualification?.submitted_at ? (
                    <>
                      <Badge value={qualification.auto_result} />
                      <dl className="details-list">
                        {Object.entries(qualification.details).map(([k, v]) => (
                          <React.Fragment key={k}>
                            <dt>{k.replaceAll("_", " ")}</dt>
                            <dd>{v}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                      {qualification.auto_reasons?.map((r, i) => (
                        <p key={i}>{r}</p>
                      ))}
                      {qualification.review_note && (
                        <p>Review note: {qualification.review_note}</p>
                      )}
                      {current.stage === "Qualification review" && (
                        <div className="actions">
                          <button
                            className="primary"
                            onClick={() =>
                              setModal({
                                type: "qualification",
                                p: current,
                                decision: "approve",
                              })
                            }
                          >
                            Approve qualification
                          </button>
                          <button
                            onClick={() =>
                              setModal({
                                type: "qualification",
                                p: current,
                                decision: "reject",
                              })
                            }
                          >
                            Reject qualification
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="muted">
                      Student has not submitted academic and language details
                      for this attempt.
                    </p>
                  )}
                </section>
                <section className="card">
                  <h3>Application & offer</h3>
                  {!application ? (
                    <Empty>
                      No current application. Qualification approval creates a
                      student draft.
                    </Empty>
                  ) : (
                    <>
                      <b>{application.programs?.name}</b>
                      <p>
                        <Badge value={application.status} />
                      </p>
                      <dl className="details-list">
                        {Object.entries(application.details || {}).map(
                          ([k, v]) => (
                            <React.Fragment key={k}>
                              <dt>{k.replaceAll("_", " ")}</dt>
                              <dd>{v}</dd>
                            </React.Fragment>
                          ),
                        )}
                      </dl>
                      <p className="muted">
                        Submitted: {fmt(application.submitted_date)}
                      </p>
                      <h3>Document checklist</h3>
                      {!checklist.length && (
                        <p className="muted">
                          No checklist configured for this program.
                        </p>
                      )}
                      {checklist.map((t) => (
                        <div className="entry" key={t.id}>
                          <div className="section-head">
                            <b>
                              {t.name}
                              {t.required ? " *" : ""}
                            </b>
                            <Badge value={t.document?.status || "Missing"} />
                          </div>
                          {t.document && (
                            <>
                              <p>{t.document.file_name}</p>
                              {t.document.rejection_reason && (
                                <p className="overdue">
                                  {t.document.rejection_reason}
                                </p>
                              )}
                              <div className="actions">
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    run(() =>
                                      downloadDocument(t.document.id, profile),
                                    )
                                  }
                                >
                                  <Download size={14} /> Download
                                </button>
                                {current.stage === "Application" &&
                                  t.document.status === "Pending" && (
                                    <>
                                      <button
                                        disabled={busy}
                                        onClick={() =>
                                          act(current.id, "document_review", {
                                            document_id: t.document.id,
                                            status: "Verified",
                                            note: "",
                                          })
                                        }
                                      >
                                        Verify
                                      </button>
                                      <button
                                        onClick={() =>
                                          setModal({
                                            type: "document",
                                            p: current,
                                            document_id: t.document.id,
                                          })
                                        }
                                      >
                                        Reject / request replacement
                                      </button>
                                    </>
                                  )}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                      {current.stage === "Application" && (
                        <div className="actions">
                          <button
                            className="primary"
                            disabled={
                              !checklist.length ||
                              checklist.some(
                                (t) =>
                                  t.required &&
                                  t.document?.status !== "Verified",
                              )
                            }
                            onClick={() =>
                              setModal({
                                type: "application",
                                p: current,
                                decision: "accept",
                              })
                            }
                          >
                            Accept & issue offer
                          </button>
                          <button
                            onClick={() =>
                              setModal({
                                type: "application",
                                p: current,
                                decision: "reject",
                              })
                            }
                          >
                            Reject application
                          </button>
                        </div>
                      )}
                      {application.offer_snapshot && (
                        <div className="entry">
                          <h3>Issued offer</h3>
                          <p>
                            Expires:{" "}
                            {application.offer_expires_at
                              ? new Date(
                                  application.offer_expires_at,
                                ).toLocaleString("en-AU")
                              : "—"}
                          </p>
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(() => downloadOffer(application, profile))
                            }
                          >
                            <Download size={15} /> Offer letter PDF
                          </button>
                        </div>
                      )}
                      {application.enrolments?.map((e, i) => (
                        <p key={i}>Enrolled {fmt(e.enrolment_date)}</p>
                      ))}
                    </>
                  )}
                  <div className="section-head">
                    <h3>Notes</h3>
                    <button
                      onClick={() => setModal({ type: "note", p: current })}
                    >
                      <Plus size={14} /> Add
                    </button>
                  </div>
                  {current.notes.map((n) => (
                    <div className="entry" key={n.id}>
                      <p>{n.body}</p>
                      <small>{fmt(n.created_at)}</small>
                    </div>
                  ))}
                  <div className="section-head">
                    <h3>Follow-ups</h3>
                    <button
                      onClick={() => setModal({ type: "followup", p: current })}
                    >
                      <Plus size={14} /> Schedule
                    </button>
                  </div>
                  {current.followups.map((f) => (
                    <div className="entry" key={f.id}>
                      <b>{f.title}</b>
                      <p>
                        {fmt(f.due_at)} ·{" "}
                        {f.completed ? "Completed" : "Pending"}{" "}
                        {f.escalated_at && "· Escalated"}
                      </p>
                      {!f.completed && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(current.id, "complete_followup", {
                              followup_id: f.id,
                            })
                          }
                        >
                          Mark complete
                        </button>
                      )}
                    </div>
                  ))}
                </section>
                <section className="card wide">
                  <h3>Previous application attempts</h3>
                  {current.applications
                    .filter((a) => a.id !== current.current_application_id)
                    .map((a) => (
                      <div className="audit-row" key={a.id}>
                        <b>
                          Attempt {a.cycle} · {a.programs?.name}
                        </b>
                        <Badge value={a.status} />
                        {a.offer_snapshot && (
                          <button
                            onClick={() => run(() => downloadOffer(a, profile))}
                          >
                            Previous offer PDF
                          </button>
                        )}
                      </div>
                    ))}
                  {current.applications.length <= 1 && (
                    <p className="muted">No earlier applications.</p>
                  )}
                  <h3>Audit history</h3>
                  {audit
                    .filter((a) => a.prospect_id === current.id)
                    .map((a) => (
                      <div className="audit-row" key={a.id}>
                        <History size={16} />
                        <b>{a.action.replaceAll("_", " ")}</b>
                        <span>
                          {a.staff_users?.full_name || a.actor_type || "System"}
                        </span>
                        <small>
                          {new Date(a.logged_at).toLocaleString("en-AU")}
                        </small>
                      </div>
                    ))}
                  {!["Closed", "Enrolled"].includes(current.stage) && (
                    <div className="actions">
                      <button
                        onClick={() => setModal({ type: "close", p: current })}
                      >
                        Close / withdraw record
                      </button>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <>
              <div className="page-head">
                <div>
                  <p className="eyebrow">RIC RECRUITMENT WORKSPACE</p>
                  <h1>
                    {page === "Dashboard" ? "Recruitment overview" : page}
                  </h1>
                  <p>
                    {page === "Dashboard"
                      ? "A clear view of your pipeline. A better path for every student."
                      : page === "Reports"
                        ? "Understand progression, conversion and recruitment drop-off."
                        : "Manage the next step in every student’s journey."}
                  </p>
                </div>
                {can(profile.role, "write") && (
                  <button
                    className="primary"
                    onClick={() => setModal({ type: "enquiry" })}
                  >
                    <Plus size={17} /> New enquiry
                  </button>
                )}
              </div>
              {["Dashboard", "Reports"].includes(page) && (
                <>
                  <div className="metrics">
                    {[
                      [
                        "Total prospects",
                        stats?.total,
                        Users,
                        "All selected recruitment records",
                      ],
                      [
                        "Qualification review",
                        stats?.counts["Qualification review"],
                        ShieldCheck,
                        "Awaiting a staff decision",
                      ],
                      [
                        "Open offers",
                        stats?.counts.Offer,
                        FileCheck,
                        "Awaiting student acceptance",
                      ],
                      [
                        "Enrolments",
                        stats?.counts.Enrolled,
                        GraduationCap,
                        "Successfully enrolled",
                      ],
                    ].map(([label, value, Icon, sub]) => (
                      <div className="card metric" key={label}>
                        <div>
                          {label}
                          <span className="metric-icon">
                            <Icon size={18} />
                          </span>
                        </div>
                        <strong>{value ?? "—"}</strong>
                        <small>{sub}</small>
                      </div>
                    ))}
                  </div>
                  <div className="dashboard-grid">
                    <section className="card">
                      <div className="section-head">
                        <div>
                          <h3>Recruitment pipeline</h3>
                          <p className="muted">
                            Current prospects at each stage
                          </p>
                        </div>
                        <Badge value="LIVE OVERVIEW" />
                      </div>
                      <div className="bars">
                        {activeStages.map((s, i) => (
                          <div className="bar-group" key={s}>
                            <b>{stats?.counts[s] || 0}</b>
                            <div
                              className={"bar bar-" + i}
                              style={{
                                height:
                                  Math.max(
                                    8,
                                    ((stats?.counts[s] || 0) /
                                      Math.max(
                                        1,
                                        ...Object.values(stats?.counts || {}),
                                      )) *
                                      150,
                                  ) + "px",
                              }}
                            />
                            <small>{s}</small>
                          </div>
                        ))}
                      </div>
                      <div className="chart-footer">
                        Closed: {stats?.counts.Closed || 0}
                        <span>
                          Biggest drop-off:{" "}
                          {stats?.biggest_leak || "None recorded"}
                        </span>
                      </div>
                    </section>
                    <section className="card">
                      <h3>Stage conversion</h3>
                      <p className="muted">
                        Unique prospects reaching the next stage
                      </p>
                      {stats?.conversions.map((c) => (
                        <div className="conversion" key={c.from}>
                          <div>
                            <b>
                              {c.from} <ChevronRight size={14} />
                              {c.to}
                            </b>
                            <strong>
                              {c.rate === null ? "—" : c.rate + "%"}
                            </strong>
                          </div>
                          <div className="progress">
                            <span
                              style={{
                                width: Math.min(100, c.rate || 0) + "%",
                              }}
                            />
                          </div>
                          <small>
                            {c.converted} of {c.reached} prospects progressed
                          </small>
                        </div>
                      ))}
                    </section>
                  </div>
                </>
              )}
              {page === "Dashboard" && (
                <div className="dashboard-grid">
                  <section className="card">
                    <div className="section-head">
                      <h3>Recent prospects</h3>
                      <button
                        className="text"
                        onClick={() => setPage("Prospects")}
                      >
                        View all <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <ProspectTable
                      rows={prospects.slice(0, 5)}
                      select={setSelected}
                    />
                  </section>
                  <section className="card">
                    <h3>Your pending follow-ups</h3>
                    {tasks.slice(0, 5).map((f) => (
                      <button
                        className="task"
                        key={f.id}
                        onClick={() => setSelected(f.prospect.id)}
                      >
                        <Calendar size={18} />
                        <div>
                          <b>{f.title}</b>
                          <small>{f.prospect.full_name}</small>
                        </div>
                        <small
                          className={
                            new Date(f.due_at) < new Date() ? "overdue" : ""
                          }
                        >
                          {fmt(f.due_at)}
                        </small>
                      </button>
                    ))}
                    {!tasks.length && <Empty>No pending follow-ups.</Empty>}
                  </section>
                </div>
              )}
              {["Prospects", "Enquiries"].includes(page) && (
                <section className="card">
                  <div className="toolbar">
                    <div className="search">
                      <Search size={17} />
                      <input
                        aria-label="Search prospects"
                        placeholder="Search name, email or phone…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="Filter stage"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option>All stages</option>
                      {stages.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        exportCsv(
                          "nexus-prospects",
                          [
                            "Name",
                            "Email",
                            "Phone",
                            "Stage",
                            "Reason",
                            "Created",
                          ],
                          filtered.map((p) => [
                            p.full_name,
                            p.email,
                            p.phone,
                            p.stage,
                            p.closed_reason,
                            p.created_at,
                          ]),
                        )
                      }
                    >
                      Export CSV
                    </button>
                  </div>
                  <ProspectTable rows={filtered} select={setSelected} />
                  <p className="muted">
                    {filtered.length} records · Open a prospect to review
                    related enquiries and duplicate flags.
                  </p>
                </section>
              )}
              {page === "Pipeline" && (
                <div className="pipeline">
                  {stages.map((s) => (
                    <section key={s}>
                      <div className="section-head">
                        <h3>{s}</h3>
                        <Badge
                          value={prospects.filter((p) => p.stage === s).length}
                        />
                      </div>
                      {prospects
                        .filter((p) => p.stage === s)
                        .map((p) => (
                          <button
                            className="pipeline-card"
                            onClick={() => setSelected(p.id)}
                            key={p.id}
                          >
                            <div>
                              <span className="avatar small">
                                {initials(p.full_name)}
                              </span>
                              <b>{p.full_name}</b>
                            </div>
                            <p>{p.enquiries[0]?.programs?.name}</p>
                            <small>
                              {fmt(p.created_at)} <ChevronRight size={14} />
                            </small>
                          </button>
                        ))}
                    </section>
                  ))}
                </div>
              )}
              {["Applications", "Offers", "Enrolments"].includes(page) && (
                <section className="card">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Program</th>
                          <th>Status</th>
                          <th>
                            {page === "Offers"
                              ? "Offer expires"
                              : page === "Enrolments"
                                ? "Enrolled"
                                : "Submitted"}
                          </th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {prospects.flatMap((p) =>
                          p.applications
                            .filter(
                              (a) =>
                                page === "Applications" ||
                                (page === "Offers" &&
                                  a.id === p.current_application_id &&
                                  p.stage === "Offer") ||
                                (page === "Enrolments" && a.enrolments?.length),
                            )
                            .map((a) => (
                              <tr key={a.id}>
                                <td>{p.full_name}</td>
                                <td>{a.programs?.name}</td>
                                <td>
                                  <Badge value={a.status} />
                                </td>
                                <td>
                                  {fmt(
                                    page === "Offers"
                                      ? a.offer_expires_at
                                      : page === "Enrolments"
                                        ? a.enrolments[0].enrolment_date
                                        : a.submitted_date,
                                  )}
                                </td>
                                <td>
                                  <button onClick={() => setSelected(p.id)}>
                                    Open
                                  </button>
                                </td>
                              </tr>
                            )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {page === "Follow-ups" && (
                <section className="card">
                  <div className="section-head">
                    <h3>{allTasks ? "All open tasks" : "Your open tasks"}</h3>
                    <button onClick={() => setAllTasks(!allTasks)}>
                      {allTasks ? "Show mine" : "Show all"}
                    </button>
                  </div>
                  {tasks.map((f) => (
                    <div className="task" key={f.id}>
                      <Calendar size={18} />
                      <div>
                        <b>{f.title}</b>
                        <small>
                          {f.prospect.full_name} · {fmt(f.due_at)}{" "}
                          {f.escalated_at && "· Escalated"}
                        </small>
                      </div>
                      <button onClick={() => setSelected(f.prospect.id)}>
                        Open
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          act(f.prospect.id, "complete_followup", {
                            followup_id: f.id,
                          })
                        }
                      >
                        Complete
                      </button>
                    </div>
                  ))}
                  {!tasks.length && <Empty>All caught up.</Empty>}
                </section>
              )}
              {page === "Email log" && (
                <section className="card">
                  <h3>Email delivery history</h3>
                  <p className="muted">
                    Queued events are delivered by the scheduled runner. Logged
                    means demonstration-only, not sent. Failed events retry up
                    to five attempts.
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Template</th>
                          <th>Recipient</th>
                          <th>Status</th>
                          <th>Attempts</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emails.map((e) => (
                          <tr key={e.id}>
                            <td>
                              {e.template}
                              {e.last_error && <small>{e.last_error}</small>}
                            </td>
                            <td>{e.recipient}</td>
                            <td>
                              <Badge value={e.status} />
                            </td>
                            <td>{e.attempts}</td>
                            <td>{fmt(e.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!emails.length && <Empty>No email events yet.</Empty>}
                </section>
              )}
              {page === "Reports" && (
                <>
                  <section className="card">
                    <div className="section-head">
                      <h3>Recruitment cohort</h3>
                      <button
                        onClick={() =>
                          exportCsv(
                            "nexus-report",
                            [
                              "Stage",
                              "Reached",
                              "Moved on",
                              "Closed",
                              "Current",
                              "Drop-off %",
                              "Average days",
                            ],
                            (stats?.funnel || []).map((f) => [
                              f.stage,
                              f.entered,
                              f.moved_on,
                              f.closed,
                              f.current,
                              f.drop_off_rate,
                              f.avg_days,
                            ]),
                          )
                        }
                      >
                        Export report CSV
                      </button>
                    </div>
                    <form
                      className="report-filters"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const range = formObject(e.currentTarget);
                        setDates(range);
                        run(() => refresh(profile, range));
                      }}
                    >
                      <Field
                        label="Prospects created from"
                        name="from"
                        type="date"
                      />
                      <Field
                        label="Prospects created to"
                        name="to"
                        type="date"
                      />
                      <button className="primary" disabled={busy}>
                        Apply cohort
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.currentTarget.form.reset();
                          setDates({});
                          run(() => refresh(profile, {}));
                        }}
                      >
                        All time
                      </button>
                    </form>
                    <p className="muted">
                      Filters select prospects by their first enquiry date.
                      History covers all attempts for those prospects. Current
                      open prospects are not counted as lost. Time averages
                      include completed stage visits only.
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Stage</th>
                            <th>Reached</th>
                            <th>Moved on</th>
                            <th>Closed</th>
                            <th>Current</th>
                            <th>Drop-off</th>
                            <th>Avg days</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats?.funnel.map((f) => (
                            <tr key={f.stage}>
                              <td>{f.stage}</td>
                              <td>{f.entered}</td>
                              <td>{f.moved_on}</td>
                              <td>{f.closed}</td>
                              <td>{f.current}</td>
                              <td>
                                {f.drop_off_rate === null
                                  ? "—"
                                  : f.drop_off_rate + "%"}
                              </td>
                              <td>{f.avg_days ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <h3>Why prospects were lost</h3>
                    {stats?.closed_reasons.map((r, i) => (
                      <div className="audit-row" key={i}>
                        <b>{r.stage}</b>
                        <span>{r.reason}</span>
                        <strong>{r.count}</strong>
                      </div>
                    ))}
                    {!stats?.closed_reasons.length && (
                      <Empty>No confirmed dropouts in this cohort.</Empty>
                    )}
                  </section>
                  {can(profile.role, "jobs") && (
                    <section className="card automation-card">
                      <h3>Reminders & workflow checks</h3>
                      <p>
                        Run due reminders, closures, offer expiry and staff
                        escalation checks. This action can change records and
                        dispatch queued emails when delivery is configured.
                      </p>
                      <button
                        disabled={busy}
                        onClick={() => setModal({ type: "jobs" })}
                      >
                        Run checks now
                      </button>
                    </section>
                  )}
                </>
              )}
              {page === "Audit log" && (
                <section className="card">
                  <h3>Activity history</h3>
                  <p className="muted">
                    Latest 500 staff, student and system events. Entries cannot
                    be edited through the CRM.
                  </p>
                  {audit.map((a) => (
                    <div className="audit-row" key={a.id}>
                      <History size={17} />
                      <b>{a.action.replaceAll("_", " ")}</b>
                      <span>
                        {a.staff_users?.full_name || a.actor_type || "System"}
                      </span>
                      <small>
                        {new Date(a.logged_at).toLocaleString("en-AU")}
                      </small>
                      {a.prospect_id && (
                        <button onClick={() => setSelected(a.prospect_id)}>
                          View
                        </button>
                      )}
                    </div>
                  ))}
                  {!audit.length && <Empty>No activity yet.</Empty>}
                </section>
              )}
              {page === "Settings" && (
                <section className="card settings">
                  <h3>Workspace settings</h3>
                  <p>
                    Signed in as <b>{profile.full_name}</b> · {profile.role}
                  </p>
                  <p>
                    Environment:{" "}
                    <b>
                      {demo
                        ? "Fictional browser-local demo"
                        : "Supabase PostgreSQL"}
                    </b>
                  </p>
                  <div className="actions">
                    <Link className="button-link" to="/enquiry">
                      Public enquiry form
                    </Link>
                    <Link className="button-link" to="/student">
                      Student portal
                    </Link>
                    {demo && (
                      <button
                        onClick={() => {
                          resetDemo();
                          run(() => refresh(), "Fictional demo data restored");
                        }}
                      >
                        Restore demo data
                      </button>
                    )}
                  </div>
                  {can(profile.role, "users") && (
                    <>
                      <h3>Staff access</h3>
                      <p className="muted">
                        Create staff Auth accounts and profiles in Supabase.
                        Manage their role and account status here. Student
                        signup never grants a staff role.
                      </p>
                      {staff.map((s) => (
                        <div className="audit-row" key={s.id}>
                          <b>{s.full_name}</b>
                          <span>
                            {s.role} · {s.active ? "Active" : "Disabled"}
                          </span>
                          {s.id !== profile.id && (
                            <button
                              onClick={() =>
                                setModal({ type: "staff", staff: s })
                              }
                            >
                              Manage access
                            </button>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                  <p className="muted">
                    Program criteria, intakes and document checklists are
                    administrator configuration in Supabase. Fictional demo
                    rules must be replaced with approved RIC requirements before
                    real use.
                  </p>
                </section>
              )}
            </>
          )}
        </div>
        <footer>
          Nexus CRM{" "}
          <span>
            RIC Student Recruitment ·{" "}
            {demo ? "Fictional demonstration" : "Protected workspace"}
          </span>
        </footer>
      </main>
      {modal && (
        <Modal
          title={
            {
              edit: "Edit prospect",
              enquiry: "New enquiry",
              qualification: "Qualification decision",
              document: "Request replacement document",
              application: "Application decision",
              close: "Close recruitment attempt",
              note: "Add note",
              followup: "Schedule follow-up",
              staff: "Manage staff access",
              jobs: "Run workflow automation?",
            }[modal.type]
          }
          close={() => setModal(null)}
        >
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          {modal.type === "enquiry" ? (
            <EnquiryForm
              programs={programs}
              busy={busy}
              submit={(body) =>
                run(async () => {
                  await request("/enquiries", "POST", body);
                  await refresh();
                  setModal(null);
                  return true;
                }, "Enquiry received")
              }
            />
          ) : modal.type === "jobs" ? (
            <>
              <p>
                This queues reminders, closes overdue records, lapses expired
                offers and delivers queued emails. Run only when you intend to
                apply these rules.
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    if (await runChecks()) setModal(null);
                  }}
                >
                  Run checks
                </button>
                <button onClick={() => setModal(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = formObject(e.currentTarget);
                if (modal.type === "edit")
                  act(modal.p.id, "update", {
                    ...f,
                    assigned_staff_id: f.assigned_staff_id || null,
                  });
                if (modal.type === "qualification")
                  act(modal.p.id, "qualification_decision", {
                    decision: modal.decision,
                    note: f.note || "",
                  });
                if (modal.type === "document")
                  act(modal.p.id, "document_review", {
                    document_id: modal.document_id,
                    status: "Rejected",
                    note: f.note,
                  });
                if (modal.type === "application")
                  act(modal.p.id, "application_decision", {
                    decision: modal.decision,
                    note: f.note || "",
                  });
                if (modal.type === "close") act(modal.p.id, "close", f);
                if (modal.type === "note") act(modal.p.id, "note", f);
                if (modal.type === "followup")
                  act(modal.p.id, "followup", {
                    ...f,
                    due_at: new Date(f.due_at).toISOString(),
                  });
                if (modal.type === "staff")
                  run(async () => {
                    if (demo)
                      throw Error(
                        "Staff access changes are only available in PostgreSQL mode",
                      );
                    await request(
                      "/staff/" + modal.staff.id,
                      "POST",
                      { role: f.role, active: f.active === "true" },
                      profile,
                    );
                    await refresh();
                    setModal(null);
                  }, "Staff access updated");
              }}
            >
              {modal.type === "edit" && (
                <>
                  <ContactFields p={modal.p} />
                  <label>
                    Assigned staff
                    <select
                      name="assigned_staff_id"
                      defaultValue={modal.p.assigned_staff_id || ""}
                    >
                      <option value="">Unassigned</option>
                      {staff
                        .filter((s) => s.active && s.role !== "management")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="muted">
                    Linked student account emails require a separate identity
                    review to change.
                  </p>
                </>
              )}
              {["qualification", "application", "document"].includes(
                modal.type,
              ) && (
                <>
                  <p>
                    {modal.type === "qualification"
                      ? modal.decision === "approve"
                        ? "Approve eligibility and open a student application draft."
                        : "Reject eligibility and close this attempt as Not eligible."
                      : modal.type === "application"
                        ? modal.decision === "accept"
                          ? "Issue an offer valid for 14 days. Student acceptance is required before enrolment."
                          : "Reject the application and close this attempt. The student will receive an outcome email."
                        : "Explain what the student needs to fix. They will be able to upload a replacement."}
                  </p>
                  <label>
                    Decision note
                    <textarea
                      name="note"
                      required={
                        modal.decision === "reject" || modal.type === "document"
                      }
                      minLength={
                        modal.decision === "reject" || modal.type === "document"
                          ? 3
                          : 0
                      }
                      maxLength={modal.type === "document" ? 500 : 1000}
                    />
                  </label>
                </>
              )}
              {modal.type === "close" && (
                <label>
                  Closure reason
                  <select name="reason" required>
                    {["Withdrawn", "No response"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
              )}
              {modal.type === "note" && (
                <label>
                  Note
                  <textarea name="body" required maxLength={2000} />
                </label>
              )}
              {modal.type === "followup" && (
                <>
                  <Field label="Task" name="title" required maxLength={200} />
                  <Field
                    label="Due date & time"
                    name="due_at"
                    type="datetime-local"
                    required
                  />
                </>
              )}
              {modal.type === "staff" && (
                <>
                  <label>
                    Role
                    <select name="role" defaultValue={modal.staff.role}>
                      {[
                        "recruitment",
                        "administration",
                        "management",
                        "admin",
                      ].map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Status
                    <select
                      name="active"
                      defaultValue={String(modal.staff.active)}
                    >
                      <option value="true">Active</option>
                      <option value="false">Disabled</option>
                    </select>
                  </label>
                </>
              )}
              <button className="primary full" disabled={busy}>
                {busy ? "Saving…" : "Confirm & save"}
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
function ProspectTable({ rows, select }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Prospect</th>
            <th>Program interest</th>
            <th>Stage</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <button className="person" onClick={() => select(p.id)}>
                  <span className="avatar small">{initials(p.full_name)}</span>
                  <span>
                    <b>{p.full_name}</b>
                    <small>{p.email}</small>
                  </span>
                </button>
              </td>
              <td>
                {p.enquiries[0]?.programs?.name || "—"}
                {p.enquiries.some((e) => e.duplicate_flag) && (
                  <small className="overdue">Duplicate review</small>
                )}
              </td>
              <td>
                <Badge value={p.stage} />
                {p.closed_reason && <small>{p.closed_reason}</small>}
              </td>
              <td>{fmt(p.created_at)}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={"Open " + p.full_name}
                  onClick={() => select(p.id)}
                >
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>No records match this view.</Empty>
  );
}
