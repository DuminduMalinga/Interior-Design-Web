import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import ThemeToggle from "../ThemeToggle";
import BrandMark from "./BrandMark";

interface NavLink {
  href: string;
  label: string;
}

/**
 * Landing page header. Transparent at the top of the page with the section
 * links in a centred pill; once the page scrolls it gains a frosted backdrop.
 * The pill marks the section currently in view. Below lg the links move into
 * a menu.
 */
export default function LandingNav({ links }: { links: NavLink[] }) {
  const reduceMotion = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Mark the section that crosses the middle of the viewport
  useEffect(() => {
    const sections = links
      .map((l) => document.querySelector<HTMLElement>(l.href))
      .filter((s): s is HTMLElement => s !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const href = `#${entry.target.id}`;
          if (entry.isIntersecting) setActive(href);
          else setActive((current) => (current === href ? null : current));
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [links]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-300 ${
        scrolled || open ? "bg-lv-page/75 backdrop-blur-xl border-lv-line" : "border-transparent"
      }`}
    >
      <div className="relative max-w-[1400px] mx-auto h-[72px] px-5 sm:px-8 lg:px-14 xl:px-20 flex items-center justify-between gap-4">
        <Link to="/" aria-label="3D Layout System home" className="rounded-lg">
          <span className="block sm:hidden"><BrandMark withName={false} /></span>
          <span className="hidden sm:block"><BrandMark /></span>
        </Link>

        <nav
          aria-label="Sections"
          className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center gap-1 p-1 rounded-full bg-lv-surface/70 backdrop-blur-xl border border-lv-line text-sm whitespace-nowrap"
        >
          {links.map((l) => {
            const current = active === l.href;
            return (
              <a
                key={l.href}
                href={l.href}
                aria-current={current ? "true" : undefined}
                className={`px-4 h-9 inline-flex items-center rounded-full transition-colors duration-200 ${
                  current ? "bg-lv-ink text-lv-on-ink" : "text-lv-ink hover:bg-lv-ink/8"
                }`}
              >
                {l.label}
              </a>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle className="min-w-11 min-h-11 grid place-items-center rounded-full!" />
          <Link
            to="/signin"
            className="hidden sm:inline-flex px-3 min-h-11 items-center whitespace-nowrap text-sm font-medium text-lv-ink hover:text-lv-accent transition-colors rounded-full"
          >
            Sign in
          </Link>
          <Link to="/signup" className="lv-btn">
            Get started
          </Link>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="landing-menu"
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden min-w-11 min-h-11 grid place-items-center rounded-full text-lv-ink cursor-pointer hover:bg-lv-ink/8 transition-colors"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            id="landing-menu"
            aria-label="Menu"
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="lg:hidden absolute inset-x-3 top-full mt-2 p-2 rounded-3xl bg-lv-surface border border-lv-line shadow-xl"
          >
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="flex items-center min-h-12 px-4 rounded-2xl text-base text-lv-ink hover:bg-lv-ink/8 transition-colors"
              >
                {l.label}
              </a>
            ))}
            <Link
              to="/signin"
              className="sm:hidden flex items-center min-h-12 px-4 rounded-2xl text-base text-lv-ink hover:bg-lv-ink/8 transition-colors"
            >
              Sign in
            </Link>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
