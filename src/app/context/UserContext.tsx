import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type UserProfile = {
  fullName: string;
  username: string;
  email: string;
};

type UserContextValue = {
  profile: UserProfile;
  isLoading: boolean;
};

const defaultProfile: UserProfile = {
  fullName: "User",
  username: "user",
  email: "",
};

const UserContext = createContext<UserContextValue>({
  profile: defaultProfile,
  isLoading: true,
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const loadProfile = async () => {
      setIsLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted || !user) {
        setIsLoading(false);
        return;
      }

      const metadata = user.user_metadata as Record<string, unknown> | undefined;
      const fallbackFullName = typeof metadata?.full_name === "string" && metadata.full_name ? metadata.full_name : user.email?.split("@")[0] ?? "User";
      const fallbackUsername = typeof metadata?.username === "string" && metadata.username ? metadata.username : user.email?.split("@")[0] ?? "user";

      const { data: userRow } = await supabase
        .from("User")
        .select("FullName, UserName, Email")
        .eq("UserID", user.id)
        .maybeSingle();

      if (!isMounted) {
        return;
      }

      const dbFullName = userRow?.FullName && String(userRow.FullName).trim() !== "" ? String(userRow.FullName) : null;
      const dbUserName = userRow?.UserName && String(userRow.UserName).trim() !== "" ? String(userRow.UserName) : null;
      const dbEmail = userRow?.Email ?? user.email ?? "";

      setProfile({
        fullName: dbFullName ?? fallbackFullName,
        username: dbUserName ?? fallbackUsername,
        email: dbEmail,
      });
      setIsLoading(false);
    };

    void loadProfile();

    const { data: { subscription } = {} } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY" || event === "TOKEN_REFRESHED") {
        void loadProfile();
      }
      if (event === "SIGNED_OUT") {
        setProfile(defaultProfile);
      }
    });

    return () => {
      isMounted = false;
      try {
        subscription?.unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  return <UserContext.Provider value={{ profile, isLoading }}>{children}</UserContext.Provider>;
}

export const useCurrentUserProfile = () => useContext(UserContext);