// Fictional titles and activity, deliberately independent of live Ocean data.
import type { z } from "zod";
import { briefingRead, providers } from "../src/server/model";
import type { Host } from "../src/server/service";
import { hostDouble } from "../tests/helpers";
type Item = z.infer<typeof briefingRead>["items"][number];
type Entry = [string, Item["kind"], number | null, string, boolean?];
const catalog: Record<typeof providers[number], Entry[]> = {
    radarr: [
        ["Synthetic Moonrise", "movie", 0, "Digital release today · 2026 · science fiction · 118 min", true],
        ["The Glass Orchard", "movie", 2, "Digital release in two days · 2026 · mystery · 104 min"],
        ["A Map of Quiet Places", "movie", 5, "Upcoming documentary · 92 min · monitored"],
        ["Northbound at Midnight", "movie", null, "Monitored missing film · 2025 · thriller · review a search", true],
        ["The Last Observatory", "movie", null, "Monitored missing film · 2024 · science fiction · review a search", true],
    ],
    sonarr: [
        ["Signal Coast · S02E05 · Low Tide", "episode", 0, "New episode tonight · 48 min · monitored"],
        ["The Archive Room · S01E03 · Carbon Copy", "episode", 0, "New episode tonight · 43 min · monitored"],
        ["Orbital Garden · S03E08 · Perihelion", "episode", 1, "New episode tomorrow · 52 min · monitored"],
        ["Signal Coast · S02E04 · Soundings", "episode", null, "Missing episode from last week · monitored", true],
        ["Small Hours · S01E06 · Night Bus", "episode", null, "Missing episode · 29 min · review a search", true],
    ],
    lidarr: [
        ["Paper Satellites — Soft Geometry", "album", 0, "New album today · dream pop · 11 tracks", true],
        ["Mara Vale — In the Blue Hour", "album", 3, "Upcoming release in three days · ambient folk · 9 tracks"],
        ["Tidal Assembly — Warm Current", "album", 0, "New EP today · electronic · 5 tracks", true],
        ["Juniper Static — Field Notes", "album", null, "Monitored missing album · indie rock · 12 tracks", true],
        ["The Lantern District — Afterimage", "album", null, "Monitored missing album · jazz · 8 tracks", true],
    ],
    jellyfin: [
        ["The Long Way Home", "library", -1, "Recently added film · drama · 112 min · ready to play"],
        ["Ocean Atlas · Season 1", "library", -1, "Recently added documentary series · 6 episodes · ready to play"],
        ["Paper Satellites — Early Signals", "library", -2, "Recently added album · 10 tracks · available in Music"],
        ["A Sunday in October", "library", 0, "Added this morning · comedy · 97 min · ready to play"],
        ["Between Two Harbors", "library", -2, "Recently added film · adventure · 106 min · ready to play"],
    ],
    transmission: [
        ["Synthetic Moonrise · 1080p", "download", 0, "Downloading · 62% · 8.4 MB/s · 1.9 GB remaining · ETA 4 min"],
        ["Ocean Atlas · Season 2", "download", 0, "Downloading · 18% · 3.1 MB/s · 8.2 GB remaining · ETA 44 min"],
        ["Public-domain short film collection", "download", 0, "Seeding · 100% complete · upload 420 KB/s · ratio 1.42"],
    ],
    sabnzbd: [
        ["Signal Coast · S02E05", "download", 0, "Downloading · 74% · 22 MB/s · 820 MB remaining · ETA 38 sec"],
        ["Paper Satellites — Soft Geometry · FLAC", "download", 0, "Queued · 640 MB · waiting behind the active episode"],
        ["The Archive Room · S01E02", "download", -1, "Completed · unpacked and imported · no action needed"],
    ],
};
export const demoBindings = providers.map(provider => ({provider, connectionId: `demo-${provider}`, resource: `ocean-${provider}`}));
export const demoStack = {connectionId: "demo-arr-mcp", resource: "ocean-media-stack"};
export function demoHost(now: number, unavailable?: string) {
    const base = hostDouble();
    const snapshot = [...demoBindings.map(binding => ({id: binding.connectionId, provider: binding.provider, resource: binding.resource, owner: "user", operations: ["briefing.read", "missing.list", "queue.list", ...(["radarr", "sonarr", "lidarr"].includes(binding.provider) ? ["request.search"] : [])]})), {id: demoStack.connectionId, provider: "arr-mcp", resource: demoStack.resource, owner: "user", operations: ["read.call", "status.get"]}];
    const host = {call: async (name: string, input: any): Promise<any> => {
        if (name === "snapshot") return {connections: snapshot};
        if (name === "connector.execute") {
            const provider = demoBindings.find(b => b.connectionId === input.connectionId)?.provider;
            if (!provider) throw Error("Unknown synthetic connection");
            if (input.operation === "request.search") {
                if (input.input.id === 5 && provider === "sonarr") throw Error("Synthetic interrupted provider receipt");
                return {id: `demo-${provider}-${input.input.id}`, status: "queued", synthetic: true};
            }
            if (provider === unavailable) throw Error("Synthetic source outage");
            const entries = input.operation === "briefing.read" ? catalog[provider].filter(e => !["radarr", "sonarr", "lidarr"].includes(provider) || e[2] !== null) : input.operation === "missing.list" ? catalog[provider].filter(e => e[2] === null) : [];
            return {items: entries.map(([title, kind, offset, detail, request]): Item => ({id: String(catalog[provider].findIndex(e => e[0] === title) + 1), title, kind, date: offset === null ? null : new Date(now + offset * 86400000).toISOString(), detail, url: `https://${provider}.example/items/${catalog[provider].findIndex(e => e[0] === title) + 1}`, ...(request ? {request: {operation: "request.search" as const, input: {id: catalog[provider].findIndex(e => e[0] === title) + 1}}} : {})})), cursor: null, truncated: false};
        }
        return base.host.call(name as any, input);
    }} as Host;
    return {host, snapshot};
}
