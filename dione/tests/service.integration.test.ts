import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { serveGraphql } from "@ai-outfitter/app-sdk/app-graphql";
import { confirmRecommendation, generateReport, overview, saveSettings } from "../src/server/service";
import { graphqlSchema } from "../src/server/graphql";
import { recommendations } from "../src/server/schema";
import { database, demoNow, hostDouble, identity } from "./helpers";
const config = { timezone: "America/Chicago", hour: 8, enabled: true, bindings: [{ provider: "radarr", connectionId: "radarr-one", resource: "ocean-radarr" }] };
test("persisted briefing includes provenance and explicit partial source states; graph returns same report", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    await saveSettings(db, identity, h.host, config, demoNow);
    const report = await generateReport(db, h.host, { runId: "report-one", now: demoNow });
    assert.equal(report.report.day, "2026-11-09");
    assert.equal(report.report.status, "partial");
    assert.equal(report.items.length, 1);
    assert.equal(report.items[0].section, "upcoming");
    assert.equal(report.sections.upcoming.length, 1);
    assert.ok(h.calls.every(c => c.name !== "inference.generate"));
    assert.equal(report.sources.length, 6);
    assert.equal(report.sources.filter(s => s.status === "unavailable").length, 5);
    assert.equal((await overview(db)).recommendations.length, 1);
    const again = await generateReport(db, h.host, { runId: "report-one", now: demoNow });
    assert.equal(again.items.length, 1);
    const result = await serveGraphql({ schema: graphqlSchema, query: "{ dioneReports(first: 10) { nodes { id summary status } } dioneRecommendations(first:10) { nodes { title status } } }", context: { identity, db: () => db } });
    assert.equal(result.errors, undefined);
    assert.equal(((result.data as any)?.dioneReports).nodes[0].id, "report-one");
    assert.ok(!JSON.stringify(result).includes("radarr-one"));
    assert.equal(h.calls.find(c => c.name === "schedule.save")?.input.connectionBindings[0].resource, "ocean-radarr");
}
finally {
    close();
} });
test("recommendation requires explicit owner confirmation and submits once", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    await saveSettings(db, identity, h.host, config, demoNow);
    await generateReport(db, h.host, { now: demoNow });
    const [rec] = await db.select().from(recommendations);
    await assert.rejects(confirmRecommendation(db, identity, h.host, rec.id, { confirmed: false }));
    await assert.rejects(confirmRecommendation(db, { ...identity, userId: "stranger" }, h.host, rec.id, { confirmed: true }), e => e instanceof Response && e.status === 403);
    await confirmRecommendation(db, identity, h.host, rec.id, { confirmed: true });
    await assert.rejects(confirmRecommendation(db, identity, h.host, rec.id, { confirmed: true }), e => e instanceof Response && e.status === 409);
    assert.equal(h.calls.filter(c => c.name === "connector.execute" && c.input.operation === "request.search").length, 1);
    const [saved] = await db.select().from(recommendations).where(eq(recommendations.id, rec.id));
    assert.equal(saved.status, "submitted");
    assert.match(saved.receipt!, /queued/);
}
finally {
    close();
} });
test("unknown write outcome is never blindly retried", async () => { const { db, close } = await database(); try {
    const h = hostDouble({ failRequest: true });
    await saveSettings(db, identity, h.host, config, demoNow);
    await generateReport(db, h.host, { now: demoNow });
    const [rec] = await db.select().from(recommendations);
    await assert.rejects(confirmRecommendation(db, identity, h.host, rec.id, { confirmed: true }), e => e instanceof Response && e.status === 502);
    await assert.rejects(confirmRecommendation(db, identity, h.host, rec.id, { confirmed: true }), e => e instanceof Response && e.status === 409);
    assert.equal((await db.select().from(recommendations))[0].status, "unknown");
}
finally {
    close();
} });
test("reports need no inference and reject a missing grant", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    await assert.rejects(saveSettings(db, identity, h.host, { ...config, bindings: [{ provider: "radarr", connectionId: "other", resource: "other" }] }, demoNow), e => e instanceof Response && e.status === 409);
    await saveSettings(db, identity, h.host, config, demoNow);
    const result = await generateReport(db, h.host, { now: demoNow });
    assert.equal(result.items.length, 1);
    assert.equal("inferenceError" in result.report, false);
    assert.ok(result.items.every(item => !("rank" in item) && !("reason" in item)));
    assert.match(result.report.summary, /1 upcoming release/);
    assert.ok(h.calls.every(c => c.name !== "inference.generate"));
}
finally {
    close();
} });
test("source reads use strict operation inputs, retain truncation, and distinguish queue IDs", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    const original = h.host.call.bind(h.host);
    h.host.call = (async (name: string, input: any) => { if (name === "connector.execute" && input.operation !== "request.search") {
        assert.deepEqual(Object.keys(input.input).sort(), input.operation === "briefing.read" ? ["end", "limit", "start"] : ["limit"]);
        return { items: [{ id: "42", title: input.operation === "queue.list" ? "Queued media" : "Calendar media", kind: input.operation === "queue.list" ? "download" : "movie", date: null, detail: "Fixture", url: null }], cursor: null, truncated: input.operation === "briefing.read" };
    } return original(name as any, input); }) as any;
    await saveSettings(db, identity, h.host, config, demoNow);
    const result = await generateReport(db, h.host, { now: demoNow });
    assert.equal(result.items.length, 2);
    assert.equal(result.sources.find(s => s.source === "radarr")?.truncated, true);
}
finally {
    close();
} });
test("a failed final workflow receipt can be retried without marking the report finished prematurely", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    await saveSettings(db, identity, h.host, config, demoNow);
    const original = h.host.call.bind(h.host);
    let fail = true;
    h.host.call = (async (name: string, input: any) => { if (name === "workflow.collect" && input.slot === "briefing.outputs.briefing" && fail) {
        fail = false;
        throw Error("temporary workflow failure");
    } return original(name as any, input); }) as any;
    await assert.rejects(generateReport(db, h.host, { runId: "retry-report", now: demoNow }));
    assert.equal((await overview(db)).latest?.completedAt, null);
    const done = await generateReport(db, h.host, { runId: "retry-report", now: demoNow });
    assert.ok(done.report.completedAt! >= demoNow);
    assert.equal(done.items.length, 1);
}
finally {
    close();
} });
test("a report reconciles a completed workflow without repeating collection after a lost local marker", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    await saveSettings(db, identity, h.host, config, demoNow);
    await generateReport(db, h.host, { runId: "marker-report", now: demoNow });
    const { reports } = await import("../src/server/schema");
    await db.update(reports).set({ completedAt: null }).where(eq(reports.id, "marker-report"));
    const count = h.calls.filter(c => c.name === "connector.execute").length;
    const done = await generateReport(db, h.host, { runId: "marker-report", now: demoNow });
    assert.ok(done.report.completedAt! >= demoNow);
    assert.equal(h.calls.filter(c => c.name === "connector.execute").length, count);
}
finally {
    close();
} });

