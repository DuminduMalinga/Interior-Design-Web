import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, Box, ChevronsLeftRight, Github, Linkedin, Mail, MessageSquareText, Ruler } from "lucide-react";
import { useNavigate } from "react-router";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import SiteNavbar from "../components/SiteNavbar";
import PageGlows from "../components/marketing/PageGlows";
import AppFooter from "../components/AppFooter";
import PlanSketch from "../components/marketing/PlanSketch";

gsap.registerPlugin(ScrollTrigger);

const TITLE = "From a flat plan to a room you can walk through";

const STEPS = [
  {
    title: "Upload a plan",
    desc: "Add a PNG or JPG of a 2D floor plan. Walls, doors, windows and room names are read straight off the drawing.",
    image: null,
  },
  {
    title: "Pick a room",
    desc: "Choose the room you want to furnish. Its real size comes from the measurements printed on the plan.",
    image: { src: "/about/pick-a-room.png", alt: "A 3D cut-away of a floor plan with the living room highlighted and labelled" },
  },
  {
    title: "Compare layouts",
    desc: "Every arrangement the walls allow is tried, checked against rules for clearance and movement, and ranked.",
    image: { src: "/about/compare-layouts.png", alt: "Three furnished layouts of the same bedroom side by side, with the second one selected" },
  },
  {
    title: "Walk through it in 3D",
    desc: "Open the layout you like as a 3D room at real size. Turn it, zoom in, then save it or download it.",
    image: { src: "/about/walk-through-3d.png", alt: "A furnished living room with a corner sofa, round coffee table and lavender wall" },
  },
];

const ROOMS = [
  { name: "Dining room", image: "/about/dining-room.png" },
  { name: "Living room", image: "/about/living-room.png" },
  { name: "Kitchen", image: "/about/kitchen.png" },
  { name: "Bedroom", image: "/about/bedroom.png" },
  { name: "Bathroom", image: "/about/bathroom.png" },
];

const PRINCIPLES = [
  { icon: Ruler, title: "Real measurements", desc: "Rooms are sized from the plan's own dimensions, so a sofa that fits here fits at home." },
  { icon: MessageSquareText, title: "Every choice explained", desc: "Each piece says why it stands where it does: the wall it uses, the path it keeps clear." },
  { icon: Box, title: "See it before you buy", desc: "Look at the room from any angle in 3D before a single piece of furniture moves." },
];

/**
 * The team. Placeholder details for now: replace each entry with the real
 * name, role and links. For a photo, put the image in public/about/team/ and
 * set `photo` to its path (e.g. "/about/team/akalanka.jpg"); without one the
 * card shows the person's initials. Leave a link empty ("") to hide it.
 */
type Member = { name: string; role: string; photo: string | null; email: string; github: string; linkedin: string };

const TEAM: Member[] = [
  { name: "Member One", role: "Project lead", photo: null, email: "member.one@example.com", github: "#", linkedin: "#" },
  { name: "Member Two", role: "Floor plan detection", photo: null, email: "member.two@example.com", github: "#", linkedin: "#" },
  { name: "Member Three", role: "Layout engine", photo: null, email: "member.three@example.com", github: "#", linkedin: "#" },
  { name: "Member Four", role: "3D visualisation", photo: null, email: "member.four@example.com", github: "#", linkedin: "#" },
  { name: "Member Five", role: "Frontend and design", photo: null, email: "member.five@example.com", github: "#", linkedin: "#" },
];

const initialsOf = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/**
 * The About page's motion. Different from the landing page on purpose: words
 * come into focus, photos are wiped open, the steps light up as they pass, the
 * room strip slides sideways and the closing card grows to full width.
 * Nothing runs when the visitor prefers reduced motion.
 */
