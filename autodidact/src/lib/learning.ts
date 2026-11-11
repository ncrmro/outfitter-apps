// The learning model, shared by the server, the pages and the tutor.
//
// A topic is something the member wants to be able to do, from a Wiki goal or
// their own prompt. It breaks down into concepts, foundations first. Each
// Socratic check (one open question and the member's answer) marks a concept
// solid, shaky or a gap; a concept nobody has probed yet is unprobed.

export const conceptStates = ["unprobed", "gap", "shaky", "solid"] as const;
export type ConceptState = (typeof conceptStates)[number];

/** What a check can conclude; "unprobed" is only the state before the first one. */
export const outcomes = ["gap", "shaky", "solid"] as const;
export type Outcome = (typeof outcomes)[number];

export const topicStatuses = ["active", "paused", "done"] as const;
export type TopicStatus = (typeof topicStatuses)[number];

export const stateLabels: Record<ConceptState, string> = {
  unprobed: "Not checked yet",
  gap: "Gap",
  shaky: "Shaky",
  solid: "Solid",
};

export const stateHints: Record<ConceptState, string> = {
  unprobed: "No question has probed it yet.",
  gap: "Could not explain it, or holds a misconception.",
  shaky: "Partly right, but could not justify or apply it.",
  solid: "Explained it in their own words and applied it to a new case.",
};

export const statusLabels: Record<TopicStatus, string> = { active: "Active", paused: "Paused", done: "Done" };

export const MAX_CONCEPTS = 40;

type Probed = { id: string; state: ConceptState; position: number };

/** Concepts by state, for a topic's progress line. */
export function stateCounts(concepts: { state: ConceptState }[]) {
  const counts = Object.fromEntries(conceptStates.map((state) => [state, 0])) as Record<ConceptState, number>;
  for (const concept of concepts) counts[concept.state]++;
  return counts;
}

/**
 * Where a session should go next: close known gaps first, then firm up shaky
 * concepts, then probe ones never checked, each in map order (foundations first).
 * Null when every concept is solid.
 */
export function nextConcept<C extends Probed>(concepts: C[]): C | null {
  for (const state of ["gap", "shaky", "unprobed"] as const) {
    const found = concepts.filter((concept) => concept.state === state).sort((a, b) => a.position - b.position)[0];
    if (found) return found;
  }
  return null;
}

/** "3 of 8 solid · 2 gaps", for lists and the tutor's context. */
export function progressText(concepts: { state: ConceptState }[]) {
  if (!concepts.length) return "No concepts mapped yet";
  const counts = stateCounts(concepts);
  const parts = [`${counts.solid} of ${concepts.length} solid`];
  if (counts.gap) parts.push(`${counts.gap} ${counts.gap === 1 ? "gap" : "gaps"}`);
  if (counts.shaky) parts.push(`${counts.shaky} shaky`);
  if (counts.unprobed) parts.push(`${counts.unprobed} not checked`);
  return parts.join(" · ");
}

/** The tutor's page context: one conversation context for the whole app. */
export const focusId = "a0d1dac7-0000-4000-8000-000000000001";
