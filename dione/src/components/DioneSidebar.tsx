import type { ComponentProps } from "react";
import AppAgentSidebar, { mountPrefix } from "@ai-outfitter/ui/react/AppAgentSidebar";

/** The platform mounts personal apps under /apps/:id; connector and proposal
 * requests must stay inside that authenticated mount and its CSP connect scope. */
export default function DioneSidebar(props: Omit<ComponentProps<typeof AppAgentSidebar>, "endpoint">) {
  const prefix = typeof window === "undefined" ? "" : mountPrefix(window.location.pathname);
  return <AppAgentSidebar {...props} endpoint={`${prefix}/api/apps/dione/agent`} />;
}
