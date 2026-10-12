import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  RefreshCw,
  Save,
  Download,
  Maximize2,
  Minimize2,
  Layers,
  Grid3X3,
  Info,
  X,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Cpu,
  ArrowLeft,
  ArrowRight,
  Upload,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import AppNavbar from "../components/AppNavbar";
import RoomSvg, { fmtMm } from "../components/RoomSvg";
import type { RoomScene3DHandle, SceneQuality } from "../components/RoomScene3D";
import { useTheme } from "../context/ThemeContext";
import type { DetectionResult } from "../lib/wallDetector";
import type { LayoutFurnitureItem, LivingRoomLayoutResult } from "../lib/livingRoomLayout";
import { furnitureColor } from "../lib/roomPalette3d";
import { saveSelectedLivingRoomLayout } from "../lib/floorPlanAnalysis";

// three.js is only needed on this page, so it is loaded with the 3D view itself
const RoomScene3D = lazy(() => import("../components/RoomScene3D"));

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type ViewMode = "3D" | "2D";

/** What View Layouts hands over when a layout is confirmed. */
interface RoomViewState {
  floorPlanId?: string;
  room?: { id: string; name: string };
  detection?: DetectionResult;
  /** The selected layout, from whichever room engine produced it. */
  livingRoomLayout?: LivingRoomLayoutResult;
}

