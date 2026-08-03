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
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted || !user) {
        setIsLoading(false);
        return;
      }

      const metadata = user.user_metadata as Record<string, unknown> | undefined;
      const fallbackFullName = typeof metadata?.full_name === "string" ? metadata.full_name : user.email?.split("@")[0] ?? "User";
      const fallbackUsername = typeof metadata?.username === "string" ? metadata.username : user.email?.split("@")[0] ?? "user";

      const { data: userRow } = await supabase
        .from("User")
        .select("FullName, UserName, Email")
        .eq("UserID", user.id)
        .maybeSingle();

      if (!isMounted) {
        return;
      }

      setProfile({
        fullName: userRow?.FullName ?? fallbackFullName,
        username: userRow?.UserName ?? fallbackUsername,
        email: userRow?.Email ?? user.email ?? "",
      });
      setIsLoading(false);
    };

    void loadProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  return <UserContext.Provider value={{ profile, isLoading }}>{children}</UserContext.Provider>;
}

export const useCurrentUserProfile = () => useContext(UserContext);