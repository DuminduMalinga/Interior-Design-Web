import type { LayoutFurnitureItem, LivingRoomLayoutResult, Wall } from "../lib/livingRoomLayout";

// ─────────────────────────────────────────────
// Geometry helpers (mirrors living_room_layout/models/room.py exactly)
// ─────────────────────────────────────────────
type Vec = [number, number];
type RoomDims = { width: number; length: number };

const WALL_INWARD: Record<Wall, Vec> = {
  north: [0, -1],
  south: [0, 1],
  east: [-1, 0],
  west: [1, 0],
};
const WALL_ALONG: Record<Wall, Vec> = {
  south: [1, 0],
  north: [1, 0],
  west: [0, 1],
  east: [0, 1],
};

function wallPoint(wall: Wall, pos: number, room: RoomDims): Vec {
  switch (wall) {
    case "south":
      return [pos, 0];
    case "north":
      return [pos, room.length];
    case "west":
      return [0, pos];
    default:
      return [room.width, pos];
  }
}

function wallLength(wall: Wall, room: RoomDims): number {
  return wall === "north" || wall === "south" ? room.width : room.length;
}

/** The stretches of a wall NOT covered by any opening, in wall-parameter space. */
function solidSegments(length: number, openings: Array<{ start: number; end: number }>): Array<[number, number]> {
  const sorted = [...openings].sort((a, b) => a.start - b.start);
  const segments: Array<[number, number]> = [];
  let cursor = 0;
  for (const o of sorted) {
    if (o.start > cursor) segments.push([cursor, o.start]);
    cursor = Math.max(cursor, o.end);
  }
  if (cursor < length) segments.push([cursor, length]);
  return segments;
}

// ─────────────────────────────────────────────
// Shared furniture styling / formatting
// ─────────────────────────────────────────────
export const FURNITURE_COLORS: Record<string, { fill: string; stroke: string }> = {
  sofa: { fill: "#134e4a", stroke: "#2dd4bf" },
  loveseat: { fill: "#134e4a", stroke: "#2dd4bf" },
  l_sofa: { fill: "#134e4a", stroke: "#2dd4bf" },
  chair: { fill: "#1e3a5f", stroke: "#60a5fa" },
  reading_chair: { fill: "#1e3a5f", stroke: "#60a5fa" },
  desk_chair: { fill: "#1e3a5f", stroke: "#60a5fa" },
  coffee_table: { fill: "#5b3a12", stroke: "#fbbf24" },
  side_table: { fill: "#5b3a12", stroke: "#fbbf24" },
  tv: { fill: "#4c1d1d", stroke: "#f87171" },
  tv_console: { fill: "#4c1d1d", stroke: "#f87171" },
  bookshelf: { fill: "#312e6e", stroke: "#a78bfa" },
  storage_cabinet: { fill: "#312e6e", stroke: "#a78bfa" },
  desk: { fill: "#0d4a3d", stroke: "#34d399" },
  lamp: { fill: "#5a4008", stroke: "#fde047" },
  rug: { fill: "#4c0519", stroke: "#fb7185" },
};
export const DEFAULT_FURNITURE_COLOR = { fill: "#27272a", stroke: "#a1a1aa" };

function frontCenter(item: LayoutFurnitureItem): { c: Vec; dir: Vec } {
  const [x0, y0, x1, y1] = item.bbox;
  switch (item.facing) {
    case "north":
      return { c: [(x0 + x1) / 2, y1], dir: [0, 1] };
    case "south":
      return { c: [(x0 + x1) / 2, y0], dir: [0, -1] };
    case "east":
      return { c: [x1, (y0 + y1) / 2], dir: [1, 0] };
    default:
      return { c: [x0, (y0 + y1) / 2], dir: [-1, 0] };
  }
}

