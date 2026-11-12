import { onPageLoad } from "@ai-outfitter/ui/page";
import type { overview, readReport, loadSettings } from "../server/service";
import type { Binding } from "../server/model";
type Overview = Awaited<ReturnType<typeof overview>>;
type Report = Awaited<ReturnType<typeof readReport>>;
type Settings = Awaited<ReturnType<typeof loadSettings>>;
const demo = import.meta.env.OUTFITTER_APP_MODE === "demo";
const notice = (text: string) => { const el = document.getElementById("notice"); if (el)
    el.textContent = text; };
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    if (demo) {
        if (method !== "GET")
            throw new Error("This demo is read-only.");
        const fixtures = (await import("../../fixtures/demo.json")).default;
        if (path.startsWith("report?")) {
            const id = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("id");
            const report = id ? fixtures.reports[id as keyof typeof fixtures.reports] : undefined;
            if (!report) throw new Error("Demo report not found.");
            return report as T;
        }
        return fixtures[path as "overview" | "settings"] as T;
    }
    const response = await fetch(`api/apps/dione/${path}`, { method, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok)
        throw new Error(await response.text() || `Request failed (${response.status})`);
    return response.json();
}
const node = (tag: string, text?: string) => { const el = document.createElement(tag); if (text)
    el.textContent = text; return el; };
const sectionNames = ["upcoming", "library", "attention"] as const;
const sourceNames: Record<string, string> = { radarr: "Radarr", sonarr: "Sonarr", lidarr: "Lidarr", jellyfin: "Jellyfin", transmission: "Transmission", sabnzbd: "SABnzbd" };
const sourceName = (source: string) => sourceNames[source] ?? source;
const emptySections = {
    upcoming: "No upcoming releases were returned by the connected sources.",
    library: "No recent library additions were returned by the connected sources.",
    attention: "No missing media or active download items were returned by the connected sources.",
};
function itemCard(item: Report["items"][number]) {
    const li = node("li");
    li.append(node("h3", item.title), node("small", `${sourceName(item.source)} · ${item.kind}${item.date ? ` · ${item.date}` : ""}`), node("p", item.detail));
    if (item.url) {
        const a = document.createElement("a");
        a.textContent = "View source";
        a.href = item.url;
        a.rel = "noreferrer noopener";
        a.target = "_blank";
        li.append(a);
    }
    return li;
}
function showReport(value: Report) {
    const report = document.getElementById("briefing");
    if (report) report.replaceChildren(node("h2", `${value.report.day} · ${value.report.status}`), node("p", value.report.summary), node("small", `Generated ${new Date(value.report.generatedAt).toLocaleString()}`));
    for (const section of sectionNames) {
        const rows = value.sections[section];
        document.getElementById(`${section}-items`)?.replaceChildren(...rows.map(itemCard));
        const count = document.getElementById(`${section}-count`);
        if (count) count.textContent = `${rows.length} ${rows.length === 1 ? "item" : "items"}`;
        const empty = document.getElementById(`${section}-empty`);
        if (empty) { empty.textContent = emptySections[section]; empty.hidden = rows.length > 0; }
    }
    const needsCheck = value.sources.filter(source => source.status !== "ok");
    document.getElementById("source-attention")?.replaceChildren(...needsCheck.map(source => {
        const state = source.status === "partial" ? "returned a limited result; some items may be missing" : source.status === "unavailable" ? "is unavailable; its media could not be checked" : "needs a check";
        return node("li", `${sourceName(source.source)} ${state}.${source.error ? ` ${source.error}.` : ""} Checked ${new Date(source.observedAt).toLocaleString()}.`);
    }));
    const sources = document.getElementById("sources");
    if (sources) sources.replaceChildren(...value.sources.map(source => node("li", `${sourceName(source.source)}: ${source.status} · ${source.count} observations · ${new Date(source.observedAt).toLocaleString()}${source.error ? ` · ${source.error}` : ""}${source.truncated ? " · Results limited" : ""}`)));
    const sourceEmpty = document.getElementById("source-empty");
    if (sourceEmpty) sourceEmpty.hidden = value.sources.length > 0;
    const summary = document.getElementById("source-summary");
    if (summary) summary.textContent = value.sources.length ? `· ${value.sources.length} services${needsCheck.length ? ` · ${needsCheck.length} need a check` : ""}` : "";
}

