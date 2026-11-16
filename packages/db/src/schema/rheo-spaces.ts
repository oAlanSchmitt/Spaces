import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { channels } from "./chat";
import { organizations } from "./tenancy";

export const rheoWorkspaces = pgTable(
  "rheo_workspaces",
  {
    orgId: uuid()
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    controlOrgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().$type<"control" | "project">().notNull(),
    state: text().$type<"active" | "archived">().notNull().default("active"),
  },
  (t) => [
    uniqueIndex("rheo_owner_control").on(t.ownerUserId).where(sql`${t.kind} = 'control'`),
    check("rheo_workspace_kind", sql`${t.kind} in ('control', 'project')`),
    check("rheo_workspace_state", sql`${t.state} in ('active', 'archived')`),
  ],
);

export const rheoBusinesses = pgTable(
  "rheo_businesses",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.id), uniqueIndex("rheo_business_name").on(t.orgId, sql`lower(${t.name})`)],
);

export const rheoSpaces = pgTable(
  "rheo_spaces",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid().notNull(),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.orgId, t.id),
    uniqueIndex("rheo_space_name").on(t.businessId, sql`lower(${t.name})`),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [rheoBusinesses.orgId, rheoBusinesses.id],
    }).onDelete("cascade"),
  ],
);

export const rheoTemplates = pgTable(
  "rheo_templates",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    version: text().notNull(),
    instructions: text().notNull(),
  },
  (t) => [unique().on(t.orgId, t.id), unique().on(t.orgId, t.name, t.version)],
);

export const rheoProjects = pgTable(
  "rheo_projects",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid().notNull(),
    nativeOrgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" })
      .unique(),
    channelId: uuid().notNull(),
    templateId: uuid().notNull(),
    name: text().notNull(),
    requestKey: text().notNull(),
    folderPath: text(),
    handoffObjective: text().notNull().default(""),
    handoffCriteria: text().notNull().default(""),
    state: text().$type<"active" | "archived">().notNull().default("active"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.orgId, t.requestKey),
    unique().on(t.nativeOrgId, t.id),
    foreignKey({ columns: [t.orgId, t.spaceId], foreignColumns: [rheoSpaces.orgId, rheoSpaces.id] }).onDelete(
      "cascade",
    ),
    foreignKey({ columns: [t.orgId, t.templateId], foreignColumns: [rheoTemplates.orgId, rheoTemplates.id] }),
    foreignKey({ columns: [t.nativeOrgId, t.channelId], foreignColumns: [channels.orgId, channels.id] }),
    check("rheo_project_state", sql`${t.state} in ('active', 'archived')`),
  ],
);
