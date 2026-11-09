import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({ imageService: "compile" }),
  build: { inlineStylesheets: "never" },
  vite: {
    define: {
      // The package mode picks the data adapter at build time: fixtures or the API.
      "import.meta.env.OUTFITTER_APP_MODE": JSON.stringify(
        process.env.OUTFITTER_APP_MODE ?? "operational",
      ),
    },
    build: { assetsInlineLimit: 0 },
  },
});
