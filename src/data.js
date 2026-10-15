import { createClient } from "@supabase/supabase-js";
import { validFile } from "../server/rules.js";
import { initialState, demoRequest } from "./demo.js";
export const demo = import.meta.env.VITE_DEMO_MODE === "true";
export const supabase =
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
    ? createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
      )
    : null;
const key = "nexus-demo-v2";
let state;
function load() {
  if (!state) {
    try {
      state = JSON.parse(localStorage.getItem(key)) || initialState();
    } catch {
      state = initialState();
    }
  }
  return state;
}
export function resetDemo() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const fileKey = localStorage.key(i);
    if (fileKey?.startsWith("nexus-demo-file-"))
      localStorage.removeItem(fileKey);
  }
  state = initialState();
  localStorage.setItem(key, JSON.stringify(state));
}
export async function request(path, method = "GET", body, profile) {
  if (demo) {
    const next = structuredClone(load());
    const data = demoRequest(next, path, method, body, profile);
    state = next;
    localStorage.setItem(key, JSON.stringify(state));
    return structuredClone(data);
  }
  const session = await supabase?.auth.getSession();
  const response = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session?.data.session
        ? { Authorization: "Bearer " + session.data.session.access_token }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Request failed" }));
    throw Error(error.error);
  }
  return response.json();
}
export async function uploadDocument(type, file, profile) {
  if (
    !["application/pdf", "image/jpeg", "image/png"].includes(file.type) ||
    file.size > 10485760 ||
    file.size < 1
  )
    throw Error("Choose a PDF, JPG or PNG up to 10 MB");
  const ticket = await request(
    "/uploads/prepare",
    "POST",
    {
      document_type_id: type,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    },
    profile,
  );
  if (demo) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    if (!validFile(buffer, file.type))
      throw Error("File content does not match its declared format");
    await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        try {
          localStorage.setItem("nexus-demo-file-" + ticket.id, r.result);
          resolve();
        } catch {
          reject(Error("Demo browser storage is full. Use a smaller file."));
        }
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  } else {
    const { error } = await supabase.storage
      .from("nexus-documents")
      .uploadToSignedUrl(ticket.path, ticket.token, file, {
        contentType: file.type,
      });
    if (error) throw Error("Upload failed. Retry or choose a smaller file.");
  }
  return request("/uploads/" + ticket.id + "/complete", "POST", {}, profile);
}
export async function downloadDocument(id, profile) {
  if (demo) {
    const data = localStorage.getItem("nexus-demo-file-" + id);
    if (!data) throw Error("This seeded demo file has no content");
    const a = document.createElement("a");
    a.href = data;
    a.download = "document";
    a.click();
    return;
  }
  const data = await request("/documents/" + id, "GET", null, profile);
  window.open(data.url, "_blank", "noopener,noreferrer");
}
export async function downloadOffer(a, profile) {
  if (demo) {
    const w = window.open("", "_blank");
    if (!w) throw Error("Allow a new window to print the demo offer");
    const p = a.offer_snapshot;
    const escape = (v) =>
      String(v || "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    w.document.write(
      "<title>RIC demo offer</title><h1>RIC — Letter of offer (demo)</h1>" +
        Object.entries(p)
          .map(([k, v]) => "<p><b>" + escape(k) + ": </b>" + escape(v) + "</p>")
          .join(""),
    );
    w.document.close();
    w.print();
    return;
  }
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/offers/" + a.id + "/pdf", {
    headers: { Authorization: "Bearer " + data.session.access_token },
  });
  if (!response.ok) throw Error("Offer letter could not be downloaded");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "RIC-offer.pdf";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
