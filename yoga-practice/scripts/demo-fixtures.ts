// Regenerates fixtures/demo.json from the synthetic Apple Health import and the
// demo scenario after a change to the domain, the sync or the overview:
//   node --import tsx catalog/outfitter-apps/yoga-practice/scripts/demo-fixtures.ts
import { writeFile } from "node:fs/promises";
import { demoPath, demoResponses } from "../tests/helpers/fixtures";

const description = "The demo's API responses: six weeks of synthetic Apple Health records after the demo scenario in tests/helpers/fixtures.ts, computed by the app's own code. Regenerate with scripts/demo-fixtures.ts; a unit test checks it.";
await writeFile(demoPath, `${JSON.stringify({ description, responses: await demoResponses() }, null, 2)}\n`);
