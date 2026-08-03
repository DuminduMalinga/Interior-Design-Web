import { createBrowserRouter } from "react-router";
import Welcome from "./pages/Welcome";
import SignUp from "./pages/SignUp";
import SignIn from "./pages/SignIn";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import UploadFloorPlan from "./pages/UploadFloorPlan";
import Processing from "./pages/Processing";
import SelectRoom from "./pages/SelectRoom";
import ViewLayouts from "./pages/ViewLayouts";
import RoomView3D from "./pages/RoomView3D";
import AdminManageAccounts from "./pages/AdminManageAccounts";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Welcome,
  },
  {
    path: "/signup",
    Component: SignUp,
  },
  {
    path: "/signin",
    Component: SignIn,
  },
  {
    path: "/forgot-password",
    Component: ForgotPassword,
  },
  {
    path: "/reset-password",
    Component: ResetPassword,
  },
  {
    path: "/dashboard",
    Component: Dashboard,
  },
  {
    path: "/upload",
    Component: UploadFloorPlan,
  },
  {
    path: "/processing",
    Component: Processing,
  },
  {
    path: "/select-room",
    Component: SelectRoom,
  },
  {
    path: "/view-layouts",
    Component: ViewLayouts,
  },
  {
    path: "/room-view-3d",
    Component: RoomView3D,
  },
  {
    path: "/admin/accounts",
    Component: AdminManageAccounts,
  },
  {
    path: "*",
    Component: Welcome, // Redirect unknown routes to welcome
  },
]);