import { useState } from "react";
import { ArrowRight, ImageOff } from "lucide-react";
import type { DesignStatus, UserDesign } from "../lib/useUserDesigns";

const STATUS_LABEL: Record<DesignStatus, string> = {
  Uploaded: "Uploaded",
  Detected: "Rooms detected",
  LayoutReady: "Layouts ready",
  LayoutSelected: "Layout chosen",
};

const NEXT_STEP: Record<DesignStatus, string> = {
  Uploaded: "Upload again to analyse",
  Detected: "Pick a room",
  LayoutReady: "Compare layouts",
  LayoutSelected: "Open layouts",
};

const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export function formatDesignDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

export function designTitle(design: UserDesign) {
  if (design.selectedRoom) return design.selectedRoom.name;
  if (design.roomCount > 0) return `Floor plan with ${design.roomCount} ${design.roomCount === 1 ? "room" : "rooms"}`;
  return "Floor plan";
}

/**
 * A saved floor plan: its image, where it is in the flow, and the chosen
 * layout's score when there is one. `featured` lays it out wide.
 */
export default function DesignCard({
  design,
  onOpen,
  featured = false,
}: {
  design: UserDesign;
  onOpen: (design: UserDesign) => void;
  featured?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const openable = design.detection !== null;
  const date = formatDesignDate(design.updatedAt);

  return (
    <article
      className={`group relative overflow-hidden rounded-[24px] bg-lv-surface border border-lv-line transition-colors hover:border-lv-accent/50 ${
        featured ? "md:grid md:grid-cols-[1.15fr_1fr]" : "flex flex-col"
      }`}
    >
      <div className={`relative bg-white ${featured ? "aspect-[4/3] md:aspect-auto md:min-h-[300px]" : "aspect-[4/3]"}`}>
        {design.imageUrl && !imageFailed ? (
          <img
            src={design.imageUrl}
            alt={`Floor plan for ${designTitle(design)}`}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 h-full w-full object-contain p-3"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-lv-wash text-lv-muted">
            <ImageOff className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
        {design.score !== null && (
          <span className="lv-on-photo absolute top-3 right-3 rounded-full bg-lv-ink px-3 py-1 text-xs font-semibold tabular-nums text-lv-on-ink">
            {design.score}/100
          </span>
        )}
      </div>

      <div className={`flex flex-1 flex-col ${featured ? "p-6 md:p-8 md:justify-between" : "p-5"}`}>
        <div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-lv-muted">
            <span className="rounded-full bg-lv-wash px-2.5 py-1 font-medium text-lv-ink">{STATUS_LABEL[design.status]}</span>
            {date && <time dateTime={design.updatedAt ?? undefined}>{date}</time>}
          </p>
          <h3 className={`mt-3 leading-tight text-lv-ink ${featured ? "text-2xl md:text-3xl" : "text-lg"}`}>
            {designTitle(design)}
          </h3>
          {design.layoutTitle && (
            <p className={`mt-1 text-lv-muted ${featured ? "text-base" : "text-sm"}`}>{design.layoutTitle}</p>
          )}
        </div>

        <div className={featured ? "mt-6" : "mt-auto pt-5"}>
          {openable ? (
            <button
              type="button"
              onClick={() => onOpen(design)}
              className={`${featured ? "lv-btn" : "lv-btn-quiet"} after:absolute after:inset-0 after:content-['']`}
            >
              {NEXT_STEP[design.status]}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          ) : (
            <p className="text-sm text-lv-muted">Analysis did not finish. {NEXT_STEP.Uploaded}.</p>
          )}
        </div>
      </div>
    </article>
  );
}
