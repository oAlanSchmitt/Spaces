import { and, desc, type Executor, eq, schema } from "@agenteschat/db";
import { runAuthorityById, UUID } from "./authority";
import { ForbiddenError } from "./errors";
import { getMembership } from "./organizations";
import type { AgentRun } from "./runs";
import { RHEO_INTERNAL_TOOL, type ToolDefinition } from "./tools/types";

export type RheoPolicy = typeof schema.rheoWorkspaces.$inferSelect;
export const RHEO_ARCHIVE_ACTION = "rheo.project_archived";

export async function lastRheoArchive(db: Executor, orgId: string): Promise<{ id: string; createdAt: Date } | null> {
  const [archive] = await db
    .select({ id: schema.auditLog.id, createdAt: schema.auditLog.createdAt })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.orgId, orgId), eq(schema.auditLog.action, RHEO_ARCHIVE_ACTION)))
    .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
    .limit(1);
  return archive ?? null;
}

const TOOLS: Record<RheoPolicy["kind"], ReadonlySet<string>> = {
  control: new Set(["rheo_list", "rheo_create_project", "rheo_inspect"]),
  project: new Set(["rheo_context", "rheo_memory", "rheo_documents", "rheo_tasks", "rheo_inspect"]),
};

/** No cache: archiving and missing policy must take effect on the next action. */
export async function readRheoPolicy(db: Executor, orgId: string): Promise<RheoPolicy | null> {
  const [row] = await db
    .select({ protected: schema.organizations.rheoProtected, workspace: schema.rheoWorkspaces })
    .from(schema.organizations)
    .leftJoin(schema.rheoWorkspaces, eq(schema.rheoWorkspaces.orgId, schema.organizations.id))
    .where(eq(schema.organizations.id, orgId));
  if (row && !row.protected && !row.workspace) return null;
  if (!row?.protected || !row.workspace || !(row.workspace.kind in TOOLS)) {
    throw new ForbiddenError("The protected workspace policy is unavailable", "rheo.policy_missing");
  }
  return row.workspace;
}

export function allowRheoTool(policy: RheoPolicy, tool: ToolDefinition): boolean {
  return (
    policy.state === "active" &&
    tool.rheoInternal === RHEO_INTERNAL_TOOL &&
    !tool.connectionId &&
    !tool.connector &&
    TOOLS[policy.kind].has(tool.name)
  );
}

type RunRef = Pick<AgentRun, "id" | "orgId" | "agentId" | "channelId" | "threadRootId" | "triggerMessageId">;

/** Validate persisted identity even when a native route changed the agent or resumed an old run. */
export async function assertRheoRun(
  db: Executor,
  ref: RunRef,
  options: { brain?: string; bridge?: unknown } = {},
): Promise<RheoPolicy | null> {
  const policy = await readRheoPolicy(db, ref.orgId);
  if (!policy) return null;
  if (policy.state !== "active") throw new ForbiddenError("This project is archived", "rheo.archived");
  const refused = () =>
    new ForbiddenError(
      "Protected workspaces require an active, owner-requested model run without a computer or background work",
      "rheo.protected_run_required",
    );
  if (!UUID.test(ref.id) || options.bridge || (options.brain !== undefined && options.brain !== "model"))
    throw refused();
  const [current] = await db
    .select({ run: schema.agentRuns, brain: schema.agents.brain, archived: schema.agents.archivedAt })
    .from(schema.agentRuns)
    .innerJoin(schema.agents, and(eq(schema.agents.id, schema.agentRuns.agentId), eq(schema.agents.orgId, ref.orgId)))
    .innerJoin(
      schema.channels,
      and(eq(schema.channels.id, schema.agentRuns.channelId), eq(schema.channels.orgId, ref.orgId)),
    )
    .where(and(eq(schema.agentRuns.orgId, ref.orgId), eq(schema.agentRuns.id, ref.id)));
  if (
    !current ||
    current.archived ||
    current.brain !== "model" ||
    current.run.agentId !== ref.agentId ||
    current.run.channelId !== ref.channelId ||
    current.run.threadRootId !== ref.threadRootId ||
    current.run.triggerMessageId !== ref.triggerMessageId ||
    current.run.background ||
    current.run.workId ||
    (current.run.brain && current.run.brain !== "model") ||
    ["canceled", "failed", "done"].includes(current.run.status)
  )
    throw refused();
  const [authority, membership, missions] = await Promise.all([
    runAuthorityById(db, ref.orgId, ref.id),
    getMembership(db, policy.ownerUserId, ref.orgId),
    db
      .select({ id: schema.missions.id })
      .from(schema.missions)
      .where(and(eq(schema.missions.orgId, ref.orgId), eq(schema.missions.threadRootId, ref.threadRootId)))
      .limit(1),
  ]);
  if (
    authority.kind !== "person" ||
    authority.personId !== policy.ownerUserId ||
    membership?.role !== "owner" ||
    missions.length
  ) {
    throw refused();
  }
  return policy;
}