function useAboutMotion(
  root: RefObject<HTMLDivElement | null>,
  onStep: (i: number) => void,
  onSplit: (value: number) => void,
) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const mm = gsap.matchMedia(el);

    // The active step follows the scroll whatever the motion setting, it is a crossfade, not movement.
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-ab-step]").forEach((step, i) => {
        ScrollTrigger.create({
          trigger: step,
          start: "top 55%",
          end: "bottom 55%",
          onToggle: (self) => self.isActive && onStep(i),
        });
      });
    }, el);

    mm.add(
      { motion: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 1024px)" },
      (context) => {
        const { motion, desktop } = context.conditions as { motion: boolean; desktop: boolean };
        if (!motion) return;

        // Hero: words come into focus, the frame is wiped open from below, then
        // the divider sweeps from the plan side to the middle to show it moves.
        const split = { value: 92 };
        onSplit(92);
        gsap
          .timeline({ defaults: { ease: "expo.out" } })
          .from("[data-ab-word]", { autoAlpha: 0, filter: "blur(14px)", x: -8, duration: 1.1, stagger: 0.06 })
          .from("[data-ab-lead]", { autoAlpha: 0, filter: "blur(8px)", duration: 0.9 }, 0.45)
          .fromTo(
            "[data-ab-wipe]",
            { clipPath: "inset(100% 0% 0% 0% round 32px)" },
            { clipPath: "inset(0% 0% 0% 0% round 32px)", duration: 1.4 },
            0.3,
          )
          .to(split, { value: 50, duration: 1.6, ease: "power3.inOut", onUpdate: () => onSplit(split.value) }, 1.1);
        // Dragging the divider takes over from the intro sweep.
        const compare = el.querySelector("[data-ab-compare]");
        const stopSweep = () => gsap.killTweensOf(split);
        compare?.addEventListener("pointerdown", stopSweep, { once: true });
        compare?.addEventListener("keydown", stopSweep, { once: true });

        // Rooms: the strip slides sideways while the section passes.
        const track = el.querySelector<HTMLElement>("[data-ab-track]");
        if (desktop && track) {
          gsap.to(track, {
            x: () => -Math.max(0, track.scrollWidth - (track.parentElement?.clientWidth ?? 0)),
            ease: "none",
            scrollTrigger: {
              trigger: "[data-ab-rooms]",
              start: "top 70%",
              end: "bottom 15%",
              scrub: 0.8,
              invalidateOnRefresh: true,
            },
          });
        }

        // Principles settle into place: a short rise from slightly smaller, kept
        // flat (no 3D tilt, which warps the cards and blurs their text mid-way).
        gsap.from("[data-ab-flap]", {
          y: 28,
          scale: 0.97,
          autoAlpha: 0,
          duration: 0.9,
          stagger: 0.1,
          ease: "power2.out",
          clearProps: "transform",
          scrollTrigger: { trigger: "[data-ab-principles]", start: "top 85%", once: true },
        });

        // Team: the cards rise in one after another, then each round photo pops
        // in with a small overshoot. Transforms are cleared so the CSS hover lift works.
        gsap
          .timeline({ scrollTrigger: { trigger: "[data-ab-team]", start: "top 82%", once: true } })
          .from("[data-ab-member]", {
            y: 20,
            autoAlpha: 0,
            duration: 0.6,
            stagger: 0.08,
            ease: "power2.out",
            clearProps: "transform",
          })
          .from(
            "[data-ab-member-photo]",
            { scale: 0.4, autoAlpha: 0, duration: 0.7, stagger: 0.08, ease: "back.out(2)", clearProps: "transform" },
            0.15,
          );

        // Closing card grows from a pill to full width (clipped, so the text is never squashed).
        gsap.fromTo(
          "[data-ab-cta]",
          { clipPath: "inset(0% 8% 0% 8% round 160px)" },
          {
            clipPath: "inset(0% 0% 0% 0% round 28px)",
            ease: "none",
            scrollTrigger: { trigger: "[data-ab-cta]", start: "top 95%", end: "top 55%", scrub: true },
          },
        );
      },
    );

    return () => {
      ctx.revert();
      mm.revert();
    };
  }, [root, onStep, onSplit]);
}

