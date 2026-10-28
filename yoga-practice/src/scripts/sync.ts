import { healthImportHint, type SyncResult } from "../lib/practice";
import { demoMode, errorText, loadHealth, notice, syncHealth } from "./data";

// The header's "Sync from Apple Health": shown to the owner once their Apple
// Health import is connected. Pages listen for `health-synced` to reload.

const button = document.getElementById("sync") as HTMLButtonElement | null;
const hint = document.getElementById("health-hint");

const plural = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

function syncedText({ workouts, mindful, sessions, readings, skipped, truncated }: SyncResult) {
  const older = truncated ? " Older records beyond the newest 1,000 of a kind were left out." : "";
  const unread = skipped ? ` ${plural(skipped, "record", "records")} could not be read and ${skipped === 1 ? "was" : "were"} left out.` : "";
  return `Read ${plural(workouts, "workout", "workouts")} and ${plural(mindful, "mindful session", "mindful sessions")}: ${plural(sessions, "new session", "new sessions")}, ${plural(readings, "new reading", "new readings")}.${older}${unread}`;
}

if (button && !demoMode) {
  try {
    const status = await loadHealth();
    button.hidden = !status.connected;
    button.disabled = false;
    if (hint && status.connected === false) {
      hint.textContent = healthImportHint;
      hint.hidden = false;
    }
  } catch {
    // The page still works without Apple Health.
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    notice("Syncing from Apple Health…");
    try {
      notice(syncedText(await syncHealth()));
      document.dispatchEvent(new CustomEvent("health-synced"));
    } catch (error) {
      notice(errorText(error, "Could not sync from Apple Health."));
    } finally {
      button.disabled = false;
    }
  });
}
