import { writeFile } from "node:fs/promises";
import { database, demoNow, hostDouble, identity } from "../tests/helpers";
import { generateReport, overview, saveSettings } from "../src/server/service";
const { db, close } = await database();
try {
    const h = hostDouble();
    await saveSettings(db, identity, h.host, { timezone: "America/Chicago", hour: 8, enabled: false, bindings: [{ provider: "radarr", connectionId: "radarr-one", resource: "ocean-radarr" }] }, demoNow);
    const report = await generateReport(db, h.host, { runId: "demo-report", now: demoNow });
    const all = await overview(db);
    await writeFile(new URL("../fixtures/demo.json", import.meta.url), JSON.stringify({ description: "Synthetic fixture; no live service data or credentials.", overview: all, report, settings: { settings: all.settings, connections: (await h.host.call("snapshot", {})).connections.map(c => ({ provider: c.provider, connectionId: c.id, resource: c.resource, operations: c.operations })), schedules: [] } }, null, 2) + "\n");
}
finally {
    close();
}
