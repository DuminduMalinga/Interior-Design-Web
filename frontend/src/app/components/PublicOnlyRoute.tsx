import { Navigate, Outlet } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";

interface PublicOnlyRouteProps {
  children?: React.ReactNode;
}

export default function PublicOnlyRoute({ children }: PublicOnlyRouteProps) {
  const { authStatus, isAuthLoading, isProfileLoading, profile } = useCurrentUserProfile();

  // 1. Initial auth resolution in progress
  if (authStatus === "loading" || isAuthLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 2. Authenticated user detected
  if (authStatus === "authenticated") {
    // If profile is still resolving from database, wait for role
    if (isProfileLoading) {
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    // Role-based redirection with history replacement
    if (profile.role === "Admin") {
      return <Navigate to="/admin/accounts" replace />;
    }

    return <Navigate to="/dashboard" replace />;
  }

  // 3. Unauthenticated visitor: render page
  return children ? <>{children}</> : <Outlet />;
}
