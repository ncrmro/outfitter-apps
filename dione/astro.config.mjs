import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { scriptedAgentResolution } from "@ai-outfitter/ui/scripted-agent";

export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [react()],
  markdown: { syntaxHighlight: false },
  security: {
    csp: { directives: ["default-src 'none'", "font-src 'self'", "img-src 'self' blob:", "connect-src 'self'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"] },
  },
  build: { inlineStylesheets: "never" },
  vite: {
    resolve: scriptedAgentResolution(),
    define: {
      // The package mode picks the data adapter at build time: fixtures or the API.
      "import.meta.env.OUTFITTER_APP_MODE": JSON.stringify(
        process.env.OUTFITTER_APP_MODE ?? "operational",
      ),
    },
    experimental: { renderBuiltUrl: (_file, { hostType }) => hostType === "js" ? { relative: true } : undefined },
    build: { assetsInlineLimit: 0, rolldownOptions: { output: { chunkFileNames: "chunks/[hash].mjs" } } },
  },
});
