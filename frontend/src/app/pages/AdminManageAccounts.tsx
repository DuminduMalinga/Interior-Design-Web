import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  User,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { supabase } from "../lib/supabaseClient";
import { countNewsReaders, sendProductNews } from "../lib/notifications";
import SiteNavbar from "../components/SiteNavbar";
import PageGlows from "../components/marketing/PageGlows";
import AppFooter from "../components/AppFooter";

type Role = "Admin" | "Customer";
type RoleFilter = "All" | Role;
type SortField = "fullName" | "email" | "role" | "lastSignIn";
type SortDir = "asc" | "desc";

interface UserAccount {
  id: string;
  fullName: string;
  username: string;
  email: string;
  lastSignIn: string | null;
  role: Role;
  initials: string;
  avatarUrl: string | null;
}

type UserRow = {
  UserID: string;
  UserName: string | null;
  FullName: string | null;
  Email: string | null;
  LastSignIn: string | null;
  Role: string | null;
  AvatarUrl: string | null;
};

const PAGE_SIZE = 10;

function getInitials(fullName: string, username: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const fallback = username.trim().replace(/[^a-zA-Z0-9]/g, "");
  return (parts.length > 0 ? parts : [fallback || "User"])
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "U")
    .join("");
}

function mapUserRow(row: UserRow): UserAccount {
  const fullName = row.FullName?.trim() || "Unnamed user";
  const username = row.UserName?.trim() || row.Email?.split("@")[0] || "user";
  return {
    id: row.UserID,
    fullName,
    username,
    email: row.Email?.trim() || "",
    lastSignIn: row.LastSignIn ?? null,
    role: row.Role?.trim().toLowerCase() === "admin" ? "Admin" : "Customer",
    initials: getInitials(fullName, username),
    avatarUrl: row.AvatarUrl?.trim() || null,
  };
}

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/** "Today", "3 days ago", "2 months ago" or "Never". */
function lastActiveLabel(lastSignIn: string | null) {
  if (!lastSignIn) return "Never";
  const days = daysSince(lastSignIn);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "A month ago" : `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "A year ago" : `${years} years ago`;
}

function Avatar({ initials, avatarUrl, size = "md" }: { initials: string; avatarUrl?: string | null; size?: "md" | "lg" }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-lv-wash font-medium text-lv-ink ${
        size === "lg" ? "h-16 w-16 text-lg" : "h-10 w-10 text-sm"
      }`}
    >
      {avatarUrl && !failed
        ? <img src={avatarUrl} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        : initials}
    </span>
  );
}

function RolePill({ role }: { role: Role }) {
  return (
    <span
      className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-medium ${
        role === "Admin" ? "bg-lv-ink text-lv-on-ink" : "border border-lv-line text-lv-muted"
      }`}
    >
      {role}
    </span>
  );
}

/** Green when the person signed in during the last week. */
function ActivityDot({ lastSignIn }: { lastSignIn: string | null }) {
  const recent = lastSignIn !== null && daysSince(lastSignIn) < 7;
  return <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${recent ? "bg-emerald-500" : "bg-lv-muted/40"}`} />;
}

/** Shared dialog frame: dimmed backdrop; Escape and a backdrop click close it. */
function Dialog({
  labelledBy,
  onClose,
  locked = false,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  locked?: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !locked && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, locked]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={() => !locked && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#000]/45 p-4 backdrop-blur-sm"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-[28px] border border-lv-line bg-lv-surface p-6 shadow-2xl sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={locked}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-10 w-10 cursor-pointer place-items-center rounded-full text-lv-muted transition-colors hover:bg-lv-ink/8 hover:text-lv-ink disabled:opacity-40"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        {children}
      </motion.div>
    </motion.div>
  );
}

