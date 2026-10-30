import { onPageLoad } from "@ai-outfitter/ui/page";
import { type HealthStatus, healthImportHint } from "../lib/practice";
import { changeTarget, demoMode, errorText, loadHealth, loadSettings, notice } from "./data";
import { when } from "./format";

onPageLoad(async (signal) => {
  const form = document.getElementById("target-form") as HTMLFormElement | null;
  if (!form) return;
  const status = document.getElementById("health") as HTMLElement;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;

  function describe(health: HealthStatus) {
    if (demoMode) return "Connected to a synthetic Apple Health import. Syncing is turned off here.";
    if (health.connected === null) return "Only the app's owner can sync Apple Health.";
    if (!health.connected) return healthImportHint;
    const last = health.lastSyncedAt ? ` Last synced ${when(health.lastSyncedAt)}.` : "";
    return `Connected. Use Sync from Apple Health at the top of any page.${last}`;
  }

  async function showHealth() {
    status.textContent = describe(await loadHealth());
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await changeTarget({ sessions: Number(field("sessions").value), minutes: Number(field("minutes").value) });
      notice("Target saved.");
    } catch (error) {
      notice(errorText(error, "Could not save the target."));
    }
  });
  document.addEventListener("health-synced", () => void showHealth().catch(() => {}), { signal });

  try {
    const { target } = await loadSettings();
    field("sessions").value = String(target.sessions);
    field("minutes").value = String(target.minutes);
    for (const element of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) element.disabled = demoMode;
    await showHealth();
  } catch (error) {
    notice(errorText(error, "Could not load settings."));
  }
});
