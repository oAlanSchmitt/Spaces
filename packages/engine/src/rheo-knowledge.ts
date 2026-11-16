import {
  and,
  asc,
  type Database,
  desc,
  type Executor,
  eq,
  inArray,
  isNull,
  lt,
  or,
  schema,
  sql,
} from "@agenteschat/db";
import { UUID } from "./authority";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { requireActiveMembership } from "./organizations";
import { assertRheoRun, readRheoPolicy } from "./rheo-policy";

export type RheoEntry = typeof schema.rheoEntries.$inferSelect;
export type RheoEntryInput = Pick<RheoEntry, "kind" | "title" | "body"> & { visibility?: RheoEntry["visibility"] };

async function lockRheoWorkspaces(db: Executor, orgIds: string[]) {
  const workspaces = await db
    .select({ orgId: schema.rheoWorkspaces.orgId })
    .from(schema.rheoWorkspaces)
    .where(inArray(schema.rheoWorkspaces.orgId, [...new Set(orgIds)]))
    .orderBy(asc(schema.rheoWorkspaces.orgId))
    .for("update");
  if (workspaces.length !== new Set(orgIds).size) throw new ForbiddenError();
}

export async function requireRheoSpaceOwner(db: Executor, userId: string, spaceId: string) {
  if (!UUID.test(spaceId)) throw new ValidationError("Identificador de espaço inválido.");
  const [space] = await db.select().from(schema.rheoSpaces).where(eq(schema.rheoSpaces.id, spaceId));
  if (!space) throw new ForbiddenError();
  const policy = await requireRheoOwner(db, userId, space.orgId);
  if (policy.kind !== "control" || policy.state !== "active" || policy.controlOrgId !== space.orgId)
    throw new ForbiddenError();
  return { space, policy };
}

/** Only the explicit project mapping grants access to its owner's common space knowledge. */
async function runEntryScope(db: Executor, orgId: string, allowArchived = false) {
  const local = and(eq(schema.rheoEntries.orgId, orgId), isNull(schema.rheoEntries.spaceId));
  const policy = await readRheoPolicy(db, orgId);
  if (!policy || (!allowArchived && policy.state !== "active")) throw new ForbiddenError();
  if (policy.kind !== "project") return undefined;
  const [project] = await db.select().from(schema.rheoProjects).where(eq(schema.rheoProjects.nativeOrgId, orgId));
  // Older standalone protected workspaces have no catalog mapping and remain project-only.
  if (!project) return local;
  if ((!allowArchived && project.state !== "active") || project.orgId !== policy.controlOrgId)
    throw new ForbiddenError();
  const { policy: control } = await requireRheoSpaceOwner(db, policy.ownerUserId, project.spaceId);
  await requireRheoOwner(db, policy.ownerUserId, orgId);
  if (control.orgId !== project.orgId) throw new ForbiddenError();
  return or(local, and(eq(schema.rheoEntries.orgId, project.orgId), eq(schema.rheoEntries.spaceId, project.spaceId)));
}

export async function requireRheoOwner(db: Executor, userId: string, orgId: string) {
  const policy = await readRheoPolicy(db, orgId);
  if (!policy || policy.ownerUserId !== userId) throw new ForbiddenError();
  const membership = await requireActiveMembership(db, userId, orgId);
  if (membership.role !== "owner") throw new ForbiddenError();
  return policy;
}

export async function listRheoRunEntries(db: Executor, orgId: string, kind?: RheoEntry["kind"], id?: string) {
  const scope = await runEntryScope(db, orgId);
  if (!scope) return [];
  if (id && !UUID.test(id)) throw new ValidationError("Identificador de documento inválido.");
  const entries = await db
    .select()
    .from(schema.rheoEntries)
    .where(
      and(
        scope,
        eq(schema.rheoEntries.state, "approved"),
        eq(schema.rheoEntries.visibility, "project"),
        ...(kind ? [eq(schema.rheoEntries.kind, kind)] : []),
        ...(id ? [eq(schema.rheoEntries.id, id)] : []),
      ),
    )
    .orderBy(desc(schema.rheoEntries.createdAt), desc(schema.rheoEntries.id))
    .limit(id ? 1 : 100);
  const sources = await rheoSourceGraph(db, orgId);
  return entries.filter((entry) => sources.entry(entry.id, undefined, entry.revision) !== null);
}

