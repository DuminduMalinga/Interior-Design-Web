import { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import AppNavbar from "../components/AppNavbar";
import PageGlows from "../components/marketing/PageGlows";
import type { DetectionResult } from "../lib/wallDetector";

export default function Processing() {
  const navigate = useNavigate();
  const location = useLocation();
  const detection = (location.state as { detection?: DetectionResult } | null)
    ?.detection;
  const [currentStep, setCurrentStep] = useState(0);
  // Landed here without a detection payload (e.g. page reload) — start over.
  useEffect(() => {
    if (!detection) navigate("/upload", { replace: true });
  }, [detection, navigate]);


  const processingSteps = useMemo(() => {
    const c = detection?.counts ?? {};
    return [
      { label: "Analysing the image", duration: 900 },
      {
        label: `Finding room boundaries${c.Room ? ` (${c.Room} found)` : ""}`,
        duration: 900,
      },
      {
        label: `Identifying walls, doors and windows${
          c.Wall || c.Door || c.Window
            ? ` (${c.Wall ?? 0} walls, ${c.Door ?? 0} doors, ${c.Window ?? 0} windows)`
            : ""
        }`,
        duration: 900,
      },
      { label: "Reading room labels", duration: 900 },
      { label: "Separating the rooms", duration: 900 },
    ];
  }, [detection]);

  useEffect(() => {
    if (!detection) return;
    if (currentStep < processingSteps.length) {
      const timer = setTimeout(() => {
        setCurrentStep(currentStep + 1);
      }, processingSteps[currentStep].duration);
      return () => clearTimeout(timer);
    }
    const done = setTimeout(() => {
      navigate("/select-room", { state: location.state });
    }, 1000);
    return () => clearTimeout(done);
  }, [currentStep, processingSteps, navigate, detection, location.state]);

  if (!detection) return null;

  const progress = Math.round((currentStep / processingSteps.length) * 100);

  return (
    <div className="min-h-screen w-full bg-background relative isolate flex flex-col">
      <PageGlows />
      <AppNavbar />

      <main className="relative flex flex-1 items-center justify-center px-4 py-10 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-xl rounded-[28px] border border-lv-line bg-lv-surface p-7 md:p-10"
        >
          <h1 className="text-3xl md:text-4xl leading-[1.08] tracking-tight text-lv-ink">Reading your floor plan</h1>
          <p className="mt-3 text-base text-lv-muted">This takes a few seconds. Keep this tab open.</p>

          <ol className="mt-8 space-y-1" aria-live="polite">
            {processingSteps.map((step, index) => {
              const isComplete = index < currentStep;
              const isActive = index === currentStep;

              return (
                <li
                  key={index}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors duration-300 ${isActive ? "bg-lv-wash/60" : ""}`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center">
                    {isComplete ? (
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-lv-accent text-[#fff]">
                        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                      </span>
                    ) : isActive ? (
                      <Loader2 className="h-5 w-5 animate-spin text-lv-accent" aria-hidden="true" />
                    ) : (
                      <span className="h-5 w-5 rounded-full border-2 border-lv-line" />
                    )}
                  </span>
                  <span className={`text-sm ${isComplete || isActive ? "text-lv-ink" : "text-lv-muted"} ${isActive ? "font-medium" : ""}`}>
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-8">
            <div className="h-2 w-full overflow-hidden rounded-full bg-lv-line">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
                className="h-full rounded-full bg-lv-accent"
              />
            </div>
            <p className="mt-3 text-sm tabular-nums text-lv-muted">{progress}% complete</p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
