import { supabase } from "./supabaseClient";

export type NotificationPrefs = { email: boolean; browser: boolean; updates: boolean };
export const DEFAULT_NOTIFICATIONS: NotificationPrefs = { email: true, browser: false, updates: true };

/** The signed-in user's choices, kept so a page can check them without asking the database every time. */
let cache: { userId: string; prefs: NotificationPrefs } | null = null;

export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_NOTIFICATIONS;
  if (cache?.userId === user.id) return cache.prefs;
  const { data, error } = await supabase.from("User").select("NotificationPrefs").eq("UserID", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  const prefs = { ...DEFAULT_NOTIFICATIONS, ...(data?.NotificationPrefs ?? {}) };
  cache = { userId: user.id, prefs };
  return prefs;
}

export async function saveNotificationPrefs(next: NotificationPrefs): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Session expired. Please sign in again.");
  const { error } = await supabase.from("User").update({ NotificationPrefs: next }).eq("UserID", user.id);
  if (error) throw new Error(error.message);
  cache = { userId: user.id, prefs: next };
}

export const browserNotificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

/** Asks the browser for permission to show alerts. True when the user allowed them. */
export async function allowBrowserNotifications(): Promise<boolean> {
  if (!browserNotificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

/**
 * Shows an alert when the user turned browser notifications on and allowed
 * them. It only appears while the tab is in the background: someone looking at
 * the page already sees what happened. `force` shows it regardless (for the
 * confirmation right after switching the option on).
 */
export async function notifyBrowser(title: string, body: string, force = false): Promise<void> {
  try {
    if (!browserNotificationsSupported() || Notification.permission !== "granted") return;
    if (!force && !document.hidden) return;
    if (!force && !(await loadNotificationPrefs()).browser) return;
    const alert = new Notification(title, { body, tag: title });
    alert.onclick = () => { window.focus(); alert.close(); };
  } catch {
    // an alert that cannot be shown must never break the page
  }
}

/**
 * Asks the server to email the signed-in user ("plan_ready" or "design_saved").
 * The server checks their Email switch, so this is safe to call every time.
 * It never throws: an email that cannot be sent must not break the page.
 */
export async function emailMe(kind: "plan_ready" | "design_saved", params: Record<string, string | number> = {}): Promise<void> {
  try {
    await supabase.functions.invoke("send-notification", { body: { kind, params } });
  } catch {
    // ignored on purpose
  }
}

/** People who will receive product news: those with the "Product news" switch on. Admins only. */
export async function countNewsReaders(): Promise<number> {
  const { count, error } = await supabase
    .from("User")
    .select("UserID", { count: "exact", head: true })
    .filter("NotificationPrefs->>updates", "eq", "true");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const NEWS_PROBLEMS: Record<string, string> = {
  not_configured: "Email isn't set up yet. Add the RESEND_API_KEY secret in Supabase, then try again.",
  limit: "You've reached today's email limit. Try again tomorrow.",
  provider_error: "The email service refused the message. Check the API key and sender address in Supabase.",
  domain_not_verified: "Resend only delivers to your own address until you verify a domain there. Use \"Send me a test\", or verify a domain in Resend and set MAIL_FROM to an address on it.",
};

/** Emails a product-news message to everyone who wants it. Returns how many people it went to. */
export async function sendProductNews(subject: string, message: string, testOnly = false): Promise<number> {
  const { data, error } = await supabase.functions.invoke("send-notification", {
    body: { kind: "news", params: { subject, message, testOnly } },
  });
  if (error) {
    let reason = "";
    try {
      const body = await (error as { context?: Response }).context?.json();
      reason = String(body?.reason ?? body?.error ?? "");
    } catch {
      // no readable reply
    }
    throw new Error(NEWS_PROBLEMS[reason] ?? (reason || "The message could not be sent."));
  }
  return Number(data?.recipients ?? 0);
}
