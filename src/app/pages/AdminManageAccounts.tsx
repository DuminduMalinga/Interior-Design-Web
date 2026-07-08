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
  ToggleLeft,
  ToggleRight,
  FileText,
  Activity,
  User,
  Lock,
  Menu,
  Bell,
  RefreshCw,
  Clock,
  Upload,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type Role = "Admin" | "Customer";
type Status = "Active" | "Suspended";
type SortField = "id" | "fullName" | "username" | "email" | "role" | "registeredAt" | "uploads";
type SortDir = "asc" | "desc";

interface UserAccount {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: Role;
  status: Status;
  registeredAt: string;
  uploads: number;
  lastActive: string;
  avatar: string;
}

interface AuditLog {
  id: string;
  action: string;
  target: string;
  by: string;
  at: string;
}

// ─────────────────────────────────────────────
// Mock Data
// ─────────────────────────────────────────────
const CURRENT_ADMIN_ID = "u001";

const MOCK_USERS: UserAccount[] = [
  { id: "u001", fullName: "John Smith",      username: "johnsmith",   email: "john@example.com",    role: "Admin",    status: "Active",    registeredAt: "2025-01-15", uploads: 24, lastActive: "2 mins ago",  avatar: "JS" },
  { id: "u002", fullName: "Emily Johnson",   username: "emilyjohn",   email: "emily@example.com",   role: "Customer", status: "Active",    registeredAt: "2025-02-20", uploads: 11, lastActive: "1 hr ago",    avatar: "EJ" },
  { id: "u003", fullName: "Michael Brown",   username: "mbrown",      email: "michael@example.com", role: "Customer", status: "Suspended", registeredAt: "2025-03-05", uploads:  3, lastActive: "5 days ago",  avatar: "MB" },
  { id: "u004", fullName: "Sarah Davis",     username: "sarahdavis",  email: "sarah@example.com",   role: "Customer", status: "Active",    registeredAt: "2025-03-18", uploads: 18, lastActive: "30 mins ago", avatar: "SD" },
  { id: "u005", fullName: "James Wilson",    username: "jameswilson", email: "james@example.com",   role: "Customer", status: "Active",    registeredAt: "2025-04-02", uploads:  7, lastActive: "2 hrs ago",   avatar: "JW" },
  { id: "u006", fullName: "Linda Martinez",  username: "lindamart",   email: "linda@example.com",   role: "Admin",    status: "Active",    registeredAt: "2025-04-10", uploads: 32, lastActive: "10 mins ago", avatar: "LM" },
  { id: "u007", fullName: "David Anderson",  username: "danderson",   email: "david@example.com",   role: "Customer", status: "Active",    registeredAt: "2025-04-25", uploads:  5, lastActive: "1 day ago",   avatar: "DA" },
  { id: "u008", fullName: "Jessica Taylor",  username: "jesstaylor",  email: "jessica@example.com", role: "Customer", status: "Suspended", registeredAt: "2025-05-03", uploads:  1, lastActive: "7 days ago",  avatar: "JT" },
  { id: "u009", fullName: "Christopher Lee", username: "chrislee",    email: "chris@example.com",   role: "Customer", status: "Active",    registeredAt: "2025-05-14", uploads:  9, lastActive: "3 hrs ago",   avatar: "CL" },
  { id: "u010", fullName: "Amanda White",    username: "amandaw",     email: "amanda@example.com",  role: "Customer", status: "Active",    registeredAt: "2025-05-28", uploads: 14, lastActive: "45 mins ago", avatar: "AW" },
  { id: "u011", fullName: "Robert Harris",   username: "robharris",   email: "robert@example.com",  role: "Customer", status: "Active",    registeredAt: "2025-06-02", uploads:  0, lastActive: "Never",       avatar: "RH" },
  { id: "u012", fullName: "Natalie Clark",   username: "natclark",    email: "natalie@example.com", role: "Customer", status: "Active",    registeredAt: "2025-06-15", uploads:  6, lastActive: "2 days ago",  avatar: "NC" },
  { id: "u013", fullName: "Kevin Lewis",     username: "kevinlewis",  email: "kevin@example.com",   role: "Customer", status: "Suspended", registeredAt: "2025-07-01", uploads:  2, lastActive: "14 days ago", avatar: "KL" },
  { id: "u014", fullName: "Megan Robinson",  username: "meganrob",    email: "megan@example.com",   role: "Customer", status: "Active",    registeredAt: "2025-07-09", uploads: 21, lastActive: "1 hr ago",    avatar: "MR" },
  { id: "u015", fullName: "Daniel Walker",   username: "danwalker",   email: "daniel@example.com",  role: "Customer", status: "Active",    registeredAt: "2025-07-22", uploads:  8, lastActive: "5 hrs ago",   avatar: "DW" },
  { id: "u016", fullName: "Stephanie Hall",  username: "stephall",    email: "steph@example.com",   role: "Customer", status: "Active",    registeredAt: "2025-08-04", uploads: 16, lastActive: "20 mins ago", avatar: "SH" },
  { id: "u017", fullName: "Tyler Young",     username: "tyleryoung",  email: "tyler@example.com",   role: "Customer", status: "Active",    registeredAt: "2025-08-18", uploads:  4, lastActive: "3 days ago",  avatar: "TY" },
  { id: "u018", fullName: "Hannah King",     username: "hannahking",  email: "hannah@example.com",  role: "Customer", status: "Suspended", registeredAt: "2025-09-01", uploads:  0, lastActive: "Never",       avatar: "HK" },
  { id: "u019", fullName: "Brandon Scott",   username: "brandscott",  email: "brandon@example.com", role: "Customer", status: "Active",    registeredAt: "2025-09-10", uploads: 12, lastActive: "4 hrs ago",   avatar: "BS" },
  { id: "u020", fullName: "Olivia Green",    username: "oliviag",     email: "olivia@example.com",  role: "Customer", status: "Active",    registeredAt: "2025-10-05", uploads:  3, lastActive: "1 day ago",   avatar: "OG" },
  { id: "u021", fullName: "Marcus Adams",    username: "marcusAdams", email: "marcus@example.com",  role: "Customer", status: "Active",    registeredAt: "2025-10-20", uploads:  7, lastActive: "6 hrs ago",   avatar: "MA" },
  { id: "u022", fullName: "Chloe Nelson",    username: "chloenelson", email: "chloe@example.com",   role: "Customer", status: "Active",    registeredAt: "2025-11-03", uploads: 19, lastActive: "2 hrs ago",   avatar: "CN" },
];

