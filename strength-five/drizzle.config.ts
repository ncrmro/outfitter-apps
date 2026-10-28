import { defineConfig } from "drizzle-kit";

// The installation database's schema (docs/app-databases.md).
export default defineConfig({
  dialect: "sqlite",
  schema: "./catalog/outfitter-apps/strength-five/src/server/schema.ts",
  out: "./catalog/outfitter-apps/strength-five/migrations",
});
