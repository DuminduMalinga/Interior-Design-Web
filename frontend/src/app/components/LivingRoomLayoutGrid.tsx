import { useState } from "react";
import { CheckCircle2, Star, AlertTriangle, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { isLayoutError, type LayoutOrError } from "../lib/livingRoomLayout";
import RoomSvg, { scoreTone } from "./RoomSvg";

const COMPONENT_LABELS: Record<string, string> = {
  circulation: "Circulation",
  relationships: "Relationships",
  wall_alignment: "Wall alignment",
  window_access: "Window access",
  door_access: "Door access",
  symmetry: "Symmetry",
  usability: "Usability",
  completeness: "Completeness",
  layout_specific: "Layout-specific",
};

function ScoreBreakdown({ components }: { components: Record<string, number> }) {
  const entries = Object.entries(components).filter(([, v]) => v !== 0);
  if (entries.length === 0) return <p className="text-xs text-zinc-600 px-1">No scoring components.</p>;
  return (
    <div className="space-y-1.5 px-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">{COMPONENT_LABELS[key] ?? key}</span>
          <span className={value >= 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
            {value >= 0 ? "+" : ""}
            {value.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LayoutCard({
  entry,
  isRecommended,
  selected,
  showBreakdown,
  onSelect,
  onToggleBreakdown,
}: {
  entry: LayoutOrError;
  isRecommended: boolean;
  selected: boolean;
  showBreakdown: boolean;
  onSelect: () => void;
  onToggleBreakdown: () => void;
}) {
  if (isLayoutError(entry)) {
    return (
      <div className="rounded-2xl border-2 border-red-500/20 bg-red-500/[0.03] p-4 opacity-70">
        <div className="w-full rounded-lg bg-black/20 flex items-center justify-center" style={{ height: 140 }}>
          <AlertTriangle className="w-8 h-8 text-red-400/60" />
        </div>
        <h3 className="font-bold text-zinc-300 text-sm mt-3">{entry.layout.title}</h3>
        <p className="text-xs text-red-400/80 mt-1 leading-snug">Could not generate: {entry.error}</p>
      </div>
    );
  }

  const valid = entry.validation.valid;
  const missing = entry.unplaced_furniture.filter((f) => f.required);
  const summary = entry.reason[0] ?? "";

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.015 }}
      whileTap={{ scale: 0.99 }}
      layout
      onClick={onSelect}
      className={`relative rounded-2xl border-2 bg-white/[0.02] transition-all duration-300 overflow-hidden cursor-pointer ${
        selected
          ? "border-teal-400 shadow-xl shadow-teal-500/10 ring-2 ring-teal-400/30 ring-offset-1 ring-offset-[#0a0a0f]"
          : "border-white/10 hover:border-white/20 hover:bg-white/[0.04]"
      }`}
    >
      {isRecommended && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-gradient-to-r from-amber-400 to-yellow-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-md">
          <Star className="w-3 h-3" /> Recommended
        </div>
      )}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
            className="absolute top-3 right-3 z-10 bg-gradient-to-br from-teal-400 to-teal-600 text-white rounded-full w-7 h-7 flex items-center justify-center shadow-lg">
            <CheckCircle2 className="w-4 h-4" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-4">
        <div className={`w-full rounded-lg overflow-hidden border ${selected ? "border-teal-400/40" : "border-white/5"}`} style={{ height: 140 }}>
          <RoomSvg layout={entry} compact />
        </div>

        <div className="mt-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-bold text-zinc-100 text-sm truncate">{entry.layout.title}</h3>
              <p className="text-xs text-zinc-500 mt-0.5 leading-snug line-clamp-2">{summary}</p>
            </div>
            <div className={`shrink-0 text-lg font-extrabold ${scoreTone(entry.layout.score)}`}>
              {Math.round(entry.layout.score)}
              <span className="text-[10px] text-zinc-600 font-medium ml-0.5">pts</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              valid ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
            }`}>
              {valid ? "Valid" : "Compromised"}
            </span>
            {missing.length > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                {missing.length} unplaced
              </span>
            )}
            <span className="text-[10px] text-zinc-600 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
              suitability {Math.round(entry.layout.suitability_score)}
            </span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleBreakdown();
            }}
            className={`w-full flex items-center justify-between text-[11px] font-semibold px-3 py-2 rounded-lg transition-colors ${
              selected ? "bg-teal-500/10 text-teal-300 hover:bg-teal-500/20" : "bg-white/5 text-zinc-400 hover:bg-white/10"
            }`}
          >
            <span>Score Breakdown</span>
            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${showBreakdown ? "rotate-90" : ""}`} />
          </button>

          <AnimatePresence>
            {showBreakdown && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                <div className="rounded-xl p-3 mt-1 border border-white/10 bg-white/[0.03]" onClick={(e) => e.stopPropagation()}>
                  <ScoreBreakdown components={entry.scoring.components} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
              selected
                ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md shadow-teal-500/20"
                : "bg-white/5 text-zinc-300 hover:bg-teal-500/10 hover:text-teal-300"
            }`}
          >
            {selected ? "Selected ✓" : "View This Layout"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function LivingRoomLayoutGrid({
  layouts,
  bestLayout,
  selectedType,
  onSelectType,
}: {
  layouts: LayoutOrError[];
  bestLayout: string | null;
  selectedType: string | null;
  onSelectType: (type: string) => void;
}) {
  const [openBreakdown, setOpenBreakdown] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {layouts.map((entry, i) => {
        const type = entry.layout.type;
        return (
          <motion.div key={type} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <LayoutCard
              entry={entry}
              isRecommended={type === bestLayout}
              selected={type === selectedType}
              showBreakdown={openBreakdown === type}
              onSelect={() => !isLayoutError(entry) && onSelectType(type)}
              onToggleBreakdown={() => setOpenBreakdown((prev) => (prev === type ? null : type))}
            />
          </motion.div>
        );
      })}
    </div>
  );
}
