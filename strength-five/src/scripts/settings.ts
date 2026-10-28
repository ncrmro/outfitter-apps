import { type Lift, lifts } from "../lib/program";
import { type HealthStatus, healthImportHint, type Weights } from "../lib/views";
import { demoMode, errorText, loadHealth, loadToday, loadWeights, notice, saveWeights } from "./data";
import { importLink, when } from "./format";

// Settings: the next (or starting) weight of each lift, and the Apple Health connection.

const form = document.getElementById("weights") as HTMLFormElement;
const intro = document.getElementById("weights-intro") as HTMLElement;
const submit = document.getElementById("save-weights") as HTMLButtonElement;
const health = document.getElementById("health") as HTMLElement;
const input = (lift: string) => form.elements.namedItem(lift) as HTMLInputElement;

function showWeights(data: Weights, editable: boolean) {
  for (const { lift, weightKg } of data.weights) {
    input(lift).value = String(weightKg);
    input(lift).disabled = !editable;
  }
  submit.disabled = !editable;
  intro.textContent = data.afterSessions
    ? "Your next weight for each lift. Change one to reset it; progression continues from there."
    : "Set the weight each lift starts from. After that, the app works out the next weight from your sessions.";
}

function showHealth(status: HealthStatus) {
  const last = status.lastSyncedAt ? ` Last synced ${when(status.lastSyncedAt)}.` : "";
  if (demoMode) health.textContent = "Synthetic Apple Health workouts and bodyweight. Syncing is turned off here.";
  else if (status.connected) health.textContent = `Connected. Use Sync from Apple Health at the top of any page.${last}`;
  else if (status.connected === false)
    health.replaceChildren(`${healthImportHint} `, importLink("Open the Apple Health import"), last);
  else health.textContent = `Only the app's owner can sync.${last}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  try {
    const weights = Object.fromEntries(lifts.map((lift) => [lift, Number(input(lift).value)])) as Record<Lift, number>;
    showWeights(await saveWeights(weights), true);
    notice("Saved. Today shows the new weights.");
  } catch (error) {
    submit.disabled = false;
    notice(errorText(error, "Could not save the weights."));
  }
});

try {
  const [weights, status, today] = await Promise.all([loadWeights(), loadHealth(), loadToday()]);
  showWeights(weights, today.canEdit && !demoMode);
  showHealth(status);
} catch (error) {
  notice(errorText(error, "Could not load settings."));
}
