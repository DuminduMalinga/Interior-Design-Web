import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Box,
  Check,
  ChevronDown,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Package,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import AppNavbar from "../components/AppNavbar";
import PageGlows from "../components/marketing/PageGlows";
import FlowStepper from "../components/FlowStepper";
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

type Toast = { text: string; ok: boolean };

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
// Segmented control (same pill as the Layout page's options)
// ─────────────────────────────────────────────
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-full border border-lv-line bg-lv-surface/70 p-1 backdrop-blur-xl">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`h-8 cursor-pointer rounded-full px-3.5 text-sm transition-colors ${
            value === o.value ? "bg-lv-ink text-lv-on-ink" : "text-lv-ink hover:bg-lv-ink/8"
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Export menu
// ─────────────────────────────────────────────
type ExportKind = "png" | "glb";

const EXPORT_OPTIONS: Array<{ kind: ExportKind; icon: typeof ImageIcon; label: string; sub: string }> = [
  { kind: "png", icon: ImageIcon, label: "Image", sub: "PNG of the current 3D view" },
  { kind: "glb", icon: Package, label: "3D model", sub: "GLB, real size in metres" },];

function ExportMenu({ onExport }: { onExport: (kind: ExportKind, label: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((p) => !p)} aria-expanded={open} aria-haspopup="menu"
        className="lv-btn-quiet w-full bg-lv-surface/70 backdrop-blur-xl">
        <Download className="h-4 w-4" aria-hidden="true" /> Export
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-[20px] border border-lv-line bg-lv-surface p-1.5 shadow-xl"
          >
            {EXPORT_OPTIONS.map(({ kind, icon: Icon, label, sub }) => (
              <button key={kind} type="button" role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onExport(kind, label);
                }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-lv-ink/6">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-lv-wash/70 text-lv-ink">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-lv-ink">{label}</span>
                  <span className="block text-xs text-lv-muted">{sub}</span>
                </span>
              </button>
            ))}
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
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-lv-accent" aria-hidden="true" />
      <p className="mt-5 text-xl leading-tight text-lv-ink">Building the 3D room</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-lv-muted">Walls, openings and furniture at real size.</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Furniture detail (when a piece is picked)
// ─────────────────────────────────────────────
function FurnitureDetail({ item, onBack }: { item: LayoutFurnitureItem; onBack: () => void }) {
  const facts = [
    { label: "Size", value: `${fmtMm(item.width)} × ${fmtMm(item.depth)}` },
    { label: "Height", value: fmtMm(item.height) },
    { label: "Facing", value: item.facing },
    { label: "Placed by", value: item.placement_strategy || "Not recorded" },
  ];
  return (
    <div>
      <button type="button" onClick={onBack}
        className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full text-sm text-lv-muted transition-colors hover:text-lv-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All pieces
      </button>
      <h3 className="mt-3 flex items-center gap-2.5 text-lg leading-tight text-lv-ink">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: furnitureColor(item.type) }} aria-hidden="true" />
        {itemLabel(item)}
      </h3>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-xs text-lv-muted">{fact.label}</dt>
            <dd className="mt-0.5 text-sm font-medium capitalize text-lv-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {item.reasons.length > 0 && (
        <>
          <p className="mt-5 text-xs text-lv-muted">Why it is here</p>
          <ul className="mt-2 space-y-2">
            {item.reasons.map((reason, i) => (
              <li key={i} className="text-sm leading-relaxed text-lv-ink">{reason}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────
export default function RoomView3D() {
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const navState = location.state as RoomViewState | null;
  const layout = navState?.livingRoomLayout ?? null;
  const roomName = navState?.room?.name ?? "Room";

  const { theme } = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>("3D");
  // The viewer itself goes full screen; the page layout around it stays as it is.
  const viewerRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [quality, setQuality] = useState<SceneQuality>("High");
  const [fps, setFps] = useState<number | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const sceneRef = useRef<RoomScene3DHandle>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const selectedItem = useMemo(
    () => layout?.furniture.find((f) => f.id === selectedId) ?? null,
    [layout, selectedId],
  );

  const showToast = (next: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Follow the browser's full-screen state, so Esc and the browser's own exit keep the button in step.
  useEffect(() => {
    const onChange = () => setFullscreen(!!viewerRef.current && document.fullscreenElement === viewerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Where the Fullscreen API is missing (iPhone Safari), the viewer is pinned over the page instead.
  useEffect(() => {
    if (!fullscreen || document.fullscreenElement) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const toggleFullscreen = async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else if (fullscreen) {
      setFullscreen(false);
    } else if (viewer.requestFullscreen) {
      await viewer.requestFullscreen().catch(() => setFullscreen(true));
    } else {
      setFullscreen(true);
    }
  };

  const fileStem = `${roomName}-${layout?.layout.type ?? "layout"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const runExport = async (kind: ExportKind) => {
    if (!layout) throw new Error("There is no layout to export.");
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

  const handleExport = async (kind: ExportKind, label: string) => {
    try {
      await runExport(kind);
      showToast({ text: `${label} downloaded`, ok: true });
    } catch (err) {
      showToast({ text: err instanceof Error ? err.message : "Export failed.", ok: false });
    }
  };

  const handleSave = async () => {
    if (!layout || saving) return;
    if (!navState?.floorPlanId || !navState.room) {
      showToast({ text: "This layout is not linked to an uploaded floor plan.", ok: false });
      return;
    }
    setSaving(true);
    try {
      await saveSelectedLivingRoomLayout(navState.floorPlanId, navState.room.id, layout);
      showToast({ text: "Design saved", ok: true });
    } catch (err) {
      showToast({ text: err instanceof Error ? err.message : "Could not save the design.", ok: false });
    }
    setSaving(false);
  };

  const show3D = !!layout && viewMode === "3D" && !sceneError;

  const cameraControls = [
    { icon: ZoomIn, title: "Zoom in", action: () => sceneRef.current?.zoom(0.85) },
    { icon: ZoomOut, title: "Zoom out", action: () => sceneRef.current?.zoom(1.18) },
    { icon: RotateCcw, title: "Rotate left", action: () => sceneRef.current?.rotate(-20) },
    { icon: RotateCw, title: "Rotate right", action: () => sceneRef.current?.rotate(20) },
    { icon: RefreshCw, title: "Reset view", action: () => sceneRef.current?.reset() },
  ];

  const overlayPill = "rounded-full border border-lv-line bg-lv-surface/80 backdrop-blur-xl shadow-sm";

  // From lg up the page is one viewport tall: the viewer fills what is left and
  // only the side panel's piece list scrolls.
  return (
    <div className="min-h-screen w-full bg-background relative isolate flex flex-col lg:h-svh lg:min-h-0 lg:overflow-hidden">
      <PageGlows />
      <AppNavbar />

      <main className="relative flex w-full flex-1 flex-col px-4 pb-6 pt-2 md:px-8 lg:min-h-0">
        <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col lg:min-h-0">
          <div className="mx-auto w-full max-w-2xl shrink-0">
            <FlowStepper current="view3d" />
          </div>

          {/* ── No layout handed over ── */}
          {!layout && (
            <div className="mt-6 flex flex-1 flex-col items-center justify-center rounded-[28px] border border-lv-line bg-lv-surface px-6 py-16 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-lv-wash/70">
                <Box className="h-7 w-7 text-lv-accent" aria-hidden="true" />
              </span>
              <h1 className="mt-5 text-2xl leading-tight text-lv-ink md:text-3xl">No layout selected yet</h1>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-lv-muted">
                The 3D view is built from the layout you pick on the Layout step. Upload a floor plan, choose a room
                and pick one of its layouts to see it here.
              </p>
              <button type="button" onClick={() => navigate("/upload")} className="lv-btn mt-6">
                <Upload className="h-4 w-4" aria-hidden="true" /> Upload a floor plan
              </button>
            </div>
          )}

          {layout && (
            <>
              {/* ── Header ── */}
              <div className="mt-6 flex shrink-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <h1 className="text-3xl md:text-4xl leading-[1.05] tracking-tight text-lv-ink">{roomName} in 3D</h1>
                  <p className="mt-2 text-sm md:text-base text-lv-muted">
                    {layout.layout.title} · {(layout.room.width / 1000).toFixed(2)} × {(layout.room.length / 1000).toFixed(2)} m,{" "}
                    {layout.room.area_m2} m²
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Segmented label="View" value={viewMode} onChange={setViewMode}
                    options={[{ value: "3D", label: "3D view" }, { value: "2D", label: "2D plan" }]} />
                  <ExportMenu onExport={(kind, label) => void handleExport(kind, label)} />
                  <button type="button" onClick={() => void handleSave()} disabled={saving} className="lv-btn">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                    {saving ? "Saving…" : "Save design"}
                  </button>
                </div>
              </div>

              {/* ── Viewer + side panel ── */}
              <div className="mt-5 grid flex-1 grid-cols-1 gap-5 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
                {/* Viewer */}
                <section ref={viewerRef} aria-label={viewMode === "3D" ? "3D view" : "2D plan"}
                  className={`select-none overflow-hidden bg-lv-surface ${
                    fullscreen
                      ? "fixed inset-0 z-[100] h-full w-full rounded-none border-0"
                      : "relative h-[62svh] min-h-[380px] rounded-[28px] border border-lv-line lg:h-auto lg:min-h-0"
                  }`}>
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
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center" role="alert">
                      <span className="grid h-14 w-14 place-items-center rounded-full bg-red-500/10">
                        <AlertCircle className="h-7 w-7 text-red-400" aria-hidden="true" />
                      </span>
                      <p className="mt-5 text-xl leading-tight text-lv-ink">The 3D view could not start</p>
                      <p className="mt-2 max-w-sm text-sm leading-relaxed text-lv-muted">
                        This browser did not provide WebGL ({sceneError}). The 2D plan shows the same layout.
                      </p>
                      <button type="button" onClick={() => setViewMode("2D")} className="lv-btn mt-6">Show the 2D plan</button>
                    </div>
                  )}

                  {/* 2D floor plan */}
                  {viewMode === "2D" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[var(--lv-plan-floor)] p-4 md:p-8">
                      <div style={{ aspectRatio: `${layout.room.width} / ${layout.room.length}`, maxWidth: "100%", maxHeight: "100%", height: "100%" }}>
                        <RoomSvg layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
                      </div>
                    </div>
                  )}

                  {/* Top overlay: render quality + fps, and the full-screen toggle */}
                  <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
                    {show3D ? (
                      <div className={`pointer-events-auto flex items-center gap-1 p-1 ${overlayPill}`}>
                        <span className="hidden pl-2.5 pr-1 text-xs text-lv-muted sm:inline">Quality</span>
                        {(["High", "Medium", "Low"] as SceneQuality[]).map((q) => (
                          <button key={q} type="button" aria-pressed={quality === q} onClick={() => setQuality(q)}
                            title="Render quality: sharpness and shadows"
                            className={`h-7 cursor-pointer rounded-full px-3 text-xs transition-colors ${
                              quality === q ? "bg-lv-ink text-lv-on-ink" : "text-lv-ink hover:bg-lv-ink/8"
                            }`}>
                            {q}
                          </button>
                        ))}
                        {/* The scene only redraws when something changes, so an idle view reports 0 */}
                        {!!fps && (
                          <span className="px-2.5 text-xs tabular-nums text-lv-muted">{fps} fps</span>
                        )}
                      </div>
                    ) : <span />}

                    <button type="button" onClick={() => void toggleFullscreen()}
                      title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
                      aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                      aria-pressed={fullscreen}
                      className={`pointer-events-auto grid h-9 w-9 cursor-pointer place-items-center text-lv-ink transition-colors hover:bg-lv-surface ${overlayPill}`}>
                      {fullscreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>

                  {/* Bottom overlay: hint and camera controls */}
                  {show3D && (
                    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex items-end justify-between gap-3">
                      <p className={`hidden px-3.5 py-2 text-xs text-lv-muted md:block ${overlayPill}`}>
                        Drag to rotate · Scroll to zoom · Right-drag to pan · Click a piece for details
                      </p>
                      <div className={`pointer-events-auto ml-auto flex items-center gap-0.5 p-1 ${overlayPill}`}>
                        {cameraControls.map(({ icon: Icon, title, action }) => (
                          <button key={title} type="button" onClick={action} title={title} aria-label={title}
                            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-lv-ink transition-colors hover:bg-lv-ink/8">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                {/* Side panel */}
                  <aside className="flex flex-col gap-4 lg:min-h-0">
                    {/* Layout summary */}
                    <div className="shrink-0 rounded-[28px] border border-lv-line bg-lv-surface p-5">
                      <div className="flex items-end justify-between gap-4">
                        <div className="min-w-0">
                          <h2 className="text-xs font-normal tracking-normal text-lv-muted">Layout score</h2>
                          <p className="mt-1.5 text-4xl font-medium leading-none tabular-nums text-lv-ink">
                            {Math.round(layout.layout.score)}
                          </p>
                        </div>
                        {layout.validation.valid ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400">
                            <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> Valid layout
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Compromised
                          </span>
                        )}
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-lv-line pt-4">
                        {[
                          { label: "Size", value: `${(layout.room.width / 1000).toFixed(2)} × ${(layout.room.length / 1000).toFixed(2)} m` },
                          { label: "Area", value: `${layout.room.area_m2} m²` },
                          { label: "Ceiling", value: fmtMm(layout.room.height || 2800) },
                          { label: "Pieces", value: `${layout.furniture.length}` },
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <dt className="text-xs text-lv-muted">{label}</dt>
                            <dd className="mt-0.5 text-sm font-medium tabular-nums text-lv-ink">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>

                    {/* Pieces: the list, or the one that is picked */}
                    <div className="flex flex-col rounded-[28px] border border-lv-line bg-lv-surface p-5 lg:min-h-0 lg:flex-1">
                      <AnimatePresence mode="wait" initial={false}>
                        {selectedItem ? (
                          <motion.div key={selectedItem.id}
                            initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                            exit={reduceMotion ? undefined : { opacity: 0, y: 6 }} transition={{ duration: 0.15 }}
                            className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                            <FurnitureDetail item={selectedItem} onBack={() => setSelectedId(null)} />
                          </motion.div>
                        ) : (
                          <motion.div key="list"
                            initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}
                            exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: 0.15 }}
                            className="flex flex-col lg:min-h-0">
                            <div className="flex shrink-0 items-baseline justify-between gap-3">
                              <h2 className="text-base leading-tight text-lv-ink">In this room</h2>
                              <span className="text-xs text-lv-muted">Pick one for details</span>
                            </div>
                            <ul className="-mx-2 mt-3 space-y-0.5 lg:min-h-0 lg:overflow-y-auto">
                              {layout.furniture.map((item) => (
                                <li key={item.id}>
                                  <button type="button" onClick={() => setSelectedId(item.id)}
                                    className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-lv-ink/6">
                                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: furnitureColor(item.type) }} aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate text-sm text-lv-ink">{itemLabel(item)}</span>
                                    <span className="shrink-0 text-xs tabular-nums text-lv-muted">
                                      {fmtMm(item.width)} × {fmtMm(item.depth)}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </aside>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Save / export feedback */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              className="flex items-center gap-2 rounded-full border border-lv-line bg-lv-surface px-4 py-2.5 text-sm text-lv-ink shadow-xl"
            >
              {toast.ok
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                : <AlertCircle className="h-4 w-4 text-red-500" aria-hidden="true" />}
              {toast.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
