import { afterEach, expect, test } from "bun:test";
import { schema } from "@agenteschat/db";
import type { RheoOverview } from "@agenteschat/engine";
import { browser, createTestServer, signUp, type TestServer } from "./harness";

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

test("project knowledge uses owner authorization and same-origin review", async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "alan-test@example.com");
  const tree = (await (await owner("/api/app/spaces/bootstrap", { json: {} })).json()) as RheoOverview;
  const project = tree.businesses.flatMap((business) => business.spaces.flatMap((space) => space.projects))[0];
  if (!project) throw new Error("Missing initial project");
  const base = `/api/app/spaces/workspaces/${project.orgId}`;
  const made = await owner(`${base}/entries`, {
    json: { kind: "document", title: "Contract", body: "ONLY_OWNER", visibility: "owner" },
  });
  expect(made.status).toBe(201);
  const entry = (await made.json()) as { id: string };
  const view = await owner(`${base}/knowledge`);
  expect(view.status).toBe(200);
  expect(await view.json()).toMatchObject({
    profile: "protected",
    entries: [{ title: "Contract", visibility: "owner" }],
  });
  const other = browser(t);
  await signUp(other, "other-test@example.com");
  expect((await other(`${base}/knowledge`)).status).toBe(403);
  expect(
    (
      await owner(`${base}/entries/${entry.id}`, {
        method: "PATCH",
        json: { state: "archived" },
        origin: "https://elsewhere.example",
      })
    ).status,
  ).toBe(403);
  expect((await owner(`${base}/entries/${entry.id}`, { method: "PATCH", json: { state: "archived" } })).status).toBe(
    200,
  );
  await t.db.insert(schema.rheoEntries).values(
    Array.from({ length: 201 }, (_, i) => ({
      orgId: project.orgId,
      kind: "document" as const,
      title: `Document ${i}`,
      body: "Synthetic",
      state: "approved" as const,
      createdAt: new Date(1700000000000 + i),
    })),
  );
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 5; page++) {
    const response = await owner(`${base}/knowledge${cursor ? `?before=${cursor}` : ""}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: { id: string }[]; nextCursor: string | null };
    expect(body.entries.length).toBeLessThanOrEqual(50);
    for (const row of body.entries) {
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);
    }
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  expect(ids.size).toBe(202);
  expect(cursor).toBeNull();
  expect((await owner(`${base}/knowledge?before=${crypto.randomUUID()}`)).status).toBe(404);
});
