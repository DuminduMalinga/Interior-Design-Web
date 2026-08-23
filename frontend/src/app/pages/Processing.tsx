import { useEffect, useState } from "react";
import { Box, CheckCircle2, Loader2, LogOut, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";

export default function Processing() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const { profile, signOut } = useCurrentUserProfile();

  const handleLogout = async () => {
    const success = await signOut();
    if (success) {
      navigate("/");
    }
  };

  const username = profile.username;

  const processingSteps = [
    { label: "Analyzing floor plan image", duration: 2000 },
    { label: "Detecting room boundaries", duration: 2000 },
    { label: "Identifying walls, doors, and windows", duration: 2000 },
    { label: "Calculating optimal furniture placement", duration: 2000 },
    { label: "Generating 3D visualization", duration: 2000 },
  ];

  useEffect(() => {
    if (currentStep < processingSteps.length) {
      const timer = setTimeout(() => {
        setCurrentStep(currentStep + 1);
      }, processingSteps[currentStep].duration);
      return () => clearTimeout(timer);
    } else {
      setTimeout(() => {
        navigate("/select-room");
      }, 1500);
    }
  }, [currentStep, processingSteps, navigate]);

  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] relative overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Navigation */}
      <nav className="relative glass-nav z-20">
        <div className="px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-2.5 rounded-xl shadow-lg shadow-teal-500/20">
              <Box className="w-6 h-6 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">3D Layout System</h1>
              <p className="text-xs text-zinc-500">AI-Powered Design</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:block text-right">
              <p className="text-sm text-zinc-500">Welcome back,</p>
              <p className="font-semibold text-white">{username} 👋</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors duration-200"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </motion.button>
          </div>
        </div>
      </nav>

      {/* Ambient orbs */}
      <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-teal-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-violet-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Content */}
      <main className="relative flex items-center justify-center p-4 md:p-8 min-h-[calc(100vh-73px)]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-2xl glass-card rounded-3xl shadow-2xl shadow-black/50 p-8 md:p-12"
        >
          {/* Processing Icon */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-6 rounded-2xl shadow-lg shadow-teal-500/25">
                <Sparkles className="w-16 h-16 text-white" strokeWidth={1.5} />
              </div>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute -top-2 -right-2"
              >
                <Loader2 className="w-8 h-8 text-teal-400" />
              </motion.div>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-3xl font-bold text-center bg-gradient-to-r from-teal-300 to-cyan-400 bg-clip-text text-transparent mb-3">
            Processing Your Floor Plan
          </h2>
          <p className="text-center text-zinc-500 mb-8">
            Our AI is analyzing your floor plan and creating optimized layouts...
          </p>

          {/* Processing Steps */}
          <div className="space-y-3 mb-8">
            {processingSteps.map((step, index) => {
              const isComplete = index < currentStep;
              const isActive = index === currentStep;

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`flex items-center gap-4 p-4 rounded-xl transition-all duration-300 ${
                    isActive ? "bg-teal-500/10 border border-teal-500/20" :
                    isComplete ? "bg-emerald-500/10 border border-emerald-500/20" :
                    "bg-white/[0.02] border border-white/5"
                  }`}
                >
                  <div className="flex-shrink-0">
                    {isComplete ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                    ) : isActive ? (
                      <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-zinc-700"></div>
                    )}
                  </div>
                  <span className={`font-medium ${
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
          <div className="mb-4">
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
          <div className="bg-teal-500/5 border border-teal-500/10 rounded-xl p-4 text-center">
            <p className="text-sm text-teal-300/70">
              This process typically takes 10-20 seconds. Please don't close this window.
            </p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
