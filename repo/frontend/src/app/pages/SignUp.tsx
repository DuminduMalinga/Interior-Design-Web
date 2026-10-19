import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
import AuthShell from "../components/marketing/AuthShell";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabaseClient";

interface SignUpFormData {
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export default function SignUp() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [usernameCheck, setUsernameCheck] = useState<"checking" | "available" | "taken" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const usernameCheckTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usernameCheckRequestId = useRef(0);

  const handleGoogleSignUp = async () => {
    setSubmitError(null);
    setIsGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setSubmitError(error.message);
        setIsGoogleLoading(false);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to initiate Google sign-up");
      setIsGoogleLoading(false);
    }
  };

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SignUpFormData>({
    mode: "onChange",
  });

  const password = watch("password", "");
  const confirmPassword = watch("confirmPassword", "");
  const username = watch("username", "");

  const checkUsername = (value: string) => {
    const trimmedValue = value.trim();

    if (usernameCheckTimeout.current) {
      clearTimeout(usernameCheckTimeout.current);
    }

    if (trimmedValue.length < 3) {
      setUsernameCheck(null);
      return;
    }

    const requestId = ++usernameCheckRequestId.current;
    setUsernameCheck("checking");
    usernameCheckTimeout.current = setTimeout(async () => {
      const { data: isAvailable, error } = await supabase.rpc("check_username_available", {
        p_username: trimmedValue,
      });

      if (requestId !== usernameCheckRequestId.current) {
        return;
      }

      if (error || typeof isAvailable !== "boolean") {
        console.error("Username lookup failed:", error ? error.message : "Invalid response");
        setUsernameCheck(null);
        return;
      }

      setUsernameCheck(isAvailable ? "available" : "taken");
    }, 400);
  };

  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { strength: 0, label: "" };
    let strength = 0;
    if (pwd.length >= 8) strength += 25;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength += 25;
    if (/\d/.test(pwd)) strength += 25;
    if (/[^A-Za-z0-9]/.test(pwd)) strength += 25;

    if (strength <= 25) return { strength, label: "Weak", color: "from-red-500 to-red-600" };
    if (strength <= 50) return { strength, label: "Fair", color: "from-amber-500 to-amber-600" };
    if (strength <= 75) return { strength, label: "Good", color: "from-yellow-500 to-yellow-600" };
    return { strength, label: "Strong", color: "from-emerald-500 to-emerald-600" };
  };

  const passwordStrength = getPasswordStrength(password);

  const validatePassword = (value: string) => {
    if (value.length < 8) return false;
    if (!/[a-z]/.test(value)) return false;
    if (!/[A-Z]/.test(value)) return false;
    if (!/\d/.test(value)) return false;
    if (!/[^A-Za-z0-9]/.test(value)) return false;
    return true;
  };

  const onSubmit = async (data: SignUpFormData) => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const normalizedUsername = data.username.trim();
      const normalizedEmail = data.email.trim();

      const { data: isAvailable, error: usernameError } = await supabase.rpc(
        "check_username_available",
        {
          p_username: normalizedUsername,
        }
      );

      if (usernameError) {
        setSubmitError(usernameError.message);
        return;
      }

      if (!isAvailable) {
        setSubmitError("Username already exists");
        return;
      }

      const { data: authData, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: data.password,
        options: {
          data: {
            full_name: data.fullName.trim(),
            username: normalizedUsername,
          },
        },
      });
      if (error) {
        setSubmitError(error.message);
        return;
      }

      if (!authData.user) {
        setSubmitError("Account creation did not return a user record");
        return;
      }

      navigate("/signin");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Register to start designing optimized 3D bedroom layouts." wide>
        {submitError && (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            {submitError}
          </div>
        )}

        {/* Google Sign Up Button */}
        <motion.button
          whileHover={!isGoogleLoading ? { scale: 1.01 } : {}}
          whileTap={!isGoogleLoading ? { scale: 0.99 } : {}}
          type="button"
          onClick={handleGoogleSignUp}
          disabled={isGoogleLoading || isSubmitting}
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
          <span>{isGoogleLoading ? "Connecting to Google..." : "Sign up with Google"}</span>
        </motion.button>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 h-px bg-lv-line" />
          <span className="text-xs text-lv-muted">or</span>
          <div className="flex-1 h-px bg-lv-line" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid items-start gap-4 sm:grid-cols-2">
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-lv-ink mb-1.5">Full Name</label>
            <input
              {...register("fullName", {
                required: "Full name is required",
                minLength: { value: 2, message: "Name must be at least 2 characters" },
              })}
              type="text"
              placeholder="Enter your full name"
              className="lv-input"
            />
            {errors.fullName && (
              <div className="flex items-center gap-1 mt-1 text-red-400 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{errors.fullName.message}</span>
              </div>
            )}
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-lv-ink mb-1.5">Username</label>
            <input
              {...register("username", {
                required: "Username is required",
                minLength: { value: 3, message: "Username must be at least 3 characters" },
                pattern: {
                  value: /^[a-zA-Z0-9_]+$/,
                  message: "Username can only contain letters, numbers, and underscores",
                },
                onChange: (e) => checkUsername(e.target.value),
              })}
              type="text"
              placeholder="Choose a username"
              className="lv-input"
            />
            {errors.username && (
              <div className="flex items-center gap-1 mt-1 text-red-400 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{errors.username.message}</span>
              </div>
            )}
            {!errors.username && usernameCheck === "available" && username.length >= 3 && (
              <div className="flex items-center gap-1 mt-1 text-emerald-400 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Username available</span>
              </div>
            )}
            {!errors.username && usernameCheck === "taken" && (
              <div className="flex items-center gap-1 mt-1 text-red-400 text-sm">
                <XCircle className="w-4 h-4" />
                <span>Username already exists</span>
              </div>
            )}
          </div>

          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-lv-ink mb-1.5">Email</label>
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
              className="lv-input"
            />
            {errors.email && (
              <div className="flex items-center gap-1 mt-1 text-red-400 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{errors.email.message}</span>
              </div>
            )}
          </div>

          <div className="grid items-start gap-4 sm:grid-cols-2">
          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-lv-ink mb-1.5">Password</label>
            <div className="relative">
              <input
                {...register("password", {
                  required: "Password is required",
                  validate: (value) =>
                    validatePassword(value) ||
                    "Password must contain at least 8 characters, uppercase, lowercase, number, and special character",
                })}
                type={showPassword ? "text" : "password"}
                placeholder="Create a password"
                className="lv-input pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lv-muted hover:text-lv-ink"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            
            {/* Password Strength Indicator */}
            {password && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-lv-muted">Password Strength</span>
                  <span className={`text-xs font-semibold ${
                    passwordStrength.strength === 100 ? "text-emerald-400" :
                    passwordStrength.strength >= 75 ? "text-yellow-400" :
                    passwordStrength.strength >= 50 ? "text-amber-400" :
                    "text-red-400"
                  }`}>
                    {passwordStrength.label}
                  </span>
                </div>
                <div className="w-full h-2 bg-lv-line rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${passwordStrength.strength}%` }}
                    transition={{ duration: 0.3 }}
                    className={`h-full bg-gradient-to-r ${passwordStrength.color} rounded-full`}
                  ></motion.div>
                </div>
              </div>
            )}

            {errors.password && (
              <div className="flex items-start gap-1 mt-2 text-red-400 text-sm">
                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{errors.password.message}</span>
              </div>
            )}
            {!errors.password && password && validatePassword(password) && (
              <div className="flex items-center gap-1 mt-2 text-emerald-400 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Strong password</span>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-lv-ink mb-1.5">Confirm Password</label>
            <div className="relative">
              <input
                {...register("confirmPassword", {
                  required: "Please confirm your password",
                  validate: (value) =>
                    value === password || "Passwords do not match",
                })}
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Re-enter password"
                className="lv-input pr-12"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lv-muted hover:text-lv-ink"
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {errors.confirmPassword && (
              <div className="flex items-center gap-1 mt-1 text-red-400 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{errors.confirmPassword.message}</span>
              </div>
            )}
            {!errors.confirmPassword && confirmPassword && confirmPassword === password && (
              <div className="flex items-center gap-1 mt-1 text-emerald-400 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Passwords match</span>
              </div>
            )}
          </div>

          </div>

          {/* Register Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={isSubmitting}
            className="lv-btn w-full min-h-12 text-base mt-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Creating Account..." : "Register"}
          </motion.button>
        </form>

        {/* Sign In Link */}
        <div className="text-center mt-5">
          <p className="text-lv-muted">
            Already have an account?{" "}
            <button
              onClick={() => navigate("/signin")}
              className="lv-link"
            >
              Sign In
            </button>
          </p>
        </div>
    </AuthShell>
  );
}