/** Metadata only: provenance remains transitive even for receipts written before dependencies were flattened. */
// shortcut: validates the project's metadata graph in memory; move to incremental queries if long histories slow validation.
async function rheoSourceGraph(db: Executor, orgId: string, messageIds: string[] = []) {
  const scope = await runEntryScope(db, orgId);
  const [entries, receipts] = await Promise.all([
    db
      .select({
        id: schema.rheoEntries.id,
        spaceId: schema.rheoEntries.spaceId,
        revision: schema.rheoEntries.revision,
        state: schema.rheoEntries.state,
        visibility: schema.rheoEntries.visibility,
        sourceRunId: schema.rheoEntries.sourceRunId,
        createdByAgentId: schema.rheoEntries.createdByAgentId,
      })
      .from(schema.rheoEntries)
      .where(scope ?? sql`false`),
    db
      .select({ receipt: schema.rheoContextReceipts })
      .from(schema.rheoContextReceipts)
      .innerJoin(
        schema.agentRuns,
        and(eq(schema.agentRuns.id, schema.rheoContextReceipts.runId), eq(schema.agentRuns.orgId, orgId)),
      )
      .where(eq(schema.rheoContextReceipts.orgId, orgId)),
  ]);
  const ids = [...new Set([...messageIds, ...receipts.flatMap(({ receipt }) => receipt.messageIds)])];
  const messages = ids.length
    ? await db
        .select({
          id: schema.messages.id,
          channelId: schema.messages.channelId,
          authorType: schema.messages.authorType,
          authorUserId: schema.messages.authorUserId,
          authorAgentId: schema.messages.authorAgentId,
          agentRunId: schema.messages.agentRunId,
          deletedAt: schema.messages.deletedAt,
        })
        .from(schema.messages)
        .where(and(eq(schema.messages.orgId, orgId), inArray(schema.messages.id, ids)))
    : [];
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const receiptsByRun = new Map(receipts.map(({ receipt }) => [receipt.runId, receipt]));
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const checked = new Map<string, Set<string> | null>();
  const checking = new Set<string>();
  const merge = (target: Set<string>, from: Set<string> | null) => {
    if (from === null) return false;
    for (const id of from) target.add(id);
    return true;
  };
  function entry(id: string, withinRun?: string, revision?: number): Set<string> | null {
    const item = entriesById.get(id);
    if (
      item?.state !== "approved" ||
      item.visibility !== "project" ||
      (revision !== undefined && item.revision !== revision) ||
      (item.createdByAgentId && !item.sourceRunId) ||
      (item.spaceId && (item.sourceRunId || item.createdByAgentId))
    )
      return null;
    // A run's own new task inherits its other sources, already checked by that run, without a self-edge.
    const inherited = item.sourceRunId && item.sourceRunId !== withinRun ? run(item.sourceRunId) : new Set<string>();
    return inherited === null ? null : new Set([...inherited, id]);
  }
  function message(id: string, channelId: string): Set<string> | null {
    const item = messagesById.get(id);
    if (!item || item.deletedAt || item.channelId !== channelId) return null;
    if (item.authorType === "person" && item.authorUserId) return new Set();
    const receipt = item.agentRunId ? receiptsByRun.get(item.agentRunId) : null;
    if (!receipt || receipt.channelId !== channelId || receipt.agentId !== item.authorAgentId) return null;
    return run(receipt.runId);
  }
  function run(id: string): Set<string> | null {
    if (checked.has(id)) return checked.get(id) ?? null;
    const receipt = receiptsByRun.get(id);
    if (!receipt || checking.has(id)) return null;
    checking.add(id);
    const sources = new Set<string>();
    const valid =
      receipt.entryIds.every((id) => {
        const item = entriesById.get(id);
        const revision = receipt.entryRevisions[id];
        // Legacy receipts only predate revision 1 of local sources; shared sources always need a snapshot.
        if (revision === undefined && (!item || item.spaceId || item.revision !== 1)) return false;
        return merge(sources, entry(id, receipt.runId, revision));
      }) && receipt.messageIds.every((id) => merge(sources, message(id, receipt.channelId)));
    checking.delete(id);
    checked.set(id, valid ? sources : null);
    return valid ? sources : null;
  }
  return {
    entry,
    message,
    run,
    revision: (id: string) => entriesById.get(id)?.revision,
    shared: (id: string) => Boolean(entriesById.get(id)?.spaceId),
  };
}

