import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { GenerateLivingRoomLayoutResponse, LayoutFurnitureItem } from "../lib/livingRoomLayout";
import type { BedroomRuleResult } from "../lib/bedroomLayout";
import RoomSvg, { DEFAULT_FURNITURE_COLOR, FURNITURE_COLORS, fmtMm } from "./RoomSvg";
import { COMPONENT_LABELS } from "./layoutLabels";

type Tab = "why" | "rules" | "details";
const TABS: { id: Tab; label: string }[] = [
  { id: "why", label: "Why" },
  { id: "rules", label: "Rules" },
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

/** "99 / 100" when the engine's rule maximums add up to a round total, otherwise "99 pts". */
function scoreParts(score: number, rules: BedroomRuleResult[] | null): { value: number; unit: string } {
  const max = rules ? Math.round(rules.reduce((sum, r) => sum + (r.status === "not_applicable" ? 0 : r.max_points), 0)) : 0;
  return { value: Math.round(score), unit: max === 100 ? "/ 100" : "pts" };
}

function RuleList({ rules }: { rules: BedroomRuleResult[] }) {
  return (
    <ol className="space-y-3">
      {rules.map((r) => (
        <li key={r.id} className="flex gap-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${RULE_TONE[r.status]}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium leading-snug text-lv-ink">{r.title}</p>
              <p className="shrink-0 text-xs tabular-nums text-lv-muted">
                {r.status === "not_applicable" ? "n/a" : `${r.points.toFixed(1)} / ${r.max_points.toFixed(0)}`}
              </p>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-lv-muted">
              <span className="sr-only">{RULE_STATUS[r.status]}. </span>
              {r.detail}
            </p>
          </div>
        </li>
      ))}
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
 * The chosen layout: title and score, the plan (furniture is clickable), and
 * tabs for the reasoning, the rule-by-rule report and the remaining details.
 * `footer` (the primary action) sits inline in the header from lg up, next to
 * the score — freeing the card's full height for the plan below.
 */
export default function LivingRoomPlan({ data, footer }: { data: GenerateLivingRoomLayoutResponse; footer?: ReactNode }) {
  const { layout } = data;
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<Tab>("why");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedItem = useMemo(
    () => layout.furniture.find((f) => f.id === selectedId) ?? null,
    [layout.furniture, selectedId],
  );

  const circulation = layout.validation.circulation;
  const missingRequired = layout.unplaced_furniture.filter((f) => f.required);
  const rules = Array.isArray(layout.rules) ? (layout.rules as BedroomRuleResult[]) : null;
  const score = scoreParts(layout.layout.score, rules);
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
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="text-xl leading-tight text-lv-ink md:text-2xl">{layout.layout.title}</h2>
          <p className="mt-1 text-sm text-lv-muted">
            {(layout.room.width / 1000).toFixed(2)} × {(layout.room.length / 1000).toFixed(2)} m, {layout.room.area_m2} m²
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {layout.validation.valid ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400">
              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> Valid layout
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Compromised
            </span>
          )}
          <p className="flex items-baseline gap-1 text-lv-ink">
            <span className="text-3xl font-medium leading-none tabular-nums">{score.value}</span>
            <span className="text-sm text-lv-muted">{score.unit}</span>
          </p>
          {footer && <span className="hidden lg:ml-6 lg:block">{footer}</span>}
        </div>
      </header>

      <div className="grid flex-1 gap-5 p-5 lg:min-h-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,1fr)] lg:overflow-hidden xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,1fr)]">
        {/* Plan */}
        <div className="flex flex-col lg:min-h-0">
          <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-lv-line bg-[var(--lv-plan-floor)] lg:aspect-auto lg:min-h-0 lg:flex-1">
            <RoomSvg layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <ul className="mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1.5 text-xs text-lv-muted">
            <li className="flex items-center gap-1.5"><span className="inline-block h-1 w-3 rounded-sm bg-[var(--lv-plan-wall)]" /> Wall</li>
            <li className="flex items-center gap-1.5"><span className="inline-block h-1 w-3 rounded-sm bg-sky-400" /> Window</li>
            <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" /> Main entrance</li>
            <li>Click a piece of furniture for its details.</li>
          </ul>
        </div>

        {/* Reasoning */}
        <div className="flex flex-col lg:min-h-0">
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
        </div>
      </div>
    </section>
  );
}
