import type { PubSub } from "@agenteschat/adapters";
import { and, asc, type Database, type Executor, eq, inArray, lte, or, schema, sql } from "@agenteschat/db";
import { AUTO_MODEL } from "@agenteschat/providers";
import { createAgent } from "./agents";
import { stopRun } from "./cancel";
import { addChannelMember } from "./channels";
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from "./errors";
import { createOrganization, lockWorkspacesOf, requireActiveMembership } from "./organizations";
import { lastRheoArchive, RHEO_ARCHIVE_ACTION } from "./rheo-policy";
import { ACTIVE_RUN_STATUSES } from "./run-inbox";

const { rheoWorkspaces, rheoBusinesses, rheoSpaces, rheoProjects, rheoTemplates, organizations, users, channels } =
  schema;
const COORDINATOR_METHOD =
  "Organiza objetivos, tarefas e decisões apenas neste projeto. Distingue factos, hipóteses e propostas. Consulta as fontes permitidas, explica limites e pede a decisão humana necessária. Não transfere conteúdo entre projetos nem concede permissões.";
const SAFE_SCOPES = ["context:read", "memory:write", "drive:read", "drive:write", "issues:read", "issues:write"];

export interface RheoProjectLink {
  id: string;
  name: string;
  orgId: string;
  channelId: string;
  state: "active" | "archived";
}

export interface RheoOverview {
  controlOrgId: string | null;
  controlChannelId: string | null;
  businesses: { id: string; name: string; spaces: { id: string; name: string; projects: RheoProjectLink[] }[] }[];
  templates: { id: string; name: string; version: string }[];
}

export interface CreateRheoProjectInput {
  spaceId: string;
  name: string;
  templateId?: string;
  requestKey: string;
}

const projectLink = (p: typeof rheoProjects.$inferSelect): RheoProjectLink => ({
  id: p.id,
  name: p.name,
  orgId: p.nativeOrgId,
  channelId: p.channelId,
  state: p.state,
});

function nameOf(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new ValidationError("O nome deve ter entre 1 e 80 caracteres.");
  return name;
}

async function lockActor(tx: Executor, userId: string) {
  await lockWorkspacesOf(tx, userId);
  const [person] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
  if (!person) throw new UnauthorizedError();
  if (person.blockedAt || person.deletionDueAt) throw new ForbiddenError();
}

async function controlFor(db: Executor, userId: string) {
  const [control] = await db
    .select()
    .from(rheoWorkspaces)
    .where(
      and(
        eq(rheoWorkspaces.ownerUserId, userId),
        eq(rheoWorkspaces.kind, "control"),
        eq(rheoWorkspaces.state, "active"),
      ),
    );
  if (!control) return null;
  const membership = await requireActiveMembership(db, userId, control.orgId);
  if (membership.role !== "owner") throw new ForbiddenError();
  return control;
}

async function requireControl(db: Executor, userId: string) {
  const control = await controlFor(db, userId);
  if (!control) throw new ForbiddenError("Crie primeiro o seu painel Spaces.");
  return control;
}

async function coordinator(db: Database, userId: string, orgId: string, channelId: string, instructions: string) {
  const agent = await createAgent(
    db,
    userId,
    orgId,
    {
      name: "Coordenador",
      handle: "coordenador",
      role: "Coordenador do projeto",
      instructions,
      model: AUTO_MODEL,
      ownerUserId: userId,
      approvalsLevel: "risky",
      audienceMode: "owner",
    },
    { model: AUTO_MODEL },
    { remember: false },
  );
  // Native agents start with computer grants; protected workspaces only receive these mediated capabilities.
  await db
    .delete(schema.agentScopes)
    .where(and(eq(schema.agentScopes.orgId, orgId), eq(schema.agentScopes.agentId, agent.id)));
  await db.insert(schema.agentScopes).values(SAFE_SCOPES.map((scope) => ({ orgId, agentId: agent.id, scope })));
  await db
    .update(schema.agents)
    .set({ brain: "model", brainFallback: false, machineId: null, mediaReplies: false })
    .where(eq(schema.agents.id, agent.id));
  await addChannelMember(db, userId, orgId, channelId, { agentId: agent.id });
}

