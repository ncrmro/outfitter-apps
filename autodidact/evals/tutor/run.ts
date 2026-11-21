// Run the tutor on every case with a real model and grade each conversation. See README.md.
//
//   OPENAI_API_KEY=... npm run eval -- [--case <id>]... [--runs 3] [--judge] [--out <dir>] [--no-build]
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { instructions } from "../../src/server/tutor";
import { tutorHost } from "../../tests/helpers/tutor";
import { cases, type TutorCase } from "./cases";
import { type Grade, grade, transcript, type Transcript, universal } from "./grade";

const { values } = parseArgs({
  options: {
    case: { type: "string", multiple: true },
    runs: { type: "string", default: "1" },
    judge: { type: "boolean", default: false },
    out: { type: "string" },
    "no-build": { type: "boolean", default: false },
  },
});
const env = process.env;
const apiKey = env.AUTODIDACT_EVAL_API_KEY ?? env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY (or AUTODIDACT_EVAL_API_KEY with AUTODIDACT_EVAL_BASE_URL for another OpenAI-compatible endpoint)");
const baseURL = env.AUTODIDACT_EVAL_BASE_URL;
const modelId = env.AUTODIDACT_EVAL_MODEL ?? "gpt-6-luna";
const judgeId = env.AUTODIDACT_EVAL_JUDGE_MODEL ?? modelId;
const provider = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
// Another endpoint speaks Chat Completions; OpenAI itself gets its Responses API.
const model = (id: string) => (baseURL ? provider.chat(id) : provider(id));
const runs = Math.max(1, Number(values.runs));
const selected = values.case?.length ? cases.filter((item) => values.case?.includes(item.id)) : cases;
if (!selected.length) throw new Error(`No such case. Cases: ${cases.map((item) => item.id).join(", ")}`);

const app = fileURLToPath(new URL("../..", import.meta.url));
if (!values["no-build"] && spawnSync("npm", ["run", "build"], { cwd: app, stdio: "inherit" }).status !== 0) throw new Error("Build failed");

const verdict = z.strictObject({
  socratic: z.number().int().min(1).max(5).describe("Leads with questions that make the member reason; explains only when they ask or after real attempts."),
  grounded: z.number().int().min(1).max(5).describe("Judges and records only what the member actually said; invents nothing about their knowledge or records."),
  pacing: z.number().int().min(1).max(5).describe("One step at a time, short replies, on the concept that matters next."),
  encouraging: z.number().int().min(1).max(5).describe("Rewards effort and keeps the member going without flattery."),
  reasoning: z.string().max(800),
});
async function judge(item: TutorCase, t: Transcript) {
  const { object } = await generateObject({
    model: model(judgeId),
    schema: verdict,
    system: `You grade a Socratic tutor's conversation with a learner. The tutor's own instructions were:\n${instructions}\nScore 1 to 5 on each dimension and explain briefly.`,
    prompt: JSON.stringify({ case: item.description, turns: t.turns, proposals: t.proposals.map(({ action, status, changes }) => ({ action, status, changes })) }),
  });
  return object;
}

type Result = { case: string; run: number; transcript?: Transcript; grade?: Grade; judge?: z.infer<typeof verdict>; error?: string; ms: number };

