import { useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Link } from "react-router";
import { ArrowUp, Check } from "lucide-react";
import PageGlows from "../components/marketing/PageGlows";
import BrandMark from "../components/marketing/BrandMark";
import LandingNav from "../components/marketing/LandingNav";
import PlanSketch from "../components/marketing/PlanSketch";
import IsoRoom from "../components/marketing/IsoRoom";
import { useLandingMotion } from "../components/marketing/useLandingMotion";
import { useSiteStats, type SiteStats } from "../lib/useSiteStats";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#use-cases", label: "Who it's for" },
  { href: "#how-it-works", label: "How it works" },
];

const formatCount = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString());

function buildStats(stats: SiteStats | null) {
  return [
    { value: formatCount(stats?.users), label: "Registered users" },
    { value: "< 2 min", label: "Processing time" },
    { value: formatCount(stats?.layouts), label: "Layouts generated" },
    { value: formatCount(stats?.floorPlans), label: "Floor plans uploaded" },
  ];
}

const HEADLINE = ["Floor plan in.", "Furnished", "room out."];

const SUMMARY =
  "3D Layout System reads a 2D floor plan, works out where the rooms are, and arranges furniture in the room you pick, so you can judge a layout before moving a single chair.";

const RANKED = [
  { name: "Layout A", score: 92 },
  { name: "Layout B", score: 88 },
  { name: "Layout C", score: 81 },
];

const USE_CASES = [
  {
    title: "Interior designers",
    desc: "Go from a client's floor plan to a furnished concept in one sitting, with a score behind every layout you present.",
    image: "/dashboard/design-living-room.jpg",
    alt: "Living room with a grey sofa, leather poufs and a brass arc lamp",
    quote: "Cut my concept-to-presentation time by 70%. The AI nails functional layouts on the first try.",
    name: "Sarah D.",
  },
  {
    title: "Architects",
    desc: "Show clients the furnished room in 3D while the building is still a drawing.",
    image: "/dashboard/design-modern-bedroom.jpg",
    alt: "Dark bedroom with a white tufted bed and a brass chandelier",
    quote: "The 3D viewer alone is worth it. Clients can see exactly what they are getting before we break ground.",
    name: "James W.",
  },
  {
    title: "Property developers",
    desc: "Furnish each unit type straight from its plan and compare the ranked layouts side by side.",
    image: "/dashboard/design-guest-room.jpg",
    alt: "Bright guest bedroom in white and grey",
    quote: "We use it across every stage-ready unit. The scored layouts save hours of manual back-and-forth.",
    name: "Megan R.",
  },
];

const STEPS = [
  { title: "Upload a floor plan", desc: "Drop in a 2D image or PDF of your plan." },
  { title: "Rooms are detected", desc: "Every room boundary is mapped in seconds." },
  { title: "Pick a room", desc: "Choose the room you want to furnish." },
  { title: "Compare scored layouts", desc: "Browse furniture arrangements ranked by score." },
  { title: "Explore it in 3D", desc: "Open the layout you like in an interactive 3D view." },
];

/* Hero chips. They sit on the photo, which is light in both themes, hence lv-on-photo. */
function ScoreChip() {
  return (
    <div data-hero-chip className="lv-on-photo">
      <div data-float className="rounded-2xl bg-lv-surface/85 backdrop-blur-md border border-lv-line px-4 py-3 shadow-lg">
        <p className="text-xs text-lv-muted">Layout score</p>
        <p className="mt-0.5 flex items-baseline gap-1 text-lv-ink">
          <span className="text-2xl font-medium tracking-tight">92</span>
          <span className="text-xs text-lv-muted">/100</span>
        </p>
        <div className="mt-1.5 h-1.5 w-24 rounded-full bg-lv-line overflow-hidden">
          <div className="h-full w-[92%] rounded-full bg-lv-accent" />
        </div>
      </div>
    </div>
  );
}

const PLACED = ["Sofa", "Coffee table", "Armchair", "Rug"];

