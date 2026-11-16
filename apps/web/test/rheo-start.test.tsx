import { afterEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import type { RheoOverview } from "@/lib/rheo-spaces";
import { createFakeApi, GENERAL_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  localStorage.clear();
});
const click = (node: Element) => act(async () => void fireEvent.click(node));
const empty = (): RheoOverview => ({ controlOrgId: null, controlChannelId: null, businesses: [], templates: [] });

test("local first access prepares a protected Spaces workspace without the native setup wizard", async () => {
  const state = seedState({ instance: { cloud: false } });
  assert(state.me);
  const control = state.me.organizations[0];
  assert(control);
  state.me.organizations = [];
  const data = empty();
  const writes: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    if (path === "/api/app/spaces/codex")
      return Response.json({
        installed: false,
        connected: false,
        compatible: false,
        sandbox: "pending",
        version: null,
      });
    if (path === "/api/app/spaces") return Response.json(data);
    expect(path).toBe("/api/app/spaces/bootstrap");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    writes.push(path);
    assert(state.me);
    state.me.organizations = [control];
    data.controlOrgId = ORG_ID;
    data.controlChannelId = GENERAL_ID;
    return Response.json(data);
  }) as typeof fetch;
  const { router } = await renderApp("/", { api: createFakeApi(state) });
  await settle(4);
  expect(router.state.location.pathname).toBe("/onboarding");
  expect(screen().getByRole("heading", { name: "Meus espaços", level: 1 })).toBeTruthy();
  expect(screen().queryByRole("radio", { name: /Para meu time/ })).toBeNull();
  await click(screen().getByRole("button", { name: "Preparar meus espaços" }));
  await settle(10);
  expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/spaces`);
  expect(document.getElementById("app-nav")).toBeTruthy();
  expect(screen().getByRole("button", { name: "Criar área" })).toBeTruthy();
  expect(writes).toEqual(["/api/app/spaces/bootstrap"]);
  expect(state.calls.filter((call) => call.method === "orgs.create")).toHaveLength(0);
});

test("the native new-workspace destination returns an existing Spaces account to its catalog", async () => {
  let writes = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input) === "/api/app/spaces/codex")
      return Response.json({
        installed: false,
        connected: false,
        compatible: false,
        sandbox: "pending",
        version: null,
      });
    if (init?.method && init.method !== "GET") writes++;
    return Response.json({ ...empty(), controlOrgId: ORG_ID, controlChannelId: GENERAL_ID });
  }) as typeof fetch;
  const state = seedState({ instance: { cloud: false } });
  const { router } = await renderApp("/onboarding?resume=legacy-workspace", { api: createFakeApi(state) });
  await settle(8);
  expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/spaces`);
  expect(screen().getByRole("button", { name: "Criar área" })).toBeTruthy();
  expect(writes).toBe(0);
  expect(state.calls.filter((call) => call.method === "orgs.create")).toHaveLength(0);
});

test("a failed first-access read offers retry and never starts an unprotected native workspace", async () => {
  const state = seedState({ instance: { cloud: false } });
  assert(state.me);
  state.me.organizations = [];
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "unavailable", message: "Indisponível" } },
      { status: 503 },
    )) as unknown as typeof fetch;
  await renderApp("/onboarding", { api: createFakeApi(state) });
  await settle(4);
  expect(screen().getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  expect(screen().queryByRole("button", { name: "Preparar meus espaços" })).toBeNull();
  expect(state.calls.filter((call) => call.method === "orgs.create")).toHaveLength(0);
});

test("first access still requires the native signed-in session", async () => {
  let reads = 0;
  globalThis.fetch = (async () => {
    reads++;
    return Response.json(empty());
  }) as unknown as typeof fetch;
  const { router } = await renderApp("/onboarding", { api: createFakeApi(seedState({ me: null })) });
  await settle(3);
  expect(router.state.location.pathname).toBe("/login");
  expect(reads).toBe(0);
});
