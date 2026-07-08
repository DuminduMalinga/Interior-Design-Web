import { useState } from "react";
import { useForm } from "react-hook-form";
import { Box, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";

interface ForgotPasswordFormData {
  email: string;
}

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    mode: "onSubmit",
  });

  const onSubmit = (data: ForgotPasswordFormData) => {
    console.log("Password reset requested for:", data.email);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen w-full bg-[#0a0a0f] flex items-center justify-center p-4 relative overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="absolute -top-40 -right-40 w-[400px] h-[400px] bg-emerald-500/8 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute inset-0 dot-grid" />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative w-full max-w-[450px] glass-card rounded-3xl shadow-2xl shadow-black/50 p-8 md:p-10 text-center"
        >
          <div className="flex justify-center mb-6">
            <div className="bg-emerald-500/10 p-4 rounded-full border border-emerald-500/20">
              <CheckCircle2 className="w-16 h-16 text-emerald-400" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white mb-3">
            Check Your Email
          </h2>
          <p className="text-zinc-500 mb-8">
            We've sent password reset instructions to your email address. Please check your inbox and follow the link to reset your password.
          </p>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate("/signin")}
            className="w-full px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white font-semibold rounded-xl shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 transition-all duration-300"
          >
            Back to Sign In
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] flex items-center justify-center p-4 relative overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="absolute -top-40 -left-40 w-[400px] h-[400px] bg-violet-500/8 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-[400px] h-[400px] bg-teal-500/8 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute inset-0 dot-grid" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative w-full max-w-[450px] glass-card rounded-3xl shadow-2xl shadow-black/50 p-8 md:p-10"
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <motion.div
            whileHover={{ scale: 1.05, rotate: 5 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="relative cursor-pointer"
            onClick={() => navigate("/")}
          >
            <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-5 rounded-2xl shadow-lg shadow-teal-500/20">
              <Box className="w-12 h-12 text-white" strokeWidth={1.5} />
            </div>
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-violet-500 rounded-full animate-pulse"></div>
          </motion.div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold bg-gradient-to-r from-teal-300 to-cyan-400 bg-clip-text text-transparent mb-2">
            Forgot Password?
          </h2>
          <p className="text-zinc-500">
            Enter your email address and we'll send you instructions to reset your password.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm font-semibold text-zinc-400 mb-2">
              Email Address
            </label>
            <input
              {...register("email", {
                required: "Email is required",
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: "Invalid email format",
                },
              })}
              type="email"
              placeholder="your.email@example.com"
              className={`w-full px-4 py-3 bg-white/5 border rounded-xl outline-none transition-all duration-200 text-white placeholder-zinc-600 ${
                errors.email
                  ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  : "border-white/10 focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20"
              }`}
            />
            {errors.email && (
              <p className="mt-2 text-red-400 text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.email.message}
              </p>
            )}
          </div>

          {/* Submit Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            className="w-full px-6 py-4 bg-gradient-to-r from-teal-500 to-teal-600 text-white text-lg font-semibold rounded-xl shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 hover:from-teal-400 hover:to-teal-500 transition-all duration-300"
          >
            Send Reset Instructions
          </motion.button>
        </form>

        {/* Back to Sign In */}
        <div className="text-center mt-6">
          <button
            onClick={() => navigate("/signin")}
            className="inline-flex items-center gap-2 text-teal-400 font-semibold hover:text-teal-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sign In
          </button>
        </div>
      </motion.div>
    </div>
  );
}
