import { afterEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { RheoKnowledgeDialog } from "@/components/RheoKnowledgeDialog";
import { RheoProjectContext } from "@/components/RheoProjectContext";
import type { RheoKnowledge } from "@/lib/rheo-spaces";
import { RheoSpacesPage } from "@/pages/RheoSpacesPage";
import { createFakeApi, ENG_ID, ORG_ID } from "./fake-api";
import { renderApp, renderPage, screen, settle } from "./render";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
const click = (node: Element) => act(async () => void fireEvent.click(node));
const change = (node: Element, value: string) => act(async () => void fireEvent.change(node, { target: { value } }));

function backend() {
  let knowledgeReads = 0;
  const writes: Record<string, string>[] = [];
  const data: RheoKnowledge = {
    profile: "protected",
    state: "active",
    entries: [
      {
        id: "private",
        orgId: ORG_ID,
        spaceId: null,
        revision: 1,
        kind: "document",
        title: "Documento pessoal",
        body: "Conteúdo reservado ao dono",
        visibility: "owner",
        state: "approved",
        createdAt: "2026-11-14T10:00:00Z",
        updatedAt: "2026-11-14T10:00:00Z",
      },
      {
        id: "memory",
        orgId: ORG_ID,
        spaceId: null,
        revision: 1,
        kind: "memory",
        title: "Preferência proposta",
        body: "Usar linguagem simples",
        visibility: "project",
        state: "proposed",
        createdAt: "2026-11-14T10:00:00Z",
        updatedAt: "2026-11-14T10:00:00Z",
      },
      {
        id: "shared",
        orgId: ORG_ID,
        spaceId: null,
        revision: 1,
        kind: "document",
        title: "Brief aprovado",
        body: "Contexto do projeto",
        visibility: "project",
        state: "approved",
        createdAt: "2026-11-14T10:00:00Z",
        updatedAt: "2026-11-14T10:00:00Z",
      },
    ],
    receipts: [{ runId: "run-1", entryIds: ["shared"], messageIds: ["message-1"], createdAt: "2026-11-14T11:00:00Z" }],
  };
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
    if (path === "/api/app/spaces")
      return Response.json({
        controlOrgId: "control",
        controlChannelId: "general",
        templates: [],
        businesses: [
          {
            id: "business",
            name: "Profissional",
            spaces: [
              {
                id: "client",
                name: "Cliente exemplo",
                projects: [
                  {
                    id: "project",
                    name: "Site institucional",
                    orgId: ORG_ID,
                    channelId: "project-channel",
                    state: "active",
                  },
                ],
              },
            ],
          },
        ],
      });
    assert(path.startsWith(`/api/app/spaces/workspaces/${ORG_ID}/`));
    if (!init?.method || init.method === "GET") {
      knowledgeReads++;
      return Response.json(data);
    }
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    writes.push(body);
    if (init.method === "POST") {
      const entry = {
        ...body,
        id: "created",
        state: "approved",
        createdAt: "2026-11-14T12:00:00Z",
        updatedAt: "2026-11-14T12:00:00Z",
      };
      data.entries.push(entry as RheoKnowledge["entries"][number]);
      return Response.json(entry);
    }
    const entry = data.entries.find((item) => path.endsWith(`/${item.id}`));
    assert(entry);
    entry.state = body.state as "approved" | "archived";
    return Response.json(entry);
  }) as typeof fetch;
  return { data, writes, reads: () => knowledgeReads };
}

test("knowledge bodies load only on request, private content is labelled, and proposed memory can be reviewed", async () => {
  const fake = backend();
  await renderPage(<RheoSpacesPage />, { api: createFakeApi(), org: true });
  expect(fake.reads()).toBe(0);
  expect(screen().queryByText("Conteúdo reservado ao dono")).toBeNull();
  await click(screen().getByRole("button", { name: "Conhecimento de Site institucional" }));
  await settle(4);
  const dialog = screen().getByRole("dialog", { name: "Conhecimento do projeto" });
  expect(fake.reads()).toBe(1);
  expect(within(dialog).getByText("Conteúdo marcado como Só para mim não é enviado aos agentes.")).toBeTruthy();
  expect(within(dialog).getByRole("article", { name: "Documento pessoal" }).textContent).toContain("Só para mim");
  const memory = within(dialog).getByRole("article", { name: "Preferência proposta" });
  await click(within(memory).getByRole("button", { name: "Aprovar" }));
  await settle(3);
  expect(fake.data.entries.find((entry) => entry.id === "memory")?.state).toBe("approved");
  await click(within(memory).getByRole("button", { name: "Arquivar" }));
  await settle(3);
  expect(fake.data.entries.find((entry) => entry.id === "memory")?.state).toBe("archived");
});

