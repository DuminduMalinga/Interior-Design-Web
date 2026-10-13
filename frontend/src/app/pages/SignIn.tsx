import { useState } from "react";
import { useForm } from "react-hook-form";
import { Eye, EyeOff, AlertCircle } from "lucide-react";
import AuthShell from "../components/marketing/AuthShell";
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
    <AuthShell title="Welcome back" subtitle="Sign in to continue designing your optimized 3D layouts.">
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
          className="lv-btn-quiet w-full min-h-11 gap-3 mb-4"
        >
          {isGoogleLoading ? (
            <div className="w-5 h-5 border-2 border-lv-accent border-t-transparent rounded-full animate-spin" />
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
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 h-px bg-lv-line" />
          <span className="text-xs text-lv-muted">or</span>
          <div className="flex-1 h-px bg-lv-line" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-lv-ink mb-1.5">
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
              className={`lv-input ${
                errors.email
                  ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  : ""
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
              <label className="block text-sm font-medium text-lv-ink">
                Password
              </label>
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                className="text-xs lv-link"
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
                className={`lv-input pr-12 ${
                  errors.password
                    ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                    : ""
                } ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLocked}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lv-muted hover:text-lv-ink disabled:opacity-50"
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
            className={`lv-btn w-full min-h-12 text-base mt-2 ${
              isLocked || isSubmitting
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            {isLocked ? "Account Locked" : isSubmitting ? "Signing In..." : "Sign In"}
          </motion.button>
        </form>

        {/* Sign Up Link */}
        <div className="text-center mt-5">
          <p className="text-lv-muted">
            Don't have an account?{" "}
            <button
              onClick={() => navigate("/signup")}
              className="lv-link"
            >
              Sign Up
            </button>
          </p>
        </div>
    </AuthShell>
  );
}