export default function About() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(0);
  const onStep = useRef((i: number) => setActiveStep(i)).current;
  // Hero comparison: how much of the frame, from the left, shows the plan.
  const [split, setSplit] = useState(50);
  const onSplit = useRef((v: number) => setSplit(v)).current;
  useAboutMotion(rootRef, onStep, onSplit);

  const compareRef = useRef<HTMLDivElement>(null);
  const splitFromPointer = (clientX: number) => {
    const box = compareRef.current?.getBoundingClientRect();
    if (!box) return;
    setSplit(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)));
  };

  const createButton = (invert = false) => (
    <button type="button" onClick={() => navigate("/upload")}
      className={`${invert ? "lv-btn-invert" : "lv-btn"} min-h-12 shrink-0 px-6`}>
      Create a design <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  return (
    <div ref={rootRef} className="relative isolate flex min-h-screen w-full flex-col bg-background">
      <PageGlows />
      <SiteNavbar />

      <main className="w-full flex-1 overflow-x-clip px-4 pb-20 pt-8 md:px-8 md:pt-12">
        <div className="mx-auto max-w-6xl">
          {/* ── Hero ── */}
          <section aria-labelledby="about-title" className="flex flex-col items-center text-center">
            <h1 id="about-title" className="max-w-4xl text-5xl leading-[1.02] tracking-tight text-lv-ink text-balance md:text-7xl">
              {TITLE.split(" ").map((word, i) => (
                <span key={i} data-ab-word className="inline-block whitespace-pre">{word}{" "}</span>
              ))}
            </h1>
            <div data-ab-lead className="mt-6 flex flex-col items-center gap-7">
              <p className="max-w-2xl text-lg leading-relaxed text-lv-muted md:text-xl">
                roomscape reads a 2D floor plan, finds its rooms, and furnishes the one you pick using rules for space,
                light and movement. Then you walk through it in 3D.
              </p>
              {createButton()}
            </div>

            {/* Plan on the left, the finished room on the right; the divider can be dragged */}
            <figure data-ab-wipe className="mt-14 w-full">
              <div
                ref={compareRef}
                data-ab-compare
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  splitFromPointer(e.clientX);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) splitFromPointer(e.clientX);
                }}
                className="relative aspect-[4/3] w-full cursor-ew-resize touch-pan-y select-none overflow-hidden rounded-[32px] border border-lv-line bg-lv-surface shadow-[var(--lv-shadow)] sm:aspect-[16/9]"
              >
                <img src="/about/walk-through-3d.png" alt="The finished room: a furnished living room in soft lavender tones"
                  draggable={false} className="absolute inset-0 h-full w-full object-cover" />
                <img src="/about/pick-a-room.png" alt="The plan: a 3D cut-away of a floor plan with the living room picked out"
                  draggable={false} className="absolute inset-0 h-full w-full object-cover"
                  style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />

                <span className={`pointer-events-none absolute left-4 top-4 rounded-full border border-lv-line bg-lv-surface/85 px-3.5 py-1.5 text-sm text-lv-ink backdrop-blur-md transition-opacity sm:left-6 sm:top-6 ${split < 14 ? "opacity-0" : ""}`}>
                  Floor plan
                </span>
                <span className={`pointer-events-none absolute right-4 top-4 rounded-full border border-lv-line bg-lv-surface/85 px-3.5 py-1.5 text-sm text-lv-ink backdrop-blur-md transition-opacity sm:right-6 sm:top-6 ${split > 86 ? "opacity-0" : ""}`}>
                  Furnished room
                </span>

                {/* Divider and its handle */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[#fff]/90 shadow-[0_0_0_1px_rgba(38,34,63,0.15)]"
                  style={{ left: `${split}%` }} />
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Compare the floor plan with the furnished room"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(split)}
                  aria-valuetext={`${Math.round(split)}% floor plan`}
                  onKeyDown={(e) => {
                    const step = e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0;
                    if (!step) return;
                    e.preventDefault();
                    setSplit((v) => Math.min(100, Math.max(0, v + step)));
                  }}
                  className="absolute top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#fff] text-[#26223f] shadow-lg outline-none focus-visible:ring-4 focus-visible:ring-lv-accent/60"
                  style={{ left: `${split}%` }}
                >
                  <ChevronsLeftRight className="h-5 w-5" aria-hidden="true" />
                </div>
              </div>
              <figcaption className="mt-4 text-sm text-lv-muted">Drag the handle to go from the plan to the finished room.</figcaption>
            </figure>
          </section>

          {/* ── How it works ── */}
          <section aria-labelledby="about-how" className="mt-28 grid gap-10 lg:mt-36 lg:grid-cols-2 lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:h-[calc(100svh-9rem)] lg:self-start">
              <h2 id="about-how" className="text-3xl leading-tight tracking-tight text-lv-ink md:text-5xl">How it works</h2>
              <p className="mt-3 max-w-sm text-base text-lv-muted">Four steps, a couple of minutes, one plan.</p>
              {/* The frame follows the step in view */}
              <div className="relative mt-8 hidden aspect-[16/9] overflow-hidden rounded-[28px] border border-lv-line bg-lv-surface lg:block">
                {STEPS.map((step, i) => (
                  <div key={step.title} aria-hidden={activeStep !== i}
                    className={`absolute inset-0 transition-all duration-700 ease-out motion-reduce:transition-none ${
                      activeStep === i ? "scale-100 opacity-100" : "scale-[1.04] opacity-0"
                    }`}>
                    {step.image ? (
                      <img src={step.image.src} alt={step.image.alt} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center bg-lv-wash p-10"><PlanSketch className="w-full max-w-md" /></div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <ol className="lg:pb-[20vh] lg:pt-[18vh]">
              {STEPS.map((step, i) => (
                <li key={step.title} data-ab-step
                  className={`flex gap-5 border-t border-lv-line py-8 transition-opacity duration-500 motion-reduce:transition-none lg:min-h-[48vh] lg:py-12 ${
                    activeStep === i ? "opacity-100" : "lg:opacity-35"
                  }`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-medium transition-colors duration-500 ${
                    activeStep === i ? "bg-lv-ink text-lv-on-ink" : "border border-lv-line text-lv-muted"
                  }`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-2xl leading-tight text-lv-ink md:text-3xl">{step.title}</h3>
                    <p className="mt-3 max-w-md text-base leading-relaxed text-lv-muted">{step.desc}</p>
                    {/* Below lg the picture sits with its step */}
                    <div className="mt-6 aspect-[16/9] overflow-hidden rounded-[24px] border border-lv-line lg:hidden">
                      {step.image ? (
                        <img src={step.image.src} alt={step.image.alt} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center bg-lv-wash p-6"><PlanSketch className="w-full" /></div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ── Rooms ── */}
          <section data-ab-rooms aria-labelledby="about-rooms" className="mt-28 lg:mt-36">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <h2 id="about-rooms" className="text-3xl leading-tight tracking-tight text-lv-ink md:text-5xl">Rooms it can furnish</h2>
              <p className="max-w-sm text-base text-lv-muted">Upload one plan and furnish any of these rooms from it, each with its own rules.</p>
            </div>
            <div className="-mx-4 mt-10 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:-mx-8 md:px-8 lg:mx-0 lg:overflow-visible lg:px-0">
              <ul data-ab-track className="flex w-max snap-x snap-mandatory gap-4 lg:snap-none">
                {ROOMS.map((room) => (
                  <li key={room.name}
                    className="relative aspect-[4/5] w-[260px] shrink-0 snap-start overflow-hidden rounded-[28px] md:w-[320px]">
                    <img src={room.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                    <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#000]/70 via-[#000]/10 to-transparent" />
                    {/* Literal white: the theme remaps text-white to ink in light mode */}
                    <p className="absolute inset-x-6 bottom-6 text-2xl leading-tight text-[#fff]">{room.name}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ── Principles ── */}
          <section data-ab-principles aria-labelledby="about-principles" className="mt-28 lg:mt-36">
            <h2 id="about-principles" className="max-w-2xl text-3xl leading-tight tracking-tight text-lv-ink md:text-5xl">
              Built to be trusted, not just admired
            </h2>
            <ul className="mt-10 grid gap-4 md:grid-cols-3">
              {PRINCIPLES.map(({ icon: Icon, title, desc }) => (
                <li key={title} data-ab-flap className="rounded-[28px] border border-lv-line bg-lv-surface p-7">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-lv-wash text-lv-ink">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-6 text-xl leading-tight text-lv-ink">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-lv-muted">{desc}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Team ── */}
          <section data-ab-team aria-labelledby="about-team" className="mt-24 text-center lg:mt-32">
            <h2 id="about-team" className="text-2xl leading-tight tracking-tight text-lv-ink md:text-3xl">The team behind roomscape</h2>
            <p className="mt-2 text-sm text-lv-muted md:text-base">Five of us built it, from reading the plan to the 3D room.</p>
            {/* Wraps into centred rows on smaller screens, one row of five from lg */}
            <ul className="mt-8 flex flex-wrap justify-center gap-3">
              {TEAM.map((m, i) => {
                const links = [
                  { href: m.email ? `mailto:${m.email}` : "", icon: Mail, label: `Email ${m.name}` },
                  { href: m.github, icon: Github, label: `${m.name} on GitHub` },
                  { href: m.linkedin, icon: Linkedin, label: `${m.name} on LinkedIn` },
                ].filter((l) => l.href);
                return (
                  <li key={i} data-ab-member
                    className="group flex w-[calc(50%-0.375rem)] flex-col items-center rounded-[24px] border border-lv-line bg-lv-surface px-4 pb-4 pt-5 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[var(--lv-shadow)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:w-[calc(33.333%-0.5rem)] lg:w-auto lg:flex-1">
                    <div data-ab-member-photo
                      className="h-20 w-20 overflow-hidden rounded-full bg-lv-wash ring-2 ring-transparent ring-offset-2 ring-offset-lv-surface transition-shadow duration-300 group-hover:ring-lv-accent">
                      {m.photo ? (
                        <img src={m.photo} alt={`Photo of ${m.name}`} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span aria-hidden="true" className="grid h-full w-full place-items-center text-xl font-medium tracking-tight text-lv-ink">
                          {initialsOf(m.name)}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-3 text-base leading-tight text-lv-ink">{m.name}</h3>
                    <p className="mt-0.5 text-xs text-lv-accent">{m.role}</p>
                    {links.length > 0 && (
                      <div className="mt-3 flex gap-1">
                        {links.map(({ href, icon: Icon, label }) => (
                          <a key={label} href={href} aria-label={label} title={label}
                            {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                            className="grid h-9 w-9 place-items-center rounded-full text-lv-muted transition-colors hover:bg-lv-ink/8 hover:text-lv-ink">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ── Closing ── */}
          <section data-ab-cta aria-labelledby="about-cta"
            className="relative mt-28 overflow-hidden rounded-[28px] bg-lv-deep text-lv-on-deep lg:mt-36">
            <img src="/dashboard/hero.jpg" alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-35" />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-lv-deep via-lv-deep/85 to-lv-deep/30" />
            <div className="relative flex flex-col gap-8 px-6 py-14 md:flex-row md:items-end md:justify-between md:px-14 md:py-20">
              <div>
                <h2 id="about-cta" className="max-w-xl text-3xl leading-[1.05] md:text-5xl">Try it with your own floor plan</h2>
                <p className="mt-4 text-base text-lv-on-deep/75">All it needs is a PNG or JPG and a couple of minutes.</p>
              </div>
              {createButton(true)}
            </div>
          </section>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
