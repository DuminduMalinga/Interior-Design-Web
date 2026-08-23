import { useState, useEffect, useRef, type ReactElement } from "react";
import {
  Box,
  LogOut,
  ArrowLeft,
  ArrowRight,
  Check,
  Star,
  Info,
  GitCompare,
  X,
  Loader2,
  AlertCircle,
  Maximize2,
  BedDouble,
  LayoutGrid,
  ChevronRight,
  RefreshCw,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface ScoreBreakdown {
  spaceUtilization: number;
  accessibility: number;
  ergonomics: number;
  nonOverlap: number;
}

interface FurnitureLayout {
  id: string;
  label: string;
  score: number;
  summary: string;
  breakdown: ScoreBreakdown;
  tags: string[];
}

type CompareSlot = "A" | "B";

// ─────────────────────────────────────────────
// Mock Data
// ─────────────────────────────────────────────
const MOCK_LAYOUTS: FurnitureLayout[] = [
  {
    id: "l1",
    label: "Layout A",
    score: 92,
    summary: "Bed against north wall with symmetric nightstands. Maximum floor clearance.",
    breakdown: { spaceUtilization: 94, accessibility: 91, ergonomics: 93, nonOverlap: 100 },
    tags: ["Recommended", "Max Clearance"],
  },
  {
    id: "l2",
    label: "Layout B",
    score: 85,
    summary: "Corner bed placement frees central space. Ideal for smaller rooms.",
    breakdown: { spaceUtilization: 86, accessibility: 82, ergonomics: 88, nonOverlap: 98 },
    tags: ["Corner Style"],
  },
  {
    id: "l3",
    label: "Layout C",
    score: 78,
    summary: "Desk-focused setup near window for natural light. Great for work-from-home.",
    breakdown: { spaceUtilization: 78, accessibility: 77, ergonomics: 80, nonOverlap: 96 },
    tags: ["Work-Friendly"],
  },
  {
    id: "l4",
    label: "Layout D",
    score: 71,
    summary: "Symmetrical layout with balanced furniture on both sides.",
    breakdown: { spaceUtilization: 72, accessibility: 70, ergonomics: 73, nonOverlap: 95 },
    tags: ["Symmetric"],
  },
  {
    id: "l5",
    label: "Layout E",
    score: 88,
    summary: "Wardrobe near entrance. Efficient traffic flow through the room.",
    breakdown: { spaceUtilization: 89, accessibility: 90, ergonomics: 87, nonOverlap: 99 },
    tags: ["Good Flow"],
  },
  {
    id: "l6",
    label: "Layout F",
    score: 62,
    summary: "Bed faces window directly. Maximizes natural light but reduces privacy.",
    breakdown: { spaceUtilization: 60, accessibility: 62, ergonomics: 65, nonOverlap: 90 },
    tags: ["Light-First"],
  },
];

const SELECTED_ROOM = { name: "Bedroom 1", type: "Bedroom", width: 14, height: 12 };

// ─────────────────────────────────────────────
// Score helpers
// ─────────────────────────────────────────────
function scoreColor(score: number): { ring: string; badge: string; text: string; bar: string; glow: string } {
  if (score >= 85)
    return {
      ring: "ring-green-400",
      badge: "bg-green-100 text-green-700 border-green-200",
      text: "text-green-700",
      bar: "from-green-400 to-emerald-500",
      glow: "shadow-green-100",
    };
  if (score >= 70)
    return {
      ring: "ring-yellow-400",
      badge: "bg-yellow-100 text-yellow-700 border-yellow-200",
      text: "text-yellow-600",
      bar: "from-yellow-400 to-amber-500",
      glow: "shadow-yellow-100",
    };
  return {
    ring: "ring-red-400",
    badge: "bg-red-100 text-red-700 border-red-200",
    text: "text-red-600",
    bar: "from-red-400 to-rose-500",
    glow: "shadow-red-100",
  };
}

function scoreLabel(score: number) {
  if (score >= 85) return "High";
  if (score >= 70) return "Medium";
  return "Low";
}

// ─────────────────────────────────────────────
// Step indicator
// ─────────────────────────────────────────────
const STEPS = [
  { label: "Upload", step: 1 },
  { label: "Detect", step: 2 },
  { label: "Select Room", step: 3 },
  { label: "View Layouts", step: 4 },
  { label: "3D View", step: 5 },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 flex-wrap select-none">
      {STEPS.map((s, i) => {
        const isDone = s.step < current;
        const isActive = s.step === current;
        return (
          <div key={s.step} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300 ${
                  isDone
                    ? "bg-gradient-to-br from-blue-600 to-indigo-700 border-indigo-700 text-white"
                    : isActive
                    ? "bg-white border-indigo-600 text-indigo-700 shadow-md shadow-indigo-200"
                    : "bg-white border-gray-300 text-gray-400"
                }`}
              >
                {isDone ? <Check className="w-4 h-4" /> : s.step}
              </div>
              <span
                className={`mt-1 text-[10px] font-medium whitespace-nowrap ${
                  isActive ? "text-indigo-700" : isDone ? "text-blue-600" : "text-gray-400"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-8 md:w-10 mb-4 mx-1 transition-all duration-500 ${
                  s.step < current ? "bg-gradient-to-r from-blue-600 to-indigo-700" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// SVG Furniture Thumbnails (top-view 2D plans)
// ─────────────────────────────────────────────
function LayoutThumbnail({ layoutId, selected }: { layoutId: string; selected: boolean }) {
  const stroke = selected ? "#6366f1" : "#94a3b8";
  const wallColor = selected ? "#6366f1" : "#64748b";
  const furniture = selected ? "#c7d2fe" : "#e2e8f0";
  const furnitureStroke = selected ? "#6366f1" : "#94a3b8";
  const accent = selected ? "#818cf8" : "#cbd5e1";

  const configs: Record<string, ReactElement> = {
    l1: (
      <>
        {/* Bed - north center */}
        <rect x="55" y="14" width="90" height="52" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="55" y="14" width="90" height="12" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="72" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        <circle cx="128" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        {/* Nightstand left */}
        <rect x="35" y="22" width="18" height="18" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="44" cy="31" r="3" fill={accent} opacity="0.6" />
        {/* Nightstand right */}
        <rect x="147" y="22" width="18" height="18" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="156" cy="31" r="3" fill={accent} opacity="0.6" />
        {/* Wardrobe - east wall */}
        <rect x="165" y="72" width="25" height="68" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <line x1="177" y1="72" x2="177" y2="140" stroke={furnitureStroke} strokeWidth="0.8" />
        <circle cx="174" cy="106" r="2" fill={furnitureStroke} />
        <circle cx="180" cy="106" r="2" fill={furnitureStroke} />
        {/* Desk - south-west */}
        <rect x="12" y="90" width="55" height="32" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="13" y="91" width="53" height="15" rx="1" fill={accent} opacity="0.5" />
        {/* Chair */}
        <rect x="25" y="125" width="22" height="18" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <rect x="27" y="123" width="18" height="5" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="0.8" />
      </>
    ),
    l2: (
      <>
        {/* Bed - top-left corner */}
        <rect x="12" y="14" width="85" height="52" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="12" y="14" width="85" height="12" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="28" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        <circle cx="80" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        {/* Nightstand */}
        <rect x="99" y="22" width="18" height="18" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="108" cy="31" r="3" fill={accent} opacity="0.6" />
        {/* Wardrobe - south wall */}
        <rect x="12" y="118" width="75" height="25" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <line x1="49" y1="118" x2="49" y2="143" stroke={furnitureStroke} strokeWidth="0.8" />
        <circle cx="46" cy="130" r="2" fill={furnitureStroke} />
        <circle cx="52" cy="130" r="2" fill={furnitureStroke} />
        {/* Desk - east wall */}
        <rect x="140" y="14" width="50" height="40" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="141" y="15" width="48" height="18" rx="1" fill={accent} opacity="0.5" />
        {/* Chair */}
        <rect x="148" y="57" width="22" height="18" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <rect x="150" y="55" width="18" height="5" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="0.8" />
        {/* Bookshelf */}
        <rect x="140" y="100" width="50" height="15" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={150 + i * 7} y1="100" x2={150 + i * 7} y2="115" stroke={furnitureStroke} strokeWidth="0.6" />
        ))}
        {/* Sofa / sitting area */}
        <rect x="120" y="118" width="70" height="25" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="121" y="119" width="68" height="10" rx="2" fill={accent} opacity="0.5" />
      </>
    ),
    l3: (
      <>
        {/* Bed - top-right */}
        <rect x="100" y="14" width="85" height="52" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="100" y="14" width="85" height="12" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="116" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        <circle cx="168" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        {/* Nightstand */}
        <rect x="80" y="22" width="18" height="18" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="89" cy="31" r="3" fill={accent} opacity="0.6" />
        {/* Desk - west wall, near window */}
        <rect x="12" y="14" width="38" height="55" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="13" y="15" width="36" height="20" rx="1" fill={accent} opacity="0.5" />
        {/* Chair */}
        <rect x="52" y="25" width="18" height="18" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <rect x="50" y="27" width="5" height="14" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="0.8" />
        {/* Wardrobe - south wall full width */}
        <rect x="12" y="120" width="170" height="24" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <line x1="68" y1="120" x2="68" y2="144" stroke={furnitureStroke} strokeWidth="0.8" />
        <line x1="124" y1="120" x2="124" y2="144" stroke={furnitureStroke} strokeWidth="0.8" />
        <circle cx="65" cy="133" r="2" fill={furnitureStroke} />
        <circle cx="71" cy="133" r="2" fill={furnitureStroke} />
        {/* Dresser */}
        <rect x="12" y="78" width="38" height="38" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <line x1="12" y1="97" x2="50" y2="97" stroke={furnitureStroke} strokeWidth="0.8" />
        <circle cx="31" cy="92" r="2" fill={furnitureStroke} />
        <circle cx="31" cy="102" r="2" fill={furnitureStroke} />
      </>
    ),
    l4: (
      <>
        {/* Bed - center-north */}
        <rect x="62" y="14" width="76" height="50" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="62" y="14" width="76" height="12" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="78" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        <circle cx="122" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        {/* Nightstand left */}
        <rect x="40" y="22" width="20" height="18" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="50" cy="31" r="3" fill={accent} opacity="0.6" />
        {/* Nightstand right */}
        <rect x="140" y="22" width="20" height="18" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="150" cy="31" r="3" fill={accent} opacity="0.6" />
        {/* Wardrobe - west wall */}
        <rect x="12" y="14" width="26" height="72" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <line x1="12" y1="50" x2="38" y2="50" stroke={furnitureStroke} strokeWidth="0.8" />
        <circle cx="36" cy="35" r="2" fill={furnitureStroke} />
        <circle cx="36" cy="63" r="2" fill={furnitureStroke} />
        {/* Wardrobe - east wall */}
        <rect x="162" y="14" width="26" height="72" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <line x1="162" y1="50" x2="188" y2="50" stroke={furnitureStroke} strokeWidth="0.8" />
        <circle cx="164" cy="35" r="2" fill={furnitureStroke} />
        <circle cx="164" cy="63" r="2" fill={furnitureStroke} />
        {/* Desk */}
        <rect x="60" y="100" width="80" height="30" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="61" y="101" width="78" height="14" rx="1" fill={accent} opacity="0.5" />
        {/* Chair */}
        <rect x="89" y="133" width="22" height="18" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <rect x="91" y="131" width="18" height="5" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="0.8" />
      </>
    ),
    l5: (
      <>
        {/* Bed - north-center */}
        <rect x="50" y="14" width="100" height="52" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="50" y="14" width="100" height="12" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="68" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        <circle cx="132" cy="20" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        {/* Nightstand left */}
        <rect x="28" y="22" width="20" height="18" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="38" cy="31" r="3" fill={accent} opacity="0.6" />
        {/* Nightstand right */}
        <rect x="152" y="22" width="20" height="18" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="162" cy="31" r="3" fill={accent} opacity="0.6" />
        {/* Wardrobe near entrance - south-east */}
        <rect x="140" y="92" width="48" height="52" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <line x1="164" y1="92" x2="164" y2="144" stroke={furnitureStroke} strokeWidth="0.8" />
        <circle cx="161" cy="118" r="2" fill={furnitureStroke} />
        <circle cx="167" cy="118" r="2" fill={furnitureStroke} />
        {/* Desk - west wall */}
        <rect x="12" y="78" width="48" height="30" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="13" y="79" width="46" height="14" rx="1" fill={accent} opacity="0.5" />
        {/* Chair */}
        <rect x="24" y="111" width="22" height="18" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        <rect x="26" y="109" width="18" height="5" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="0.8" />
        {/* Dresser */}
        <rect x="12" y="115" width="48" height="28" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <line x1="12" y1="129" x2="60" y2="129" stroke={furnitureStroke} strokeWidth="0.8" />
        <circle cx="36" cy="123" r="2" fill={furnitureStroke} />
        <circle cx="36" cy="136" r="2" fill={furnitureStroke} />
      </>
    ),
    l6: (
      <>
        {/* Bed - faces window (south wall) - suboptimal */}
        <rect x="55" y="92" width="90" height="52" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="55" y="132" width="90" height="12" rx="2" fill={accent} stroke={furnitureStroke} strokeWidth="1" />
        <circle cx="72" cy="138" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        <circle cx="128" cy="138" r="5" fill="white" stroke={furnitureStroke} strokeWidth="1" opacity="0.8" />
        {/* Nightstand left */}
        <rect x="34" y="100" width="18" height="16" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        {/* Nightstand right */}
        <rect x="148" y="100" width="18" height="16" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        {/* Wardrobe - blocking north wall center */}
        <rect x="55" y="14" width="90" height="25" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <line x1="100" y1="14" x2="100" y2="39" stroke={furnitureStroke} strokeWidth="0.8" />
        <circle cx="97" cy="26" r="2" fill={furnitureStroke} />
        <circle cx="103" cy="26" r="2" fill={furnitureStroke} />
        {/* Desk - cramped west */}
        <rect x="12" y="14" width="40" height="30" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1.5" />
        <rect x="13" y="15" width="38" height="12" rx="1" fill={accent} opacity="0.5" />
        {/* Chair - overlapping */}
        <rect x="15" y="47" width="20" height="18" rx="3" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        {/* Bookshelf - east, cramped */}
        <rect x="162" y="14" width="26" height="100" rx="2" fill={furniture} stroke={furnitureStroke} strokeWidth="1" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line key={i} x1="163" y1={24 + i * 14} x2="187" y2={24 + i * 14} stroke={furnitureStroke} strokeWidth="0.6" />
        ))}
      </>
    ),
  };

  return (
    <div
      className={`w-full rounded-lg overflow-hidden border transition-all duration-300 ${
        selected ? "border-indigo-400 bg-indigo-50/30" : "border-gray-100 bg-gray-50/50"
      }`}
      style={{ height: 140 }}
    >
      <svg viewBox="0 0 200 154" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        {[20, 40, 60, 80, 100, 120, 140, 160, 180].map((v) => (
          <g key={v}>
            <line x1={v} y1="8" x2={v} y2="146" stroke="#e2e8f0" strokeWidth="0.4" />
          </g>
        ))}
        {[20, 40, 60, 80, 100, 120].map((v) => (
          <g key={v}>
            <line x1="8" y1={v} x2="192" y2={v} stroke="#e2e8f0" strokeWidth="0.4" />
          </g>
        ))}
        {/* Room outline */}
        <rect x="8" y="8" width="184" height="140" rx="3" fill="white" stroke={wallColor} strokeWidth="2" />
        {/* Door arc */}
        <path d="M 8 140 Q 20 140 20 128" fill="none" stroke={stroke} strokeWidth="1" strokeDasharray="2,1" />
        {/* Window */}
        <line x1="90" y1="8" x2="120" y2="8" stroke={selected ? "#a5b4fc" : "#94a3b8"} strokeWidth="3" />
        {/* Furniture */}
        {configs[layoutId]}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────
// Score Ring
// ─────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const colors = scoreColor(score);

  return (
    <div className="relative flex items-center justify-center" style={{ width: 56, height: 56 }}>
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="5" />
        <motion.circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          transform="rotate(-90 28 28)"
          className={`${colors.text}`}
          style={{
            stroke: score >= 85 ? "#22c55e" : score >= 70 ? "#eab308" : "#ef4444",
            strokeDasharray: circumference,
          }}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
        />
      </svg>
      <span
        className={`absolute text-[11px] font-bold ${colors.text}`}
        style={{ lineHeight: 1 }}
      >
        {score}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Score Breakdown Bar
// ─────────────────────────────────────────────
function BreakdownBar({ label, value, color, delay }: { label: string; value: number; color: string; delay: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-gray-500 font-medium">{label}</span>
        <span className="font-bold text-gray-700">{value}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, delay, ease: "easeOut" }}
          className={`h-full rounded-full bg-gradient-to-r ${color}`}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Skeleton card (loading)
// ─────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-2xl border-2 border-gray-100 bg-white p-4 shadow-sm animate-pulse">
      <div className="w-full h-36 bg-gray-100 rounded-lg mb-4" />
      <div className="flex justify-between items-center mb-3">
        <div className="h-5 w-24 bg-gray-200 rounded" />
        <div className="h-8 w-8 bg-gray-200 rounded-full" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full bg-gray-100 rounded" />
        <div className="h-3 w-3/4 bg-gray-100 rounded" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────
function ScoreTooltip() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
        How scores are calculated
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            className="absolute left-0 top-7 z-50 w-72 bg-white border border-gray-200 rounded-2xl shadow-xl p-4 text-xs text-gray-600"
          >
            <h4 className="font-bold text-gray-800 text-sm mb-2 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-indigo-500" /> Score Calculation
            </h4>
            <div className="space-y-2.5">
              {[
                { icon: TrendingUp, label: "Space Utilization (30%)", desc: "Percentage of usable floor area occupied by furniture without crowding." },
                { icon: ShieldCheck, label: "Accessibility (30%)", desc: "Clearance around furniture for comfortable movement and pathways." },
                { icon: Layers, label: "Ergonomics (25%)", desc: "Furniture orientation aligned with natural light, door, and window positions." },
                { icon: LayoutGrid, label: "Non-overlap (15%)", desc: "Ensures no furniture pieces overlap or block doorways/windows." },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex gap-2">
                  <Icon className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-700">{label}</p>
                    <p className="text-gray-500 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────
// Compare Modal
// ─────────────────────────────────────────────
function CompareModal({
  layouts,
  open,
  onClose,
}: {
  layouts: FurnitureLayout[];
  open: boolean;
  onClose: () => void;
}) {
  const [slotA, setSlotA] = useState<string>(layouts[0]?.id ?? "");
  const [slotB, setSlotB] = useState<string>(layouts[1]?.id ?? "");

  const la = layouts.find((l) => l.id === slotA);
  const lb = layouts.find((l) => l.id === slotB);

  const metrics: { key: keyof ScoreBreakdown; label: string }[] = [
    { key: "spaceUtilization", label: "Space Utilization" },
    { key: "accessibility", label: "Accessibility" },
    { key: "ergonomics", label: "Ergonomics" },
    { key: "nonOverlap", label: "Non-Overlap" },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <GitCompare className="w-5 h-5" />
                <h3 className="font-bold text-lg">Compare Layouts</h3>
              </div>
              <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {/* Selectors */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {(["A", "B"] as CompareSlot[]).map((slot) => {
                  const current = slot === "A" ? slotA : slotB;
                  const setter = slot === "A" ? setSlotA : setSlotB;
                  return (
                    <div key={slot}>
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
                        Layout {slot}
                      </label>
                      <select
                        value={current}
                        onChange={(e) => setter(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      >
                        {layouts.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.label} — {l.score}/100
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {/* Thumbnails */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {[la, lb].map((layout, idx) =>
                  layout ? (
                    <div key={layout.id}>
                      <LayoutThumbnail layoutId={layout.id} selected={false} />
                      <p className="text-center text-xs text-gray-500 mt-1 font-medium">{layout.label}</p>
                    </div>
                  ) : (
                    <div key={idx} className="h-36 bg-gray-100 rounded-lg" />
                  )
                )}
              </div>

              {/* Score comparison */}
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                  <span>{la?.label}</span>
                  <span className="text-center">Metric</span>
                  <span className="text-right">{lb?.label}</span>
                </div>
                {/* Total score */}
                <div className="grid grid-cols-3 items-center gap-2 py-2 border-b border-gray-200">
                  <span className={`text-lg font-extrabold ${la ? scoreColor(la.score).text : ""}`}>
                    {la?.score}/100
                  </span>
                  <span className="text-center text-xs font-semibold text-gray-600">Total Score</span>
                  <span className={`text-lg font-extrabold text-right ${lb ? scoreColor(lb.score).text : ""}`}>
                    {lb?.score}/100
                  </span>
                </div>
                {metrics.map(({ key, label }) => {
                  const aVal = la?.breakdown[key] ?? 0;
                  const bVal = lb?.breakdown[key] ?? 0;
                  const winner = aVal > bVal ? "a" : bVal > aVal ? "b" : "tie";
                  return (
                    <div key={key} className="grid grid-cols-3 items-center gap-2">
                      <span
                        className={`text-sm font-bold ${
                          winner === "a" ? "text-green-600" : winner === "b" ? "text-red-500" : "text-gray-600"
                        }`}
                      >
                        {aVal}%
                        {winner === "a" && " ↑"}
                      </span>
                      <span className="text-center text-[11px] text-gray-500">{label}</span>
                      <span
                        className={`text-sm font-bold text-right ${
                          winner === "b" ? "text-green-600" : winner === "a" ? "text-red-500" : "text-gray-600"
                        }`}
                      >
                        {bVal}%
                        {winner === "b" && " ↑"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────
// Layout Card
// ─────────────────────────────────────────────
function LayoutCard({
  layout,
  selected,
  isRecommended,
  onSelect,
  showBreakdown,
  onToggleBreakdown,
}: {
  layout: FurnitureLayout;
  selected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  showBreakdown: boolean;
  onToggleBreakdown: () => void;
}) {
  const colors = scoreColor(layout.score);

  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.015 }}
      whileTap={{ scale: 0.99 }}
      layout
      className={`relative rounded-2xl border-2 bg-white transition-all duration-300 overflow-hidden cursor-pointer ${
        selected
          ? `border-indigo-600 shadow-xl ${colors.glow} ring-2 ring-indigo-300 ring-offset-1`
          : "border-gray-200 shadow-md hover:shadow-lg hover:border-indigo-200"
      }`}
      onClick={onSelect}
    >
      {/* Recommended ribbon */}
      {isRecommended && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-gradient-to-r from-amber-400 to-yellow-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-md">
          <Star className="w-3 h-3" />
          Recommended
        </div>
      )}

      {/* Selected checkmark */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="absolute top-3 right-3 z-10 bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-full w-7 h-7 flex items-center justify-center shadow-lg"
          >
            <Check className="w-4 h-4" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-4">
        {/* Thumbnail */}
        <LayoutThumbnail layoutId={layout.id} selected={selected} />

        {/* Card body */}
        <div className="mt-3 space-y-2.5">
          {/* Header row */}
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-gray-900 text-base">{layout.label}</h3>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug line-clamp-2">{layout.summary}</p>
            </div>
            <div className="shrink-0">
              <ScoreRing score={layout.score} />
            </div>
          </div>

          {/* Score badge + label */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${colors.badge}`}
            >
              {scoreLabel(layout.score)} · {layout.score}/100
            </span>
            {layout.tags.map((tag) => (
              <span key={tag} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                {tag}
              </span>
            ))}
          </div>

          {/* Score breakdown toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleBreakdown();
            }}
            className={`w-full flex items-center justify-between text-[11px] font-semibold px-3 py-2 rounded-lg transition-colors ${
              selected ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3" />
              Score Breakdown
            </span>
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-200 ${showBreakdown ? "rotate-90" : ""}`}
            />
          </button>

          {/* Breakdown panel */}
          <AnimatePresence>
            {showBreakdown && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div
                  className={`rounded-xl p-3 space-y-2 mt-1 border ${
                    selected ? "bg-indigo-50/60 border-indigo-100" : "bg-gray-50 border-gray-100"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <BreakdownBar label="Space Utilization" value={layout.breakdown.spaceUtilization} color="from-blue-400 to-indigo-500" delay={0} />
                  <BreakdownBar label="Accessibility" value={layout.breakdown.accessibility} color="from-emerald-400 to-teal-500" delay={0.08} />
                  <BreakdownBar label="Ergonomics" value={layout.breakdown.ergonomics} color="from-purple-400 to-violet-500" delay={0.16} />
                  <BreakdownBar label="Non-Overlap" value={layout.breakdown.nonOverlap} color="from-amber-400 to-orange-500" delay={0.24} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Select button */}
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
              selected
                ? "bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-md shadow-indigo-200"
                : "bg-gray-100 text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
            }`}
          >
            {selected ? "Selected ✓" : "Select Layout"}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────
export default function ViewLayouts() {
  const navigate = useNavigate();
  const { profile, signOut } = useCurrentUserProfile();

  const handleLogout = async () => {
    const success = await signOut();
    if (success) {
      navigate("/");
    }
  };

  const displayName = profile.fullName?.trim() ? profile.fullName : profile.username;

  const bestId = MOCK_LAYOUTS.reduce((best, l) => (l.score > best.score ? l : best), MOCK_LAYOUTS[0])?.id;
  const [selectedId, setSelectedId] = useState<string>(bestId ?? "");
  const [openBreakdown, setOpenBreakdown] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError] = useState(false);

  // Simulate generation loading
  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 2200);
    return () => clearTimeout(t);
  }, []);

  const handleContinue = () => {
    if (!selectedId) return;
    navigate("/room-view-3d");
  };

  const selectedLayout = MOCK_LAYOUTS.find((l) => l.id === selectedId);

  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] relative" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="absolute inset-0 dot-grid pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] bg-teal-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-[300px] h-[300px] bg-violet-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Compare Modal */}
      <CompareModal layouts={MOCK_LAYOUTS} open={compareOpen} onClose={() => setCompareOpen(false)} />

      {/* ── Navigation ── */}
      <nav className="relative glass-nav z-30">
        <div className="px-4 md:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/dashboard")}>
              <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-2 rounded-xl shadow-lg shadow-teal-500/20">
                <Box className="w-8 h-8 text-white" strokeWidth={1.5} />
              </div>
              <div className="hidden md:block">
                <h1 className="text-base font-bold text-white">3D Layout System</h1>
                <p className="text-xs text-zinc-500">AI-Powered Design</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:block text-right">
                <p className="text-xs text-zinc-500">Welcome back,</p>
                <p className="font-semibold text-white text-sm">{displayName} 👋</p>
              </div>
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline text-sm font-medium">Logout</span>
              </motion.button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main className="relative px-4 md:px-8 py-8 md:py-10 max-w-7xl mx-auto">

        {/* Step Indicator */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="glass-card rounded-2xl border border-white/5 px-6 py-4 flex justify-center">
            <StepIndicator current={4} />
          </div>
        </motion.div>

        {/* Page Header + Toolbar */}
        <motion.div
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3"
        >
          <div>
            <h2 className="text-3xl md:text-4xl font-extrabold bg-gradient-to-r from-teal-300 to-cyan-400 bg-clip-text text-transparent">
              Generated Furniture Layouts
            </h2>
            <p className="text-zinc-500 mt-1.5 text-sm md:text-base">
              Review and compare optimized layout options for your selected room.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ScoreTooltip />
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
              onClick={() => setCompareOpen(true)}
              className="flex items-center gap-2 px-4 py-2 border border-teal-500/20 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 rounded-xl text-sm font-semibold transition-all">
              <GitCompare className="w-4 h-4" /> Compare
            </motion.button>
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
              onClick={() => { setIsLoading(true); setTimeout(() => setIsLoading(false), 1800); }}
              className="flex items-center gap-2 px-4 py-2 border border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 rounded-xl text-sm font-semibold transition-all">
              <RefreshCw className="w-4 h-4" /> Regenerate
            </motion.button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">

          {/* ── Left: Layout Grid ── */}
          <div className="xl:col-span-3">

            {/* Error state */}
            {hasError && (
              <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                className="glass-card rounded-3xl border border-red-500/20 p-12 flex flex-col items-center gap-4 text-center">
                <div className="bg-red-500/10 p-5 rounded-2xl border border-red-500/20">
                  <AlertCircle className="w-12 h-12 text-red-400" />
                </div>
                <h3 className="text-xl font-bold text-white">Layout Generation Failed</h3>
                <p className="text-zinc-500 max-w-sm">Layout generation failed. Please try again or re-upload your floor plan.</p>
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                  onClick={() => navigate("/upload")}
                  className="mt-2 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl font-semibold shadow-md shadow-teal-500/20">
                  <RefreshCw className="w-4 h-4" /> Try Again
                </motion.button>
              </motion.div>
            )}

            {/* Loading state */}
            {!hasError && isLoading && (
              <div>
                <div className="flex items-center gap-3 mb-6 glass-card rounded-2xl px-5 py-4 border border-white/5">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                    <Loader2 className="w-5 h-5 text-teal-400" />
                  </motion.div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">Generating optimized layouts…</p>
                    <p className="text-xs text-zinc-500">Our AI is calculating the best furniture arrangements</p>
                  </div>
                  <div className="ml-auto flex-1 max-w-xs">
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <motion.div initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 2.2, ease: "easeInOut" }}
                        className="h-full bg-gradient-to-r from-teal-400 to-cyan-400 rounded-full" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
              </div>
            )}

            {/* Layouts grid */}
            {!hasError && !isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
              >
                {MOCK_LAYOUTS.map((layout, i) => (
                  <motion.div
                    key={layout.id}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 }}
                  >
                    <LayoutCard
                      layout={layout}
                      selected={layout.id === selectedId}
                      isRecommended={layout.id === bestId}
                      onSelect={() => setSelectedId(layout.id)}
                      showBreakdown={openBreakdown === layout.id}
                      onToggleBreakdown={() =>
                        setOpenBreakdown((prev) => (prev === layout.id ? null : layout.id))
                      }
                    />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>

          {/* ── Right: Side Panel ── */}
          <div className="xl:col-span-1 flex flex-col gap-4">

            {/* Selected Room Preview */}
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}
              className="glass-card rounded-2xl border border-white/5 p-5">
              <h4 className="text-sm font-bold text-zinc-300 mb-3 flex items-center gap-2">
                <BedDouble className="w-4 h-4 text-teal-400" /> Selected Room
              </h4>
              <div className="w-full rounded-xl overflow-hidden bg-teal-500/[0.03] border border-teal-500/10" style={{ height: 110 }}>
                <svg viewBox="0 0 160 110" width="100%" height="100%">
                  {[20, 40, 60, 80, 100, 120, 140].map((v) => (<g key={v}><line x1={v} y1="5" x2={v} y2="105" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" /></g>))}
                  {[20, 40, 60, 80, 100].map((v) => (<g key={v}><line x1="5" y1={v} x2="155" y2={v} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" /></g>))}
                  <rect x="8" y="8" width="144" height="94" rx="4" fill="none" stroke="#14b8a6" strokeWidth="2" />
                  <line x1="60" y1="8" x2="80" y2="8" stroke="#2dd4bf" strokeWidth="3" />
                  <path d="M 8 94 Q 18 94 18 84" fill="none" stroke="#14b8a6" strokeWidth="1.2" strokeDasharray="2,1.5" />
                  <text x="80" y="58" textAnchor="middle" fill="#2dd4bf" fontSize="9" fontFamily="sans-serif" fontWeight="bold">{SELECTED_ROOM.name}</text>
                  <text x="80" y="72" textAnchor="middle" fill="#5eead4" fontSize="7.5" fontFamily="sans-serif">{SELECTED_ROOM.width}ft × {SELECTED_ROOM.height}ft</text>
                </svg>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div>
                  <p className="font-bold text-zinc-200 text-sm">{SELECTED_ROOM.name}</p>
                  <p className="text-zinc-600 text-xs">{SELECTED_ROOM.type}</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-zinc-600 text-xs justify-end">
                    <Maximize2 className="w-3 h-3" /> {SELECTED_ROOM.width}ft × {SELECTED_ROOM.height}ft
                  </div>
                  <p className="text-xs font-semibold text-teal-400">{SELECTED_ROOM.width * SELECTED_ROOM.height} sq ft</p>
                </div>
              </div>
            </motion.div>

            {/* Selection Summary */}
            <AnimatePresence mode="wait">
              {selectedLayout ? (
                <motion.div key={selectedLayout.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                  className="bg-gradient-to-br from-teal-500/20 to-teal-600/10 glass-card rounded-2xl border border-teal-500/20 shadow-lg p-5">
                  
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-teal-300/60 text-xs font-medium">Active Selection</p>
                      <h4 className="font-bold text-lg text-white">{selectedLayout.label}</h4>
                    </div>
                    <div className="bg-white/10 rounded-xl p-2 text-center min-w-[52px]">
                       <p className="text-2xl font-extrabold text-teal-300">{selectedLayout.score}</p>
                       <p className="text-teal-300/60 text-[10px] font-medium">/ 100</p>
                    </div>
                  </div>
                  <p className="text-teal-100/50 text-xs leading-relaxed mb-3">{selectedLayout.summary}</p>
                  <div className="space-y-1.5">
                    {[
                      { label: "Space", value: selectedLayout.breakdown.spaceUtilization },
                      { label: "Access", value: selectedLayout.breakdown.accessibility },
                      { label: "Ergonomics", value: selectedLayout.breakdown.ergonomics },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className="text-teal-200/50 text-[11px] w-20">{label}</span>
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${value}%` }}
                            transition={{ duration: 0.7, ease: "easeOut" }}
                            className="h-full bg-white rounded-full"
                          />
                        </div>
                        <span className="text-teal-300 text-[11px] font-bold w-8 text-right">{value}%</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white rounded-2xl border border-dashed border-indigo-200 p-6 flex flex-col items-center gap-2 text-center"
                >
                  <LayoutGrid className="w-8 h-8 text-indigo-300" />
                  <p className="text-gray-500 text-sm font-medium">No layout selected</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Layouts count badge */}
            {!isLoading && !hasError && (
              <div className="glass-card rounded-xl border border-white/5 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-teal-400" />
                  <span className="text-sm font-semibold text-zinc-300">AI Generated</span>
                </div>
                <span className="text-sm font-bold text-teal-400">{MOCK_LAYOUTS.length} layouts</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <motion.button whileHover={selectedId ? { scale: 1.03, y: -1 } : {}} whileTap={selectedId ? { scale: 0.97 } : {}}
                onClick={handleContinue} disabled={!selectedId || isLoading}
                className={`w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-sm transition-all duration-300 ${
                  selectedId && !isLoading
                    ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30"
                    : "bg-white/5 text-zinc-600 cursor-not-allowed border border-white/5"
                }`}>
                Continue with Selected Layout <ArrowRight className="w-4 h-4" />
              </motion.button>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => navigate("/select-room")}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all">
                <ArrowLeft className="w-4 h-4" /> Back to Room Selection
              </motion.button>
            </div>
          </div>
        </div>

        {/* Mobile bottom action bar */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="xl:hidden mt-6 flex gap-3">
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => navigate("/select-room")}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10 transition-all">
            <ArrowLeft className="w-4 h-4" /> Back
          </motion.button>
          <motion.button whileHover={selectedId ? { scale: 1.02 } : {}} whileTap={selectedId ? { scale: 0.97 } : {}}
            onClick={handleContinue} disabled={!selectedId || isLoading}
            className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all ${
              selectedId && !isLoading
                ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/20"
                : "bg-white/5 text-zinc-600 cursor-not-allowed"
            }`}>
            Continue <ArrowRight className="w-4 h-4" />
          </motion.button>
        </motion.div>
      </main>
    </div>
  );
}
