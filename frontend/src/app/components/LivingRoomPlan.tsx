import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { GenerateLivingRoomLayoutResponse, LayoutFurnitureItem } from "../lib/livingRoomLayout";
import type { BedroomRuleResult } from "../lib/bedroomLayout";
import RoomSvg, { DEFAULT_FURNITURE_COLOR, FURNITURE_COLORS, fmtMm } from "./RoomSvg";
import { COMPONENT_LABELS } from "./layoutLabels";

type Tab = "why" | "rules" | "details";
const TABS: { id: Tab; label: string }[] = [
  { id: "rules", label: "Rules" },
  { id: "why", label: "Why" },
  { id: "details", label: "Details" },
];

const RULE_TONE: Record<BedroomRuleResult["status"], string> = {
  satisfied: "bg-emerald-400",
  partly_satisfied: "bg-amber-400",
  not_satisfied: "bg-red-400",
  not_applicable: "bg-lv-line",
};

const RULE_STATUS: Record<BedroomRuleResult["status"], string> = {
  satisfied: "Met",
  partly_satisfied: "Partly met",
  not_satisfied: "Not met",
  not_applicable: "Does not apply",
};

const titleCase = (value: string) => value.replace(/_/g, " ");

/** "10" for a whole number, otherwise one decimal ("9.5"). */
const fmtTenth = (n: number) => {
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/**
 * Each rule's points out of its default weight - the max_points the engine
 * reports - heaviest first. A rule that does not apply reads "n/a" and leaves
 * the others' weights as they are; the total is the points earned out of the
 * points the applicable rules could give, as a percentage. Both are shown to
 * one decimal, so full marks read as full ("8.0 / 8.0"). The arrow opens the
 * measurements behind the rule.
 */
function RuleList({ rules }: { rules: BedroomRuleResult[] }) {
  const ordered = useMemo(() => [...rules].sort((a, b) => b.max_points - a.max_points), [rules]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <ol className="divide-y divide-lv-line">
      {ordered.map((r) => {
        const expanded = open.has(r.id);
        const applies = r.status !== "not_applicable";
        return (
          <li key={r.id} className="flex gap-3 py-2.5 first:pt-0">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${RULE_TONE[r.status]}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-lv-ink">
                  {r.title}
                  <span className="sr-only">. {RULE_STATUS[r.status]}</span>
                </p>
                <p className="shrink-0 text-xs tabular-nums text-lv-muted">
                  {applies ? <><span className="font-medium text-lv-ink">{fmtTenth(r.points)}</span> / {fmtTenth(r.max_points)}</> : "n/a"}
                </p>
                {r.detail && (
                  <button type="button" onClick={() => toggle(r.id)} aria-expanded={expanded} aria-controls={`rule-detail-${r.id}`}
                    aria-label={`${expanded ? "Hide" : "Show"} details for ${r.title}`} title={expanded ? "Hide details" : "Show details"}
                    className="-my-1 grid h-7 w-7 shrink-0 cursor-pointer place-items-center self-center rounded-full text-lv-accent transition-colors hover:bg-lv-ink/8 hover:text-lv-ink">
                    <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                )}
              </div>
              {expanded && (
                <p id={`rule-detail-${r.id}`} className="mt-1 text-xs leading-relaxed text-lv-muted">{r.detail}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** For engines that report score components and not rule-by-rule results. */
function ComponentList({ components }: { components: Record<string, number> }) {
  const entries = Object.entries(components).filter(([, v]) => v !== 0);
  if (entries.length === 0) return <p className="text-sm text-lv-muted">This layout has no score breakdown.</p>;
  return (
    <ul className="space-y-2">
      {entries.map(([key, value]) => (
        <li key={key} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-lv-ink">{(COMPONENT_LABELS[key] ?? titleCase(key)).replace(/^\d+\s·\s/, "")}</span>
          <span className={`shrink-0 tabular-nums font-medium ${value >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {value >= 0 ? "+" : ""}
            {value.toFixed(1)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FurnitureDetail({ item }: { item: LayoutFurnitureItem }) {
  const color = FURNITURE_COLORS[item.type] ?? DEFAULT_FURNITURE_COLOR;
  const facts = [
    { label: "Size", value: `${fmtMm(item.width)} × ${fmtMm(item.depth)}` },
    { label: "Height", value: fmtMm(item.height) },
    { label: "Facing", value: item.facing },
    { label: "Placed by", value: item.placement_strategy || "Not recorded" },
  ];
  return (
    <div>
      <h3 className="flex items-center gap-2.5 text-lg capitalize leading-tight text-lv-ink">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color.stroke }} aria-hidden="true" />
        {titleCase(item.role || item.type)}
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

/**
 * The chosen layout: the plan (furniture is clickable) at the card's full
 * height, and beside it the score and tabs for the rule-by-rule report, the
 * reasoning and the remaining details. `footer` (the primary action) sits at the
 * foot of that side panel from lg up.
 */
export default function LivingRoomPlan({ data, footer }: { data: GenerateLivingRoomLayoutResponse; footer?: ReactNode }) {
  const { layout } = data;
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<Tab>("rules");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedItem = useMemo(
    () => layout.furniture.find((f) => f.id === selectedId) ?? null,
    [layout.furniture, selectedId],
  );

  const circulation = layout.validation.circulation;
  const missingRequired = layout.unplaced_furniture.filter((f) => f.required);
  const rules = Array.isArray(layout.rules) ? (layout.rules as BedroomRuleResult[]) : null;
  // the total is a percentage of the points the applicable rules could give
  const score = { value: Math.round(layout.layout.score), unit: rules ? "%" : "pts" };
  const roomFacts = [
    { label: "Size", value: `${(layout.room.width / 1000).toFixed(2)} × ${(layout.room.length / 1000).toFixed(2)} m` },
    { label: "Area", value: `${layout.room.area_m2} m²` },
  ];
  const details = [
    ...(circulation
      ? [
          { label: "Widest walking path", value: fmtMm(circulation.corridor_width_mm) },
          { label: "Floor reachable from the entrance", value: `${Math.round(circulation.walkable_reached_ratio * 100)}%` },
        ]
      : []),
    { label: "Suitability for this room", value: `${Math.round(layout.layout.suitability_score)}` },
    { label: "Pieces placed", value: `${layout.furniture.length}` },
  ];

  return (
    <section aria-label="Selected layout" className="flex flex-col rounded-[28px] border border-lv-line bg-lv-surface lg:min-h-0 lg:overflow-hidden">
      <h2 className="sr-only">{layout.layout.title}</h2>

      <div className="grid flex-1 gap-5 p-5 lg:min-h-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)] lg:overflow-hidden xl:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
        {/* Plan */}
        <div className="flex flex-col lg:min-h-0">
          <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-lv-line bg-[var(--lv-plan-floor)] lg:aspect-auto lg:min-h-0 lg:flex-1">
            <RoomSvg layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <ul className="mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1.5 text-xs text-lv-muted">
            <li className="flex items-center gap-1.5"><span className="inline-block h-1 w-3 rounded-sm bg-[var(--lv-plan-wall)]" /> Wall</li>
            <li className="flex items-center gap-1.5"><span className="inline-block h-1 w-3 rounded-sm bg-sky-400" /> Window</li>
            <li className="flex items-center gap-1.5"><span className="inline-block h-1 w-3 rounded-sm bg-lv-accent" /> Door</li>
          </ul>
        </div>

        {/* Reasoning */}
        <div className="flex flex-col lg:min-h-0">
          <div className="mb-4 flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <dl className="contents">
              {roomFacts.map((f) => (
                <div key={f.label} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-lv-line bg-lv-surface px-2.5 text-xs">
                  <dt className="text-[10px] uppercase tracking-wider text-lv-muted">{f.label}</dt>
                  <dd className="font-medium tabular-nums text-lv-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
            <p className="ml-auto flex shrink-0 items-baseline gap-1 pl-2 text-lv-ink">
              <span className="text-2xl font-medium leading-none tabular-nums">{score.value}</span>
              <span className="text-xs text-lv-muted">{score.unit}</span>
            </p>
          </div>

          {selectedItem ? (
            <button type="button" onClick={() => setSelectedId(null)}
              className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 self-start rounded-full text-sm text-lv-muted transition-colors hover:text-lv-ink">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the layout
            </button>
          ) : (
            <div role="tablist" aria-label="Layout information" className="flex shrink-0 gap-1 self-start rounded-full border border-lv-line p-1">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" id={`layout-tab-${t.id}`} aria-selected={tab === t.id}
                  aria-controls="layout-tabpanel" onClick={() => setTab(t.id)}
                  className={`relative h-9 cursor-pointer rounded-full px-4 text-sm transition-colors ${
                    tab === t.id ? "text-lv-on-ink" : "text-lv-ink hover:bg-lv-ink/8"
                  }`}>
                  {tab === t.id && (
                    <motion.span
                      layoutId="layout-tab-pill"
                      className="absolute inset-0 rounded-full bg-lv-ink"
                      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 34 }}
                    />
                  )}
                  <span className="relative">{t.label}</span>
                </button>
              ))}
            </div>
          )}

          <div id="layout-tabpanel" role={selectedItem ? undefined : "tabpanel"}
            aria-labelledby={selectedItem ? undefined : `layout-tab-${tab}`}
            className="mt-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
            {selectedItem ? (
              <FurnitureDetail item={selectedItem} />
            ) : tab === "why" ? (
              <>
                <ul className="space-y-3">
                  {layout.reason.map((reason, i) => (
                    <li key={i} className="text-sm leading-relaxed text-lv-ink">{reason}</li>
                  ))}
                </ul>
                {missingRequired.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-amber-400">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Could not be placed
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {missingRequired.map((f, i) => (
                        <li key={i} className="text-sm leading-relaxed text-amber-300">
                          <span className="capitalize">{titleCase(f.role || f.type)}</span>
                          {f.reasons[0] ? `: ${f.reasons[0]}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : tab === "rules" ? (
              rules ? <RuleList rules={rules} /> : <ComponentList components={layout.scoring.components} />
            ) : (
              <>
                <dl className="space-y-2.5">
                  {details.map((d) => (
                    <div key={d.label} className="flex items-baseline justify-between gap-3 text-sm">
                      <dt className="text-lv-muted">{d.label}</dt>
                      <dd className="shrink-0 font-medium tabular-nums text-lv-ink">{d.value}</dd>
                    </div>
                  ))}
                </dl>
                {layout.explanation.length > 0 && (
                  <>
                    <p className="mt-6 text-xs text-lv-muted">Full explanation</p>
                    <ul className="mt-2 space-y-2">
                      {layout.explanation.map((line, i) => (
                        <li key={i} className="text-sm leading-relaxed text-lv-ink">{line}</li>
                      ))}
                    </ul>
                  </>
                )}
                {data.notes.length > 0 && (
                  <>
                    <p className="mt-6 text-xs text-lv-muted">Detection notes</p>
                    <ul className="mt-2 space-y-2">
                      {data.notes.map((line, i) => (
                        <li key={i} className="text-sm leading-relaxed text-lv-muted">{line}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>

          {footer && <div className="mt-4 hidden shrink-0 lg:block">{footer}</div>}
        </div>
      </div>
    </section>
  );
}
