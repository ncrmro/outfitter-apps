import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean,readAllowed,run} from '../scripts/capture-production';
import {baselineHost,baselineOptions,capturedReportTime,checkedCapture} from '../scripts/production-baseline';
test('operator baseline denies mutation, arbitrary providers and cross-provider MCP execution',()=>{
    for(const provider of ['radarr','sonarr','lidarr','jellyfin','transmission','sabnzbd','arr-mcp'])
        for(const operation of ['request.search','delete','torrent-add','pause_downloads','schedule.save'])
            assert.equal(readAllowed(provider,operation),false);
    assert.equal(readAllowed('unknown','briefing.read'),false);
    assert.equal(readAllowed('radarr','read.call'),false);
    assert.equal(readAllowed('arr-mcp','queue.list'),false);
    assert.equal(readAllowed('arr-mcp','read.call'),true);
    assert.equal(readAllowed('transmission','briefing.read'),true);
});
test('private baseline removes credential echoes and URL authentication without dropping useful observations',()=>{
    const secret='example-private-provider-key';
    const output=clean({title:'A useful media title',api_key:secret,child:[{detail:`Echo ${secret}`,url:`https://user:pass@example.test/items?apikey=${secret}&sort=added`,password:'other secret'}]},[secret]);
    assert.equal(output.title,'A useful media title');
    const serialized=JSON.stringify(output);
    assert.ok(!serialized.includes(secret));assert.ok(!serialized.includes('other secret'));assert.ok(!serialized.includes('user:pass'));
    assert.match(serialized,/sort=added/);assert.match(serialized,/redacted/);
});
test('unknown operator mode fails before any production database or provider access',async()=>{
    for (const mode of ['write','infer','unknown']) await assert.rejects(run({mode}),/Unknown baseline mode/);
});

const captureFixture = () => checkedCapture({observedAt:'2026-11-12T16:05:00.000Z',providerWrites:false,executionMode:'explicit-read-only-operator-baseline',reads:[{provider:'radarr',operation:'status.get',input:{},status:'ok',result:{}},{provider:'radarr',operation:'briefing.read',input:{start:'2026-11-11T16:00:00.000Z'},status:'ok',result:{items:[],cursor:null,truncated:false}}]});
test('private capture replay options and report time need no Kubernetes or provider execution',()=>{
    assert.deepEqual(baselineOptions([]),{context:'default',capture:null});
    assert.equal(baselineOptions(['--capture','/private/capture.json']).capture,'/private/capture.json');
    assert.equal(baselineOptions(['ocean','--capture','/private/capture.json']).context,'ocean');
    assert.throws(()=>baselineOptions(['--capture']),/capture path/);
    assert.throws(()=>baselineOptions(['--write']),/Unsupported/);
    assert.equal(capturedReportTime(captureFixture()),Date.parse('2026-11-12T16:00:00.000Z'));
});
test('replay rejects write captures and malformed observation envelopes',()=>{
    assert.throws(()=>checkedCapture({...captureFixture(),providerWrites:true}),/read-only capture/);
    assert.throws(()=>checkedCapture({...captureFixture(),reads:[{provider:'radarr',operation:'request.search',input:{},status:'ok'}]}),/read-only capture observation/);
});
test('baseline harness records collect then briefing receipts and rejects provider writes',async()=>{
    const {host,runs}=baselineHost(captureFixture(),[{provider:'radarr',connectionId:'baseline-radarr',resource:'ocean-radarr'}]);
    await host.call('workflow.start',{workflow:'dione-briefing',id:'baseline',inputs:{}});
    await assert.rejects(host.call('workflow.collect',{runId:'baseline',slot:'briefing.outputs.briefing',value:{reportId:'baseline'}}),/workflow receipt/);
    await host.call('workflow.collect',{runId:'baseline',slot:'collect.outputs.observations',value:{count:0}});
    await host.call('workflow.collect',{runId:'baseline',slot:'briefing.outputs.briefing',value:{reportId:'baseline'}});
    assert.equal(runs.get('baseline').readiness.run,'complete');
    assert.deepEqual(Object.keys(runs.get('baseline').receipts),['collect.outputs.observations','briefing.outputs.briefing']);
    const result=await host.call('connector.execute',{connectionId:'baseline-radarr',resource:'ocean-radarr',operation:'briefing.read',input:{}});
    assert.deepEqual(result,{items:[],cursor:null,truncated:false});
    await assert.rejects(host.call('connector.execute',{connectionId:'baseline-radarr',resource:'ocean-radarr',operation:'request.search',input:{id:1}}),/rejects provider writes/);
});
