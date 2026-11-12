import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {database} from '../tests/helpers';
import {providers,briefingCandidates,reportDay,rankOutput} from '../src/server/model';
import {settings} from '../src/server/schema';
import {generateReport,overview,type Host} from '../src/server/service';
async function main(){
const context=process.argv[2]||'default';
const now=Date.now();const runId=new Date(now).toISOString().replaceAll(':','-');
const directory=resolve(homedir(),'.local/state/dione/baselines',runId);
await mkdir(directory,{recursive:true,mode:0o700});
const kube=['--context',context,'-n','outfitter-cloud'];
const server=execFileSync('kubectl',['--context',context,'config','view','--minify','-o','jsonpath={.clusters[0].cluster.server}'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(server!=='https://100.64.0.6:6443')throw Error('Refusing a non-Ocean Kubernetes target');
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const bundle=await build({entryPoints:[new URL('./capture-production.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const code=Buffer.from(bundle.outputFiles[0].contents).toString('base64');
function remote(payload:unknown):any{
    // Neither source code nor credentials are command arguments or log output.
    const bootstrap="let text='';for await(const chunk of process.stdin)text+=chunk;const p=JSON.parse(text);try{const m=await import('data:text/javascript;base64,'+p.code);process.stdout.write(JSON.stringify(await m.run(p.input)));}catch{process.stdout.write(JSON.stringify({error:'Private baseline operation failed'}));process.exitCode=1;}";
    const raw=execFileSync('kubectl',[...kube,'exec','-i','deployment/outfitter-webapp','-c','webapp','--','node','--input-type=module','-e',bootstrap],{input:JSON.stringify({code,input:payload}),encoding:'utf8',maxBuffer:16*1024*1024,timeout:240000,stdio:['pipe','pipe','pipe']});
    return JSON.parse(raw);
}
const secret=JSON.parse(execFileSync('kubectl',[...kube,'get','secret','dione-arr-mcp','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const config=JSON.parse(Buffer.from(secret.data['config.yaml'],'base64').toString('utf8'));
console.log('Collecting read-only production observations…');
const capture=remote({mode:'capture',services:config.services,start:new Date(now-86400000).toISOString(),end:new Date(now+7*86400000).toISOString()});
await writeFile(resolve(directory,'capture.json'),JSON.stringify(capture,null,2)+'\n',{mode:0o600});
if(!capture.reads.some((r:any)=>r.operation==='status.get'&&r.status==='ok'))throw Error('No live provider health reads passed; report evaluation refused');
console.log(`Captured ${capture.reads.length} reads; generating an isolated report…`);
const {db,client,close}=await database();let inference:any=null;const started=performance.now();
try{
    const bindings=providers.map(provider=>({provider,connectionId:`baseline-${provider}`,resource:`ocean-${provider}`}));
    await db.insert(settings).values({id:'default',timezone:'America/Chicago',hour:8,enabled:false,bindings:JSON.stringify(bindings),updatedAt:now});
    const runs=new Map<string,any>();
    const host={call:async(name:string,input:any):Promise<any>=>{
        if(name==='workflow.read')return runs.get(input.id)??null;
        if(name==='workflow.start'){runs.set(input.id,{readiness:{steps:{collect:'ready',rank:'waiting'}}});return {id:input.id};}
        if(name==='workflow.collect'){const run=runs.get(input.runId);run.readiness.steps=input.slot.startsWith('collect')?{collect:'complete',rank:'ready'}:{collect:'complete',rank:'complete'};return {run:input.slot.startsWith('rank')?'complete':'running',steps:run.readiness.steps};}
        if(name==='connector.execute'){
            if(!['briefing.read','missing.list','queue.list'].includes(input.operation))throw Error('Baseline rejects provider writes');
            const provider=bindings.find(b=>b.connectionId===input.connectionId)?.provider;
            const row=capture.reads.find((r:any)=>r.provider===provider&&r.operation===input.operation&&(r.input.cursor??'')===(input.input.cursor??''));
            if(!row||row.status!=='ok')throw Error('Captured source failed');return row.result;
        }
        if(name==='inference.generate'){
            const inferenceStarted=performance.now();
            inference={status:'failed',mode:'operator-Spark-provider',instructions:input.instructions,data:input.data,schema:input.schema,settings:{maxOutputTokens:3000,timeoutMs:60000,format:'json_schema'}};
            try{const result=remote({mode:'infer',instructions:input.instructions,data:input.data,schema:input.schema});if(result.error){inference={...inference,...result};throw Error('Inference failed');}const checked=rankOutput.safeParse(result.output);if(!checked.success){inference={...inference,...result,error:'Model reply failed report schema',validationStatus:'failed'};throw Error('Invalid report reply');}inference={...inference,...result,status:'ok',validationStatus:'ok'};return {output:checked.data};}catch{inference={...inference,status:'failed',durationMs:Math.round(performance.now()-inferenceStarted),error:inference?.error??'Inference did not return a validated result'};throw Error('Live inference unavailable');}
        }
        throw Error('Unsupported baseline host operation');
    }} as Host;
    const report=await generateReport(db,host,{runId:`prod-baseline-${runId}`,now});
    const all=await overview(db);
    const totalRecommendations=Number((await client.execute('SELECT COUNT(*) AS n FROM recommendations')).rows[0].n);
    const mcp=capture.reads.filter((r:any)=>r.provider==='arr-mcp').map((r:any)=>({tool:r.input.tool,status:r.status,returned:r.result?.data?.returned??null,total:r.result?.data?.total??null,degradedCount:r.result?.data?.degraded?.length??0}));
    const candidates=briefingCandidates(report.items,now,'America/Chicago');
    const summary={sourceCommit:source,connectorRevision:capture.connectorRevision,platformRevision:capture.platformRevision,capturedAt:capture.observedAt,reportDay:reportDay(now,'America/Chicago'),providerWrites:false,executionMode:capture.executionMode,workflowMode:'isolated evaluation harness; not an installed/scheduled workflow',inferenceMode:inference?.mode??'not-called',inferenceStatus:inference?.status??'not-called',reportStatus:report.report.status,observations:report.items.length,candidates:candidates.length,ranked:report.items.filter(i=>i.reason).length,recommendations:totalRecommendations,visibleRecommendations:all.recommendations.length,mcp,readCalls:capture.reads.length,failedReads:capture.reads.filter((r:any)=>r.status!=='ok').map((r:any)=>({provider:r.provider,operation:r.operation,error:r.error,detail:r.detail})),sources:report.sources.map(s=>({source:s.source,status:s.status,count:s.count,truncated:s.truncated})),reportDurationMs:Math.round(performance.now()-started)};
    await writeFile(resolve(directory,'report.json'),JSON.stringify({report,overview:all,inference},null,2)+'\n',{mode:0o600});
    await writeFile(resolve(directory,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
    const notes=['# Dione production-read baseline','',`Captured: ${capture.observedAt}`,`Source: ${source}`,'','Real provider reads; no provider writes. Report generated using real application services in an isolated evaluation harness. This does not prove an installed owner session, scheduled workflow or graph publication.','',`## Briefing (${report.report.status})`,'',report.report.summary,'','## Source coverage','',...summary.sources.map(s=>`- ${s.source}: ${s.status}; ${s.count} observations${s.truncated?'; bounded/truncated':''}`),'','## Report observations (unranked when inference is unavailable)','',...report.items.slice(0,30).map(i=>`- ${i.title} (${i.source}, ${i.kind}): ${i.reason||i.detail}`),'','## Evaluation boundaries','',`Inference: ${summary.inferenceStatus} (${summary.inferenceMode}).`,`${summary.observations} observations; ${summary.candidates} candidates; ${summary.ranked} model-ranked; ${summary.recommendations} proposed recommendations. No recommendations were confirmed or submitted.`,`Raw reads and timestamps: capture.json. Report, model input/output and usage: report.json.`];
    await writeFile(resolve(directory,'report.md'),notes.join('\n')+'\n',{mode:0o600});
    console.log(JSON.stringify({directory,...summary},null,2));
}finally{close();}

}
try{await main();}catch{console.error("Production baseline failed; private subprocess output withheld. Inspect the private capture directory.");process.exitCode=1;}
