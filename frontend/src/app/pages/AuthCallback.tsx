import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Box, AlertCircle, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { supabase } from "../lib/supabaseClient";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const processOAuthCallback = async () => {
      try {
        // Check for error parameters in the URL query or hash
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const errorDescription =
          urlParams.get("error_description") ||
          hashParams.get("error_description") ||
          urlParams.get("error") ||
          hashParams.get("error");

        if (errorDescription) {
          if (isMounted) setErrorMsg(errorDescription);
          return;
        }

        // Retrieve current session
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          if (isMounted) setErrorMsg(sessionError.message);
          return;
        }

        let currentUser = session?.user;

        // If session is not immediately ready, wait for onAuthStateChange
        if (!currentUser) {
          const authUser = await new Promise<typeof currentUser>((resolve) => {
            const timeout = setTimeout(() => {
              resolve(null);
            }, 5000);

            const {
              data: { subscription },
            } = supabase.auth.onAuthStateChange((event, newSession) => {
              if (event === "SIGNED_IN" && newSession?.user) {
                clearTimeout(timeout);
                subscription.unsubscribe();
                resolve(newSession.user);
              }
            });
          });

          currentUser = authUser;
        }

        if (!currentUser) {
          if (isMounted) {
            setErrorMsg("Authentication session could not be established. Please try signing in again.");
          }
          return;
        }

        // Fetch user profile with retry defense for newly inserted trigger profiles
        let userRow: { Role: string | null } | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data, error: profileErr } = await supabase
            .from("User")
            .select("Role")
            .eq("UserID", currentUser.id)
            .maybeSingle();

          if (profileErr) {
            console.warn("Profile query retry attempt failed:", profileErr.message);
          }

          if (data) {
            userRow = data;
            break;
          }

          await new Promise((res) => setTimeout(res, 400));
        }

        if (!isMounted) return;

        const rawRole = userRow?.Role;
        const role = typeof rawRole === "string" ? rawRole.trim().toLowerCase() : "customer";

        if (role === "admin") {
          navigate("/admin/accounts", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      } catch (err) {
        if (isMounted) {
          setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred during sign-in.");
        }
      }
    };

    void processOAuthCallback();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  return (
    <div
      className="min-h-screen w-full bg-[#0a0a0f] flex items-center justify-center p-4 relative overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Ambient orbs */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-teal-500/8 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-[400px] h-[400px] bg-violet-500/8 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute inset-0 dot-grid" />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-[420px] glass-card rounded-3xl shadow-2xl shadow-black/50 p-8 md:p-10 text-center"
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-5 rounded-2xl shadow-lg shadow-teal-500/20">
            <Box className="w-12 h-12 text-white" strokeWidth={1.5} />
          </div>
        </div>

        {errorMsg ? (
          <div>
            <div className="flex items-center justify-center gap-2 p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => navigate("/signin")}
              className="w-full px-6 py-3 bg-white/10 hover:bg-white/15 text-white font-semibold rounded-xl transition-all duration-200"
            >
              Return to Sign In
            </button>
          </div>
        ) : (
          <div>
            <div className="flex justify-center mb-4">
              <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Completing Sign In...</h2>
            <p className="text-zinc-500 text-sm">Please wait while we finalize your account session.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
