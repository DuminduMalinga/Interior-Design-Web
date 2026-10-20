import { Navigate, Outlet, useLocation } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";

const Spinner = () => (
  <div className="lv min-h-screen flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-lv-accent border-t-transparent rounded-full animate-spin" />
  </div>
);

/**
 * Wraps the pages that need a signed-in user. Visitors who are signed out go
 * to the sign-in page; with `admin`, signed-in customers go to their dashboard.
 * The database enforces the same rules, this just keeps people off pages that
 * would only show errors.
 */
export default function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { authStatus, isAuthLoading, isProfileLoading, profile } = useCurrentUserProfile();
  const location = useLocation();

  if (authStatus === "loading" || isAuthLoading) return <Spinner />;
  if (authStatus === "unauthenticated") {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  // The role arrives with the profile, so wait for it before judging an admin page.
  if (isProfileLoading) return <Spinner />;
  if (admin && profile.role.trim().toLowerCase() !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
