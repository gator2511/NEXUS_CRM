import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  GraduationCap,
  ArrowUpRight,
  Check,
  LogOut,
  FileCheck,
  Download,
  Upload,
  ShieldCheck,
} from "lucide-react";
import {
  request,
  supabase,
  demo,
  uploadDocument,
  downloadDocument,
  downloadOffer,
} from "./data";
import {
  qualificationLevels,
  languageTests,
  studyModes,
  activeStages,
} from "../server/rules";
import { Alert, Field, EnquiryForm, fmt, formObject, Badge, Modal } from "./ui";
export default function StudentApp({ enquiry = false }) {
  const [profile, setProfile] = useState(null),
    [workspace, setWorkspace] = useState(null),
    [programs, setPrograms] = useState([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState("login"),
    [confirm, setConfirm] = useState(null),
    [recovery, setRecovery] = useState(false);
  const location = useLocation(),
    navigate = useNavigate();
  async function load(p = profile) {
    if (!p) return;
    setWorkspace(await request("/student", "GET", null, p));
  }
  useEffect(() => {
    request("/programs")
      .then(setPrograms)
      .catch((e) => setError(e.message));
    if (demo) return;
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          const p = { role: "student", email: data.session.user.email };
          setProfile(p);
          load(p).catch((e) => setError(e.message));
        }
      });
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") setRecovery(true);
        if (!session) {
          setProfile(null);
          setWorkspace(null);
        }
      });
      return () => subscription.unsubscribe();
    }
  }, []);
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
  async function action(name, body = {}) {
    return run(async () => {
      await request("/student/" + name, "POST", body, profile);
      await load();
      setConfirm(null);
    }, "Changes saved");
  }
  async function auth(e) {
    e.preventDefault();
    const f = formObject(e.currentTarget);
    await run(async () => {
      if (demo) {
        const p = {
          role: "student",
          email: f.email.toLowerCase(),
          full_name: "Demo student",
        };
        const w = await request("/student", "GET", null, p);
        setProfile(p);
        setWorkspace(w);
        return;
      }
      if (!supabase)
        throw Error("Configure Supabase before using student accounts");
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: f.email,
          password: f.password,
          options: { emailRedirectTo: window.location.origin + "/student" },
        });
        if (error) throw error;
        setNotice(
          "Check your email and confirm your address, then sign in. Your account email must match your enquiry.",
        );
        return;
      }
      if (mode === "verify") {
        const { error } = await supabase.auth.resend({
          type: "signup",
          email: f.email,
          options: { emailRedirectTo: window.location.origin + "/student" },
        });
        if (error)
          throw Error("Unable to resend confirmation now. Try again later.");
        setNotice(
          "If an account is awaiting confirmation, a new verification email will arrive shortly.",
        );
        return;
      }
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(f.email, {
          redirectTo: window.location.origin + "/student",
        });
        if (error) throw error;
        setNotice(
          "If the account exists, a password reset link will arrive by email.",
        );
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: f.email,
        password: f.password,
      });
      if (error)
        throw Error(
          "Sign-in failed. Check your email, password and email verification.",
        );
      const p = { role: "student", email: data.user.email };
      setProfile(p);
      await load(p);
    });
  }
  async function logout() {
    if (!demo) await supabase.auth.signOut();
    setProfile(null);
    setWorkspace(null);
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
  const header = (
    <header className="portal-header">
      <Link to="/enquiry" className="brand">
        <span>N</span> NEXUS <small>RIC</small>
      </Link>
      <div className="top-right">
        {demo && <span className="demo-pill">FICTIONAL DEMO</span>}
        <Link to="/">Staff workspace</Link>
        {profile && (
          <button onClick={logout}>
            <LogOut size={15} /> Sign out
          </button>
        )}
      </div>
    </header>
  );
  if (enquiry)
    return (
      <div className="public">
        {header}
        <div className="public-grid">
          <section>
            <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
            <h1>
              A brighter future.
              <br />
              <em>One enquiry away.</em>
            </h1>
            <p>
              Explore your study options with RIC. Submit an enquiry, then
              create your student account to track every step.
            </p>
            <div className="public-facts">
              <p>
                <Check /> Personal guidance
              </p>
              <p>
                <Check /> Academic and language assessment
              </p>
              <p>
                <Check /> Applications, documents and offers in one place
              </p>
            </div>
            <Link className="button-link" to="/student">
              Already enquired? Open student portal <ArrowUpRight size={16} />
            </Link>
            <p className="muted">
              Capstone demonstration. Use fictional data only.
            </p>
          </section>
          <section className="card">
            <h2>Let’s get to know you</h2>
            {alert}
            <EnquiryForm
              programs={programs}
              busy={busy}
              submit={(body) =>
                run(async () => {
                  const r = await request("/enquiries", "POST", body);
                  setNotice(r.message + " Reference: " + r.reference);
                  return true;
                })
              }
            />
            {notice && (
              <Link className="button-link" to="/student">
                Continue to student account <ArrowUpRight size={16} />
              </Link>
            )}
          </section>
        </div>
      </div>
    );
  if (recovery)
    return (
      <div className="public">
        {header}
        <section className="card auth-card">
          <h2>Set a new password</h2>
          {alert}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = formObject(e.currentTarget);
              run(async () => {
                const { error } = await supabase.auth.updateUser({
                  password: f.password,
                });
                if (error) throw error;
                setRecovery(false);
                setNotice("Password updated");
              });
            }}
          >
            <Field
              label="New password"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
            <button disabled={busy} className="primary full">
              Update password
            </button>
          </form>
        </section>
      </div>
    );
  if (!profile)
    return (
      <div className="public">
        {header}
        <section className="card auth-card">
          <span className="badge qualified">STUDENT PORTAL</span>
          <h2>
            {mode === "signup"
              ? "Create your student account"
              : mode === "verify"
                ? "Resend email confirmation"
                : mode === "reset"
                  ? "Reset your password"
                  : "Your next step starts here"}
          </h2>
          <p className="muted">
            Use the same email address as your enquiry. Only you can access your
            application and documents.
          </p>
          {alert}
          <form onSubmit={auth}>
            <Field
              label="Email"
              name="email"
              type="email"
              required
              defaultValue={demo ? "student@example.com" : ""}
              autoComplete="username"
            />
            {!demo && !["reset", "verify"].includes(mode) && (
              <Field
                label="Password"
                name="password"
                type="password"
                required
                minLength={mode === "signup" ? 10 : 1}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
              />
            )}
            <button className="primary full" disabled={busy}>
              {busy
                ? "Please wait…"
                : demo
                  ? "Open fictional student portal"
                  : mode === "signup"
                    ? "Create account & send verification"
                    : mode === "verify"
                      ? "Send verification email"
                      : mode === "reset"
                        ? "Send reset link"
                        : "Sign in"}
            </button>
          </form>
          {demo ? (
            <p className="muted">
              Demo: student@example.com starts at Enquiry. You can also submit a
              fictional enquiry and use its email here. This mode does not
              authenticate identities.
            </p>
          ) : (
            <div className="actions">
              <button
                onClick={() => setMode(mode !== "login" ? "login" : "signup")}
              >
                {mode !== "login" ? "Back to sign in" : "Create an account"}
              </button>
              <button onClick={() => setMode("reset")}>Forgot password?</button>
              <button onClick={() => setMode("verify")}>
                Resend verification email
              </button>
            </div>
          )}
          <Link to="/enquiry">Submit a new enquiry</Link>
        </section>
      </div>
    );
  if (!workspace)
    return (
      <div className="public">
        {header}
        <section className="card auth-card">
          <h2>Connect your enquiry</h2>
          {alert}
          <p>
            Submit an enquiry using {profile.email}, and make sure your email is
            verified.
          </p>
          <Link to="/enquiry">Submit enquiry</Link>
          <button onClick={() => run(() => load())}>Retry</button>
        </section>
      </div>
    );
  const {
    prospect: p,
    application: a,
    qualification: q,
    intakes,
    program,
    checklist,
    enrolment,
  } = workspace;
  return (
    <div className="public">
      {header}
      <div className="portal-content">
        {alert}
        <div className="page-head">
          <div>
            <p className="eyebrow">YOUR STUDENT JOURNEY</p>
            <h1>Hello, {p.full_name.split(" ")[0]}</h1>
            <p>{program?.name}</p>
          </div>
          <Badge value={p.stage} />
        </div>
        <div className="journey portal-journey">
          {activeStages.map((s, i) => (
            <div
              key={s}
              className={activeStages.indexOf(p.stage) >= i ? "done" : ""}
            >
              <span>{i + 1}</span>
              <small>{s}</small>
            </div>
          ))}
        </div>
        {p.stage === "Closed" ? (
          <section className="card">
            <h2>Your enquiry is closed</h2>
            <p>Reason: {p.closed_reason}</p>
            <p>
              Your previous documents and decisions stay in your history. A new
              enquiry starts a new recruitment attempt.
            </p>
            <Link to="/enquiry">Submit a new enquiry</Link>
          </section>
        ) : (
          <>
            {p.stage === "Enquiry" && (
              <section className="card">
                <h2>Academic & English language details</h2>
                <p className="muted">
                  Save your progress or submit your details for eligibility
                  assessment.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = formObject(e.currentTarget);
                    for (const k of ["year_completed", "language_score"])
                      if (data[k]) data[k] = Number(data[k]);
                    action(
                      e.nativeEvent.submitter?.value === "draft"
                        ? "qualification_draft"
                        : "qualification_submit",
                      data,
                    );
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Highest qualification
                      <select
                        name="highest_qualification"
                        defaultValue={q?.details?.highest_qualification || ""}
                      >
                        <option value="">Choose qualification</option>
                        {qualificationLevels.map((l) => (
                          <option key={l}>{l}</option>
                        ))}
                      </select>
                    </label>
                    <Field
                      label="Institution"
                      name="institution"
                      defaultValue={q?.details?.institution}
                      maxLength={150}
                    />
                    <Field
                      label="Year completed"
                      name="year_completed"
                      type="number"
                      min={1970}
                      max={new Date().getFullYear()}
                      defaultValue={q?.details?.year_completed}
                    />
                    <Field
                      label="Result / grade (optional)"
                      name="result"
                      defaultValue={q?.details?.result}
                      maxLength={100}
                    />
                    <label>
                      Language test
                      <select
                        name="language_test_type"
                        defaultValue={q?.details?.language_test_type || ""}
                      >
                        <option value="">Choose test</option>
                        {languageTests.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <Field
                      label="Overall score (if test taken)"
                      name="language_score"
                      type="number"
                      step="0.1"
                      min={0}
                      max={120}
                      defaultValue={q?.details?.language_score}
                    />
                    <Field
                      label="Test date (if test taken)"
                      name="test_date"
                      type="date"
                      defaultValue={q?.details?.test_date}
                    />
                    <Intake intakes={intakes} value={q?.details?.intake_id} />
                  </div>
                  <p className="muted">
                    IELTS 0–9 · PTE 10–90 · TOEFL 0–120. Test results must be
                    within the past two years. “None taken” goes to staff
                    review.
                  </p>
                  <div className="actions">
                    <button
                      className="primary"
                      name="operation"
                      value="submit"
                      disabled={busy}
                    >
                      Submit details
                    </button>
                    <button name="operation" value="draft" disabled={busy}>
                      Save draft
                    </button>
                  </div>
                </form>
              </section>
            )}
            {p.stage === "Qualification review" && (
              <section className="card">
                <ShieldCheck size={30} />
                <h2>Our team is reviewing your details</h2>
                <p>
                  Your academic and language details need a staff decision. You
                  will receive an update when the review is complete.
                </p>
                <button onClick={() => run(() => load())}>
                  Refresh status
                </button>
              </section>
            )}
            {p.stage === "Qualified" && (
              <section className="card">
                <h2>Your application</h2>
                <p className="muted">
                  Complete enrolment details, save your draft and upload the
                  required documents before submitting.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    action(
                      e.nativeEvent.submitter?.value === "draft"
                        ? "application_draft"
                        : "application_submit",
                      formObject(e.currentTarget),
                    );
                  }}
                >
                  <div className="form-grid">
                    <Field
                      label="Date of birth"
                      name="date_of_birth"
                      type="date"
                      defaultValue={a?.details?.date_of_birth}
                    />
                    <Field
                      label="Nationality"
                      name="nationality"
                      defaultValue={a?.details?.nationality}
                      maxLength={60}
                    />
                    <Field
                      label="Emergency contact name"
                      name="emergency_contact_name"
                      defaultValue={a?.details?.emergency_contact_name}
                      maxLength={120}
                    />
                    <Field
                      label="Emergency contact phone"
                      name="emergency_contact_phone"
                      type="tel"
                      defaultValue={a?.details?.emergency_contact_phone}
                    />
                    <label>
                      Study mode
                      <select
                        name="study_mode"
                        defaultValue={a?.details?.study_mode || ""}
                      >
                        <option value="">Choose mode</option>
                        {studyModes.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </label>
                    <Intake
                      intakes={intakes}
                      value={a?.details?.intake_id || a?.intake_id}
                    />
                  </div>
                  <div className="actions">
                    <button className="primary" value="submit" disabled={busy}>
                      Submit application
                    </button>
                    <button value="draft" disabled={busy}>
                      Save draft
                    </button>
                  </div>
                </form>
                {!a && (
                  <p className="muted">
                    Save a draft first to open your document checklist.
                  </p>
                )}
              </section>
            )}
            {["Qualified", "Application"].includes(p.stage) && a && (
              <section className="card">
                <h2>
                  {p.stage === "Application"
                    ? "Document review"
                    : "Required documents"}
                </h2>
                <p className="muted">
                  PDF, JPG or PNG · 10 MB maximum per file. A rejected document
                  can be replaced; verified documents are locked.
                </p>
                {!checklist.length && (
                  <p>
                    Admissions must configure the program document checklist.
                  </p>
                )}
                {checklist.map((t) => (
                  <div className="document-row" key={t.id}>
                    <FileCheck size={22} />
                    <div>
                      <b>
                        {t.name} {t.required ? "*" : "(optional)"}
                      </b>
                      <small>{t.document?.file_name || "Not uploaded"}</small>
                      {t.document?.rejection_reason && (
                        <p className="overdue">
                          Please fix: {t.document.rejection_reason}
                        </p>
                      )}
                    </div>
                    {t.document && (
                      <>
                        <Badge value={t.document.status} />
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(() => downloadDocument(t.document.id, profile))
                          }
                        >
                          <Download size={15} /> Download
                        </button>
                      </>
                    )}
                    {(p.stage === "Qualified" ||
                      t.document?.status === "Rejected") && (
                      <label className="upload-button">
                        {t.document ? "Replace" : "Upload"}
                        <input
                          aria-label={"Upload " + t.name}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          disabled={busy}
                          onChange={(e) => {
                            const f = e.target.files[0];
                            if (f)
                              run(async () => {
                                await uploadDocument(t.id, f, profile);
                                await load();
                              }, "Document uploaded");
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                ))}
                {p.stage === "Application" && (
                  <p className="muted">
                    Your application is {a.status}. Check this page for review
                    updates.
                  </p>
                )}
              </section>
            )}
            {p.stage === "Offer" && (
              <section className="card">
                <GraduationCap size={32} />
                <h2>Your offer is ready</h2>
                <p>{a?.offer_snapshot?.program}</p>
                <p>
                  Respond before{" "}
                  <b>
                    {a?.offer_expires_at
                      ? new Date(a.offer_expires_at).toLocaleString("en-AU")
                      : ""}
                  </b>
                  .
                </p>
                <button
                  onClick={() => run(() => downloadOffer(a, profile))}
                  disabled={busy}
                >
                  <Download size={16} /> Download offer letter
                </button>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={
                      busy || new Date(a.offer_expires_at) <= new Date()
                    }
                    onClick={() => setConfirm("offer_accept")}
                  >
                    Accept offer & enrol
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setConfirm("offer_decline")}
                  >
                    Decline offer
                  </button>
                </div>
                {new Date(a.offer_expires_at) <= new Date() && (
                  <p className="overdue">
                    This offer has expired. Contact admissions.
                  </p>
                )}
              </section>
            )}
            {p.stage === "Enrolled" && (
              <section className="card">
                <GraduationCap size={35} />
                <h2>You’re enrolled</h2>
                <p>
                  Welcome to RIC. Your enrolment was recorded on{" "}
                  {fmt(enrolment?.enrolment_date)}.
                </p>
                {a?.offer_snapshot && (
                  <button
                    onClick={() => run(() => downloadOffer(a, profile))}
                    disabled={busy}
                  >
                    Download offer letter
                  </button>
                )}
              </section>
            )}
            {!["Enrolled", "Closed"].includes(p.stage) && (
              <div className="portal-bottom">
                <p className="muted">
                  Need to pause your journey? You can withdraw your enquiry.
                </p>
                <button disabled={busy} onClick={() => setConfirm("withdraw")}>
                  Withdraw enquiry
                </button>
                <button disabled={busy} onClick={() => run(() => load())}>
                  Refresh status
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {confirm && (
        <Modal
          title={
            confirm === "offer_accept"
              ? "Accept your offer and enrol?"
              : confirm === "offer_decline"
                ? "Decline your offer?"
                : "Withdraw your enquiry?"
          }
          close={() => setConfirm(null)}
        >
          <p>
            {confirm === "offer_accept"
              ? "This records your acceptance and creates your enrolment."
              : "This closes your current recruitment attempt. You can submit a new enquiry later."}
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => action(confirm)}
            >
              Confirm
            </button>
            <button onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Intake({ intakes, value }) {
  return (
    <label>
      Preferred intake
      <select name="intake_id" defaultValue={value || ""}>
        <option value="">Choose intake</option>
        {intakes.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name} · {fmt(i.start_date)}
          </option>
        ))}
      </select>
    </label>
  );
}
