import type { ComponentProps } from "react";
import SiteNavbar from "./SiteNavbar";

/**
 * Kept for the pages that import it (processing, layouts, 3D view, admin).
 * Every signed-in page now shares one navigation bar; see SiteNavbar.
 */
export default function AppNavbar(props: Omit<ComponentProps<typeof SiteNavbar>, "activeNav">) {
  return <SiteNavbar {...props} />;
}
