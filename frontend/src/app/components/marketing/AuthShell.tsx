import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import ThemeToggle from "../ThemeToggle";
import BrandMark from "./BrandMark";

interface AuthShellProps {
  title: string;
  subtitle?: ReactNode;
  /** Status icon shown above the title (success and loading screens). */
  icon?: ReactNode;
  /** Wider form column, for pages that lay fields out in two columns. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * Shared layout for the sign-in, sign-up and password pages: a showcase panel
 * on the left (from lg up) and the form on the right. Everything fits in one
 * viewport at lg and above; the form column scrolls on its own if it ever
 * has to (short windows, long validation messages).
 */
export default function AuthShell({ title, subtitle, icon, wide = false, children }: AuthShellProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="lv lv-plain relative min-h-svh overflow-hidden lg:h-svh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-3 lg:p-3">
      {/* Showcase panel */}
      <aside
        aria-label="About 3D Layout System"
        className="lv-on-photo relative hidden overflow-hidden rounded-[28px] bg-lv-wash lg:block"
      >
        <img
          src="/landing/lavender-dawn.webp"
          alt=""
          width={1672}
          height={941}
          className="lv-photo absolute inset-0 h-full w-full object-cover object-[80%_50%]"
        />
        <div className="absolute inset-0 lv-tint" aria-hidden="true" />
        <div
          className="absolute inset-x-0 top-0 h-3/5 bg-gradient-to-b from-[#f1effd]/70 via-[#f1effd]/25 to-transparent"
          aria-hidden="true"
        />

        <div className="relative flex h-full flex-col p-8 xl:p-10">
          <Link to="/" aria-label="3D Layout System home" className="self-start rounded-lg">
            <BrandMark />
          </Link>

          <div className="mt-10 max-w-md xl:mt-14">
            <p className="text-4xl font-medium leading-[1.05] tracking-tight text-lv-ink text-balance xl:text-5xl">
              Floor plan in. Furnished room out.
            </p>
            <p className="mt-4 max-w-sm text-base leading-relaxed text-lv-ink/80">
              Upload a 2D floor plan and get furniture layouts ranked by score, each one ready to explore in 3D.
            </p>
          </div>

          <figure className="mt-auto max-w-sm rounded-2xl border border-lv-line bg-lv-surface/85 p-5 shadow-lg backdrop-blur-md">
            <blockquote className="text-sm leading-relaxed text-lv-ink">
              “Cut my concept-to-presentation time by 70%. The AI nails functional layouts on the first try.”
            </blockquote>
            <figcaption className="mt-3 text-xs text-lv-muted">Sarah D., interior designer</figcaption>
          </figure>
        </div>
      </aside>

      {/* Form column */}
      <div className="flex min-h-svh flex-col lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-4 sm:px-8 lg:px-8">
          <Link to="/" aria-label="3D Layout System home" className="rounded-lg lg:hidden">
            <BrandMark />
          </Link>
          <Link
            to="/"
            className="hidden min-h-11 items-center gap-2 rounded-full text-sm text-lv-muted transition-colors hover:text-lv-ink lg:inline-flex"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to home
          </Link>
          <ThemeToggle className="min-w-11 min-h-11 grid place-items-center rounded-full!" />
        </div>

        <main className="flex flex-1 items-center justify-center px-5 py-6 sm:px-8">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className={`w-full ${wide ? "max-w-[540px]" : "max-w-[400px]"}`}
          >
            <header className="mb-5">
              {icon && <div className="mb-4">{icon}</div>}
              <h1 className="text-[1.75rem] leading-tight text-lv-ink sm:text-[2rem]">{title}</h1>
              {subtitle && <p className="mt-2 text-sm leading-relaxed text-lv-muted sm:text-base">{subtitle}</p>}
            </header>
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
