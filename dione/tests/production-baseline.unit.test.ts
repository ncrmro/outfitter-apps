import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean,readAllowed,run} from '../scripts/capture-production';
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
    await assert.rejects(run({mode:'write'}),/Unknown baseline mode/);
});
