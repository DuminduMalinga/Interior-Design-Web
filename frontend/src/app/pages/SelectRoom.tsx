import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import SiteNavbar from "../components/SiteNavbar";
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
  /** width / height in source-image pixels */
  width: number;
  height: number;
  /** real-world size when a scale could be recovered from the plan's own
   * printed areas — null when nothing on the whole plan gave a usable scale */
  widthM: number | null;
  heightM: number | null;
  areaM2: number | null;
  areaSource: "ocr" | "estimated" | null;
  confidence: number;
  /** bbox as % of the floor-plan image, for overlays */
  bboxPct: { x: number; y: number; w: number; h: number };
  /** thumbnail polygon in a 0-100 box, preserving aspect ratio */
  shape: [number, number][];
}

/** Fit a w×h rectangle into a padded 0-100 viewBox, keeping aspect ratio. */
function rectShape(wPx: number, hPx: number): [number, number][] {
  const pad = 12;
  const span = 100 - pad * 2;
  const scale = span / Math.max(wPx, hPx, 1);
  const w = Math.max(wPx * scale, 6);
  const h = Math.max(hPx * scale, 6);
  const x = (100 - w) / 2;
  const y = (100 - h) / 2;
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function roomsFromDetection(detection: DetectionResult): DetectedRoom[] {
  return detection.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    type: "Room" as const,
    labelDetected: r.labelDetected,
    width: Math.round(r.widthPx),
    height: Math.round(r.heightPx),
    widthM: r.widthM,
    heightM: r.heightM,
    areaM2: r.areaM2,
    areaSource: r.areaSource,
    confidence: r.confidence,
    bboxPct: r.bboxPct,
    shape: rectShape(r.widthPx, r.heightPx),
  }));
}

const areaPx = (w: number, h: number) => w * h;

/** Real-world size when the plan's scale is known, otherwise pixels. */
function formatSize(room: DetectedRoom): { dims: string; area: string; note: string | null } {
  if (room.widthM != null && room.heightM != null && room.areaM2 != null) {
    return {
      dims: `${room.widthM.toFixed(2)} × ${room.heightM.toFixed(2)} m`,
      area: `${room.areaM2.toFixed(1)} m²`,
      note: room.areaSource === "ocr" ? "from the plan's printed area" : "estimated from the plan's scale",
    };
  }
  return {
    dims: `${room.width} × ${room.height} px`,
    area: `${areaPx(room.width, room.height).toLocaleString()} px²`,
    note: null,
  };
}

