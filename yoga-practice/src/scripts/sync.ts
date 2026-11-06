import { onPageLoad } from "@ai-outfitter/ui/page";
import { healthImportHint, type SyncResult } from "../lib/practice";
import { demoMode, errorText, loadHealth, notice, syncHealth } from "./data";

// The header's "Sync from Apple Health": shown to the owner once their Apple
// Health import is connected. Pages listen for `health-synced` to reload.
// The button persists across pages, so its listener is set once.

const button = document.getElementById("sync") as HTMLButtonElement | null;
let syncing = false;

const plural = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

function syncedText({ workouts, mindful, sessions, readings, skipped, truncated }: SyncResult) {
  const older = truncated ? " Older records beyond the newest 1,000 of a kind were left out." : "";
  const unread = skipped ? ` ${plural(skipped, "record", "records")} could not be read and ${skipped === 1 ? "was" : "were"} left out.` : "";
  return `Read ${plural(workouts, "workout", "workouts")} and ${plural(mindful, "mindful session", "mindful sessions")}: ${plural(sessions, "new session", "new sessions")}, ${plural(readings, "new reading", "new readings")}.${older}${unread}`;
}

// The connection can change in Settings, so each page reads it again.
onPageLoad(async (signal) => {
  if (!button || demoMode) return;
  // The page still works without Apple Health.
  const status = await loadHealth().catch(() => null);
  if (!status || signal.aborted) return;
  button.hidden = !status.connected;
  if (!syncing) button.disabled = false;
  // The Practice page's hint to import Apple Health data.
  const hint = document.getElementById("health-hint");
  if (hint && !status.connected) {
    hint.textContent = healthImportHint;
    hint.hidden = false;
  }
});

if (button && !demoMode) {
  button.addEventListener("click", async () => {
    syncing = button.disabled = true;
    notice("Syncing from Apple Health…");
    try {
      notice(syncedText(await syncHealth()));
      document.dispatchEvent(new CustomEvent("health-synced"));
    } catch (error) {
      notice(errorText(error, "Could not sync from Apple Health."));
    } finally {
      syncing = button.disabled = false;
    }
  });
}
