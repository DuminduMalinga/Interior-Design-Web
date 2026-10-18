import { Check } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

export type FlowStep = "upload" | "detect" | "layout" | "view3d";

/** The router state the design flow hands from page to page. */
type FlowState = {
  floorPlanId?: string;
  detection?: { floorPlanId?: string } | null;
  room?: { id?: string } | null;
  livingRoomLayout?: unknown;
  [key: string]: unknown;
} | null;

// How far the current plan has got in this browser session: everything each
// step has produced so far. The stepper only opens steps that are in here.
let progress: FlowState = null;

/** Called by the upload page once a floor plan has been analysed. */
export function rememberFlowState(state: FlowState) {
  progress = state ? { ...state } : null;
}

const planId = (s: FlowState) => s?.floorPlanId ?? s?.detection?.floorPlanId ?? null;

/**
 * Adds what a page was opened with to the progress. A different plan starts
 * over; a different room drops the 3D view, which belonged to the old room.
 */
function record(state: FlowState) {
  if (!state?.detection) return;
  if (!progress || planId(progress) !== planId(state)) {
    progress = { ...state };
    return;
  }
  const roomChanged = !!state.room && !!progress.room && state.room.id !== progress.room.id;
  const next = { ...progress, ...state };
  if (roomChanged && !state.livingRoomLayout) delete next.livingRoomLayout;
  progress = next;
}

// Each step opens once the step before it has produced what it needs.
const STEPS: { id: FlowStep; label: string; path: string; ready: (s: FlowState) => boolean; blocked: string }[] = [
  { id: "upload", label: "Upload", path: "/upload", ready: () => true, blocked: "" },
  { id: "detect", label: "Detect", path: "/select-room", ready: (s) => !!s?.detection, blocked: "Upload a floor plan first" },
  { id: "layout", label: "Layout", path: "/view-layouts", ready: (s) => !!s?.room, blocked: "Pick a room first" },
  { id: "view3d", label: "3D View", path: "/room-view-3d", ready: (s) => !!s?.livingRoomLayout, blocked: "Choose a layout first" },
];

/**
 * The Upload → Detect → Layout → 3D View progress bar of the design flow.
 * A step is a button once it has been reached, so the user can move back and
 * forth between the steps already generated, carrying the plan along.
 */
export default function FlowStepper({ current }: { current: FlowStep }) {
  const navigate = useNavigate();
  const location = useLocation();
  const opened = location.state as FlowState;

  // The stepper always opens Upload with the progress in hand; arriving there
  // any other way (the navbar, the dashboard, a link) is a new design.
  if (current === "upload" && !opened?.detection) progress = null;
  else record(opened);

  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <div className="rounded-full border border-lv-line bg-lv-surface/70 backdrop-blur-xl p-1 flex items-center select-none">
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isActive = i === currentIndex;
        const enabled = !isActive && step.ready(progress);
        const circle = isActive
          ? "bg-lv-on-ink/20 text-lv-on-ink"
          : isDone
            ? "bg-lv-accent text-[#fff]"
            : "border border-lv-line text-lv-muted";
        const line = i <= currentIndex ? "bg-lv-accent/50" : "bg-lv-line";
        return (
          <div key={step.id} className={`flex items-center ${i > 0 ? "flex-1" : ""}`}>
            {i > 0 && <span aria-hidden="true" className={`mx-1 sm:mx-2 h-px flex-1 ${line}`} />}
            <button
              type="button"
              disabled={!enabled}
              onClick={() => navigate(step.path, { state: progress })}
              aria-current={isActive ? "step" : undefined}
              title={isActive ? undefined : enabled ? `Go to ${step.label}` : step.blocked}
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
