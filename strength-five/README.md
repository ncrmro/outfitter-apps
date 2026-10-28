# Strength 5x5

A member's own barbell log in the StrongLifts 5x5 shape, a personal app
(`catalog.personal`, no organization). Every API route serves only the owner
of a user-owned installation (`ownerIdentity` in `../apple-health.ts`): an
organization's installation answers 403, anyone else 404. Workouts A (squat, bench, row) and B
(squat, press, deadlift) alternate; every set of five adds 2.5 kg next time
(deadlift 5 kg), a miss repeats the weight and the third miss in a row drops
the lift 10%. The rules live in `src/lib/program.ts`; the next workout and
weights are replayed from the log. Today, History, Progress and Settings are
in `src/pages/`.

## Apple Health

The member imports their Health export at `/connectors/apple-health` on the
main site and grants this app `workouts.list` and `samples.list`. **Sync from
Apple Health** (the header button, owner only) fills the one step of a
`strength-health-sync` run through the shared read layer
(`../apple-health.ts`): every sync re-reads the last 365 days of
`traditional-strength-training` and `functional-strength-training` workouts
and `body-mass` samples and upserts them by Health id. History matches a
workout to a session on the same day in the browser's time zone; Today shows
the bodyweight trend. Without a grant the app says where to import and works
by hand.

## Commands

From the repository root:

```sh
npm run apps:build -- strength-five
npm run test --workspace @ai-outfitter/app-strength-five
npm run test:e2e --workspace @ai-outfitter/app-strength-five   # SCREENSHOTS=<dir> saves captures
node --import tsx catalog/outfitter-apps/strength-five/scripts/demo-fixtures.ts
```

## Known limits

- No rest timer, lb display, or editing a logged session.
- Syncs only on the owner's click; a failed sync leaves its run waiting and the
  next one resumes it. A read stops at 1,000 records (newest first) and the
  result says `truncated`.
- Health data is as fresh as the member's last export import until the
  Outfitter iPhone app syncs HealthKit.
