import { z } from "zod";
import type { AppIdentity } from "@ai-outfitter/app-sdk/server";
export const providers = ["radarr", "sonarr", "lidarr", "jellyfin", "transmission", "sabnzbd"] as const;
export const binding = z.strictObject({ provider: z.enum(providers), connectionId: z.string().min(1).max(256), resource: z.string().min(1).max(1024) });
export const arrMcpBinding = z.strictObject({ connectionId: z.string().min(1).max(256), resource: z.string().min(1).max(1024) });
export const settingsInput = z.strictObject({ timezone: z.string().min(1).max(64).refine(value => { try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
    }
    catch {
        return false;
    } }, "Invalid time zone"), hour: z.number().int().min(0).max(23), enabled: z.boolean(), bindings: z.array(binding).max(6).refine(rows => new Set(rows.map(r => r.provider)).size === rows.length, "One binding per provider"), arrMcpBinding: arrMcpBinding.nullable().default(null) });
export type Binding = z.infer<typeof binding>;
export const briefingRead = z.object({ items: z.array(z.object({ id: z.string().min(1).max(256), title: z.string().min(1).max(500), kind: z.enum(["movie", "episode", "album", "library", "download"]), date: z.string().nullable(), detail: z.string().max(2000), url: z.string().nullable(), request: z.object({ operation: z.literal("request.search"), input: z.object({ id: z.number().int().positive() }) }).optional() })).max(100), cursor: z.string().nullable(), truncated: z.boolean() });
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

export const reportSectionNames = ["upcoming", "library", "attention"] as const;
export type ReportSection = typeof reportSectionNames[number];
type Observation = { id?: string; sourceId?: string; source: string; title: string; kind: string; date: string | null; detail: string; section?: string | null };
/** Sections describe provider facts, not inferred taste or importance. */
export function observationSection(item: Observation, now: number, timezone: string, operation?: string, requestable = false, day = reportDay(now, timezone)): ReportSection | null {
    const date = item.date ? Date.parse(item.date) : Number.NaN;
    if (item.kind === "library" && item.source === "jellyfin")
        return Number.isFinite(date) && date <= now && date >= now - 7 * 86400000 ? "library" : null;
    if (item.kind === "download") {
        if (/\b(error|failed|stalled|warning|blocked|paused|stopped)\b/i.test(item.detail)) return "attention";
        if (/\b(seeding|completed|imported)\b/i.test(item.detail)) return null;
        return "attention";
    }
    if (["movie", "episode", "album"].includes(item.kind) && Number.isFinite(date) && ( /^\d{4}-\d{2}-\d{2}$/.test(item.date!) || (["movie", "album"].includes(item.kind) && /T00:00:00(?:\.000)?Z$/.test(item.date!)) ? item.date!.slice(0,10) : reportDay(date, timezone)) >= day && date < now + 7 * 86400000)
        return "upcoming";
    if (operation === "missing.list" || requestable || /\bmissing\b|not in library/i.test(item.detail)) return "attention";
    return null;
}
export function reportSections<T extends Observation>(rows: T[], now: number, timezone: string, day = reportDay(now, timezone)) {
    const sections: Record<ReportSection, T[]> = {upcoming: [], library: [], attention: []};
    for (const row of rows) {
        const section = reportSectionNames.includes(row.section as ReportSection) ? row.section as ReportSection : observationSection(row, now, timezone, undefined, false, day);
        if (section) sections[section].push(row);
    }
    const title = (a: T, b: T) => a.title.localeCompare(b.title) || a.source.localeCompare(b.source) || String(a.id ?? a.sourceId ?? "").localeCompare(String(b.id ?? b.sourceId ?? ""));
    sections.upcoming.sort((a,b) => Date.parse(a.date!) - Date.parse(b.date!) || title(a,b));
    sections.library.sort((a,b) => Date.parse(b.date!) - Date.parse(a.date!) || title(a,b));
    sections.attention.sort((a,b) => a.source.localeCompare(b.source) || title(a,b));
    return sections;
}
export function reportSummary(sections: Record<ReportSection, unknown[]>) {
    const phrase = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
    return `${phrase(sections.upcoming.length, "upcoming release")}, ${phrase(sections.library.length, "recent library addition")}, and ${phrase(sections.attention.length, "item")} needing attention.`;
}
