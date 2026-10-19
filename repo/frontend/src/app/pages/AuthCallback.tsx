import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, Loader2 } from "lucide-react";
import AuthShell from "../components/marketing/AuthShell";
import type { User } from "@supabase/supabase-js";
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

        let currentUser: User | null = session?.user ?? null;

        // If session is not immediately ready, wait for onAuthStateChange
        if (!currentUser) {
          const authUser = await new Promise<User | null>((resolve) => {
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

  if (errorMsg) {
    return (
      <AuthShell title="Sign-in failed" subtitle="We couldn't finish signing you in.">
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <span>{errorMsg}</span>
        </div>
        <button onClick={() => navigate("/signin")} className="lv-btn w-full min-h-12 text-base">
          Return to sign in
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Completing sign in..."
      subtitle="Please wait while we finalize your account session."
      icon={<Loader2 className="h-8 w-8 animate-spin text-lv-accent" aria-hidden="true" />}
    >
      <p className="sr-only" role="status">Signing you in</p>
    </AuthShell>
  );
}
