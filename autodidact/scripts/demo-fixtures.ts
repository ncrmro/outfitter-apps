// Regenerates fixtures/demo.json from the demo scenario in tests/helpers/fixtures.ts,
// computed by the app's own code. Run from this folder:
//   node --import tsx scripts/demo-fixtures.ts
import { writeFile } from "node:fs/promises";
import { demoPath, demoState } from "../tests/helpers/fixtures";

await writeFile(demoPath, `${JSON.stringify(await demoState(), null, 2)}\n`);