/** Unclassified agent output and revoked derivatives stay visible to people, outside future model contexts. */
export async function validRheoHistory<T extends { id: string; channelId: string }>(
  db: Executor,
  orgId: string,
  channelId: string,
  messages: T[],
): Promise<T[]> {
  const sources = await rheoSourceGraph(
    db,
    orgId,
    messages.map((message) => message.id),
  );
  return messages.filter(
    (message) => message.channelId === channelId && sources.message(message.id, channelId) !== null,
  );
}

export async function listRheoEntries(
  db: Executor,
  userId: string,
  orgId: string,
  options: { beforeId?: string; limit?: number } = {},
) {
  await requireRheoOwner(db, userId, orgId);
  const policy = await readRheoPolicy(db, orgId);
  const scope = policy?.kind === "project" ? await runEntryScope(db, orgId, true) : undefined;
  return listEntries(
    db,
    orgId,
    null,
    options,
    scope
      ? or(
          and(eq(schema.rheoEntries.orgId, orgId), isNull(schema.rheoEntries.spaceId)),
          and(scope, eq(schema.rheoEntries.state, "approved"), eq(schema.rheoEntries.visibility, "project")),
        )
      : undefined,
  );
}

export async function listRheoSpaceEntries(
  db: Executor,
  userId: string,
  spaceId: string,
  options: { beforeId?: string; limit?: number } = {},
) {
  const { space } = await requireRheoSpaceOwner(db, userId, spaceId);
  return listEntries(db, space.orgId, spaceId, options);
}

