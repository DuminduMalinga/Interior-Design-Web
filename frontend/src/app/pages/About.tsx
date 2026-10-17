import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import SiteNavbar from "../components/SiteNavbar";
import PageGlows from "../components/marketing/PageGlows";
import AppFooter from "../components/AppFooter";
import PlanSketch from "../components/marketing/PlanSketch";

const features = [
  { title: "Reads your floor plan", desc: "Walls, doors and rooms are detected from a 2D image, and room labels are read straight off the drawing." },
  { title: "Rule-based layouts", desc: "Each room type has its own furniture rules for clearances, circulation and how the room is used." },
  { title: "Interactive 3D", desc: "Compare the generated layouts, then walk through the one you like." },
];

const rooms = ["Bedroom", "Master bedroom", "Living room", "Dining room", "Kitchen", "Bathroom"];

export default function About() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full bg-background relative isolate flex flex-col">
      <PageGlows />
      <SiteNavbar />

      <main className="flex-1 w-full px-4 md:px-8 pt-8 pb-16 md:pt-12">
        <div className="max-w-6xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-end">
            <h1 className="text-4xl md:text-6xl leading-[1.04] tracking-tight text-lv-ink text-balance">
              From a flat drawing to a furnished room
            </h1>
            <p className="max-w-md text-lg md:text-xl leading-snug text-lv-ink lg:justify-self-end">
              3D Layout System turns a 2D floor plan into furnished, explorable 3D rooms, so you can see how a space
              will work before moving a single piece of furniture.
            </p>
          </motion.div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <motion.article initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
              className="md:col-span-2 flex min-h-[280px] flex-col gap-6 rounded-[24px] bg-lv-wash p-6 md:p-7 sm:flex-row">
              <div className="flex flex-col justify-between sm:w-[38%]">
                <h2 className="text-2xl leading-tight text-lv-ink">{features[0].title}</h2>
                <p className="mt-6 text-sm leading-relaxed text-lv-ink">{features[0].desc}</p>
              </div>
              <PlanSketch className="w-full self-center sm:w-[62%]" />
            </motion.article>

            {features.slice(1).map((feature, i) => (
              <motion.article key={feature.title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.16 + i * 0.08 }}
                className="flex min-h-[220px] flex-col justify-between rounded-[24px] bg-lv-deep p-6 text-lv-on-deep md:p-7 lg:min-h-[280px]">
                <h2 className="text-2xl leading-tight">{feature.title}</h2>
                <p className="mt-6 text-sm leading-relaxed text-lv-on-deep/80">{feature.desc}</p>
              </motion.article>
            ))}
          </div>

          <section className="mt-16 grid gap-8 border-t border-lv-line pt-10 lg:grid-cols-[1fr_1.4fr] lg:items-start">
            <div>
              <h2 className="text-2xl md:text-3xl leading-tight text-lv-ink">Rooms we can design</h2>
              <p className="mt-3 max-w-sm text-base leading-relaxed text-lv-muted">
                Upload one plan and furnish any of these rooms from it.
              </p>
            </div>
            <ul className="flex flex-wrap gap-2.5">
              {rooms.map((room) => (
                <li key={room} className="rounded-full border border-lv-line bg-lv-surface px-5 py-2.5 text-sm text-lv-ink">
                  {room}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-16 flex flex-col gap-6 rounded-[28px] bg-lv-deep px-6 py-12 text-lv-on-deep md:flex-row md:items-end md:justify-between md:px-14 md:py-16">
            <div>
              <h2 className="text-3xl md:text-5xl leading-[1.05]">Try it with your own floor plan</h2>
              <p className="mt-4 text-base text-lv-on-deep/75">It takes a PNG or JPG and a couple of minutes.</p>
            </div>
            <button type="button" onClick={() => navigate("/upload")} className="lv-btn-invert min-h-12 px-6 shrink-0 self-start md:self-auto">
              Create a design <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </section>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
