// The pages' few writes, through the same actions the tutor proposes. The demo
// renders no forms, so nothing here runs there.
import { navigate } from "astro:transitions/client";
import { onPageLoad } from "@ai-outfitter/ui/page";

function notice(text: string) {
  const element = document.getElementById("notice");
  if (element) element.textContent = text;
}

/** Runs one app action as the member. Paths are relative: the app may sit under a prefix. */
async function run<T>(action: string, input: unknown): Promise<T> {
  const response = await fetch(`api/apps/autodidact/${action}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

const topicHref = (id: string) => `./topic?id=${encodeURIComponent(id)}`;
const field = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;

function submit(form: HTMLFormElement | null, signal: AbortSignal, work: (form: HTMLFormElement) => Promise<void>) {
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await work(form);
    } catch (error) {
      notice(error instanceof Error && error.message ? error.message : "Could not save.");
    } finally {
      if (button) button.disabled = false;
    }
  }, { signal });
}

onPageLoad((signal) => {
  submit(document.querySelector<HTMLFormElement>("#topic-form"), signal, async (form) => {
    const topic = await run<{ id: string }>("topic.save", { title: field(form, "title"), aim: field(form, "aim"), goal: null });
    await navigate(topicHref(topic.id));
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-start-goal]"))
    button.addEventListener("click", async () => {
      const goal = JSON.parse(button.dataset.startGoal ?? "{}") as { id: string; title: string; summary: string };
      button.disabled = true;
      try {
        const topic = await run<{ id: string }>("topic.save", { title: goal.title.slice(0, 160), aim: goal.summary, goal: { id: goal.id, title: goal.title } });
        await navigate(topicHref(topic.id));
      } catch (error) {
        notice(error instanceof Error && error.message ? error.message : "Could not start the topic.");
        button.disabled = false;
      }
    }, { signal });

  submit(document.querySelector<HTMLFormElement>("#concepts-form"), signal, async (form) => {
    const titles = field(form, "concepts").split("\n").map((line) => line.trim()).filter(Boolean);
    const result = await run<{ added: number; skipped: number }>("concepts.add", { topicId: form.dataset.topic, concepts: titles.map((title) => ({ title })) });
    await navigate(location.href);
    notice(`${result.added} added${result.skipped ? `, ${result.skipped} already on the map` : ""}.`);
  });

  submit(document.querySelector<HTMLFormElement>("#status-form"), signal, async (form) => {
    await run("topic.save", { id: form.dataset.topic, revision: Number(form.dataset.revision), status: field(form, "status") });
    await navigate(location.href);
    notice("Saved.");
  });
});