test("older knowledge loads by cursor without losing the current page", async () => {
  const fake = backend();
  const sample = fake.data.entries[0];
  assert(sample);
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    const older = String(input).includes("?before=");
    return Response.json({
      ...fake.data,
      entries: [{ ...sample, id: older ? "older" : "recent", title: older ? "Mais antigo" : "Mais recente" }],
      nextCursor: older ? null : "recent",
    });
  }) as typeof fetch;
  await renderPage(
    <RheoKnowledgeDialog
      project={{ id: "project", name: "Site", orgId: ORG_ID, channelId: "channel", state: "active" }}
      onClose={() => {}}
    />,
    { api: createFakeApi(), org: true },
  );
  await click(screen().getByRole("button", { name: "Carregar mais" }));
  await settle(3);
  expect(screen().getByRole("article", { name: "Mais recente" })).toBeTruthy();
  expect(screen().getByRole("article", { name: "Mais antigo" })).toBeTruthy();
  expect(requests.at(-1)).toContain("?before=recent");
  expect(screen().queryByRole("button", { name: "Carregar mais" })).toBeNull();
});

test("new owner content stays private by default and the source inspector shows actual receipt IDs", async () => {
  const fake = backend();
  await renderPage(<RheoSpacesPage />, { api: createFakeApi(), org: true });
  await click(screen().getByRole("button", { name: "Conhecimento de Site institucional" }));
  await settle(3);
  const dialog = screen().getByRole("dialog", { name: "Conhecimento do projeto" });
  await click(within(dialog).getByRole("button", { name: "Adicionar conteúdo" }));
  await change(within(dialog).getByRole("textbox", { name: "Título" }), "Nota do dono");
  await change(within(dialog).getByRole("textbox", { name: "Conteúdo" }), "Guardar apenas para mim");
  await click(within(dialog).getByRole("button", { name: "Salvar conteúdo" }));
  await settle(3);
  expect(fake.writes[0]).toEqual({
    kind: "document",
    title: "Nota do dono",
    body: "Guardar apenas para mim",
    visibility: "owner",
  });
  await act(
    async () => void fireEvent.mouseDown(within(dialog).getByRole("tab", { name: /Fontes usadas/ }), { button: 0 }),
  );
  const panel = within(dialog).getByRole("tabpanel");
  expect(panel.textContent).toContain("run-1");
  expect(panel.textContent).toContain("shared");
  expect(panel.textContent).toContain("message-1");
  expect(panel.textContent).not.toContain("Conteúdo reservado ao dono");
});

test("the project breadcrumb fetches metadata alone and identifies the restricted profile", async () => {
  const fake = backend();
  await renderPage(<RheoProjectContext />, { api: createFakeApi(), org: true });
  const trail = screen().getByRole("navigation", { name: "Projeto atual" });
  expect(trail.textContent).toContain("Profissional");
  expect(trail.textContent).toContain("Cliente exemplo");
  expect(trail.textContent).toContain("Site institucional");
  expect(trail.textContent).toContain("Perfil restrito");
  expect(fake.reads()).toBe(0);
});

test("the native channel header keeps the project breadcrumb and knowledge reachable", async () => {
  const fake = backend();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi() });
  await settle(3);
  const trail = screen().getByRole("navigation", { name: "Projeto atual" });
  expect(trail.textContent).toContain("Site institucional");
  expect(within(trail).getByRole("button", { name: "Conhecimento" })).toBeTruthy();
  expect(document.querySelector(".channel__header")).toBeTruthy();
  expect(fake.reads()).toBe(0);
});