test("report summaries are source counts and resume keeps the original report time", async () => {
    const {db,close}=await database();
    try {
        const h=hostDouble();await saveSettings(db,identity,h.host,config,demoNow);
        const first=await generateReport(db,h.host,{runId:"time-report",now:demoNow});
        assert.equal(first.report.summary,"1 upcoming release, 0 recent library additions, and 0 items needing attention.");
        const {reports}=await import("../src/server/schema");
        await db.update(reports).set({completedAt:null}).where(eq(reports.id,"time-report"));
        const resumed=await generateReport(db,h.host,{runId:"time-report",now:demoNow+86400000,clock:()=>demoNow+86400000});
        assert.equal(resumed.report.generatedAt,demoNow);
        assert.ok(resumed.report.completedAt! >= demoNow+86400000);
        assert.ok(h.calls.every(c=>c.name!=="inference.generate"));
    }finally{close();}
});
test("an old in-flight rank checkpoint completes without inference",async()=>{
    const {db,close}=await database();try{
        const h=hostDouble();await saveSettings(db,identity,h.host,config,demoNow);
        h.runs.set("legacy-report",{readiness:{steps:{collect:"ready",rank:"waiting"}}});
        await generateReport(db,h.host,{runId:"legacy-report",now:demoNow});
        assert.ok(h.calls.some(c=>c.name==="workflow.collect"&&c.input.slot==="rank.outputs.briefing"));
        assert.ok(h.calls.every(c=>c.name!=="inference.generate"));
    }finally{close();}
});
test("legacy stored rankings and model failures are not exposed by the report API",async()=>{
    const {db,close}=await database();try{
        const {reports,items}=await import("../src/server/schema");
        const {readReport}=await import("../src/server/service");
        await db.insert(reports).values({id:"legacy",day:"2026-11-09",status:"partial",summary:"Old model said this was your favorite",generatedAt:demoNow,completedAt:demoNow,inferenceError:"Old ranking failure"});
        await db.insert(items).values({id:"legacy-item",reportId:"legacy",source:"radarr",sourceId:"1",title:"Release",kind:"movie",date:"2026-11-10T14:00:00Z",detail:"In library",url:null,rank:1,reason:"Old model explanation"});
        const value=await readReport(db,"legacy");
        assert.equal(value.sections.upcoming.length,1);
        assert.ok(!value.report.summary.includes("favorite"));
        assert.equal("rank" in value.items[0],false);
        assert.equal("reason" in value.items[0],false);
        assert.equal("inferenceError" in value.report,false);
        const graph=await serveGraphql({schema:graphqlSchema,query:"{ dioneItems(first:10) { nodes { title section } } }",context:{identity,db:()=>db}});
        assert.equal(graph.errors,undefined);
    }finally{close();}
});

