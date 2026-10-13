/**
 * A small floor plan with the detected rooms outlined and labelled.
 * The data-plan-* attributes are animation hooks for useLandingMotion.
 */
export default function PlanSketch({ className = "" }: { className?: string }) {
  const rooms = [
    { x: 14, y: 14, w: 112, h: 102, label: "Bedroom" },
    { x: 134, y: 14, w: 172, h: 102, label: "Living room" },
    { x: 14, y: 124, w: 182, h: 62, label: "Kitchen" },
    { x: 204, y: 124, w: 102, h: 62, label: "Bathroom" },
  ];

  return (
    <svg
      data-plan
      viewBox="0 0 320 200"
      role="img"
      aria-label="Floor plan with four rooms detected: bedroom, living room, kitchen and bathroom"
      className={className}
      fill="none"
    >
      {rooms.map((r) => (
        <g key={r.label} data-plan-room>
          <rect
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx="4"
            fill="var(--lv-accent)"
            fillOpacity="0.14"
            stroke="var(--lv-accent)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <text
            x={r.x + 10}
            y={r.y + 20}
            fill="var(--lv-ink)"
            fontSize="11"
            fontWeight="500"
          >
            {r.label}
          </text>
        </g>
      ))}

      {/* Walls, with gaps left for doors */}
      <g stroke="var(--lv-ink)" strokeWidth="3" strokeLinecap="round">
        <rect data-plan-wall pathLength={1} x="10" y="10" width="300" height="180" rx="3" />
        <path data-plan-wall pathLength={1} d="M130 10v60M130 96v24" />
        <path data-plan-wall pathLength={1} d="M10 120h70M106 120h130M262 120h48" />
        <path data-plan-wall pathLength={1} d="M200 120v22M200 168v22" />
      </g>

      {/* Door swings */}
      <g data-plan-door stroke="var(--lv-ink)" strokeWidth="1" strokeOpacity="0.55">
        <path d="M130 70a26 26 0 0 1 26 26" />
        <path d="M80 120a26 26 0 0 0 26 26" />
        <path d="M236 120a26 26 0 0 1 26-26" />
        <path d="M200 142a26 26 0 0 0-26 26" />
      </g>
    </svg>
  );
}
