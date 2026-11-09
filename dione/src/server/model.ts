import { z } from "zod";
import type { AppIdentity } from "@ai-outfitter/app-sdk/server";
export const providers = ["radarr", "sonarr", "lidarr", "jellyfin", "transmission", "sabnzbd"] as const;
export const binding = z.strictObject({ provider: z.enum(providers), connectionId: z.string().min(1).max(256), resource: z.string().min(1).max(1024) });
export const settingsInput = z.strictObject({ timezone: z.string().min(1).max(64).refine(value => { try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
    }
    catch {
        return false;
    } }, "Invalid time zone"), hour: z.number().int().min(0).max(23), enabled: z.boolean(), bindings: z.array(binding).max(6).refine(rows => new Set(rows.map(r => r.provider)).size === rows.length, "One binding per provider") });
export type Binding = z.infer<typeof binding>;
export const briefingRead = z.object({ items: z.array(z.object({ id: z.string().min(1).max(256), title: z.string().min(1).max(500), kind: z.enum(["movie", "episode", "album", "library", "download"]), date: z.string().nullable(), detail: z.string().max(2000), url: z.string().nullable(), request: z.object({ operation: z.literal("request.search"), input: z.object({ id: z.number().int().positive() }) }).optional() })).max(100), cursor: z.string().nullable(), truncated: z.boolean() });
export const rankOutput = z.strictObject({ summary: z.string().max(2000), items: z.array(z.strictObject({ ref: z.string(), reason: z.string().max(400) })).max(20) });
export const rankSchema = { type: "object", properties: { summary: { type: "string", maxLength: 2000 }, items: { type: "array", maxItems: 20, items: { type: "object", properties: { ref: { type: "string" }, reason: { type: "string", maxLength: 400 } }, required: ["ref", "reason"], additionalProperties: false } } }, required: ["summary", "items"], additionalProperties: false };
export function owner(identity: AppIdentity) {
    if (identity.owner.kind !== "user" || identity.owner.id !== identity.userId || !identity.canEdit)
        throw new Response("Only the personal app owner can access Dione", { status: 403 });
}
export function safeURL(value: string | null) { if (!value)
    return null; try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
}
catch {
    return null;
} }
export const plain = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max);
export function reportDay(now: number, timezone: string) { const f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); return ["year", "month", "day"].map(k => f.find(p => p.type === k)!.value).join("-"); }

/** Keep the agent input bounded without letting alphabetically early library
 * titles crowd out today's releases or a quieter media source. */
export function briefingCandidates<T extends {source:string;sourceId:string;title:string;kind:string;date:string|null}>(rows:T[],now:number,timezone:string,limit=60):T[] {
    const today=reportDay(now,timezone);
    const priority=(row:T)=>{
        const date=row.date?Date.parse(row.date):Number.NaN;
        if(Number.isFinite(date)&&reportDay(date,timezone)===today)return 0;
        if(Number.isFinite(date)&&date>now&&date<=now+7*86400000)return 1;
        if(["movie","episode","album"].includes(row.kind))return 2;
        if(row.kind==="download")return 3;
        if(row.kind==="library"&&Number.isFinite(date)&&date>=now-7*86400000)return 4;
        return 5;
    };
    const compare=(a:T,b:T)=>priority(a)-priority(b)||(a.date&&b.date?Date.parse(a.date)-Date.parse(b.date):0)||a.title.localeCompare(b.title)||a.sourceId.localeCompare(b.sourceId);
    const groups=new Map<string,T[]>();
    for(const row of rows){const key=`${row.source}:${row.kind}`;const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
    for(const group of groups.values())group.sort(compare);
    const result:T[]=[];
    while(result.length<limit){
        const available=[...groups.entries()].filter(([,group])=>group.length).sort(([key,a],[other,b])=>compare(a[0],b[0])||key.localeCompare(other));
        if(!available.length)break;
        for(const [,group]of available){result.push(group.shift()!);if(result.length===limit)break;}
    }
    return result;
}
