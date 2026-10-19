/**
 * Soft purple glows spread down the full height of a long page. They sit in
 * the page flow (not fixed), so they scroll with the content, and each one
 * drifts on its own loop. Styles live in marketing.css (.lv-glows, .lv-glow).
 */
const GLOWS = [
  { top: "1%", side: { left: "-12%" }, size: "58vw", tone: 1, anim: "A", duration: 17, delay: 0 },
  { top: "13%", side: { right: "-14%" }, size: "52vw", tone: 2, anim: "B", duration: 21, delay: -6 },
  { top: "31%", side: { left: "18%" }, size: "50vw", tone: 3, anim: "C", duration: 19, delay: -3 },
  { top: "49%", side: { right: "-10%" }, size: "58vw", tone: 1, anim: "A", duration: 23, delay: -11 },
  { top: "67%", side: { left: "-14%" }, size: "54vw", tone: 2, anim: "B", duration: 18, delay: -8 },
  { top: "85%", side: { right: "8%" }, size: "52vw", tone: 3, anim: "C", duration: 22, delay: -2 },
] as const;

export default function PageGlows() {
  return (
    <div className="lv-glows" aria-hidden="true">
      {GLOWS.map((g, i) => (
        <span
          key={i}
          className="lv-glow"
          data-tone={g.tone}
          data-anim={g.anim}
          style={{
            top: g.top,
            ...g.side,
            width: g.size,
            height: g.size,
            animationDuration: `${g.duration}s`,
            animationDelay: `${g.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
