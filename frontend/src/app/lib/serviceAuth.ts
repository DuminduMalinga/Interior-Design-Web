import { supabase } from "./supabaseClient";

/**
 * The detector and layout services only answer signed-in users. This is the
 * header they check: the Supabase access token the browser already holds
 * (getSession refreshes it first if it has expired).
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Please sign in again.");
  return { Authorization: `Bearer ${token}` };
}
