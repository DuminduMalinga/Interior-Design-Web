import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  Upload,
  Camera,
  X,
  Mail,
  Phone,
  MapPin,
  Eye,
  EyeOff,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  Loader2,
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
import SavedDesignCard from "../components/SavedDesignCard";
import { deleteMyAccount } from "../lib/account";
import { checkAvatarFile, removeAvatar, uploadAvatar } from "../lib/avatar";
import { deleteSavedDesign, listSavedDesigns, type SavedDesign } from "../lib/savedDesign";
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
  phone: "",
  location: "",
  bio: "",
  ...overrides,
});
type NotificationPrefs = { email: boolean; browser: boolean; updates: boolean };
const DEFAULT_NOTIFICATIONS: NotificationPrefs = { email: true, browser: false, updates: true };
export default function Dashboard() {
  const navigate = useNavigate();
  const { profile: currentUser, authStatus, setAvatarUrl } = useCurrentUserProfile();
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
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfPass, setShowConfPass] = useState(false);
  const [profile, setProfile] = useState<ProfileState>(() => createProfileState());
  const [profileDraft, setProfileDraft] = useState({ ...profile });
  const [passwords, setPasswords] = useState({ old: "", newP: "", conf: "" });
  const [passMsg, setPassMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [passSaving, setPassSaving] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPrefs>(DEFAULT_NOTIFICATIONS);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  // Profile picture
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const handleAvatarPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = checkAvatarFile(file);
    if (problem) { setAvatarError(problem); return; }
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      setAvatarUrl(await uploadAvatar(file));
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "The picture could not be saved.");
    } finally {
      setAvatarBusy(false);
    }
  };
  const handleAvatarRemove = async () => {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      await removeAvatar();
      setAvatarUrl(null);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "The picture could not be removed.");
    } finally {
      setAvatarBusy(false);
    }
  };
  // The saved notification choices, from the User row.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase.from("User").select("NotificationPrefs").eq("UserID", user.id).maybeSingle();
      if (cancelled) return;
      if (error) setNotifyError("Your notification choices could not be loaded.");
      else if (data?.NotificationPrefs) setNotifications({ ...DEFAULT_NOTIFICATIONS, ...data.NotificationPrefs });
    })();
    return () => { cancelled = true; };
  }, []);
  const toggleNotification = async (key: keyof NotificationPrefs) => {
    const previous = notifications;
    const next = { ...notifications, [key]: !notifications[key] };
    setNotifications(next);
    setNotifyError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = user
      ? await supabase.from("User").update({ NotificationPrefs: next }).eq("UserID", user.id)
      : { error: new Error("Session expired. Please sign in again.") };
    if (error) {
      setNotifications(previous);
      setNotifyError(`Your choice could not be saved. ${error.message}`);
    }
  };
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
  const displayName = profile.fullName?.trim() ? profile.fullName : profile.username;
  const initials = (displayName.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();

  // Delete account modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePassError, setDeletePassError] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isAdmin = currentUser.role === "Admin";
  const openDeleteModal = () => {
    setDeletePassword("");
    setDeletePassError(false);
    setDeleteError(null);
    setShowDeleteModal(true);
  };
  useEffect(() => {
    if (!showDeleteModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !deleteSubmitting) setShowDeleteModal(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showDeleteModal, deleteSubmitting]);

  const handleDeleteAccount = async () => {
    if (deletePassword.trim() === "") { setDeletePassError(true); return; }
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await deleteMyAccount(profile.email, deletePassword);
      navigate("/", { replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Your account could not be deleted. Try again.");
      setDeleteSubmitting(false);
    }
  };

  // ── Designs (real data) ─────────────────────
  const { designs, loading: designsLoading, error: designsError, reload: reloadDesigns } = useUserDesigns();
  const scored = designs.filter((d) => d.score !== null);
  const lastScored = scored.reduce<UserDesign | null>(
    (latest, d) => (!latest || (d.updatedAt ?? "") > (latest.updatedAt ?? "") ? d : latest),
    null,
  );
  const stats = [
    { label: "Floor plans uploaded", value: String(designs.length) },
    { label: "Rooms furnished", value: String(scored.length) },
    { label: "Last layout score", value: lastScored ? `${lastScored.score}` : "–", suffix: lastScored ? "/100" : "" },
  ];
  const firstName = displayName.trim().split(/\s+/)[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // ── Saved 3D designs ────────────────────────
  const [savedDesigns, setSavedDesigns] = useState<SavedDesign[]>([]);
  const [savedError, setSavedError] = useState<string | null>(null);
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      try {
        const rows = await listSavedDesigns(user.id);
        if (!cancelled) { setSavedDesigns(rows); setSavedError(null); }
      } catch (err) {
        if (!cancelled) setSavedError(err instanceof Error ? err.message : "Your saved 3D designs could not be loaded.");
      }
    })();
    return () => { cancelled = true; };
  }, [authStatus]);
  const openSavedDesign = (design: SavedDesign) => {
    navigate("/room-view-3d", {
      state: {
        floorPlanId: design.floorPlanId,
        room: { id: design.roomId, name: design.roomName },
        livingRoomLayout: design.layout,
      },
    });
  };
  const removeSavedDesign = async (design: SavedDesign) => {
    try {
      await deleteSavedDesign(design);
      setSavedDesigns((list) => list.filter((d) => d.designId !== design.designId));
      setSavedError(null);
    } catch (err) {
      setSavedError(err instanceof Error ? err.message : "The design could not be removed.");
    }
  };
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
    if (!profileDraft.fullName.trim() || !profileDraft.username.trim()) {
      setProfileError("Full name and username can't be empty.");
      return;
    }
    setIsSaving(true);
    setProfileError(null);
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
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (err) {
      console.error("[Dashboard] Failed to save profile:", err);
      setProfileError(err instanceof Error ? err.message : "Your changes could not be saved. Try again.");
    } finally {
      setIsSaving(false);
    }
  };
  const handleChangePassword = async () => {
    if (!passwords.old) { setPassMsg({ type: "err", text: "Enter your current password." }); return; }
    if (passwords.newP.length < 8) { setPassMsg({ type: "err", text: "The new password needs at least 8 characters." }); return; }
    if (passwords.newP !== passwords.conf) { setPassMsg({ type: "err", text: "The new passwords don't match." }); return; }
    setPassSaving(true);
    setPassMsg(null);
    try {
      // Check the current password before replacing it.
      const { error: checkErr } = await supabase.auth.signInWithPassword({ email: profile.email, password: passwords.old });
      if (checkErr) { setPassMsg({ type: "err", text: "The current password is not correct." }); return; }
      const { error } = await supabase.auth.updateUser({ password: passwords.newP });
      if (error) { setPassMsg({ type: "err", text: error.message }); return; }
      setPassMsg({ type: "ok", text: "Password updated." });
      setPasswords({ old: "", newP: "", conf: "" });
      setTimeout(() => setPassMsg(null), 3500);
    } catch (err) {
      setPassMsg({ type: "err", text: err instanceof Error ? err.message : "The password could not be updated." });
    } finally {
      setPassSaving(false);
    }
  };
  // ── Shared input classes ────────────────────
  const labelCls = "mb-1.5 block text-sm text-lv-muted";
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

      {(savedDesigns.length > 0 || savedError) && (
        <section className="mt-10">
          <h2 className="text-2xl leading-tight text-lv-ink md:text-3xl">Saved 3D designs</h2>
          {savedError && (
            <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {savedError}
            </p>
          )}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {savedDesigns.map((design) => (
              <SavedDesignCard key={design.designId} design={design} onOpen={openSavedDesign} onDelete={removeSavedDesign} />
            ))}
          </div>
          <h2 className="mt-14 text-2xl leading-tight text-lv-ink md:text-3xl">Floor plans</h2>
        </section>
      )}

      {designsLoading ? designsSkeleton : designs.length === 0 ? (!designsError && emptyState) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {designs.map((design) => (
            <DesignCard key={design.floorPlanId} design={design} onOpen={openDesign} />
          ))}
        </div>
      )}
    </>
  );
  const profileDirty = (["fullName", "username", "phone", "location", "bio"] as const).some(
    (f) => profileDraft[f] !== profile[f],
  );
  const contact = [
    { icon: Mail, value: profile.email, label: "Email" },
    { icon: Phone, value: profile.phone, label: "Phone" },
    { icon: MapPin, value: profile.location, label: "Location" },
  ].filter(({ value }) => value.trim() !== "");

  // One settings row: what it is on the left, the form on the right.
  // The last row drops its bottom padding so it does not stack on the page's own.
  const settingsRow = (id: string, title: string, desc: string, body: ReactNode, center = false) => (
    <section aria-labelledby={id} className={`grid gap-5 py-10 last:pb-0 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:gap-12 ${center ? "lg:items-center" : ""}`}>
      <div>
        <h2 id={id} className="text-2xl leading-tight text-lv-ink">{title}</h2>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-lv-muted">{desc}</p>
      </div>
      {body}
    </section>
  );

  const passwordField = (
    label: string,
    key: "old" | "newP" | "conf",
    show: boolean,
    setShow: (v: boolean) => void,
    autoComplete: string,
  ) => (
    <div>
      <label htmlFor={`pw-${key}`} className={labelCls}>{label}</label>
      <div className="relative">
        <input id={`pw-${key}`} type={show ? "text" : "password"} autoComplete={autoComplete} value={passwords[key]}
          onChange={(e) => setPasswords((p) => ({ ...p, [key]: e.target.value }))}
          className="lv-input pr-12" />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-lv-muted transition-colors hover:bg-lv-ink/8 hover:text-lv-ink">
          {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );

  const renderProfile = () => (
    <>
      <header>
        <h1 className={pageTitleCls}>Profile</h1>
        <p className="mt-3 text-base text-lv-muted md:text-lg">Your details, password and notifications.</p>
      </header>

      {/* Identity */}
      <section aria-label="Your account"
        className="relative mt-10 overflow-hidden rounded-[32px] bg-lv-deep p-6 text-lv-on-deep sm:p-8 md:p-10">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,var(--lv-glow-1),transparent)]" />
        <div className="relative grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)_auto]">
          <div className="flex flex-col items-center gap-3">
            <div className="relative grid h-36 w-28 place-items-center overflow-hidden rounded-b-[24px] rounded-t-full bg-[#d8d7f3] text-4xl font-medium tracking-tight text-[#26223f] sm:h-40 sm:w-32 sm:text-5xl">
              {currentUser.avatarUrl
                ? <img src={currentUser.avatarUrl} alt={`${displayName}'s profile picture`} className="h-full w-full object-cover" />
                : <span className="pt-4">{initials}</span>}
              {avatarBusy && (
                <span className="absolute inset-0 grid place-items-center bg-black/45">
                  <Loader2 className="h-6 w-6 animate-spin text-white" aria-label="Saving picture" />
                </span>
              )}
            </div>
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
              aria-label="Choose a profile picture" onChange={(e) => void handleAvatarPicked(e)} />
            <div className="flex items-center gap-2">
              <button type="button" disabled={avatarBusy} onClick={() => avatarInputRef.current?.click()}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-lv-on-deep/25 px-3.5 text-sm text-lv-on-deep transition-colors hover:bg-lv-on-deep/10 disabled:cursor-not-allowed disabled:opacity-60">
                <Camera className="h-3.5 w-3.5" aria-hidden="true" /> {currentUser.avatarUrl ? "Change photo" : "Add photo"}
              </button>
              {currentUser.avatarUrl && (
                <button type="button" disabled={avatarBusy} onClick={() => void handleAvatarRemove()}
                  className="min-h-9 cursor-pointer rounded-full px-3 text-sm text-lv-on-deep/70 transition-colors hover:text-lv-on-deep disabled:cursor-not-allowed disabled:opacity-60">
                  Remove
                </button>
              )}
            </div>
            {avatarError && <p role="alert" className="max-w-40 text-center text-xs text-red-300">{avatarError}</p>}
          </div>

          <div className="min-w-0">
            <p className="truncate text-3xl leading-tight tracking-tight sm:text-4xl md:text-5xl">{displayName}</p>
            <p className="mt-1 text-base text-lv-on-deep/65">@{profile.username}</p>
            {contact.length > 0 && (
              <ul className="mt-5 flex flex-wrap gap-2">
                {contact.map(({ icon: Icon, value, label }) => (
                  <li key={label} className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-lv-on-deep/15 px-3.5 py-1.5 text-sm text-lv-on-deep/85">
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="sr-only">{label}: </span>
                    <span className="truncate">{value}</span>
                  </li>
                ))}
              </ul>
            )}
            {profile.bio.trim() !== "" && (
              <p className="mt-5 max-w-xl text-base leading-relaxed text-lv-on-deep/75">{profile.bio}</p>
            )}
          </div>

          <dl className="flex gap-8 border-t border-lv-on-deep/15 pt-6 md:flex-col md:gap-6 md:border-l md:border-t-0 md:pl-10 md:pt-0">
            {[
              { label: "Floor plans", value: designsLoading ? "–" : String(designs.length) },
              { label: "Rooms furnished", value: designsLoading ? "–" : String(designs.filter((d) => d.score !== null).length) },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse">
                <dt className="mt-1 text-sm text-lv-on-deep/65">{stat.label}</dt>
                <dd className="text-4xl font-medium leading-none tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* -mb-6 trims the page's bottom padding to the rows' own 40px, so the last card sits evenly */}
      <div className="mt-4 -mb-6 divide-y divide-lv-line">
        {/* Personal details */}
        {settingsRow("profile-details", "Personal details", "Shown on your profile. Your email is how you sign in, so it can't be changed here.",
          <form className="lv-card p-5 sm:p-7"
            onSubmit={(e) => { e.preventDefault(); if (profileDirty && !isSaving) void handleSaveProfile(); }}>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="pf-name" className={labelCls}>Full name</label>
                <input id="pf-name" autoComplete="name" value={profileDraft.fullName}
                  onChange={(e) => setProfileDraft((d) => ({ ...d, fullName: e.target.value }))} className="lv-input" />
              </div>
              <div>
                <label htmlFor="pf-username" className={labelCls}>Username</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lv-muted" aria-hidden="true">@</span>
                  <input id="pf-username" autoComplete="username" value={profileDraft.username}
                    onChange={(e) => setProfileDraft((d) => ({ ...d, username: e.target.value }))} className="lv-input pl-8" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="pf-email" className={labelCls}>Email</label>
                <input id="pf-email" type="email" value={profile.email} readOnly aria-readonly="true"
                  className="lv-input cursor-default bg-lv-ink/[0.03] text-lv-muted focus:border-lv-line focus:shadow-none" />
              </div>
              <div>
                <label htmlFor="pf-phone" className={labelCls}>Phone</label>
                <input id="pf-phone" type="tel" autoComplete="tel" value={profileDraft.phone} placeholder="Not set"
                  onChange={(e) => setProfileDraft((d) => ({ ...d, phone: e.target.value }))} className="lv-input" />
              </div>
              <div>
                <label htmlFor="pf-location" className={labelCls}>Location</label>
                <input id="pf-location" autoComplete="address-level2" value={profileDraft.location} placeholder="Not set"
                  onChange={(e) => setProfileDraft((d) => ({ ...d, location: e.target.value }))} className="lv-input" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="pf-bio" className={labelCls}>Bio</label>
                <textarea id="pf-bio" rows={3} value={profileDraft.bio} placeholder="A line about you"
                  onChange={(e) => setProfileDraft((d) => ({ ...d, bio: e.target.value }))} className="lv-input resize-none" />
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-lv-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p aria-live="polite" className="text-sm">
                {profileError ? (
                  <span className="flex items-center gap-2 text-red-400"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {profileError}</span>
                ) : profileSaved ? (
                  <span className="flex items-center gap-2 text-emerald-500"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Changes saved</span>
                ) : profileDirty ? (
                  <span className="text-lv-muted">You have unsaved changes.</span>
                ) : null}
              </p>
              <div className="flex gap-2">
                {profileDirty && (
                  <button type="button" disabled={isSaving} className="lv-btn-quiet"
                    onClick={() => { setProfileDraft({ ...profile }); setProfileError(null); }}>
                    Discard
                  </button>
                )}
                <button type="submit" disabled={!profileDirty || isSaving} className="lv-btn">
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {isSaving ? "Saving changes" : "Save changes"}
                </button>
              </div>
            </div>
          </form>,
        )}

        {/* Password */}
        {settingsRow("profile-password", "Password", "Use at least 8 characters. You'll need your current password to set a new one.",
          <form className="lv-card p-5 sm:p-7" onSubmit={(e) => { e.preventDefault(); if (!passSaving) void handleChangePassword(); }}>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2 sm:max-w-[calc(50%-0.625rem)]">
                {passwordField("Current password", "old", showOldPass, setShowOldPass, "current-password")}
              </div>
              {passwordField("New password", "newP", showNewPass, setShowNewPass, "new-password")}
              {passwordField("Confirm new password", "conf", showConfPass, setShowConfPass, "new-password")}
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-lv-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p aria-live="polite" className="text-sm">
                {passMsg && (
                  <span className={`flex items-center gap-2 ${passMsg.type === "ok" ? "text-emerald-500" : "text-red-400"}`}>
                    {passMsg.type === "ok"
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    {passMsg.text}
                  </span>
                )}
              </p>
              <button type="submit" disabled={passSaving} className="lv-btn">
                {passSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {passSaving ? "Updating password" : "Update password"}
              </button>
            </div>
          </form>,
        )}

        {/* Notifications */}
        {settingsRow("profile-notifications", "Notifications", "Choose what we tell you about.",
          <div className="lv-card divide-y divide-lv-line px-5 sm:px-7">
            {([
              { key: "email", label: "Email", desc: "Updates about your designs by email" },
              { key: "browser", label: "Browser", desc: "Alerts in this browser while the site is open" },
              { key: "updates", label: "Product news", desc: "New features and improvements" },
            ] as const).map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between gap-4 py-5">
                <div className="min-w-0">
                  <p id={`nt-${key}`} className="text-base text-lv-ink">{label}</p>
                  <p className="mt-0.5 text-sm text-lv-muted">{desc}</p>
                </div>
                <button type="button" role="switch" aria-checked={notifications[key]} aria-labelledby={`nt-${key}`}
                  onClick={() => void toggleNotification(key)}
                  className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors ${notifications[key] ? "bg-lv-ink" : "bg-lv-line"}`}>
                  <span className={`absolute left-1 top-1 h-5 w-5 rounded-full shadow-sm transition-transform duration-200 ${
                    notifications[key] ? "translate-x-5 bg-lv-on-ink" : "translate-x-0 bg-lv-surface"
                  }`} />
                </button>
              </div>
            ))}
            {notifyError && (
              <p role="alert" className="flex items-center gap-1.5 py-4 text-sm text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {notifyError}
              </p>
            )}
          </div>,
        )}

        {/* Delete account */}
        {settingsRow("profile-delete", "Delete account", "Permanently removes your account, your floor plans and every saved design.",
          <div className="flex flex-col gap-5 rounded-[28px] border border-red-500/25 bg-red-500/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-500/15">
                <Trash2 className="h-5 w-5 text-red-400" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-base text-lv-ink">{isAdmin ? "Admin accounts can't be deleted" : "This can't be undone"}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-lv-muted">
                  {isAdmin
                    ? "An admin account stays on the site. Ask the site owner if it needs to be removed."
                    : "Download anything you want to keep before you delete your account."}
                </p>
              </div>
            </div>
            {!isAdmin && (
              <button type="button" onClick={openDeleteModal}
                className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-red-600 px-5 text-sm font-medium text-white transition-colors hover:bg-red-700">
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete account
              </button>
            )}
          </div>,
          true,
        )}
      </div>
    </>
  );
  return (
    <div className="min-h-screen w-full bg-background relative isolate flex flex-col">
      <PageGlows />
      {/* Delete Account Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => { if (!deleteSubmitting) setShowDeleteModal(false); }}>
            <motion.div role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-desc"
              initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }} transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md rounded-[28px] border border-lv-line bg-lv-surface p-6 shadow-2xl sm:p-8">
              <button type="button" onClick={() => setShowDeleteModal(false)} disabled={deleteSubmitting} aria-label="Close"
                className="absolute right-4 top-4 grid h-10 w-10 cursor-pointer place-items-center rounded-full text-lv-muted transition-colors hover:bg-lv-ink/8 hover:text-lv-ink">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>

              <span className="grid h-12 w-12 place-items-center rounded-full bg-red-500/15">
                <Trash2 className="h-5 w-5 text-red-400" aria-hidden="true" />
              </span>
              <h2 id="delete-title" className="mt-5 text-2xl leading-tight text-lv-ink">Delete your account?</h2>
              <p id="delete-desc" className="mt-2 text-sm leading-relaxed text-lv-muted">
                <span className="text-lv-ink">{profile.email || displayName}</span> and all of its floor plans and saved designs
                will be removed for good. This can't be undone.
              </p>

              <form className="mt-6" onSubmit={(e) => { e.preventDefault(); if (!deleteSubmitting) void handleDeleteAccount(); }}>
                <label htmlFor="delete-password" className={labelCls}>Enter your password to confirm</label>
                <input id="delete-password" type="password" autoFocus autoComplete="current-password"
                  value={deletePassword}
                  aria-invalid={deletePassError}
                  aria-describedby={deletePassError ? "delete-password-error" : undefined}
                  onChange={(e) => { setDeletePassword(e.target.value); setDeletePassError(false); }}
                  className={`lv-input ${deletePassError ? "border-red-500/60" : ""}`} />
                {deletePassError && <p id="delete-password-error" className="mt-1.5 text-sm text-red-400">Enter your password to delete the account.</p>}
                {deleteError && (
                  <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {deleteError}
                  </p>
                )}

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={() => setShowDeleteModal(false)} disabled={deleteSubmitting} className="lv-btn-quiet">
                    Cancel
                  </button>
                  <button type="submit" disabled={deleteSubmitting}
                    className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-red-600 px-5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {deleteSubmitting
                      ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Deleting account</>
                      : <><Trash2 className="h-4 w-4" aria-hidden="true" /> Delete account</>}
                  </button>
                </div>
              </form>
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
