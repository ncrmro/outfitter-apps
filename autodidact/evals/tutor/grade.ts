// Deterministic checks over one tutor conversation. They catch the failures that break
// the method: lecturing instead of asking, several questions at once, recording an
// answer the member never gave, crediting understanding they did not show, and
// claiming a change happened when it is only a proposal.
import type { Entry, Proposal } from "../../tests/helpers/tutor";

export type Check = { name: string; pass: boolean; detail: string };
export type Grade = { pass: boolean; score: number; checks: Check[] };
export type ToolCall = { name: string; input: Record<string, unknown> };
/** One member turn and everything the tutor did in reply. */
export type Turn = { member: string; reply: string; tools: ToolCall[] };
export type Transcript = { turns: Turn[]; proposals: Proposal[] };

/** The conversation as turns, from the thread's entries. */
export function transcript(entries: Entry[], proposals: Proposal[]): Transcript {
  const turns: Turn[] = [];
  for (const entry of entries) {
    if (entry.role === "user") turns.push({ member: entry.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"), reply: "", tools: [] });
    const turn = turns.at(-1);
    if (!turn || entry.role !== "assistant") continue;
    for (const part of entry.parts) {
      if (part.type === "text") turn.reply = [turn.reply, part.text ?? ""].filter(Boolean).join("\n");
      if (part.type === "tool-call") turn.tools.push({ name: String(part.name), input: (part.input ?? {}) as Record<string, unknown> });
    }
  }
  return { turns, proposals };
}

const words = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
export const wordCount = (text: string) => words(text).length;
/** Sentences that ask something. A question mark inside quotes or code still counts: the member sees it. */
export const questions = (text: string) => text.split(/(?<=\?)/).filter((piece) => piece.includes("?")).length;
/** A closed question: one the member can answer with yes or no. */
export const closedQuestion = (text: string) => {
  const last = text.split(/(?<=[.!?\n])\s*/).filter((sentence) => sentence.includes("?")).at(-1) ?? "";
  return /^(is|are|do|does|did|can|could|would|will|should|have|has|was|were)\b/i.test(last.trim().replace(/^[*_"'(]+/, ""));
};
/** How much of `quote` is the member's own wording: the share of its words that appear in what they wrote. */
export function ownWords(quote: string, member: string) {
  const have = new Set(words(member));
  const need = words(quote);
  return need.length ? need.filter((word) => have.has(word)).length / need.length : 0;
}
const claimsDone = (text: string) => /\b(i('| ha)ve|i just) (saved|recorded|added|created|updated|marked|logged)\b/i.test(text) && !/propos|approve|review/i.test(text);

export const check = (name: string, pass: boolean, detail: string): Check => ({ name, pass, detail });

/** Checks every conversation gets, whatever the case expects. */
export function universal(t: Transcript): Check[] {
  const checks: Check[] = [];
  t.turns.forEach((turn, n) => {
    const at = t.turns.length > 1 ? ` (turn ${n + 1})` : "";
    checks.push(check(`replied${at}`, turn.reply.trim().length > 0, turn.reply.trim() ? "the tutor answered" : "no text reply"));
    checks.push(check(`one-question${at}`, questions(turn.reply) <= 1, `${questions(turn.reply)} questions`));
    checks.push(check(`concise${at}`, wordCount(turn.reply) <= 150, `${wordCount(turn.reply)} words (at most 150)`));
    checks.push(check(`no-false-claims${at}`, !claimsDone(turn.reply), claimsDone(turn.reply) ? "says a change was made, but it is only a proposal" : "no claim that a proposal already applied"));
  });
  // Every recorded answer is the member's own words, from some turn.
  const said = t.turns.map((turn) => turn.member).join("\n");
  for (const proposal of t.proposals.filter((item) => item.action === "check.record")) {
    const answer = String(proposal.changes.answer ?? "");
    const share = ownWords(answer, said);
    checks.push(check("answer-is-members", share >= 0.6, `${Math.round(share * 100)}% of the recorded answer is the member's wording: "${answer.slice(0, 120)}"`));
  }
  return checks;
}

export function grade(checks: Check[]): Grade {
  const passed = checks.filter((item) => item.pass).length;
  return { pass: passed === checks.length, score: checks.length ? passed / checks.length : 1, checks };
}

export const proposed = (t: Transcript, action: string) => t.proposals.filter((proposal) => proposal.action === action);
export const called = (t: Transcript, tool: string) => t.turns.some((turn) => turn.tools.some((call) => call.name === tool));
export const mentions = (text: string, phrase: string) => {
  const have = new Set(words(text));
  return words(phrase).every((word) => have.has(word) || have.has(`${word}s`) || have.has(word.replace(/s$/, "")));
};
