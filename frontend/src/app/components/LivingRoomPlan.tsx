import { useMemo, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  Footprints,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { GenerateLivingRoomLayoutResponse, LayoutFurnitureItem } from "../lib/livingRoomLayout";
import RoomSvg, { DEFAULT_FURNITURE_COLOR, FURNITURE_COLORS, fmtMm, scoreTone } from "./RoomSvg";

// ─────────────────────────────────────────────
// Furniture detail (explainability) panel
// ─────────────────────────────────────────────
function FurnitureDetail({ item }: { item: LayoutFurnitureItem }) {
  const color = FURNITURE_COLORS[item.type] ?? DEFAULT_FURNITURE_COLOR;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color.stroke }} />
        <h4 className="font-bold text-zinc-100 text-sm capitalize">{(item.role || item.type).replace(/_/g, " ")}</h4>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400 mb-3">
        <span>Size: <span className="text-zinc-200 font-medium">{fmtMm(item.width)} × {fmtMm(item.depth)}</span></span>
        <span>Facing: <span className="text-zinc-200 font-medium capitalize">{item.facing}</span></span>
        <span>Height: <span className="text-zinc-200 font-medium">{fmtMm(item.height)}</span></span>
        <span>Strategy: <span className="text-zinc-200 font-medium">{item.placement_strategy || "—"}</span></span>
      </div>
      {item.reasons.length > 0 && (
        <ul className="space-y-1.5">
          {item.reasons.map((r, i) => (
            <li key={i} className="flex gap-1.5 text-xs text-zinc-400">
              <span className="text-teal-400 mt-0.5">•</span> {r}
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// Collapsible list (explanation / reason)
// ─────────────────────────────────────────────
function CollapsibleList({ title, icon, items, defaultOpen = false }: {
  title: string; icon: React.ReactNode; items: string[]; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <button onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-200">
        <span className="flex items-center gap-2">{icon} {title}</span>
        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <ul className="px-4 pb-4 space-y-1.5">
              {items.map((line, i) => (
                <li key={i} className="text-xs text-zinc-400 leading-relaxed">{line}</li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export default function LivingRoomPlan({ data }: { data: GenerateLivingRoomLayoutResponse }) {
  const { layout } = data;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedItem = useMemo(
    () => layout.furniture.find((f) => f.id === selectedId) ?? null,
    [layout.furniture, selectedId],
  );

  const circulation = layout.validation.circulation;
  const missingRequired = layout.unplaced_furniture.filter((f) => f.required);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Plan */}
      <div className="lg:col-span-2 glass-card rounded-3xl border border-white/5 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">Structure &amp; Layout</p>
            <h3 className="text-xl font-bold text-white">{layout.layout.title}</h3>
            <p className="text-xs text-zinc-500 mt-1">
              {(layout.room.width / 1000).toFixed(2)}m × {(layout.room.length / 1000).toFixed(2)}m · {layout.room.area_m2} m²
            </p>
          </div>
          <div className="flex items-center gap-2">
            {layout.validation.valid ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" /> Valid layout
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <AlertTriangle className="w-3.5 h-3.5" /> Compromised
              </span>
            )}
            <span className={`px-3 py-1.5 rounded-full text-xs font-bold bg-white/5 border border-white/10 ${scoreTone(layout.layout.score)}`}>
              {layout.layout.score} pts
            </span>
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden border border-white/10">
          <RoomSvg layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-4 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-zinc-500 inline-block rounded-sm" /> Wall</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-sky-400 inline-block rounded-sm" /> Window</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> Main entrance</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-teal-500/60 border border-teal-400 inline-block" /> Furniture (click for details)</span>
        </div>

        {selectedItem && (
          <div className="mt-4">
            <FurnitureDetail item={selectedItem} />
          </div>
        )}
      </div>

      {/* Side panel */}
      <div className="lg:col-span-1 flex flex-col gap-4">
        <div className="glass-card rounded-2xl border border-white/5 p-5">
          <h4 className="text-sm font-bold text-zinc-300 mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-teal-400" /> Why this layout
          </h4>
          <ul className="space-y-1.5">
            {layout.reason.slice(0, 4).map((r, i) => (
              <li key={i} className="text-xs text-zinc-400 leading-relaxed flex gap-1.5">
                <span className="text-teal-400 mt-0.5">•</span> {r}
              </li>
            ))}
          </ul>
        </div>

        {circulation && (
          <div className="glass-card rounded-2xl border border-white/5 p-5">
            <h4 className="text-sm font-bold text-zinc-300 mb-3 flex items-center gap-2">
              <Footprints className="w-4 h-4 text-teal-400" /> Circulation
            </h4>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-zinc-500">Widest walking path</span>
              <span className="text-zinc-200 font-semibold">{fmtMm(circulation.corridor_width_mm)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Reachable from entrance</span>
              <span className="text-zinc-200 font-semibold">{Math.round(circulation.walkable_reached_ratio * 100)}%</span>
            </div>
          </div>
        )}

        {missingRequired.length > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
            <h4 className="text-sm font-bold text-amber-400 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Could not place
            </h4>
            <ul className="space-y-1">
              {missingRequired.map((f, i) => (
                <li key={i} className="text-xs text-amber-300/80">
                  {(f.role || f.type).replace(/_/g, " ")}
                  {f.reasons[0] ? ` — ${f.reasons[0]}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <CollapsibleList
          title="Full explanation"
          icon={<Info className="w-4 h-4 text-teal-400" />}
          items={layout.explanation}
        />

        {data.notes.length > 0 && (
          <CollapsibleList
            title="Detection notes"
            icon={<Info className="w-4 h-4 text-zinc-500" />}
            items={data.notes}
          />
        )}
      </div>
    </div>
  );
}
