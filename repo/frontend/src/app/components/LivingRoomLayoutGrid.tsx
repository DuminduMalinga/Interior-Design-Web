import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { isLayoutError, type LayoutOrError } from "../lib/livingRoomLayout";
import RoomSvg from "./RoomSvg";

/** One layout in the list: thumbnail, title, score and anything worth flagging. */
function LayoutRow({
  entry,
  selected,
  onSelect,
  rowRef,
}: {
  entry: LayoutOrError;
  selected: boolean;
  onSelect: () => void;
  rowRef: (el: HTMLButtonElement | null) => void;
}) {
  if (isLayoutError(entry)) {
    return (
      <div className="flex w-[78vw] max-w-[320px] shrink-0 items-center gap-3 rounded-[20px] border border-lv-line bg-lv-surface/60 p-2.5 lg:w-auto lg:max-w-none">
        <span className="grid h-20 w-24 shrink-0 place-items-center rounded-xl bg-red-500/10">
          <AlertTriangle className="h-6 w-6 text-red-400" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium leading-snug text-lv-ink line-clamp-2">{entry.layout.title}</span>
          <span className="mt-1 block text-xs leading-snug text-red-400 line-clamp-2">Could not be generated: {entry.error}</span>
        </span>
      </div>
    );
  }

  const missing = entry.unplaced_furniture.filter((f) => f.required).length;
  const compromised = !entry.validation.valid;

  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-[78vw] max-w-[320px] shrink-0 cursor-pointer items-center gap-3 rounded-[20px] border p-2.5 text-left transition-colors lg:w-auto lg:max-w-none ${
        selected ? "border-lv-accent bg-lv-wash/60 ring-1 ring-lv-accent/40" : "border-lv-line bg-lv-surface hover:border-lv-accent/50"
      }`}
    >
      <span className="block h-20 w-24 shrink-0 overflow-hidden rounded-xl border border-lv-line bg-[var(--lv-plan-floor)]">
        <RoomSvg layout={entry} compact />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug text-lv-ink line-clamp-2">{entry.layout.title}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {compromised && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">Compromised</span>
          )}
          {missing > 0 && (
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400">{missing} unplaced</span>
          )}
        </span>
      </span>

      <span className="shrink-0 pr-1 text-right">
        <span className="block text-2xl font-medium leading-none tabular-nums text-lv-ink">{Math.round(entry.layout.score)}</span>
        <span className="mt-1 block text-[11px] text-lv-muted">score</span>
      </span>
    </button>
  );
}

/**
 * The generated layouts, best first, as a list of rows. On small screens the
 * rows sit side by side and swipe; from lg up they stack and the parent scrolls.
 */
export default function LivingRoomLayoutGrid({
  layouts,
  selectedType,
  onSelectType,
}: {
  layouts: LayoutOrError[];
  selectedType: string | null;
  onSelectType: (type: string) => void;
}) {
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (selectedType) rowRefs.current[selectedType]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedType]);

  return (
    <div role="group" aria-label="Layouts" className="flex gap-3 overflow-x-auto pb-2 lg:flex-col lg:overflow-x-visible lg:pb-0">
      {layouts.map((entry) => {
        const type = entry.layout.type;
        return (
          <LayoutRow
            key={type}
            entry={entry}
            selected={type === selectedType}
            onSelect={() => onSelectType(type)}
            rowRef={(el) => { rowRefs.current[type] = el; }}
          />
        );
      })}
    </div>
  );
}
