import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { RheoKnowledgeDialog } from "@/components/RheoKnowledgeDialog";
import { RheoSpacesPage } from "@/pages/RheoSpacesPage";
import { createFakeApi, ORG_ID } from "./fake-api";
import { renderPage, screen, settle } from "./render";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
const click = (node: Element) => act(async () => void fireEvent.click(node));
const change = (node: Element, value: string) => act(async () => void fireEvent.change(node, { target: { value } }));
const project = { id: "project", name: "Site", orgId: ORG_ID, channelId: "channel", state: "active" as const };
const space = { id: "client", name: "Cliente exemplo", projects: [project] };
const entry = {
  id: "shared",
  orgId: "control",
  spaceId: space.id,
  revision: 2,
  kind: "document",
  visibility: "project",
  state: "approved",
  title: "Marca comum",
  body: "Usar a identidade aprovada",
  createdAt: "2026-11-16T10:00:00Z",
  updatedAt: "2026-11-16T11:00:00Z",
};

test("space knowledge opens on demand from its own card without reading project knowledge", async () => {
  const reads: string[] = [];
  globalThis.fetch = (async (input) => {
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
        businesses: [{ id: "area", name: "Profissional", spaces: [space] }],
      });
    reads.push(path);
    return Response.json({ profile: "protected", state: "active", entries: [entry], receipts: [] });
  }) as typeof fetch;
  await renderPage(<RheoSpacesPage />, { api: createFakeApi(), org: true });
  expect(reads).toEqual([]);
  expect(screen().getByRole("button", { name: "Criar área" })).toBeTruthy();
  await click(screen().getByRole("button", { name: "Conhecimento compartilhado de Cliente exemplo" }));
  await settle(3);
  expect(reads).toEqual(["/api/app/spaces/spaces/client/knowledge"]);
  const dialog = screen().getByRole("dialog", { name: "Conhecimento do espaço" });
  expect(within(dialog).getByRole("article", { name: "Marca comum" }).textContent).toContain(
    "Todos os projetos do espaço",
  );
  expect(within(dialog).queryByRole("tab", { name: /Fontes usadas/ })).toBeNull();
});

test("space creation is explicit and private by default", async () => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    if (init?.method && init.method !== "GET") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json(entry);
    }
    return Response.json({ profile: "protected", state: "active", entries: [entry], receipts: [] });
  }) as typeof fetch;
  await renderPage(<RheoKnowledgeDialog space={space} onClose={() => {}} />, { api: createFakeApi(), org: true });
  await click(screen().getByRole("button", { name: "Adicionar conteúdo" }));
  await change(screen().getByRole("textbox", { name: "Título" }), "Nota privada");
  await change(screen().getByRole("textbox", { name: "Conteúdo" }), "Reservada");
  await click(screen().getByRole("button", { name: "Salvar conteúdo" }));
  await settle(3);
  expect(writes[0]).toEqual({
    path: "/api/app/spaces/spaces/client/knowledge",
    body: { kind: "document", title: "Nota privada", body: "Reservada", visibility: "owner" },
  });
});

test("inherited space entries are labelled and cannot be archived through a project", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      profile: "protected",
      state: "active",
      entries: [entry],
      receipts: [],
    })) as unknown as typeof fetch;
  await renderPage(<RheoKnowledgeDialog project={project} onClose={() => {}} />, { api: createFakeApi(), org: true });
  const card = screen().getByRole("article", { name: "Marca comum" });
  expect(card.textContent).toContain("Do espaço");
  expect(card.textContent).toContain("Revisão 2");
  expect(within(card).queryByRole("button", { name: "Arquivar" })).toBeNull();
});

test("editing a shared source sends its revision and retains the draft after a conflict", async () => {
  const writes: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "PATCH") {
      writes.push(JSON.parse(String(init.body)));
      return Response.json(
        { error: { code: "version_conflict", message: "Fonte alterada. Atualize o conhecimento." } },
        { status: 409 },
      );
    }
    return Response.json({ profile: "protected", state: "active", entries: [entry], receipts: [] });
  }) as typeof fetch;
  await renderPage(<RheoKnowledgeDialog space={space} onClose={() => {}} />, { api: createFakeApi(), org: true });
  await click(screen().getByRole("button", { name: "Editar conteúdo" }));
  await change(screen().getByRole("textbox", { name: "Conteúdo" }), "Nova identidade aprovada");
  await click(screen().getByRole("button", { name: "Salvar conteúdo" }));
  await settle(3);
  expect(writes).toEqual([
    { title: entry.title, body: "Nova identidade aprovada", visibility: "project", revision: 2 },
  ]);
  expect((screen().getByRole("textbox", { name: "Conteúdo" }) as HTMLTextAreaElement).value).toBe(
    "Nova identidade aprovada",
  );
  expect(screen().getByRole("alert")).toBeTruthy();
});
