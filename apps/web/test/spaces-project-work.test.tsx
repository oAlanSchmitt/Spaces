import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { SpacesProjectWork, type SpacesWorkState } from "@/components/SpacesProjectWork";
import type { RheoProject } from "@/lib/rheo-spaces";
import { createFakeApi } from "./fake-api";
import { renderPage, screen, settle } from "./render";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
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
const ready: SpacesWorkState = {
  folderPath: "C:\\Clientes\\Portal",
  configured: true,
  revision: "revision-1",
  status: "ready",
};
const field = () => screen().getByRole("textbox", { name: "Pasta de trabalho" }) as HTMLInputElement;

function backend(initial: SpacesWorkState = ready) {
  let current = initial;
  let readFailure = false;
  let conflict = false;
  const reads: string[] = [];
  const writes: { method: string; body: unknown }[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    expect(path).toMatch(/^\/api\/app\/spaces\/projects\/project-(one|two)\/work$/);
    if (!init?.method || init.method === "GET") {
      reads.push(path);
      if (readFailure) return Response.json({ error: { code: "unavailable", message: "Falhou" } }, { status: 503 });
      return Response.json(current);
    }
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    const body = JSON.parse(String(init.body)) as { folderPath?: string; revision: string | null };
    writes.push({ method: init.method, body });
    if (conflict)
      return Response.json(
        { error: { code: "version_conflict", message: "A pasta foi alterada em outra janela." } },
        { status: 409 },
      );
    current =
      init.method === "DELETE"
        ? { folderPath: null, revision: null, configured: false, status: "unconfigured" }
        : { folderPath: body.folderPath ?? null, revision: "revision-2", configured: true, status: "pending" };
    return Response.json(current);
  }) as typeof fetch;
  return {
    reads,
    writes,
    set: (state: SpacesWorkState) => {
      current = state;
    },
    failRead: (value: boolean) => {
      readFailure = value;
    },
    conflict: (value: boolean) => {
      conflict = value;
    },
  };
}

test("opening work reads only its configuration and clearly distinguishes readiness", async () => {
  const fake = backend();
  await renderPage(<SpacesProjectWork project={project} onClose={() => {}} />, { api: createFakeApi() });
  expect(screen().getByRole("dialog", { name: "Trabalho no projeto" })).toBeTruthy();
  expect(field().value).toBe(ready.folderPath ?? "");
  expect(screen().getByRole("status").textContent).toContain("Pronto para trabalhar");
  expect(fake.writes).toEqual([]);
  expect(fake.reads).toHaveLength(1);
  expect(document.querySelector('input[type="file"]')).toBeNull();
});

test("the first association sends a null revision and a draft survives Escape", async () => {
  const fake = backend({ folderPath: null, revision: null, configured: false, status: "unconfigured" });
  let closed = 0;
  await renderPage(
    <SpacesProjectWork
      project={project}
      onClose={() => {
        closed++;
      }}
    />,
    { api: createFakeApi() },
  );
  expect((screen().getByRole("button", { name: "Associar pasta" }) as HTMLButtonElement).disabled).toBe(true);
  await change(field(), "C:\\Projetos\\Novo");
  await act(async () => void fireEvent.keyDown(screen().getByRole("dialog"), { key: "Escape", code: "Escape" }));
  expect(closed).toBe(0);
  expect(field().value).toBe("C:\\Projetos\\Novo");
  await click(screen().getByRole("button", { name: "Associar pasta" }));
  await settle(4);
  expect(fake.writes[0]).toEqual({ method: "PUT", body: { folderPath: "C:\\Projetos\\Novo", revision: null } });
});

test("associates explicitly with the current revision and revokes through DELETE", async () => {
  const fake = backend();
  await renderPage(<SpacesProjectWork project={project} onClose={() => {}} />, { api: createFakeApi() });
  await change(field(), "C:\\Projetos\\Portal atualizado");
  await click(screen().getByRole("button", { name: "Associar pasta" }));
  await settle(4);
  expect(fake.writes[0]).toEqual({
    method: "PUT",
    body: { folderPath: "C:\\Projetos\\Portal atualizado", revision: "revision-1" },
  });
  expect(screen().getByRole("status").textContent).toContain("Validação de trabalho pendente");
  await click(screen().getByRole("button", { name: "Desassociar pasta" }));
  await settle(4);
  expect(fake.writes[1]).toEqual({ method: "DELETE", body: { revision: "revision-2" } });
  expect(field().value).toBe("");
  expect(screen().getByRole("status").textContent).toContain("Pasta não associada");
  expect(screen().queryByRole("button", { name: "Desassociar pasta" })).toBeNull();
});

test("a conflict preserves the draft and offers a fresh status read without executing a model", async () => {
  const fake = backend();
  await renderPage(<SpacesProjectWork project={project} onClose={() => {}} />, { api: createFakeApi() });
  await change(field(), "C:\\Projetos\\Rascunho");
  fake.conflict(true);
  await click(screen().getByRole("button", { name: "Associar pasta" }));
  await settle(4);
  expect(screen().getByRole("alert")).toBeTruthy();
  expect(field().value).toBe("C:\\Projetos\\Rascunho");
  fake.conflict(false);
  await change(field(), ready.folderPath ?? "");
  fake.set({ ...ready, revision: "revision-new", status: "blocked", message: "Perfil de trabalho incompatível" });
  await click(screen().getByRole("button", { name: "Verificar trabalho" }));
  await settle(4);
  expect(screen().getByRole("status").textContent).toContain("Trabalho indisponível");
  expect(screen().getByText("Perfil de trabalho incompatível")).toBeTruthy();
  expect(fake.reads).toHaveLength(2);
  expect(fake.writes).toHaveLength(1);
});

