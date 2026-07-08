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

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInFormData>({
    mode: "onSubmit",
  });

  const handleSignIn = async (email: string, password: string) => {
    // Clear previous errors
    setLoginError(null);

    // Check if account is locked
    if (isLocked) {
      setLoginError("Account temporarily locked. Try again in 15 minutes.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

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

      console.log("Sign In successful:", email);
      setFailedAttempts(0);
      navigate("/dashboard");
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
    <div className="min-h-screen w-full bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle Grid Pattern Background */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(99, 102, 241, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99, 102, 241, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      {/* Sign In Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative w-full max-w-[450px] bg-white rounded-3xl shadow-2xl p-8 md:p-10"
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <motion.div
            whileHover={{ scale: 1.05, rotate: 5 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="relative cursor-pointer"
            onClick={() => navigate("/")}
          >
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-5 rounded-2xl shadow-lg">
              <Box className="w-12 h-12 text-white" strokeWidth={1.5} />
            </div>
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 rounded-full animate-pulse"></div>
          </motion.div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-700 to-indigo-700 bg-clip-text text-transparent mb-2">
            Welcome Back
          </h2>
          <p className="text-gray-600">
            Sign in to continue designing your optimized 3D layouts.
          </p>
        </div>

        {/* Global Error Message */}
        {loginError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-start gap-2 p-4 mb-6 rounded-xl ${
              isLocked ? "bg-orange-50 border border-orange-200" : "bg-red-50 border border-red-200"
            }`}
          >
            <AlertCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
              isLocked ? "text-orange-600" : "text-red-600"
            }`} />
            <span className={`text-sm ${
              isLocked ? "text-orange-700" : "text-red-700"
            }`}>
              {loginError}
            </span>
          </motion.div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Username / Email */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
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
              className={`w-full px-4 py-3 border-2 rounded-xl outline-none transition-all duration-200 ${
                errors.email
                  ? "border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100"
                  : "border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
              } ${isLocked ? "bg-gray-100 cursor-not-allowed" : ""}`}
            />
            {errors.email && (
              <div className="flex items-center gap-1 mt-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>{errors.email.message}</span>
              </div>
            )}
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-gray-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline transition-colors"
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
                className={`w-full px-4 py-3 pr-12 border-2 rounded-xl outline-none transition-all duration-200 ${
                  errors.password
                    ? "border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100"
                    : "border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                } ${isLocked ? "bg-gray-100 cursor-not-allowed" : ""}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLocked}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 disabled:opacity-50"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {errors.password && (
              <div className="flex items-center gap-1 mt-2 text-red-600 text-sm">
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
            className={`w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-700 text-white text-lg font-semibold rounded-xl shadow-lg transition-all duration-300 mt-2 ${
              isLocked || isSubmitting
                ? "opacity-50 cursor-not-allowed"
                : "hover:shadow-xl hover:from-blue-700 hover:to-indigo-800"
            }`}
          >
            {isLocked ? "Account Locked" : isSubmitting ? "Signing In..." : "Sign In"}
          </motion.button>
        </form>

        {/* Sign Up Link */}
        <div className="text-center mt-6">
          <p className="text-gray-600">
            Don't have an account?{" "}
            <button
              onClick={() => navigate("/signup")}
              className="text-indigo-600 font-semibold hover:text-indigo-800 hover:underline transition-colors"
            >
              Sign Up
            </button>
          </p>
        </div>

        {/* Back to Home */}
        <div className="text-center mt-4">
          <button
            onClick={() => navigate("/")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Back to Home
          </button>
        </div>
      </motion.div>
    </div>
  );
}