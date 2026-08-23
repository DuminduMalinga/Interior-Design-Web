import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabaseClient";

interface ResetPasswordFormData {
  newPassword: string;
  confirmNewPassword: string;
}

type ResetProfile = {
  userId: string;
  username: string;
  email: string;
};

const validatePassword = (value: string) => {
  if (value.length < 8) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/\d/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
};

export default function ResetPassword() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ResetProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    mode: "onSubmit",
  });

  const newPassword = watch("newPassword", "");

  useEffect(() => {
    let isMounted = true;

    const setupRecoverySession = async (user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null) => {
      if (!user) {
        if (isMounted) {
          setProfile(null);
          setProfileError("This password reset link is invalid or expired. Please request a new reset link.");
          setIsLoadingProfile(false);
        }
        return;
      }

      if (isMounted) {
        setProfileError(null);
      }

      const metadata = user.user_metadata as Record<string, unknown> | undefined;
      const fallbackUsername =
        typeof metadata?.username === "string" ? metadata.username : user.email?.split("@")[0] ?? "user";

      try {
        const { data: userRow, error: userRowError } = await supabase
          .from("User")
          .select("UserName, Email")
          .eq("UserID", user.id)
          .maybeSingle();

        if (!isMounted) return;

        if (userRowError) {
          console.warn("Profile lookup failed:", userRowError.message);
        }

        setProfile({
          userId: user.id,
          username: userRow?.UserName ?? fallbackUsername,
          email: userRow?.Email ?? user.email ?? "",
        });
      } catch {
        if (!isMounted) return;
        setProfile({
          userId: user.id,
          username: fallbackUsername,
          email: user.email ?? "",
        });
      } finally {
        if (isMounted) {
          setIsLoadingProfile(false);
        }
      }
    };

    // 1. Initial check
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (!isMounted) return;
      if (!error && user) {
        void setupRecoverySession(user);
      }
    });

    // 2. Listen for auth state changes (e.g. PASSWORD_RECOVERY event)
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        if (session?.user) {
          void setupRecoverySession(session.user);
        }
      } else if (event === "SIGNED_OUT") {
        setProfile(null);
        setProfileError("This password reset link is invalid or expired. Please request a new reset link.");
        setIsLoadingProfile(false);
      }
    });

    const timer = setTimeout(async () => {
      if (!isMounted) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session && isMounted) {
        setIsLoadingProfile(false);
        setProfileError((prev) => prev || "This password reset link is invalid or expired. Please request a new reset link.");
      }
    }, 1500);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      authListener.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (data: ResetPasswordFormData) => {
    setSubmitError(null);

    if (!profile?.userId) {
      setSubmitError("Unable to identify your account from this reset link. Please request a new link.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({
        password: data.newPassword,
      });

      if (authError) {
        setSubmitError(authError.message);
        return;
      }

      setIsSubmitted(true);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "An unexpected error occurred while updating the password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
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
          <h2 className="text-2xl font-bold text-white mb-3">Password Updated</h2>
          <p className="text-zinc-500 mb-8">Your password has been reset successfully. You can now sign in with your new password.</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate("/signin")}
            className="w-full px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white font-semibold rounded-xl shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 transition-all duration-300"
          >
            Go to Sign In
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
        className="relative w-full max-w-[500px] glass-card rounded-3xl shadow-2xl shadow-black/50 p-8 md:p-10"
      >
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

        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold bg-gradient-to-r from-teal-300 to-cyan-400 bg-clip-text text-transparent mb-2">
            Reset Password
          </h2>
          <p className="text-zinc-500">Set your new password for your account.</p>
        </div>

        {isLoadingProfile ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
            Loading account details...
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {profileError && (
              <div className="flex items-start gap-2 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <AlertCircle className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-200">{profileError}</p>
              </div>
            )}

            {submitError && (
              <div className="flex items-start gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-300">{submitError}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-zinc-400 mb-2">Username</label>
              <input
                type="text"
                value={profile?.username ?? ""}
                readOnly
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-zinc-300 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-zinc-400 mb-2">Email Address</label>
              <input
                type="email"
                value={profile?.email ?? ""}
                readOnly
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-zinc-300 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-zinc-400 mb-2">New Password</label>
              <div className="relative">
                <input
                  {...register("newPassword", {
                    required: "New password is required",
                    validate: (value) =>
                      validatePassword(value) ||
                      "Password must contain at least 8 characters, uppercase, lowercase, number, and special character",
                  })}
                  type={showNewPassword ? "text" : "password"}
                  placeholder="Enter your new password"
                  className={`w-full px-4 py-3 pr-12 bg-white/5 border rounded-xl outline-none transition-all duration-200 text-white placeholder-zinc-600 ${
                    errors.newPassword
                      ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                      : "border-white/10 focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.newPassword && (
                <div className="flex items-center gap-1 mt-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  <span>{errors.newPassword.message}</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-zinc-400 mb-2">Confirm New Password</label>
              <div className="relative">
                <input
                  {...register("confirmNewPassword", {
                    required: "Please confirm your new password",
                    validate: (value) => value === newPassword || "Passwords do not match",
                  })}
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your new password"
                  className={`w-full px-4 py-3 pr-12 bg-white/5 border rounded-xl outline-none transition-all duration-200 text-white placeholder-zinc-600 ${
                    errors.confirmNewPassword
                      ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                      : "border-white/10 focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.confirmNewPassword && (
                <div className="flex items-center gap-1 mt-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  <span>{errors.confirmNewPassword.message}</span>
                </div>
              )}
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isSubmitting || !profile?.userId}
              className="w-full px-6 py-4 bg-gradient-to-r from-teal-500 to-teal-600 text-white text-lg font-semibold rounded-xl shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 hover:from-teal-400 hover:to-teal-500 transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Updating Password..." : "Update Password"}
            </motion.button>
          </form>
        )}

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