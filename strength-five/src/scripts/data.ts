import type { z } from "zod";
import type { HealthStatus, SessionList, SyncResult, Today, Weights } from "../lib/views";
import type { syncInput } from "../server/health";
import type { sessionInput, weightsInput } from "../server/training";

// The pages' one data adapter. The package mode picks it at build time: the
// demo reads the synthetic fixture set and never writes; the operational app
// calls its own API. Paths are relative, so the app also works under a prefix.

export const demoMode = import.meta.env.OUTFITTER_APP_MODE === "demo";

// Loaded only in the demo build; the operational bundle carries no fixtures.
const fixtures = () => import("../../fixtures/demo.json").then((demo) => demo.default.responses);

async function call<T>(path: "today" | "sessions" | "weights" | "health", method = "GET", body?: unknown): Promise<T> {
  if (demoMode) {
    if (method !== "GET") throw new Error("This demo is read-only.");
    return (await fixtures())[path] as T;
  }
  const response = await fetch(`api/apps/strength-five/${path}`, {
    method,
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const loadToday = () => call<Today>("today");
export const loadSessions = () => call<SessionList>("sessions");
export const loadWeights = () => call<Weights>("weights");
export const loadHealth = () => call<HealthStatus>("health");
// Request bodies are the server's own schemas, so the two cannot drift apart.
export const saveSession = (session: z.input<typeof sessionInput>) => call<Today>("sessions", "POST", session);
export const saveWeights = (weights: z.input<typeof weightsInput>["weights"]) => call<Weights>("weights", "PUT", { weights });
export const syncHealth = () =>
  call<SyncResult>("health", "POST", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } satisfies z.input<typeof syncInput>);

/** The page's status line. */
export function notice(text: string) {
  const element = document.getElementById("notice");
  if (element) element.textContent = text;
}

export const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
