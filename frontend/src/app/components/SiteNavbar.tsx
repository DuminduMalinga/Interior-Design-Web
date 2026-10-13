import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, ChevronDown, FolderOpen, Info, LayoutDashboard, LogOut, ShieldCheck, Upload, User } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";
import ThemeToggle from "./ThemeToggle";

const initialsOf = (name: string) =>
  (name || "U")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * The slim, sticky navigation bar of the dashboard, upload and about pages: logo, page links,
 * profile menu (My Profile / Log out) and the theme toggle.
 */
export default function SiteNavbar({
  leading,
  badge,
  activeNav,
  actions,
  name,
  email,
  onProfile,
}: {
  /** Which page link is highlighted; by default it follows the current route. */
  activeNav?: string;
  /** Shown before the logo — a page's own sidebar (hamburger) button. */
  leading?: ReactNode;
  /** Shown after the logo — e.g. the "Admin Panel" tag. */
  badge?: ReactNode;
  /** Extra controls before the profile menu — e.g. the admin notification bell. */
  actions?: ReactNode;
  /** Override the signed-in user's name / email (the dashboard shows its live profile edits). */
  name?: string;
  email?: string;
  /** What "My Profile" does; by default it opens the profile tab of the dashboard. */
  onProfile?: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { profile, signOut } = useCurrentUserProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const displayName = name ?? (profile.fullName?.trim() ? profile.fullName : profile.username);
  const displayEmail = email ?? profile.email;

  const handleLogout = async () => {
    const success = await signOut();
    if (success) {
      navigate("/");
    }
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/dashboard", state: { menu: "dashboard" } },
    { id: "upload", label: "Create Design", icon: Upload, path: "/upload", state: undefined },
    { id: "designs", label: "My Designs", icon: FolderOpen, path: "/dashboard", state: { menu: "designs" } },
    { id: "about", label: "About Us", icon: Info, path: "/about", state: undefined },
    ...(profile.role.trim().toLowerCase() === "admin"
      ? [{ id: "admin-accounts", label: "Manage Accounts", icon: ShieldCheck, path: "/admin/accounts", state: undefined }]
      : []),
  ];
  // Every page of the upload → 3D flow belongs to "Create Design".
  const routeNav =
    pathname === "/dashboard" ? "dashboard"
      : pathname === "/about" ? "about"
        : pathname.startsWith("/admin") ? "admin-accounts"
          : "upload";
  const currentNav = activeNav ?? routeNav;
  const goTo = (item: (typeof navItems)[number]) => navigate(item.path, { state: item.state });

  const handleProfile = () => {
    if (onProfile) {
      onProfile();
    } else {
      navigate("/dashboard", { state: { menu: "profile" } });
    }
  };

  return (
    <nav className="sticky top-0 glass-nav z-30">
      <div className="px-4 md:px-8 h-14 flex items-center">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-4">
            {leading}
            <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate("/dashboard")}>
              <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-1.5 rounded-lg shadow-md shadow-teal-500/20">
                <Box className="w-5 h-5 text-white" strokeWidth={1.75} />
              </div>
              <div className="hidden md:block">
                <h1 className="text-sm font-bold text-white leading-tight">3D Layout System</h1>
                <p className="text-[11px] text-zinc-500 leading-tight">AI-Powered Design</p>
              </div>
            </div>
            {badge}
          </div>
          <div className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goTo(item)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-2 px-3 xl:px-3.5 py-1.5 rounded-lg transition-colors text-[13px] font-medium whitespace-nowrap ${
                    isActive ? "bg-teal-500/10 text-teal-300" : "text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className="hidden xl:block w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            {actions}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Open profile menu"
                className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              >
                <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-xs font-bold shadow-md shadow-teal-500/20">
                  {initialsOf(displayName)}
                </div>
                <div className="hidden sm:block lg:hidden xl:block text-left">
                  <p className="text-[11px] text-zinc-500 leading-tight">Welcome back,</p>
                  <p className="font-semibold text-white text-[13px] leading-tight max-w-48 truncate">{displayName}</p>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-zinc-400 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    role="menu"
                    className="absolute right-0 top-full mt-3 w-64 rounded-2xl border border-white/10 bg-popover shadow-2xl overflow-hidden z-50"
                  >
                    <div className="p-4 border-b border-white/10">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold">
                          {initialsOf(displayName)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white text-sm truncate">{displayName}</p>
                          <p className="text-xs text-zinc-500 truncate">{displayEmail}</p>
                        </div>
                      </div>
                    </div>

                    {/* Below the lg breakpoint the page links live here instead of in the bar. */}
                    <div className="lg:hidden p-2 border-b border-white/10">
                      {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = currentNav === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              goTo(item);
                            }}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                              isActive ? "bg-teal-500/10 text-teal-300" : "text-zinc-300 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            <Icon className="w-4 h-4 text-teal-400" />
                            {item.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="p-2">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          handleProfile();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-300 hover:bg-white/5 hover:text-white transition-colors"
                      >
                        <User className="w-4 h-4 text-teal-400" />
                        My Profile
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          void handleLogout();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Log out
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </nav>
  );
}
