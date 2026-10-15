import { createClient } from "@supabase/supabase-js";
export function database(token) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)
    throw Object.assign(Error("Database is not configured"), { status: 503 });
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function serviceDatabase() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw Object.assign(Error("Server workflow service is not configured"), {
      status: 503,
    });
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export function check(result) {
  if (result.error)
    throw Object.assign(
      Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Request rejected. Check the required fields, permissions and workflow stage.",
      ),
      { status: 400 },
    );
  return result.data;
}
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
