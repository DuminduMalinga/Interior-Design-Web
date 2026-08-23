import { useState } from "react";
import {
  Box,
  LogOut,
  Menu,
  X,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Check,
  AlertCircle,
  BedDouble,
  Sofa,
  BookOpen,
  Utensils,
  Bath,
  Home,
  Maximize2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";

type RoomType = "Bedroom" | "Living Room" | "Study Room" | "Kitchen" | "Bathroom" | "Other";

interface DetectedRoom {
  id: string;
  name: string;
  type: RoomType;
  width: number;
  height: number;
  shape: [number, number][];
}

const DETECTED_ROOMS: DetectedRoom[] = [
  { id: "r1", name: "Bedroom 1",   type: "Bedroom",     width: 14, height: 12, shape: [[10,10],[90,10],[90,90],[10,90]] },
  { id: "r2", name: "Bedroom 2",   type: "Bedroom",     width: 11, height: 10, shape: [[15,15],[85,15],[85,85],[15,85]] },
  { id: "r3", name: "Living Room", type: "Living Room", width: 18, height: 14, shape: [[5,20],[95,20],[95,80],[5,80]] },
  { id: "r4", name: "Study Room",  type: "Study Room",  width: 10, height:  9, shape: [[20,15],[80,15],[80,85],[20,85]] },
  { id: "r5", name: "Kitchen",     type: "Kitchen",     width: 12, height: 10, shape: [[10,10],[90,10],[90,60],[60,90],[10,90]] },
  { id: "r6", name: "Bathroom",    type: "Bathroom",    width:  8, height:  6, shape: [[15,15],[85,15],[85,85],[15,85]] },
];

const ROOM_ICON: Record<RoomType, React.ElementType> = {
  Bedroom: BedDouble, "Living Room": Sofa, "Study Room": BookOpen,
  Kitchen: Utensils, Bathroom: Bath, Other: Home,
};

const ROOM_COLOR: Record<RoomType, { text: string; bg: string; border: string; fill: string; stroke: string }> = {
  "Bedroom":     { text: "text-teal-400",   bg: "bg-teal-500/10",   border: "border-teal-500/20",   fill: "#134e4a", stroke: "#14b8a6" },
  "Living Room": { text: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", fill: "#2e1065", stroke: "#8b5cf6" },
  "Study Room":  { text: "text-emerald-400",bg: "bg-emerald-500/10",border: "border-emerald-500/20",fill: "#064e3b", stroke: "#10b981" },
  "Kitchen":     { text: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20",  fill: "#451a03", stroke: "#f59e0b" },
  "Bathroom":    { text: "text-cyan-400",   bg: "bg-cyan-500/10",   border: "border-cyan-500/20",   fill: "#083344", stroke: "#06b6d4" },
  "Other":       { text: "text-zinc-400",   bg: "bg-zinc-500/10",   border: "border-zinc-500/20",   fill: "#18181b", stroke: "#71717a" },
};

const sqFt = (w: number, h: number) => w * h;

const STEPS = [
  { label: "Upload", step: 1 }, { label: "Detect", step: 2 }, { label: "Select Room", step: 3 },
  { label: "Layout", step: 4 }, { label: "3D View", step: 5 },
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
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300 ${
                isDone ? "bg-gradient-to-br from-teal-400 to-teal-600 border-teal-600 text-white" :
                isActive ? "bg-white/5 border-teal-400 text-teal-300 shadow-md shadow-teal-500/20" :
                "bg-white/5 border-white/10 text-zinc-600"
              }`}>
                {isDone ? <Check className="w-4 h-4" /> : s.step}
              </div>
              <span className={`mt-1 text-[10px] font-medium whitespace-nowrap ${
                isActive ? "text-teal-400" : isDone ? "text-teal-500" : "text-zinc-600"
              }`}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-8 md:w-12 mb-4 mx-1 transition-all duration-500 ${
                s.step < current ? "bg-gradient-to-r from-teal-400 to-teal-600" : "bg-white/10"
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RoomThumbnail({ shape, selected, roomType }: { shape: [number, number][]; selected: boolean; roomType: RoomType }) {
  const points = shape.map(([x, y]) => `${x},${y}`).join(" ");
  const c = ROOM_COLOR[roomType];
  return (
    <div className={`w-full rounded-lg overflow-hidden border transition-all duration-300 ${selected ? c.border : "border-white/5"}`} style={{ height: 72 }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        {[20, 40, 60, 80].map((v) => (
          <g key={v}>
            <line x1={v} y1="0" x2={v} y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
            <line x1="0" y1={v} x2="100" y2={v} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          </g>
        ))}
        <polygon points={points} fill={c.fill} stroke={c.stroke} strokeWidth={selected ? 2.5 : 1.5} opacity="0.8" />
        <line x1="50" y1="10" x2="65" y2="10" stroke={c.stroke} strokeWidth="2" strokeDasharray="2,1" />
      </svg>
    </div>
  );
}

function RoomCard({ room, selected, onClick }: { room: DetectedRoom; selected: boolean; onClick: () => void }) {
  const Icon = ROOM_ICON[room.type];
  const c = ROOM_COLOR[room.type];
  const area = sqFt(room.width, room.height);

  return (
    <motion.div whileHover={{ y: -4, scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onClick}
      className={`relative cursor-pointer rounded-2xl p-4 border-2 transition-all duration-300 bg-white/[0.03] ${
        selected ? `${c.border} shadow-xl ring-1 ring-offset-0` : "border-white/10 hover:border-white/20 hover:bg-white/[0.05]"
      }`} style={selected ? { boxShadow: `0 0 20px ${c.stroke}25` } : {}}>
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
            className={`absolute -top-2.5 -right-2.5 ${c.bg} border ${c.border} rounded-full w-7 h-7 flex items-center justify-center shadow-lg z-10`}>
            <CheckCircle2 className={`w-4 h-4 ${c.text}`} />
          </motion.div>
        )}
      </AnimatePresence>
      <RoomThumbnail shape={room.shape} selected={selected} roomType={room.type} />
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-zinc-200 text-sm truncate">{room.name}</h3>
          <div className={`p-1.5 rounded-lg ${selected ? c.bg : "bg-white/5"}`}>
            <Icon className={`w-4 h-4 ${selected ? c.text : "text-zinc-500"}`} />
          </div>
        </div>
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
          selected ? `${c.bg} ${c.text} ${c.border}` : "bg-white/5 text-zinc-500 border-white/10"
        }`}>{room.type}</span>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1 text-zinc-600 text-xs">
            <Maximize2 className="w-3 h-3" />
            <span>{room.width}ft × {room.height}ft</span>
          </div>
          <span className={`text-xs font-medium ${selected ? c.text : "text-zinc-600"}`}>{area} sq ft</span>
        </div>
      </div>
    </motion.div>
  );
}

export default function SelectRoom() {
  const navigate = useNavigate();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { profile, signOut } = useCurrentUserProfile();

  const handleLogout = async () => {
    const success = await signOut();
    if (success) {
      navigate("/");
    }
  };

  const username = profile.username;
  const rooms = DETECTED_ROOMS;
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;

  const handleContinue = () => {
    if (!selectedRoomId) return;
    navigate("/view-layouts");
  };

  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] relative" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="absolute inset-0 dot-grid pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-teal-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Nav */}
      <nav className="relative glass-nav z-30">
        <div className="px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="lg:hidden text-zinc-400 hover:text-white">
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/dashboard")}>
              <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-2 rounded-xl shadow-lg shadow-teal-500/20">
                <Box className="w-8 h-8 text-white" strokeWidth={1.5} />
              </div>
              <div className="hidden md:block">
                <h1 className="text-base font-bold text-white">3D Layout System</h1>
                <p className="text-xs text-zinc-500">AI-Powered Design</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:block text-right">
              <p className="text-xs text-zinc-500">Welcome back,</p>
              <p className="font-semibold text-white text-sm">{username} 👋</p>
            </div>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline text-sm font-medium">Logout</span>
            </motion.button>
          </div>
        </div>
      </nav>

      <main className="relative px-4 md:px-8 py-8 md:py-10 max-w-6xl mx-auto">
        {/* Step Indicator */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-8">
          <div className="glass-card rounded-2xl border border-white/5 px-6 py-4 flex justify-center">
            <StepIndicator current={3} />
          </div>
        </motion.div>

        {/* Page Header */}
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="mb-8">
          <h2 className="text-3xl md:text-4xl font-extrabold bg-gradient-to-r from-teal-300 to-cyan-400 bg-clip-text text-transparent">Select a Room</h2>
          <p className="text-zinc-500 mt-1 text-sm md:text-base">Choose one detected room to generate optimized furniture layouts.</p>
        </motion.div>

        {rooms.length === 0 ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-3xl border border-amber-500/20 p-12 flex flex-col items-center gap-4 text-center">
            <div className="bg-amber-500/10 p-5 rounded-2xl border border-amber-500/20">
              <AlertCircle className="w-12 h-12 text-amber-400" />
            </div>
            <h3 className="text-xl font-bold text-white">No Rooms Detected</h3>
            <p className="text-zinc-500 max-w-sm">No rooms available. Please re-upload a valid floor plan so the AI can detect room structures.</p>
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/upload")}
              className="mt-2 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl font-semibold shadow-md shadow-teal-500/20">
              <ArrowLeft className="w-4 h-4" /> Re-upload Floor Plan
            </motion.button>
          </motion.div>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Room Cards */}
              <div className="xl:col-span-2">
                <div className="glass-card rounded-3xl border border-white/5 p-6">
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h3 className="font-bold text-zinc-200 text-base">Detected Rooms</h3>
                      <p className="text-xs text-zinc-600 mt-0.5">{rooms.length} room{rooms.length !== 1 ? "s" : ""} found · Select one to continue</p>
                    </div>
                    <span className="bg-teal-500/10 text-teal-400 text-xs font-semibold px-3 py-1.5 rounded-full border border-teal-500/20">
                      {rooms.length} rooms
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {rooms.map((room, i) => (
                      <motion.div key={room.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                        <RoomCard room={room} selected={room.id === selectedRoomId}
                          onClick={() => setSelectedRoomId((prev) => (prev === room.id ? null : room.id))} />
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Panel */}
              <div className="xl:col-span-1 flex flex-col gap-4">
                {/* Floor Plan Preview */}
                <div className="glass-card rounded-2xl border border-white/5 p-5">
                  <h4 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2">
                    <Home className="w-4 h-4 text-teal-400" /> Floor Plan Preview
                  </h4>
                  <div className="w-full rounded-xl overflow-hidden bg-white/[0.02] border border-white/5 flex items-center justify-center" style={{ height: 160 }}>
                    <svg viewBox="0 0 200 160" width="100%" height="100%">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <g key={i}>
                          <line x1={i * 20} y1="0" x2={i * 20} y2="160" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                          <line x1="0" y1={i * 16} x2="200" y2={i * 16} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                        </g>
                      ))}
                      <rect x="10" y="10" width="180" height="140" fill="none" stroke="#14b8a6" strokeWidth="2" rx="2" />
                      <line x1="100" y1="10" x2="100" y2="90" stroke="#14b8a6" strokeWidth="1.5" />
                      <line x1="10" y1="90" x2="200" y2="90" stroke="#14b8a6" strokeWidth="1.5" />
                      <line x1="130" y1="90" x2="130" y2="150" stroke="#14b8a6" strokeWidth="1.5" />
                      <text x="55" y="55" textAnchor="middle" fill="#2dd4bf" fontSize="8" fontFamily="sans-serif">Bedroom 1</text>
                      <text x="150" y="55" textAnchor="middle" fill="#2dd4bf" fontSize="8" fontFamily="sans-serif">Bedroom 2</text>
                      <text x="70" y="120" textAnchor="middle" fill="#2dd4bf" fontSize="8" fontFamily="sans-serif">Living Room</text>
                      <text x="162" y="120" textAnchor="middle" fill="#2dd4bf" fontSize="8" fontFamily="sans-serif">Study</text>
                      {selectedRoom?.name === "Bedroom 1" && <rect x="10" y="10" width="90" height="80" fill="#14b8a6" fillOpacity="0.12" stroke="#14b8a6" strokeWidth="2" />}
                      {selectedRoom?.name === "Bedroom 2" && <rect x="100" y="10" width="90" height="80" fill="#14b8a6" fillOpacity="0.12" stroke="#14b8a6" strokeWidth="2" />}
                      {selectedRoom?.name === "Living Room" && <rect x="10" y="90" width="120" height="60" fill="#14b8a6" fillOpacity="0.12" stroke="#14b8a6" strokeWidth="2" />}
                      {selectedRoom?.name === "Study Room" && <rect x="130" y="90" width="60" height="60" fill="#14b8a6" fillOpacity="0.12" stroke="#14b8a6" strokeWidth="2" />}
                    </svg>
                  </div>
                  <p className="text-[11px] text-zinc-600 mt-2 text-center">
                    {selectedRoom ? `Selected: ${selectedRoom.name}` : "No room selected"}
                  </p>
                </div>

                {/* Selection Summary */}
                <AnimatePresence mode="wait">
                  {selectedRoom ? (
                    <motion.div key="selected" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                      className={`glass-card rounded-2xl border p-5 ${ROOM_COLOR[selectedRoom.type].border}`}
                      style={{ boxShadow: `0 0 20px ${ROOM_COLOR[selectedRoom.type].stroke}20` }}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`${ROOM_COLOR[selectedRoom.type].bg} p-2 rounded-xl border ${ROOM_COLOR[selectedRoom.type].border}`}>
                          {(() => { const Icon = ROOM_ICON[selectedRoom.type]; return <Icon className={`w-5 h-5 ${ROOM_COLOR[selectedRoom.type].text}`} />; })()}
                        </div>
                        <div>
                          <p className="text-zinc-500 text-xs font-medium">Selected Room</p>
                          <h4 className={`font-bold text-base ${ROOM_COLOR[selectedRoom.type].text}`}>{selectedRoom.name}</h4>
                        </div>
                      </div>
                      <div className="space-y-2 text-sm">
                        {[
                          { label: "Type", value: selectedRoom.type },
                          { label: "Dimensions", value: `${selectedRoom.width}ft × ${selectedRoom.height}ft` },
                          { label: "Area", value: `${sqFt(selectedRoom.width, selectedRoom.height)} sq ft` },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-center bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
                            <span className="text-zinc-500">{label}</span>
                            <span className="font-semibold text-zinc-200">{value}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="glass-card rounded-2xl border border-dashed border-white/10 p-6 flex flex-col items-center gap-2 text-center">
                      <div className="bg-white/5 p-3 rounded-xl">
                        <CheckCircle2 className="w-7 h-7 text-zinc-600" />
                      </div>
                      <p className="text-zinc-500 text-sm font-medium">No room selected yet</p>
                      <p className="text-zinc-700 text-xs">Click on a room card to select it</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Actions */}
                <div className="flex flex-col gap-3 mt-auto">
                  <motion.button whileHover={selectedRoomId ? { scale: 1.03, y: -1 } : {}} whileTap={selectedRoomId ? { scale: 0.97 } : {}}
                    onClick={handleContinue} disabled={!selectedRoomId}
                    className={`w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-sm transition-all duration-300 ${
                      selectedRoomId
                        ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30"
                        : "bg-white/5 text-zinc-600 cursor-not-allowed border border-white/5"
                    }`}>
                    Continue to Layout Generation <ArrowRight className="w-4 h-4" />
                  </motion.button>
                  <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    onClick={() => navigate("/upload")}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </motion.button>
                </div>
              </div>
            </div>

            {/* Mobile bottom action bar */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="xl:hidden mt-6 flex gap-3">
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => navigate("/upload")}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm bg-white/5 text-zinc-400 border border-white/10">
                <ArrowLeft className="w-4 h-4" /> Back
              </motion.button>
              <motion.button whileHover={selectedRoomId ? { scale: 1.02 } : {}} whileTap={selectedRoomId ? { scale: 0.97 } : {}}
                onClick={handleContinue} disabled={!selectedRoomId}
                className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all ${
                  selectedRoomId
                    ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/20"
                    : "bg-white/5 text-zinc-600 cursor-not-allowed"
                }`}>
                Continue <ArrowRight className="w-4 h-4" />
              </motion.button>
            </motion.div>
          </>
        )}
      </main>
    </div>
  );
}
