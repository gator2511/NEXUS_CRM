import PDFDocument from "pdfkit";
export function offerPdf(snapshot) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 60 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(23).fillColor("#123c50").text("RIC | Letter of offer");
    doc.moveDown();
    doc
      .fontSize(10)
      .fillColor("#283e4d")
      .text("Reference: " + snapshot.reference);
    doc.moveDown();
    doc.fontSize(12).text("Dear " + snapshot.name + ",");
    doc.moveDown();
    doc.text("We are pleased to offer you a place in the following program.");
    for (const [label, key] of [
      ["Program", "program"],
      ["Intake", "intake"],
      ["Start date", "intake_start"],
      ["Study mode", "study_mode"],
      ["Issued", "issued_at"],
      ["Accept before", "expires_at"],
    ]) {
      doc.moveDown(0.6);
      doc.text(label + ": " + (snapshot[key] || "To be confirmed"));
    }
    doc.moveDown(2);
    doc.text(
      "Sign in to your student portal to accept or decline this offer. The offer expires at the timestamp shown above.",
    );
    doc.moveDown(2);
    doc.text("RIC Admissions");
    doc.end();
  });
}
