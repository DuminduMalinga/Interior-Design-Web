import { ArrowRight, Check } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

export type FlowStep = "upload" | "detect" | "layout" | "view3d";

/** The router state the design flow hands from page to page. */
type FlowState = { floorPlanId?: string; detection?: unknown; room?: unknown } | null;

// The last plan analysed in this browser session, so the steps can reopen it.
let remembered: FlowState = null;

/** Called by the upload page once a floor plan has been analysed. */
export function rememberFlowState(state: FlowState) {
  remembered = state;
}

// The Detect page needs a detection result; the later pages fall back to a placeholder without one.
const STEPS: { id: FlowStep; label: string; path: string; ready: (state: FlowState) => boolean }[] = [
  { id: "upload", label: "Upload", path: "/upload", ready: () => true },
  { id: "detect", label: "Detect", path: "/select-room", ready: (s) => !!s?.detection },
  { id: "layout", label: "Layout", path: "/view-layouts", ready: () => true },
  { id: "view3d", label: "3D View", path: "/room-view-3d", ready: () => true },
];

/**
 * The Upload → Detect → Layout → 3D View progress bar of the design flow.
 * Every step is a button that opens its page, carrying the analysed plan along.
 */
export default function FlowStepper({ current }: { current: FlowStep }) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = ((location.state as FlowState) ?? remembered) as FlowState;
  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <div className="glass-card rounded-2xl border border-white/5 p-2 flex items-center select-none">
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isActive = i === currentIndex;
        const enabled = !isActive && step.ready(state);
        const circle = isDone || isActive
          ? "bg-gradient-to-br from-teal-400 to-teal-600 text-white"
          : "bg-white/5 text-zinc-500 border border-white/10";
        const label = isActive ? "text-teal-400" : isDone ? "text-teal-500" : "text-zinc-500";
        const line = i <= currentIndex ? "bg-teal-500/40" : "bg-white/10";
        return (
          <div key={step.id} className={`flex items-center ${i > 0 ? "flex-1" : ""}`}>
            {i > 0 && (
              <div className="flex flex-1 items-center gap-2 px-1 sm:px-3">
                <span className={`h-px flex-1 ${line}`} />
                <ArrowRight className="hidden sm:block w-3.5 h-3.5 text-zinc-600" />
                <span className={`hidden sm:block h-px flex-1 ${line}`} />
              </div>
            )}
            <button
              type="button"
              disabled={!enabled}
              onClick={() => navigate(step.path, { state })}
              aria-current={isActive ? "step" : undefined}
              title={isActive ? undefined : enabled ? `Go to ${step.label}` : "Upload a floor plan first"}
              className={`flex items-center gap-3 px-2 sm:px-4 py-2 rounded-xl transition-colors ${
                isActive ? "bg-teal-500/10 cursor-default" : enabled ? "cursor-pointer hover:bg-white/5" : "cursor-not-allowed opacity-60"
              }`}
            >
              <span className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${circle} ${
                isActive ? "shadow-md shadow-teal-500/25" : ""
              }`}>
                {isDone ? <Check className="w-4 h-4" /> : i + 1}
              </span>
              <span className={`text-sm font-semibold whitespace-nowrap ${isActive ? "" : "hidden md:inline"} ${label}`}>
                {step.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
