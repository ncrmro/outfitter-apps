import { demoMode, errorText, loadHealth, notice, syncHealth } from "./data";

// The header's "Sync from Apple Health": shown to the owner once their Apple
// Health import is connected. Pages listen for `health-synced` to reload.

const button = document.getElementById("sync") as HTMLButtonElement | null;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

if (button && !demoMode) {
  try {
    const status = await loadHealth();
    button.hidden = !status.connected;
    button.disabled = false;
  } catch {
    // The page still works without Apple Health.
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    notice("Syncing from Apple Health…");
    try {
      const result = await syncHealth();
      const older = result.truncated ? " Older records beyond the newest 1,000 of a kind were left out." : "";
      const skipped = result.skipped ? ` ${plural(result.skipped, "record", "records")} could not be read and ${result.skipped === 1 ? "was" : "were"} left out.` : "";
      notice(`Synced ${plural(result.workouts, "strength workout", "strength workouts")} and ${plural(result.samples, "bodyweight reading", "bodyweight readings")}.${older}${skipped}`);
      document.dispatchEvent(new CustomEvent("health-synced"));
    } catch (error) {
      notice(errorText(error, "Could not sync from Apple Health."));
    } finally {
      button.disabled = false;
    }
  });
}
