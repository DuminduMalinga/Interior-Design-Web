import { useState, useMemo, useRef, useEffect } from "react";
import {
  Box,
  LogOut,
  LayoutDashboard,
  Users,
  ShieldCheck,
  Trash2,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Download,
  Filter,
  User,
  Lock,
  Menu,
  Bell,
  RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabaseClient";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type Role = "Admin" | "Customer";
type SortField = "id" | "fullName" | "username" | "email" | "role";
type SortDir = "asc" | "desc";

interface UserAccount {
  id: string;
  fullName: string;
  username: string;
  email: string;
  password: string;
  role: Role;
  avatar: string;
}

const PAGE_SIZE = 10;

// ─────────────────────────────────────────────
// Sidebar nav items
// ─────────────────────────────────────────────
const ADMIN_NAV = [
  { id: "dashboard",   label: "Dashboard",       icon: LayoutDashboard, path: "/dashboard" },
  { id: "accounts",    label: "Manage Accounts", icon: Users,           path: "/admin/accounts" },
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function avatarColor(initials: string) {
  const colors = [
    "from-blue-500 to-indigo-600",
    "from-purple-500 to-violet-600",
    "from-emerald-500 to-teal-600",
    "from-rose-500 to-pink-600",
    "from-amber-500 to-orange-600",
    "from-cyan-500 to-sky-600",
  ];
  const idx = (initials.charCodeAt(0) + initials.charCodeAt(1)) % colors.length;
  return colors[idx];
}

function SortIcon({ field, sort }: { field: SortField; sort: { f: SortField; d: SortDir } }) {
  if (sort.f !== field)
    return (
      <span className="opacity-25 ml-1">
        <ChevronUp className="w-3 h-3 inline -mb-0.5" />
      </span>
    );
  return sort.d === "asc" ? (
    <ChevronUp className="w-3.5 h-3.5 inline ml-1 text-teal-400" />
  ) : (
    <ChevronDown className="w-3.5 h-3.5 inline ml-1 text-teal-400" />
  );
}

type UserRow = {
  UserID: string;
  UserName: string | null;
  FullName: string | null;
  Email: string | null;
  Password: string | null;
  Role: string | null;
};

function getInitials(fullName: string, username: string) {
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  const fallback = username.trim().replace(/[^a-zA-Z0-9]/g, "");
  const primary = nameParts.length > 0 ? nameParts : [fallback || "User"];
  return primary
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "U")
    .join("")
    .slice(0, 2);
}

function mapUserRow(row: UserRow): UserAccount {
  const fullName = row.FullName?.trim() || "Unnamed User";
  const username = row.UserName?.trim() || row.Email?.split("@")[0] || row.UserID;
  const email = row.Email?.trim() || "";
  const password = row.Password?.trim() || "";
  const role = row.Role?.trim().toLowerCase() === "admin" ? "Admin" : "Customer";

  return {
    id: row.UserID,
    fullName,
    username,
    email,
    password,
    role,
    avatar: getInitials(fullName, username),
  };
}

function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 2)}${"•".repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}