function RoomThumbnail({ shape, selected }: { shape: [number, number][]; selected: boolean }) {
  const points = shape.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <div className={`h-24 w-full rounded-2xl transition-colors ${selected ? "bg-lv-wash text-lv-ink" : "bg-lv-wash/50 text-lv-muted"}`}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <polygon points={points} fill="currentColor" fillOpacity={selected ? 0.14 : 0.06} stroke="currentColor"
          strokeWidth={selected ? 2.5 : 1.5} strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function RoomCard({ room, selected, onClick }: { room: DetectedRoom; selected: boolean; onClick: () => void }) {
  const size = formatSize(room);

  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={`relative w-full cursor-pointer rounded-[24px] border bg-lv-surface p-3 text-left transition-colors ${
        selected ? "border-lv-accent ring-2 ring-lv-accent/40" : "border-lv-line hover:border-lv-accent/50"
      }`}>
      {selected && (
        <span className="absolute right-5 top-5 grid h-6 w-6 place-items-center rounded-full bg-lv-accent text-white">
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
        </span>
      )}
      <RoomThumbnail shape={room.shape} selected={selected} />
      <div className="px-2 pb-1.5 pt-3">
        <h3 className="truncate text-base font-medium text-lv-ink">{room.name}</h3>
        <p className="mt-0.5 flex items-center justify-between gap-2 text-xs text-lv-muted" title={size.note ?? undefined}>
          <span className="truncate">{size.dims}</span>
          <span className="shrink-0 tabular-nums">{size.area}</span>
        </p>
      </div>
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


  const rooms = useMemo(
    () => (detection ? roomsFromDetection(detection) : []),
    [detection],
  );
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;
  const counts = detection?.counts ?? {};

  const handleContinue = () => {
    if (!detection || !selectedRoom) return;
    navigate("/view-layouts", {
      state: { floorPlanId: detection.floorPlanId, room: selectedRoom, detection },
    });
  };

  if (!detection) return null;

  const details = selectedRoom
    ? [
        { label: "Dimensions", value: formatSize(selectedRoom).dims },
        { label: "Area", value: formatSize(selectedRoom).area },
        { label: "Confidence", value: `${Math.round(selectedRoom.confidence * 100)}%` },
        { label: "Name", value: selectedRoom.labelDetected ? "Read from plan" : "Auto-named" },
      ]
    : [];

  return (
    <div className="min-h-screen w-full bg-background relative flex flex-col">
      <SiteNavbar />

      <main className="relative flex-1 w-full px-4 md:px-8 pt-2 pb-12">
        <div className="max-w-6xl mx-auto">
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
            <FlowStepper current="detect" />
          </motion.div>

          {rooms.length === 0 ? (
            <div className="mt-10 flex flex-col items-center rounded-[28px] border border-lv-line bg-lv-surface px-6 py-14 text-center">
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
            <>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mt-10 md:mt-12">
                <h1 className="text-4xl md:text-5xl leading-[1.05] tracking-tight text-lv-ink">Pick a room</h1>
                <p className="mt-3 text-base md:text-lg text-lv-muted">
                  {rooms.length} {rooms.length === 1 ? "room" : "rooms"} found. Choose the one you want to furnish.
                </p>
              </motion.div>

              <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-start">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {rooms.map((room, i) => (
                    <motion.div key={room.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.05 }}>
                      <RoomCard room={room} selected={room.id === selectedRoomId}
                        onClick={() => setSelectedRoomId((prev) => (prev === room.id ? null : room.id))} />
                    </motion.div>
                  ))}
                </div>

                {/* Side panel: stays in view while the room list scrolls */}
                <div className="flex flex-col gap-4 lg:sticky lg:top-20">
                  <div className="rounded-[24px] border border-lv-line bg-lv-surface p-4">
                    <div className="overflow-hidden rounded-2xl bg-white">
                      {planImage ? (
                        // Sized to the image itself so the selected-room overlay lines up with it.
                        <div className="relative mx-auto w-fit">
                          <img
                            src={planImage}
                            alt="Your floor plan"
                            className="block h-auto max-h-[240px] w-auto max-w-full"
                          />
                          {selectedRoom && (
                            <div
                              className="pointer-events-none absolute rounded-sm border-2 border-[#6e6bc9] bg-[#6e6bc9]/25 transition-all duration-300"
                              style={{
                                left: `${selectedRoom.bboxPct.x}%`,
                                top: `${selectedRoom.bboxPct.y}%`,
                                width: `${selectedRoom.bboxPct.w}%`,
                                height: `${selectedRoom.bboxPct.h}%`,
                              }}
                            />
                          )}
                        </div>
                      ) : (
                        <div className="grid h-40 place-items-center bg-lv-wash text-sm text-lv-muted">No preview available</div>
                      )}
                    </div>
                    <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
                      {(["Wall", "Room", "Door", "Window"] as const).map((k) => (
                        <div key={k} className="flex flex-col-reverse">
                          <dt className="text-xs text-lv-muted">{k}s</dt>
                          <dd className="text-lg font-medium tabular-nums text-lv-ink">{counts[k] ?? 0}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <div className="rounded-[24px] bg-lv-deep p-6 text-lv-on-deep">
                    <AnimatePresence mode="wait">
                      {selectedRoom ? (
                        <motion.div key={selectedRoom.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}>
                          <p className="text-xs text-lv-on-deep/70">Selected room</p>
                          <h2 className="mt-1 truncate text-2xl leading-tight">{selectedRoom.name}</h2>
                          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
                            {details.map(({ label, value }) => (
                              <div key={label} className="min-w-0">
                                <dt className="text-xs text-lv-on-deep/70">{label}</dt>
                                <dd className="mt-0.5 truncate text-sm font-medium" title={value}>{value}</dd>
                              </div>
                            ))}
                          </dl>
                          {formatSize(selectedRoom).note && (
                            <p className="mt-4 text-xs text-lv-on-deep/60">Size {formatSize(selectedRoom).note}.</p>
                          )}
                        </motion.div>
                      ) : (
                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                          <h2 className="text-xl leading-tight">No room selected</h2>
                          <p className="mt-2 text-sm leading-relaxed text-lv-on-deep/70">Choose a room to see its size and continue.</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <button type="button" onClick={handleContinue} disabled={!selectedRoomId} className="lv-btn-invert mt-6 w-full min-h-12">
                      Generate layouts <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
