import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import SiteNavbar from "../components/SiteNavbar";
import PageGlows from "../components/marketing/PageGlows";
import AppFooter from "../components/AppFooter";
import FlowStepper from "../components/FlowStepper";
import type { DetectionResult } from "../lib/wallDetector";

type RoomType = "Room";

interface DetectedRoom {
  id: string;
  name: string;
  type: RoomType;
  /** true when the name came from OCR of the printed label (not a fallback) */
  labelDetected: boolean;
  /** real-world size: from the plan's own printed areas when it has them,
   * otherwise from the scale the layout engines would assume (see planScale) */
  widthM: number;
  heightM: number;
  areaM2: number;
  areaSource: "ocr" | "estimated" | "door" | "default" | null;
  confidence: number;
  /** bbox as % of the floor-plan image, for overlays */
  bboxPct: { x: number; y: number; w: number; h: number };
  /** room outline as % of the floor-plan image: the shape traced from the
   * walls (an L room has 6 corners), or the bbox when none was traced */
  outlinePct: [number, number][];
  /** thumbnail polygon in a 0-100 box, preserving aspect ratio */
  shape: [number, number][];
}

/** The bbox's corners, for detections that have no traced outline. */
function boxCorners(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

/** Fit a pixel polygon into a padded 0-100 viewBox, keeping aspect ratio. */
function fitShape(points: [number, number][]): [number, number][] {
  const pad = 12;
  const span = 100 - pad * 2;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const wPx = Math.max(...xs) - minX;
  const hPx = Math.max(...ys) - minY;
  const scale = span / Math.max(wPx, hPx, 1);
  const offX = (100 - wPx * scale) / 2;
  const offY = (100 - hPx * scale) / 2;
  return points.map(([x, y]) => [offX + (x - minX) * scale, offY + (y - minY) * scale]);
}

// What the layout engines assume when a plan comes without a scale (backend */floorplan.py):
// a standard door leaf over the median detected door, or a flat default when there is no door.
const STANDARD_DOOR_WIDTH_MM = 900;
const DEFAULT_MM_PER_PX = 20;

/** Millimetres per pixel the layout engines would use for a plan with no printed areas. */
function planScale(detection: DetectionResult): { mmPerPx: number; source: "door" | "default" } {
  const spans = detection.detections
    .filter((d) => d.class === "Door")
    .map((d) => Math.max(d.bbox.x2 - d.bbox.x1, d.bbox.y2 - d.bbox.y1))
    .filter((span) => span > 0)
    .sort((a, b) => a - b);
  return spans.length > 0
    ? { mmPerPx: STANDARD_DOOR_WIDTH_MM / spans[Math.floor(spans.length / 2)], source: "door" }
    : { mmPerPx: DEFAULT_MM_PER_PX, source: "default" };
}

function roomsFromDetection(detection: DetectionResult): DetectedRoom[] {
  const scale = planScale(detection);
  const mPerPx = scale.mmPerPx / 1000;
  return detection.rooms.map((r) => {
    const printed = r.widthM != null && r.heightM != null && r.areaM2 != null;
    const { x1, y1, x2, y2 } = r.bbox;
    const { x, y, w, h } = r.bboxPct;
    return {
      id: r.id,
      name: r.name,
      type: "Room" as const,
      labelDetected: r.labelDetected,
      widthM: printed ? r.widthM! : r.widthPx * mPerPx,
      heightM: printed ? r.heightM! : r.heightPx * mPerPx,
      // areaPx is the traced outline's area, so an L room isn't sized as its full box
      areaM2: printed ? r.areaM2! : r.areaPx * mPerPx * mPerPx,
      areaSource: printed ? r.areaSource : scale.source,
      confidence: r.confidence,
      bboxPct: r.bboxPct,
      outlinePct: r.polygonPct ?? boxCorners(x, y, x + w, y + h),
      shape: fitShape(r.polygon ?? boxCorners(x1, y1, x2, y2)),
    };
  });
}

const SIZE_NOTES: Record<NonNullable<DetectedRoom["areaSource"]>, string> = {
  ocr: "from the plan's printed area",
  estimated: "estimated from the plan's scale",
  door: "estimated from the doors, taking a standard 900 mm door",
  default: "a rough estimate: the plan has no scale and no doors",
};

/** The room's size in metres, and where it came from. */
function formatSize(room: DetectedRoom): { dims: string; area: string; note: string | null } {
  return {
    dims: `${room.widthM.toFixed(2)} × ${room.heightM.toFixed(2)} m`,
    area: `${room.areaM2.toFixed(1)} m²`,
    note: room.areaSource ? SIZE_NOTES[room.areaSource] : null,
  };
}

/** One room in the list: outline thumbnail, name and size. */
function RoomRow({
  room,
  selected,
  onClick,
  rowRef,
}: {
  room: DetectedRoom;
  selected: boolean;
  onClick: () => void;
  rowRef: (el: HTMLButtonElement | null) => void;
}) {
  const size = formatSize(room);
  const points = room.shape.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <button ref={rowRef} type="button" onClick={onClick} aria-pressed={selected}
      className={`flex w-full cursor-pointer items-center gap-4 rounded-[20px] border p-3 text-left transition-colors ${
        selected ? "border-lv-accent bg-lv-wash/60 ring-1 ring-lv-accent/40" : "border-lv-line bg-lv-surface hover:border-lv-accent/50"
      }`}>
      <span className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl ${selected ? "bg-lv-wash text-lv-ink" : "bg-lv-wash/50 text-lv-muted"}`}>
        <svg viewBox="0 0 100 100" className="h-14 w-14" aria-hidden="true">
          <polygon points={points} fill="currentColor" fillOpacity={selected ? 0.16 : 0.06} stroke="currentColor"
            strokeWidth={selected ? 4.5 : 3} strokeLinejoin="round" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium leading-tight text-lv-ink">{room.name}</span>
        <span className="mt-1 block truncate text-sm text-lv-muted" title={size.note ?? undefined}>{size.dims}</span>
      </span>
      {selected && (
        <span className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lv-accent text-[#fff]">
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

export default function SelectRoom() {
  const navigate = useNavigate();
  const location = useLocation();
  const flowState = location.state as { detection?: DetectionResult; planImage?: string | null } | null;
  const detection = flowState?.detection;
  // The annotated image is not stored, so a design reopened from the dashboard
  // falls back to the plain uploaded plan; the room overlay lines up with either.
  const planImage = detection?.annotatedImage ?? flowState?.planImage ?? null;
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  // Reached without a detection payload (e.g. deep link / reload) — restart.
  useEffect(() => {
    if (!detection) navigate("/upload", { replace: true });
  }, [detection, navigate]);


  // Every detected room is listed. Rooms without a layout engine yet (a study, a
  // closet) can still be picked; View Layouts shows its placeholder for them.
  const rooms = useMemo(() => (detection ? roomsFromDetection(detection) : []), [detection]);
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (selectedRoomId) rowRefs.current[selectedRoomId]?.scrollIntoView({ block: "nearest" });
  }, [selectedRoomId]);
  const counts = detection?.counts ?? {};

  const handleContinue = () => {
    if (!detection || !selectedRoom) return;
    navigate("/view-layouts", {
      state: { floorPlanId: detection.floorPlanId, room: selectedRoom, detection },
    });
  };

  if (!detection) return null;

  const toggleRoom = (id: string) => setSelectedRoomId((prev) => (prev === id ? null : id));
  const selectedSize = selectedRoom ? formatSize(selectedRoom) : null;
  const planRatio = detection.imageWidth > 0 && detection.imageHeight > 0 ? detection.imageWidth / detection.imageHeight : 4 / 3;

  // The selected room and the next step. Name, facts and button are stacked so
  // the card is the same height whatever is selected. It is placed twice (inside
  // the plan card from lg up, as a sticky bar below that) and only one is shown,
  // so only one of them announces changes.
  const generateCard = (announce: boolean) => (
    <>
      <div aria-live={announce ? "polite" : undefined}>
        {selectedRoom && selectedSize ? (
          <>
            <p className="truncate text-lg font-medium leading-tight">{selectedRoom.name}</p>
            <ul className="mt-3 flex flex-nowrap gap-1.5 overflow-hidden" title={selectedSize.note ? `Size ${selectedSize.note}` : undefined}>
              {[selectedSize.dims, selectedSize.area, `${Math.round(selectedRoom.confidence * 100)}% confidence`].map((fact) => (
                <li key={fact} className="whitespace-nowrap rounded-full bg-lv-on-deep/15 px-3 py-1.5 text-xs font-medium tabular-nums text-lv-on-deep">
                  {fact}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="text-lg font-medium leading-tight">No room selected</p>
            <p className="mt-3 py-1.5 text-xs text-lv-on-deep/70">Choose a room to continue.</p>
          </>
        )}
      </div>
      <button type="button" onClick={handleContinue} disabled={!selectedRoomId} className="lv-btn-invert mt-4 w-full min-h-12">
        Generate layouts <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );

  // From lg up the page is exactly one viewport tall. Left: the heading and the
  // room buttons, which are the only part that scrolls. Right: one card holding
  // the plan, the counts and the Generate card; it never scrolls or changes size.
  return (
    <div className="min-h-screen w-full bg-background relative isolate flex flex-col lg:h-svh lg:min-h-0 lg:overflow-hidden">
      <PageGlows />
      <SiteNavbar />

      <main className="relative flex w-full flex-1 flex-col px-4 pb-6 pt-2 md:px-8 lg:min-h-0">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:min-h-0">
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-2xl shrink-0">
            <FlowStepper current="detect" />
          </motion.div>

          {rooms.length === 0 ? (
            <div className="mt-8 flex flex-col items-center rounded-[28px] border border-lv-line bg-lv-surface px-6 py-14 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-amber-500/10">
                <AlertCircle className="h-7 w-7 text-amber-400" aria-hidden="true" />
              </span>
              <h1 className="mt-6 text-2xl leading-tight text-lv-ink md:text-3xl">No rooms were found</h1>
              <p className="mt-3 max-w-sm text-base leading-relaxed text-lv-muted">
                We couldn't make out any rooms in this plan. Try a clearer image where the walls are fully drawn.
              </p>
              <button type="button" onClick={() => navigate("/upload")} className="lv-btn mt-7">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Upload another plan
              </button>
            </div>
          ) : (
            <div className="mt-5 grid flex-1 grid-cols-1 gap-x-6 gap-y-4 lg:min-h-0 lg:grid-cols-[1fr_1.25fr] lg:grid-rows-[auto_minmax(0,1fr)]">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="lg:col-start-1 lg:row-start-1">
                <h1 className="text-4xl md:text-5xl leading-[1.05] tracking-tight text-lv-ink">Pick a room</h1>
                <p className="mt-3 text-base md:text-lg text-lv-muted">
                  {rooms.length} {rooms.length === 1 ? "room" : "rooms"} found. Choose one from the list or on the plan.
                </p>
              </motion.div>

              {/* The plan, its counts and the next step, in one card that never scrolls */}
              <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
                aria-label="Floor plan"
                className="flex flex-col rounded-[28px] border border-lv-line bg-lv-surface p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:overflow-hidden">
                <div className="flex h-[46svh] items-center justify-center overflow-hidden rounded-2xl bg-white [container-type:size] lg:h-auto lg:min-h-0 lg:flex-1">
                  {planImage ? (
                    // Sized to the image's own proportions so the room overlays line up with it.
                    <div className="relative" style={{ aspectRatio: String(planRatio), width: `min(100cqw, calc(100cqh * ${planRatio}))` }}>
                      <img src={planImage} alt="Your floor plan" className="block h-full w-full" />
                      {/* Each room's own outline (an L room is an L), so neighbouring rooms don't
                          overlap. The viewBox is in % of the image and stretched to fit it. */}
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"
                        className="absolute inset-0 h-full w-full">
                        {rooms.map((room) => {
                          const isSelected = room.id === selectedRoomId;
                          return (
                            <polygon
                              key={room.id}
                              points={room.outlinePct.map(([x, y]) => `${x},${y}`).join(" ")}
                              onClick={() => toggleRoom(room.id)}
                              vectorEffect="non-scaling-stroke"
                              strokeWidth={2}
                              strokeLinejoin="round"
                              className={`cursor-pointer transition-colors duration-200 ${
                                isSelected
                                  ? "fill-[#6e6bc9]/30 stroke-[#6e6bc9]"
                                  : "fill-transparent stroke-transparent hover:fill-[#6e6bc9]/15 hover:stroke-[#6e6bc9]/70"
                              }`}
                            >
                              <title>{room.name}</title>
                            </polygon>
                          );
                        })}
                      </svg>
                    </div>
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-lv-wash text-sm text-lv-muted">No preview available</div>
                  )}
                </div>
                <dl className="mt-3 grid shrink-0 grid-cols-4 gap-2 text-center">
                  {(["Wall", "Room", "Door", "Window"] as const).map((k) => (
                    <div key={k} className="flex flex-col-reverse">
                      <dt className="text-xs text-lv-muted">{k}s</dt>
                      <dd className="text-lg font-medium leading-tight tabular-nums text-lv-ink">{counts[k] ?? 0}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 hidden shrink-0 rounded-[20px] bg-lv-deep p-5 text-lv-on-deep lg:block">
                  {generateCard(true)}
                </div>
              </motion.section>

              {/* Room buttons: the only part that scrolls when there are many */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                role="group" aria-label="Rooms"
                className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2 lg:col-start-1 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
                {rooms.map((room) => (
                  <RoomRow key={room.id} room={room} selected={room.id === selectedRoomId}
                    onClick={() => toggleRoom(room.id)}
                    rowRef={(el) => { rowRefs.current[room.id] = el; }} />
                ))}
              </motion.div>

              {/* Below lg the Generate card sticks to the bottom of the screen instead */}
              <div className="sticky bottom-3 z-10 rounded-[24px] bg-lv-deep p-5 text-lv-on-deep shadow-xl lg:hidden">
                {generateCard(false)}
              </div>
            </div>
          )}
        </div>
      </main>

      <div className="lg:hidden">
        <AppFooter />
      </div>
    </div>
  );
}
