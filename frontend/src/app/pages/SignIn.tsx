import { useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Eye, EyeOff, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabaseClient";

interface SignInFormData {
  email: string;
  password: string;
}

export default function SignIn() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInFormData>({
    mode: "onSubmit",
  });

  const handleGoogleSignIn = async () => {
    setLoginError(null);
    setIsGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setLoginError(error.message);
        setIsGoogleLoading(false);
      }
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Failed to initiate Google sign-in");
      setIsGoogleLoading(false);
    }
  };

  const handleSignIn = async (email: string, password: string) => {
    setLoginError(null);
    if (isLocked) {
      setLoginError("Account temporarily locked. Try again in 15 minutes.");
      return;
    }
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const newFailedAttempts = failedAttempts + 1;
        setFailedAttempts(newFailedAttempts);
        if (newFailedAttempts >= 3) {
          setIsLocked(true);
          setLoginError("Account temporarily locked. Try again in 15 minutes.");
          setTimeout(() => {
            setIsLocked(false);
            setFailedAttempts(0);
          }, 900000);
        } else {
          setLoginError(error.message);
        }
        return;
      }

      const authUser = data.user;
      const { data: userRow, error: roleError } = authUser
        ? await supabase
            .from("User")
            .select("*")
            .eq("UserID", authUser.id)
            .maybeSingle()
        : { data: null, error: null };

      if (roleError) {
        console.warn("Role lookup failed, defaulting to dashboard:", roleError.message);
      }

      const rawRole = userRow?.Role ?? userRow?.role;
      const role = typeof rawRole === "string" ? rawRole.trim().toLowerCase() : "customer";

      console.log("Sign In successful:", email, role);
      setFailedAttempts(0);
      navigate(role === "admin" ? "/admin/accounts" : "/dashboard");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmit = (data: SignInFormData) => {
    handleSignIn(data.email, data.password);
  };

  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] flex items-center justify-center p-4 relative overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Ambient orbs */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-teal-500/8 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-[400px] h-[400px] bg-violet-500/8 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute inset-0 dot-grid" />

      {/* Sign In Card */}
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
          <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-teal-300 to-cyan-400 bg-clip-text text-transparent mb-2">
            Welcome Back
          </h2>
          <p className="text-zinc-500">
            Sign in to continue designing your optimized 3D layouts.
          </p>
        </div>

        {/* Global Error Message */}
        {loginError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-start gap-2 p-4 mb-6 rounded-xl ${
              isLocked ? "bg-amber-500/10 border border-amber-500/20" : "bg-red-500/10 border border-red-500/20"
            }`}
          >
            <AlertCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
              isLocked ? "text-amber-400" : "text-red-400"
            }`} />
            <span className={`text-sm ${
              isLocked ? "text-amber-300" : "text-red-300"
            }`}>
              {loginError}
            </span>
          </motion.div>
        )}

        {/* Google Sign In Button */}
        <motion.button
          whileHover={!isLocked && !isGoogleLoading ? { scale: 1.01 } : {}}
          whileTap={!isLocked && !isGoogleLoading ? { scale: 0.99 } : {}}
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLocked || isGoogleLoading || isSubmitting}
          className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-white font-medium transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed mb-6"
        >
          {isGoogleLoading ? (
            <div className="w-5 h-5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
              />
            </svg>
          )}
          <span>{isGoogleLoading ? "Connecting to Google..." : "Continue with Google"}</span>
        </motion.button>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs uppercase tracking-wider text-zinc-500 font-medium">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm font-semibold text-zinc-400 mb-2">
              Email
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
              placeholder="Enter your email"
              disabled={isLocked}
              className={`w-full px-4 py-3 bg-white/5 border rounded-xl outline-none transition-all duration-200 text-white placeholder-zinc-600 ${
                errors.email
                  ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  : "border-white/10 focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20"
              } ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
            />
            {errors.email && (
              <div className="flex items-center gap-1 mt-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>{errors.email.message}</span>
              </div>
            )}
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-zinc-400">
                Password
              </label>
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
              >
                Forgot Password?
              </button>
            </div>
            <div className="relative">
              <input
                {...register("password", {
                  required: "Password is required",
                })}
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                disabled={isLocked}
                className={`w-full px-4 py-3 pr-12 bg-white/5 border rounded-xl outline-none transition-all duration-200 text-white placeholder-zinc-600 ${
                  errors.password
                    ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                    : "border-white/10 focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20"
                } ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLocked}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {errors.password && (
              <div className="flex items-center gap-1 mt-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>{errors.password.message}</span>
              </div>
            )}
          </div>

          {/* Sign In Button */}
          <motion.button
            whileHover={!isLocked ? { scale: 1.02 } : {}}
            whileTap={!isLocked ? { scale: 0.98 } : {}}
            type="submit"
            disabled={isLocked || isSubmitting}
            className={`w-full px-6 py-4 bg-gradient-to-r from-teal-500 to-teal-600 text-white text-lg font-semibold rounded-xl shadow-lg shadow-teal-500/20 transition-all duration-300 mt-2 ${
              isLocked || isSubmitting
                ? "opacity-50 cursor-not-allowed"
                : "hover:shadow-teal-500/30 hover:from-teal-400 hover:to-teal-500"
            }`}
          >
            {isLocked ? "Account Locked" : isSubmitting ? "Signing In..." : "Sign In"}
          </motion.button>
        </form>

        {/* Sign Up Link */}
        <div className="text-center mt-6">
          <p className="text-zinc-500">
            Don't have an account?{" "}
            <button
              onClick={() => navigate("/signup")}
              className="text-teal-400 font-semibold hover:text-teal-300 transition-colors"
            >
              Sign Up
            </button>
          </p>
        </div>

        {/* Back to Home */}
        <div className="text-center mt-4">
          <button
            onClick={() => navigate("/")}
            className="text-sm text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            ← Back to Home
          </button>
        </div>
      </motion.div>
    </div>
  );
}