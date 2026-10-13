import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import AppNavbar from "../components/AppNavbar";
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
      { label: "Analyzing floor plan image", duration: 900 },
      {
        label: `Detecting room boundaries${c.Room ? ` — ${c.Room} found` : ""}`,
        duration: 900,
      },
      {
        label: `Identifying walls, doors and windows${
          c.Wall || c.Door || c.Window
            ? ` — ${c.Wall ?? 0} walls, ${c.Door ?? 0} doors, ${c.Window ?? 0} windows`
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

  return (
    <div className="min-h-screen w-full bg-background relative overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Navigation */}
      <AppNavbar />

      {/* Ambient orbs */}
      <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-teal-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-violet-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Content */}
      <main className="relative flex items-center justify-center px-4 py-4 md:px-8 min-h-[calc(100vh-73px)]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-2xl glass-card rounded-3xl shadow-2xl shadow-black/50 p-6 md:p-7"
        >
          {/* Processing Icon */}
          <div className="flex justify-center mb-4">
            <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-3.5 rounded-2xl shadow-lg shadow-teal-500/25">
              <Sparkles className="w-9 h-9 text-white" strokeWidth={1.5} />
            </div>
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-center bg-gradient-to-r from-teal-300 to-cyan-400 bg-clip-text text-transparent mb-1.5">
            Processing Your Floor Plan
          </h2>
          <p className="text-center text-sm text-zinc-500 mb-5">
            Our AI is analyzing your floor plan and separating it into rooms...
          </p>

          {/* Processing Steps */}
          <div className="space-y-2 mb-5">
            {processingSteps.map((step, index) => {
              const isComplete = index < currentStep;
              const isActive = index === currentStep;

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 ${
                    isActive ? "bg-teal-500/10 border border-teal-500/20" :
                    isComplete ? "bg-emerald-500/10 border border-emerald-500/20" :
                    "bg-white/[0.02] border border-white/5"
                  }`}
                >
                  <div className="flex-shrink-0">
                    {isComplete ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : isActive ? (
                      <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-zinc-700"></div>
                    )}
                  </div>
                  <span className={`text-sm font-medium ${
                    isActive ? "text-teal-300" :
                    isComplete ? "text-emerald-300" :
                    "text-zinc-600"
                  }`}>
                    {step.label}
                  </span>
                </motion.div>
              );
            })}
          </div>

          {/* Overall Progress Bar */}
          <div className="mb-3">
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(currentStep / processingSteps.length) * 100}%` }}
                transition={{ duration: 0.5 }}
                className="h-full bg-gradient-to-r from-teal-400 to-cyan-400 rounded-full"
              ></motion.div>
            </div>
            <p className="text-center text-sm text-zinc-500 mt-2">
              {Math.round((currentStep / processingSteps.length) * 100)}% complete
            </p>
          </div>

          {/* Info Message */}
          <p className="text-center text-xs text-teal-300/70">
            This only takes a few seconds. Please don't close this window.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
