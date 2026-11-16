import { afterEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import type { RheoOverview } from "@/lib/rheo-spaces";
import { RheoSpacesPage } from "@/pages/RheoSpacesPage";
import { createFakeApi, ORG_ID } from "./fake-api";
import { renderApp, renderPage, screen, settle } from "./render";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const click = (node: Element) => act(async () => void fireEvent.click(node));
const change = (node: Element, value: string) => act(async () => void fireEvent.change(node, { target: { value } }));

function backend(data: RheoOverview) {
  const writes: { path: string; body: Record<string, string> }[] = [];
  let projectFailures = 0;
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
    if (!path.startsWith("/api/app/spaces")) throw new Error(`Unexpected request: ${path}`);
    if (!init?.method || init.method === "GET") return Response.json(data);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.credentials).toBe("same-origin");
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    writes.push({ path, body });
    if (path.endsWith("/bootstrap")) {
      data.controlOrgId = "global-org";
      data.controlChannelId = "global-channel";
      return Response.json(data);
    }
    if (path.endsWith("/businesses")) {
      const business = { id: "business", name: body.name ?? "", spaces: [] };
      data.businesses.push(business);
      return Response.json(business);
    }
    if (path.endsWith("/spaces")) {
      const space = { id: "space", name: body.name ?? "", projects: [] };
      data.businesses.find((b) => b.id === body.businessId)?.spaces.push(space);
      return Response.json(space);
    }
    if (path.endsWith("/projects")) {
      if (projectFailures-- > 0)
        return Response.json({ error: { code: "unavailable", message: "Tente novamente" } }, { status: 503 });
      const project = {
        id: "project",
        name: body.name ?? "",
        orgId: "project-org",
        channelId: "project-channel",
        state: "active" as const,
      };
      const space = data.businesses[0]?.spaces[0];
      assert(space);
      space.projects.push(project);
      return Response.json(project);
    }
    const project = data.businesses[0]?.spaces[0]?.projects[0];
    assert(project);
    project.state = body.state as "active" | "archived";
    return Response.json(project);
  }) as typeof fetch;
  return {
    writes,
    failProject: () => {
      projectFailures++;
    },
  };
}

const empty = (): RheoOverview => ({ controlOrgId: null, controlChannelId: null, businesses: [], templates: [] });
const ready = (): RheoOverview => ({
  controlOrgId: "global-org",
  controlChannelId: "global-channel",
  templates: [{ id: "standard", name: "Equipe base", version: "1.0.0" }],
  businesses: [
    { id: "business", name: "Profissional", spaces: [{ id: "space", name: "Cliente exemplo", projects: [] }] },
  ],
});

async function create(openLabel: string, name: string) {
  await click(screen().getByRole("button", { name: openLabel }));
  const dialog = screen().getByRole("dialog");
  await change(within(dialog).getByRole("textbox", { name: "Nome" }), name);
  await click(within(dialog).getByRole("button", { name: "Criar" }));
  await settle(5);
}

test("initializes the account, then creates business, client space and an isolated project", async () => {
  const data = empty();
  const { writes } = backend(data);
  await renderPage(<RheoSpacesPage />, { api: createFakeApi(), org: true });
  await click(screen().getByRole("button", { name: "Preparar meus espaços" }));
  await settle(4);
  await create("Criar área", "Profissional");
  await create("Criar espaço em Profissional", "Cliente exemplo");
  await create("Criar projeto em Cliente exemplo", "Site institucional");
  const link = screen().getByRole("link", { name: "Abrir Site institucional" });
  expect(link.getAttribute("href")).toBe("/org/project-org/c/project-channel");
  expect(screen().getByRole("link", { name: "Abrir coordenador global" }).getAttribute("href")).toBe(
    "/org/global-org/c/global-channel",
  );
  expect(writes.map((w) => w.path.split("/").at(-1))).toEqual(["bootstrap", "businesses", "spaces", "projects"]);
  expect(writes[3]?.body).toEqual({ spaceId: "space", name: "Site institucional", requestKey: expect.any(String) });
  expect(screen().queryByRole("dialog")).toBeNull();
});

