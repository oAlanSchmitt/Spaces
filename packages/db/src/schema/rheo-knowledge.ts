import { foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { channels } from "./chat";
import { rheoSpaces } from "./rheo-spaces";
import { agentRuns } from "./runtime";
import { organizations } from "./tenancy";

/** Explicitly reviewed project knowledge; owner-only material never enters an agent context. */
export const rheoEntries = pgTable(
  "rheo_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid(),
    revision: integer().notNull().default(1),
    kind: text().$type<"document" | "memory" | "task">().notNull(),
    visibility: text().$type<"project" | "owner">().notNull().default("project"),
    state: text().$type<"proposed" | "approved" | "archived">().notNull().default("proposed"),
    title: text().notNull(),
    body: text().notNull(),
    createdByUserId: text().references(() => users.id, { onDelete: "set null" }),
    createdByAgentId: uuid(),
    sourceRunId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.orgId, t.id),
    index("rheo_entries_scope_idx").on(t.orgId, t.kind, t.state, t.visibility),
    index("rheo_entries_space_idx").on(t.orgId, t.spaceId, t.state, t.visibility),
    foreignKey({ columns: [t.orgId, t.spaceId], foreignColumns: [rheoSpaces.orgId, rheoSpaces.id] }).onDelete(
      "cascade",
    ),
    foreignKey({ columns: [t.orgId, t.createdByAgentId], foreignColumns: [agents.orgId, agents.id] }),
    foreignKey({ columns: [t.sourceRunId], foreignColumns: [agentRuns.id], name: "rheo_entry_source_run_fk" }),
  ],
);

/** Sources actually selected for a protected run, without copying their confidential content. */
export const rheoContextReceipts = pgTable(
  "rheo_context_receipts",
  {
    runId: uuid().primaryKey(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    channelId: uuid().notNull(),
    agentId: uuid().notNull(),
    entryIds: jsonb().$type<string[]>().notNull().default([]),
    entryRevisions: jsonb().$type<Record<string, number>>().notNull().default({}),
    messageIds: jsonb().$type<string[]>().notNull().default([]),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.runId], foreignColumns: [agentRuns.id], name: "rheo_receipt_run_fk" }).onDelete("cascade"),
    foreignKey({
      columns: [t.orgId, t.channelId],
      foreignColumns: [channels.orgId, channels.id],
      name: "rheo_receipt_channel_fk",
    }),
    foreignKey({
      columns: [t.orgId, t.agentId],
      foreignColumns: [agents.orgId, agents.id],
      name: "rheo_receipt_agent_fk",
    }),
  ],
);
