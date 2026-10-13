import { Check } from "lucide-react";
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
    <div className="rounded-full border border-lv-line bg-lv-surface/70 backdrop-blur-xl p-1 flex items-center select-none">
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isActive = i === currentIndex;
        const enabled = !isActive && step.ready(state);
        const circle = isActive
          ? "bg-lv-on-ink/20 text-lv-on-ink"
          : isDone
            ? "bg-lv-accent text-white"
            : "border border-lv-line text-lv-muted";
        const line = i <= currentIndex ? "bg-lv-accent/50" : "bg-lv-line";
        return (
          <div key={step.id} className={`flex items-center ${i > 0 ? "flex-1" : ""}`}>
            {i > 0 && <span aria-hidden="true" className={`mx-1 sm:mx-2 h-px flex-1 ${line}`} />}
            <button
              type="button"
              disabled={!enabled}
              onClick={() => navigate(step.path, { state })}
              aria-current={isActive ? "step" : undefined}
              title={isActive ? undefined : enabled ? `Go to ${step.label}` : "Upload a floor plan first"}
              className={`flex items-center gap-2.5 h-9 pl-1.5 pr-1.5 sm:pr-4 rounded-full transition-colors ${
                isActive
                  ? "bg-lv-ink text-lv-on-ink cursor-default"
                  : enabled
                    ? "text-lv-ink cursor-pointer hover:bg-lv-ink/8"
                    : "text-lv-muted cursor-not-allowed opacity-70"
              }`}
            >
              <span className={`w-6 h-6 rounded-full grid place-items-center font-semibold text-xs shrink-0 ${circle}`}>
                {isDone ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={`text-sm font-medium whitespace-nowrap ${isActive ? "pr-2 sm:pr-0" : "hidden md:inline"}`}>
                {step.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
