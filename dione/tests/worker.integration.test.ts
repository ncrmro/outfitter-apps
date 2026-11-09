import assert from "node:assert/strict";
import test from "node:test";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { appWorker } from "@ai-outfitter/app-test/worker";
const packageURL = new URL("..", import.meta.url);
const owner = { userId: "owner", organizationId: "", role: "owner", owner: { kind: "user" as const, id: "owner" } };
test("built operational app requires the personal owner; graph and workflow routes do not expose unauthenticated data", async () => {
    const app = await appWorker("dione", appArtifact(packageURL, "operational"), "dione-test");
    try {
        assert.equal((await app.call("/api/apps/dione/overview")).status, 401);
        assert.equal((await app.call("/api/apps/dione/overview", { ...owner, userId: "other" })).status, 403);
        assert.equal((await app.call("/api/apps/dione/overview", { userId: "owner", organizationId: "org", role: "owner" })).status, 403);
        const response = await app.call("/api/apps/dione/overview", owner);
        assert.equal(response.status, 200);
        const data = await response.json() as any;
        assert.deepEqual(data.reports, []);
        assert.equal(data.settings.timezone, "America/Chicago");
        assert.equal((await app.call("/api/apps/dione/refresh", owner, { method: "POST", body: {} })).status, 503);
        assert.equal((await app.call("/api/internal/workflow-host/v1", owner, { method: "POST", body: { phase: "schedule", input: {} } })).status, 503);
        assert.equal((await app.call("/api/apps/dione/confirm", { ...owner, actor: { kind: "app", id: "other-app" } }, { method: "POST", body: { id: "one", confirmed: true } })).status, 403);
        assert.equal((await app.call("/api/internal/actions/v1/list")).status, 401);
    }
    finally {
        await app.dispose();
    }
});
