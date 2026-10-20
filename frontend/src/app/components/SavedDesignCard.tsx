import { useState } from "react";
import { ArrowRight, Box, Loader2, Trash2 } from "lucide-react";
import type { SavedDesign } from "../lib/savedDesign";
import { formatDesignDate } from "./DesignCard";

/** A furnished room the user saved from the 3D view: its preview, layout and score. */
export default function SavedDesignCard({
  design,
  onOpen,
  onDelete,
  planUrl,
  featured = false,
}: {
  featured?: boolean;
  design: SavedDesign;
  onOpen: (design: SavedDesign) => void;
  onDelete: (design: SavedDesign) => Promise<void>;
  /** The 2D floor plan this room came from, shown beside the 3D view. */
  planUrl?: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [planFailed, setPlanFailed] = useState(false);
  const showPlan = !!planUrl && !planFailed;
  const [deleting, setDeleting] = useState(false);
  const date = formatDesignDate(design.updatedAt);
  const area = design.layout?.room?.area_m2;
  const pieces = design.layout?.furniture?.length;
  const facts: { label: string; value: string }[] = [];
  if (typeof area === "number") facts.push({ label: "Room size", value: `${area.toFixed(1)} m²` });
  if (typeof pieces === "number") facts.push({ label: pieces === 1 ? "Furniture piece" : "Furniture pieces", value: String(pieces) });
  if (featured && design.score !== null) facts.push({ label: "Layout score", value: `${design.score}/100` });

  const remove = async () => {
    if (deleting || !window.confirm(`Remove the saved design for ${design.roomName}?`)) return;
    setDeleting(true);
    try {
      await onDelete(design);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className={`group relative overflow-hidden rounded-[24px] border border-lv-line bg-lv-surface transition-colors hover:border-lv-accent/50 ${
      featured ? "md:grid md:grid-cols-[1.15fr_1fr]" : "flex flex-col"
    }`}>
      <div className={`relative bg-lv-wash ${featured ? "aspect-[4/3] md:aspect-auto md:min-h-[300px]" : "aspect-[4/3]"} ${showPlan ? "grid grid-cols-2 gap-3 p-3" : ""}`}>
        {showPlan && (
          <div className="relative overflow-hidden rounded-2xl bg-white">
            <img
              src={planUrl}
              alt={`2D floor plan for ${design.roomName}`}
              loading="lazy"
              onError={() => setPlanFailed(true)}
              className="absolute inset-0 h-full w-full object-contain p-2"
            />
            <span className="absolute bottom-2 left-2 rounded-full bg-lv-ink/80 px-2 py-0.5 text-[10px] font-medium text-lv-on-ink">2D</span>
          </div>
        )}
        <div className={`relative ${showPlan ? "overflow-hidden rounded-2xl bg-lv-wash" : ""}`}>
          {design.previewUrl && !imageFailed ? (
            <img
              src={design.previewUrl}
              alt={`3D view of ${design.roomName}`}
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-lv-muted">
              <Box className="h-8 w-8" aria-hidden="true" />
            </div>
          )}
          {showPlan && (
            <span className="absolute bottom-2 left-2 rounded-full bg-lv-ink/80 px-2 py-0.5 text-[10px] font-medium text-lv-on-ink">3D</span>
          )}
        </div>
        {design.score !== null && (
          <span className="lv-on-photo absolute top-3 right-3 rounded-full bg-lv-ink px-3 py-1 text-xs font-semibold tabular-nums text-lv-on-ink">
            {design.score}/100
          </span>
        )}
      </div>

      <div className={`flex flex-1 flex-col ${featured ? "p-6 md:p-8" : "p-5"}`}>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-lv-muted">
          <span className="rounded-full bg-lv-wash px-2.5 py-1 font-medium text-lv-ink">Saved in 3D</span>
          {date && <time dateTime={design.updatedAt}>{date}</time>}
        </p>
        <h3 className={`mt-3 leading-tight text-lv-ink ${featured ? "text-2xl md:text-3xl" : "text-lg"}`}>{design.roomName}</h3>
        {design.title && <p className="mt-1 text-sm text-lv-muted">{design.title}</p>}
        {facts.length > 0 && (
          <dl className={`mt-5 grid gap-2 ${featured ? "grid-cols-3" : "grid-cols-2"}`}>
            {facts.map((fact) => (
              <div key={fact.label} className="rounded-2xl bg-lv-wash px-3 py-2.5">
                <dd className="text-base font-medium tabular-nums text-lv-ink">{fact.value}</dd>
                <dt className="text-xs text-lv-muted">{fact.label}</dt>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-5">
          <button type="button" onClick={() => onOpen(design)} className="lv-btn-quiet">
            Open in 3D
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={deleting}
            aria-label={`Remove the saved design for ${design.roomName}`}
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-lv-muted transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </article>
  );
}