test("history uses its saved timezone when current settings change",async()=>{
    const {db,close}=await database();try{
        const {reports,items,settings}=await import("../src/server/schema");
        const {readReport}=await import("../src/server/service");
        await db.insert(reports).values({id:"zoned",day:"2026-11-09",status:"complete",generatedAt:demoNow,timezone:"America/Chicago"});
        await db.insert(items).values({id:"late",reportId:"zoned",source:"sonarr",sourceId:"1",title:"Late episode",kind:"episode",date:"2026-11-09T05:00:00Z",detail:"In library",url:null});
        const before=await readReport(db,"zoned");
        await db.insert(settings).values({id:"default",timezone:"UTC",hour:8,enabled:false,bindings:"[]",updatedAt:demoNow});
        const after=await readReport(db,"zoned");
        assert.deepEqual(after.sections,before.sections);
        assert.equal(after.sections.upcoming.length,0);
    }finally{close();}
});
test("section migration removes legacy AI summaries while retaining observations",async()=>{
    const {createClient}=await import("@libsql/client");
    const {drizzle}=await import("drizzle-orm/libsql");
    const {readFile}=await import("node:fs/promises");
    const client=createClient({url:":memory:"});
    try{
        await client.executeMultiple(await readFile(new URL("../migrations/0000_dione.sql",import.meta.url),"utf8"));
        await client.execute({sql:"INSERT INTO reports (id,day,status,summary,generatedAt,inferenceError) VALUES (?,?,?,?,?,?)",args:["pre-upgrade","2026-11-09","partial","AI says this is your favorite",demoNow,"Old ranking error"]});
        await client.execute({sql:"INSERT INTO items (id,reportId,source,sourceId,title,kind,date,detail,rank,reason) VALUES (?,?,?,?,?,?,?,?,?,?)",args:["preserved","pre-upgrade","radarr","1","Preserved movie","movie","2026-11-10T14:00:00Z","In library",1,"Old personalized explanation"]});
        await client.executeMultiple(await readFile(new URL("../migrations/0002_report_sections.sql",import.meta.url),"utf8"));
        await client.executeMultiple(await readFile(new URL("../migrations/0003_operator_capture.sql",import.meta.url),"utf8"));
        const db=drizzle(client);
        const graph=await serveGraphql({schema:graphqlSchema,query:"{ dioneReports(first:10) { nodes { summary timezone } } dioneItems(first:10) { nodes { title } } }",context:{identity,db:()=>db}});
        assert.equal(graph.errors,undefined);
        assert.ok(!JSON.stringify(graph).includes("favorite"));
        assert.ok(JSON.stringify(graph).includes("Archived source observations"));
        assert.ok(JSON.stringify(graph).includes("Preserved movie"));
    }finally{client.close();}
});