export async function listRheoSpaces(db: Database, userId: string): Promise<RheoOverview> {
  const control = await controlFor(db, userId);
  if (!control) return { controlOrgId: null, controlChannelId: null, businesses: [], templates: [] };
  const scope = control.orgId;
  const [businesses, spaces, projects, templates, general] = await Promise.all([
    db
      .select()
      .from(rheoBusinesses)
      .where(eq(rheoBusinesses.orgId, scope))
      .orderBy(asc(rheoBusinesses.createdAt), asc(rheoBusinesses.id)),
    db
      .select()
      .from(rheoSpaces)
      .where(eq(rheoSpaces.orgId, scope))
      .orderBy(asc(rheoSpaces.createdAt), asc(rheoSpaces.id)),
    db
      .select()
      .from(rheoProjects)
      .where(eq(rheoProjects.orgId, scope))
      .orderBy(asc(rheoProjects.createdAt), asc(rheoProjects.id)),
    db
      .select({ id: rheoTemplates.id, name: rheoTemplates.name, version: rheoTemplates.version })
      .from(rheoTemplates)
      .where(eq(rheoTemplates.orgId, scope)),
    db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.orgId, scope), eq(channels.name, "general"))),
  ]);
  return {
    controlOrgId: scope,
    controlChannelId: general[0]?.id ?? null,
    templates,
    businesses: businesses.map((b) => ({
      id: b.id,
      name: b.name,
      spaces: spaces
        .filter((s) => s.businessId === b.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          projects: projects.filter((p) => p.spaceId === s.id).map(projectLink),
        })),
    })),
  };
}

export async function bootstrapRheoSpaces(db: Database, userId: string): Promise<RheoOverview> {
  await db.transaction(async (tx) => {
    await lockActor(tx, userId);
    if (await controlFor(tx, userId)) return;
    const { organization, general } = await createOrganization(tx, userId, { name: "Spaces", context: "" });
    await tx.update(organizations).set({ rheoProtected: true }).where(eq(organizations.id, organization.id));
    await tx
      .insert(rheoWorkspaces)
      .values({ orgId: organization.id, controlOrgId: organization.id, ownerUserId: userId, kind: "control" });
    const [template] = await tx
      .insert(rheoTemplates)
      .values({ orgId: organization.id, name: "Coordenador", version: "1.0.0", instructions: COORDINATOR_METHOD })
      .returning();
    if (!template) throw new Error("template insert returned nothing");
    await coordinator(tx, userId, organization.id, general.id, COORDINATOR_METHOD);
    const [rheo] = await tx.insert(rheoBusinesses).values({ orgId: organization.id, name: "Profissional" }).returning();
    const [personal] = await tx.insert(rheoBusinesses).values({ orgId: organization.id, name: "Pessoal" }).returning();
    if (!rheo || !personal) throw new Error("business insert returned nothing");
    await tx.insert(rheoSpaces).values({ orgId: organization.id, businessId: rheo.id, name: "Operação interna" });
    const [ideas] = await tx
      .insert(rheoSpaces)
      .values({ orgId: organization.id, businessId: personal.id, name: "Ideias" })
      .returning();
    if (!ideas) throw new Error("space insert returned nothing");
    await createRheoProject(tx, userId, {
      spaceId: ideas.id,
      name: "Caixa de ideias",
      templateId: template.id,
      requestKey: "bootstrap-ideas",
    });
  });
  return listRheoSpaces(db, userId);
}

export async function createRheoBusiness(db: Database, userId: string, input: { name: string }) {
  const name = nameOf(input.name);
  return db.transaction(async (tx) => {
    await lockActor(tx, userId);
    const control = await requireControl(tx, userId);
    const [existing] = await tx
      .select()
      .from(rheoBusinesses)
      .where(and(eq(rheoBusinesses.orgId, control.orgId), sql`lower(${rheoBusinesses.name}) = lower(${name})`));
    if (existing) throw new ValidationError("Já existe um negócio com este nome.");
    const [business] = await tx.insert(rheoBusinesses).values({ orgId: control.orgId, name }).returning();
    if (!business) throw new Error("business insert returned nothing");
    return { id: business.id, name: business.name };
  });
}

