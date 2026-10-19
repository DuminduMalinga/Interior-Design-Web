import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, FolderOpen, Info, LayoutDashboard, LogOut, ShieldCheck, Upload, User } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";
import ThemeToggle from "./ThemeToggle";
import BrandMark from "./marketing/BrandMark";

const initialsOf = (name: string) =>
  (name || "U")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * The navigation bar of every signed-in page: logo, page links in a centred
 * pill, profile menu (My Profile / Log out) and the theme toggle. It matches
 * the landing page's bar: clear at the top of the page, frosted once scrolled.
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
  const reduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
    { id: "upload", label: "Create design", icon: Upload, path: "/upload", state: undefined },
    { id: "designs", label: "My designs", icon: FolderOpen, path: "/dashboard", state: { menu: "designs" } },
    { id: "about", label: "About", icon: Info, path: "/about", state: undefined },
    ...(profile.role.trim().toLowerCase() === "admin"
      ? [{ id: "admin-accounts", label: "Accounts", icon: ShieldCheck, path: "/admin/accounts", state: undefined }]
      : []),
  ];
  // Every page of the upload → 3D flow belongs to "Create design".
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

  const menuItemCls =
    "w-full flex items-center gap-3 px-3 min-h-11 rounded-xl text-sm text-lv-ink hover:bg-lv-ink/8 transition-colors cursor-pointer";

  return (
    <nav
      className={`sticky top-0 z-30 border-b transition-colors duration-300 ${
        scrolled || menuOpen ? "bg-lv-page/80 backdrop-blur-xl border-lv-line" : "border-transparent"
      }`}
    >
      <div className="h-20 px-4 md:px-8 lg:px-12 xl:px-16 flex items-center gap-4">
        <div className="flex flex-1 min-w-0 items-center gap-3">
          {leading}
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            aria-label="3D Layout System dashboard"
            className="rounded-lg cursor-pointer"
          >
            <span className="block md:hidden"><BrandMark withName={false} /></span>
            <span className="hidden md:block"><BrandMark /></span>
          </button>
          {badge}
        </div>

        <div className="hidden lg:flex items-center gap-1 p-1 rounded-full bg-lv-surface/70 backdrop-blur-xl border border-lv-line text-sm whitespace-nowrap">
          {navItems.map((item) => {
            const isActive = currentNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goTo(item)}
                aria-current={isActive ? "page" : undefined}
                className={`relative px-4 h-9 inline-flex items-center rounded-full cursor-pointer transition-colors duration-200 ${
                  isActive ? "text-lv-on-ink" : "text-lv-ink hover:bg-lv-ink/8"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="site-nav-pill"
                    className="absolute inset-0 rounded-full bg-lv-ink"
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 34 }}
                  />
                )}
                <span className="relative">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          {actions}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Open profile menu"
              className="flex items-center gap-2.5 rounded-full p-1 pr-2.5 min-h-11 border border-lv-line bg-lv-surface/70 hover:bg-lv-ink/8 transition-colors cursor-pointer"
            >
              <span className="w-8 h-8 shrink-0 overflow-hidden rounded-full bg-lv-ink text-lv-on-ink grid place-items-center text-xs font-semibold">
                {profile.avatarUrl
                  ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                  : initialsOf(displayName)}
              </span>
              <span className="hidden xl:block max-w-40 truncate text-sm font-medium text-lv-ink">{displayName}</span>
              <ChevronDown
                className={`w-4 h-4 text-lv-muted transition-transform ${menuOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  role="menu"
                  className="absolute right-0 top-full mt-3 w-64 rounded-3xl border border-lv-line bg-lv-surface shadow-xl overflow-hidden z-50"
                >
                  <div className="p-4 border-b border-lv-line">
                    <div className="flex items-center gap-3">
                      <span className="w-11 h-11 shrink-0 overflow-hidden rounded-full bg-lv-ink text-lv-on-ink grid place-items-center text-sm font-semibold">
                        {profile.avatarUrl
                          ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                          : initialsOf(displayName)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-lv-ink text-sm truncate">{displayName}</p>
                        <p className="text-xs text-lv-muted truncate">{displayEmail}</p>
                      </div>
                    </div>
                  </div>

                  {/* Below the lg breakpoint the page links live here instead of in the bar. */}
                  <div className="lg:hidden p-2 border-b border-lv-line">
                    {navItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentNav === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => {
                            setMenuOpen(false);
                            goTo(item);
                          }}
                          className={`${menuItemCls} ${isActive ? "bg-lv-ink/8 font-medium" : ""}`}
                        >
                          <Icon className="w-4 h-4 text-lv-accent" aria-hidden="true" />
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
                      className={menuItemCls}
                    >
                      <User className="w-4 h-4 text-lv-accent" aria-hidden="true" />
                      My profile
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void handleLogout();
                      }}
                      className="w-full flex items-center gap-3 px-3 min-h-11 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" aria-hidden="true" />
                      Log out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <ThemeToggle className="min-w-11 min-h-11 grid place-items-center rounded-full!" />
        </div>
      </div>
    </nav>
  );
}
