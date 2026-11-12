// Trusted operator evaluation only. Runs inside Ocean; never an HTTP/app endpoint.
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {executeConnector, type ConnectorOperationContext} from '@ai-outfitter/connector-core/runtime';
import {providers} from '../src/server/model';
const exportsByProvider = {radarr:'radarrConnector',sonarr:'sonarrConnector',lidarr:'lidarrConnector',jellyfin:'jellyfinConnector',transmission:'transmissionConnector',sabnzbd:'sabnzbdConnector','arr-mcp':'arrMcpConnector'};
const allowed = new Set(['status.get','briefing.read','missing.list','queue.list','library.list','history.list','read.call']);
export function readAllowed(provider:string,operation:string){return Object.hasOwn(exportsByProvider,provider)&&allowed.has(operation)&&(provider==='arr-mcp'?operation==='read.call':operation!=='read.call');}
export function clean(value: unknown, secrets: string[]): any {
    if (typeof value === 'string') {
        let text=value; for(const secret of secrets.filter(x=>x.length>=8)) text=text.replaceAll(secret,'[redacted]');
        return text.replace(/https?:\/\/[^\s<>"']+/g,raw=>{try{const u=new URL(raw);u.username='';u.password='';for(const k of [...u.searchParams.keys()])if(/key|token|secret|pass|auth/i.test(k))u.searchParams.set(k,'[redacted]');return u.href;}catch{return '[invalid URL]';}});
    }
    if(Array.isArray(value))return value.map(v=>clean(v,secrets));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/^(?:api.?key|token|password|secret|authorization|credentials?)$/i.test(k)?'[redacted]':clean(v,secrets)]));
    return value;
}
export async function run(input: any) {
    if(input.mode==='infer'){
        // Explicit operator model baseline, NOT an installed workflow principal.
        const base=process.env.SPARK_BASE_URL;
        if(!base)throw Error('Configured Spark inference is unavailable');
        const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1'))throw Error('Invalid inference endpoint');
        const headers:Record<string,string>={'content-type':'application/json'};
        if(process.env.SPARK_AUTHORIZATION)headers.Authorization=process.env.SPARK_AUTHORIZATION;
        if(process.env.SPARK_ACCESS_CLIENT_ID&&process.env.SPARK_ACCESS_CLIENT_SECRET){headers['CF-Access-Client-Id']=process.env.SPARK_ACCESS_CLIENT_ID;headers['CF-Access-Client-Secret']=process.env.SPARK_ACCESS_CLIENT_SECRET;}
        if(Object.keys(headers).length===1)throw Error('Inference credentials unavailable');
        const model=process.env.AI_MODEL||'GLM-5.3-Flash-EXL3';
        const started=performance.now();
        const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(60000),body:JSON.stringify({model,temperature:0,max_tokens:3000,messages:[{role:'system',content:input.instructions+'\nReturn only JSON matching this result schema: '+JSON.stringify(input.schema)},{role:'user',content:JSON.stringify(input.data)}],response_format:{type:'json_schema',json_schema:{name:'dione_briefing',strict:true,schema:input.schema}}})});
        if(!response.ok)return {error:'Inference HTTP failure',httpStatus:response.status,model,durationMs:Math.round(performance.now()-started)};
        const data:any=await response.json();const text=data.choices?.[0]?.message?.content;
        if(typeof text!=='string')return {error:'No structured model reply',model,finishReason:data.choices?.[0]?.finish_reason??null,durationMs:Math.round(performance.now()-started)};
        const secrets=[process.env.SPARK_AUTHORIZATION||'',process.env.SPARK_ACCESS_CLIENT_SECRET||''];
        return clean({output:JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,'')),model,durationMs:Math.round(performance.now()-started),usage:data.usage??null},secrets);
    }
    if(input.mode!=='capture')throw Error('Unknown baseline mode');
    const db=new DatabaseSync(new URL(process.env.DATABASE_URL!).pathname,{readOnly:true});
    let owner:any;
    try {const rows=db.prepare("SELECT id,userId,externalId,config FROM connections WHERE provider='arr-mcp' AND status='active' AND organizationId IS NULL AND externalId='ocean-media-stack'").all();if(rows.length!==1)throw Error('Expected approved personal MCP connection');owner=rows[0];}finally{db.close();}
    const secrets=[process.env.DIONE_ARR_MCP_API_KEY||'',...Object.values(input.services as Record<string,any>).map(s=>s.api_key||'')];
    const reads:any[]=[];
    async function read(provider:keyof typeof exportsByProvider,operation:string,args:any){
        if(!readAllowed(provider,operation))throw Error('Baseline is read-only');
        const started=performance.now();const observedAt=new Date().toISOString();
        const resource=provider==='arr-mcp'?owner.externalId:`ocean-${provider}`;
        const service=input.services[provider];
        const approved=provider==='arr-mcp'?JSON.parse(owner.config):{baseUrl:service.url};
        if(provider!=='arr-mcp'&&!/^http:\/\/(?:radarr|sonarr|lidarr|jellyfin|sabnzbd)\.servarr\.svc\.cluster\.local:\d+\/?$|^http:\/\/transmission\.transmission\.svc\.cluster\.local:9091\/?$/.test(approved.baseUrl))throw Error('Unexpected service endpoint');
        const connectionId=provider==='arr-mcp'?owner.id:`operator-baseline-${provider}`;
        const context:ConnectorOperationContext={connection:{id:connectionId,provider,externalId:resource,owner:{kind:'user',id:owner.userId},status:'active',config:approved},scope:{organizationId:null,installationId:'operator-baseline',userId:owner.userId,connectionId,resource,operations:[operation]},credentials:provider==='arr-mcp'?{apiKey:process.env.DIONE_ARR_MCP_API_KEY!}:service.api_key?{apiKey:service.api_key}:{}};
        const module=await import(`file:///opt/outfitter-connectors/${provider}/runtime.mjs`);
        try{
            const result=await executeConnector(module[exportsByProvider[provider]],operation,args,context);
            const row={provider,operation,input:args,observedAt,durationMs:Math.round(performance.now()-started),status:'ok',result:clean(result,secrets)};reads.push(row);return row;
        }catch(error){const message=error instanceof Response?await error.text():'';const detail=message.includes('response too large')?'response-size-bound':message.includes('Invalid connector input')?'invalid-connector-input':message.includes('HTTP ')?'provider-http-failure':'read-failure';const row={provider,operation,input:args,observedAt,durationMs:Math.round(performance.now()-started),status:'failed',error:error instanceof Response?`Connector HTTP ${error.status}`:'Connector read failed',detail};reads.push(row);return row;}
    }
    for(const provider of providers){
        await read(provider,'status.get',{});
        for(const operation of ['briefing.read',...(['radarr','sonarr','lidarr'].includes(provider)?['missing.list','queue.list']:[])]){
            let cursor:string|undefined;
            for(let page=0;page<3;page++){
                const row:any=await read(provider,operation,{...(operation==='briefing.read'?{start:input.start,end:input.end}:{}),limit:100,...(cursor?{cursor}:{})});
                cursor=row.result?.cursor;if(row.status!=='ok'||!cursor)break;
            }
        }
        if(['radarr','sonarr','lidarr','jellyfin'].includes(provider))await read(provider,'library.list',{limit:20});
        if(provider==='sabnzbd')await read(provider,'history.list',{limit:20});
    }
    const mcp=[['get_stack_health',{limit:10}],['get_calendar',{days_back:1,days_ahead:7,limit:20}],['get_queue',{limit:20}],['get_wanted',{scope:'missing',limit:20}],['get_library',{limit:10}]] as const;
    for(const [tool,args]of mcp)await read('arr-mcp','read.call',{tool,arguments:args});
    const manifest=JSON.parse(await readFile('/opt/outfitter-connectors/manifest.json','utf8'));
    return {connectorRevision:manifest.revision,observedAt:new Date().toISOString(),platformRevision:process.env.DEPLOYMENT_REVISION,providerWrites:false,executionMode:'explicit-read-only-operator-baseline',reads};
}
