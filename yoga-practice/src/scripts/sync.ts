import { onPageLoad } from "@ai-outfitter/ui/page";
import { healthImportHint, type SyncResult } from "../lib/practice";
import { demoMode, errorText, loadHealth, notice, syncHealth } from "./data";

// The header's "Sync from Apple Health": shown to the owner once their Apple
// Health import is connected. Pages listen for `health-synced` to reload.
// The button is in the header, which stays in place across pages.

const button = document.getElementById("sync") as HTMLButtonElement | null;
/** The connection, read once per visit to the app. */
const health = button && !demoMode ? loadHealth().catch(() => null) : Promise.resolve(null);

const plural = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

function syncedText({ workouts, mindful, sessions, readings, skipped, truncated }: SyncResult) {
  const older = truncated ? " Older records beyond the newest 1,000 of a kind were left out." : "";
  const unread = skipped ? ` ${plural(skipped, "record", "records")} could not be read and ${skipped === 1 ? "was" : "were"} left out.` : "";
  return `Read ${plural(workouts, "workout", "workouts")} and ${plural(mindful, "mindful session", "mindful sessions")}: ${plural(sessions, "new session", "new sessions")}, ${plural(readings, "new reading", "new readings")}.${older}${unread}`;
}

// The Practice page's hint to import Apple Health data.
onPageLoad(async () => {
  const hint = document.getElementById("health-hint");
  if (!hint) return;
  if ((await health)?.connected === false) {
    hint.textContent = healthImportHint;
    hint.hidden = false;
  }
});

if (button && !demoMode) {
  // The page still works without Apple Health.
  const status = await health;
  if (status) {
    button.hidden = !status.connected;
    button.disabled = false;
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
