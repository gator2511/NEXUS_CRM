import { check, serviceDatabase } from "./db.js";
export function emailMessage(row) {
  const p = row.payload;
  const app = (process.env.APP_URL || "http://localhost:5173").replace(
    /\/$/,
    "",
  );
  const messages = {
    Brochure: `Thank you for your enquiry about ${p.program || "your program"}. Course brochure: ${p.brochure_url || "available on request"}. Create your student account and verify your email to continue.`,
    Qualified:
      "Your academic and language details meet the configured entry requirements. Please complete your application.",
    "Qualification review":
      "Your academic and language details are being reviewed by our team.",
    "Not eligible":
      "After reviewing your details we cannot progress this enquiry. Please contact admissions to discuss your options.",
    "Application received":
      "Your application has been received. We will review your documents.",
    "Document rejected": `Please replace ${p.document || "your document"}. Reason: ${p.reason || "See your portal."}`,
    Offer: `An offer is ready in your portal. Please respond before ${p.expires_at}.`,
    "Offer reminder": `Your offer expires at ${p.expires_at}. Please accept or decline in your portal.`,
    "Enrolment confirmation":
      "Your offer acceptance has been recorded and you are enrolled. Welcome to RIC.",
    "Details reminder":
      "Please complete your academic and English language details.",
    "Application reminder": "Please finish and submit your application.",
    "Document reminder": `Please replace ${p.document || "the rejected document"} so we can continue.`,
    Closed:
      "Your enquiry has been closed because we have not received a response. You may submit a new enquiry to restart.",
    "Offer lapsed":
      "Your offer has expired. Contact admissions or submit a new enquiry.",
    "Task escalation": `An assigned task is overdue: ${p.task}. Due: ${p.due_at}.`,
  };
  return {
    subject: `RIC Admissions — ${row.template}`,
    text: `Hi ${p.name},\n\n${messages[row.template] || "There is an update to your recruitment record."}\n\n${app}${row.template === "Task escalation" ? "/" : "/student"}\n\nRIC Admissions`,
  };
}
export async function dispatchEmails() {
  const db = serviceDatabase();
  const rows = check(await db.rpc("claim_emails", { batch_size: 25 }));
  const result = { sent: 0, logged: 0, failed: 0 };
  await Promise.all(
    rows.map(async (row, index) => {
      let outcome = "Logged",
        error = null;
      try {
        if (process.env.EMAIL_DELIVERY_MODE !== "log") {
          if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)
            throw Error("Email delivery is not configured");
          // Stagger each leased batch to avoid a burst against provider limits.
          if (index)
            await new Promise((resolve) => setTimeout(resolve, index * 600));
          const message = emailMessage(row);
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
              "Idempotency-Key": row.id,
            },
            body: JSON.stringify({
              from: process.env.MAIL_FROM,
              to: [row.recipient],
              ...message,
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) throw Error("Email provider rejected delivery");
          outcome = "Sent";
        }
      } catch {
        outcome = "Failed";
        error = "Delivery failed; check provider configuration.";
      }
      check(
        await db.rpc("finish_email", {
          eid: row.id,
          lease: row.claim_token,
          outcome,
          error_text: error,
        }),
      );
      result[outcome.toLowerCase()]++;
    }),
  );
  return result;
}
export async function runJobs() {
  const db = serviceDatabase();
  const jobs = check(await db.rpc("run_workflow_jobs"));
  return { ...jobs, delivery: await dispatchEmails() };
}
