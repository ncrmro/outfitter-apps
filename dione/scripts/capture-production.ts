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