async function loadOverview() {
    const value = await api<Overview>("overview");
    if (value.latest)
        showReport({ report: value.latest, items: value.items, sources: value.sources, sections: value.sections });
    else {
        const section = document.getElementById("briefing");
        if (section)
            section.textContent = "No report yet. Connect your media services in Settings, then refresh your briefing.";
    }
    const history = document.getElementById("history");
    if (history) {
        let selection = 0;
        history.replaceChildren(...value.reports.map(report => {
            const li = node("li");
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${report.day} · ${report.status}`;
            button.setAttribute("aria-pressed", String(report.id === value.latest?.id));
            button.onclick = async () => {
                const request = ++selection;
                button.disabled = true;
                try {
                    const result = await api<Report>(`report?id=${encodeURIComponent(report.id)}`);
                    if (request !== selection) return;
                    showReport(result);
                    for (const candidate of history.querySelectorAll("button")) candidate.setAttribute("aria-pressed", String(candidate === button));
                    if (window.innerWidth < 700) document.getElementById("briefing")?.scrollIntoView({ block: "start" });
                } catch (error) { if (request === selection) notice(error instanceof Error ? error.message : "Could not load this briefing"); }
                finally { button.disabled = false; }
            };
            li.append(button, node("p", report.summary));
            return li;
        }));
    }
    const recs = document.getElementById("recommendations");
    if (recs) {
        recs.replaceChildren(...value.recommendations.map(rec => { const li = node("li"); li.append(node("h3", rec.title), node("p", `${rec.source} · ${rec.status}`)); if (rec.receipt)
            li.append(node("p", rec.receipt)); if (rec.status === "proposed") {
            const button = document.createElement("button");
            button.textContent = "Review request";
            button.disabled = demo;
            button.onclick = async () => { if (!window.confirm(`Ask ${rec.source} to search for “${rec.title}”? This may begin a download using your existing service settings.`))
                return; button.disabled = true; try {
                await api("confirm", "POST", { id: rec.id, confirmed: true });
                notice("Request submitted.");
                await loadOverview();
            }
            catch (error) {
                notice(error instanceof Error ? error.message : "Request failed");
                await loadOverview();
            } };
            li.append(button);
        } return li; }));
        if (!value.recommendations.length)
            recs.append(node("p", "No download recommendations yet."));
    }
}
async function loadSetup() {
    const data = await api<{
        settings: Settings;
        connections: Array<Binding & {
            operations: string[];
        }>;
        stackConnections?: Array<{ connectionId: string; resource: string }>;
        schedules: Array<{
            workflowId: string;
            enabled: boolean;
            nextRunAt: number | null;
            lastOutcome: string | null;
        }>;
    }>("settings");
    const stack = document.getElementById("arr-mcp") as HTMLSelectElement;
    const stackConnections = data.stackConnections ?? [];
    stack.replaceChildren(new Option("Not connected", ""), ...stackConnections.map(c => new Option(c.resource, JSON.stringify(c))));
    const stackCurrent = stackConnections.find(c => c.connectionId === data.settings.arrMcpBinding?.connectionId && c.resource === data.settings.arrMcpBinding?.resource);
    if (stackCurrent) stack.value = JSON.stringify(stackCurrent);
    stack.disabled = demo;
    const el = document.getElementById("connections")!;
    const providers = ["radarr", "sonarr", "lidarr", "jellyfin", "transmission", "sabnzbd"];
    el.replaceChildren(...providers.map(provider => { const label = node("label", provider); const select = document.createElement("select"); select.name = provider; select.append(new Option("Not connected", "")); for (const c of data.connections.filter(c => c.provider === provider))
        select.append(new Option(c.resource, JSON.stringify(c))); const current = data.settings.bindings.find(b => b.provider === provider); const match = data.connections.find(c => c.provider === provider && c.connectionId === current?.connectionId && c.resource === current?.resource); if (match)
        select.value = JSON.stringify(match); select.disabled = demo; label.append(select); return label; }));
    (document.getElementById("timezone") as HTMLInputElement).value = data.settings.timezone;
    (document.getElementById("hour") as HTMLInputElement).value = String(data.settings.hour);
    (document.getElementById("enabled") as HTMLInputElement).checked = data.settings.enabled;
    const schedule = data.schedules.find(s => s.workflowId === "dione-briefing");
    document.getElementById("schedule-health")!.textContent = schedule ? `${schedule.enabled ? "Enabled" : "Disabled"}${schedule.nextRunAt ? ` · Next run ${new Date(schedule.nextRunAt).toLocaleString()}` : ""}${schedule.lastOutcome ? ` · Last outcome: ${schedule.lastOutcome}` : ""}` : "No schedule enabled.";
    const form = document.getElementById("settings") as HTMLFormElement;
    form.onsubmit = async (event) => { event.preventDefault(); try {
        const bindings = Array.from(el.querySelectorAll("select")).filter(s => s.value).map(s => { const { provider, connectionId, resource } = JSON.parse(s.value); return { provider, connectionId, resource }; });
        await api("settings", "PUT", { timezone: (document.getElementById("timezone") as HTMLInputElement).value, hour: Number((document.getElementById("hour") as HTMLInputElement).value), enabled: (document.getElementById("enabled") as HTMLInputElement).checked, bindings, arrMcpBinding: stack.value ? JSON.parse(stack.value) : null });
        notice("Settings saved.");
        await loadSetup();
    }
    catch (error) {
        notice(error instanceof Error ? error.message : "Could not save settings");
    } };
    if (demo)
        for (const input of form.querySelectorAll("input,button"))
            (input as HTMLInputElement).disabled = true;
}
onPageLoad(() => {
    const refresh = document.getElementById("refresh") as HTMLButtonElement | null;
    if (refresh) {
        refresh.disabled = demo;
        refresh.onclick = async () => { refresh.disabled = true; notice("Preparing your briefing…"); try {
            await api("refresh", "POST", {});
            await loadOverview();
            notice("Briefing updated.");
        }
        catch (error) {
            notice(error instanceof Error ? error.message : "Refresh failed");
        }
        finally {
            refresh.disabled = demo;
        } };
    }
    void (document.getElementById("settings") ? loadSetup() : loadOverview()).catch(error => notice(error instanceof Error ? error.message : "Could not load Dione"));
    if (demo)
        notice("Synthetic demo · read-only");
});
