# Yoga practice

A member's own practice log and habit tracker, a personal app
(`catalog.personal`, no organization). Every API route serves only the owner
of a user-owned installation (`ownerIdentity` in `../apple-health.ts`): an
organization's installation answers 403, anyone else 404. The goal is practice every week: by
default three sessions or 120 minutes, either counts. Sessions are tagged with
style, intensity and focus areas; Progress shows weekly minutes against the
target, the streak, practice by style, and resting heart rate and HRV. Days
and weeks (Monday to Sunday) are in the member's time zone.

## Apple Health

The member imports their Health export at `/connectors/apple-health` on the
main site and grants this app `workouts.list` and `samples.list`. **Sync from
Apple Health** (the header button, owner only) fills the one step of a
`yoga-health-sync` run through the shared read layer (`../apple-health.ts`):
every sync re-reads the last 90 days of `yoga`, `mind-and-body`, `pilates` and
`flexibility` workouts and `mindful-session` samples, each kept once as a
session (style "other" until tagged), and `resting-heart-rate` and
`heart-rate-variability` readings (only in `count/min` and `ms`). A mindful
session that overlaps a workout is the same practice and is not added; an
imported session is capped at 600 minutes like one logged by hand. A deleted session stays a tombstone, so a
sync never brings it back. Without a grant everything works by hand.

## Commands

From the repository root:

```sh
npm run apps:build -- yoga-practice
npm run test --workspace @ai-outfitter/app-yoga-practice
npm run test:e2e --workspace @ai-outfitter/app-yoga-practice   # SCREENSHOTS=<dir> saves captures
node --import tsx catalog/outfitter-apps/yoga-practice/scripts/demo-fixtures.ts
```

## Known limits

- A mindful session logged by the same app as a yoga workout counts twice;
  delete one of them.
- A read stops at 1,000 records (newest first) and the result says
  `truncated`; records older than 90 days are not read.
