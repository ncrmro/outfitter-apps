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
function showReport(value: Report) {
    const section = document.getElementById("briefing");
    if (section) {
        section.replaceChildren(node("h2", `${value.report.day} · ${value.report.status}`), node("p", value.report.summary), node("small", `Generated ${new Date(value.report.generatedAt).toLocaleString()}`));
        if (value.report.inferenceError)
            section.append(node("p", value.report.inferenceError));
    }
    const list = document.getElementById("items");
    if (list)
        list.replaceChildren(...value.items.map(item => { const li = node("li"); li.append(node("h3", item.title), node("small", `${item.source} · ${item.kind}${item.date ? ` · ${item.date}` : ""}`), node("p", item.reason || item.detail)); if (item.url) {
            const a = document.createElement("a");
            a.textContent = "View source";
            a.href = item.url;
            a.rel = "noreferrer noopener";
            a.target = "_blank";
            li.append(a);
        } return li; }));
    const sources = document.getElementById("sources");
    if (sources)
        sources.replaceChildren(...value.sources.map(s => node("li", `${s.source}: ${s.status} · ${s.count} observations · ${new Date(s.observedAt).toLocaleString()}${s.error ? ` · ${s.error}` : ""}${s.truncated ? " · Results limited" : ""}`)));
}
async function loadOverview() {
    const value = await api<Overview>("overview");
    if (value.latest)
        showReport({ report: value.latest, items: value.items, sources: value.sources });
    else {
        const section = document.getElementById("briefing");
        if (section)
            section.textContent = "No report yet. Connect your media services in Settings, then refresh your briefing.";
    }
    const history = document.getElementById("history");
    if (history)
        history.replaceChildren(...value.reports.map(report => { const li = node("li"); const button = document.createElement("button"); button.textContent = `${report.day} · ${report.status}`; button.onclick = () => void api<Report>(`report?id=${encodeURIComponent(report.id)}`).then(showReport).catch(error => notice(error.message)); li.append(button, node("p", report.summary)); return li; }));
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
