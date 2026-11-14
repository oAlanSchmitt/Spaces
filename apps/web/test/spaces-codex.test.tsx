import { afterEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { SpacesCodexConnection } from "@/components/SpacesCodexConnection";
import { officialCodexAuthUrl, type SpaceCodexStatus } from "@/lib/space-codex";
import { createFakeApi } from "./fake-api";
import { renderPage, screen, settle } from "./render";

const originalFetch = globalThis.fetch;
let visibility: PropertyDescriptor | undefined;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  focusManager.setFocused(undefined);
  if (visibility) Object.defineProperty(document, "visibilityState", visibility);
  else Reflect.deleteProperty(document, "visibilityState");
});
const click = (node: Element) => act(async () => void fireEvent.click(node));
const status = (patch: Partial<SpaceCodexStatus> = {}): SpaceCodexStatus => ({
  installed: true,
  compatible: true,
  loginAvailable: true,
  connected: false,
  sandbox: "pending",
  version: "1.0.0",
  ...patch,
});

function backend(initial = status(), authUrl = "https://auth.openai.com/codex?state=synthetic") {
  let current = initial;
  let reads = 0;
  let writes = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input) === "/api/app/spaces/codex") {
      reads++;
      return Response.json(current);
    }
    expect(String(input)).toBe("/api/app/spaces/codex/login");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({});
    writes++;
    return Response.json({ authUrl });
  }) as typeof fetch;
  return {
    reads: () => reads,
    writes: () => writes,
    set: (next: SpaceCodexStatus) => {
      current = next;
    },
  };
}

test("a connected account is not ready until compatibility and isolation are ready", async () => {
  const fake = backend(status({ connected: true, sandbox: "pending" }));
  await renderPage(<SpacesCodexConnection />, { api: createFakeApi() });
  expect(screen().getByRole("status").textContent).toContain("Isolamento pendente");
  expect(screen().queryByText("Pronto para usar")).toBeNull();
  expect(fake.writes()).toBe(0);
});

for (const [patch, text] of [
  [{ installed: false }, "Codex não encontrado"],
  [{ compatible: false, connected: true, sandbox: "ready" }, "Versão incompatível"],
  [{ connected: true, sandbox: "blocked" }, "Isolamento bloqueado"],
] as const) {
  test(`the connection card reports ${text} honestly`, async () => {
    const fake = backend(status(patch));
    await renderPage(<SpacesCodexConnection />, { api: createFakeApi() });
    expect(screen().getByRole("status").textContent).toContain(text);
    expect(screen().queryByText("Pronto para usar")).toBeNull();
    expect(fake.writes()).toBe(0);
  });
}

test("login starts only on the person's click, schedules polling and refreshes when they return", async () => {
  focusManager.setFocused(true);
  const fake = backend(status({ sandbox: "ready" }));
  const { services } = await renderPage(<SpacesCodexConnection />, { api: createFakeApi() });
  expect(fake.writes()).toBe(0);
  expect(screen().queryByRole("link", { name: "Abrir autenticação oficial" })).toBeNull();
  await click(screen().getByRole("button", { name: "Ligar Codex" }));
  await settle(3);
  const link = screen().getByRole("link", { name: "Abrir autenticação oficial" });
  expect(link.getAttribute("href")).toBe("https://auth.openai.com/codex?state=synthetic");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(fake.writes()).toBe(1);
  const query = services.queryClient
    .getQueryCache()
    .findAll()
    .find((item) => item.queryKey[0] === "spaces-codex" && item.getObserversCount() > 0);
  assert(query);
  const intervals = () =>
    query.observers.map((observer) => {
      const interval = observer.options.refetchInterval;
      return typeof interval === "function" ? interval(query) : interval;
    });
  expect(intervals()).toContain(3000);
  fake.set(status({ connected: true, sandbox: "ready" }));
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await settle(3);
  expect(screen().getByRole("status").textContent).toContain("Pronto para usar");
  expect(fake.reads()).toBeGreaterThanOrEqual(2);
  expect(intervals()).toEqual([false]);
  expect(screen().queryByRole("link", { name: "Abrir autenticação oficial" })).toBeNull();
}, 10000);

test("an untrusted authentication URL is rejected instead of shown to the person", async () => {
  backend(status({ sandbox: "ready" }), "https://auth.openai.com.evil.invalid/login");
  await renderPage(<SpacesCodexConnection />, { api: createFakeApi() });
  await click(screen().getByRole("button", { name: "Ligar Codex" }));
  await settle(3);
  expect(screen().getByRole("alert")).toBeTruthy();
  expect(screen().queryByRole("link", { name: "Abrir autenticação oficial" })).toBeNull();
  for (const url of [
    "http://auth.openai.com/",
    "https://user:password@auth.openai.com/",
    "https://chatgpt.com:444/",
    "javascript:alert(1)",
  ])
    expect(officialCodexAuthUrl(url)).toBeNull();
  expect(officialCodexAuthUrl("https://chatgpt.com/device")).toBe("https://chatgpt.com/device");
});

test("a blocked isolation check keeps login visible and disabled without exposing internal diagnostics", async () => {
  const fake = backend(
    status({ sandbox: "blocked", loginAvailable: false, message: "INTERNAL_NATIVE_TOOL_DIAGNOSTIC" }),
  );
  await renderPage(<SpacesCodexConnection />, { api: createFakeApi() });
  expect((screen().getByRole("button", { name: "Ligar Codex" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen().queryByText("INTERNAL_NATIVE_TOOL_DIAGNOSTIC")).toBeNull();
  expect(fake.writes()).toBe(0);
});

test("a hidden or unmounted card aborts its pending status request", async () => {
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_input, init) => {
    signal = init?.signal ?? undefined;
    return new Promise((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }),
    );
  }) as typeof fetch;
  const view = await renderPage(<SpacesCodexConnection />, { api: createFakeApi() });
  assert(signal);
  visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  await act(async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await settle(2);
  expect(signal.aborted).toBe(true);
  view.unmount();
});

test("a failed probe has a readable retry and does not claim a connection", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "unavailable", message: "Codex indisponível" } },
      { status: 503 },
    )) as unknown as typeof fetch;
  await renderPage(<SpacesCodexConnection />, { api: createFakeApi() });
  expect(screen().getByRole("alert")).toBeTruthy();
  expect(screen().getByRole("button", { name: "Verificar Codex" })).toBeTruthy();
  expect(screen().queryByText("Pronto para usar")).toBeNull();
});
