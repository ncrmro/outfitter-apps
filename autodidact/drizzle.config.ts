import { defineConfig } from "drizzle-kit";

// The installation database's schema. After changing it, run
// `npx drizzle-kit generate` here and commit the new migration.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/schema.ts",
  out: "./migrations",
});