export function fmtMm(mm: number): string {
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)}m` : `${Math.round(mm)}mm`;
}

export const scoreTone = (score: number) =>
  score >= 100 ? "text-emerald-400" : score >= 40 ? "text-teal-400" : "text-amber-400";

// ─────────────────────────────────────────────
// The SVG plan — room shell, doors, windows, furniture
// ─────────────────────────────────────────────
const CANVAS_W = 1000; // virtual units — keeps stroke/text sizing independent of room mm size

export default function RoomSvg({
  layout,
  selectedId = null,
  onSelect,
  compact = false,
}: {
  layout: LivingRoomLayoutResult;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Thumbnail mode: no labels, no facing notches, not clickable. */
  compact?: boolean;
}) {
  const room = layout.room;
  const scale = CANVAS_W / room.width;
  const H = room.length * scale;

  const toScreen = ([x, y]: Vec): Vec => [x * scale, H - y * scale];

  const doors = layout.openings.doors;
  const windows = layout.openings.windows;

  const wallSegments = (["north", "south", "east", "west"] as Wall[]).map((wall) => {
    const length = wallLength(wall, room);
    const openings = [
      ...doors.filter((d) => d.wall === wall).map((d) => ({ start: d.position, end: d.position + d.width })),
      ...windows.filter((w) => w.wall === wall).map((w) => ({ start: w.position, end: w.position + w.width })),
    ];
    return { wall, segments: solidSegments(length, openings) };
  });

  return (
    <svg viewBox={`0 0 ${CANVAS_W} ${H}`} width="100%" height="100%" className="block">
      {/* floor */}
      <rect x={0} y={0} width={CANVAS_W} height={H} fill="#0f1720" rx={2} />

      {/* solid wall segments */}
      {wallSegments.map(({ wall, segments }) =>
        segments.map(([s, e], i) => {
          const p0 = toScreen(wallPoint(wall, s, room));
          const p1 = toScreen(wallPoint(wall, e, room));
          return (
            <line
              key={`${wall}-${i}`}
              x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]}
              stroke="#52525b" strokeWidth={compact ? 3 : 5} strokeLinecap="square"
              vectorEffect="non-scaling-stroke"
            />
          );
        }),
      )}

      {/* windows */}
      {windows.map((w) => {
        const p0 = toScreen(wallPoint(w.wall, w.position, room));
        const p1 = toScreen(wallPoint(w.wall, w.position + w.width, room));
        return (
          <line key={w.id} x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]}
            stroke="#38bdf8" strokeWidth={compact ? 3 : 4} strokeLinecap="butt"
            vectorEffect="non-scaling-stroke">
            {!compact && <title>{`Window ${w.id} — ${fmtMm(w.width)} wide, sill ${fmtMm(w.sill_height)}`}</title>}
          </line>
        );
      })}

      {/* doors: opening gap (implicit) + swing */}
      {doors.map((d) => {
        const hingeAtStart = d.hinge === "left";
        const hingePos = hingeAtStart ? d.position : d.position + d.width;
        const hingeMM: Vec = wallPoint(d.wall, hingePos, room);
        const along = WALL_ALONG[d.wall];
        const closedDir: Vec = hingeAtStart ? along : [-along[0], -along[1]];
        const inward = WALL_INWARD[d.wall];
        const p0 = toScreen(hingeMM);

        if (d.swing === "inward") {
          const p1 = toScreen([hingeMM[0] + closedDir[0] * d.width, hingeMM[1] + closedDir[1] * d.width]);
          const p2 = toScreen([hingeMM[0] + inward[0] * d.width, hingeMM[1] + inward[1] * d.width]);
          const r = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
          const sweep = cross > 0 ? 1 : 0;
          const path = `M ${p0[0]} ${p0[1]} L ${p1[0]} ${p1[1]} A ${r} ${r} 0 0 ${sweep} ${p2[0]} ${p2[1]} Z`;
          return (
            <g key={d.id}>
              {!compact && (
                <path d={path} fill="#14b8a6" fillOpacity={0.08} stroke="#2dd4bf" strokeOpacity={0.5}
                  strokeDasharray="4 3" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              )}
              <line x1={p0[0]} y1={p0[1]} x2={p2[0]} y2={p2[1]} stroke="#2dd4bf" strokeWidth={compact ? 1.5 : 2}
                vectorEffect="non-scaling-stroke" />
              {d.is_main && <circle cx={p0[0]} cy={p0[1]} r={compact ? 2.5 : 4} fill="#facc15" />}
              {!compact && (
                <title>{`Door ${d.id} (${d.is_main ? "main entrance" : "interior"}) — ${fmtMm(d.width)} wide, swings inward`}</title>
              )}
            </g>
          );
        }
        const p1 = toScreen([hingeMM[0] + closedDir[0] * d.width, hingeMM[1] + closedDir[1] * d.width]);
        return (
          <g key={d.id}>
            <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke="#5eead4" strokeWidth={compact ? 1.5 : 2}
              strokeDasharray={d.swing === "sliding" ? "6 3" : undefined}
              vectorEffect="non-scaling-stroke" />
            {d.is_main && <circle cx={p0[0]} cy={p0[1]} r={compact ? 2.5 : 4} fill="#facc15" />}
            {!compact && (
              <title>{`Door ${d.id} (${d.is_main ? "main entrance" : "interior"}) — ${fmtMm(d.width)} wide, ${d.swing}`}</title>
            )}
          </g>
        );
      })}

      {/* furniture */}
      {layout.furniture.map((item) => {
        const color = FURNITURE_COLORS[item.type] ?? DEFAULT_FURNITURE_COLOR;
        const isRug = item.type === "rug";
        const selected = item.id === selectedId;
        const parts = item.shape === "l" && item.parts ? item.parts : [item.bbox];

        const { c: fc, dir: fdir } = frontCenter(item);
        const notchLen = Math.min(room.width, room.length) * 0.05;
        const fp0 = toScreen(fc);
        const fp1 = toScreen([fc[0] + fdir[0] * notchLen, fc[1] + fdir[1] * notchLen]);

        return (
          <g
            key={item.id}
            onClick={onSelect ? () => onSelect(selected ? null : item.id) : undefined}
            style={onSelect ? { cursor: "pointer" } : undefined}
            opacity={isRug ? 0.7 : 1}
          >
            {parts.map((part, i) => {
              const [x0, y0, x1, y1] = part;
              const topLeft = toScreen([x0, y1]);
              const w = (x1 - x0) * scale;
              const h = (y1 - y0) * scale;
              return (
                <rect
                  key={i}
                  x={topLeft[0]} y={topLeft[1]} width={w} height={h}
                  fill={color.fill} fillOpacity={selected ? 0.95 : 0.75}
                  stroke={selected ? "#ffffff" : color.stroke}
                  strokeWidth={selected ? 2.5 : compact ? 1 : 1.5}
                  vectorEffect="non-scaling-stroke"
                  rx={2}
                />
              );
            })}
            {!isRug && !compact && (
              <line x1={fp0[0]} y1={fp0[1]} x2={fp1[0]} y2={fp1[1]}
                stroke={selected ? "#ffffff" : color.stroke} strokeWidth={2.5}
                vectorEffect="non-scaling-stroke" />
            )}
            {!isRug && !compact && (
              <text
                x={toScreen([(item.bbox[0] + item.bbox[2]) / 2, (item.bbox[1] + item.bbox[3]) / 2])[0]}
                y={toScreen([(item.bbox[0] + item.bbox[2]) / 2, (item.bbox[1] + item.bbox[3]) / 2])[1]}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={13} fill="#f4f4f5" fontFamily="Inter, sans-serif" fontWeight={600}
                style={{ pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
              >
                {(item.role || item.type).replace(/_/g, " ")}
              </text>
            )}
            {!compact && (
              <title>{`${(item.role || item.type).replace(/_/g, " ")} — ${fmtMm(item.width)} × ${fmtMm(item.depth)}, facing ${item.facing}`}</title>
            )}
          </g>
        );
      })}
    </svg>
  );
}
