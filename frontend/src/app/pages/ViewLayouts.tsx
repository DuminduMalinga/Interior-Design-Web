import { useState, useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import AppNavbar from "../components/AppNavbar";
import PageGlows from "../components/marketing/PageGlows";
import FlowStepper from "../components/FlowStepper";
import type { DetectionResult } from "../lib/wallDetector";
import {
  generateAllLivingRoomLayouts,
  isLayoutError,
  type GenerateAllLivingRoomLayoutsResponse,
  type LivingActivity,
  type LivingRoomExtras,
} from "../lib/livingRoomLayout";
import {
  generateAllBedroomLayouts,
  type GenerateAllBedroomLayoutsResponse,
} from "../lib/bedroomLayout";
import {
  generateAllKitchenLayouts,
  type GenerateAllKitchenLayoutsResponse,
} from "../lib/kitchenLayout";
import {
  generateAllBathroomLayouts,
  type GenerateAllBathroomLayoutsResponse,
} from "../lib/bathroomLayout";
import {
  generateAllDiningLayouts,
  type DiningSeats,
  type GenerateAllDiningLayoutsResponse,
} from "../lib/diningLayout";
import { generateAllMasterBedroomLayouts } from "../lib/masterBedroomLayout";
import { roomKind } from "../lib/roomKind";
import LivingRoomLayoutGrid from "../components/LivingRoomLayoutGrid";
import LivingRoomPlan from "../components/LivingRoomPlan";
import {
  saveLivingRoomAnalysis,
  saveSelectedLivingRoomLayout,
} from "../lib/floorPlanAnalysis";

const LIVING_ACTIVITY_SETS: Array<{ label: string; activities: LivingActivity[] | null }> = [
  { label: "Auto", activities: null },
  { label: "Talk & TV", activities: ["conversation", "tv"] },
  { label: "+ Dining", activities: ["conversation", "tv", "dining"] },
  { label: "+ Reading", activities: ["conversation", "tv", "reading"] },
  { label: "+ Work", activities: ["conversation", "tv", "work"] },
  { label: "Talk only", activities: ["conversation"] },
];

/** An engine's programme summary as a list: "king bed, 2 bedside tables" -> ["King bed", "2 bedside tables"]. */
const programmeItems = (summary: string) =>
  summary.split(", ").filter(Boolean).map((item) => item.charAt(0).toUpperCase() + item.slice(1));

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────
export default function ViewLayouts() {
  const navigate = useNavigate();
  const location = useLocation();
  // ── Real layout generation ───────────────────────────────────────────
  // SelectRoom navigates here with { room, detection } in router state.
  // Rooms whose OCR'd name looks like a living room, a bathroom, a bedroom, a kitchen or a
  // dining area get their rule-based engine; anything else gets the notice at the end.
  const navState = location.state as
    | { floorPlanId?: string; room?: { id: string; name: string }; detection?: DetectionResult }
    | null;
  const apiRoom = navState?.detection?.rooms.find((r) => r.id === navState.room?.id);
  const kind = apiRoom ? roomKind(apiRoom.name) : null;
  const isLivingRoom = kind === "living";
  const isBathroom = kind === "bathroom";
  const isBedroom = kind === "bedroom" || kind === "master_bedroom";
  // A master bedroom is a bedroom with its own, fuller rule set (dressing table, lighting, en-suite route).
  const isMasterBedroom = kind === "master_bedroom";
  const isKitchen = kind === "kitchen";
  const isDining = kind === "dining";
  const hasEngine = isLivingRoom || isBathroom || isBedroom || isKitchen || isDining;

  const [livingAll, setLivingAll] = useState<GenerateAllLivingRoomLayoutsResponse | null>(null);
  const [selectedLayoutType, setSelectedLayoutType] = useState<string | null>(null);
  const [livingError, setLivingError] = useState<string | null>(null);
  const [livingLoading, setLivingLoading] = useState(false);
  const [livingRetry, setLivingRetry] = useState(0);
  // Bedroom rule 11 needs a head count; null lets the engine infer it from the room size.
  const [bedroomOccupants, setBedroomOccupants] = useState<1 | 2 | null>(null);
  const bedroomAll = isBedroom ? (livingAll as GenerateAllBedroomLayoutsResponse | null) : null;
  // Kitchen rule 10 concerns a dining table; null lets the engine decide from the room size.
  const [kitchenTable, setKitchenTable] = useState<boolean | null>(null);
  const kitchenAll = isKitchen ? (livingAll as GenerateAllKitchenLayoutsResponse | null) : null;
  // Bathroom rules 13 and 15 apply only when the user has mobility needs.
  const [bathroomAccessible, setBathroomAccessible] = useState(false);
  const bathroomAll = isBathroom ? (livingAll as GenerateAllBathroomLayoutsResponse | null) : null;
  // Dining rule 12 needs a seat count; null lets the engine decide from the room size.
  const [diningSeats, setDiningSeats] = useState<DiningSeats | null>(null);
  const diningAll = isDining ? (livingAll as GenerateAllDiningLayoutsResponse | null) : null;
  // Living-room rule 7 needs the household's daily activities (null lets the engine assume
  // them from the room); rule 10 concerns an occupant with mobility needs.
  const [livingActivities, setLivingActivities] = useState<LivingActivity[] | null>(null);
  const [livingAccessible, setLivingAccessible] = useState(false);
  const livingRoomAll = isLivingRoom
    ? (livingAll as (GenerateAllLivingRoomLayoutsResponse & LivingRoomExtras) | null)
    : null;
  const roomLabel = isBathroom
    ? "Bathroom"
    : isMasterBedroom
      ? "Master Bedroom"
      : isBedroom
        ? "Bedroom"
        : isKitchen
        ? "Kitchen"
        : isDining
          ? "Dining Area"
          : "Living Room";

  useEffect(() => {
    if (!hasEngine || !apiRoom || !navState?.detection) return;
    let cancelled = false;
    setLivingLoading(true);
    setLivingError(null);
    setLivingAll(null);
    setSelectedLayoutType(null);
    const openings = navState.detection.detections.filter(
      (d) => d.class === "Door" || d.class === "Window",
    );
    // Prefer the real-world scale recovered from the plan's own printed
    // room areas over the engine's own guess from a detected door.
    const scaleMPerPx = navState.detection.scaleMmPerPx
      ? navState.detection.scaleMmPerPx / 1000
      : undefined;
    const request = {
      room: {
        id: apiRoom.id,
        name: apiRoom.name,
        bbox: apiRoom.bbox,
        // the outline traced from the walls, so an L-shaped room is furnished as an L
        polygon: apiRoom.shapeSource === "walls" ? apiRoom.polygon : undefined,
        // the size printed on the plan, so the layout is planned at the size the room list shows
        ...(apiRoom.labelWidthM && apiRoom.labelHeightM && apiRoom.widthM && apiRoom.heightM
          ? { width_m: apiRoom.widthM, length_m: apiRoom.heightM }
          : {}),
      },
      detections: openings.map((d) => ({ id: d.id, class: d.class, bbox: d.bbox })),
      scaleMPerPx,
    };
    const rooms = navState.detection.rooms.map((r) => ({ id: r.id, name: r.name, bbox: r.bbox }));
    const generated: Promise<GenerateAllLivingRoomLayoutsResponse> = isBathroom
      ? generateAllBathroomLayouts({ ...request, rooms, accessible: bathroomAccessible })
      : isBedroom
        ? (isMasterBedroom ? generateAllMasterBedroomLayouts : generateAllBedroomLayouts)({
            ...request,
            rooms,
            occupants: bedroomOccupants ?? undefined,
          })
        : isKitchen
          ? generateAllKitchenLayouts({ ...request, rooms, diningTable: kitchenTable ?? undefined })
          : isDining
            ? generateAllDiningLayouts({ ...request, rooms, seats: diningSeats ?? undefined })
            : generateAllLivingRoomLayouts({
                ...request,
                rooms,
                activities: livingActivities ?? undefined,
                accessible: livingAccessible,
              });
    generated
      .then(async (res) => {
        if (cancelled) return;
        setLivingAll(res);
        const selectedType = res.bestLayout ?? res.layouts.find((l) => !("error" in l))?.layout.type ?? null;
        setSelectedLayoutType(selectedType);
        const selected = res.layouts.find((l) => l.layout.type === selectedType);
        if (navState.floorPlanId && selected && !isLayoutError(selected)) {
          await saveLivingRoomAnalysis(navState.floorPlanId, apiRoom.id, res, selected);
        }
      })
      .catch((err) => {
        if (!cancelled) setLivingError(err instanceof Error ? err.message : "Layout generation failed.");
      })
      .finally(() => {
        if (!cancelled) setLivingLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEngine, isBathroom, isBedroom, isMasterBedroom, isKitchen, isDining, apiRoom?.id, navState?.detection, livingRetry,
    bedroomOccupants, kitchenTable, bathroomAccessible, diningSeats, livingActivities, livingAccessible]);

  const rawSelectedLayout = livingAll?.layouts.find((l) => l.layout.type === selectedLayoutType) ?? null;
  const selectedLayoutEntry = rawSelectedLayout && !isLayoutError(rawSelectedLayout) ? rawSelectedLayout : null;

  // ── Real layouts from the rule-based engines ────────────────────────
  if (hasEngine && apiRoom) {
    // The room's planning options, as labelled groups of choices.
    type Choice = { key: string; label: string; active: boolean; pick: () => void };
    const optionGroups: { label: string; choices: Choice[] }[] = [];
    // What the engine planned for: a short lead ("Planned for 2 persons"), how it got there, and the furniture.
    let optionNote: { lead: string; basis?: string; items: string[] } | null = null;

    if (isLivingRoom) {
      optionGroups.push({
        label: "Daily activities",
        choices: LIVING_ACTIVITY_SETS.map((set) => ({
          key: set.label,
          label: set.label,
          active: (livingActivities?.join() ?? null) === (set.activities?.join() ?? null),
          pick: () => setLivingActivities(set.activities),
        })),
      });
      optionGroups.push({
        label: "Mobility needs",
        choices: ([false, true] as const).map((choice) => ({
          key: String(choice),
          label: choice ? "Wider paths, no rug" : "None",
          active: livingAccessible === choice,
          pick: () => setLivingAccessible(choice),
        })),
      });
      if (livingRoomAll?.programme) {
        // "Standard sizes for conversation + tv: 2.1 m three-seat sofa, ..."
        const summary = livingRoomAll.programme.summary;
        const cut = summary.indexOf(": ");
        optionNote = {
          lead: cut >= 0 ? summary.slice(0, cut).replace(/\btv\b/g, "TV") : "Planned for this room",
          basis: livingRoomAll.activitiesSource === "inferred" ? "assumed for this room" : undefined,
          items: programmeItems(cut >= 0 ? summary.slice(cut + 2) : summary),
        };
      }
    } else if (isBedroom) {
      optionGroups.push({
        label: "Persons",
        choices: ([null, 1, 2] as const).map((count) => ({
          key: String(count ?? "auto"),
          label: count === null ? "Auto" : String(count),
          active: bedroomOccupants === count,
          pick: () => setBedroomOccupants(count),
        })),
      });
      if (bedroomAll) {
        optionNote = {
          lead: `Planned for ${bedroomAll.occupants} ${bedroomAll.occupants === 1 ? "person" : "persons"}`,
          basis: bedroomAll.occupantsSource === "inferred" ? (isMasterBedroom ? "by default" : "from the room size") : undefined,
          items: programmeItems(bedroomAll.programme.summary),
        };
      }
    } else if (isBathroom) {
      optionGroups.push({
        label: "Mobility needs",
        choices: ([false, true] as const).map((choice) => ({
          key: String(choice),
          label: choice ? "Wheelchair and grab bars" : "None",
          active: bathroomAccessible === choice,
          pick: () => setBathroomAccessible(choice),
        })),
      });
      if (bathroomAll) optionNote = { lead: "Planned for this room", items: programmeItems(bathroomAll.programme.summary) };
    } else if (isDining) {
      optionGroups.push({
        label: "Seats",
        choices: ([null, 2, 4, 6, 8] as const).map((count) => ({
          key: String(count ?? "auto"),
          label: count === null ? "Auto" : String(count),
          active: diningSeats === count,
          pick: () => setDiningSeats(count),
        })),
      });
      if (diningAll) {
        optionNote = {
          lead: `Planned for ${diningAll.seats} ${diningAll.seats === 1 ? "seat" : "seats"}`,
          basis: diningAll.seatsSource === "inferred" ? "from the room size" : undefined,
          items: programmeItems(diningAll.programme.summary),
        };
      }
    } else if (isKitchen) {
      optionGroups.push({
        label: "Dining table",
        choices: ([null, true, false] as const).map((choice) => ({
          key: String(choice),
          label: choice === null ? "Auto" : choice ? "With" : "Without",
          active: kitchenTable === choice,
          pick: () => setKitchenTable(choice),
        })),
      });
      if (kitchenAll) optionNote = { lead: "Planned for this room", items: programmeItems(kitchenAll.programme.summary) };
    }

    const layoutCount = livingAll?.layouts.filter((l) => !isLayoutError(l)).length ?? 0;

    const continueTo3D = async () => {
      if (!selectedLayoutEntry) return;
      if (navState?.floorPlanId) {
        try {
          await saveSelectedLivingRoomLayout(navState.floorPlanId, apiRoom.id, selectedLayoutEntry);
        } catch (err) {
          setLivingError(err instanceof Error ? err.message : "Could not save the selected layout.");
          return;
        }
      }
      navigate("/room-view-3d", {
        state: { ...navState, livingRoomLayout: selectedLayoutEntry },
      });
    };

    // Shown at the foot of the layout card's side panel from lg up, and as a sticky full-width bar below that.
    const actions = (
      <button type="button" onClick={() => void continueTo3D()} disabled={!selectedLayoutEntry || livingLoading} className="lv-btn min-h-12 w-full px-6">
        View in 3D <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    );

    const statusCardCls =
      "flex flex-col items-center justify-center rounded-[28px] border border-lv-line bg-lv-surface px-6 py-16 text-center lg:min-h-0";

    // From lg up the page is one viewport tall: the list on the left is the only
    // part that scrolls, and the chosen layout with its actions stays in place.
    return (
      <div className="min-h-screen w-full bg-background relative isolate flex flex-col lg:h-svh lg:min-h-0 lg:overflow-hidden">
        <PageGlows />
        <AppNavbar />

        <main className="relative flex w-full flex-1 flex-col px-4 pb-6 pt-2 md:px-8 lg:min-h-0">
          <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col lg:min-h-0">
            <div className="mx-auto w-full max-w-2xl shrink-0">
              <FlowStepper current="layout" />
            </div>

            <div className="mt-6 flex shrink-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h1 className="text-3xl md:text-4xl leading-[1.05] tracking-tight text-lv-ink">{apiRoom.name} layouts</h1>
                <p className="mt-2 text-sm md:text-base text-lv-muted" aria-live="polite">
                  {livingLoading
                    ? "Working out the layouts for this room."
                    : livingAll
                      ? `${layoutCount} ${layoutCount === 1 ? "layout" : "layouts"}, best first. Pick one to see why it scored that way.`
                      : livingError ? "Something went wrong." : "No layouts yet."}
                </p>
              </div>

              {optionGroups.length > 0 && (
                <div className="flex min-w-0 flex-col gap-2 lg:items-end">
                  {optionGroups.map((group) => (
                    <div key={group.label} role="group" aria-label={group.label} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="text-sm text-lv-muted">{group.label}</span>
                      <div className="flex flex-wrap gap-1 rounded-full border border-lv-line bg-lv-surface/70 p-1">
                        {group.choices.map((choice) => (
                          <button key={choice.key} type="button" disabled={livingLoading} aria-pressed={choice.active} onClick={choice.pick}
                            className={`h-8 cursor-pointer rounded-full px-3.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                              choice.active ? "bg-lv-ink text-lv-on-ink" : "text-lv-ink hover:bg-lv-ink/8"
                            }`}>
                            {choice.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {optionNote && (
                    <div className="flex max-w-2xl flex-col gap-1.5 lg:items-end">
                      <p className="text-sm text-lv-muted">
                        <span className="font-medium text-lv-ink">{optionNote.lead}</span>
                        {optionNote.basis && <> · {optionNote.basis}</>}
                      </p>
                      <ul aria-label="Planned furniture" className="flex flex-wrap gap-1.5 lg:justify-end">
                        {optionNote.items.map((item) => (
                          <li key={item} className="rounded-full border border-lv-line bg-lv-surface/70 px-2.5 py-1 text-xs text-lv-ink">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 grid flex-1 grid-cols-1 gap-5 lg:min-h-0 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
              {/* Layout list: the only part that scrolls */}
              <div className="lg:-m-1 lg:min-h-0 lg:overflow-y-auto lg:p-1 lg:pr-2">
                {livingLoading ? (
                  <div className="flex gap-3 overflow-hidden lg:flex-col" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="flex w-[78vw] max-w-[320px] shrink-0 items-center gap-3 rounded-[20px] border border-lv-line bg-lv-surface p-2.5 lg:w-auto lg:max-w-none">
                        <div className="h-20 w-24 shrink-0 animate-pulse rounded-xl bg-lv-line" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3.5 w-4/5 animate-pulse rounded-full bg-lv-line" />
                          <div className="h-3 w-2/5 animate-pulse rounded-full bg-lv-line" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : livingAll ? (
                  <LivingRoomLayoutGrid
                    layouts={livingAll.layouts}
                    selectedType={selectedLayoutType}
                    onSelectType={setSelectedLayoutType}
                  />
                ) : null}
              </div>

              {/* The chosen layout */}
              {livingLoading ? (
                <div className={statusCardCls} role="status">
                  <Loader2 className="h-8 w-8 animate-spin text-lv-accent" aria-hidden="true" />
                  <p className="mt-5 text-xl leading-tight text-lv-ink">Generating {roomLabel.toLowerCase()} layouts</p>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-lv-muted">
                    Every arrangement the walls allow is tried and checked against the rules. This takes about a second.
                  </p>
                </div>
              ) : livingError ? (
                <div className={statusCardCls} role="alert">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-red-500/10">
                    <AlertCircle className="h-7 w-7 text-red-400" aria-hidden="true" />
                  </span>
                  <p className="mt-5 text-xl leading-tight text-lv-ink">The layouts could not be generated</p>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-lv-muted">{livingError}</p>
                  <button type="button" onClick={() => setLivingRetry((n) => n + 1)} className="lv-btn mt-6">
                    <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
                  </button>
                </div>
              ) : livingAll && selectedLayoutEntry ? (
                <LivingRoomPlan
                  key={selectedLayoutType}
                  data={{
                    roomId: livingAll.roomId,
                    scaleSource: livingAll.scaleSource,
                    doorsUsed: livingAll.doorsUsed,
                    windowsUsed: livingAll.windowsUsed,
                    notes: livingAll.notes,
                    layout: selectedLayoutEntry,
                  }}
                  footer={actions}
                />
              ) : (
                <div className={statusCardCls}>
                  <p className="text-xl leading-tight text-lv-ink">No layout fits this room</p>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-lv-muted">
                    None of the arrangements could be completed. Try a different option above, or go back and pick another room.
                  </p>
                  <button type="button" onClick={() => navigate("/select-room", { state: navState })} className="lv-btn-quiet mt-6">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to rooms
                  </button>
                </div>
              )}
            </div>

            <div className="sticky bottom-3 z-10 mt-4 flex items-center justify-between gap-3 rounded-[24px] border border-lv-line bg-lv-surface p-3 shadow-xl lg:hidden">
              {actions}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // No layout to show: the page was opened without an analysed floor plan, or the
  // chosen room is of a type that has no layout engine yet.
  const hasPlan = !!navState?.detection;
  return (
    <div className="min-h-screen w-full bg-background relative isolate">
      <PageGlows />
      <AppNavbar />
      <main className="relative px-4 md:px-8 pt-3 md:pt-4 pb-8 md:pb-10 max-w-3xl mx-auto">
        <div className="mx-auto w-full max-w-2xl">
          <FlowStepper current="layout" />
        </div>
        <div className="mt-8 flex flex-col items-center rounded-[28px] border border-lv-line bg-lv-surface px-6 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-lv-muted" aria-hidden="true" />
          <h1 className="mt-5 text-2xl leading-tight text-lv-ink md:text-3xl">
            {hasPlan ? `No layouts for ${navState?.room?.name ?? "this room"} yet` : "No floor plan selected"}
          </h1>
          <p className="mt-3 max-w-md text-base leading-relaxed text-lv-muted">
            {hasPlan
              ? "Layouts are generated for living rooms, bedrooms, master bedrooms, kitchens, dining areas and bathrooms. Pick one of those rooms."
              : "Upload a floor plan, or open one from your dashboard, to see furniture layouts for its rooms."}
          </p>
          {hasPlan ? (
            <button type="button" onClick={() => navigate("/select-room", { state: navState })} className="lv-btn mt-7">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to rooms
            </button>
          ) : (
            <button type="button" onClick={() => navigate("/upload")} className="lv-btn mt-7">
              Upload a floor plan <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
