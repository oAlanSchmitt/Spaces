import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { keys } from "@agenteschat/client";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { RheoProjectContext } from "@/components/RheoProjectContext";
import { SpacesCodexHandoff } from "@/components/SpacesCodexHandoff";
import { type RheoHandoffConfig, type RheoProject, rheoHandoffKey } from "@/lib/rheo-spaces";
import { RheoSpacesPage } from "@/pages/RheoSpacesPage";
import { createFakeApi, ORG_ID } from "./fake-api";
import { renderPage, screen, settle } from "./render";

const originalFetch = globalThis.fetch;
const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
const click = (node: Element) => act(async () => void fireEvent.click(node));
const change = (node: Element, value: string) => act(async () => void fireEvent.change(node, { target: { value } }));
const project: RheoProject = {
  id: "project-one",
  name: "Portal do cliente",
  orgId: "project-org",
  channelId: "project-channel",
  state: "active",
};
const initial: RheoHandoffConfig = {
  folderPath: "C:\\Clientes\\Portal",
  objective: "Rever formulário",
  criteria: "Validar envio",
};

function backend(config = initial) {
  let current = config;
  let failRead = false;
  let failWrite = false;
  const writes: RheoHandoffConfig[] = [];
  const reads: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    expect(path).toMatch(/^\/api\/app\/spaces\/projects\/project-(one|two)\/handoff$/);
    if (!init?.method || init.method === "GET") {
      reads.push(path);
      if (failRead) return Response.json({ error: { code: "unavailable", message: "Falhou" } }, { status: 503 });
      return Response.json(current);
    }
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    const body = JSON.parse(String(init.body)) as RheoHandoffConfig;
    writes.push(body);
    if (failWrite) return Response.json({ error: { code: "invalid", message: "Caminho inválido" } }, { status: 400 });
    current = body;
    return Response.json({
      ...body,
      briefing: `Contexto preparado\n${body.folderPath ?? "Sem pasta"}\n${body.objective}`,
      entryIds: ["entry-1"],
      omittedCount: 2,
    });
  }) as typeof fetch;
  return {
    reads,
    writes,
    set: (value: RheoHandoffConfig) => {
      current = value;
    },
    failRead: (value: boolean) => {
      failRead = value;
    },
    failWrite: (value: boolean) => {
      failWrite = value;
    },
  };
}
const field = (name: string) => screen().getByRole("textbox", { name }) as HTMLInputElement;
const prepare = async () => {
  await click(screen().getByRole("button", { name: "Salvar e preparar" }));
  await settle(4);
};

test("saves references, previews the briefing and copies only on a person's click", async () => {
  const fake = backend();
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        copied.push(text);
      },
    },
  });
  await renderPage(<SpacesCodexHandoff project={project} onClose={() => {}} />, { api: createFakeApi() });
  expect(field("Pasta do projeto").value).toBe(initial.folderPath ?? "");
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(copied).toEqual([]);
  expect(screen().queryByRole("textbox", { name: "Briefing para o Codex" })).toBeNull();
  await change(field("Objetivo da próxima tarefa"), "Corrigir o formulário");
  await prepare();
  expect(fake.writes).toEqual([{ ...initial, objective: "Corrigir o formulário" }]);
  const preview = field("Briefing para o Codex");
  expect(preview.value).toContain("Corrigir o formulário");
  expect(preview.readOnly).toBe(true);
  expect(screen().getByRole("status").textContent).toContain("Referências salvas");
  expect(copied).toEqual([]);
  await click(screen().getByRole("button", { name: "Copiar briefing" }));
  await settle();
  expect(copied).toEqual([preview.value]);
  expect(screen().getByRole("status").textContent).toContain("Briefing copiado");
});

for (const unavailable of [false, true]) {
  test(`clipboard ${unavailable ? "missing" : "refused"} leaves a selectable preview and retry`, async () => {
    backend();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: unavailable
        ? undefined
        : {
            writeText: async () => {
              throw new Error("Denied");
            },
          },
    });
    await renderPage(<SpacesCodexHandoff project={project} onClose={() => {}} />, { api: createFakeApi() });
    await prepare();
    await click(screen().getByRole("button", { name: "Copiar briefing" }));
    await settle();
    expect(screen().getByRole("alert").textContent).toContain("Selecione o texto");
    expect(screen().queryByText("Briefing copiado")).toBeNull();
    await click(screen().getByRole("button", { name: "Selecionar briefing" }));
    const preview = field("Briefing para o Codex") as unknown as HTMLTextAreaElement;
    expect(document.activeElement).toBe(preview);
    expect(preview.selectionStart).toBe(0);
    expect(preview.selectionEnd).toBe(preview.value.length);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } });
    await click(screen().getByRole("button", { name: "Copiar briefing" }));
    await settle();
    expect(screen().queryByRole("alert")).toBeNull();
    expect(screen().getByRole("status").textContent).toContain("Briefing copiado");
  });
}

