import { afterEach, beforeEach, expect, test } from "bun:test";
import type { RheoOverview, RheoProjectLink } from "@agenteschat/engine";
import { browser, createTestServer, signUp, type TestServer } from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
});
afterEach(async () => t.close());

test("Rheo API requires a session and same-origin JSON for provisioning", async () => {
  expect((await t.app.request("/api/app/spaces")).status).toBe(401);
  const owner = browser(t);
  await signUp(owner, "rheo-owner@example.com");
  expect((await owner("/api/app/spaces/bootstrap", { json: {}, origin: "https://elsewhere.example" })).status).toBe(
    403,
  );
  expect((await owner("/api/app/spaces/bootstrap", { json: {}, origin: null })).status).toBe(403);
  expect(await (await owner("/api/app/spaces")).json()).toMatchObject({
    controlOrgId: null,
    businesses: [],
    templates: [],
  });
});

test("Rheo API creates its own panel, businesses, spaces and isolated projects with repeatable requests", async () => {
  const owner = browser(t);
  await signUp(owner, "rheo-owner@example.com");
  const boot = await owner("/api/app/spaces/bootstrap", { json: {} });
  expect(boot.status).toBe(200);
  const tree = (await boot.json()) as RheoOverview;
  expect(tree.controlOrgId).not.toBeNull();
  expect(tree.controlChannelId).not.toBeNull();
  expect(((await (await owner("/api/app/spaces/bootstrap", { json: {} })).json()) as RheoOverview).controlOrgId).toBe(
    tree.controlOrgId,
  );
  const businessResponse = await owner("/api/app/spaces/businesses", { json: { name: "Outro negócio" } });
  expect(businessResponse.status).toBe(201);
  const business = (await businessResponse.json()) as { id: string };
  const spaceResponse = await owner("/api/app/spaces/spaces", {
    json: { businessId: business.id, name: "Cliente Aurora" },
  });
  expect(spaceResponse.status).toBe(201);
  const space = (await spaceResponse.json()) as { id: string };
  const input = { spaceId: space.id, name: "Site", requestKey: "site-api" };
  const made = await owner("/api/app/spaces/projects", { json: input });
  expect(made.status).toBe(201);
  const project = (await made.json()) as RheoProjectLink;
  expect(project.orgId).not.toBe(tree.controlOrgId);
  expect(await (await owner("/api/app/spaces/projects", { json: input })).json()).toEqual(project);
  expect((await owner("/api/app/spaces/projects", { json: { ...input, name: "Outro" } })).status).toBe(400);
  expect(
    await (
      await owner(`/api/app/spaces/projects/${project.id}`, { method: "PATCH", json: { state: "archived" } })
    ).json(),
  ).toMatchObject({ id: project.id, state: "archived" });
  const other = browser(t);
  await signUp(other, "other@example.com");
  expect((await other("/api/app/spaces/projects", { json: { ...input, requestKey: "steal" } })).status).toBe(403);
  expect(
    (await other(`/api/app/spaces/projects/${project.id}`, { method: "PATCH", json: { state: "active" } })).status,
  ).toBe(403);
  expect((await owner("/api/app/spaces/projects", { json: { ...input, spaceId: "not-an-id" } })).status).toBe(400);
  expect((await owner("/api/app/spaces/businesses", { json: { name: " ", ownerUserId: "other" } })).status).toBe(400);
});
