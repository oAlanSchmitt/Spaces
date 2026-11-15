import { createRequester } from "@agenteschat/client";

export interface RheoProject {
  id: string;
  name: string;
  orgId: string;
  channelId: string;
  state: "active" | "archived";
}

export interface RheoSpace {
  id: string;
  name: string;
  projects: RheoProject[];
}

export interface RheoOverview {
  controlOrgId: string | null;
  controlChannelId: string | null;
  businesses: { id: string; name: string; spaces: RheoSpace[] }[];
  templates: { id: string; name: string; version: string }[];
}

export interface RheoEntry {
  id: string;
  kind: "document" | "memory" | "task";
  visibility: "project" | "owner";
  state: "approved" | "proposed" | "archived";
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface RheoKnowledge {
  entries: RheoEntry[];
  nextCursor?: string | null;
  receipts: { runId: string; entryIds: string[]; messageIds: string[]; createdAt: string }[];
  profile: "protected";
  state: "active" | "archived";
}

export interface RheoHandoffConfig {
  folderPath: string | null;
  objective: string;
  criteria: string;
}

export interface RheoHandoff extends RheoHandoffConfig {
  briefing: string;
  entryIds: string[];
  omittedCount: number;
}

export const rheoOverviewKey = (userId: string) => ["rheo-spaces", userId] as const;
export const rheoKnowledgeKey = (userId: string, orgId: string) => ["rheo-knowledge", userId, orgId] as const;
export const rheoHandoffKey = (userId: string, projectId: string) => ["rheo-handoff", userId, projectId] as const;

export type RheoCreate =
  | { kind: "business" }
  | { kind: "space"; parentId: string; parentName: string }
  | { kind: "project"; parentId: string; parentName: string };

const request = createRequester();
const base = "/api/app/spaces";

/** Same cookie session, JSON writes and error handling as the native app API. */
export const rheoSpacesApi = {
  overview: () => request<RheoOverview>(base),
  bootstrap: () => request<RheoOverview>(`${base}/bootstrap`, { json: {} }),
  create: (target: RheoCreate, name: string, templateId: string, requestKey: string) => {
    if (target.kind === "business") return request(`${base}/businesses`, { json: { name } });
    if (target.kind === "space") return request(`${base}/spaces`, { json: { businessId: target.parentId, name } });
    return request<RheoProject>(`${base}/projects`, {
      json: { spaceId: target.parentId, name, ...(templateId ? { templateId } : {}), requestKey },
    });
  },
  setState: (project: RheoProject, state: RheoProject["state"]) =>
    request<RheoProject>(`${base}/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", json: { state } }),
  handoff: (projectId: string, signal?: AbortSignal) =>
    request<RheoHandoffConfig>(`${base}/projects/${encodeURIComponent(projectId)}/handoff`, { signal }),
  prepareHandoff: (projectId: string, input: RheoHandoffConfig) =>
    request<RheoHandoff>(`${base}/projects/${encodeURIComponent(projectId)}/handoff`, { method: "PUT", json: input }),
  knowledge: (orgId: string, beforeId?: string) =>
    request<RheoKnowledge>(
      `${base}/workspaces/${encodeURIComponent(orgId)}/knowledge${beforeId ? `?before=${encodeURIComponent(beforeId)}` : ""}`,
    ),
  addEntry: (orgId: string, input: Pick<RheoEntry, "kind" | "title" | "body" | "visibility">) =>
    request<RheoEntry>(`${base}/workspaces/${encodeURIComponent(orgId)}/entries`, { json: input }),
  reviewEntry: (orgId: string, entryId: string, state: "approved" | "archived") =>
    request<RheoEntry>(`${base}/workspaces/${encodeURIComponent(orgId)}/entries/${encodeURIComponent(entryId)}`, {
      method: "PATCH",
      json: { state },
    }),
};
