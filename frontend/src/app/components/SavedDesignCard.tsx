import { useState } from "react";
import { ArrowRight, Box, Loader2, Trash2 } from "lucide-react";
import type { SavedDesign } from "../lib/savedDesign";
import { formatDesignDate } from "./DesignCard";

/** A furnished room the user saved from the 3D view: its preview, layout and score. */
export default function SavedDesignCard({
  design,
  onOpen,
  onDelete,
}: {
  design: SavedDesign;
  onOpen: (design: SavedDesign) => void;
  onDelete: (design: SavedDesign) => Promise<void>;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const date = formatDesignDate(design.updatedAt);

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
    <article className="group relative flex flex-col overflow-hidden rounded-[24px] border border-lv-line bg-lv-surface transition-colors hover:border-lv-accent/50">
      <div className="relative aspect-[4/3] bg-lv-wash">
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
        {design.score !== null && (
          <span className="lv-on-photo absolute top-3 right-3 rounded-full bg-lv-ink px-3 py-1 text-xs font-semibold tabular-nums text-lv-on-ink">
            {design.score}/100
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-lv-muted">
          <span className="rounded-full bg-lv-wash px-2.5 py-1 font-medium text-lv-ink">Saved in 3D</span>
          {date && <time dateTime={design.updatedAt}>{date}</time>}
        </p>
        <h3 className="mt-3 text-lg leading-tight text-lv-ink">{design.roomName}</h3>
        {design.title && <p className="mt-1 text-sm text-lv-muted">{design.title}</p>}

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
