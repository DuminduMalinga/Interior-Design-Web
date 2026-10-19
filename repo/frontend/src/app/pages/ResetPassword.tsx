import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Eye, EyeOff, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import AuthShell from "../components/marketing/AuthShell";
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
      <AuthShell
        title="Password updated"
        subtitle="Your password has been reset successfully. You can now sign in with your new password."
        icon={
          <span className="grid h-12 w-12 place-items-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" aria-hidden="true" />
          </span>
        }
      >
        <button onClick={() => navigate("/signin")} className="lv-btn w-full min-h-12 text-base">
          Go to sign in
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset password" subtitle="Set your new password for your account.">
        {isLoadingProfile ? (
          <div className="rounded-xl border border-lv-line p-4 text-sm text-lv-muted">
            Loading account details...
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
              <label className="block text-sm font-medium text-lv-ink mb-1.5">Username</label>
              <input
                type="text"
                value={profile?.username ?? ""}
                readOnly
                className="lv-input opacity-70 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-lv-ink mb-1.5">Email Address</label>
              <input
                type="email"
                value={profile?.email ?? ""}
                readOnly
                className="lv-input opacity-70 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-lv-ink mb-1.5">New Password</label>
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
                  className={`lv-input pr-12 ${
                    errors.newPassword
                      ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                      : ""
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-lv-muted hover:text-lv-ink"
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
              <label className="block text-sm font-medium text-lv-ink mb-1.5">Confirm New Password</label>
              <div className="relative">
                <input
                  {...register("confirmNewPassword", {
                    required: "Please confirm your new password",
                    validate: (value) => value === newPassword || "Passwords do not match",
                  })}
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your new password"
                  className={`lv-input pr-12 ${
                    errors.confirmNewPassword
                      ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                      : ""
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-lv-muted hover:text-lv-ink"
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
              className="lv-btn w-full min-h-12 text-base disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Updating Password..." : "Update Password"}
            </motion.button>
          </form>
        )}

        <div className="text-center mt-5">
          <button
            onClick={() => navigate("/signin")}
            className="inline-flex items-center gap-2 lv-link"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sign In
          </button>
        </div>
    </AuthShell>
  );
}