test("keeps project input and request identity after a failed write, and archives or reopens without deleting it", async () => {
  const data = ready();
  const fake = backend(data);
  fake.failProject();
  await renderPage(<RheoSpacesPage />, { api: createFakeApi(), org: true });
  await create("Criar projeto em Cliente exemplo", "Portal do cliente");
  const dialog = screen().getByRole("dialog");
  expect((within(dialog).getByRole("textbox", { name: "Nome" }) as HTMLInputElement).value).toBe("Portal do cliente");
  expect(within(dialog).getByRole("alert")).toBeTruthy();
  await click(within(dialog).getByRole("button", { name: "Criar" }));
  await settle(5);
  expect(fake.writes[0]?.body.requestKey).toBe(fake.writes[1]?.body.requestKey);
  await click(screen().getByRole("button", { name: "Arquivar Portal do cliente" }));
  await settle(4);
  expect(screen().getByText("Arquivado", { exact: true })).toBeTruthy();
  expect(screen().getByRole("link", { name: "Abrir Portal do cliente" })).toBeTruthy();
  await click(screen().getByRole("button", { name: "Reabrir Portal do cliente" }));
  await settle(4);
  expect(data.businesses[0]?.spaces[0]?.projects).toHaveLength(1);
  expect(data.businesses[0]?.spaces[0]?.projects[0]?.state).toBe("active");
});

test("a failed read offers retry without inventing an empty hierarchy", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "unavailable", message: "Indisponível" } },
      { status: 503 },
    )) as unknown as typeof fetch;
  await renderPage(<RheoSpacesPage />, { api: createFakeApi(), org: true });
  expect(screen().getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  expect(screen().queryByRole("button", { name: "Preparar meus espaços" })).toBeNull();
});

test("the native sidebar opens the account hierarchy without changing the current conversation", async () => {
  backend(ready());
  const { router } = await renderApp(`/org/${ORG_ID}/home`, { api: createFakeApi() });
  const nav = document.getElementById("app-nav");
  assert(nav);
  await click(within(nav).getByRole("link", { name: "Spaces" }));
  await settle(5);
  expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/spaces`);
  expect(screen().getByRole("heading", { name: "Meus espaços", level: 1 })).toBeTruthy();
  expect(screen().getByRole("region", { name: "Cliente exemplo" })).toBeTruthy();
});

test("long client and project names stay intact and a changed retry gets a new request identity", async () => {
  const data = ready();
  const space = data.businesses[0]?.spaces[0];
  assert(space);
  space.name = "Cliente com um nome muito extenso para verificar a navegação e a leitura";
  const fake = backend(data);
  fake.failProject();
  await renderPage(<RheoSpacesPage />, { api: createFakeApi(), org: true });
  document.querySelector(".rheo-spaces")?.classList.add("rheo-spaces--worst-case");
  await create(`Criar projeto em ${space.name}`, "Projeto inicial");
  const dialog = screen().getByRole("dialog");
  const name = "Projeto de acompanhamento com nome extenso e documentação do cliente";
  await change(within(dialog).getByRole("textbox", { name: "Nome" }), name);
  await click(within(dialog).getByRole("button", { name: "Criar" }));
  await settle(5);
  expect(fake.writes[0]?.body.requestKey).not.toBe(fake.writes[1]?.body.requestKey);
  expect(screen().getByRole("heading", { name, level: 4 }).textContent).toBe(name);
});

test("active and archived projects remain readable under a long client name", async () => {
  const data = ready();
  const space = data.businesses[0]?.spaces[0];
  assert(space);
  space.name = "Cliente com um nome muito extenso para verificar a navegação e a leitura";
  const name = "Projeto de acompanhamento com nome extenso e documentação do cliente";
  space.projects.push(
    { id: "active", name, orgId: "project-org", channelId: "project-channel", state: "active" },
    {
      id: "archived",
      name: "Campanha anterior",
      orgId: "archive-org",
      channelId: "archive-channel",
      state: "archived",
    },
  );
  backend(data);
  await renderPage(<RheoSpacesPage />, { api: createFakeApi(), org: true });
  document.querySelector(".rheo-spaces")?.classList.add("rheo-spaces--mixed-states");
  expect(screen().getByRole("heading", { name, level: 4 })).toBeTruthy();
  expect(screen().getByRole("button", { name: "Reabrir Campanha anterior" })).toBeTruthy();
  expect(screen().getByRole("link", { name: "Abrir Campanha anterior" }).getAttribute("href")).toBe(
    "/org/archive-org/c/archive-channel",
  );
});
