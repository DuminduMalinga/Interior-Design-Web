import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, ChevronDown, LogOut, User } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
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
 * The top navigation bar shared by every signed-in page: logo, profile menu
 * (My Profile / Log out) and the theme toggle.
 */
export default function AppNavbar({
  leading,
  badge,
  actions,
  name,
  email,
  onProfile,
}: {
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

  const handleProfile = () => {
    if (onProfile) {
      onProfile();
    } else {
      navigate("/dashboard", { state: { menu: "profile" } });
    }
  };

  return (
    <nav className="relative glass-nav z-30">
      <div className="px-4 md:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {leading}
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/dashboard")}>
              <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-2 rounded-xl shadow-lg shadow-teal-500/20">
                <Box className="w-8 h-8 text-white" strokeWidth={1.5} />
              </div>
              <div className="hidden md:block">
                <h1 className="text-base font-bold text-white">3D Layout System</h1>
                <p className="text-xs text-zinc-500">AI-Powered Design</p>
              </div>
            </div>
            {badge}
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
                className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              >
                <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-sm font-bold shadow-md shadow-teal-500/20">
                  {initialsOf(displayName)}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs text-zinc-500">Welcome back,</p>
                  <p className="font-semibold text-white text-sm max-w-48 truncate">{displayName}</p>
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
