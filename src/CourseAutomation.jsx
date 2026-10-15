import React, { useState } from "react";
import { qualificationLevels } from "../server/rules";
import { request } from "./data";

export default function CourseAutomation({
  programs,
  profile,
  refresh,
  run,
  busy,
}) {
  const [editing, setEditing] = useState(null);
  return (
    <>
      <h3>Course automations</h3>
      <p>
        Submitting academic and English details checks the selected course
        automatically. Passing students progress to Qualified; borderline,
        missing evidence and failed checks go to staff review. Saving a draft
        does not qualify a student.
      </p>
      <p>
        Each enquiry queues an email with the selected course’s brochure
        download link. Use a public HTTPS link to the approved brochure. Email
        delivery requires the recruitment email provider to be enabled.
      </p>
      {programs.map((g) => (
        <div className="audit-row" key={g.id}>
          <b>{g.name}</b>
          <span>
            Criteria:{" "}
            {g.min_qualification_level && g.language_requirements
              ? "Configured"
              : "Needs setup"}{" "}
            · Brochure:{" "}
            {g.brochure_url ? "Configured" : "Missing — staff follow-up"}
          </span>
          <button onClick={() => setEditing(g)}>Configure automation</button>
        </div>
      ))}
      {editing && (
        <form
          key={editing.id}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const language_requirements = {};
            for (const test of ["IELTS", "PTE", "TOEFL"])
              if (f.get(test) !== "")
                language_requirements[test] = Number(f.get(test));
            const ok = await run(async () => {
              await request(
                `/programs/${editing.id}/automation`,
                "POST",
                {
                  min_qualification_level: Number(f.get("level")),
                  language_requirements,
                  brochure_url: f.get("brochure"),
                },
                profile,
              );
              await refresh();
            }, "Course automation saved. Applies to new submissions and enquiries.");
            if (ok) setEditing(null);
          }}
        >
          <h4>{editing.name}</h4>
          <label>
            Minimum academic qualification
            <select
              name="level"
              required
              defaultValue={editing.min_qualification_level || ""}
            >
              <option value="">Choose approved minimum</option>
              {qualificationLevels.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {["IELTS", "PTE", "TOEFL"].map((test) => (
            <label key={test}>
              {test} minimum score
              <input
                name={test}
                type="number"
                step={test === "IELTS" ? "0.5" : "1"}
                min={test === "PTE" ? 10 : 0}
                max={test === "IELTS" ? 9 : test === "PTE" ? 90 : 120}
                defaultValue={editing.language_requirements?.[test] ?? ""}
              />
            </label>
          ))}
          <p className="muted">
            Leave unsupported tests blank; those submissions require staff
            review. Enter approved RIC requirements only. Changes do not
            reassess previous submissions.
          </p>
          <label>
            Course brochure URL
            <input
              name="brochure"
              type="url"
              placeholder="https://your-domain.com/course-brochure.pdf"
              defaultValue={editing.brochure_url || ""}
            />
          </label>
          <div className="actions">
            <button className="primary" disabled={busy}>
              Save course automation
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}
