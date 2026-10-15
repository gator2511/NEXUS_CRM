import React from "react";
import { test, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import StudentApp from "../src/StudentApp";
import StaffApp from "../src/StaffApp";
import { resetDemo } from "../src/data";
afterEach(cleanup);
test("student submits academic details, uploads evidence; staff verifies, issues offer; student enrols", async () => {
  localStorage.clear();
  resetDemo();
  const user = userEvent.setup();
  let view = render(
    <MemoryRouter>
      <StudentApp />
    </MemoryRouter>,
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Open fictional student portal",
    }),
  );
  await screen.findByRole("heading", {
    name: "Academic & English language details",
  });
  await user.selectOptions(
    screen.getByLabelText("Highest qualification"),
    "Diploma",
  );
  await user.type(screen.getByLabelText("Institution"), "Demo College");
  await user.type(screen.getByLabelText("Year completed"), "2025");
  await user.selectOptions(screen.getByLabelText("Language test"), "IELTS");
  await user.type(screen.getByLabelText("Overall score (if test taken)"), "7");
  await user.type(
    screen.getByLabelText("Test date (if test taken)"),
    new Date().toISOString().slice(0, 10),
  );
  const intake = screen.getByLabelText("Preferred intake");
  await user.selectOptions(intake, intake.options[1].value);
  await user.click(screen.getByRole("button", { name: "Submit details" }));
  await screen.findByRole("heading", { name: "Your application" });
  await user.type(screen.getByLabelText("Date of birth"), "2000-01-01");
  await user.type(screen.getByLabelText("Nationality"), "Australian");
  await user.type(
    screen.getByLabelText("Emergency contact name"),
    "Demo Parent",
  );
  await user.type(
    screen.getByLabelText("Emergency contact phone"),
    "0400000000",
  );
  await user.selectOptions(screen.getByLabelText("Study mode"), "Online");
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  for (const [index, name] of [
    "Passport or photo ID",
    "Academic transcript",
    "English test result",
  ].entries()) {
    await user.upload(
      screen.getByLabelText("Upload " + name),
      new File(["%PDF-1.7 fictional test file"], "test.pdf", {
        type: "application/pdf",
      }),
    );
    await waitFor(() =>
      expect(screen.getAllByText("Pending").length).toBe(index + 1),
    );
  }
  await waitFor(() => expect(screen.getAllByText("Pending").length).toBe(3));
  await user.click(screen.getByRole("button", { name: "Submit application" }));
  await screen.findByRole("heading", { name: "Document review" });
  view.unmount();
  view = render(
    <MemoryRouter>
      <StaffApp />
    </MemoryRouter>,
  );
  await user.click(
    await screen.findByRole("button", { name: "Open workspace" }),
  );
  await user.click(
    (await screen.findAllByText("Amelia Wilson"))[0].closest("button"),
  );
  await screen.findByRole("heading", { name: "Document checklist" });
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Verify" }).length).toBe(3),
  );
  for (let i = 0; i < 3; i++) {
    await user.click(screen.getAllByRole("button", { name: "Verify" })[0]);
    await waitFor(() =>
      expect(screen.queryAllByRole("button", { name: "Verify" }).length).toBe(
        2 - i,
      ),
    );
  }
  await user.click(
    screen.getByRole("button", { name: "Accept & issue offer" }),
  );
  await user.click(screen.getByRole("button", { name: "Confirm & save" }));
  await screen.findByRole("heading", { name: "Issued offer" });
  view.unmount();
  view = render(
    <MemoryRouter>
      <StudentApp />
    </MemoryRouter>,
  );
  await user.click(
    screen.getByRole("button", { name: "Open fictional student portal" }),
  );
  await screen.findByRole("heading", { name: "Your offer is ready" });
  await user.click(
    screen.getByRole("button", { name: "Accept offer & enrol" }),
  );
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  await screen.findByRole("heading", { name: "You’re enrolled" });
});
test("management has reporting and automation without contact editing", async () => {
  resetDemo();
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <StaffApp />
    </MemoryRouter>,
  );
  await user.selectOptions(screen.getByLabelText("Explore as"), "management");
  await user.click(screen.getByRole("button", { name: "Open workspace" }));
  await screen.findByRole("heading", { name: "Recruitment cohort" });
  expect(screen.queryByRole("button", { name: "New enquiry" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Prospects" })).toBeNull();
  expect(screen.getByRole("button", { name: "Run checks now" })).toBeTruthy();
});

test("admin saves approved course criteria and brochure through settings form", async () => {
  resetDemo();
  const { request } = await import("../src/data");
  const { default: CourseAutomation } = await import("../src/CourseAutomation");
  const profile = { role: "admin" };
  const courses = await request("/programs");
  const user = userEvent.setup();
  render(
    <CourseAutomation
      programs={courses}
      profile={profile}
      refresh={async () => {}}
      run={async (fn) => {
        await fn();
        return true;
      }}
      busy={false}
    />,
  );
  await user.click(
    screen.getAllByRole("button", { name: "Configure automation" })[0],
  );
  await user.selectOptions(
    screen.getByLabelText("Minimum academic qualification"),
    "3",
  );
  await user.type(
    screen.getByLabelText("Course brochure URL"),
    "https://example.com/approved.pdf",
  );
  await user.click(
    screen.getByRole("button", { name: "Save course automation" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Save course automation" }),
    ).toBeNull(),
  );
  const saved = (await request("/programs"))[0];
  expect(saved.min_qualification_level).toBe(3);
  expect(saved.brochure_url).toBe("https://example.com/approved.pdf");
});