test("clears the folder link and invalidates a prepared preview after every field edit", async () => {
  const fake = backend();
  await renderPage(<SpacesCodexHandoff project={project} onClose={() => {}} />, { api: createFakeApi() });
  await click(screen().getByRole("button", { name: "Remover vínculo da pasta" }));
  expect(field("Pasta do projeto").value).toBe("");
  await prepare();
  expect(fake.writes[0]?.folderPath).toBeNull();
  for (const name of ["Pasta do projeto", "Objetivo da próxima tarefa", "Critérios de entrega"]) {
    await change(field(name), name === "Pasta do projeto" ? "/home/alan/projeto" : "Novo conteúdo");
    expect(screen().queryByRole("textbox", { name: "Briefing para o Codex" })).toBeNull();
    expect(screen().queryByRole("button", { name: "Copiar briefing" })).toBeNull();
    await prepare();
  }
});

test("read failures offer retry and write failures retain the person's fields", async () => {
  const fake = backend();
  fake.failRead(true);
  await renderPage(<SpacesCodexHandoff project={project} onClose={() => {}} />, { api: createFakeApi() });
  expect(screen().queryByRole("textbox", { name: "Pasta do projeto" })).toBeNull();
  fake.failRead(false);
  await click(screen().getByRole("button", { name: "Tentar de novo" }));
  await settle(4);
  await change(field("Pasta do projeto"), "relativo/nao-validado");
  fake.failWrite(true);
  await prepare();
  expect(screen().getByRole("alert")).toBeTruthy();
  expect(field("Pasta do projeto").value).toBe("relativo/nao-validado");
  expect(screen().queryByRole("textbox", { name: "Briefing para o Codex" })).toBeNull();
  fake.failWrite(false);
  await change(field("Pasta do projeto"), "/home/alan/projeto");
  await prepare();
  expect(screen().getByRole("textbox", { name: "Briefing para o Codex" })).toBeTruthy();
});

test("closing and switching projects discard old drafts and reload current configuration", async () => {
  const fake = backend();
  function Harness() {
    const [current, setCurrent] = useState<RheoProject | null>(project);
    return (
      <>
        <button type="button" onClick={() => setCurrent(project)}>
          Abrir primeiro
        </button>
        <button type="button" onClick={() => setCurrent({ ...project, id: "project-two", name: "Outro projeto" })}>
          Trocar projeto
        </button>
        {current && <SpacesCodexHandoff project={current} onClose={() => setCurrent(null)} />}
      </>
    );
  }
  await renderPage(<Harness />, { api: createFakeApi() });
  await prepare();
  await click(screen().getAllByRole("button", { name: "Fechar" })[0] as Element);
  await settle();
  fake.set({ folderPath: "/outro/caminho", objective: "Atualizado no servidor", criteria: "" });
  await click(screen().getByRole("button", { name: "Abrir primeiro" }));
  await settle(4);
  expect(field("Objetivo da próxima tarefa").value).toBe("Atualizado no servidor");
  expect(screen().queryByRole("textbox", { name: "Briefing para o Codex" })).toBeNull();
  await change(field("Objetivo da próxima tarefa"), "Rascunho privado do primeiro");
  fake.set({ folderPath: "/projeto-dois", objective: "Só do segundo", criteria: "" });
  await click(screen().getByRole("button", { name: "Trocar projeto", hidden: true }));
  await settle(4);
  expect(field("Objetivo da próxima tarefa").value).toBe("Só do segundo");
  expect(fake.reads.at(-1)).toBe("/api/app/spaces/projects/project-two/handoff");
});

test("archived projects cannot prepare work and do not fetch folder references", async () => {
  const fake = backend();
  await renderPage(<SpacesCodexHandoff project={{ ...project, state: "archived" }} onClose={() => {}} />, {
    api: createFakeApi(),
  });
  expect(screen().getByRole("status").textContent).toContain("arquivado");
  expect(screen().queryByRole("textbox", { name: "Pasta do projeto" })).toBeNull();
  expect(fake.reads).toEqual([]);
  expect(fake.writes).toEqual([]);
});