// ─────────────────────────────────────────────
// Delete Confirmation Modal
// ─────────────────────────────────────────────
function DeleteModal({
  user,
  onCancel,
  onConfirm,
}: {
  user: UserAccount;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [adminPass, setAdminPass] = useState("");
  const [passError, setPassError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 120);
  }, []);

  const handleConfirm = () => {
    if (adminPass.length === 0) {
      setPassError(true);
      return;
    }
    onConfirm();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#0f0f17] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Red header */}
        <div className="bg-gradient-to-r from-red-500 to-rose-600 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2.5 rounded-xl">
              <AlertTriangle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg">Delete Account</h3>
              <p className="text-red-100 text-xs">This action is permanent and cannot be undone</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* User Preview */}
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
            <div
              className={`w-11 h-11 rounded-xl bg-gradient-to-br ${avatarColor(user.avatar)} flex items-center justify-center text-white font-bold text-sm shrink-0`}
            >
              {user.avatar}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-zinc-100 text-sm truncate">{user.fullName}</p>
              <p className="text-xs text-zinc-500 truncate">{user.email}</p>
              <p className="text-xs text-zinc-600">@{user.username}</p>
            </div>
          </div>

          {/* Warning text */}
          <div className="text-center space-y-1">
            <p className="text-zinc-100 font-semibold text-sm">
              Are you sure you want to permanently delete this account?
            </p>
            <p className="text-zinc-500 text-xs">
              This removes the user record and any linked profile data from the database.
            </p>
          </div>

          {/* Admin password */}
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-gray-500" />
              Confirm with your admin password
            </label>
            <input
              ref={inputRef}
              type="password"
              placeholder="Enter admin password…"
              value={adminPass}
              onChange={(e) => { setAdminPass(e.target.value); setPassError(false); }}
              onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm outline-none transition-all bg-white/5 text-zinc-200 placeholder:text-zinc-600 ${
                passError
                  ? "border-red-500/40 ring-2 ring-red-500/20"
                  : "border-white/10 focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20"
              }`}
            />
            {passError && (
              <p className="text-red-500 text-[11px] mt-1 flex items-center gap-1">
                <XCircle className="w-3 h-3" /> Password is required.
              </p>
            )}
          </div>

          {/* Cannot be undone banner */}
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-amber-300 text-[11px] font-semibold">
              Warning: This action cannot be undone. The account will be permanently removed.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-300 font-semibold text-sm hover:bg-white/10 transition-all"
            >
              Cancel
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleConfirm}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold text-sm shadow-md shadow-red-200 hover:shadow-red-300 transition-all flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Confirm Delete
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// View User Modal
// ─────────────────────────────────────────────
function ViewUserModal({
  user,
  onClose,
}: {
  user: UserAccount;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 16 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[#0f0f17] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${avatarColor(user.avatar)} flex items-center justify-center text-white font-bold text-base`}>
            {user.avatar}
          </div>
          <div>
            <h3 className="text-white font-bold">{user.fullName}</h3>
            <p className="text-teal-300 text-xs">@{user.username}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-3">
          {[
            { label: "User ID", value: user.id, icon: User },
            { label: "Full Name", value: user.fullName, icon: User },
            { label: "Email", value: user.email, icon: User },
            { label: "Password", value: user.password ? maskSecret(user.password) : "Not set", icon: Lock },
            { label: "Role", value: user.role, icon: ShieldCheck },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
              <Icon className="w-4 h-4 text-teal-400 shrink-0" />
              <span className="text-xs text-zinc-500 w-24 shrink-0">{label}</span>
              <span className={`text-xs font-semibold truncate ${label === "Role" && value === "Admin" ? "text-indigo-700" : "text-gray-800"}`}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// Main Admin Page
// ─────────────────────────────────────────────
export default function AdminManageAccounts() {
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("accounts");
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);
  const [currentAdminName, setCurrentAdminName] = useState("Administrator");
  const [currentAdminUsername, setCurrentAdminUsername] = useState("admin");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search & filter
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"All" | Role>("All");

  // Sort
  const [sort, setSort] = useState<{ f: SortField; d: SortDir }>({ f: "fullName", d: "asc" });

  // Pagination
  const [page, setPage] = useState(1);

  // Modals
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null);
  const [viewTarget, setViewTarget] = useState<UserAccount | null>(null);

  // Notifications
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const loadUsers = async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [{ data: authData, error: authError }, { data: userRows, error: usersError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("User").select("UserID, UserName, FullName, Email, Role").order("FullName", { ascending: true }),
      ]);

      if (authError) {
        setLoadError(authError.message);
      }

      if (usersError) {
        setLoadError(usersError.message);
      } else {
        setUsers((userRows ?? []).map((row) => mapUserRow(row as UserRow)));
      }

      const currentUser = authData.user;
      setCurrentAdminId(currentUser?.id ?? null);

      if (currentUser) {
        const { data: currentRow } = await supabase
          .from("User")
          .select("UserName, FullName, Email")
          .eq("UserID", currentUser.id)
          .maybeSingle();

        const metadata = currentUser.user_metadata as Record<string, unknown> | undefined;
        const fallbackName = typeof metadata?.full_name === "string" && metadata.full_name ? metadata.full_name : currentUser.email?.split("@")[0] ?? "Administrator";
        const fallbackUsername = typeof metadata?.username === "string" && metadata.username ? metadata.username : currentUser.email?.split("@")[0] ?? "admin";

        setCurrentAdminName(currentRow?.FullName?.trim() || fallbackName);
        setCurrentAdminUsername(currentRow?.UserName?.trim() || fallbackUsername);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unable to load users from the database.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();

    const channel = supabase
      .channel("admin-user-table-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "User" },
        () => {
          void loadUsers();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // Show toast helper
  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3200);
  };

  // ── Filter + Sort pipeline ──────────────────
  const filtered = useMemo(() => {
    let arr = [...users];
    const q = search.toLowerCase().trim();
    if (q)
      arr = arr.filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      );
    if (roleFilter !== "All") arr = arr.filter((u) => u.role === roleFilter);

    arr.sort((a, b) => {
      let va: string | number = a[sort.f as keyof UserAccount] as string | number;
      let vb: string | number = b[sort.f as keyof UserAccount] as string | number;
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return sort.d === "asc" ? -1 : 1;
      if (va > vb) return sort.d === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [users, search, roleFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageUsers = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (f: SortField) => {
    setSort((prev) =>
      prev.f === f ? { f, d: prev.d === "asc" ? "desc" : "asc" } : { f, d: "asc" }
    );
    setPage(1);
  };

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("All");
    setPage(1);
  };

  const hasFilters = search || roleFilter !== "All";

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from("User").delete().eq("UserID", deleteTarget.id);
      if (error) {
        showToast("error", error.message);
        return;
      }

      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
      showToast("success", `Account "${deleteTarget.username}" deleted successfully.`);
      if (pageUsers.length === 1 && page > 1) setPage((p) => p - 1);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to delete account.");
    }
  };

  const handleExportCSV = () => {
    const header = "ID,Full Name,Username,Email,Role\n";
    const rows = filtered
      .map((u) =>
        [u.id, u.fullName, u.username, u.email, u.role].join(
          ","
        )
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users_export.csv";
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", "User list exported as CSV.");
  };

  // Stats
  const stats = {
    total: users.length,
    admins: users.filter((u) => u.role === "Admin").length,
    customers: users.filter((u) => u.role === "Customer").length,
  };

  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="absolute inset-0 dot-grid pointer-events-none" />
      <div className="absolute top-1/4 right-1/3 w-[400px] h-[400px] bg-teal-500/4 rounded-full blur-[100px] pointer-events-none" />

      {/* ── Modals ── */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteModal
            user={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={handleDeleteConfirm}
          />
        )}
        {viewTarget && (
          <ViewUserModal
            user={viewTarget}
            onClose={() => setViewTarget(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -24, scale: 0.95 }}
            className={`fixed top-5 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2.5 px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold ${
              toast.type === "success"
                ? "bg-green-600 text-white"
                : "bg-red-600 text-white"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Top Navigation ── */}
      <nav className="relative glass-nav z-30">
        <div className="px-4 md:px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo + hamburger */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen((p) => !p)}
                className="lg:hidden text-gray-600 hover:text-gray-800 p-1"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => navigate("/dashboard")}
              >
                <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-2 rounded-xl shadow-lg shadow-teal-500/20">
                  <Box className="w-7 h-7 text-white" strokeWidth={1.5} />
                </div>
                <div className="hidden md:block">
                  <h1 className="text-base font-bold text-white">3D Layout System</h1>
                  <p className="text-[11px] text-zinc-500">AI-Powered Design</p>
                </div>
              </div>
              {/* Admin badge */}
              <span className="hidden sm:flex items-center gap-1 bg-teal-500/10 text-teal-400 text-[11px] font-bold px-2.5 py-1 rounded-full border border-teal-500/20">
                <ShieldCheck className="w-3 h-3" />
                Admin Panel
              </span>
            </div>

            {/* Right */}
            <div className="flex items-center gap-3">
              <button className="relative p-2 rounded-xl border border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 transition-colors">
                <Bell className="w-4 h-4" />
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">3</span>
              </button>
              <div className="hidden md:flex items-center gap-2.5 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-[11px] font-bold">
                  {currentAdminName
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase() ?? "A")
                    .join("")
                    .slice(0, 2) || "AD"}
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-200">{currentAdminUsername}</p>
                  <p className="text-[10px] text-teal-400 font-semibold">Administrator</p>
                </div>
              </div>
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => navigate("/")}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors text-sm font-medium">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </motion.button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex flex-1 relative">

        {/* ── Sidebar (desktop) ── */}
        <aside className="hidden lg:flex flex-col w-60 glass-card border-r border-white/5 shadow-none min-h-[calc(100vh-69px)]">
          <nav className="p-4 space-y-1 flex-1">
            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-3 mb-3">Administration</p>
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeNav;
              return (
                <motion.button key={item.id} whileHover={{ x: 3 }}
                  onClick={() => { setActiveNav(item.id); navigate(item.path); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md shadow-teal-500/20"
                      : "text-zinc-500 hover:bg-white/5 hover:text-teal-400"
                  }`}>
                  <Icon className="w-4 h-4" />
                  {item.label}
                  {item.id === "accounts" && (
                    <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      isActive ? "bg-white/20 text-white" : "bg-teal-500/10 text-teal-400"
                    }`}>{users.length}</span>
                  )}
                </motion.button>
              );
            })}
          </nav>
          <div className="p-4 border-t border-white/5">
            <button onClick={() => navigate("/")}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-red-400 hover:bg-red-500/10 rounded-xl text-sm font-medium transition-all">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
        </aside>

        {/* ── Mobile Sidebar ── */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="lg:hidden fixed inset-0 bg-black/30 z-40"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                className="lg:hidden fixed left-0 top-[69px] bottom-0 w-60 bg-[#0f0f1a] border-r border-white/10 z-50 flex flex-col shadow-2xl">
                <nav className="p-4 space-y-1 flex-1 overflow-y-auto">
                  {ADMIN_NAV.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.id === activeNav;
                    return (
                      <button key={item.id} onClick={() => { setActiveNav(item.id); setSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isActive
                            ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md"
                            : "text-zinc-500 hover:bg-white/5 hover:text-teal-400"
                        }`}>
                        <Icon className="w-4 h-4" />{item.label}
                      </button>
                    );
                  })}
                </nav>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* ── Main Content ── */}
        <main className="flex-1 p-4 md:p-6 lg:p-7 overflow-x-hidden relative">
          <div className="max-w-7xl mx-auto space-y-5">

            {/* Page Header */}
            <motion.div initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-teal-300 to-cyan-400 bg-clip-text text-transparent">
                  Manage User Accounts
                </h2>
                <p className="text-zinc-500 text-sm mt-1">View, search, and manage registered users.</p>
              </div>
              <div className="flex items-center gap-2">
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                  onClick={loadUsers}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 text-sm font-semibold transition-all">
                  <RefreshCw className="w-4 h-4" /> Refresh
                </motion.button>
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 text-sm font-semibold transition-all">
                  <Download className="w-4 h-4" /> Export CSV
                </motion.button>
              </div>
            </motion.div>

            {/* Stats Row */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.07 }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-3"
            >
              {[
                { label: "Total Users", value: stats.total, icon: Users, color: "from-teal-400 to-teal-600", bg: "bg-teal-500/10", text: "text-teal-400" },
                { label: "Admins",      value: stats.admins, icon: ShieldCheck, color: "from-violet-400 to-violet-600", bg: "bg-violet-500/10", text: "text-violet-400" },
                { label: "Customers",    value: stats.customers, icon: User, color: "from-emerald-400 to-emerald-600", bg: "bg-emerald-500/10", text: "text-emerald-400" },
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="glass-card rounded-2xl border border-white/5 p-4 flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${stat.bg} border border-white/5`}>
                      <Icon className={`w-5 h-5 ${stat.text}`} />
                    </div>
                    <div>
                      <p className="text-2xl font-extrabold text-zinc-100">{stat.value}</p>
                      <p className="text-xs text-zinc-500 font-medium">{stat.label}</p>
                    </div>
                  </div>
                );
              })}
            </motion.div>

            {/* Search & Filters */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="glass-card rounded-2xl border border-white/5 p-4"
            >
              <div className="flex flex-col lg:flex-row gap-3">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name, username, or email…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="w-full pl-9 pr-4 py-2.5 border border-white/10 bg-white/5 rounded-xl text-sm outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20 transition-all text-zinc-200 placeholder:text-zinc-600"
                  />
                </div>

                {/* Role filter */}
                <div className="relative">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <select
                    value={roleFilter}
                    onChange={(e) => { setRoleFilter(e.target.value as "All" | Role); setPage(1); }}
                    className="pl-9 pr-8 py-2.5 border border-white/10 bg-white/5 rounded-xl text-sm outline-none focus:border-teal-500/50 appearance-none cursor-pointer font-medium text-zinc-300 min-w-[130px]"
                  >
                    <option value="All">All Roles</option>
                    <option value="Admin">Admin</option>
                    <option value="Customer">Customer</option>
                  </select>
                </div>

                {/* Clear */}
                {hasFilters && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={clearFilters}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Clear
                  </motion.button>
                )}
              </div>

              {/* Result count */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  Showing{" "}
                  <span className="font-bold text-gray-800">{pageUsers.length}</span> of{" "}
                  <span className="font-bold text-gray-800">{filtered.length}</span> users
                  {hasFilters && (
                    <span className="ml-2 text-indigo-600 font-medium">(filtered)</span>
                  )}
                </p>
                <p className="text-xs text-gray-400">
                  Page {page} of {totalPages}
                </p>
              </div>
            </motion.div>

            {/* ── Table ── */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gradient-to-r from-slate-50 to-indigo-50 border-b border-gray-200">
                      {(
                        [
                          { key: "id",           label: "User ID" },
                          { key: "fullName",     label: "Full Name" },
                          { key: "username",     label: "Username" },
                          { key: "email",        label: "Email" },
                          { key: "password",     label: "Password" },
                          { key: "role",         label: "Role" },
                        ] as { key: SortField; label: string }[]
                      ).map(({ key, label }) => (
                        <th
                          key={key}
                          onClick={() => handleSort(key)}
                          className="px-4 py-3.5 text-left text-[11px] font-bold text-gray-600 uppercase tracking-wider cursor-pointer hover:text-indigo-700 whitespace-nowrap select-none"
                        >
                          {label}
                          <SortIcon field={key} sort={sort} />
                        </th>
                      ))}
                      <th className="px-4 py-3.5 text-center text-[11px] font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-3 text-gray-400">
                            {isLoading ? (
                              <RefreshCw className="w-10 h-10 opacity-30 animate-spin" />
                            ) : (
                              <Users className="w-10 h-10 opacity-30" />
                            )}
                            <p className="text-sm font-medium">
                              {isLoading ? "Loading users from Supabase..." : loadError ?? "No users found."}
                            </p>
                            {!isLoading && hasFilters && (
                              <button
                                onClick={clearFilters}
                                className="text-indigo-600 text-xs font-semibold hover:underline"
                              >
                                Clear filters
                              </button>
                            )}
                            {!isLoading && loadError && (
                              <button
                                onClick={loadUsers}
                                className="text-indigo-600 text-xs font-semibold hover:underline"
                              >
                                Retry loading users
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      pageUsers.map((user, idx) => {
                        const isOwnAccount = user.id === currentAdminId;
                        const isEven = idx % 2 === 1;
                        return (
                          <motion.tr
                            key={user.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.04 }}
                            className={`border-b border-gray-100 last:border-0 transition-colors group ${
                              isEven ? "bg-slate-50/60" : "bg-white"
                            } hover:bg-indigo-50/50`}
                          >
                            {/* User ID */}
                            <td className="px-4 py-3.5">
                              <span className="font-mono text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">
                                {user.id}
                              </span>
                            </td>

                            {/* Full Name */}
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={`w-8 h-8 rounded-xl bg-gradient-to-br ${avatarColor(user.avatar)} flex items-center justify-center text-white text-[11px] font-bold shrink-0`}
                                >
                                  {user.avatar}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-gray-900 text-sm truncate max-w-[140px]">
                                    {user.fullName}
                                    {isOwnAccount && (
                                      <span className="ml-1.5 text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">
                                        YOU
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>
                            </td>

                            {/* Username */}
                            <td className="px-4 py-3.5">
                              <span className="text-gray-700 text-sm font-medium">@{user.username}</span>
                            </td>

                            {/* Email */}
                            <td className="px-4 py-3.5">
                              <span className="text-gray-600 text-xs truncate max-w-[180px] block">{user.email}</span>
                            </td>

                            {/* Password */}
                            <td className="px-4 py-3.5">
                              <span className="text-gray-600 text-xs font-mono truncate max-w-[180px] block">
                                {user.password ? maskSecret(user.password) : "Not set"}
                              </span>
                            </td>

                            {/* Role */}
                            <td className="px-4 py-3.5">
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                                  user.role === "Admin"
                                    ? "bg-indigo-100 text-indigo-700 border-indigo-200"
                                    : "bg-gray-100 text-gray-600 border-gray-200"
                                }`}
                              >
                                {user.role === "Admin" && <ShieldCheck className="w-3 h-3" />}
                                {user.role === "Customer" && <User className="w-3 h-3" />}
                                {user.role}
                              </span>
                            </td>

                            {/* Actions */}
                            <td className="px-4 py-3.5">
                              <div className="flex items-center justify-center gap-1.5">
                                {/* View */}
                                <motion.button
                                  whileHover={{ scale: 1.15 }}
                                  whileTap={{ scale: 0.9 }}
                                  onClick={() => setViewTarget(user)}
                                  title="View details"
                                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </motion.button>

                                {/* Toggle Status */}
                                <motion.button
                                  whileHover={{ scale: 1.15 }}
                                  whileTap={{ scale: 0.9 }}
                                  onClick={() => !isOwnAccount && setDeleteTarget(user)}
                                  title={isOwnAccount ? "Cannot delete your own account" : "Delete account"}
                                  disabled={isOwnAccount}
                                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                                    isOwnAccount
                                      ? "bg-gray-50 text-gray-300 cursor-not-allowed"
                                      : "bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700"
                                  }`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </motion.button>
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* ── Pagination ── */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3.5 border-t border-gray-100 bg-gray-50/60">
                  <p className="text-xs text-gray-500">
                    {(page - 1) * PAGE_SIZE + 1}–
                    {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} users
                  </p>
                  <div className="flex items-center gap-1">
                    <motion.button
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.92 }}
                      onClick={() => setPage(1)}
                      disabled={page === 1}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronsLeft className="w-3.5 h-3.5" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.92 }}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </motion.button>

                    {/* Page number buttons */}
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => Math.abs(p - page) <= 2)
                      .map((p) => (
                        <motion.button
                          key={p}
                          whileHover={{ scale: 1.08 }}
                          whileTap={{ scale: 0.92 }}
                          onClick={() => setPage(p)}
                          className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold border transition-all ${
                            p === page
                              ? "bg-gradient-to-r from-blue-600 to-indigo-700 text-white border-indigo-600 shadow-sm"
                              : "border-gray-200 bg-white text-gray-600 hover:bg-indigo-50 hover:text-indigo-700"
                          }`}
                        >
                          {p}
                        </motion.button>
                      ))}

                    <motion.button
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.92 }}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.92 }}
                      onClick={() => setPage(totalPages)}
                      disabled={page === totalPages}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronsRight className="w-3.5 h-3.5" />
                    </motion.button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </main>
      </div>
    </div>
  );
}