function ViewUserDialog({ user, isYou, onClose }: { user: UserAccount; isYou: boolean; onClose: () => void }) {
  const rows = [
    { label: "Email", value: user.email || "Not set" },
    { label: "Username", value: `@${user.username}` },
    { label: "Last active", value: lastActiveLabel(user.lastSignIn) },
  ];
  return (
    <Dialog labelledBy="view-user-title" onClose={onClose}>
      <Avatar initials={user.initials} avatarUrl={user.avatarUrl} size="lg" />
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <h2 id="view-user-title" className="text-2xl leading-tight text-lv-ink">{user.fullName}</h2>
        {isYou && <span className="text-sm text-lv-muted">(you)</span>}
      </div>
      <div className="mt-2"><RolePill role={user.role} /></div>
      <dl className="mt-6 divide-y divide-lv-line border-t border-lv-line">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-sm text-lv-muted">{label}</dt>
            <dd className="min-w-0 truncate text-right text-sm text-lv-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

function DeleteUserDialog({
  user,
  onCancel,
  onConfirm,
}: {
  user: UserAccount;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const matches = typed.trim() === user.username;

  const submit = async () => {
    if (!matches || submitting) return;
    setSubmitting(true);
    await onConfirm();
    setSubmitting(false);
  };

  return (
    <Dialog labelledBy="delete-user-title" onClose={onCancel} locked={submitting}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-red-500/15">
        <Trash2 className="h-5 w-5 text-red-400" aria-hidden="true" />
      </span>
      <h2 id="delete-user-title" className="mt-5 text-2xl leading-tight text-lv-ink">Delete this account?</h2>
      <p className="mt-2 text-sm leading-relaxed text-lv-muted">
        <span className="text-lv-ink">{user.fullName}</span> ({user.email || `@${user.username}`}) will be signed out and
        removed with all of their floor plans and designs. This can't be undone.
      </p>

      <form className="mt-6" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label htmlFor="delete-confirm" className="mb-1.5 block text-sm text-lv-muted">
          Type <span className="font-medium text-lv-ink">{user.username}</span> to confirm
        </label>
        <input
          id="delete-confirm"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="lv-input"
        />
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={submitting} className="lv-btn-quiet">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!matches || submitting}
            className="lv-btn bg-red-500! text-[#fff]! hover:bg-red-600!"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
            {submitting ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function NewsDialog({ onClose, onSent, onTestSent }: { onClose: () => void; onSent: (recipients: number) => void; onTestSent: () => void }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [readers, setReaders] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = subject.trim() !== "" && message.trim() !== "";

  useEffect(() => {
    let cancelled = false;
    countNewsReaders().then((n) => { if (!cancelled) setReaders(n); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const submit = async (testOnly = false) => {
    if (!ready || sending || (!testOnly && readers === 0)) return;
    setSending(true);
    setError(null);
    try {
      const recipients = await sendProductNews(subject.trim(), message.trim(), testOnly);
      if (testOnly) onTestSent();
      else onSent(recipients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog labelledBy="news-title" onClose={onClose} locked={sending}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-lv-wash">
        <Mail className="h-5 w-5 text-lv-ink" aria-hidden="true" />
      </span>
      <h2 id="news-title" className="mt-5 text-2xl leading-tight text-lv-ink">Send product news</h2>
      <p className="mt-2 text-sm leading-relaxed text-lv-muted">
        {readers === null
          ? "Emailed to everyone who turned on Product news."
          : readers === 0
            ? "Nobody has Product news turned on, so there is no one to send this to."
            : `Emailed to ${readers} ${readers === 1 ? "person" : "people"} who turned on Product news. It can't be unsent.`}
      </p>

      <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div>
          <label htmlFor="news-subject" className="mb-1.5 block text-sm text-lv-muted">Subject</label>
          <input id="news-subject" autoFocus maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} className="lv-input" />
        </div>
        <div>
          <label htmlFor="news-message" className="mb-1.5 block text-sm text-lv-muted">Message</label>
          <textarea id="news-message" rows={7} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} className="lv-input resize-y" />
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <button type="button" onClick={onClose} disabled={sending} className="lv-btn-quiet">Cancel</button>
          <button type="button" onClick={() => void submit(true)} disabled={!ready || sending} className="lv-btn-quiet">
            Send me a test
          </button>
          <button type="submit" disabled={!ready || sending || readers === 0} className="lv-btn">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
            {sending ? "Sending…" : "Send to everyone"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default function AdminManageAccounts() {
  const reduceMotion = useReducedMotion();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("All");
  const [sort, setSort] = useState<{ f: SortField; d: SortDir }>({ f: "fullName", d: "asc" });
  const [page, setPage] = useState(1);

  const [viewTarget, setViewTarget] = useState<UserAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null);
  const [newsOpen, setNewsOpen] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 3200);
  };

  const loadUsers = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [{ data: authData }, { data: rows, error }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("User").select("UserID, UserName, FullName, Email, LastSignIn, Role, AvatarUrl").order("FullName", { ascending: true }),
      ]);
      if (error) setLoadError(error.message);
      else setUsers((rows ?? []).map((row) => mapUserRow(row as UserRow)));
      setCurrentAdminId(authData.user?.id ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load accounts.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    const channel = supabase
      .channel("admin-user-table-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "User" }, () => { void loadUsers(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const counts = useMemo(() => ({
    All: users.length,
    Admin: users.filter((u) => u.role === "Admin").length,
    Customer: users.filter((u) => u.role === "Customer").length,
  }), [users]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const arr = users.filter((u) =>
      (roleFilter === "All" || u.role === roleFilter) &&
      (!q || u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    );
    const key = (u: UserAccount) =>
      sort.f === "lastSignIn" ? (u.lastSignIn ? new Date(u.lastSignIn).getTime() : 0) : u[sort.f].toLowerCase();
    return arr.sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      if (va < vb) return sort.d === "asc" ? -1 : 1;
      if (va > vb) return sort.d === "asc" ? 1 : -1;
      return 0;
    });
  }, [users, search, roleFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageUsers = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = search !== "" || roleFilter !== "All";

  const handleSort = (f: SortField) => {
    setSort((prev) => (prev.f === f ? { f, d: prev.d === "asc" ? "desc" : "asc" } : { f, d: f === "lastSignIn" ? "desc" : "asc" }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("All");
    setPage(1);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const { error } = await supabase.from("User").delete().eq("UserID", target.id);
      if (error) { showToast("error", error.message); return; }

      // Revoke their login and sessions.
      const { error: fnError } = await supabase.functions.invoke("delete-user", { body: { userId: target.id } });
      if (fnError) console.warn("Auth user deletion warning:", fnError.message);

      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      setDeleteTarget(null);
      showToast("success", `Deleted ${target.fullName}'s account.`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Couldn't delete the account.");
    }
  };

  const stats = [
    { label: "Total Users", value: counts.All, icon: Users, tint: "bg-lv-wash/60 text-lv-accent" },
    { label: "Admins", value: counts.Admin, icon: ShieldCheck, tint: "bg-violet-500/10 text-violet-500" },
    { label: "Customers", value: counts.Customer, icon: User, tint: "bg-emerald-500/10 text-emerald-600" },
  ];

  const columns: { key: SortField; label: string; className: string }[] = [
    { key: "fullName", label: "Name", className: "" },
    { key: "email", label: "Email", className: "hidden md:table-cell" },
    { key: "role", label: "Role", className: "hidden sm:table-cell" },
    { key: "lastSignIn", label: "Last active", className: "hidden lg:table-cell" },
  ];

  const roleTabs: { id: RoleFilter; label: string }[] = [
    { id: "All", label: "All" },
    { id: "Admin", label: "Admins" },
    { id: "Customer", label: "Customers" },
  ];

  return (
    <div className="relative isolate flex min-h-screen w-full flex-col bg-background">
      <PageGlows />
      <SiteNavbar />

      <AnimatePresence>
        {viewTarget && (
          <ViewUserDialog user={viewTarget} isYou={viewTarget.id === currentAdminId} onClose={() => setViewTarget(null)} />
        )}
        {deleteTarget && (
          <DeleteUserDialog user={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirm} />
        )}
        {newsOpen && (
          <NewsDialog
            onClose={() => setNewsOpen(false)}
            onSent={(n) => { setNewsOpen(false); showToast("success", `Product news sent to ${n} ${n === 1 ? "person" : "people"}.`); }}
            onTestSent={() => showToast("success", "Test sent to your own address. Check your inbox.")}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 16 }}
            className="fixed bottom-6 left-1/2 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-full bg-lv-ink px-5 py-3 text-sm text-lv-on-ink shadow-2xl"
          >
            {toast.type === "success"
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
              : <XCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative w-full flex-1 overflow-x-clip px-4 pb-16 pt-8 md:px-8 md:pt-12">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-4xl leading-[1.05] tracking-tight text-lv-ink md:text-5xl">Manage user accounts</h1>
              <p className="mt-3 text-base text-lv-muted">View, search and manage registered users.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <button type="button" onClick={() => setNewsOpen(true)} className="lv-btn-quiet bg-lv-surface/70">
                <Mail className="h-4 w-4" aria-hidden="true" />
                Send product news
              </button>
              <button type="button" onClick={() => void loadUsers()} disabled={isLoading} className="lv-btn-quiet bg-lv-surface/70">
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
                Refresh
              </button>
            </div>
          </div>

          {/* Stats */}
          <ul className="mt-10 grid gap-3 sm:grid-cols-3">
            {stats.map(({ label, value, icon: Icon, tint }) => (
              <li key={label} className="flex items-center gap-4 rounded-[24px] border border-lv-line bg-lv-surface p-5">
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tint}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-3xl leading-none tracking-tight text-lv-ink">{isLoading && users.length === 0 ? "–" : value}</p>
                  <p className="mt-1.5 text-sm text-lv-muted">{label}</p>
                </div>
              </li>
            ))}
          </ul>

          {/* Role tabs and search */}
          <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div role="tablist" aria-label="Filter by role"
              className="flex w-full gap-1 rounded-full border border-lv-line bg-lv-surface/70 p-1 backdrop-blur-xl md:w-auto">
              {roleTabs.map(({ id, label }) => {
                const isActive = roleFilter === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => { setRoleFilter(id); setPage(1); }}
                    className={`relative inline-flex h-10 flex-1 cursor-pointer items-center justify-center rounded-full px-5 text-sm transition-colors md:flex-none ${
                      isActive ? "text-lv-on-ink" : "text-lv-ink hover:bg-lv-ink/8"
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="admin-role-pill"
                        className="absolute inset-0 rounded-full bg-lv-ink"
                        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 34 }}
                      />
                    )}
                    <span className="relative">{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full md:max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-lv-muted" aria-hidden="true" />
              <label htmlFor="account-search" className="sr-only">Search accounts</label>
              <input
                id="account-search"
                type="search"
                placeholder="Search by name, username or email"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="lv-input rounded-full! pl-11"
              />
            </div>
          </div>

          {/* Table */}
          <div className="mt-4 overflow-hidden rounded-[28px] border border-lv-line bg-lv-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-lv-line">
                  {columns.map(({ key, label, className }) => {
                    const isSorted = sort.f === key;
                    return (
                      <th key={key} scope="col" className={`px-5 py-3 font-normal ${className}`}
                        aria-sort={isSorted ? (sort.d === "asc" ? "ascending" : "descending") : "none"}>
                        <button type="button" onClick={() => handleSort(key)}
                          className={`-mx-2 inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-full px-2 transition-colors hover:text-lv-ink ${
                            isSorted ? "text-lv-ink" : "text-lv-muted"
                          }`}>
                          {label}
                          {isSorted
                            ? (sort.d === "asc" ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />)
                            : <ChevronDown className="h-3.5 w-3.5 opacity-0" aria-hidden="true" />}
                        </button>
                      </th>
                    );
                  })}
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lv-line">
                {pageUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-20 text-center">
                      <div className="flex flex-col items-center gap-3 text-lv-muted">
                        {isLoading ? (
                          <><Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /><p>Loading accounts…</p></>
                        ) : loadError ? (
                          <>
                            <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden="true" />
                            <p className="text-lv-ink">Couldn't load accounts</p>
                            <p className="max-w-sm text-sm">{loadError}</p>
                            <button type="button" onClick={() => void loadUsers()} className="lv-link text-sm">Try again</button>
                          </>
                        ) : (
                          <>
                            <Users className="h-6 w-6" aria-hidden="true" />
                            <p>{hasFilters ? "No accounts match your search." : "No accounts yet."}</p>
                            {hasFilters && <button type="button" onClick={clearFilters} className="lv-link text-sm">Clear filters</button>}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  pageUsers.map((user) => {
                    const isYou = user.id === currentAdminId;
                    return (
                      <tr key={user.id} className="transition-colors hover:bg-lv-ink/[0.03]">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <Avatar initials={user.initials} avatarUrl={user.avatarUrl} />
                            <div className="min-w-0">
                              <p className="truncate text-lv-ink">
                                {user.fullName}
                                {isYou && <span className="ml-2 text-xs text-lv-muted">(you)</span>}
                              </p>
                              <p className="truncate text-xs text-lv-muted">
                                <span className="md:hidden">{user.email || `@${user.username}`}</span>
                                <span className="hidden md:inline">@{user.username}</span>
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden max-w-[16rem] truncate px-5 py-3.5 text-lv-muted md:table-cell">{user.email}</td>
                        <td className="hidden px-5 py-3.5 sm:table-cell"><RolePill role={user.role} /></td>
                        <td className="hidden px-5 py-3.5 lg:table-cell">
                          <span className="inline-flex items-center gap-2 text-lv-muted">
                            <ActivityDot lastSignIn={user.lastSignIn} />
                            {lastActiveLabel(user.lastSignIn)}
                          </span>
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => setViewTarget(user)}
                              aria-label={`View ${user.fullName}`} title="View details"
                              className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-lv-muted transition-colors hover:bg-lv-ink/8 hover:text-lv-ink">
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button type="button"
                              onClick={() => {
                                if (user.role === "Admin") {
                                  showToast("error", "Admin accounts cannot be deleted.");
                                  return;
                                }
                                setDeleteTarget(user);
                              }}
                              disabled={isYou}
                              aria-label={`Delete ${user.fullName}`}
                              title={isYou ? "You can't delete your own account here" : user.role === "Admin" ? "Admin accounts cannot be deleted" : "Delete account"}
                              className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-lv-muted transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-lv-muted">
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {filtered.length > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-4 border-t border-lv-line px-5 py-3">
                <p className="text-sm text-lv-muted">
                  {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page"
                    className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-lv-ink transition-colors hover:bg-lv-ink/8 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <span className="px-2 text-sm text-lv-muted">{currentPage} / {totalPages}</span>
                  <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages} aria-label="Next page"
                    className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-lv-ink transition-colors hover:bg-lv-ink/8 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent">
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
