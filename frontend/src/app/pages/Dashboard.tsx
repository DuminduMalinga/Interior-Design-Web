import { useEffect, useState, useCallback } from "react";
import {
  Upload,
  User,
  FileUp,
  Boxes,
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
  Shield,
  Pencil,
  Trash2,
  Download,
  ExternalLink,
  AlertTriangle,
  Loader2,
  ClockAlert,
  ArrowRight,
  Calendar,
  Sparkles,
  LayoutGrid,
  Bed,
  BedDouble,
  Sofa,
  Utensils,
  ChefHat,
  Bath
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";
import { supabase } from "../lib/supabaseClient";
import SiteNavbar from "../components/SiteNavbar";
import AppFooter from "../components/AppFooter";
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
const HERO_IMAGE = "/dashboard/hero.jpg";
// Cover photos for the dashboard's recent-design cards.
const DESIGN_COVERS = [
  "/dashboard/design-modern-bedroom.jpg",
  "/dashboard/design-master-suite.jpg",
  "/dashboard/design-guest-room.jpg",
  "/dashboard/design-living-room.jpg",
];
// Scroll-reveal animation shared by the dashboard sections below the fold.
const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.45 },
};
export default function Dashboard() {
  const navigate = useNavigate();
  const { profile: currentUser } = useCurrentUserProfile();
  const location = useLocation();
  // The shared navbar's page links and "My Profile" arrive here with { menu } in router state.
  const requestedMenu = (location.state as { menu?: string } | null)?.menu;
  const [activeMenu, setActiveMenu] = useState(
    requestedMenu === "profile" || requestedMenu === "designs" ? requestedMenu : "dashboard",
  );
  useEffect(() => {
    if (requestedMenu === "dashboard" || requestedMenu === "designs" || requestedMenu === "profile") {
      setActiveMenu(requestedMenu);
    }
  }, [location.key, requestedMenu]);
  // Profile state
  const [profileEdit, setProfileEdit] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [deleteRequestMsg, setDeleteRequestMsg] = useState<{ type: "success" | "error" | "pending"; text: string } | null>(null);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  useEffect(() => {
    const nextProfile = createProfileState({
      fullName: currentUser.fullName,
      username: currentUser.username,
      email: currentUser.email,
      phone: currentUser.phone,
      location: currentUser.location,
      bio: currentUser.bio,
    });
    setProfile(nextProfile);
    setProfileDraft(nextProfile);
  }, [currentUser.email, currentUser.fullName, currentUser.username, currentUser.phone, currentUser.location, currentUser.bio]);
  // Check if the user already has a pending deletion request
  const checkPendingRequest = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("DeletionRequest")
      .select("RequestID")
      .eq("UserID", user.id)
      .eq("Status", "pending")
      .maybeSingle();
    setHasPendingRequest(!!data);
  }, []);
  const handleCancelRequest = async () => {
    setCancelSubmitting(true);
    setDeleteRequestMsg(null);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setDeleteRequestMsg({ type: "error", text: "Unable to verify your session. Please sign in again." });
        return;
      }
      const { error } = await supabase
        .from("DeletionRequest")
        .delete()
        .eq("UserID", user.id)
        .eq("Status", "pending");
      if (error) {
        setDeleteRequestMsg({ type: "error", text: error.message });
        return;
      }
      setHasPendingRequest(false);
      setDeleteRequestMsg({ type: "success", text: "Your deletion request has been cancelled. Your account is safe." });
    } catch (err) {
      setDeleteRequestMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to cancel request." });
    } finally {
      setCancelSubmitting(false);
    }
  };
  useEffect(() => {
    void checkPendingRequest();
  }, [checkPendingRequest]);
  const displayName = profile.fullName?.trim() ? profile.fullName : profile.username;
  const handleDeleteAccount = async () => {
    if (deletePassword.trim() === "") { setDeletePassError(true); return; }
    setDeleteSubmitting(true);
    setDeleteRequestMsg(null);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setDeleteRequestMsg({ type: "error", text: "Unable to verify your session. Please sign in again." });
        setDeleteSubmitting(false);
        return;
      }
      // Prevent duplicate requests
      const { data: existing } = await supabase
        .from("DeletionRequest")
        .select("RequestID")
        .eq("UserID", user.id)
        .eq("Status", "pending")
        .maybeSingle();
      if (existing) {
        setDeleteRequestMsg({ type: "pending", text: "You already have a pending deletion request. An admin will review it shortly." });
        setDeleteSubmitting(false);
        return;
      }
      const { error: insertError } = await supabase.from("DeletionRequest").insert({
        UserID: user.id,
        FullName: profile.fullName,
        Email: profile.email,
        Username: profile.username,
        Status: "pending",
      });
      if (insertError) {
        setDeleteRequestMsg({ type: "error", text: insertError.message });
        setDeleteSubmitting(false);
        return;
      }
      setHasPendingRequest(true);
      setDeletePassword("");
      setDeletePassError(false);
      setShowDeleteModal(false);
      setDeleteRequestMsg({ type: "success", text: "Your deletion request has been submitted. An admin will review it and delete your account shortly." });
    } catch (err) {
      setDeleteRequestMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to submit deletion request." });
    } finally {
      setDeleteSubmitting(false);
    }
  };
  const recentActivity = [
    { id: 1, name: "Modern Bedroom Layout", date: "2 hours ago", status: "Completed" },
    { id: 2, name: "Master Suite Design", date: "1 day ago", status: "Completed" },
    { id: 3, name: "Guest Room Optimization", date: "2 days ago", status: "Completed" },
  ];
  const stats = [
    { label: "Total Uploads", value: "24", sub: "2D floor plans uploaded", icon: FileUp, color: "text-teal-400", bg: "bg-teal-500/10" },
    { label: "3D Designs Generated", value: "18", sub: "Rooms created with AI", icon: Boxes, color: "text-violet-400", bg: "bg-violet-500/10" },
    { label: "Last Activity", value: recentActivity[0].date, sub: recentActivity[0].name, icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Success Rate", value: "98%", sub: "Successful generations", icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  ];
  const steps = [
    { title: "Upload your floor plan", desc: "Drop in a 2D floor plan image as a PNG or JPG.", icon: Upload },
    { title: "AI reads the plan", desc: "Walls, doors and rooms are detected automatically.", icon: Sparkles },
    { title: "Pick a room", desc: "Choose which room you want to furnish first.", icon: LayoutGrid },
    { title: "Explore it in 3D", desc: "Compare generated layouts and walk through the result.", icon: Boxes },
  ];
  const roomTypes = [
    { label: "Bedroom", icon: Bed },
    { label: "Master Bedroom", icon: BedDouble },
    { label: "Living Room", icon: Sofa },
    { label: "Dining Room", icon: Utensils },
    { label: "Kitchen", icon: ChefHat },
    { label: "Bathroom", icon: Bath },
  ];
  const previousDesigns = [
    { id: 1, name: "Modern Bedroom Layout", date: "Feb 23, 2026", rooms: "Bedroom 1", score: 92, thumb: "MB" },
    { id: 2, name: "Master Suite Design", date: "Feb 22, 2026", rooms: "Bedroom 2", score: 87, thumb: "MS" },
    { id: 3, name: "Guest Room Optimization", date: "Feb 20, 2026", rooms: "Guest Room", score: 78, thumb: "GR" },
    { id: 4, name: "Living Room Layout", date: "Feb 18, 2026", rooms: "Living Room", score: 85, thumb: "LR" },
    { id: 5, name: "Home Office Setup", date: "Feb 15, 2026", rooms: "Study Room", score: 91, thumb: "HO" },
    { id: 6, name: "Kids Bedroom Plan", date: "Feb 10, 2026", rooms: "Bedroom 3", score: 74, thumb: "KB" },
  ];
  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error("Session expired. Please sign in again.");
      // Persist to the User table
      const { error: dbErr } = await supabase
        .from("User")
        .update({
          FullName: profileDraft.fullName.trim(),
          UserName: profileDraft.username.trim(),
          Phone: profileDraft.phone.trim(),
          Location: profileDraft.location.trim(),
          Bio: profileDraft.bio.trim(),
        })
        .eq("UserID", user.id);
      if (dbErr) throw new Error(dbErr.message);
      // Also update auth user_metadata so UserContext picks it up on next load
      await supabase.auth.updateUser({
        data: {
          full_name: profileDraft.fullName.trim(),
          username: profileDraft.username.trim(),
        },
      });
      setProfile({ ...profileDraft });
      setProfileEdit(false);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (err) {
      console.error("[Dashboard] Failed to save profile:", err);
      alert(err instanceof Error ? err.message : "Failed to save profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
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
  const eyebrowCls = "text-xs font-semibold uppercase tracking-widest text-teal-400 mb-1.5";
  // ── Tab renderers ──────────────────────────
  const renderDashboard = () => (
    <>
      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-white/5 bg-popover mb-5 min-h-[300px] md:min-h-[340px] flex items-center shadow-sm">
        <img src={HERO_IMAGE} alt="Furnished bedroom"
          className="absolute inset-y-0 right-0 h-full w-full md:w-[66%] object-cover object-[center_45%]" />
        {/* Small screens: veil the whole photo. Larger: fade only its left edge into the card. */}
        <div className="md:hidden absolute inset-0 bg-popover/80" />
        <div className="hidden md:block absolute inset-0"
          style={{ background: "linear-gradient(90deg, var(--popover) 0%, var(--popover) 34%, transparent 58%)" }} />
        <div className="relative p-7 md:p-12 max-w-xl">
          <h2 className="font-serif text-4xl md:text-5xl font-bold leading-[1.1] text-white">
            Your next space
            <span className="block text-teal-400">starts here</span>
          </h2>
          <p className="mt-3 text-base md:text-lg text-zinc-400 max-w-sm leading-relaxed">
            Upload a 2D floor plan and generate a fully furnished 3D room with AI.
          </p>
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => navigate("/upload")}
            className="mt-6 inline-flex items-center gap-3 px-6 py-3.5 bg-gradient-to-r from-teal-500 to-teal-600 text-white font-semibold rounded-xl shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 transition-all">
            <Upload className="w-5 h-5" /> Upload Floor Plan <ArrowRight className="w-4 h-4" />
          </motion.button>
        </div>
      </motion.div>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-12">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }} whileHover={{ y: -3, transition: { duration: 0.2 } }}
              className="glass-card rounded-2xl p-5 border border-white/5 flex items-center gap-4">
              <div className={`${stat.bg} p-3.5 rounded-xl shrink-0`}>
                <Icon className={`w-7 h-7 ${stat.color}`} strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-zinc-500">{stat.label}</p>
                <p className="text-2xl font-bold text-white leading-tight truncate">{stat.value}</p>
                <p className="text-xs text-zinc-500 truncate">{stat.sub}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
      {/* Recent Designs */}
      <motion.section {...reveal} className="mb-16">
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <p className={eyebrowCls}>Your work</p>
            <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight">Recent Designs</h3>
            <p className="text-sm text-zinc-500 mt-1">Your latest generated 3D rooms from uploaded floor plans.</p>
          </div>
          <button onClick={() => setActiveMenu("designs")}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 hover:bg-white/10 transition-colors">
            View All <span className="hidden sm:inline">Designs</span> <ArrowRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {previousDesigns.slice(0, 4).map((design, i) => (
            <motion.article key={design.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.4 }}
              whileHover={{ y: -6, transition: { duration: 0.2 } }}
              onClick={() => navigate("/room-view-3d")}
              className="group glass-card rounded-2xl overflow-hidden border border-white/5 cursor-pointer hover:shadow-xl hover:shadow-teal-500/10 transition-shadow">
              <div className="relative h-44 overflow-hidden">
                <img src={DESIGN_COVERS[i % DESIGN_COVERS.length]} alt={design.name} loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.6) 100%)" }} />
                <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[11px] font-semibold backdrop-blur-md"
                  style={{ background: "rgba(0,0,0,0.45)", color: "#fff" }}>
                  {design.rooms}
                </span>
                <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-bold"
                  style={{ background: "rgba(255,255,255,0.92)", color: "#0f766e" }}>
                  {design.score}/100
                </span>
                <span className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#fff" }}>
                  <Boxes className="w-3.5 h-3.5" /> 3D layout ready
                </span>
              </div>
              <div className="p-4">
                <h4 className="font-semibold text-white text-[15px] truncate">{design.name}</h4>
                <div className="flex items-center justify-between gap-3 mt-2">
                  <p className="flex items-center gap-1.5 text-xs text-zinc-500 min-w-0">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{design.date}</span>
                  </p>
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-teal-400">
                    View Design <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </motion.section>
      {/* How it works */}
      <motion.section {...reveal} className="mb-16">
        <div className="text-center max-w-2xl mx-auto mb-8">
          <p className={eyebrowCls}>How it works</p>
          <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight">From floor plan to furnished room in four steps</h3>
          <p className="text-sm text-zinc-500 mt-2">No design experience needed. Upload a plan and let the AI do the layout work.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div key={step.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.1, duration: 0.4 }}
                className="relative glass-card rounded-2xl p-6 border border-white/5">
                <span className="absolute top-4 right-5 text-4xl font-black text-white/5 select-none">0{i + 1}</span>
                <div className="w-11 h-11 rounded-xl bg-teal-500/10 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-teal-400" />
                </div>
                <h4 className="font-semibold text-white mb-1.5">{step.title}</h4>
                <p className="text-sm text-zinc-500 leading-relaxed">{step.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </motion.section>
      {/* Room types + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-16">
        <motion.section {...reveal} className="lg:col-span-3 glass-card rounded-2xl p-6 border border-white/5">
          <p className={eyebrowCls}>Rooms</p>
          <h3 className="text-xl font-bold text-white leading-tight">Every room, thoughtfully arranged</h3>
          <p className="text-sm text-zinc-500 mt-1 mb-5">Each room type has its own layout rules for furniture, clearances and flow.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {roomTypes.map(({ label, icon: Icon }) => (
              <div key={label}
                className="flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-teal-500/30 hover:bg-teal-500/5 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                  <Icon className="w-[18px] h-[18px] text-teal-400" />
                </div>
                <span className="text-sm font-medium text-zinc-200 truncate">{label}</span>
              </div>
            ))}
          </div>
        </motion.section>
        <motion.section {...reveal} className="lg:col-span-2 glass-card rounded-2xl p-6 border border-white/5">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-xl font-bold text-white flex items-center gap-2 leading-tight">
              <Clock className="w-5 h-5 text-teal-400" /> Recent Activity
            </h3>
            <button onClick={() => setActiveMenu("designs")}
              className="text-sm text-teal-400 hover:text-teal-300 font-semibold transition-colors">View All</button>
          </div>
          <div className="space-y-1">
            {recentActivity.map((activity, i) => (
              <div key={activity.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-teal-500 ring-4 ring-teal-500/15" />
                  {i < recentActivity.length - 1 && <span className="flex-1 w-px bg-white/10 my-1" />}
                </div>
                <div className="flex-1 min-w-0 flex items-start justify-between gap-3 pb-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-200 text-sm truncate">{activity.name}</p>
                    <p className="text-xs text-zinc-500">{activity.date}</p>
                  </div>
                  <span className="shrink-0 px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[11px] font-bold rounded-full border border-emerald-500/20">{activity.status}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      </div>
      {/* Call to action */}
      <motion.section {...reveal}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-teal-500 to-teal-600 px-7 py-10 md:px-12 md:py-12 mb-4">
        <div className="absolute -right-16 -top-24 w-72 h-72 rounded-full bg-white/10" />
        <div className="absolute right-24 -bottom-28 w-56 h-56 rounded-full bg-white/10" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h3 className="font-serif text-2xl md:text-3xl font-bold text-white leading-tight">Ready to design your next room?</h3>
            <p className="text-white/80 mt-2 max-w-lg">Upload a floor plan and get a furnished, walkable 3D layout in minutes.</p>
          </div>
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            onClick={() => navigate("/upload")}
            className="shrink-0 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl font-semibold shadow-lg"
            style={{ background: "#fff", color: "#0f766e" }}>
            <Upload className="w-5 h-5" /> Start a New Design
          </motion.button>
        </div>
      </motion.section>
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
              <span className={`absolute top-3 right-3 px-2.5 py-1 text-xs font-bold rounded-full ${design.score >= 90 ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" :
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
            <button className="absolute -bottom-2 -right-2 w-8 h-8 bg-popover border border-white/10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
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
                  <button onClick={() => setProfileEdit(false)} disabled={isSaving} className="text-xs font-semibold text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50">Cancel</button>
                  <motion.button whileHover={isSaving ? {} : { scale: 1.05 }} whileTap={isSaving ? {} : { scale: 0.95 }}
                    onClick={handleSaveProfile}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white bg-gradient-to-r from-teal-500 to-teal-600 px-4 py-1.5 rounded-lg shadow-sm disabled:opacity-70">
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {isSaving ? "Saving…" : "Save"}
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
                { label: "Current Password", key: "old", show: showOldPass, setShow: setShowOldPass },
                { label: "New Password", key: "newP", show: showNewPass, setShow: setShowNewPass },
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
                { key: "email", label: "Email notifications", desc: "Receive updates via email" },
                { key: "browser", label: "Browser notifications", desc: "Push alerts in browser" },
                { key: "updates", label: "Product updates", desc: "News about new AI features" },
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
            {/* Request feedback message */}
            <AnimatePresence>
              {deleteRequestMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  className={`mb-3 flex items-start gap-2.5 px-4 py-3 rounded-xl border text-xs font-semibold ${deleteRequestMsg.type === "success"
                    ? "bg-green-500/10 border-green-500/20 text-green-300"
                    : deleteRequestMsg.type === "pending"
                      ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                      : "bg-red-500/10 border-red-500/20 text-red-300"
                    }`}
                >
                  {deleteRequestMsg.type === "success" && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                  {deleteRequestMsg.type === "pending" && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                  {deleteRequestMsg.type === "error" && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                  {deleteRequestMsg.text}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex items-start justify-between gap-3 p-4 bg-red-500/5 rounded-xl border border-red-500/15">
              <div>
                <p className="text-sm font-semibold text-red-300">Request Account Deletion</p>
                {hasPendingRequest ? (
                  <p className="text-xs text-amber-400/80 flex items-center gap-1 mt-0.5">
                    <ClockAlert className="w-3 h-3" /> Pending admin approval
                  </p>
                ) : (
                  <p className="text-xs text-red-500/70">Submit a request to permanently delete your account.</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {hasPendingRequest ? (
                  <>
                    {/* Pending badge */}
                    <span className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 text-amber-400/70 border border-amber-500/20 rounded-xl text-sm font-semibold">
                      <ClockAlert className="w-3.5 h-3.5" /> Pending
                    </span>
                    {/* Cancel button */}
                    <motion.button
                      whileHover={{ scale: cancelSubmitting ? 1 : 1.04 }}
                      whileTap={{ scale: cancelSubmitting ? 1 : 0.96 }}
                      onClick={() => void handleCancelRequest()}
                      disabled={cancelSubmitting}
                      className="flex items-center gap-1.5 px-3 py-2 bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 hover:text-zinc-200 border border-zinc-500/20 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                    >
                      {cancelSubmitting
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cancelling…</>
                        : <><X className="w-3.5 h-3.5" /> Cancel Request</>}
                    </motion.button>
                  </>
                ) : (
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      setShowDeleteModal(true);
                      setDeletePassword("");
                      setDeletePassError(false);
                      setDeleteRequestMsg(null);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20 rounded-xl text-sm font-semibold transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Request Deletion
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );
  return (
    <div className="min-h-screen w-full bg-background relative flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Delete Account Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowDeleteModal(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-popover rounded-3xl shadow-2xl overflow-hidden border border-white/10">
              <div className="bg-gradient-to-r from-red-500 to-rose-600 px-6 py-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2.5 rounded-xl"><Shield className="w-5 h-5 text-white" /></div>
                  <div>
                    <h3 className="text-white font-bold">Request Account Deletion</h3>
                    <p className="text-red-100 text-xs">Your request will be reviewed by an admin</p>
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
                <p className="text-center text-zinc-300 text-sm font-semibold">Submit a request to delete your account?</p>
                <p className="text-center text-zinc-600 text-xs">An admin will review your request and permanently delete your account. You will be notified once completed.</p>
                <div>
                  <label className="text-xs font-semibold text-zinc-400 mb-1.5 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-zinc-500" /> Confirm with your password
                  </label>
                  <input type="password" autoFocus placeholder="Enter your password…"
                    value={deletePassword}
                    onChange={(e) => { setDeletePassword(e.target.value); setDeletePassError(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleDeleteAccount(); }}
                    className={`${inputCls} ${deletePassError ? "border-red-500/50" : ""}`} />
                  {deletePassError && <p className="text-red-400 text-xs mt-1">Password is required to confirm the request.</p>}
                </div>
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <p className="text-amber-300 text-xs font-semibold">Your account will remain active until an admin approves the request.</p>
                </div>
                <div className="flex gap-3 pt-1">
                  <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    onClick={() => setShowDeleteModal(false)}
                    disabled={deleteSubmitting}
                    className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-300 font-semibold text-sm hover:bg-white/10 transition-all disabled:opacity-50">
                    Cancel
                  </motion.button>
                  <motion.button whileHover={{ scale: deleteSubmitting ? 1 : 1.03 }} whileTap={{ scale: deleteSubmitting ? 1 : 0.97 }}
                    onClick={() => void handleDeleteAccount()}
                    disabled={deleteSubmitting}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2 disabled:opacity-60">
                    {deleteSubmitting
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                      : <><Trash2 className="w-4 h-4" /> Submit Request</>}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Top Nav */}
      <SiteNavbar
        activeNav={activeMenu}
        name={displayName}
        email={profile.email}
        onProfile={() => setActiveMenu("profile")}
      />
      {/* Main Content */}
      <main className="flex-1 w-full px-4 md:px-8 py-5 md:py-6 relative overflow-x-hidden">
        <div className="max-w-7xl mx-auto">
          {/* Mobile greeting */}
          <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
            className="md:hidden mb-5 glass-card rounded-2xl p-5 border border-white/5">
            <h2 className="text-xl font-bold text-white">Welcome back, {displayName} 👋</h2>
            <p className="text-zinc-500 text-sm mt-1">Ready to create amazing 3D layouts?</p>
          </motion.div>
          <AnimatePresence mode="wait">
            <motion.div key={activeMenu} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {activeMenu === "dashboard" && renderDashboard()}
              {activeMenu === "designs" && renderDesigns()}
              {activeMenu === "profile" && renderProfile()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