export async function createRheoSpace(db: Database, userId: string, input: { businessId: string; name: string }) {
  const name = nameOf(input.name);
  return db.transaction(async (tx) => {
    await lockActor(tx, userId);
    const control = await requireControl(tx, userId);
    const [business] = await tx
      .select()
      .from(rheoBusinesses)
      .where(and(eq(rheoBusinesses.id, input.businessId), eq(rheoBusinesses.orgId, control.orgId)));
    if (!business) throw new ForbiddenError();
    const [existing] = await tx
      .select({ id: rheoSpaces.id })
      .from(rheoSpaces)
      .where(
        and(
          eq(rheoSpaces.orgId, control.orgId),
          eq(rheoSpaces.businessId, business.id),
          sql`lower(${rheoSpaces.name}) = lower(${name})`,
        ),
      );
    if (existing) throw new ValidationError("Já existe um espaço com este nome neste negócio.");
    const [space] = await tx
      .insert(rheoSpaces)
      .values({ orgId: control.orgId, businessId: business.id, name })
      .returning();
    if (!space) throw new Error("space insert returned nothing");
    return { id: space.id, name: space.name };
  });
}

export async function createRheoProject(
  db: Database,
  userId: string,
  input: CreateRheoProjectInput,
): Promise<RheoProjectLink> {
  const name = nameOf(input.name);
  const requestKey = input.requestKey.trim();
  if (!requestKey || requestKey.length > 120)
    throw new ValidationError("A chave do pedido deve ter entre 1 e 120 caracteres.");
  return db.transaction(async (tx) => {
    await lockActor(tx, userId);
    const control = await requireControl(tx, userId);
    const [space] = await tx
      .select()
      .from(rheoSpaces)
      .where(and(eq(rheoSpaces.id, input.spaceId), eq(rheoSpaces.orgId, control.orgId)));
    if (!space) throw new ForbiddenError();
    const [template] = await tx
      .select()
      .from(rheoTemplates)
      .where(
        and(
          eq(rheoTemplates.orgId, control.orgId),
          ...(input.templateId ? [eq(rheoTemplates.id, input.templateId)] : []),
        ),
      )
      .orderBy(asc(rheoTemplates.id))
      .limit(1);
    if (!template) throw new ValidationError("O especialista modelo não pertence a este painel.");
    const [existing] = await tx
      .select()
      .from(rheoProjects)
      .where(and(eq(rheoProjects.orgId, control.orgId), eq(rheoProjects.requestKey, requestKey)));
    if (existing) {
      if (existing.spaceId !== space.id || existing.name !== name || existing.templateId !== template.id)
        throw new ValidationError("Esta chave já identifica outro pedido de criação.");
      return projectLink(existing);
    }
    const { organization, general } = await createOrganization(tx, userId, { name, context: "" });
    await tx.update(organizations).set({ rheoProtected: true }).where(eq(organizations.id, organization.id));
    await tx
      .insert(rheoWorkspaces)
      .values({ orgId: organization.id, controlOrgId: control.orgId, ownerUserId: userId, kind: "project" });
    await coordinator(tx, userId, organization.id, general.id, template.instructions);
    const [project] = await tx
      .insert(rheoProjects)
      .values({
        orgId: control.orgId,
        spaceId: space.id,
        nativeOrgId: organization.id,
        channelId: general.id,
        templateId: template.id,
        name,
        requestKey,
      })
      .returning();
    if (!project) throw new Error("project insert returned nothing");
    return projectLink(project);
  });
}