async function runCase(item: TutorCase, run: number): Promise<Result> {
  const started = Date.now();
  const host = await tutorHost(() => model(modelId));
  try {
    const seed = item.seed ? await item.seed(host) : { concepts: {} };
    const page = item.page?.(seed);
    const thread = await host.conversation();
    for (const text of item.turns) {
      const state = await host.send(thread.id, text, page);
      if (state.state !== "completed") throw new Error(`The reply ended ${state.state}`);
    }
    const t = transcript(await host.entries(thread.id), await host.proposals(thread.id));
    const result: Result = { case: item.id, run, transcript: t, grade: grade([...universal(t), ...item.expect(t, seed)]), ms: 0 };
    if (values.judge) result.judge = await judge(item, t);
    return { ...result, ms: Date.now() - started };
  } catch (error) {
    return { case: item.id, run, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
  } finally {
    await host.dispose();
  }
}

const results: Result[] = [];
for (const item of selected)
  for (let run = 1; run <= runs; run++) {
    const result = await runCase(item, run);
    results.push(result);
    const failed = result.grade?.checks.filter((entry) => !entry.pass).map((entry) => entry.name).join(", ");
    console.log(`${result.error ? "error" : result.grade?.pass ? "pass " : "FAIL "} ${item.id}${runs > 1 ? ` #${run}` : ""}${failed ? `  (${failed})` : ""}${result.error ? `  ${result.error}` : ""}`);
  }

const graded = results.filter((item) => item.grade);
const mean = (key: keyof z.infer<typeof verdict>) => {
  const scores = results.flatMap((item) => (item.judge ? [Number(item.judge[key])] : []));
  return scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;
};
const report = {
  format: "outfitter-autodidact-tutor-eval-v1",
  createdAt: new Date().toISOString(),
  model: modelId,
  judgeModel: values.judge ? judgeId : null,
  totals: {
    conversations: results.length, passed: graded.filter((item) => item.grade?.pass).length, errors: results.filter((item) => item.error).length,
    checks: graded.reduce((sum, item) => sum + (item.grade?.checks.length ?? 0), 0),
    checksPassed: graded.reduce((sum, item) => sum + (item.grade?.checks.filter((entry) => entry.pass).length ?? 0), 0),
    judge: values.judge ? { socratic: mean("socratic"), grounded: mean("grounded"), pacing: mean("pacing"), encouraging: mean("encouraging") } : null,
  },
  results,
};
const out = resolve(values.out ?? resolve(app, "evals/tutor/reports", report.createdAt.replace(/[:.]/g, "-")));
await mkdir(out, { recursive: true });
await writeFile(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const quote = (text: string) => `> ${text.trim().replaceAll("\n", "\n> ")}`;
const markdown = [
  "# Autodidact tutor eval",
  "",
  `${report.totals.passed} of ${report.totals.conversations} conversations passed every check; ${report.totals.checksPassed} of ${report.totals.checks} checks passed; ${report.totals.errors} errors. Model: ${modelId}.`,
  ...(report.totals.judge ? ["", `Judge (${judgeId}, mean of 5): socratic ${report.totals.judge.socratic}, grounded ${report.totals.judge.grounded}, pacing ${report.totals.judge.pacing}, encouraging ${report.totals.judge.encouraging}.`] : []),
  "",
  ...results.flatMap((item) => {
    const spec = cases.find((entry) => entry.id === item.case);
    return [
      `## ${item.case}${runs > 1 ? ` #${item.run}` : ""} ${item.error ? "(error)" : item.grade?.pass ? "✓" : "✗"}`,
      "",
      spec?.description ?? "",
      "",
      ...(item.error ? [`Error: ${item.error}`, ""] : []),
      ...(item.transcript?.turns.flatMap((turn) => [
        `**Member:** ${turn.member}`, "",
        ...(turn.tools.length ? [`_Tools: ${turn.tools.map((call) => call.name).join(", ")}_`, ""] : []),
        quote(turn.reply || "(no text)"), "",
      ]) ?? []),
      ...(item.transcript?.proposals.length ? [`Proposals: ${item.transcript.proposals.map((proposal) => `${proposal.action} ${JSON.stringify(proposal.changes)}`).join("; ")}`, ""] : []),
      ...(item.grade?.checks.map((entry) => `- ${entry.pass ? "✓" : "✗"} ${entry.name}: ${entry.detail}`) ?? []),
      ...(item.judge ? ["", `Judge: socratic ${item.judge.socratic}, grounded ${item.judge.grounded}, pacing ${item.judge.pacing}, encouraging ${item.judge.encouraging}. ${item.judge.reasoning}`] : []),
      "",
    ];
  }),
].join("\n");
await writeFile(resolve(out, "report.md"), markdown);
console.log(`Report: ${resolve(out, "report.md")}`);
