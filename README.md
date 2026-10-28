# Outfitter apps

Nicholas's personal Outfitter apps. Outfitter installs them as your own apps
(owned by a user, never an organization), from Apps > Add an app.

| App | What it does |
| --- | --- |
| [`strength-five`](strength-five) | Strength 5x5: squat, bench, row, press and deadlift five sets of five, with the next weight worked out for you. |
| [`yoga-practice`](yoga-practice) | Yoga practice: a log of yoga sessions, a weekly target and streak, with resting heart rate and HRV from Apple Health. |

`apple-health.ts` is the Apple Health read layer both apps share, and
`apple-health-test-host.ts` its test double.

## How this repo is built

The apps are built on Outfitter's app SDK, whose packages are not published.
So this repository is not built on its own: the
[webapp](https://github.com/ai-outfitter/webapp) mounts it as a git submodule
at `catalog/outfitter-apps` and builds and deploys these apps with its catalog.
The webapp pins a commit of this repo; to ship a change here, land it on
`main`, then bump the submodule in the webapp.

To work on an app, from a webapp checkout:

```sh
git submodule update --init catalog/outfitter-apps
npm install
npm test --workspace @ai-outfitter/app-strength-five
npm run build --workspace @ai-outfitter/app-strength-five
```
