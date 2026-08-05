import { useEffect, useState } from "react";
import {
  Box,
  LayoutDashboard,
  Upload,
  History,
  User,
  LogOut,
  FileUp,
  Boxes,
  Menu,
  X,
  TrendingUp,
  Clock,
  Mail,
  Phone,
  MapPin,
  Lock,
  Eye,
  EyeOff,
  Save,
  Camera,
  CheckCircle2,
  Bell,
  ShieldCheck,
  Shield,
  Pencil,
  Trash2,
  Download,
  ExternalLink,
  Moon,
  Sun,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
import { useTheme } from "../context/ThemeContext";
import { useCurrentUserProfile } from "../context/UserContext";

type ProfileState = {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  location: string;
  bio: string;
};

const createProfileState = (overrides: Partial<ProfileState> = {}): ProfileState => ({
  fullName: "User",
  username: "user",
  email: "",
  phone: "+1 (555) 012-3456",
  location: "New York, USA",
  bio: "Interior design enthusiast. Using AI to bring floor plans to life.",
  ...overrides,
});

export default function Dashboard() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { profile: currentUser } = useCurrentUserProfile();
  const [activeMenu, setActiveMenu] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Profile state
  const [profileEdit, setProfileEdit] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfPass, setShowConfPass] = useState(false);
  const [profile, setProfile] = useState<ProfileState>(() => createProfileState());
  const [profileDraft, setProfileDraft] = useState({ ...profile });
  const [passwords, setPasswords] = useState({ old: "", newP: "", conf: "" });
  const [passMsg, setPassMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [notifications, setNotifications] = useState({ email: true, browser: false, updates: true });

  // Delete account modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePassError, setDeletePassError] = useState(false);

  useEffect(() => {
    const nextProfile = createProfileState({
      fullName: currentUser.fullName,
      username: currentUser.username,
      email: currentUser.email,
    });

    setProfile(nextProfile);
    setProfileDraft(nextProfile);
  }, [currentUser.email, currentUser.fullName, currentUser.username]);

  const username = profile.username;

  const handleDeleteAccount = () => {
    if (deletePassword.trim() === "") { setDeletePassError(true); return; }
    setShowDeleteModal(false);
    setDeletePassword("");
    setDeletePassError(false);
    navigate("/");
  };

  const handleLogout = () => navigate("/");

  const isAdmin = currentUser.role.trim().toLowerCase() === "admin";

  const menuItems = [
    { id: "dashboard", label: "Dashboard",           icon: LayoutDashboard, path: "/dashboard" },
    { id: "upload",    label: "Upload Floor Plan",   icon: Upload,          path: "/upload" },
    { id: "designs",   label: "View Previous Designs", icon: History,       path: null },
    { id: "profile",   label: "Profile",             icon: User,            path: null },
    ...(isAdmin ? [{ id: "admin-accounts", label: "Manage Accounts", icon: ShieldCheck, path: "/admin/accounts" }] : []),
  ];

  const stats = [
    { label: "Total Uploads",     value: "24",  icon: FileUp,     color: "text-teal-400",   bg: "bg-teal-500/10",   glow: "shadow-teal-500/10" },
    { label: "Designs Generated", value: "18",  icon: Boxes,      color: "text-violet-400", bg: "bg-violet-500/10", glow: "shadow-violet-500/10" },
    { label: "Success Rate",      value: "98%", icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10", glow: "shadow-emerald-500/10" },
  ];

  const recentActivity = [
    { id: 1, name: "Modern Bedroom Layout",   date: "2 hours ago", status: "Completed" },
    { id: 2, name: "Master Suite Design",     date: "1 day ago",   status: "Completed" },
    { id: 3, name: "Guest Room Optimization", date: "2 days ago",  status: "Completed" },
  ];

  const previousDesigns = [
    { id: 1, name: "Modern Bedroom Layout",   date: "Feb 23, 2026", rooms: "Bedroom 1",   score: 92, thumb: "MB" },
    { id: 2, name: "Master Suite Design",     date: "Feb 22, 2026", rooms: "Bedroom 2",   score: 87, thumb: "MS" },
    { id: 3, name: "Guest Room Optimization", date: "Feb 20, 2026", rooms: "Guest Room",  score: 78, thumb: "GR" },
    { id: 4, name: "Living Room Layout",      date: "Feb 18, 2026", rooms: "Living Room", score: 85, thumb: "LR" },
    { id: 5, name: "Home Office Setup",       date: "Feb 15, 2026", rooms: "Study Room",  score: 91, thumb: "HO" },
    { id: 6, name: "Kids Bedroom Plan",       date: "Feb 10, 2026", rooms: "Bedroom 3",   score: 74, thumb: "KB" },
  ];

  const handleSaveProfile = () => {
    setProfile({ ...profileDraft });
    setProfileEdit(false);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 3000);
  };

  const handleChangePassword = () => {
    if (!passwords.old) { setPassMsg({ type: "err", text: "Enter your current password." }); return; }
    if (passwords.newP.length < 8) { setPassMsg({ type: "err", text: "New password must be at least 8 characters." }); return; }
    if (passwords.newP !== passwords.conf) { setPassMsg({ type: "err", text: "New passwords do not match." }); return; }
    setPassMsg({ type: "ok", text: "Password updated successfully." });
    setPasswords({ old: "", newP: "", conf: "" });
    setTimeout(() => setPassMsg(null), 3500);
  };

  // ── Shared input classes ────────────────────
  const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/15 transition-all";
  const cardCls = "glass-card rounded-2xl p-6 border border-white/5";

  // ── Tab renderers ──────────────────────────
  const renderDashboard = () => (
    <>
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-1">Dashboard</h2>
        <p className="text-zinc-500">Manage your floor plans and 3D layouts</p>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }} whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className={`${cardCls} flex items-center justify-between shadow-lg ${stat.glow}`}>
              <div>
                <p className="text-sm text-zinc-500 mb-1">{stat.label}</p>
                <p className="text-3xl font-extrabold text-white">{stat.value}</p>
              </div>
              <div className={`${stat.bg} p-3.5 rounded-xl`}>
                <Icon className={`w-7 h-7 ${stat.color}`} />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
          whileHover={{ y: -6, transition: { duration: 0.25 } }}
          className={`${cardCls} cursor-pointer hover:bg-white/[0.07] transition-all glow-teal`}
          onClick={() => navigate("/upload")}>
          <div className="flex flex-col items-center text-center space-y-5">
            <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-6 rounded-2xl shadow-lg shadow-teal-500/25">
              <FileUp className="w-14 h-14 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white mb-2">Upload Floor Plan</h3>
              <p className="text-zinc-500 text-sm leading-relaxed">Upload your 2D floor plan to generate optimized 3D bedroom layouts with AI-powered furniture placement.</p>
            </div>
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={(e) => { e.stopPropagation(); navigate("/upload"); }}
              className="w-full px-6 py-3.5 bg-gradient-to-r from-teal-500 to-teal-600 text-white font-bold rounded-xl shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 transition-all">
              Start Upload
            </motion.button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
          whileHover={{ y: -6, transition: { duration: 0.25 } }}
          className={`${cardCls} cursor-pointer hover:bg-white/[0.07] transition-all glow-violet`}
          onClick={() => setActiveMenu("designs")}>
          <div className="flex flex-col items-center text-center space-y-5">
            <div className="bg-gradient-to-br from-violet-400 to-violet-600 p-6 rounded-2xl shadow-lg shadow-violet-500/25">
              <Boxes className="w-14 h-14 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white mb-2">View Previous Designs</h3>
              <p className="text-zinc-500 text-sm leading-relaxed">View and manage your previously generated 3D layouts. Download, edit, or share your designs.</p>
            </div>
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={(e) => { e.stopPropagation(); setActiveMenu("designs"); }}
              className="w-full px-6 py-3.5 bg-white/5 border border-violet-500/30 text-violet-400 font-bold rounded-xl hover:bg-violet-500/10 transition-all">
              View Designs
            </motion.button>
          </div>
        </motion.div>
      </div>

      {/* Recent Activity */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className={cardCls}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-teal-400" /> Recent Activity
          </h3>
          <button onClick={() => setActiveMenu("designs")}
            className="text-sm text-teal-400 hover:text-teal-300 font-semibold transition-colors">View All</button>
        </div>
        <div className="space-y-2">
          {recentActivity.map((activity, i) => (
            <motion.div key={activity.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.08 }} whileHover={{ x: 4 }}
              className="flex items-center justify-between p-4 bg-white/[0.03] hover:bg-white/[0.06] rounded-xl transition-all cursor-pointer border border-white/5">
              <div className="flex items-center gap-3">
                <div className="bg-teal-500/10 p-2 rounded-lg">
                  <Boxes className="w-4 h-4 text-teal-400" />
                </div>
                <div>
                  <p className="font-semibold text-zinc-200 text-sm">{activity.name}</p>
                  <p className="text-xs text-zinc-500">{activity.date}</p>
                </div>
              </div>
              <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-bold rounded-full border border-emerald-500/20">{activity.status}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </>
  );

  const renderDesigns = () => (
    <>
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-1">Previous Designs</h2>
        <p className="text-zinc-500">All your AI-generated 3D layouts in one place.</p>
      </motion.div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {previousDesigns.map((design, i) => (
          <motion.div key={design.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }} whileHover={{ y: -5, transition: { duration: 0.2 } }}
            className="glass-card rounded-2xl overflow-hidden border border-white/5 hover:bg-white/[0.07] transition-all">
            <div className="h-36 bg-gradient-to-br from-teal-500/10 to-violet-500/10 flex items-center justify-center relative border-b border-white/5">
              <span className="text-5xl font-black text-white/10 select-none">{design.thumb}</span>
              <span className={`absolute top-3 right-3 px-2.5 py-1 text-xs font-bold rounded-full ${
                design.score >= 90 ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" :
                design.score >= 80 ? "bg-teal-500/15 text-teal-400 border border-teal-500/20" :
                "bg-amber-500/15 text-amber-400 border border-amber-500/20"
              }`}>
                {design.score}/100
              </span>
            </div>
            <div className="p-5">
              <h4 className="font-bold text-zinc-200 text-sm mb-1 truncate">{design.name}</h4>
              <p className="text-xs text-zinc-500 mb-0.5">{design.rooms}</p>
              <p className="text-xs text-zinc-600 mb-4">{design.date}</p>
              <div className="flex gap-2">
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                  onClick={() => navigate("/room-view-3d")}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-teal-500/10 text-teal-400 text-xs font-semibold rounded-xl hover:bg-teal-500/20 transition-colors border border-teal-500/20">
                  <ExternalLink className="w-3.5 h-3.5" /> Open
                </motion.button>
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-white/5 text-zinc-400 text-xs font-semibold rounded-xl hover:bg-white/10 transition-colors border border-white/10">
                  <Download className="w-3.5 h-3.5" /> Export
                </motion.button>
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                  className="py-2 px-3 bg-red-500/10 text-red-400 text-xs rounded-xl hover:bg-red-500/20 transition-colors border border-red-500/20">
                  <Trash2 className="w-3.5 h-3.5" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </>
  );

  const renderProfile = () => (
    <>
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-1">Profile</h2>
          <p className="text-zinc-500">Manage your personal information and account settings.</p>
        </div>
        {profileSaved && (
          <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-xl text-sm font-semibold border border-emerald-500/20">
            <CheckCircle2 className="w-4 h-4" /> Saved!
          </motion.div>
        )}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Avatar Card */}
        <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
          className={`${cardCls} flex flex-col items-center text-center gap-4`}>
          <div className="relative">
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-3xl font-black shadow-lg shadow-teal-500/20">
              {profile.fullName.split(" ").map(w => w[0]).join("").slice(0, 2)}
            </div>
            <button className="absolute -bottom-2 -right-2 w-8 h-8 bg-[#141419] border border-white/10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
              <Camera className="w-3.5 h-3.5 text-teal-400" />
            </button>
          </div>
          <div>
            <p className="font-bold text-white text-lg">{profile.fullName}</p>
            <p className="text-zinc-500 text-sm">@{profile.username}</p>
          </div>
          <div className="w-full space-y-2 text-left">
            {[
              { icon: Mail, value: profile.email },
              { icon: Phone, value: profile.phone },
              { icon: MapPin, value: profile.location },
            ].map(({ icon: Icon, value }) => (
              <div key={value} className="flex items-center gap-2 text-xs text-zinc-500">
                <Icon className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                <span className="truncate">{value}</span>
              </div>
            ))}
          </div>
          <div className="w-full pt-3 border-t border-white/5">
            <p className="text-xs text-zinc-600 italic text-left">{profile.bio}</p>
          </div>
        </motion.div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Personal Info */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className={cardCls}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-zinc-200 flex items-center gap-2">
                <User className="w-4 h-4 text-teal-400" /> Personal Information
              </h3>
              {!profileEdit ? (
                <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => { setProfileDraft({ ...profile }); setProfileEdit(true); }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 px-3 py-1.5 rounded-lg transition-colors border border-teal-500/20">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </motion.button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setProfileEdit(false)} className="text-xs font-semibold text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors">Cancel</button>
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={handleSaveProfile}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white bg-gradient-to-r from-teal-500 to-teal-600 px-4 py-1.5 rounded-lg shadow-sm">
                    <Save className="w-3.5 h-3.5" /> Save
                  </motion.button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(["fullName", "username", "email", "phone", "location"] as const).map((field) => (
                <div key={field} className={field === "email" || field === "location" ? "sm:col-span-2" : ""}>
                  <label className="text-xs font-semibold text-zinc-500 mb-1 block capitalize">
                    {field === "fullName" ? "Full Name" : field === "username" ? "Username" : field.charAt(0).toUpperCase() + field.slice(1)}
                  </label>
                  {profileEdit ? (
                    <input value={profileDraft[field]}
                      onChange={e => setProfileDraft(d => ({ ...d, [field]: e.target.value }))}
                      className={inputCls} />
                  ) : (
                    <p className="w-full border border-white/5 bg-white/[0.02] rounded-xl px-4 py-2.5 text-sm text-zinc-400">{profile[field]}</p>
                  )}
                </div>
              ))}
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-zinc-500 mb-1 block">Bio</label>
                {profileEdit ? (
                  <textarea rows={2} value={profileDraft.bio}
                    onChange={e => setProfileDraft(d => ({ ...d, bio: e.target.value }))}
                    className={`${inputCls} resize-none`} />
                ) : (
                  <p className="w-full border border-white/5 bg-white/[0.02] rounded-xl px-4 py-2.5 text-sm text-zinc-400">{profile.bio}</p>
                )}
              </div>
            </div>
          </motion.div>

          {/* Change Password */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }} className={cardCls}>
            <h3 className="font-bold text-zinc-200 flex items-center gap-2 mb-5">
              <Lock className="w-4 h-4 text-teal-400" /> Change Password
            </h3>
            <div className="space-y-3">
              {([
                { label: "Current Password", key: "old",  show: showOldPass, setShow: setShowOldPass },
                { label: "New Password",     key: "newP", show: showNewPass, setShow: setShowNewPass },
                { label: "Confirm New Password", key: "conf", show: showConfPass, setShow: setShowConfPass },
              ] as const).map(({ label, key, show, setShow }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-zinc-500 mb-1 block">{label}</label>
                  <div className="relative">
                    <input type={show ? "text" : "password"} value={passwords[key]}
                      onChange={e => setPasswords(p => ({ ...p, [key]: e.target.value }))}
                      className={`${inputCls} pr-10`} />
                    <button type="button" onClick={() => setShow(!show)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
              {passMsg && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className={`text-xs font-semibold flex items-center gap-1.5 ${passMsg.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
                  {passMsg.type === "ok" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                  {passMsg.text}
                </motion.p>
              )}
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={handleChangePassword}
                className="w-full py-2.5 bg-gradient-to-r from-teal-500 to-teal-600 text-white font-semibold rounded-xl text-sm shadow-md shadow-teal-500/20 hover:shadow-teal-500/30 transition-all">
                Update Password
              </motion.button>
            </div>
          </motion.div>

          {/* Notifications */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className={cardCls}>
            <h3 className="font-bold text-zinc-200 flex items-center gap-2 mb-5">
              <Bell className="w-4 h-4 text-teal-400" /> Notifications
            </h3>
            <div className="space-y-3">
              {([
                { key: "email",   label: "Email notifications",   desc: "Receive updates via email" },
                { key: "browser", label: "Browser notifications", desc: "Push alerts in browser" },
                { key: "updates", label: "Product updates",       desc: "News about new AI features" },
              ] as const).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-xl border border-white/5">
                  <div>
                    <p className="text-sm font-semibold text-zinc-300">{label}</p>
                    <p className="text-xs text-zinc-600">{desc}</p>
                  </div>
                  <button onClick={() => setNotifications(n => ({ ...n, [key]: !n[key] }))}
                    className={`w-11 h-6 rounded-full transition-colors relative ${notifications[key] ? "bg-teal-500" : "bg-white/10"}`}>
                    <motion.span animate={{ x: notifications[key] ? 20 : 2 }}
                      className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Danger Zone */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}
            className="glass-card rounded-2xl p-6 border border-red-500/15">
            <h3 className="font-bold text-red-400 flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4" /> Danger Zone
            </h3>
            <div className="flex items-center justify-between p-4 bg-red-500/5 rounded-xl border border-red-500/15">
              <div>
                <p className="text-sm font-semibold text-red-300">Delete Account</p>
                <p className="text-xs text-red-500/70">Permanently delete your account and all data.</p>
              </div>
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => { setShowDeleteModal(true); setDeletePassword(""); setDeletePassError(false); }}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/15 text-red-400 text-sm font-semibold rounded-xl hover:bg-red-500/25 transition-colors border border-red-500/20">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </motion.button>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] relative" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Delete Account Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowDeleteModal(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[#141419] rounded-3xl shadow-2xl overflow-hidden border border-white/10">
              <div className="bg-gradient-to-r from-red-500 to-rose-600 px-6 py-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2.5 rounded-xl"><Shield className="w-5 h-5 text-white" /></div>
                  <div>
                    <h3 className="text-white font-bold">Delete Account</h3>
                    <p className="text-red-100 text-xs">This action is permanent and cannot be undone</p>
                  </div>
                </div>
                <button onClick={() => setShowDeleteModal(false)} className="text-white/70 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {profile.fullName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-zinc-200 text-sm truncate">{profile.fullName}</p>
                    <p className="text-xs text-zinc-500 truncate">{profile.email}</p>
                    <p className="text-xs text-zinc-600">@{profile.username}</p>
                  </div>
                </div>
                <p className="text-center text-zinc-300 text-sm font-semibold">Are you sure you want to permanently delete your account?</p>
                <p className="text-center text-zinc-600 text-xs">All your uploads, designs, and data will be removed forever.</p>
                <div>
                  <label className="text-xs font-semibold text-zinc-400 mb-1.5 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-zinc-500" /> Confirm with your password
                  </label>
                  <input type="password" autoFocus placeholder="Enter your password…"
                    value={deletePassword}
                    onChange={(e) => { setDeletePassword(e.target.value); setDeletePassError(false); }}
                    onKeyDown={(e) => e.key === "Enter" && handleDeleteAccount()}
                    className={`${inputCls} ${deletePassError ? "border-red-500/50" : ""}`} />
                  {deletePassError && <p className="text-red-400 text-xs mt-1">Password is required to confirm deletion.</p>}
                </div>
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
                  <Shield className="w-4 h-4 text-amber-400 shrink-0" />
                  <p className="text-amber-300 text-xs font-semibold">Warning: This action cannot be undone.</p>
                </div>
                <div className="flex gap-3 pt-1">
                  <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    onClick={() => setShowDeleteModal(false)}
                    className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-300 font-semibold text-sm hover:bg-white/10 transition-all">
                    Cancel
                  </motion.button>
                  <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    onClick={handleDeleteAccount}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2">
                    <Trash2 className="w-4 h-4" /> Delete My Account
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dot grid overlay */}
      <div className="absolute inset-0 dot-grid pointer-events-none" />

      {/* Top Nav */}
      <nav className="relative glass-nav z-30">
        <div className="px-4 md:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="lg:hidden text-zinc-400 hover:text-white">
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
              <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/")}>
                <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-2 rounded-xl shadow-lg shadow-teal-500/20">
                  <Box className="w-8 h-8 text-white" strokeWidth={1.5} />
                </div>
                <div className="hidden md:block">
                  <h1 className="text-base font-bold text-white">3D Layout System</h1>
                  <p className="text-xs text-zinc-500">AI-Powered Design</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:block text-right">
                <p className="text-xs text-zinc-500">Welcome back,</p>
                <p className="font-semibold text-white text-sm">{username} 👋</p>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex flex-col w-64 glass-sidebar min-h-[calc(100vh-69px)] relative border-r border-white/5">
          <nav className="p-4 space-y-1.5 flex-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeMenu === item.id;
              return (
                <motion.button key={item.id} whileHover={{ x: 4 }}
                  onClick={() => { setActiveMenu(item.id); if (item.path) navigate(item.path); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                    isActive
                      ? "bg-gradient-to-r from-teal-500/20 to-teal-600/10 text-teal-300 border border-teal-500/20"
                      : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
                  }`}>
                  <Icon className={`w-5 h-5 ${isActive ? "text-teal-400" : ""}`} />
                  {item.label}
                </motion.button>
              );
            })}
          </nav>
          <div className="p-4 border-t border-white/5">
            <button onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 rounded-xl text-sm font-medium transition-all">
              <LogOut className="w-5 h-5" /> Logout
            </button>
          </div>
        </aside>

        {/* Mobile Sidebar */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.aside initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="lg:hidden fixed left-0 top-[69px] bottom-0 w-64 glass-sidebar shadow-2xl z-50 border-r border-white/5">
              <nav className="p-4 space-y-1.5">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeMenu === item.id;
                  return (
                    <button key={item.id}
                      onClick={() => { setActiveMenu(item.id); setMobileMenuOpen(false); if (item.path) navigate(item.path); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                        isActive
                          ? "bg-teal-500/15 text-teal-300 border border-teal-500/20"
                          : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
                      }`}>
                      <Icon className={`w-5 h-5 ${isActive ? "text-teal-400" : ""}`} />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8 relative overflow-x-hidden">
          <div className="max-w-7xl mx-auto">
            {/* Mobile greeting */}
            <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
              className="md:hidden mb-6 glass-card rounded-2xl p-5 border border-white/5">
              <h2 className="text-xl font-bold text-white">Welcome back, {username} 👋</h2>
              <p className="text-zinc-500 text-sm mt-1">Ready to create amazing 3D layouts?</p>
            </motion.div>

            <AnimatePresence mode="wait">
              <motion.div key={activeMenu} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                {activeMenu === "dashboard" && renderDashboard()}
                {activeMenu === "designs"   && renderDesigns()}
                {activeMenu === "profile"   && renderProfile()}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}