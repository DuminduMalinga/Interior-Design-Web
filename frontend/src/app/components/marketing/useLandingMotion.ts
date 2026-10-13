import { useLayoutEffect, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

gsap.registerPlugin(ScrollTrigger);

// The hero arch at rest and fully open. ARCH_CLIP must match .lv-hero-stage in marketing.css.
const ARCH_CLIP = "inset(15% 11% 13% 57% round 16vw 16vw 1.5vw 1.5vw)";
const FULL_CLIP = "inset(0% 0% 0% 0% round 0vw 0vw 0vw 0vw)";

/**
 * Smooth scrolling (Lenis) and the scroll/entrance animations (GSAP) for the
 * landing page. Elements opt in through data attributes:
 *
 *   data-hero-*      hero entrance timeline, and the pinned arch opening on scroll
 *   data-reveal      fade up when scrolled into view
 *   data-stagger     fade up each direct child in turn
 *   data-words       light up child [data-word] spans as the block scrolls past
 *   data-count       count up from zero to the element's number
 *   data-plan        draw a PlanSketch: walls first, then rooms
 *   data-bar         grow a bar from the left
 *   data-steps-line  fill a progress line across the steps
 *
 * Nothing runs for visitors who prefer reduced motion; the page is then static.
 */
export function useLandingMotion(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;

    const all = <T extends Element = HTMLElement>(selector: string) => gsap.utils.toArray<T>(selector, el);
    const mm = gsap.matchMedia(el);

    // Re-runs when the breakpoint changes, since the hero is only pinned from lg up.
    mm.add({ motion: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 1024px)" }, (context) => {
      const { motion, desktop } = context.conditions as { motion: boolean; desktop: boolean };
      if (!motion) return;

      const lenis = new Lenis({ anchors: true });
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      // Hero entrance: the image wipes up into the arch, then the copy follows
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .fromTo(
          "[data-hero-wipe]",
          { clipPath: "inset(100% 0% 0% 0%)" },
          { clipPath: "inset(0% 0% 0% 0%)", duration: 1.5, ease: "power4.inOut" },
          0,
        )
        .from("[data-hero-img]", { scale: 1.25, duration: 2.4, ease: "power2.out" }, 0)
        .from("[data-hero-word]", { yPercent: 115, duration: 1, stagger: 0.08, ease: "power4.out" }, 0.25)
        .from("[data-hero-fade]", { y: 20, autoAlpha: 0, duration: 0.8, stagger: 0.12 }, 0.8)
        .from("[data-hero-chip]", { y: 36, autoAlpha: 0, scale: 0.9, duration: 0.9, stagger: 0.15, ease: "back.out(1.5)" }, 1.2);

      gsap.to("[data-float]", {
        y: -10,
        duration: 3,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        stagger: { each: 0.8, from: "end" },
      });

      // Hero on scroll
      if (desktop) {
        // The section pins while the arch opens to the full viewport, the copy
        // clears, and the chips settle into the bottom corners.
        const hero = el.querySelector<HTMLElement>("[data-hero]");
        const plan = el.querySelector<HTMLElement>('[data-hero-chip-move="plan"]');
        const score = el.querySelector<HTMLElement>('[data-hero-chip-move="score"]');
        if (hero && plan && score) {
          const edge = 28;
          gsap
            .timeline({
              defaults: { ease: "none" },
              scrollTrigger: {
                trigger: hero,
                start: "top top",
                end: "+=90%",
                pin: true,
                scrub: 0.6,
                anticipatePin: 1,
                invalidateOnRefresh: true,
              },
            })
            .fromTo("[data-hero-stage]", { clipPath: ARCH_CLIP }, { clipPath: FULL_CLIP, duration: 1 }, 0)
            // Zoomed toward the armchair at rest so the arch frames furniture, not sky
            .fromTo(
              "[data-hero-shift]",
              { scale: 1.4, transformOrigin: "100% 100%" },
              { scale: 1, transformOrigin: "100% 100%", duration: 1 },
              0,
            )
            .to("[data-hero-copy]", { x: -80, autoAlpha: 0, duration: 0.45 }, 0)
            .to(
              plan,
              {
                x: () => edge - plan.offsetLeft,
                y: () => hero.offsetHeight - edge - plan.offsetHeight - plan.offsetTop,
                duration: 1,
              },
              0,
            )
            .to(
              score,
              {
                x: () => hero.offsetWidth - edge - score.offsetWidth - score.offsetLeft,
                y: () => hero.offsetHeight - edge - score.offsetHeight - score.offsetTop,
                duration: 1,
              },
              0,
            );
        }
      } else {
        gsap.fromTo(
          "[data-hero-shift]",
          { scale: 1.12, yPercent: -4 },
          {
            yPercent: 4,
            ease: "none",
            scrollTrigger: { trigger: "[data-hero-stage]", start: "top bottom", end: "bottom top", scrub: true },
          },
        );
      }

      // Section reveals
      all("[data-reveal]").forEach((node) => {
        gsap.from(node, {
          y: 44,
          autoAlpha: 0,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: { trigger: node, start: "top 86%", once: true },
        });
      });

      all("[data-stagger]").forEach((group) => {
        gsap.from(group.children, {
          y: 56,
          autoAlpha: 0,
          duration: 1,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: { trigger: group, start: "top 84%", once: true },
        });
      });

      all("[data-words]").forEach((block) => {
        gsap.fromTo(
          block.querySelectorAll("[data-word]"),
          { opacity: 0.18 },
          {
            opacity: 1,
            ease: "none",
            stagger: 0.1,
            scrollTrigger: { trigger: block, start: "top 82%", end: "bottom 55%", scrub: true },
          },
        );
      });

      all("[data-count]").forEach((node) => {
        const target = Number(node.dataset.count);
        const counter = { value: 0 };
        gsap.to(counter, {
          value: target,
          duration: 1.6,
          ease: "power2.out",
          scrollTrigger: { trigger: node, start: "top 90%", once: true },
          onUpdate: () => {
            node.textContent = String(Math.round(counter.value));
          },
        });
      });

      all<SVGSVGElement>("[data-plan]").forEach((svg) => {
        gsap
          .timeline({ scrollTrigger: { trigger: svg, start: "top 86%", once: true } })
          .fromTo(
            svg.querySelectorAll("[data-plan-wall]"),
            { strokeDasharray: 1, strokeDashoffset: 1 },
            { strokeDashoffset: 0, duration: 1.3, stagger: 0.12, ease: "power2.inOut" },
          )
          .from(svg.querySelectorAll("[data-plan-door]"), { autoAlpha: 0, duration: 0.4 }, "-=0.3")
          .from(
            svg.querySelectorAll("[data-plan-room]"),
            { autoAlpha: 0, scale: 0.94, transformOrigin: "50% 50%", duration: 0.5, stagger: 0.14, ease: "power2.out" },
            "-=0.2",
          );
      });

      all("[data-bars]").forEach((group) => {
        gsap.from(group.querySelectorAll("[data-bar]"), {
          scaleX: 0,
          transformOrigin: "left center",
          duration: 1.1,
          stagger: 0.14,
          ease: "power3.out",
          scrollTrigger: { trigger: group, start: "top 88%", once: true },
        });
      });

      all("[data-steps-line]").forEach((line) => {
        gsap.fromTo(
          line,
          { scaleX: 0 },
          {
            scaleX: 1,
            ease: "none",
            scrollTrigger: { trigger: line, start: "top 85%", end: "top 45%", scrub: true },
          },
        );
      });

      return () => {
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    });

    return () => mm.revert();
  }, [root]);
}
