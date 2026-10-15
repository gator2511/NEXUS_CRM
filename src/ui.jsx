import React from "react";
import { X, ClipboardList } from "lucide-react";
export const fmt = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
export const initials = (n) =>
  (n || "")
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
export const Badge = ({ value }) => (
  <span className={"badge " + String(value).replaceAll(" ", "").toLowerCase()}>
    {value}
  </span>
);
export function Alert({ error, notice, dismiss }) {
  return (
    <>
      {error && (
        <div role="alert" className="alert error">
          {error}
          <button aria-label="Dismiss error" onClick={dismiss}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="alert success">
          {notice}
          <button aria-label="Dismiss notification" onClick={dismiss}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
export function Empty({ children }) {
  return (
    <div className="empty">
      <ClipboardList size={26} />
      <p>{children}</p>
    </div>
  );
}
export function Modal({ title, close, children }) {
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="section-head">
          <h2>{title}</h2>
          <button autoFocus aria-label="Close dialog" onClick={close}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  ...props
}) {
  return (
    <label>
      {label}
      {required ? " *" : ""}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        {...props}
      />
    </label>
  );
}
export function ContactFields({ p = {} }) {
  return (
    <>
      <Field
        label="Full name"
        name="full_name"
        required
        defaultValue={p.full_name}
        minLength={2}
        maxLength={120}
      />
      <div className="form-grid">
        <Field
          label="Email"
          name="email"
          type="email"
          required
          defaultValue={p.email}
          maxLength={254}
        />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          required
          defaultValue={p.phone}
          pattern="[+0-9 ()-]{7,25}"
        />
      </div>
      <Field
        label="Address"
        name="address"
        required
        defaultValue={p.address}
        minLength={5}
        maxLength={500}
      />
    </>
  );
}
export function EnquiryForm({ programs, submit, busy }) {
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const values = Object.fromEntries(new FormData(form));
        if (await submit({ ...values, consent: values.consent === "on" }))
          form.reset();
      }}
    >
      <ContactFields />
      <label>
        Program of interest *
        <select name="program_id" required>
          <option value="">Choose a program</option>
          {programs.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Your message
        <textarea name="message" maxLength={2000} />
      </label>
      <label className="checkbox">
        <input name="consent" type="checkbox" required />I agree to be contacted
        about this enquiry. Use fictional information for this capstone
        demonstration.
      </label>
      <button disabled={busy} className="primary full">
        {busy ? "Submitting…" : "Submit enquiry"}
      </button>
    </form>
  );
}
export function formObject(form) {
  return Object.fromEntries(
    [...new FormData(form)].filter(([, v]) => v !== ""),
  );
}
export function exportCsv(name, headers, rows) {
  const csv = [headers, ...rows]
    .map((r) =>
      r
        .map(
          (v) =>
            '"' +
            String(v ?? "")
              .replace(/^[\s]*[=+@-]/, "'")
              .replaceAll('"', '""') +
            '"',
        )
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}
