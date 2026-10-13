import { ArrowRight, Boxes, LayoutGrid, ScanText, Sparkles, Upload } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import SiteNavbar from "../components/SiteNavbar";
import AppFooter from "../components/AppFooter";

const features = [
  { icon: ScanText, title: "Reads your floor plan", desc: "Walls, doors and rooms are detected from a 2D image, and room labels are read straight off the drawing." },
  { icon: LayoutGrid, title: "Rule-based layouts", desc: "Each room type has its own furniture rules for clearances, circulation and how the room is used." },
  { icon: Boxes, title: "Interactive 3D", desc: "Compare the generated layouts, then walk through the one you like and export it." },
];

const rooms = ["Bedroom", "Master Bedroom", "Living Room", "Dining Room", "Kitchen", "Bathroom"];

export default function About() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full bg-background relative flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
      <SiteNavbar />

      <main className="flex-1 w-full px-4 md:px-8 py-8 md:py-12">
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-400 mb-2">About us</p>
            <h2 className="font-serif text-4xl md:text-5xl font-bold leading-[1.1] text-white">
              From a flat drawing to a <span className="text-teal-400">furnished room</span>
            </h2>
            <p className="mt-4 text-base md:text-lg text-zinc-400 leading-relaxed">
              3D Layout System turns a 2D floor plan into furnished, explorable 3D rooms, so you can see how a
              space will work before moving a single piece of furniture.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
            {features.map(({ icon: Icon, title, desc }, i) => (
              <motion.div key={title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }}
                className="glass-card rounded-2xl p-6 border border-white/5">
                <div className="w-11 h-11 rounded-xl bg-teal-500/10 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-teal-400" />
                </div>
                <h3 className="font-semibold text-white mb-1.5">{title}</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </div>

          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="glass-card rounded-2xl p-6 md:p-8 border border-white/5 mb-12">
            <h3 className="text-xl font-bold text-white flex items-center gap-2 leading-tight">
              <Sparkles className="w-5 h-5 text-teal-400" /> Rooms we can design
            </h3>
            <p className="text-sm text-zinc-500 mt-1 mb-5">Upload one plan and furnish any of these rooms from it.</p>
            <div className="flex flex-wrap gap-2.5">
              {rooms.map((room) => (
                <span key={room} className="px-4 py-2 rounded-full bg-white/[0.03] border border-white/10 text-sm font-medium text-zinc-200">
                  {room}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-teal-500 to-teal-600 px-7 py-10 md:px-12">
            <div className="absolute -right-16 -top-24 w-72 h-72 rounded-full bg-white/10" />
            <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h3 className="font-serif text-2xl md:text-3xl font-bold text-white leading-tight">Try it with your own floor plan</h3>
                <p className="text-white/80 mt-2">It takes a PNG or JPG and a couple of minutes.</p>
              </div>
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => navigate("/upload")}
                className="shrink-0 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl font-semibold shadow-lg"
                style={{ background: "#fff", color: "#0f766e" }}>
                <Upload className="w-5 h-5" /> Create a Design <ArrowRight className="w-4 h-4" />
              </motion.button>
            </div>
          </motion.div>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