test("read errors offer retry and archived projects can revoke their binding without enabling work", async () => {
  const fake = backend();
  fake.failRead(true);
  await renderPage(<SpacesProjectWork project={{ ...project, state: "archived" }} onClose={() => {}} />, {
    api: createFakeApi(),
  });
  expect(screen().queryByRole("textbox")).toBeNull();
  fake.failRead(false);
  await click(screen().getByRole("button", { name: "Tentar de novo" }));
  await settle(4);
  expect(field().readOnly).toBe(true);
  expect(screen().getByText("Reabra o projeto para alterar a pasta ou iniciar trabalho.")).toBeTruthy();
  expect(screen().queryByRole("button", { name: "Associar pasta" })).toBeNull();
  expect(fake.writes).toEqual([]);
  await click(screen().getByRole("button", { name: "Desassociar pasta" }));
  await settle(3);
  expect(fake.writes.map((write) => write.method)).toEqual(["DELETE"]);
});

test("switching or reopening projects fetches current configuration and keeps the briefing optional", async () => {
  const fake = backend();
  let handoffs = 0;
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
        {current && (
          <SpacesProjectWork
            project={current}
            onClose={() => setCurrent(null)}
            onHandoff={() => {
              handoffs++;
            }}
          />
        )}
      </>
    );
  }
  await renderPage(<Harness />, { api: createFakeApi() });
  await click(screen().getByRole("button", { name: "Exportar briefing" }));
  expect(handoffs).toBe(1);
  await click(screen().getAllByRole("button", { name: "Fechar" })[0] as Element);
  await settle();
  fake.set({ ...ready, folderPath: "C:\\Projetos\\Atualizado", revision: "revision-new" });
  await click(screen().getByRole("button", { name: "Abrir primeiro" }));
  await settle(4);
  expect(field().value).toBe("C:\\Projetos\\Atualizado");
  fake.set({ folderPath: null, revision: null, configured: false, status: "unconfigured" });
  await click(screen().getByRole("button", { name: "Trocar projeto", hidden: true }));
  await settle(4);
  expect(field().value).toBe("");
  expect(fake.reads.at(-1)).toBe("/api/app/spaces/projects/project-two/work");
});

test("a pending verification permits closing while preventing a second submit", async () => {
  let finish: (response: Response) => void = () => {};
  let writes = 0;
  let closed = 0;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "PUT") {
      writes++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return Response.json(ready);
  }) as typeof fetch;
  await renderPage(
    <SpacesProjectWork
      project={project}
      onClose={() => {
        closed++;
      }}
    />,
    { api: createFakeApi() },
  );
  await change(field(), "C:\\Projetos\\Outro");
  await click(screen().getByRole("button", { name: "Associar pasta" }));
  await settle();
  expect((screen().getByRole("button", { name: "Associar pasta" }) as HTMLButtonElement).disabled).toBe(true);
  expect(field().closest("fieldset")?.disabled).toBe(true);
  await click(screen().getAllByRole("button", { name: "Fechar" })[0] as Element);
  expect(closed).toBe(1);
  expect(writes).toBe(1);
  await act(async () => {
    finish(Response.json({ ...ready, revision: "revision-2", folderPath: "C:\\Projetos\\Outro" }));
  });
  await settle(4);
  expect(field().closest("fieldset")?.disabled).toBe(false);
  expect(field().value).toBe("C:\\Projetos\\Outro");
});

test("a failed proof keeps its reason and permits checking the same folder again", async () => {
  const writes: unknown[] = [];
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "PUT") {
      writes.push(JSON.parse(String(init.body)));
      return Response.json({ ...ready, revision: "revision-2" });
    }
    return Response.json({ ...ready, status: "blocked", message: "A verificação de leitura externa falhou." });
  }) as typeof fetch;
  await renderPage(<SpacesProjectWork project={project} onClose={() => {}} />, { api: createFakeApi() });
  expect(screen().getByText("A verificação de leitura externa falhou.")).toBeTruthy();
  await click(screen().getByRole("button", { name: "Verificar novamente" }));
  await settle(4);
  expect(writes).toEqual([{ folderPath: ready.folderPath, revision: ready.revision }]);
  expect(screen().getByRole("status").textContent).toContain("Pronto para trabalhar");
});

test("long project names, folders and blocked details remain whole", async () => {
  const name = "Projeto de acompanhamento com nome extenso e documentação para todos os produtos do cliente";
  const folderPath =
    "C:\\Projetos de demonstração\\Cliente com nome extenso\\Site institucional e documentos de apresentação";
  backend({
    ...ready,
    folderPath,
    status: "blocked",
    message: "A validação do ambiente de trabalho ainda não foi concluída para esta pasta de projeto.",
  });
  await renderPage(<SpacesProjectWork project={{ ...project, name }} onClose={() => {}} />, { api: createFakeApi() });
  expect(screen().getByText(name)).toBeTruthy();
  expect(field().value).toBe(folderPath);
  expect(
    screen().getByText("A validação do ambiente de trabalho ainda não foi concluída para esta pasta de projeto."),
  ).toBeTruthy();
});