function PlacedChip() {
  return (
    <div data-hero-chip className="lv-on-photo">
      <div data-float className="rounded-2xl bg-lv-surface/85 backdrop-blur-md border border-lv-line p-4 shadow-lg">
        <p className="text-sm font-medium text-lv-ink">Furniture placed</p>
        <ul className="mt-3 space-y-2">
          {PLACED.map((item) => (
            <li key={item} className="flex items-center gap-2.5 text-xs text-lv-ink">
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-lv-accent text-[#fff]">
                <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Welcome() {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  useLandingMotion(rootRef);
  const stats = buildStats(useSiteStats());

  const [useCase, setUseCase] = useState(0);
  const useCaseTabs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeCase = USE_CASES[useCase];
  const onUseCaseKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = USE_CASES.length - 1;
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = useCase === last ? 0 : useCase + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = useCase === 0 ? last : useCase - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    setUseCase(next);
    useCaseTabs.current[next]?.focus();
  };

  return (
    <div ref={rootRef} id="top" className="lv lv-flow min-h-screen w-full overflow-x-clip">
      <PageGlows />

      <LandingNav links={NAV_LINKS} />

      <main>
        {/* ── Hero ── */}
        <section data-hero className="relative lg:-mt-20 lg:h-svh lg:min-h-[640px] overflow-hidden">
          <div className="relative z-10 lg:h-full max-w-[1400px] mx-auto px-5 sm:px-8 lg:px-14 xl:px-20 pt-8 sm:pt-12 lg:pt-20 lg:pb-6 flex flex-col justify-center pointer-events-none">
            <div data-hero-copy className="lg:max-w-[46%] pointer-events-auto">
              <h1
                aria-label={HEADLINE.join(" ")}
                className="text-[clamp(2.3rem,5.25vw,5.5rem)] leading-[0.98] text-lv-ink"
              >
                {HEADLINE.map((line) => (
                  <span key={line} aria-hidden="true" className="block">
                    {line.split(" ").map((word, i) => (
                      <span key={i} className="inline-block overflow-hidden align-bottom pb-[0.16em] -mb-[0.16em] mr-[0.22em] last:mr-0">
                        <span data-hero-word className="inline-block">{word}</span>
                      </span>
                    ))}
                  </span>
                ))}
              </h1>
              <p data-hero-fade className="mt-5 lg:mt-7 max-w-sm xl:max-w-[26rem] text-[15px] md:text-base leading-relaxed text-lv-muted">
                Upload a 2D floor plan and get furniture layouts ranked by score, each one ready to explore in 3D.
              </p>
              <div data-hero-fade className="mt-6 flex flex-wrap items-center gap-3">
                <Link to="/signup" className="lv-btn">
                  Get started free
                </Link>
                <a href="#how-it-works" className="lv-btn-quiet">
                  See how it works
                </a>
              </div>
              <dl data-hero-fade className="mt-9 lg:mt-12 grid grid-cols-3 gap-4 sm:flex sm:gap-9 border-t border-lv-line pt-5">
                {stats.slice(0, 3).map((s) => (
                  <div key={s.label} className="flex flex-col-reverse">
                    <dt className="text-xs text-lv-muted">{s.label}</dt>
                    <dd className="text-lg md:text-xl font-medium tracking-tight tabular-nums text-lv-ink">
                      {s.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* The arch: a framed view below lg, a clipped full-bleed layer from lg up that opens on scroll */}
          <div className="px-5 sm:px-8 mt-10 lg:mt-0 lg:px-0 lg:absolute lg:inset-0">
            <div data-hero-stage className="lv-hero-stage relative overflow-hidden aspect-[4/5] sm:aspect-[16/11] lg:aspect-auto lg:h-full">
              <div data-hero-shift className="absolute inset-0">
                <div data-hero-wipe className="absolute inset-0">
                  <img
                    data-hero-img
                    src="/landing/lavender-valley.webp"
                    alt="Open terrace lounge with a curved white sofa and an armchair, surrounded by lavender and overlooking a misty valley"
                    width={1672}
                    height={941}
                    {...{ fetchpriority: "high" }}
                    className="h-full w-full object-cover object-bottom"
                  />
                </div>
              </div>
              <div className="lg:hidden absolute bottom-4 right-4">
                <ScoreChip />
              </div>
              <div className="hidden sm:block lg:hidden absolute bottom-4 left-4 w-52">
                <PlacedChip />
              </div>
            </div>
          </div>

          <div data-hero-chip-move="plan" className="hidden lg:block absolute z-20 w-44 xl:w-52 left-[calc(57%-4.5rem)] xl:left-[calc(57%-7.5rem)] top-[56%] xl:top-[52%]">
            <PlacedChip />
          </div>
          <div data-hero-chip-move="score" className="hidden lg:block absolute z-20 right-[calc(11%-3rem)] top-[28%]">
            <ScoreChip />
          </div>
        </section>

        {/* ── What it does ── */}
        <section id="features" className="max-w-6xl mx-auto px-4 md:px-6 pt-20 md:pt-28">
          <div className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-end">
            <h2 data-reveal className="text-4xl md:text-5xl leading-[1.08] text-lv-ink">What does it do?</h2>
            <p data-words className="text-xl md:text-[1.375rem] leading-snug text-lv-ink max-w-md md:justify-self-end">
              {SUMMARY.split(" ").map((word, i) => (
                <span key={i} data-word>{word} </span>
              ))}
            </p>
          </div>

          <div data-stagger className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <article className="md:col-span-2 rounded-[24px] bg-lv-wash p-6 md:p-7 min-h-[300px] flex flex-col sm:flex-row gap-6">
              <div className="flex flex-col justify-between sm:w-[38%]">
                <h3 className="text-2xl leading-tight text-lv-ink">Rooms found for you</h3>
                <p className="mt-6 text-sm leading-relaxed text-lv-ink">
                  Walls, doors and windows are read from your plan and every room is outlined and named. No tracing.
                </p>
              </div>
              <PlanSketch className="w-full sm:w-[62%] self-center" />
            </article>

            <article className="rounded-[24px] bg-lv-deep text-lv-on-deep p-6 md:p-7 min-h-[240px] lg:min-h-[300px] flex flex-col justify-between">
              <h3 className="text-2xl leading-tight">Layouts, ranked</h3>
              <ul data-bars className="mt-6 space-y-3" aria-label="Example layout scores">
                {RANKED.map((r) => (
                  <li key={r.name} className="text-xs text-lv-on-deep/80">
                    <div className="flex justify-between">
                      <span>{r.name}</span>
                      <span className="tabular-nums">{r.score}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-lv-on-deep/15 overflow-hidden">
                      <div data-bar className="h-full rounded-full bg-lv-on-deep/85" style={{ width: `${r.score}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm leading-relaxed text-lv-on-deep/80">
                Hundreds of furniture arrangements are scored for fit and flow. You see the best ones first.
              </p>
            </article>

            <article className="rounded-[24px] bg-lv-deep text-lv-on-deep p-6 md:p-7 min-h-[240px] lg:min-h-[300px] flex flex-col justify-between">
              <h3 className="text-2xl leading-tight">Walk through it in 3D</h3>
              <IsoRoom className="mt-4 w-full max-w-[220px] self-center text-lv-on-deep" />
              <p className="mt-6 text-sm leading-relaxed text-lv-on-deep/80">
                Open any layout in the 3D viewer, then rotate and zoom until the room makes sense.
              </p>
            </article>
          </div>
        </section>

        {/* ── Facts ── */}
        <section aria-label="In numbers" className="max-w-6xl mx-auto px-4 md:px-6 pt-14">
          <dl data-stagger className="grid grid-cols-2 md:grid-cols-4 gap-y-8 gap-x-6 border-y border-lv-line py-8">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col-reverse">
                <dt className="mt-1 text-sm text-lv-muted">{s.label}</dt>
                <dd className="text-3xl md:text-4xl font-medium tracking-tight tabular-nums text-lv-ink">{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Who it's for ── */}
        <section id="use-cases" className="max-w-6xl mx-auto px-4 md:px-6 pt-20 md:pt-28">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:items-start">
            <div data-reveal>
              <h2 className="text-4xl md:text-5xl leading-[1.08] text-lv-ink">Who it's for</h2>
              <p className="mt-5 max-w-sm text-base leading-relaxed text-lv-muted">
                Anyone who has a floor plan and needs to know how the room will actually work once it is furnished.
              </p>

              <div role="tablist" aria-label="Who it's for" onKeyDown={onUseCaseKey} className="mt-8 flex flex-col gap-2">
                {USE_CASES.map((u, i) => {
                  const selected = i === useCase;
                  return (
                    <button
                      key={u.title}
                      ref={(el) => { useCaseTabs.current[i] = el; }}
                      type="button"
                      role="tab"
                      id={`use-case-tab-${i}`}
                      aria-selected={selected}
                      aria-controls="use-case-panel"
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setUseCase(i)}
                      className={`flex items-center gap-3 min-h-14 px-5 rounded-2xl border text-left text-lg cursor-pointer transition-colors ${
                        selected
                          ? "bg-lv-surface border-lv-line text-lv-ink"
                          : "border-transparent text-lv-muted hover:text-lv-ink"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 rounded-full ${selected ? "bg-lv-accent" : "bg-lv-line"}`}
                      />
                      {u.title}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              data-reveal
              role="tabpanel"
              id="use-case-panel"
              aria-labelledby={`use-case-tab-${useCase}`}
              tabIndex={0}
              className="rounded-[24px] bg-lv-surface border border-lv-line overflow-hidden"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeCase.title}
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <div className="relative aspect-[16/9] bg-lv-wash">
                    <img
                      src={activeCase.image}
                      alt={activeCase.alt}
                      width={720}
                      height={480}
                      loading="lazy"
                      className="lv-photo absolute inset-0 h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 lv-tint" aria-hidden="true" />
                  </div>
                  <div className="grid gap-6 p-6 md:p-8 md:grid-cols-2 md:min-h-[168px]">
                    <p className="text-lg md:text-xl leading-snug text-lv-ink">{activeCase.desc}</p>
                    <figure className="border-l-2 border-lv-accent pl-4">
                      <blockquote className="text-sm leading-relaxed text-lv-ink">“{activeCase.quote}”</blockquote>
                      <figcaption className="mt-2 text-sm text-lv-muted">{activeCase.name}</figcaption>
                    </figure>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how-it-works" className="max-w-6xl mx-auto px-4 md:px-6 pt-20 md:pt-28">
          <h2 data-reveal className="max-w-xl text-4xl md:text-5xl leading-[1.08] text-lv-ink">From upload to 3D in five steps</h2>
          <div data-steps-line aria-hidden="true" className="hidden lg:block mt-12 -mb-px h-px origin-left bg-lv-accent" />
          <ol data-stagger className="mt-12 lg:mt-0 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="border-t border-lv-line pt-5">
                <span className="text-sm font-medium tabular-nums text-lv-accent">{i + 1}</span>
                <h3 className="mt-3 text-lg leading-snug text-lv-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-lv-muted">{step.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Closing ── */}
        <section className="max-w-6xl mx-auto px-4 md:px-6 pt-20 md:pt-28">
          <div
            data-reveal
            className="relative overflow-hidden rounded-[32px] bg-lv-deep text-lv-on-deep"
          >
            {/* Lavender light from the top right, and arch outlines echoing the hero */}
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(60% 80% at 88% 8%, rgba(139,122,240,0.45), transparent 65%), radial-gradient(40% 50% at 0% 100%, rgba(129,140,248,0.22), transparent 70%)",
              }}
            />

            <div className="relative grid gap-12 px-6 py-14 sm:px-10 md:px-14 md:py-20 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-6 lg:py-24">
              <div>
                <h2 className="text-[2.5rem] leading-[1.04] md:text-6xl text-balance">
                  Start with one floor plan.
                </h2>
                <p className="mt-5 max-w-md text-base md:text-lg leading-relaxed text-lv-on-deep/75">
                  Create an account, upload a plan and see your first scored layouts in under a minute.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link to="/signup" className="lv-btn-invert">
                    Create free account
                  </Link>
                  <Link
                    to="/signin"
                    className="inline-flex min-h-11 items-center rounded-full border border-lv-on-deep/25 px-6 text-sm font-medium text-lv-on-deep transition-colors hover:bg-lv-on-deep/10"
                  >
                    Sign in
                  </Link>
                </div>

                <ul className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-sm text-lv-on-deep/75">
                  {["No 3D modelling skills needed", "Layouts ready in under 15 seconds"].map((t) => (
                    <li key={t} className="flex items-center gap-2.5">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-lv-on-deep/15">
                        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>

              {/* The arch: outline rings behind, the room inside */}
              <div className="relative mx-auto w-full max-w-[300px] sm:max-w-[340px] lg:ml-auto lg:mr-6">
                <div aria-hidden="true" className="absolute -inset-4 rounded-t-full rounded-b-[2rem] border border-lv-on-deep/15" />
                <div aria-hidden="true" className="absolute -inset-8 rounded-t-full rounded-b-[2.5rem] border border-lv-on-deep/[0.07]" />
                <div className="relative aspect-[3/4] overflow-hidden rounded-t-full rounded-b-3xl shadow-2xl">
                  <img
                    src="/landing/lavender-valley.webp"
                    alt=""
                    width={1672}
                    height={941}
                    loading="lazy"
                    className="h-full w-full origin-bottom-right scale-[1.35] object-cover object-[100%_100%]"
                  />
                </div>
                <div className="lv-on-photo absolute -left-3 bottom-8 sm:-left-8">
                  <div className="flex items-center gap-3 rounded-2xl border border-lv-line bg-lv-surface/90 px-4 py-3 shadow-lg backdrop-blur-md">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-lv-accent text-[#fff]">
                      <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-medium leading-tight text-lv-ink">Layout ready</p>
                      <p className="text-xs text-lv-muted">Score 92 / 100</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="max-w-6xl mx-auto px-4 md:px-6 pt-20 md:pt-28 pb-8">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr]">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link to="/" aria-label="3D Layout System home" className="inline-block rounded-lg">
              <BrandMark size={30} />
            </Link>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-lv-muted">
              Upload a floor plan and get furniture layouts ranked by score, each one ready to explore in 3D.
            </p>
            <Link to="/signup" className="lv-btn mt-6">
              Get started free
            </Link>
          </div>

          <nav aria-label="Explore">
            <p className="text-sm font-medium text-lv-ink">Explore</p>
            <ul className="mt-4 space-y-1">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="inline-flex min-h-9 items-center text-sm text-lv-muted transition-colors hover:text-lv-ink">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Account">
            <p className="text-sm font-medium text-lv-ink">Account</p>
            <ul className="mt-4 space-y-1">
              <li>
                <Link to="/signin" className="inline-flex min-h-9 items-center text-sm text-lv-muted transition-colors hover:text-lv-ink">
                  Sign in
                </Link>
              </li>
              <li>
                <Link to="/signup" className="inline-flex min-h-9 items-center text-sm text-lv-muted transition-colors hover:text-lv-ink">
                  Create an account
                </Link>
              </li>
              <li>
                <Link to="/forgot-password" className="inline-flex min-h-9 items-center text-sm text-lv-muted transition-colors hover:text-lv-ink">
                  Forgot password
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-14 flex flex-col-reverse gap-4 border-t border-lv-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-lv-muted">
            © {new Date().getFullYear()} roomscape. All rights reserved.
          </p>
          <a
            href="#top"
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-lv-line px-4 text-sm text-lv-ink transition-colors hover:bg-lv-ink/8 sm:self-auto"
          >
            Back to top
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>

        <p
          aria-hidden="true"
          className="mt-10 select-none overflow-hidden whitespace-nowrap text-center text-[clamp(3.5rem,17vw,13rem)] font-medium leading-[0.9] tracking-tighter bg-gradient-to-b from-lv-accent/35 to-transparent bg-clip-text text-transparent"
        >
          roomscape
        </p>
      </footer>
    </div>
  );
}
