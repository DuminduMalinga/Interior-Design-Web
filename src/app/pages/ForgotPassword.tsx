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
      <div className="min-h-screen w-full bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-[450px] bg-white rounded-3xl shadow-2xl p-8 md:p-10 text-center"
        >
          <div className="flex justify-center mb-6">
            <div className="bg-green-100 p-4 rounded-full">
              <CheckCircle2 className="w-16 h-16 text-green-600" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-gray-800 mb-3">
            Check Your Email
          </h2>
          <p className="text-gray-600 mb-8">
            We've sent password reset instructions to your email address. Please check your inbox and follow the link to reset your password.
          </p>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate("/signin")}
            className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-indigo-800 transition-all duration-300"
          >
            Back to Sign In
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
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
          <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-700 to-indigo-700 bg-clip-text text-transparent mb-2">
            Forgot Password?
          </h2>
          <p className="text-gray-600">
            Enter your email address and we'll send you instructions to reset your password.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
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
              className={`w-full px-4 py-3 border-2 rounded-xl outline-none transition-all duration-200 ${
                errors.email
                  ? "border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100"
                  : "border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
              }`}
            />
            {errors.email && (
              <p className="mt-2 text-red-600 text-sm flex items-center gap-1">
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
            className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-700 text-white text-lg font-semibold rounded-xl shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-indigo-800 transition-all duration-300"
          >
            Send Reset Instructions
          </motion.button>
        </form>

        {/* Back to Sign In */}
        <div className="text-center mt-6">
          <button
            onClick={() => navigate("/signin")}
            className="inline-flex items-center gap-2 text-indigo-600 font-semibold hover:text-indigo-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sign In
          </button>
        </div>
      </motion.div>
    </div>
  );
}
