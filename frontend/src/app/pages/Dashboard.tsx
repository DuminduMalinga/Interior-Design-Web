import { useEffect, useState, useCallback } from "react";
import {
  Upload,
  User,
  X,
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
  AlertTriangle,
  Loader2,
  ClockAlert,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";
import { supabase } from "../lib/supabaseClient";
import SiteNavbar from "../components/SiteNavbar";
import PageGlows from "../components/marketing/PageGlows";
import DesignCard from "../components/DesignCard";
import PlanSketch from "../components/marketing/PlanSketch";
import { useUserDesigns, type UserDesign } from "../lib/useUserDesigns";
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
  // ── Designs (real data) ─────────────────────
  const { designs, loading: designsLoading, error: designsError, reload: reloadDesigns } = useUserDesigns();
  const scores = designs.flatMap((d) => (d.score === null ? [] : [d.score]));
  const stats = [
    { label: "Floor plans uploaded", value: String(designs.length) },
    { label: "Rooms furnished", value: String(scores.length) },
    { label: "Best layout score", value: scores.length ? `${Math.max(...scores)}` : "–", suffix: scores.length ? "/100" : "" },
  ];
  const firstName = displayName.trim().split(/\s+/)[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Reopen a saved plan at the step it reached. The flow pages rebuild from the
  // stored detection, the same router state the upload flow hands them.
  const openDesign = (design: UserDesign) => {
    if (!design.detection) return;
    const state = { floorPlanId: design.floorPlanId, detection: design.detection, planImage: design.imageUrl };
    if (design.selectedRoom) {
      navigate("/view-layouts", { state: { ...state, room: design.selectedRoom } });
    } else {
      navigate("/select-room", { state });
    }
  };
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
  // ── Tab renderers ──────────────────────────
  const pageTitleCls = "text-4xl md:text-5xl leading-[1.05] tracking-tight text-lv-ink";

  const uploadButton = (
    <button type="button" onClick={() => navigate("/upload")} className="lv-btn min-h-12 px-6 shrink-0">
      <Upload className="w-4 h-4" aria-hidden="true" /> Upload a floor plan
    </button>
  );

  const designsErrorBox = designsError && (
    <div role="alert" className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
      <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" aria-hidden="true" />
      <p className="flex-1 min-w-0 text-sm text-red-300">Your designs could not be loaded. {designsError}</p>
      <button type="button" onClick={() => void reloadDesigns()} className="lv-btn-quiet">Try again</button>
    </div>
  );

  const designsSkeleton = (
    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading your designs">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-[24px] border border-lv-line bg-lv-surface p-3">
          <div className="aspect-[4/3] rounded-2xl bg-lv-line animate-pulse" />
          <div className="mt-4 mx-2 h-3 w-1/3 rounded-full bg-lv-line animate-pulse" />
          <div className="mt-3 mx-2 mb-3 h-5 w-2/3 rounded-full bg-lv-line animate-pulse" />
        </div>
      ))}
    </div>
  );

  const emptyState = (
    <div className="mt-10 flex flex-col items-center rounded-[28px] border border-lv-line bg-lv-surface px-6 py-14 text-center md:py-20">
      <div className="grid w-36 place-items-center rounded-t-[72px] rounded-b-3xl bg-lv-wash px-4 pb-6 pt-12">
        <PlanSketch className="w-full" />
      </div>
      <h2 className="mt-8 text-2xl leading-tight text-lv-ink md:text-3xl">Upload your first floor plan</h2>
      <p className="mt-3 max-w-sm text-base leading-relaxed text-lv-muted">
        Add a 2D plan and we'll detect its rooms, score furniture layouts and show the one you pick in 3D.
      </p>
      <div className="mt-7">{uploadButton}</div>
    </div>
  );

  const renderDashboard = () => {
    const [latest, ...older] = designs;
    return (
      <>
        <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className={pageTitleCls}>{greeting}, {firstName}</h1>
            <p className="mt-3 text-base text-lv-muted md:text-lg">
              {designs.length > 0 ? "Pick up where you left off, or start a new room." : "Your designs will appear here."}
            </p>
          </div>
          {designs.length > 0 && uploadButton}
        </header>

        {designsErrorBox}

        {designsLoading ? designsSkeleton : designs.length === 0 ? (!designsError && emptyState) : (
          <>
            <dl className="mt-10 grid grid-cols-3 gap-3 sm:gap-4">
              {stats.map((stat) => (
                <div key={stat.label} className="flex flex-col-reverse justify-end rounded-[20px] border border-lv-line bg-lv-surface p-4 sm:rounded-[24px] sm:p-6">
                  <dt className="mt-1 text-xs text-lv-muted sm:text-sm">{stat.label}</dt>
                  <dd className="text-2xl font-medium tracking-tight tabular-nums text-lv-ink sm:text-4xl">
                    {stat.value}
                    {stat.suffix && <span className="ml-0.5 text-xs font-normal text-lv-muted sm:ml-1 sm:text-base">{stat.suffix}</span>}
                  </dd>
                </div>
              ))}
            </dl>

            <section className="mt-14">
              <div className="flex items-end justify-between gap-4">
                <h2 className="text-2xl leading-tight text-lv-ink md:text-3xl">Recent designs</h2>
                {designs.length > 1 && (
                  <button type="button" onClick={() => setActiveMenu("designs")} className="lv-btn-quiet shrink-0">
                    View all <span className="hidden sm:inline">designs</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="mt-6">
                <DesignCard design={latest} onOpen={openDesign} featured />
              </div>
              {older.length > 0 && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {older.slice(0, 3).map((design) => (
                    <DesignCard key={design.floorPlanId} design={design} onOpen={openDesign} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </>
    );
  };

  const renderDesigns = () => (
    <>
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className={pageTitleCls}>My designs</h1>
          <p className="mt-3 text-base text-lv-muted md:text-lg">
            {designs.length > 0
              ? `${designs.length} floor ${designs.length === 1 ? "plan" : "plans"}, newest first.`
              : "Every floor plan you upload is kept here."}
          </p>
        </div>
        {designs.length > 0 && uploadButton}
      </header>

      {designsErrorBox}

      {designsLoading ? designsSkeleton : designs.length === 0 ? (!designsError && emptyState) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {designs.map((design) => (
            <DesignCard key={design.floorPlanId} design={design} onOpen={openDesign} />
          ))}
        </div>
      )}
    </>
  );
  const renderProfile = () => (
    <>
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-center justify-between">
        <div>
          <h1 className={pageTitleCls}>Profile</h1>
          <p className="mt-3 text-base text-lv-muted md:text-lg">Manage your personal information and account settings.</p>
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
            ].filter(({ value }) => value.trim() !== "").map(({ icon: Icon, value }, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-zinc-500">
                <Icon className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                <span className="truncate">{value}</span>
              </div>
            ))}
          </div>
          {profile.bio.trim() !== "" && (
            <div className="w-full pt-3 border-t border-white/5">
              <p className="text-xs text-zinc-500 text-left">{profile.bio}</p>
            </div>
          )}
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
                    <p className="w-full border border-white/5 bg-white/[0.02] rounded-xl px-4 py-2.5 text-sm text-zinc-400">{profile[field] || "Not set"}</p>
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
                  <p className="w-full border border-white/5 bg-white/[0.02] rounded-xl px-4 py-2.5 text-sm text-zinc-400">{profile.bio || "Not set"}</p>
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
    <div className="min-h-screen w-full bg-background relative isolate flex flex-col">
      <PageGlows />
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
      <main className="flex-1 w-full px-4 md:px-8 pt-8 pb-16 md:pt-12 relative overflow-x-clip">
        <div className="max-w-6xl mx-auto">
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
