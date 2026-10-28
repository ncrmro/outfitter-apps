import { workflowHost, type WorkflowHostResult, type WorkflowHostScope, type WorkflowHostStub } from "@ai-outfitter/app-sdk/workflow-host";
import type { HealthRecords } from "./apple-health";

// A workflow host double for the fitness apps' own tests: it answers the
// operations a sync calls with contract-shaped results over a synthetic Apple
// Health import, pages it the way the connector does, and records every call.
// It is not the platform's engine. Like the platform's host, its snapshot lists
// the owner's personal Apple Health connection only on a user-owned
// installation, and only the owner's own connection serves reads.

export type { HealthRecords };
export type HostOptions = {
  /** The app's sync workflow and the output slot its step collects. */
  workflow: string;
  output: string;
  installationId: string;
  /** Whether the owner has an active Apple Health import (the default). */
  connected?: boolean;
  /** Who owns the installation: a user (the default) or an organization. */
  owner?: "user" | "organization";
  /** Connector reads fail (502) while set. */
  failReads?: boolean;
  /** A page size below the caller's limit exercises the cursor. */
  pageSize?: number;
};

const ok = (value: unknown): WorkflowHostResult => ({ ok: true, value });
const denied = (status: number, message: string): WorkflowHostResult => ({ ok: false, status, message });

/** One page in the window, newest first unless `order: "asc"`, as the connector returns it. */
function page<T extends { startedAt: string }>(items: T[], input: Record<string, unknown>, pageSize: number) {
  const from = typeof input.from === "string" ? Date.parse(input.from) : -Infinity;
  const to = typeof input.to === "string" ? Date.parse(input.to) : Infinity;
  const direction = input.order === "asc" ? 1 : -1;
  const matching = items.filter((item) => Date.parse(item.startedAt) >= from && Date.parse(item.startedAt) <= to)
    .sort((a, b) => direction * (Date.parse(a.startedAt) - Date.parse(b.startedAt)));
  const offset = Number(input.cursor ?? 0);
  const next = offset + Math.min(Number(input.limit ?? 100), pageSize);
  return { items: matching.slice(offset, next), cursor: next < matching.length ? String(next) : null };
}

/** An installation's interactive scope (a personal one without `organizationId`); a state-changing request carries the member's initiation. */
export const interactiveScope = (installationId: string, method = "GET", userId = "member-1", organizationId: string | null = null): WorkflowHostScope => ({
  organizationId, installationId, userId, packageHash: "hash", phase: "interactive", expiresAt: Date.now() + 60_000,
  ...(["GET", "HEAD"].includes(method) ? {} : { initiation: "member" as const }),
});

export function healthHostDouble(health: HealthRecords, options: HostOptions) {
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const runs = new Map<string, { inputs: Record<string, unknown>; collected: Record<string, unknown> }>();
  const connection = {
    id: "apple-health-1", provider: "apple-health", revision: "1", owner: "user" as const,
    operations: ["workouts.list", "samples.list"], repositories: [], resource: "member-1-health",
  };

  function execute(operation: string, input: Record<string, unknown>): WorkflowHostResult {
    if (options.failReads) return denied(502, "Connector request failed");
    const size = options.pageSize ?? 500;
    if (operation === "workouts.list") {
      const { items, cursor } = page(health.workouts.filter((item) => !input.activity || item.activity === input.activity), input, size);
      return ok({ workouts: items, cursor });
    }
    if (operation === "samples.list") {
      const { items, cursor } = page(health.samples.filter((item) => item.metric === input.metric), input, size);
      return ok({ samples: items, cursor });
    }
    return denied(403, "Connector access unavailable");
  }

  function workflow(operation: string, input: Record<string, unknown>): WorkflowHostResult {
    if (operation === "workflow.active")
      return ok([...runs].filter(([, run]) => !(options.output in run.collected)).map(([id, run]) => ({ id, workflowId: options.workflow, inputs: run.inputs })));
    if (operation === "workflow.start") {
      if (input.workflow !== options.workflow) return denied(403, "Workflow not approved");
      runs.set(String(input.id), { inputs: input.inputs as Record<string, unknown>, collected: {} });
      return ok({ id: input.id, workflow: input.workflow, created: true });
    }
    const run = runs.get(String(input.runId));
    if (!run || input.slot !== options.output || options.output in run.collected) return denied(409, "Not ready for output");
    run.collected[options.output] = input.value;
    return ok({ run: "complete", steps: { [options.output.split(".")[0]]: "done" } });
  }

  function answer(operation: string, input: Record<string, unknown>): WorkflowHostResult {
    calls.push({ operation, input });
    if (operation.startsWith("workflow.")) return workflow(operation, input);
    const connected = options.owner !== "organization" && options.connected !== false;
    if (operation === "snapshot")
      return ok({
        installation: { id: options.installationId, activeHash: "hash", hostname: null, workflows: [options.workflow] },
        bindings: [], subscriptions: [], connections: connected ? [connection] : [],
      });
    if (operation === "connector.execute" && connected && input.connectionId === connection.id && input.resource === connection.resource)
      return execute(String(input.operation), input.input as Record<string, unknown>);
    return denied(403, "Connector access unavailable");
  }

  /** The factory `appWorker` takes: one stub per dispatch scope. */
  const host = (_scope: WorkflowHostScope): WorkflowHostStub => ({
    async call(operation, input) {
      return answer(operation, input as Record<string, unknown>);
    },
  });
  return {
    calls,
    runs,
    /** Change `connected` or `failReads` between calls. */
    options,
    host,
    /** The typed host the app's server code takes, over the owner's interactive scope. */
    typed: (method = "POST") => workflowHost<"interactive">({
      props: { workflowHost: host(interactiveScope(options.installationId, method, "member-1", options.owner === "organization" ? "org-1" : null)) },
    }),
  };
}
