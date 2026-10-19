import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export type UserProfile = {
  fullName: string;
  username: string;
  email: string;
  role: string;
  phone: string;
  location: string;
  bio: string;
};

export type UserContextValue = {
  user: User | null;
  session: Session | null;
  authStatus: AuthStatus;
  isAuthLoading: boolean;
  isProfileLoading: boolean;
  profile: UserProfile;
  isLoading: boolean;
  signOut: () => Promise<boolean>;
};

export const defaultProfile: UserProfile = {
  fullName: "User",
  username: "user",
  email: "",
  role: "Customer",
  phone: "",
  location: "",
  bio: "",
};

const UserContext = createContext<UserContextValue>({
  user: null,
  session: null,
  authStatus: "loading",
  isAuthLoading: true,
  isProfileLoading: false,
  profile: defaultProfile,
  isLoading: true,
  signOut: async () => false,
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);

  // Ref to hold the real-time channel so we can clean it up when user changes
  const watchChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Ref to hold the polling interval
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref to track the current profile loading operation ID to prevent stale race conditions
  const loadOpIdRef = useRef<number>(0);
  // Ref to track current watched user ID to prevent redundant watcher restarts
  const watchedUserIdRef = useRef<string | null>(null);

  const stopWatching = useCallback(() => {
    if (watchChannelRef.current) {
      void supabase.removeChannel(watchChannelRef.current);
      watchChannelRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    watchedUserIdRef.current = null;
  }, []);

  const forceSignOut = useCallback(async () => {
    stopWatching();
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    setUser(null);
    setSession(null);
    setAuthStatus("unauthenticated");
    setIsAuthLoading(false);
    setIsProfileLoading(false);
    setProfile(defaultProfile);
  }, [stopWatching]);

  const loadProfile = useCallback(
    async (authUser: User) => {
      const currentOpId = ++loadOpIdRef.current;
      setIsProfileLoading(true);

      const metadata = authUser.user_metadata as Record<string, unknown> | undefined;
      const fallbackFullName =
        typeof metadata?.full_name === "string" && metadata.full_name
          ? metadata.full_name
          : authUser.email?.split("@")[0] ?? "User";
      const fallbackUsername =
        typeof metadata?.username === "string" && metadata.username
          ? metadata.username
          : authUser.email?.split("@")[0] ?? "user";

      let userRow = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (loadOpIdRef.current !== currentOpId) return;

        const { data } = await supabase
          .from("User")
          .select("FullName, UserName, Email, Role, Phone, Location, Bio")
          .eq("UserID", authUser.id)
          .maybeSingle();

        if (data) {
          userRow = data;
          break;
        }

        if (attempt < 2) {
          await new Promise((res) => setTimeout(res, 300));
        }
      }

      if (loadOpIdRef.current !== currentOpId) return;

      // ── Deleted-account guard ────────────────────────────────────────────
      // Auth session exists but public."User" profile row is missing
      if (!userRow) {
        await forceSignOut();
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Setup Real-time & Polling Watchers if not already watching this user
      if (watchedUserIdRef.current !== authUser.id) {
        stopWatching();
        watchedUserIdRef.current = authUser.id;

        watchChannelRef.current = supabase
          .channel(`account-watch-${authUser.id}`)
          .on(
            "postgres_changes",
            {
              event: "DELETE",
              schema: "public",
              table: "User",
              filter: `UserID=eq.${authUser.id}`,
            },
            () => {
              void forceSignOut();
            }
          )
          .subscribe();

        pollRef.current = setInterval(async () => {
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          if (!currentUser) {
            stopWatching();
            return;
          }

          const { data: stillExists } = await supabase
            .from("User")
            .select("UserID")
            .eq("UserID", currentUser.id)
            .maybeSingle();

          if (!stillExists) {
            void forceSignOut();
          }
        }, 30_000);
      }

      const dbFullName =
        userRow.FullName && String(userRow.FullName).trim() !== ""
          ? String(userRow.FullName)
          : null;
      const dbUserName =
        userRow.UserName && String(userRow.UserName).trim() !== ""
          ? String(userRow.UserName)
          : null;
      const dbEmail = userRow.Email ?? authUser.email ?? "";
      const dbRole =
        userRow.Role && String(userRow.Role).trim() !== ""
          ? String(userRow.Role)
          : null;
      const dbPhone = userRow.Phone ? String(userRow.Phone) : "";
      const dbLocation = userRow.Location ? String(userRow.Location) : "";
      const dbBio = userRow.Bio ? String(userRow.Bio) : "";

      setProfile({
        fullName: dbFullName ?? fallbackFullName,
        username: dbUserName ?? fallbackUsername,
        email: dbEmail,
        role: dbRole ?? "Customer",
        phone: dbPhone,
        location: dbLocation,
        bio: dbBio,
      });
      setIsProfileLoading(false);

      // Record sign-in timestamp
      void (async () => {
        const { error: signInErr } = await supabase
          .from("User")
          .update({ LastSignIn: new Date().toISOString() })
          .eq("UserID", authUser.id);
        if (signInErr) {
          console.error("[UserContext] Failed to write LastSignIn:", signInErr.message, signInErr.code);
        }
      })();
    },
    [forceSignOut, stopWatching]
  );

  useEffect(() => {
    let isMounted = true;

    // ── 1. Initial Session Resolution ──────────────────────────────────────
    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();
        if (error) {
          console.error("[UserContext] Error getting session:", error.message);
        }

        if (!isMounted) return;

        if (initialSession?.user) {
          setSession(initialSession);
          setUser(initialSession.user);
          setAuthStatus("authenticated");
          setIsAuthLoading(false);
          void loadProfile(initialSession.user);
        } else {
          setSession(null);
          setUser(null);
          setAuthStatus("unauthenticated");
          setIsAuthLoading(false);
          setIsProfileLoading(false);
          setProfile(defaultProfile);
        }
      } catch (err) {
        console.error("[UserContext] Unexpected init error:", err);
        if (isMounted) {
          setSession(null);
          setUser(null);
          setAuthStatus("unauthenticated");
          setIsAuthLoading(false);
          setIsProfileLoading(false);
          setProfile(defaultProfile);
        }
      }
    };

    void initializeAuth();

    // ── 2. Auth State Listener ─────────────────────────────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (!isMounted) return;

        if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") {
          if (currentSession?.user) {
            setSession(currentSession);
            setUser(currentSession.user);
            setAuthStatus("authenticated");
            setIsAuthLoading(false);
            void loadProfile(currentSession.user);
          }
        } else if (event === "SIGNED_OUT") {
          loadOpIdRef.current++;
          stopWatching();
          setSession(null);
          setUser(null);
          setAuthStatus("unauthenticated");
          setIsAuthLoading(false);
          setIsProfileLoading(false);
          setProfile(defaultProfile);
        } else if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          if (currentSession) {
            setSession(currentSession);
            setUser(currentSession.user);
          }
        }
      }
    );

    return () => {
      isMounted = false;
      loadOpIdRef.current++;
      stopWatching();
      try {
        subscription.unsubscribe();
      } catch {
        // ignore
      }
    };
  }, [loadProfile, stopWatching]);

  const signOut = async (): Promise<boolean> => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("[UserContext] Sign out error:", error.message);
        return false;
      }
      loadOpIdRef.current++;
      stopWatching();
      setSession(null);
      setUser(null);
      setAuthStatus("unauthenticated");
      setIsAuthLoading(false);
      setIsProfileLoading(false);
      setProfile(defaultProfile);
      return true;
    } catch (err) {
      console.error("[UserContext] Unexpected sign out error:", err);
      return false;
    }
  };

  const isLoading = isAuthLoading || isProfileLoading;

  return (
    <UserContext.Provider
      value={{
        user,
        session,
        authStatus,
        isAuthLoading,
        isProfileLoading,
        profile,
        isLoading,
        signOut,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export const useCurrentUserProfile = () => useContext(UserContext);