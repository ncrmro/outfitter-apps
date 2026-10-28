import type { z } from "zod";
import type { HealthStatus, Overview, Session, SyncResult, Target } from "../lib/practice";
import type { loadSettings as settingsOf, sessionInput } from "../server/practice";
import type { syncInput } from "../server/sync";

// The pages' one data adapter. The package mode picks it at build time: the
// demo reads the synthetic fixture set and never writes; the operational app
// calls its own API. Paths are relative, so the app also works under a prefix.

export const demoMode = import.meta.env.OUTFITTER_APP_MODE === "demo";

export type SessionList = { now: number; canEdit: boolean; sessions: Session[] };
// Request and settings shapes are the server's own, so the two cannot drift apart.
type Settings = Awaited<ReturnType<typeof settingsOf>>;
export type SessionInput = z.input<typeof sessionInput>;

// Loaded only in the demo build; the operational bundle carries no fixtures.
const fixtures = () => import("../../fixtures/demo.json").then((demo) => demo.default.responses);

/** The browser's time zone: days and weeks are the member's own. */
export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function call<T>(path: string, method = "GET", body?: unknown, query = ""): Promise<T> {
  if (demoMode) {
    if (method !== "GET") throw new Error("This demo is read-only.");
    return (await fixtures())[path as "sessions" | "overview" | "settings" | "health"] as T;
  }
  const response = await fetch(`api/apps/yoga-practice/${path}${query}`, {
    method,
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const loadSessions = () => call<SessionList>("sessions");
export const loadOverview = () => call<Overview>("overview", "GET", undefined, `?timeZone=${encodeURIComponent(timeZone)}`);
export const loadSettings = () => call<Settings>("settings");
export const loadHealth = () => call<HealthStatus>("health");
export const createSession = (input: SessionInput) => call<Session>("sessions", "POST", input);
export const updateSession = (id: string, input: SessionInput & { revision: number }) =>
  call<Session>(`sessions/${encodeURIComponent(id)}`, "PUT", input);
export const deleteSession = (id: string, revision: number) =>
  call<{ deleted: string }>(`sessions/${encodeURIComponent(id)}`, "DELETE", { revision });
export const changeTarget = (target: Target) => call<Settings>("settings", "PUT", target);
export const syncHealth = () => call<SyncResult>("health", "POST", {} satisfies z.input<typeof syncInput>);

/** The page's status line. */
export function notice(text: string) {
  const element = document.getElementById("notice");
  if (element) element.textContent = text;
}

export const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
