import { foreignKey, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { rheoProjects } from "./rheo-spaces";
import { agentRuns } from "./runtime";

export const rheoProjectWork = pgTable(
  "rheo_project_work",
  {
    orgId: uuid().notNull(),
    projectId: uuid().primaryKey(),
    folderPath: text().notNull(),
    hostId: text().notNull(),
    accountFingerprint: text().notNull(),
    revision: uuid().notNull().defaultRandom(),
    probeMessage: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.orgId, t.projectId),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [rheoProjects.nativeOrgId, rheoProjects.id],
    }).onDelete("cascade"),
  ],
);

export const rheoWorkTurns = pgTable(
  "rheo_work_turns",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid().notNull(),
    projectId: uuid().notNull(),
    runId: uuid().notNull(),
    callId: text().notNull(),
    bindingRevision: uuid().notNull(),
    result: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.orgId, t.runId, t.callId),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [rheoProjects.nativeOrgId, rheoProjects.id],
    }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.runId], foreignColumns: [agentRuns.orgId, agentRuns.id] }).onDelete("cascade"),
  ],
);
