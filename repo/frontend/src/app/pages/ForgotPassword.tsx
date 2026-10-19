import { useState } from "react";
import { useForm } from "react-hook-form";
import { ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import AuthShell from "../components/marketing/AuthShell";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabaseClient";

interface ForgotPasswordFormData {
  email: string;
}

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    mode: "onSubmit",
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsSending(true);
    setSubmitError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setSubmitError(error.message);
      setIsSending(false);
      return;
    }

    setSubmitted(true);
    setIsSending(false);
  };

  if (submitted) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="We've sent password reset instructions to your email address. Please check your inbox and follow the link to reset your password."
        icon={
          <span className="grid h-12 w-12 place-items-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" aria-hidden="true" />
          </span>
        }
      >
        <button onClick={() => navigate("/signin")} className="lv-btn w-full min-h-12 text-base">
          Back to sign in
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password?" subtitle="Enter your email address and we'll send you instructions to reset your password.">
        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {submitError && (
            <div className="flex items-start gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-300">{submitError}</p>
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-lv-ink mb-1.5">
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
              className={`lv-input ${
                errors.email
                  ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  : ""
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
            className="lv-btn w-full min-h-12 text-base"
            disabled={isSending}
          >
            {isSending ? "Sending..." : "Send Reset Instructions"}
          </motion.button>
        </form>

        {/* Back to Sign In */}
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
