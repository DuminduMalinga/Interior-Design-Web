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

type UserPasswordRow = {
  UserID: string;
  Password: string;
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

    const loadRecoveryUser = async () => {
      setProfileError(null);
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!isMounted) {
        return;
      }

      if (userError) {
        setProfileError(userError.message);
        setIsLoadingProfile(false);
        return;
      }

      if (!user) {
        setProfileError("This password reset link is invalid or expired. Please request a new reset link.");
        setIsLoadingProfile(false);
        return;
      }

      const metadata = user.user_metadata as Record<string, unknown> | undefined;
      const fallbackUsername =
        typeof metadata?.username === "string" ? metadata.username : user.email?.split("@")[0] ?? "user";

      const { data: userRow, error: userRowError } = await supabase
        .from("User")
        .select("UserName, Email")
        .eq("UserID", user.id)
        .maybeSingle();

      if (!isMounted) {
        return;
      }

      if (userRowError) {
        setProfileError(`Profile lookup failed: ${userRowError.message}`);
      }

      setProfile({
        userId: user.id,
        username: userRow?.UserName ?? fallbackUsername,
        email: userRow?.Email ?? user.email ?? "",
      });
      setIsLoadingProfile(false);
    };

    void loadRecoveryUser();

    return () => {
      isMounted = false;
    };
  }, []);

  const onSubmit = async (data: ResetPasswordFormData) => {
    setSubmitError(null);

    if (!profile?.userId) {
      setSubmitError("Unable to identify your account from this reset link. Please request a new link.");
      return;
    }

    setIsSubmitting(true);
    const { error: authError } = await supabase.auth.updateUser({
      password: data.newPassword,
    });

    if (authError) {
      setSubmitError(authError.message);
      setIsSubmitting(false);
      return;
    }

    // IMPORTANT: updateUser() can rotate the session token. Re-sync the
    // client's session before making any further authenticated requests,
    // otherwise RLS may silently treat subsequent queries as anon and
    // return zero rows (no error, just empty data).
    const { data: refreshedSession, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError || !refreshedSession?.session) {
      setSubmitError(
        "Password was updated, but your session could not be refreshed to sync the database record. Please sign in with your new password."
      );
      setIsSubmitting(false);
      return;
    }

    const currentUserId = refreshedSession.session.user.id;

    // Try to locate the user row in the `User` table by UserID first, then by Email
    try {
      let foundRow: UserPasswordRow | null = null;

      if (currentUserId) {
        const { data: byId, error: byIdError } = await supabase
          .from("User")
          .select("UserID, Password")
          .eq("UserID", currentUserId)
          .maybeSingle();

        if (byIdError) {
          setSubmitError(`Password was updated, but lookup by UserID failed: ${byIdError.message}`);
          setIsSubmitting(false);
          return;
        }

        foundRow = (byId ?? null) as UserPasswordRow | null;
      }

      if (!foundRow && profile?.email) {
        const { data: byEmail, error: byEmailError } = await supabase
          .from("User")
          .select("UserID, Password")
          .eq("Email", profile.email)
          .maybeSingle();

        if (byEmailError) {
          setSubmitError(`Password was updated, but lookup by Email failed: ${byEmailError.message}`);
          setIsSubmitting(false);
          return;
        }

        foundRow = (byEmail ?? null) as UserPasswordRow | null;
      }

      if (!foundRow) {
        setSubmitError("Password was updated, but no matching database user row was found to sync.");
        setIsSubmitting(false);
        return;
      }

      const { data: updatedRows, error: updateError } = await supabase
        .from("User")
        .update({ Password: data.newPassword })
        .eq("UserID", foundRow.UserID)
        .select("UserID, Password");

      if (updateError) {
        setSubmitError(`Password was updated, but database sync failed: ${updateError.message}`);
        setIsSubmitting(false);
        return;
      }

      const rows = (updatedRows ?? []) as UserPasswordRow[];
      if (rows.length === 0) {
        setSubmitError("Password was updated, but database verification failed. Please try again.");
        setIsSubmitting(false);
        return;
      }

      if (rows.some((row) => row.Password !== data.newPassword)) {
        setSubmitError("Password was updated, but database verification failed. Please try again.");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitted(true);
      setIsSubmitting(false);
    } catch (err: unknown) {
      setSubmitError(typeof err === "string" ? err : "An unexpected error occurred while syncing the password.");
      setIsSubmitting(false);
      return;
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