export async function setRheoProjectState(
  db: Database,
  userId: string,
  projectId: string,
  state: "active" | "archived",
  pubsub?: PubSub,
): Promise<RheoProjectLink> {
  if (state !== "active" && state !== "archived") throw new ValidationError("Estado inválido.");
  const result = await db.transaction(async (tx) => {
    await lockActor(tx, userId);
    const control = await requireControl(tx, userId);
    const [project] = await tx
      .select()
      .from(rheoProjects)
      .where(and(eq(rheoProjects.id, projectId), eq(rheoProjects.orgId, control.orgId)));
    if (!project) throw new ForbiddenError();
    await tx.update(rheoWorkspaces).set({ state }).where(eq(rheoWorkspaces.orgId, project.nativeOrgId));
    if (state === "active") {
      const fence = await lastRheoArchive(tx, project.nativeOrgId);
      const [unfinished] = fence
        ? await tx
            .select({ id: schema.agentRuns.id })
            .from(schema.agentRuns)
            .innerJoin(schema.auditLog, eq(schema.auditLog.id, fence.id))
            .where(
              and(
                eq(schema.agentRuns.orgId, project.nativeOrgId),
                lte(schema.agentRuns.createdAt, schema.auditLog.createdAt),
                or(
                  inArray(schema.agentRuns.status, [...ACTIVE_RUN_STATUSES]),
                  sql`cardinality(${schema.agentRuns.pendingMessageIds}) > 0`,
                ),
              ),
            )
            .limit(1)
        : [];
      if (unfinished)
        throw new ConflictError("O projeto ainda está a terminar trabalhos. Aguarde e tente reabrir novamente.");
    } else if (project.state !== "archived") {
      // now() is the transaction's start; the fence must follow acquisition of the workspace lock.
      await tx.insert(schema.auditLog).values({
        orgId: project.nativeOrgId,
        actorType: "person",
        actorId: userId,
        action: RHEO_ARCHIVE_ACTION,
        targetType: "project",
        targetId: project.id,
        createdAt: sql`clock_timestamp()`,
      });
    }
    await tx
      .update(channels)
      .set({ archivedAt: state === "archived" ? new Date() : null })
      .where(eq(channels.orgId, project.nativeOrgId));
    if (state === "archived")
      await tx.update(schema.routines).set({ active: false }).where(eq(schema.routines.orgId, project.nativeOrgId));
    const [updated] = await tx.update(rheoProjects).set({ state }).where(eq(rheoProjects.id, project.id)).returning();
    if (!updated) throw new Error("project update returned nothing");
    const runs =
      state === "archived"
        ? await tx
            .select({ id: schema.agentRuns.id })
            .from(schema.agentRuns)
            .where(
              and(
                eq(schema.agentRuns.orgId, project.nativeOrgId),
                or(
                  inArray(schema.agentRuns.status, [...ACTIVE_RUN_STATUSES]),
                  sql`cardinality(${schema.agentRuns.pendingMessageIds}) > 0`,
                ),
              ),
            )
        : [];
    return { project: projectLink(updated), runs };
  });
  // Do not hold the workspace lock while native cancellation acquires run locks.
  for (const run of result.runs) await cancelRheoRun(db, result.project.orgId, run.id, pubsub);
  return result.project;
}

/** Also used by the closed job gate for a run persisted after archival was requested. */
export async function cancelRheoRun(db: Database, orgId: string, runId: string, pubsub?: PubSub) {
  const [row] = await db
    .select({ run: schema.agentRuns, channelKind: channels.kind })
    .from(schema.agentRuns)
    .leftJoin(channels, and(eq(channels.id, schema.agentRuns.channelId), eq(channels.orgId, orgId)))
    .where(and(eq(schema.agentRuns.orgId, orgId), eq(schema.agentRuns.id, runId)));
  if (!row) return;
  await db
    .update(schema.agentRuns)
    .set({ pendingMessageIds: [] })
    .where(and(eq(schema.agentRuns.orgId, orgId), eq(schema.agentRuns.id, runId)));
  try {
    await stopRun({ db, pubsub }, orgId, { ...row.run, pendingMessageIds: [] }, row.channelKind, {
      type: "system",
      reason: "agent_archived",
    });
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
  }
}
