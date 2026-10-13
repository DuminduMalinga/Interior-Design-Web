import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Home,
  Maximize2,
} from "lucide-react";
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

const ROOM_ICON: Record<RoomType, React.ElementType> = {
  Room: Home,
};

const ROOM_COLOR: Record<RoomType, { text: string; bg: string; border: string; fill: string; stroke: string }> = {
  Room: { text: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20", fill: "#134e4a", stroke: "#14b8a6" },
};

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

function RoomThumbnail({ shape, selected, roomType }: { shape: [number, number][]; selected: boolean; roomType: RoomType }) {
  const points = shape.map(([x, y]) => `${x},${y}`).join(" ");
  const c = ROOM_COLOR[roomType];
  return (
    <div className={`w-full rounded-lg overflow-hidden border text-white transition-all duration-300 ${selected ? c.border : "border-white/5"}`} style={{ height: 72 }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        {[20, 40, 60, 80].map((v) => (
          <g key={v}>
            <line x1={v} y1="0" x2={v} y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
            <line x1="0" y1={v} x2="100" y2={v} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          </g>
        ))}
        <polygon points={points} fill="none" stroke="currentColor" strokeWidth={selected ? 2.5 : 1.5} strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function RoomCard({ room, selected, onClick }: { room: DetectedRoom; selected: boolean; onClick: () => void }) {
  const Icon = ROOM_ICON[room.type];
  const c = ROOM_COLOR[room.type];
  const size = formatSize(room);

  return (
    <motion.div whileHover={{ y: -4, scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onClick}
      className={`relative cursor-pointer rounded-2xl p-4 border-2 transition-all duration-300 bg-white/[0.03] ${
        selected ? `${c.border} shadow-xl ring-1 ring-offset-0` : "border-white/10 hover:border-white/20 hover:bg-white/[0.05]"
      }`} style={selected ? { boxShadow: `0 0 20px ${c.stroke}25` } : {}}>
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
            className={`absolute -top-2.5 -right-2.5 ${c.bg} border ${c.border} rounded-full w-7 h-7 flex items-center justify-center shadow-lg z-10`}>
            <CheckCircle2 className={`w-4 h-4 ${c.text}`} />
          </motion.div>
        )}
      </AnimatePresence>
      <RoomThumbnail shape={room.shape} selected={selected} roomType={room.type} />
      <div className="mt-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-zinc-200 text-sm truncate">{room.name}</h3>
        <div className={`p-1.5 rounded-lg ${selected ? c.bg : "bg-white/5"}`}>
          <Icon className={`w-4 h-4 ${selected ? c.text : "text-zinc-500"}`} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2" title={size.note ?? undefined}>
        <div className="flex items-center gap-1 text-zinc-500 text-xs min-w-0">
          <Maximize2 className="w-3 h-3 shrink-0" />
          <span className="truncate">{size.dims}</span>
        </div>
        <span className={`text-xs font-medium shrink-0 ${selected ? c.text : "text-zinc-500"}`}>{size.area}</span>
      </div>
    </motion.div>
  );
}

export default function SelectRoom() {
  const navigate = useNavigate();
  const location = useLocation();
  const detection = (location.state as { detection?: DetectionResult } | null)
    ?.detection;
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

  return (
    <div className="min-h-screen w-full bg-background relative flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-teal-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Nav */}
      <SiteNavbar />

      <main className="relative flex-1 w-full px-4 md:px-8 py-4">
        <div className="max-w-6xl mx-auto">
          {/* Step Indicator */}
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
            <FlowStepper current="detect" />
          </motion.div>

          {rooms.length === 0 ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="glass-card rounded-3xl border border-amber-500/20 p-12 flex flex-col items-center gap-4 text-center">
              <div className="bg-amber-500/10 p-5 rounded-2xl border border-amber-500/20">
                <AlertCircle className="w-12 h-12 text-amber-400" />
              </div>
              <h3 className="text-xl font-bold text-white">No Rooms Detected</h3>
              <p className="text-zinc-500 max-w-sm">No rooms available. Please re-upload a valid floor plan so the AI can detect room structures.</p>
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                onClick={() => navigate("/upload")}
                className="mt-2 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl font-semibold shadow-md shadow-teal-500/20">
                <ArrowLeft className="w-4 h-4" /> Re-upload Floor Plan
              </motion.button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              {/* Room Cards */}
              <div className="lg:col-span-2">
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-3">
                  <h2 className="text-xl md:text-2xl font-bold text-white leading-tight">Select a Room</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">
                    {rooms.length} room{rooms.length !== 1 ? "s" : ""} found. Pick the one you want to furnish.
                  </p>
                </motion.div>
                <div className="glass-card rounded-3xl border border-white/5 p-4 md:p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {rooms.map((room, i) => (
                      <motion.div key={room.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                        <RoomCard room={room} selected={room.id === selectedRoomId}
                          onClick={() => setSelectedRoomId((prev) => (prev === room.id ? null : room.id))} />
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Side Panel: stays in view while the room list scrolls */}
              <div className="lg:col-span-1 lg:sticky lg:top-[73px] flex flex-col gap-3">
                {/* Floor Plan Preview */}
                <div className="glass-card rounded-2xl border border-white/5 p-4">
                  <h4 className="text-sm font-semibold text-zinc-400 mb-2.5 flex items-center gap-2">
                    <Home className="w-4 h-4 text-teal-400" /> Floor Plan Preview
                  </h4>
                  <div className="w-full rounded-xl overflow-hidden bg-white/[0.02] border border-white/5">
                    {detection.annotatedImage ? (
                      // Sized to the image itself so the selected-room overlay lines up with it.
                      <div className="relative w-fit mx-auto">
                        <img
                          src={detection.annotatedImage}
                          alt="Floor plan with detected walls, rooms, doors and windows"
                          className="block w-auto h-auto max-w-full max-h-[200px]"
                        />
                        {selectedRoom && (
                          <div
                            className="pointer-events-none absolute rounded-sm border-2 border-teal-300 bg-teal-400/20 transition-all duration-300"
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
                      <div className="flex items-center justify-center text-xs text-zinc-600" style={{ height: 160 }}>
                        No annotated preview available
                      </div>
                    )}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {(["Wall", "Room", "Door", "Window"] as const).map((k) => (
                      <span key={k} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                        {k}: {counts[k] ?? 0}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Selected Room Details + Continue */}
                <div className={`glass-card rounded-2xl border p-4 transition-colors ${selectedRoom ? ROOM_COLOR[selectedRoom.type].border : "border-white/5"}`}>
                  <AnimatePresence mode="wait">
                    {selectedRoom ? (
                      <motion.div key={selectedRoom.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}>
                        <div className="flex items-center gap-3 mb-3">
                          <div className={`${ROOM_COLOR[selectedRoom.type].bg} p-2 rounded-xl border ${ROOM_COLOR[selectedRoom.type].border}`}>
                            {(() => { const Icon = ROOM_ICON[selectedRoom.type]; return <Icon className={`w-5 h-5 ${ROOM_COLOR[selectedRoom.type].text}`} />; })()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-zinc-500 text-xs font-medium">Selected Room</p>
                            <h4 className={`font-bold text-base leading-tight truncate ${ROOM_COLOR[selectedRoom.type].text}`}>{selectedRoom.name}</h4>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { label: "Dimensions", value: formatSize(selectedRoom).dims },
                            { label: "Area", value: formatSize(selectedRoom).area },
                            { label: "Confidence", value: `${Math.round(selectedRoom.confidence * 100)}%` },
                            { label: "Name", value: selectedRoom.labelDetected ? "OCR label" : "Auto-named" },
                          ].map(({ label, value }) => (
                            <div key={label} className="bg-white/[0.03] rounded-lg px-3 py-1.5 border border-white/5 min-w-0">
                              <p className="text-[11px] text-zinc-500">{label}</p>
                              <p className="text-sm font-semibold text-zinc-200 truncate" title={value}>{value}</p>
                            </div>
                          ))}
                        </div>
                        {formatSize(selectedRoom).note && (
                          <p className="text-[11px] text-zinc-600 mt-2">Size {formatSize(selectedRoom).note}</p>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }} className="flex items-center gap-3">
                        <div className="bg-white/5 p-2.5 rounded-xl shrink-0">
                          <CheckCircle2 className="w-6 h-6 text-zinc-600" />
                        </div>
                        <div>
                          <p className="text-zinc-300 text-sm font-semibold">No room selected yet</p>
                          <p className="text-zinc-500 text-xs">Click a room card to see its details here.</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <motion.button whileHover={selectedRoomId ? { scale: 1.02 } : {}} whileTap={selectedRoomId ? { scale: 0.97 } : {}}
                    onClick={handleContinue} disabled={!selectedRoomId}
                    className={`w-full mt-3 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-300 ${
                      selectedRoomId
                        ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30"
                        : "bg-white/5 text-zinc-600 cursor-not-allowed border border-white/5"
                    }`}>
                    Continue to Layout Generation <ArrowRight className="w-4 h-4" />
                  </motion.button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
