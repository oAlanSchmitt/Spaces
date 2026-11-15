import { afterEach, beforeEach, expect, test } from "bun:test";
import type { RheoOverview } from "@agenteschat/engine";
import { browser, createTestServer, signUp, type TestServer } from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
});
afterEach(async () => t.close());

test("handoff API persists a strict configuration and returns a portable briefing only to its owner", async () => {
  const owner = browser(t);
  await signUp(owner, "handoff-owner@example.com");
  const tree = (await (await owner("/api/app/spaces/bootstrap", { json: {} })).json()) as RheoOverview;
  const project = tree.businesses.flatMap((b) => b.spaces.flatMap((s) => s.projects))[0];
  if (!project) throw new Error("Missing synthetic project");
  const url = `/api/app/spaces/projects/${project.id}/handoff`;
  expect((await t.app.request(url)).status).toBe(401);
  const defaults = await owner(url);
  expect(defaults.status).toBe(200);
  expect(await defaults.json()).toEqual({ folderPath: null, objective: "", criteria: "" });
  const input = { folderPath: "C:\\Synthetic work\\Project", objective: "Build a page", criteria: "Review it" };
  const saved = await owner(url, { method: "PUT", json: input });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    ...input,
    briefing: expect.stringContaining(input.objective),
    entryIds: [],
    omittedCount: 0,
  });
  expect(await (await owner(url)).json()).toEqual(input);
  expect((await owner(url, { method: "PUT", json: input, origin: "https://elsewhere.example" })).status).toBe(403);
  expect((await owner(url, { method: "PUT", json: { ...input, orgId: project.orgId } })).status).toBe(400);
  for (const change of [
    { folderPath: "relative/path" },
    { folderPath: "C:\\bad\npath" },
    { folderPath: `/${"a".repeat(2000)}` },
    { objective: "x".repeat(4001) },
    { criteria: "x".repeat(4001) },
  ]) {
    expect((await owner(url, { method: "PUT", json: { ...input, ...change } })).status).toBe(400);
  }
  const other = browser(t);
  await signUp(other, "handoff-other@example.com");
  expect((await other(url)).status).toBe(403);
  expect((await other(url, { method: "PUT", json: input })).status).toBe(403);
  const cleared = await owner(url, { method: "PUT", json: { ...input, folderPath: "" } });
  expect(await cleared.json()).toMatchObject({ folderPath: null });
  await owner(`/api/app/spaces/projects/${project.id}`, { method: "PATCH", json: { state: "archived" } });
  expect((await owner(url)).status).toBe(200);
  expect((await owner(url, { method: "PUT", json: input })).status).toBe(403);
});
