import { useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
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

  // Mock username check (simulating API call)
  const checkUsername = (value: string) => {
    if (value.length < 3) return;
    
    setUsernameCheck("checking");
    setTimeout(() => {
      // Mock: usernames starting with 'admin' are taken
      if (value.toLowerCase().startsWith("admin")) {
        setUsernameCheck("taken");
      } else {
        setUsernameCheck("available");
      }
    }, 500);
  };

  // Password strength calculation
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { strength: 0, label: "" };
    
    let strength = 0;
    if (pwd.length >= 8) strength += 25;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength += 25;
    if (/\d/.test(pwd)) strength += 25;
    if (/[^A-Za-z0-9]/.test(pwd)) strength += 25;

    if (strength <= 25) return { strength, label: "Weak", color: "bg-red-500" };
    if (strength <= 50) return { strength, label: "Fair", color: "bg-orange-500" };
    if (strength <= 75) return { strength, label: "Good", color: "bg-yellow-500" };
    return { strength, label: "Strong", color: "bg-green-500" };
  };

  const passwordStrength = getPasswordStrength(password);

  // Password validation
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
      const { data: authData, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            full_name: data.fullName,
            username: data.username,
          },
        },
      });

      if (error) {
        setSubmitError(error.message);
        return;
      }

      if (authData.user) {
        const { error: profileError } = await supabase.from("User").insert({
          UserID: authData.user.id,
          Name: data.fullName,
          Email: data.email,
          Role: "user",
        });

        if (profileError) {
          console.error("Profile insert failed:", profileError.message);
        }
      }

      navigate("/signin");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated Blueprint Pattern Background */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(99, 102, 241, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99, 102, 241, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      {/* Sign Up Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative w-full max-w-[500px] bg-white rounded-3xl shadow-2xl p-8 md:p-10"
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <motion.div
            whileHover={{ scale: 1.05, rotate: 5 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="relative"
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
            Create Your Account
          </h2>
          <p className="text-gray-600">
            Register to start designing optimized 3D bedroom layouts.
          </p>
        </div>

        {submitError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {submitError}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Full Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Full Name
            </label>
            <input
              {...register("fullName", {
                required: "Full name is required",
                minLength: { value: 2, message: "Name must be at least 2 characters" },
              })}
              type="text"
              placeholder="Enter your full name"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all duration-200"
            />
            {errors.fullName && (
              <div className="flex items-center gap-1 mt-1 text-red-600 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{errors.fullName.message}</span>
              </div>
            )}
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Username
            </label>
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
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all duration-200"
            />
            {errors.username && (
              <div className="flex items-center gap-1 mt-1 text-red-600 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{errors.username.message}</span>
              </div>
            )}
            {!errors.username && usernameCheck === "available" && username.length >= 3 && (
              <div className="flex items-center gap-1 mt-1 text-green-600 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Username available</span>
              </div>
            )}
            {!errors.username && usernameCheck === "taken" && (
              <div className="flex items-center gap-1 mt-1 text-red-600 text-sm">
                <XCircle className="w-4 h-4" />
                <span>Username already exists</span>
              </div>
            )}
          </div>

          {/* Email */}
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
              placeholder="your.email@example.com"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all duration-200"
            />
            {errors.email && (
              <div className="flex items-center gap-1 mt-1 text-red-600 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{errors.email.message}</span>
              </div>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Password
            </label>
            <div className="relative">
              <input
                {...register("password", {
                  required: "Password is required",
                  validate: (value) =>
                    validatePassword(value) ||
                    "Password must contain at least 8 characters, uppercase, lowercase, number, and special character",
                })}
                type={showPassword ? "text" : "password"}
                placeholder="Create a strong password"
                className="w-full px-4 py-3 pr-12 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all duration-200"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            
            {/* Password Strength Indicator */}
            {password && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600">Password Strength</span>
                  <span className={`text-xs font-semibold ${
                    passwordStrength.strength === 100 ? "text-green-600" :
                    passwordStrength.strength >= 75 ? "text-yellow-600" :
                    passwordStrength.strength >= 50 ? "text-orange-600" :
                    "text-red-600"
                  }`}>
                    {passwordStrength.label}
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${passwordStrength.strength}%` }}
                    transition={{ duration: 0.3 }}
                    className={`h-full ${passwordStrength.color} rounded-full`}
                  ></motion.div>
                </div>
              </div>
            )}

            {errors.password && (
              <div className="flex items-start gap-1 mt-2 text-red-600 text-sm">
                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{errors.password.message}</span>
              </div>
            )}
            {!errors.password && password && validatePassword(password) && (
              <div className="flex items-center gap-1 mt-2 text-green-600 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Strong password</span>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Confirm Password
            </label>
            <div className="relative">
              <input
                {...register("confirmPassword", {
                  required: "Please confirm your password",
                  validate: (value) =>
                    value === password || "Passwords do not match",
                })}
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Re-enter your password"
                className="w-full px-4 py-3 pr-12 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all duration-200"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showConfirmPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {errors.confirmPassword && (
              <div className="flex items-center gap-1 mt-1 text-red-600 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{errors.confirmPassword.message}</span>
              </div>
            )}
            {!errors.confirmPassword && confirmPassword && confirmPassword === password && (
              <div className="flex items-center gap-1 mt-1 text-green-600 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Passwords match</span>
              </div>
            )}
          </div>

          {/* Register Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={isSubmitting}
            className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-700 text-white text-lg font-semibold rounded-xl shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-indigo-800 transition-all duration-300 mt-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Creating Account..." : "Register"}
          </motion.button>
        </form>

        {/* Sign In Link */}
        <div className="text-center mt-6">
          <p className="text-gray-600">
            Already have an account?{" "}
            <button
              onClick={() => navigate("/signin")}
              className="text-indigo-600 font-semibold hover:text-indigo-800 hover:underline transition-colors"
            >
              Sign In
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
