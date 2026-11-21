# Autodidact

A Socratic tutor that finds the gaps in what a member knows and helps them
close those gaps themselves, toward a goal in their own Wiki or anything they
ask to learn. A personal app (`catalog.personal`, no organization): every route
serves only the owner of a user-owned installation (`personal` in
`src/server/context.ts`); an organization's installation answers 403, anyone
else 404.

## The model

- A **topic** is something the member wants to be able to do (its `aim`),
  started from a Wiki **Goal** (`goalId`, with the title kept so it reads
  without the Wiki) or from their own prompt. Active, paused or done.
- A topic maps to **concepts** in learning order, foundations first. Each is
  `unprobed`, `gap`, `shaky` or `solid`.
- A **check** is one Socratic probe: the open question asked, the member's
  answer in their own words, the outcome and what the answer showed. The
  latest check sets its concept's state.
- The next concept to work on is the first gap, then the first shaky one, then
  the first unprobed one, in map order (`nextConcept` in `src/lib/learning.ts`).

Data lives in the installation database (`src/server/schema.ts`). Goals are
read from the member's Wiki through the platform, as the member
(`src/server/goals.ts`); the app never writes to the Wiki.

## The tutor

The **Ask your tutor** panel is the standard page agent: SDK `actionAgent`
(`src/server/agent-route.ts`) with `AppAgentSidebar`, on the platform's shared
thread service and the member's own inference provider. Its instructions are the
method: anchor on an aim, map the concepts, ask one open question at a time
(explain, predict, apply), judge only from the answer, and fill a gap with
guiding questions (example, counterexample, simpler case, analogy) before ever
explaining, then check again.

One action registry (`src/server/actions.ts`) serves three callers:

| Action | Tool | Access |
| --- | --- | --- |
| `goals.read` | `autodidact_goals_read` | read |
| `topics.read` | `autodidact_topics_read` | read |
| `topic.read` | `autodidact_topic_read` | read |
| `topic.save` | `autodidact_topic_save` | write |
| `concepts.add` | `autodidact_concepts_add` | write |
| `check.record` | `autodidact_check_record` | write |

- The pages run them through `POST /api/apps/autodidact/<action>`.
- The tutor offers them as tools. Reads run at once; every write is a private
  proposal the member approves or rejects in the panel, and the page refreshes
  when one applies.
- The platform dispatches them at `/api/internal/actions/v1` (`actions.publish`)
  for MCP clients and other apps.

The demo build swaps the panel for the shared scripted one and reads
`fixtures/demo.json`: no inference, no writes.

## Commands

From this folder:

```sh
npm run check
npm test                                      # builds both modes, then unit and integration tests
node --import tsx scripts/demo-fixtures.ts    # after a change to the domain or the demo scenario
npx drizzle-kit generate                      # after a schema change; commit the migration
```

`tests/agent.integration.test.ts` runs the tutor on the real thread service
with a scripted model, so it needs no inference provider.

## Known limits

- Goals are read from the whole Wiki graph (`readWikiGraph`); move to a
  filtered Goal query when the Wiki offers one.
- Every check is a proposal to approve, which adds a click per answer.
- Concepts cannot be renamed, reordered or removed yet; a topic holds at most 40.
- What the member learns stays in this app; nothing is written back to the
  Wiki (for example as a skill on their Person).
