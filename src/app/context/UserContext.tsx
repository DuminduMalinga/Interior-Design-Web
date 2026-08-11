import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type UserProfile = {
  fullName: string;
  username: string;
  email: string;
  role: string;
  phone: string;
  location: string;
  bio: string;
};

type UserContextValue = {
  profile: UserProfile;
  isLoading: boolean;
};

const defaultProfile: UserProfile = {
  fullName: "User",
  username: "user",
  email: "",
  role: "Customer",
  phone: "",
  location: "",
  bio: "",
};

const UserContext = createContext<UserContextValue>({
  profile: defaultProfile,
  isLoading: true,
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [isLoading, setIsLoading] = useState(true);

  // Ref to hold the real-time channel so we can clean it up when user changes
  const watchChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Ref to hold the polling interval
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopWatching = () => {
    if (watchChannelRef.current) {
      void supabase.removeChannel(watchChannelRef.current);
      watchChannelRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Called whenever the admin deletes this user's account mid-session
    const forceSignOut = async () => {
      stopWatching();
      await supabase.auth.signOut();
      if (isMounted) {
        setProfile(defaultProfile);
        setIsLoading(false);
      }
    };

    const loadProfile = async () => {
      setIsLoading(true);

      const { data: { user } } = await supabase.auth.getUser();

      if (!isMounted || !user) {
        setIsLoading(false);
        return;
      }

      const metadata = user.user_metadata as Record<string, unknown> | undefined;
      const fallbackFullName =
        typeof metadata?.full_name === "string" && metadata.full_name
          ? metadata.full_name
          : user.email?.split("@")[0] ?? "User";
      const fallbackUsername =
        typeof metadata?.username === "string" && metadata.username
          ? metadata.username
          : user.email?.split("@")[0] ?? "user";

      const { data: userRow } = await supabase
        .from("User")
        .select("FullName, UserName, Email, Role, Phone, Location, Bio")
        .eq("UserID", user.id)
        .maybeSingle();

      if (!isMounted) return;

      // ── Deleted-account guard ────────────────────────────────────────────
      // Auth session is valid but User table row is gone → admin deleted it.
      // Sign out immediately — no access to any part of the app.
      if (!userRow) {
        await forceSignOut();
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Real-time: instant sign-out when admin deletes this row ──────────
      // Requires "User" table to be in the supabase_realtime publication:
      //   ALTER PUBLICATION supabase_realtime ADD TABLE "User";
      stopWatching();

      watchChannelRef.current = supabase
        .channel(`account-watch-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "User",
            filter: `UserID=eq.${user.id}`,
          },
          () => { void forceSignOut(); }
        )
        .subscribe();

      // ── Polling fallback: check every 30s in case real-time is missed ────
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        if (!isMounted) return;
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) { stopWatching(); return; }

        const { data: stillExists } = await supabase
          .from("User")
          .select("UserID")
          .eq("UserID", currentUser.id)
          .maybeSingle();

        if (!stillExists && isMounted) void forceSignOut();
      }, 30_000);
      // ─────────────────────────────────────────────────────────────────────

      const dbFullName =
        userRow.FullName && String(userRow.FullName).trim() !== ""
          ? String(userRow.FullName)
          : null;
      const dbUserName =
        userRow.UserName && String(userRow.UserName).trim() !== ""
          ? String(userRow.UserName)
          : null;
      const dbEmail = userRow.Email ?? user.email ?? "";
      const dbRole =
        userRow.Role && String(userRow.Role).trim() !== ""
          ? String(userRow.Role)
          : null;
      const dbPhone = userRow.Phone ? String(userRow.Phone) : "";
      const dbLocation = userRow.Location ? String(userRow.Location) : "";
      const dbBio = userRow.Bio ? String(userRow.Bio) : "";

      if (isMounted) {
        setProfile({
          fullName: dbFullName ?? fallbackFullName,
          username: dbUserName ?? fallbackUsername,
          email: dbEmail,
          role: dbRole ?? "Customer",
          phone: dbPhone,
          location: dbLocation,
          bio: dbBio,
        });
        setIsLoading(false);
      }

      // Record the current sign-in time so the admin Status column stays accurate
      void (async () => {
        const { error: signInErr } = await supabase
          .from("User")
          .update({ LastSignIn: new Date().toISOString() })
          .eq("UserID", user.id);
        if (signInErr) {
          console.error("[UserContext] Failed to write LastSignIn:", signInErr.message, signInErr.code);
        }
      })();
    };

    void loadProfile();

    const { data: { subscription } = {} } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_IN" ||
        event === "PASSWORD_RECOVERY" ||
        event === "TOKEN_REFRESHED"
      ) {
        void loadProfile();
      }
      if (event === "SIGNED_OUT") {
        stopWatching();
        setProfile(defaultProfile);
      }
    });

    return () => {
      isMounted = false;
      stopWatching();
      try {
        subscription?.unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <UserContext.Provider value={{ profile, isLoading }}>
      {children}
    </UserContext.Provider>
  );
}

export const useCurrentUserProfile = () => useContext(UserContext);