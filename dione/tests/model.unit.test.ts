import assert from "node:assert/strict";
import test from "node:test";
import { observationSection, reportSections,reportDay, safeURL, settingsInput } from "../src/server/model";
test("report day follows local timezone across DST and UTC boundaries", () => { assert.equal(reportDay(Date.parse("2026-11-09T02:00:00Z"), "America/Chicago"), "2026-11-08"); assert.equal(reportDay(Date.parse("2026-03-08T08:01:00Z"), "America/Chicago"), "2026-03-08"); });
test("settings reject invalid timezone and repeated service binding; source links reject code and embedded credentials", () => { assert.equal(settingsInput.safeParse({ timezone: "invalid", hour: 8, enabled: false, bindings: [] }).success, false); const b = { provider: "radarr", connectionId: "one", resource: "ocean" }; assert.equal(settingsInput.safeParse({ timezone: "UTC", hour: 8, enabled: true, bindings: [b, b] }).success, false); assert.equal(safeURL("javascript:alert(1)"), null); assert.equal(safeURL("https://key@example.com"), null); });

test("sections use release dates, recent additions and source attention facts without ranking", () => {
    const now = Date.parse("2026-11-09T14:00:00Z");
    const item = {source: "radarr", title: "Release", kind: "movie", date: "2026-11-09T06:00:00Z", detail: "Monitored; not in library"};
    assert.equal(observationSection(item, now, "America/Chicago", "briefing.read", true), "upcoming");
    assert.equal(observationSection({...item,date:null}, now, "America/Chicago", "missing.list"), "attention");
    assert.equal(observationSection({...item,date:"2026-10-01T14:00:00Z",detail:"In library"}, now, "America/Chicago"), null);
    assert.equal(observationSection({...item,source:"jellyfin",kind:"library",date:"2026-11-08T14:00:00Z"},now,"America/Chicago"),"library");
    assert.equal(observationSection({...item,source:"jellyfin",kind:"library",date:"2025-01-01T14:00:00Z"},now,"America/Chicago"),null);
    assert.equal(observationSection({...item,source:"jellyfin",kind:"library",date:"2026-11-10T14:00:00Z"},now,"America/Chicago"),null);
    assert.equal(observationSection({...item,kind:"download",detail:"Seeding; 100% complete"},now,"America/Chicago"),null);
    assert.equal(observationSection({...item,kind:"download",detail:"Completed and imported"},now,"America/Chicago"),null);
    assert.equal(observationSection({...item,kind:"download",detail:"Failed import; 100% complete"},now,"America/Chicago"),"attention");
    assert.equal(observationSection({...item,kind:"download",detail:"Downloading; 100% complete"},now,"America/Chicago"),"attention");
    assert.equal(observationSection({...item,kind:"download",detail:"Checking; 100% complete"},now,"America/Chicago"),"attention");
    assert.equal(observationSection({...item,date:"2026-11-09"},now,"America/Chicago"),"upcoming");
    assert.equal(observationSection({...item,date:"2026-11-09T00:00:00Z"},now,"America/Chicago"),"upcoming");
    assert.equal(observationSection({...item,kind:"download",detail:"Downloading; 62% complete"},now,"America/Chicago"),"attention");
});
test("section ordering is chronological and unaffected by legacy rank or reason",()=>{
    const now = Date.parse("2026-11-09T14:00:00Z");
    const rows=[{source:"radarr",title:"Tomorrow",kind:"movie",date:"2026-11-10T14:00:00Z",detail:"Release",rank:0,reason:"Old taste ranking"},{source:"radarr",title:"Today",kind:"movie",date:"2026-11-09T14:00:00Z",detail:"Release",rank:99,reason:""},{source:"jellyfin",title:"Old addition",kind:"library",date:"2026-11-07T14:00:00Z",detail:"Movie"},{source:"jellyfin",title:"New addition",kind:"library",date:"2026-11-08T14:00:00Z",detail:"Movie"}];
    const sections=reportSections(rows,now,"America/Chicago");
    assert.deepEqual(sections.upcoming.map(i=>i.title),["Today","Tomorrow"]);
    assert.deepEqual(sections.library.map(i=>i.title),["New addition","Old addition"]);
    assert.deepEqual(sections,reportSections([...rows].reverse(),now,"America/Chicago"));
});