test("a cached configuration is hidden until a fresh read completes", async () => {
  const api = createFakeApi();
  const me = await api.account.me();
  expect(me).toBeTruthy();
  let resolveRead: (response: Response) => void = () => {};
  globalThis.fetch = (() =>
    new Promise<Response>((resolve) => {
      resolveRead = resolve;
    })) as unknown as typeof fetch;
  function Harness() {
    const [open, setOpen] = useState(false);
    return open ? (
      <SpacesCodexHandoff project={project} onClose={() => setOpen(false)} />
    ) : (
      <button type="button" onClick={() => setOpen(true)}>
        Preparar contexto
      </button>
    );
  }
  const { services } = await renderPage(<Harness />, { api });
  services.queryClient.setQueryData(rheoHandoffKey(me?.user.id ?? "", project.id), {
    ...initial,
    objective: "Configuração antiga em cache",
  });
  await click(screen().getByRole("button", { name: "Preparar contexto" }));
  await settle();
  expect(screen().queryByRole("textbox", { name: "Objetivo da próxima tarefa" })).toBeNull();
  expect(screen().queryByText("Configuração antiga em cache")).toBeNull();
  await act(async () => resolveRead(Response.json({ ...initial, objective: "Configuração atual" })));
  await settle(4);
  expect(field("Objetivo da próxima tarefa").value).toBe("Configuração atual");
});

test("switching accounts discards drafts and the prepared briefing for the previous account", async () => {
  const fake = backend();
  const api = createFakeApi();
  const me = await api.account.me();
  const { services } = await renderPage(<SpacesCodexHandoff project={project} onClose={() => {}} />, { api });
  await prepare();
  expect(screen().getByRole("textbox", { name: "Briefing para o Codex" })).toBeTruthy();
  fake.set({ folderPath: "/conta-dois", objective: "Contexto da segunda conta", criteria: "" });
  await act(async () =>
    services.queryClient.setQueryData(keys.me, { ...me, user: { ...me?.user, id: "second-user" } }),
  );
  await settle(4);
  expect(field("Objetivo da próxima tarefa").value).toBe("Contexto da segunda conta");
  expect(screen().queryByRole("textbox", { name: "Briefing para o Codex" })).toBeNull();
  expect(services.queryClient.getQueryData(rheoHandoffKey(me?.user.id ?? "", project.id))).toBeUndefined();
});

for (const surface of ["catalog", "conversation"] as const) {
  test(`${surface} opens handoff on demand and archived projects keep the action disabled`, async () => {
    const fake = backend();
    const handoffFetch = globalThis.fetch;
    const currentProject = { ...project, orgId: ORG_ID };
    const archived = { ...project, id: "archived-project", name: "Projeto arquivado", state: "archived" };
    globalThis.fetch = (async (input, init) => {
      if (String(input) === "/api/app/spaces/codex")
        return Response.json({
          installed: false,
          compatible: false,
          connected: false,
          sandbox: "pending",
          version: null,
        });
      if (String(input) === "/api/app/spaces")
        return Response.json({
          controlOrgId: ORG_ID,
          controlChannelId: "control-channel",
          templates: [],
          businesses: [
            {
              id: "business",
              name: "Negócio",
              spaces: [{ id: "space", name: "Cliente", projects: [currentProject, archived] }],
            },
          ],
        });
      return handoffFetch(input, init);
    }) as typeof fetch;
    await renderPage(surface === "catalog" ? <RheoSpacesPage /> : <RheoProjectContext />, {
      api: createFakeApi(),
      org: true,
    });
    expect(fake.reads).toEqual([]);
    if (surface === "catalog")
      expect(
        (screen().getByRole("button", { name: "Continuar Projeto arquivado no Codex" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    await click(
      screen().getByRole("button", {
        name: surface === "catalog" ? "Continuar Portal do cliente no Codex" : "Continuar no Codex",
      }),
    );
    await settle(4);
    expect(screen().getByRole("dialog", { name: "Continuar no Codex" })).toBeTruthy();
    expect(fake.reads).toHaveLength(1);
  });
}

test("worst-case names, paths and briefing remain complete in the native controls", async () => {
  const folderPath = `C:\\Clientes com espaços\\${"Pasta de documentação extensa\\".repeat(55)}`;
  backend({ ...initial, folderPath });
  await renderPage(
    <SpacesCodexHandoff
      project={{ ...project, name: "Projeto com nome muito comprido para rever a leitura em larguras estreitas" }}
      onClose={() => {}}
    />,
    { api: createFakeApi() },
  );
  document.querySelector(".spaces-codex-handoff")?.classList.add("spaces-codex-handoff--worst-case");
  expect(field("Pasta do projeto").value).toBe(folderPath);
  expect(field("Pasta do projeto").maxLength).toBe(2000);
  expect(field("Objetivo da próxima tarefa").maxLength).toBe(4000);
  expect(field("Critérios de entrega").maxLength).toBe(4000);
  await prepare();
  expect(field("Briefing para o Codex").value).toContain(folderPath);
});