async function listEntries(
  db: Executor,
  orgId: string,
  spaceId: string | null,
  options: { beforeId?: string; limit?: number },
  inheritedScope?: ReturnType<typeof or>,
) {
  const scope =
    inheritedScope ??
    and(
      eq(schema.rheoEntries.orgId, orgId),
      spaceId ? eq(schema.rheoEntries.spaceId, spaceId) : isNull(schema.rheoEntries.spaceId),
    );
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 201 || (options.beforeId && !UUID.test(options.beforeId)))
    throw new ValidationError("Página de conhecimento inválida.");
  const [cursor] = options.beforeId
    ? await db
        .select({ createdAt: schema.rheoEntries.createdAt, id: schema.rheoEntries.id })
        .from(schema.rheoEntries)
        .where(and(scope, eq(schema.rheoEntries.id, options.beforeId)))
    : [];
  if (options.beforeId && !cursor) throw new NotFoundError();
  return db
    .select()
    .from(schema.rheoEntries)
    .where(
      and(
        scope,
        ...(cursor
          ? [
              or(
                lt(schema.rheoEntries.createdAt, cursor.createdAt),
                and(eq(schema.rheoEntries.createdAt, cursor.createdAt), lt(schema.rheoEntries.id, cursor.id)),
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(schema.rheoEntries.createdAt), desc(schema.rheoEntries.id))
    .limit(limit);
}

function checkedEntry(input: RheoEntryInput) {
  const title = input.title.trim();
  if (
    !title ||
    title.length > 160 ||
    input.body.length > 40_000 ||
    !["memory", "document", "task"].includes(input.kind) ||
    (input.visibility !== undefined && !["project", "owner"].includes(input.visibility))
  ) {
    throw new ValidationError("Verifique o título e o conteúdo deste registo.");
  }
  return { kind: input.kind, title, body: input.body, visibility: input.visibility ?? ("project" as const) };
}

export async function createRheoEntry(db: Database, userId: string, orgId: string, input: RheoEntryInput) {
  const values = checkedEntry(input);
  return db.transaction(async (tx) => {
    await lockRheoWorkspaces(tx, [orgId]);
    const policy = await requireRheoOwner(tx, userId, orgId);
    if (policy.kind !== "project" || policy.state !== "active")
      throw new ForbiddenError("Este projeto não aceita alterações.");
    const [entry] = await tx
      .insert(schema.rheoEntries)
      .values({
        ...values,
        orgId,
        state: "approved",
        createdByUserId: userId,
      })
      .returning();
    if (!entry) throw new Error("Entry insert returned nothing");
    return entry;
  });
}

export async function createRheoSpaceEntry(db: Database, userId: string, spaceId: string, input: RheoEntryInput) {
  const values = checkedEntry(input);
  return db.transaction(async (tx) => {
    const initial = await requireRheoSpaceOwner(tx, userId, spaceId);
    await lockRheoWorkspaces(tx, [initial.space.orgId]);
    const { space } = await requireRheoSpaceOwner(tx, userId, spaceId);
    const [entry] = await tx
      .insert(schema.rheoEntries)
      .values({
        ...values,
        orgId: space.orgId,
        spaceId,
        state: "approved",
        createdByUserId: userId,
      })
      .returning();
    if (!entry) throw new Error("Entry insert returned nothing");
    return entry;
  });
}

export async function reviewRheoEntry(
  db: Database,
  userId: string,
  orgId: string,
  id: string,
  state: RheoEntry["state"],
) {
  if (!["approved", "archived"].includes(state)) throw new ValidationError("Escolha aprovar ou arquivar.");
  return db.transaction(async (tx) => {
    await lockRheoWorkspaces(tx, [orgId]);
    const policy = await requireRheoOwner(tx, userId, orgId);
    if (policy.state !== "active") throw new ForbiddenError("Este projeto está arquivado.");
    const [entry] = await tx
      .update(schema.rheoEntries)
      .set({ state, revision: sql`${schema.rheoEntries.revision} + 1`, updatedAt: new Date() })
      .where(
        and(eq(schema.rheoEntries.orgId, orgId), isNull(schema.rheoEntries.spaceId), eq(schema.rheoEntries.id, id)),
      )
      .returning();
    if (!entry) throw new NotFoundError();
    return entry;
  });
}

export async function reviewRheoSpaceEntry(
  db: Database,
  userId: string,
  spaceId: string,
  id: string,
  state: "approved" | "archived",
) {
  return updateRheoSpaceEntry(db, userId, spaceId, id, { state });
}

export type RheoSpaceEntryUpdate = Partial<Pick<RheoEntry, "title" | "body" | "visibility">> & {
  state?: "approved" | "archived";
  revision?: number;
};

export async function updateRheoSpaceEntry(
  db: Database,
  userId: string,
  spaceId: string,
  id: string,
  input: RheoSpaceEntryUpdate,
) {
  if (
    !Object.keys(input).some((key) => key !== "revision") ||
    Object.keys(input).some((key) => !["title", "body", "visibility", "state", "revision"].includes(key)) ||
    (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 1)) ||
    (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 160)) ||
    (input.body !== undefined && input.body.length > 40_000) ||
    (input.visibility !== undefined && !["project", "owner"].includes(input.visibility)) ||
    (input.state !== undefined && !["approved", "archived"].includes(input.state))
  )
    throw new ValidationError("Verifique o título, o conteúdo e o estado deste registo.");
  return db.transaction(async (tx) => {
    const initial = await requireRheoSpaceOwner(tx, userId, spaceId);
    await lockRheoWorkspaces(tx, [initial.space.orgId]);
    const { space } = await requireRheoSpaceOwner(tx, userId, spaceId);
    const scope = and(
      eq(schema.rheoEntries.orgId, space.orgId),
      eq(schema.rheoEntries.spaceId, spaceId),
      eq(schema.rheoEntries.id, id),
    );
    const [current] = await tx.select({ revision: schema.rheoEntries.revision }).from(schema.rheoEntries).where(scope);
    if (!current) throw new NotFoundError();
    if (input.revision !== undefined && input.revision !== current.revision)
      throw new ConflictError(
        "Este registo foi alterado. Atualize o conhecimento antes de guardar.",
        "version_conflict",
      );
    const { revision: _revision, ...values } = input;
    const [entry] = await tx
      .update(schema.rheoEntries)
      .set({
        ...values,
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        revision: sql`${schema.rheoEntries.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(scope)
      .returning();
    if (!entry) throw new NotFoundError();
    return entry;
  });
}

/** Publication and owner review share the row lock also taken by project archival. */
export async function withRheoPublication<T>(
  db: Executor,
  orgId: string,
  runId: string,
  work: (tx: Executor) => Promise<T>,
): Promise<T> {
  const policy = await readRheoPolicy(db, orgId);
  if (!policy) return work(db);
  return db.transaction(async (tx) => {
    await lockRheoWorkspaces(tx, [orgId, policy.controlOrgId]);
    await assertRheoSourcesCurrent(tx, orgId, runId);
    return work(tx);
  });
}

export async function recordRheoSources(
  db: Executor,
  input: {
    orgId: string;
    runId: string;
    channelId: string;
    agentId: string;
    entryIds: string[];
    entryRevisions?: Record<string, number>;
    messageIds?: string[];
  },
) {
  return db.transaction(async (tx) => {
    // Serialize additions so concurrent tool calls cannot overwrite each other's dependencies.
    const [run] = await tx
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.orgId, input.orgId),
          eq(schema.agentRuns.id, input.runId),
          eq(schema.agentRuns.channelId, input.channelId),
          eq(schema.agentRuns.agentId, input.agentId),
        ),
      )
      .for("update");
    if (!run || !(await assertRheoRun(tx, run, { brain: "model" }))) throw new ForbiddenError();
    const [old] = await tx
      .select()
      .from(schema.rheoContextReceipts)
      .where(and(eq(schema.rheoContextReceipts.orgId, input.orgId), eq(schema.rheoContextReceipts.runId, input.runId)));
    const entryIds = new Set([...(old?.entryIds ?? []), ...input.entryIds]);
    const messageIds = [...new Set([...(old?.messageIds ?? []), ...(input.messageIds ?? [])])];
    const sources = await rheoSourceGraph(tx, input.orgId, messageIds);
    if (input.entryIds.some((id) => sources.shared(id) && input.entryRevisions?.[id] === undefined))
      throw new ForbiddenError("A revisão desta fonte comum não foi indicada.", "rheo.context_revoked");
    if (old && sources.run(input.runId) === null)
      throw new ForbiddenError("Este contexto foi revogado.", "rheo.context_revoked");
    for (const id of [...entryIds]) {
      const inherited = sources.entry(id, undefined, input.entryRevisions?.[id]);
      if (!inherited) throw new ForbiddenError("Esta fonte não está autorizada.", "rheo.context_revoked");
      for (const source of inherited) entryIds.add(source);
    }
    for (const id of messageIds) {
      const inherited = sources.message(id, input.channelId);
      if (!inherited) throw new ForbiddenError("Esta mensagem não tem contexto autorizado.", "rheo.context_revoked");
      for (const source of inherited) entryIds.add(source);
    }
    const entryRevisions = Object.fromEntries([...entryIds].map((id) => [id, sources.revision(id) as number]));
    await tx
      .insert(schema.rheoContextReceipts)
      .values({ ...input, entryIds: [...entryIds], entryRevisions, messageIds })
      .onConflictDoUpdate({
        target: schema.rheoContextReceipts.runId,
        set: { entryIds: [...entryIds], entryRevisions, messageIds },
      });
  });
}

/** An approved source archived during a run prevents publication of its held response. */
export async function assertRheoSourcesCurrent(db: Executor, orgId: string, runId: string) {
  const policy = await readRheoPolicy(db, orgId);
  if (!policy) return;
  if (policy.state !== "active") throw new ForbiddenError("Este projeto está arquivado.");
  const [receipt] = await db
    .select()
    .from(schema.rheoContextReceipts)
    .where(and(eq(schema.rheoContextReceipts.orgId, orgId), eq(schema.rheoContextReceipts.runId, runId)));
  if (!receipt) return;
  const sources = await rheoSourceGraph(db, orgId);
  if (sources.run(runId) === null)
    throw new ForbiddenError(
      "Uma fonte deste contexto foi revogada. Inicie uma nova conversa com as fontes atuais.",
      "rheo.context_revoked",
    );
}
