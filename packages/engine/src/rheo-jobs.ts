import { and, type Database, eq, isNull, schema } from "@agenteschat/db";
import { personOfMessage, UUID } from "./authority";
import { createAgentRuns, eligibleChannelAgents } from "./dispatch";
import { getMembership } from "./organizations";
import { type JobHandlers, PermanentJobError } from "./outbox";
import { type RheoPolicy, readRheoPolicy } from "./rheo-policy";
import { cancelRheoRun } from "./rheo-spaces";
import { workRefusal } from "./standing";

const LOCAL_JOBS = new Set(["agent_run.execute", "notifications.message"]);

/** A protected message only wakes its regular coordinator; it never enters native routing or reflection. */
async function dispatchRheoMessage(db: Database, orgId: string, messageId: unknown) {
  if (typeof messageId !== "string" || !UUID.test(messageId)) return;
  await db.transaction(async (tx) => {
    const [policy] = await tx
      .select()
      .from(schema.rheoWorkspaces)
      .where(eq(schema.rheoWorkspaces.orgId, orgId))
      .for("share");
    if (policy?.state !== "active") return;
    const membership = await getMembership(tx, policy.ownerUserId, orgId);
    if (membership?.role !== "owner" || workRefusal(membership.standing)) return;
    const [message] = await tx
      .select({
        id: schema.messages.id,
        orgId: schema.messages.orgId,
        channelId: schema.messages.channelId,
        threadId: schema.messages.threadId,
        hop: schema.messages.hop,
        stretchId: schema.messages.stretchId,
        authorAgentId: schema.messages.authorAgentId,
        authorUserId: schema.messages.authorUserId,
        agentRunId: schema.messages.agentRunId,
        meta: schema.messages.meta,
        authorType: schema.messages.authorType,
      })
      .from(schema.messages)
      .innerJoin(
        schema.channels,
        and(
          eq(schema.channels.orgId, orgId),
          eq(schema.channels.id, schema.messages.channelId),
          isNull(schema.channels.archivedAt),
          isNull(schema.channels.deletedAt),
        ),
      )
      .where(
        and(eq(schema.messages.orgId, orgId), eq(schema.messages.id, messageId), isNull(schema.messages.deletedAt)),
      );
    if (
      message?.authorType !== "person" ||
      message.authorUserId !== policy.ownerUserId ||
      message.authorAgentId ||
      message.agentRunId ||
      message.hop !== 0 ||
      message.meta.background ||
      message.meta.routine ||
      message.meta.notice ||
      message.meta.taskConversation ||
      message.meta.issueWork ||
      message.meta.issueWorkStart ||
      message.meta.issueTaken ||
      message.meta.talker ||
      (await personOfMessage(tx, orgId, message.id)) !== policy.ownerUserId
    )
      return;
    // Mentions and DMs may already have created their run in the message's transaction.
    const [started] = await tx
      .select({ id: schema.agentRuns.id })
      .from(schema.agentRuns)
      .where(and(eq(schema.agentRuns.orgId, orgId), eq(schema.agentRuns.triggerMessageId, message.id)))
      .limit(1);
    if (started) return;
    const [coordinator] = await tx
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.orgId, orgId),
          eq(schema.agents.handle, "coordenador"),
          eq(schema.agents.brain, "model"),
          eq(schema.agents.ownerUserId, policy.ownerUserId),
          isNull(schema.agents.builtin),
          isNull(schema.agents.archivedAt),
        ),
      )
      .limit(1);
    if (!coordinator) return;
    const eligible = await eligibleChannelAgents(tx, orgId, message.channelId, [coordinator.id], {
      autoReplyOnly: true,
      requesterUserId: policy.ownerUserId,
    });
    if (eligible.length) await createAgentRuns(tx, message, [coordinator.id], "router", { joinChannelRun: true });
  });
}

/** Wrap after every native handler is composed, so newly added job kinds deny by default. */
export function wrapRheoJobHandlers(db: Database, handlers: JobHandlers, pubsub?: PubSub): JobHandlers {
  return Object.fromEntries(
    Object.entries(handlers).map(([kind, native]) => [
      kind,
      async (job, ctx) => {
        if (!job.orgId) return native(job, ctx);
        let policy: RheoPolicy | null;
        try {
          policy = await readRheoPolicy(db, job.orgId);
        } catch {
          ctx.failed?.(new PermanentJobError("Workspace job policy unavailable; no native handler ran"));
          return;
        }
        if (!policy) return native(job, ctx);
        if (policy.state !== "active") {
          if (kind === "agent_run.execute") {
            const runId = job.payload?.runId;
            if (typeof runId === "string" && UUID.test(runId)) await cancelRheoRun(db, job.orgId, runId, pubsub);
          }
          return;
        }
        if (kind === "message.posted") return dispatchRheoMessage(db, job.orgId, job.payload.messageId);
        if (LOCAL_JOBS.has(kind)) return native(job, ctx);
      },
    ]),
  );
}

import type { PubSub } from "@agenteschat/adapters";
