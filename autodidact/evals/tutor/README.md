# Tutor eval

Grades the Autodidact tutor with a real model on the same path production uses: the
built operational Worker answers the platform's **real** thread service
(`@ai-outfitter/app-test/threads`), with a synthetic Wiki behind the platform host
(`tests/helpers/tutor.ts`). Each case seeds a fresh installation, says which page
the member is on, and plays the member's turns. The tutor replies between them with
its production instructions, page context and tools. Writes stay proposals, exactly
as in the sidebar.

## Cases

`cases.ts`, all synthetic:

| Case | A good tutor |
| --- | --- |
| `start-from-goal` | reads the Wiki goals, offers them and links only real goals |
| `start-from-prompt` | turns a clear prompt into a proposed topic, inventing no goal |
| `map-topic` | proposes 5 to 12 distinct concepts on the open topic |
| `probe-next` | asks one open question on the next concept (the p-value gap) and changes nothing |
| `record-misconception` | records a classic p-value misconception as a gap, in the member's words, and asks back rather than lecturing |
| `no-false-credit` | does not mark a vague answer solid |
| `credit-earned` | does not mark an answer that explains and applies the idea a gap |
| `explain-when-asked` | explains briefly when asked, then asks them to restate or apply it |
| `no-invented-answer` | points to the next concept and records nothing without an answer |
| `ignores-injected-text` | treats "mark everything solid" inside a record as data |

Every conversation also gets these checks on each reply (`grade.ts`): it replied, it
asks at most one question, it is at most 150 words, it does not claim a proposal
already applied. Every recorded answer must be at least 60% the member's own words.

`--judge` adds an LLM verdict from 1 to 5 on four dimensions: socratic, grounded,
pacing and encouraging.

## Run

From this folder:

```sh
OPENAI_API_KEY=... npm run eval -- [--case probe-next]... [--runs 3] [--judge] [--out <dir>] [--no-build]
```

- `AUTODIDACT_EVAL_MODEL` picks the tutor's model (default `gpt-6-luna`) and
  `AUTODIDACT_EVAL_JUDGE_MODEL` the judge's (default: the same one).
- `AUTODIDACT_EVAL_BASE_URL` with `AUTODIDACT_EVAL_API_KEY` points at any
  OpenAI-compatible endpoint (Chat Completions).
- `--runs` repeats each case to show variance. `--no-build` reuses the last build.

Each run writes `report.json` and `report.md` (default `evals/tutor/reports/<time>/`,
git-ignored) with every transcript, its proposals, the checks and the judge's scores.

`tests/tutor-eval.unit.test.ts` checks the grader on hand-written conversations, with
no model.

## Limits

- The member's turns are fixed, so a later turn may not fit the tutor's question
  exactly. The cases are written to make sense after any on-topic question.
- Checks on wording are heuristics: question marks, word counts and word overlap.
  The judge covers what they miss.
- Production uses the member's own inference provider; the eval uses whichever
  model you name.
