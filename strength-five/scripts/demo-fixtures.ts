// Regenerates fixtures/demo.json from the demo scenario after a change to the
// program, schema or views:
//   node --import tsx catalog/outfitter-apps/strength-five/scripts/demo-fixtures.ts
import { writeFile } from "node:fs/promises";
import { demoPath, demoResponses } from "../tests/helpers/fixtures";

const description = "The demo's API responses: five synthetic weeks of sessions and Apple Health data (tests/helpers/fixtures.ts), computed by the app's own code. Regenerate with scripts/demo-fixtures.ts; a unit test checks it.";
await writeFile(demoPath, `${JSON.stringify({ description, responses: await demoResponses() }, null, 2)}\n`);
