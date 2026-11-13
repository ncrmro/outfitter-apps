import type { ComponentProps } from "react";
import AppAgentSidebar from "@ai-outfitter/ui/react/AppAgentSidebar";

/** The platform mounts personal apps under /apps/:id; connector and proposal
 * requests must stay inside that authenticated mount and its CSP connect scope. */
export default function DioneSidebar(props: Omit<ComponentProps<typeof AppAgentSidebar>, "endpoint">) {
  // The demo build substitutes the sidebar module, so do not import helpers
  // from that substituted module. Both installation URL shapes share this mount.
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  const prefix = /^\/o\/[^/]+\/[^/]+/.exec(path)?.[0] ?? /^\/apps\/[^/]+/.exec(path)?.[0] ?? "";
  return <AppAgentSidebar {...props} endpoint={`${prefix}/api/apps/dione/agent`} />;
}
