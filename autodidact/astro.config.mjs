import { scriptedAgentResolution } from "@ai-outfitter/ui/scripted-agent";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

const mode = process.env.OUTFITTER_APP_MODE ?? "operational";

export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [react()],
  // The agent sidebar hydrates through inline scripts; Astro hashes them into the page's policy.
  security: {
    csp: {
      directives: ["default-src 'none'", "font-src 'self'", "img-src 'self' blob:", "connect-src 'self'", "base-uri 'none'", "frame-ancestors 'none'", `form-action ${mode === "operational" ? "'self'" : "'none'"}`],
    },
  },
  build: { inlineStylesheets: "never" },
  vite: {
    // The demo build swaps the sidebar for the shared scripted one: no inference, no writes.
    resolve: scriptedAgentResolution(),
    define: { "import.meta.env.OUTFITTER_APP_MODE": JSON.stringify(mode) },
    build: { assetsInlineLimit: 0, rolldownOptions: { output: { chunkFileNames: "chunks/[hash].mjs" } } },
  },
});