// ─────────────────────────────────────────────
// Step Indicator
// ─────────────────────────────────────────────
const STEPS = [
  { label: "Upload", step: 1 },
  { label: "Detect", step: 2 },
  { label: "Select Room", step: 3 },
  { label: "Layouts", step: 4 },
  { label: "Confirm", step: 5 },
  { label: "3D View", step: 6 },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap select-none">
      {STEPS.map((s, i) => {
        const isDone = s.step < current;
        const isActive = s.step === current;
        return (
          <div key={s.step} className="flex items-center gap-1.5">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                isDone || isActive
                  ? "bg-gradient-to-br from-teal-400 to-teal-600 text-white"
                  : "bg-white/5 text-zinc-600 border border-white/10"
              }`}
            >
              {isDone ? <Check className="w-3 h-3" /> : s.step}
            </div>
            <span
              className={`text-xs font-medium whitespace-nowrap ${
                isActive ? "text-teal-400" : isDone ? "text-teal-500" : "text-zinc-600"
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <ArrowRight className="w-3 h-3 text-zinc-700" />}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function itemLabel(item: LayoutFurnitureItem): string {
  const text = (item.label || item.role || item.type).replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function download(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  download(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─────────────────────────────────────────────
// Export Dropdown
// ─────────────────────────────────────────────
type ExportKind = "png" | "glb" | "json";

const EXPORT_OPTIONS: Array<{ kind: ExportKind; icon: string; label: string; sub: string }> = [
  { kind: "png", icon: "🖼️", label: "Download as PNG", sub: "The current 3D view" },
  { kind: "glb", icon: "📦", label: "Export 3D Model", sub: "GLB, real size in metres" },
  { kind: "json", icon: "📄", label: "Export Layout Data", sub: "JSON with every position" },
];

function ExportDropdown({ onExport }: { onExport: (kind: ExportKind) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const handleExport = async (kind: ExportKind, label: string) => {
    setOpen(false);
    try {
      await onExport(kind);
      setMessage({ text: `${label} — done`, ok: true });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Export failed.", ok: false });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  return (
    <div className="relative" ref={ref}>
      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 rounded-xl text-sm font-semibold transition-all"
      >
        <Download className="w-4 h-4" />
        Export
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            className="absolute right-0 bottom-12 z-50 w-56 bg-popover border border-white/10 rounded-2xl shadow-xl overflow-hidden"
          >
            {EXPORT_OPTIONS.map((opt) => (
              <button
                key={opt.kind}
                onClick={() => handleExport(opt.kind, opt.label)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-teal-500/10 text-left transition-colors"
              >
                <span className="text-lg">{opt.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-zinc-200">{opt.label}</p>
                  <p className="text-[11px] text-zinc-500">{opt.sub}</p>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={`absolute right-0 -top-10 z-50 flex items-center gap-2 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-lg whitespace-nowrap ${
              message.ok ? "bg-green-600" : "bg-red-600"
            }`}
          >
            {message.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {message.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────
// Loading overlay (while the 3D view's code is fetched)
// ─────────────────────────────────────────────
function SceneLoading() {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background">
      <div className="relative w-20 h-20">
        <motion.div
          animate={{ rotateY: 360, rotateX: 20 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          style={{ transformStyle: "preserve-3d" }}
          className="w-16 h-16 mx-auto mt-2"
        >
          <div className="w-16 h-16 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl shadow-lg flex items-center justify-center">
            <Box className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
        </motion.div>
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 rounded-full border-2 border-teal-400 border-dashed opacity-50"
        />
      </div>
      <div className="text-center">
        <p className="font-bold text-base text-white">Building the 3D room…</p>
        <p className="text-sm mt-1 text-zinc-400">Walls, openings and furniture at real size</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────
export default function RoomView3D() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as RoomViewState | null;
  const layout = navState?.livingRoomLayout ?? null;
  const roomName = navState?.room?.name ?? "Room";

  const { theme } = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>("3D");
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [quality, setQuality] = useState<SceneQuality>("High");
  const [fps, setFps] = useState<number | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const sceneRef = useRef<RoomScene3DHandle>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedItem = useMemo(
    () => layout?.furniture.find((f) => f.id === selectedId) ?? null,
    [layout, selectedId],
  );

  const fileStem = `${roomName}-${layout?.layout.type ?? "layout"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const handleExport = async (kind: ExportKind) => {
    if (!layout) throw new Error("There is no layout to export.");
    if (kind === "json") {
      downloadBlob(new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" }), `${fileStem}.json`);
      return;
    }
    const scene = sceneRef.current;
    if (!scene || viewMode !== "3D") throw new Error("Switch to the 3D view first.");
    if (kind === "png") {
      const url = scene.toPNG();
      if (!url) throw new Error("The 3D view is not ready yet.");
      download(url, `${fileStem}.png`);
    } else {
      downloadBlob(await scene.exportGLB(), `${fileStem}.glb`);
    }
  };

  const handleSave = async () => {
    if (!layout || saving) return;
    if (!navState?.floorPlanId || !navState.room) {
      setSaveMsg({ text: "This layout is not linked to an uploaded floor plan.", ok: false });
    } else {
      setSaving(true);
      try {
        await saveSelectedLivingRoomLayout(navState.floorPlanId, navState.room.id, layout);
        setSaveMsg({ text: "Design saved successfully!", ok: true });
      } catch (err) {
        setSaveMsg({ text: err instanceof Error ? err.message : "Could not save the design.", ok: false });
      }
      setSaving(false);
    }
    setTimeout(() => setSaveMsg(null), 3200);
  };

  const backToLayouts = () => {
    if (!navState) return navigate("/view-layouts");
    const { livingRoomLayout: _selected, ...rest } = navState;
    navigate("/view-layouts", { state: rest });
  };

  const qualityColors: Record<SceneQuality, string> = {
    High: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    Medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    Low: "text-red-400 bg-red-500/10 border-red-500/20",
  };

  const show3D = !!layout && viewMode === "3D" && !sceneError;

  return (
    <div
      className="min-h-screen w-full relative transition-colors duration-500 bg-background"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Dot grid / blueprint grid */}
      <div className="absolute inset-0 dot-grid pointer-events-none" />

      {/* ── Navigation ── */}
      <AppNavbar />

      {/* ── Main ── */}
      <main className="relative px-4 md:px-8 pt-3 md:pt-4 pb-6 md:pb-8 max-w-[1400px] mx-auto">

        {/* Page Header + Step Indicator + Toolbar */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        >
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">3D Room Visualization</h2>
            {layout && (
              <p className="text-xs text-zinc-500 truncate">
                {roomName} · {layout.layout.title}
              </p>
            )}
          </div>

          <StepIndicator current={6} />

          {/* Toolbar */}
          {layout && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* 2D / 3D Toggle */}
              <div className="flex rounded-lg border overflow-hidden shadow-sm border-white/10">
                {(["3D", "2D"] as ViewMode[]).map((mode) => (
                  <button key={mode} onClick={() => setViewMode(mode)}
                    className={`px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 ${
                      viewMode === mode
                        ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white"
                        : "bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}>
                    {mode === "3D" ? <Layers className="w-3.5 h-3.5" /> : <Grid3X3 className="w-3.5 h-3.5" />} {mode}
                  </button>
                ))}
              </div>

              {/* Fullscreen */}
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsFullscreen((p) => !p)}
                className="p-1.5 rounded-lg border shadow-sm transition-all bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10"
                title="Toggle wide view"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </motion.button>
            </div>
          )}
        </motion.div>

        {/* ── No layout handed over ── */}
        {!layout && (
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-3xl border border-white/5 p-12 flex flex-col items-center gap-4 text-center">
            <div className="bg-teal-500/10 p-5 rounded-2xl border border-teal-500/20">
              <Box className="w-12 h-12 text-teal-400" />
            </div>
            <h3 className="text-xl font-bold text-white">No layout selected yet</h3>
            <p className="text-zinc-500 max-w-md">
              The 3D view is built from the layout you confirm on the Layouts step. Upload a floor plan, pick a
              room and choose one of its layouts to see it here.
            </p>
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/upload")}
              className="mt-2 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl font-semibold shadow-md shadow-teal-500/20">
              <Upload className="w-4 h-4" /> Upload a Floor Plan
            </motion.button>
          </motion.div>
        )}

        {/* ── Content Grid ── */}
        {layout && (
          <div className={`grid gap-5 ${isFullscreen ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-4"}`}>

            {/* ── Viewer ── */}
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 }}
              className={`${isFullscreen ? "col-span-1" : "xl:col-span-3"} relative`}
            >
              <div
                className="rounded-3xl overflow-hidden shadow-2xl border transition-colors duration-500 border-white/10"
                style={{ minHeight: isFullscreen ? "80vh" : 480 }}
              >
                {/* Viewer header bar */}
                <div className="flex items-center justify-between px-4 py-3 border-b bg-popover/90 border-white/5 backdrop-blur-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex gap-1.5 shrink-0">
                      <span className="w-3 h-3 rounded-full bg-red-400" />
                      <span className="w-3 h-3 rounded-full bg-yellow-400" />
                      <span className="w-3 h-3 rounded-full bg-green-400" />
                    </div>
                    <span className="text-xs font-semibold text-zinc-500 truncate">
                      {viewMode === "3D" ? "3D" : "2D Floor Plan"} · {roomName} · {layout.layout.title}
                    </span>
                  </div>
                  {viewMode === "3D" && (
                    <div className="flex items-center gap-3 shrink-0">
                      <select
                        value={quality}
                        onChange={(e) => setQuality(e.target.value as SceneQuality)}
                        title="Render quality: sharpness and shadows"
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer outline-none ${qualityColors[quality]} bg-transparent`}
                      >
                        {["High", "Medium", "Low"].map((q) => (
                          <option key={q} value={q}>{q}</option>
                        ))}
                      </select>
                      {fps !== null && (
                        <div className="flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-teal-400" />
                          <span className="text-[11px] font-semibold text-teal-400">{fps} FPS</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Viewer canvas */}
                <div className="relative w-full" style={{ height: isFullscreen ? "calc(80vh - 48px)" : 432 }}>
                  {/* 3D scene */}
                  {show3D && (
                    <Suspense fallback={<SceneLoading />}>
                      <RoomScene3D
                        ref={sceneRef}
                        layout={layout}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        quality={quality}
                        backdrop={theme}
                        onFps={setFps}
                        onError={setSceneError}
                      />
                    </Suspense>
                  )}

                  {/* WebGL could not start */}
                  {viewMode === "3D" && sceneError && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
                      <div className="bg-red-500/10 p-4 rounded-2xl border border-red-500/20">
                        <AlertCircle className="w-10 h-10 text-red-400" />
                      </div>
                      <p className="font-bold text-white">The 3D view could not start</p>
                      <p className="text-zinc-500 text-sm max-w-sm">
                        This browser did not provide WebGL ({sceneError}). The 2D plan shows the same layout.
                      </p>
                      <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                        onClick={() => setViewMode("2D")}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl font-semibold text-sm shadow-md">
                        <Grid3X3 className="w-4 h-4" /> Show 2D Plan
                      </motion.button>
                    </div>
                  )}

                  {/* 2D floor plan */}
                  {viewMode === "2D" && (
                    <div className="absolute inset-0 flex items-center justify-center p-4" style={{ background: "#0f1720" }}>
                      <div style={{ aspectRatio: `${layout.room.width} / ${layout.room.length}`, maxWidth: "100%", maxHeight: "100%", height: "100%" }}>
                        <RoomSvg layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
                      </div>
                    </div>
                  )}

                  {/* Drag hint */}
                  {show3D && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] font-medium px-3 py-1.5 rounded-full backdrop-blur-sm border pointer-events-none select-none bg-popover/80 border-white/10 text-zinc-400">
                      Drag to rotate · Scroll to zoom · Right-drag to pan · Click furniture for info
                    </div>
                  )}

                  {/* ── Camera Controls (bottom-right) ── */}
                  {show3D && (
                    <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
                      {[
                        { icon: ZoomIn, title: "Zoom In", action: () => sceneRef.current?.zoom(0.85) },
                        { icon: ZoomOut, title: "Zoom Out", action: () => sceneRef.current?.zoom(1.18) },
                        { icon: RotateCcw, title: "Rotate Left", action: () => sceneRef.current?.rotate(-20) },
                        { icon: RotateCw, title: "Rotate Right", action: () => sceneRef.current?.rotate(20) },
                        { icon: RefreshCw, title: "Reset View", action: () => sceneRef.current?.reset() },
                      ].map(({ icon: Icon, title, action }) => (
                        <motion.button
                          key={title}
                          whileHover={{ scale: 1.12 }}
                          whileTap={{ scale: 0.92 }}
                          onClick={action}
                          title={title}
                          className="w-9 h-9 flex items-center justify-center rounded-xl border shadow-md transition-all bg-popover/80 border-white/10 text-zinc-300 hover:bg-popover backdrop-blur-sm"
                        >
                          <Icon className="w-4 h-4" />
                        </motion.button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* ── Right Panel ── */}
            {!isFullscreen && (
              <div className="xl:col-span-1 flex flex-col gap-4">

                {/* Layout details */}
                <motion.div initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
                  className="glass-card rounded-2xl border border-white/5 p-5">
                  <h4 className="text-sm font-bold text-zinc-200 mb-3 flex items-center gap-2">
                    <Box className="w-4 h-4 text-teal-400" /> Layout Details
                  </h4>
                  <div className="space-y-2">
                    {[
                      { label: "Room", value: roomName },
                      { label: "Layout", value: layout.layout.title },
                      { label: "Score", value: `${Math.round(layout.layout.score)} pts` },
                      { label: "Size", value: `${(layout.room.width / 1000).toFixed(2)} × ${(layout.room.length / 1000).toFixed(2)} m` },
                      { label: "Area", value: `${layout.room.area_m2} m²` },
                      { label: "Ceiling", value: fmtMm(layout.room.height || 2800) },
                      { label: "Pieces", value: `${layout.furniture.length} items` },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between items-center gap-3">
                        <span className="text-xs text-zinc-500 shrink-0">{label}</span>
                        <span className={`text-xs font-bold text-right ${
                          label === "Score" ? "text-emerald-400" : "text-zinc-200"
                        }`}>{value}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* Furniture info */}
                <motion.div initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}
                  className="glass-card rounded-2xl border border-white/5 p-5">
                  <h4 className="text-sm font-bold text-zinc-200 mb-3 flex items-center gap-2">
                    <Info className="w-4 h-4 text-teal-400" /> Furniture Info
                  </h4>
                  <AnimatePresence mode="wait">
                    {selectedItem ? (
                      <motion.div key={selectedItem.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }} className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-bold text-sm text-zinc-200">{itemLabel(selectedItem)}</p>
                          <button onClick={() => setSelectedId(null)} className="text-zinc-600 hover:text-zinc-300">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="rounded-lg px-3 py-2 text-[11px] font-semibold bg-teal-500/10 text-teal-300">
                          {fmtMm(selectedItem.width)} × {fmtMm(selectedItem.depth)} × {fmtMm(selectedItem.height)} high
                          · facing {selectedItem.facing}
                        </div>
                        {selectedItem.reasons.slice(0, 3).map((reason, i) => (
                          <p key={i} className="text-xs leading-relaxed text-zinc-400">{reason}</p>
                        ))}
                      </motion.div>
                    ) : (
                      <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="text-center py-4 text-zinc-600">
                        <Box className="w-7 h-7 mx-auto mb-2 opacity-30" />
                        <p className="text-xs">Click a piece of furniture in the view to see its size and why it stands there</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Items list */}
                <motion.div initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
                  className="glass-card rounded-2xl border border-white/5 p-5 flex-1">
                  <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-zinc-200">
                    <Layers className="w-4 h-4 text-teal-400" /> Items in Scene
                  </h4>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {layout.furniture.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedId((p) => (p === item.id ? null : item.id))}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all text-xs font-medium ${
                          selectedId === item.id
                            ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white"
                            : "text-zinc-400 hover:bg-white/5 hover:text-teal-400"
                        }`}
                      >
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: furnitureColor(item.type) }} />
                        {itemLabel(item)}
                      </button>
                    ))}
                  </div>
                </motion.div>

                {/* Save + Export Actions */}
                <motion.div initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 }}
                  className="flex flex-col gap-3">
                  <div className="relative">
                    <motion.button whileHover={{ scale: 1.03, y: -1 }} whileTap={{ scale: 0.97 }}
                      onClick={handleSave} disabled={saving}
                      className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl font-semibold text-sm shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 transition-all disabled:opacity-60">
                      <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Design"}
                    </motion.button>
                    <AnimatePresence>
                      {saveMsg && (
                        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                          className={`absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-white text-[11px] font-semibold px-3 py-1.5 rounded-xl shadow-lg whitespace-nowrap ${
                            saveMsg.ok ? "bg-green-600" : "bg-red-600"
                          }`}>
                          {saveMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                          {saveMsg.text}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <ExportDropdown onExport={handleExport} />

                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={backToLayouts}
                    className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm border transition-all bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10 hover:border-white/20">
                    <ArrowLeft className="w-4 h-4" /> Back to Layouts
                  </motion.button>
                </motion.div>
              </div>
            )}
          </div>
        )}

        {/* Mobile action strip */}
        {layout && (
          <div className="xl:hidden mt-5 grid grid-cols-2 gap-3">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={handleSave} disabled={saving}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl font-semibold text-sm shadow-md disabled:opacity-60">
              <Save className="w-4 h-4" /> Save Design
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={backToLayouts}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm border transition-all bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10">
              <ArrowLeft className="w-4 h-4" /> Back
            </motion.button>
          </div>
        )}
      </main>
    </div>
  );
}