const MOCK_AUDIT: AuditLog[] = [
  { id: "a1", action: "Deleted Account",    target: "user@example.com",   by: "johnsmith", at: "2025-12-01 14:32" },
  { id: "a2", action: "Suspended Account",  target: "test@example.com",   by: "lindamart", at: "2025-11-28 09:15" },
  { id: "a3", action: "Restored Account",   target: "guest@example.com",  by: "johnsmith", at: "2025-11-25 16:45" },
  { id: "a4", action: "Deleted Account",    target: "old@example.com",    by: "lindamart", at: "2025-11-20 11:00" },
  { id: "a5", action: "Suspended Account",  target: "spam@example.com",   by: "johnsmith", at: "2025-11-18 08:30" },
];

const PAGE_SIZE = 10;

// ─────────────────────────────────────────────
// Sidebar nav items
// ─────────────────────────────────────────────
const ADMIN_NAV = [
  { id: "dashboard",   label: "Dashboard",       icon: LayoutDashboard, path: "/dashboard" },
  { id: "accounts",    label: "Manage Accounts", icon: Users,           path: "/admin/accounts" },
  { id: "security",    label: "Security Logs",   icon: ShieldCheck,     path: "/admin/security" },
  { id: "audit",       label: "Audit Log",       icon: FileText,        path: "/admin/audit" },
  { id: "activity",    label: "Activity",        icon: Activity,        path: "/admin/activity" },
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
              All uploads, designs, and data associated with this account will be removed.
            </p>
          </div>

          {/* Warning badges */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Upload, label: `${user.uploads} uploads`, color: "text-orange-600 bg-orange-50 border-orange-200" },
              { icon: FileText, label: "All designs", color: "text-red-600 bg-red-50 border-red-200" },
              { icon: Activity, label: "All history", color: "text-rose-600 bg-rose-50 border-rose-200" },
            ].map(({ icon: Icon, label, color }) => (
              <div key={label} className={`flex flex-col items-center gap-1 p-2 rounded-xl border text-[11px] font-semibold ${color}`}>
                <Icon className="w-3.5 h-3.5" />
                {label}
              </div>
            ))}
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
            { label: "Role", value: user.role, icon: ShieldCheck },
            { label: "Status", value: user.status, icon: Activity },
            { label: "Registered", value: user.registeredAt, icon: Clock },
            { label: "Uploads", value: `${user.uploads} uploads`, icon: Upload },
            { label: "Last Active", value: user.lastActive, icon: Activity },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
              <Icon className="w-4 h-4 text-teal-400 shrink-0" />
              <span className="text-xs text-zinc-500 w-24 shrink-0">{label}</span>
              <span
                className={`text-xs font-semibold truncate ${
                  label === "Role" && value === "Admin"
                    ? "text-indigo-700"
                    : label === "Status" && value === "Suspended"
                    ? "text-red-600"
                    : label === "Status"
                    ? "text-green-600"
                    : "text-gray-800"
                }`}
              >
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
  const adminUsername = "johnsmith";

  const [users, setUsers] = useState<UserAccount[]>(MOCK_USERS);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("accounts");

  // Search & filter
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"All" | Role>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | Status>("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Sort
  const [sort, setSort] = useState<{ f: SortField; d: SortDir }>({ f: "registeredAt", d: "desc" });

  // Pagination
  const [page, setPage] = useState(1);

  // Modals
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null);
  const [viewTarget, setViewTarget] = useState<UserAccount | null>(null);

  // Notifications
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Audit log panel
  const [showAudit, setShowAudit] = useState(false);

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
    if (statusFilter !== "All") arr = arr.filter((u) => u.status === statusFilter);
    if (dateFrom) arr = arr.filter((u) => u.registeredAt >= dateFrom);
    if (dateTo) arr = arr.filter((u) => u.registeredAt <= dateTo);

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
  }, [users, search, roleFilter, statusFilter, dateFrom, dateTo, sort]);

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
    setStatusFilter("All");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasFilters = search || roleFilter !== "All" || statusFilter !== "All" || dateFrom || dateTo;

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
    setDeleteTarget(null);
    showToast("success", `Account "${deleteTarget.username}" deleted successfully.`);
    if (pageUsers.length === 1 && page > 1) setPage((p) => p - 1);
  };

  const handleToggleStatus = (id: string) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id
          ? { ...u, status: u.status === "Active" ? "Suspended" : "Active" }
          : u
      )
    );
    const target = users.find((u) => u.id === id);
    if (target) {
      const newStatus = target.status === "Active" ? "Suspended" : "Active";
      showToast("success", `${target.username} is now ${newStatus}.`);
    }
  };

  const handleExportCSV = () => {
    const header = "ID,Full Name,Username,Email,Role,Status,Registered,Uploads\n";
    const rows = filtered
      .map((u) =>
        [u.id, u.fullName, u.username, u.email, u.role, u.status, u.registeredAt, u.uploads].join(
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
    active: users.filter((u) => u.status === "Active").length,
    suspended: users.filter((u) => u.status === "Suspended").length,
    admins: users.filter((u) => u.role === "Admin").length,
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
                  JS
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-200">{adminUsername}</p>
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
                  onClick={() => setShowAudit((p) => !p)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    showAudit
                      ? "bg-teal-500 text-white border-teal-500"
                      : "bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10"
                  }`}>
                  <FileText className="w-4 h-4" /> Audit Log
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
              className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            >
              {[
                { label: "Total Users", value: stats.total, icon: Users, color: "from-teal-400 to-teal-600", bg: "bg-teal-500/10", text: "text-teal-400" },
                { label: "Active",      value: stats.active, icon: CheckCircle2, color: "from-emerald-400 to-emerald-600", bg: "bg-emerald-500/10", text: "text-emerald-400" },
                { label: "Suspended",   value: stats.suspended, icon: XCircle, color: "from-red-400 to-rose-600", bg: "bg-red-500/10", text: "text-red-400" },
                { label: "Admins",      value: stats.admins, icon: ShieldCheck, color: "from-violet-400 to-violet-600", bg: "bg-violet-500/10", text: "text-violet-400" },
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

            {/* Audit Log Panel */}
            <AnimatePresence>
              {showAudit && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="glass-card rounded-2xl border border-white/5 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-zinc-200 text-sm flex items-center gap-2">
                        <FileText className="w-4 h-4 text-teal-400" /> Recent Audit Log
                      </h3>
                      <button onClick={() => setShowAudit(false)}>
                        <X className="w-4 h-4 text-zinc-600 hover:text-zinc-300" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {MOCK_AUDIT.map((log) => (
                        <div key={log.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                          <div className={`p-1.5 rounded-lg ${
                            log.action.includes("Deleted") ? "bg-red-500/10" :
                            log.action.includes("Suspended") ? "bg-amber-500/10" :
                            "bg-emerald-500/10"
                          }`}>
                            {log.action.includes("Deleted") ? <Trash2 className="w-3.5 h-3.5 text-red-400" /> :
                             log.action.includes("Suspended") ? <ToggleLeft className="w-3.5 h-3.5 text-amber-400" /> :
                             <ToggleRight className="w-3.5 h-3.5 text-emerald-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-zinc-200">{log.action}</p>
                            <p className="text-[11px] text-zinc-500 truncate">Target: {log.target} · By: @{log.by}</p>
                          </div>
                          <span className="text-[10px] text-zinc-600 whitespace-nowrap">{log.at}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

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

                {/* Status filter */}
                <div className="relative">
                  <Activity className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <select
                    value={statusFilter}
                    onChange={(e) => { setStatusFilter(e.target.value as "All" | Status); setPage(1); }}
                    className="pl-9 pr-8 py-2.5 border border-white/10 bg-white/5 rounded-xl text-sm outline-none focus:border-teal-500/50 appearance-none cursor-pointer font-medium text-zinc-300 min-w-[140px]"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Active">Active</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>

                {/* Date range */}
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                    className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-400 bg-gray-50 text-gray-600 w-[140px]"
                    title="From date"
                  />
                  <span className="text-gray-400 text-xs font-medium">to</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                    className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-400 bg-gray-50 text-gray-600 w-[140px]"
                    title="To date"
                  />
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
                          { key: "role",         label: "Role" },
                          { key: "status",       label: "Status" },
                          { key: "registeredAt", label: "Registered" },
                          { key: "uploads",      label: "Uploads" },
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
                        <td colSpan={9} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-3 text-gray-400">
                            <Users className="w-10 h-10 opacity-30" />
                            <p className="text-sm font-medium">No users match your filters.</p>
                            {hasFilters && (
                              <button
                                onClick={clearFilters}
                                className="text-indigo-600 text-xs font-semibold hover:underline"
                              >
                                Clear filters
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      pageUsers.map((user, idx) => {
                        const isOwnAccount = user.id === CURRENT_ADMIN_ID;
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
                                  <p className="text-[11px] text-gray-400 flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" />
                                    {user.lastActive}
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

                            {/* Status */}
                            <td className="px-4 py-3.5">
                              <span
                                className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${
                                  user.status === "Active"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-red-100 text-red-600"
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    user.status === "Active" ? "bg-green-500" : "bg-red-500"
                                  }`}
                                />
                                {user.status}
                              </span>
                            </td>

                            {/* Registered */}
                            <td className="px-4 py-3.5">
                              <span className="text-xs text-gray-500">{user.registeredAt}</span>
                            </td>

                            {/* Uploads */}
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-1.5">
                                <Upload className="w-3.5 h-3.5 text-gray-400" />
                                <span className="text-sm font-semibold text-gray-700">{user.uploads}</span>
                              </div>
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
                                  onClick={() => handleToggleStatus(user.id)}
                                  title={user.status === "Active" ? "Suspend account" : "Restore account"}
                                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                                    user.status === "Active"
                                      ? "bg-amber-50 text-amber-600 hover:bg-amber-100"
                                      : "bg-green-50 text-green-600 hover:bg-green-100"
                                  }`}
                                >
                                  {user.status === "Active" ? (
                                    <ToggleLeft className="w-3.5 h-3.5" />
                                  ) : (
                                    <ToggleRight className="w-3.5 h-3.5" />
                                  )}
                                </motion.button>

                                {/* Delete */}
                                <motion.button
                                  whileHover={!isOwnAccount ? { scale: 1.15 } : {}}
                                  whileTap={!isOwnAccount ? { scale: 0.9 } : {}}
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
