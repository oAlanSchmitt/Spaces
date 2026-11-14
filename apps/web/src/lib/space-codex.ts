import { createRequester } from "@agenteschat/client";

export interface SpaceCodexStatus {
  installed: boolean;
  connected: boolean;
  compatible: boolean;
  loginAvailable: boolean;
  sandbox: "pending" | "ready" | "blocked";
  version: string | null;
  message?: string;
}

export const spaceCodexReady = (status: SpaceCodexStatus | undefined) =>
  status?.connected === true && status.compatible === true && status.sandbox === "ready";

/** Only the official HTTPS origins accepted by the backend may become an authentication link. */
export function officialCodexAuthUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https://auth.openai.com", "https://chatgpt.com"].includes(url.origin) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const base = "/api/app/spaces/codex";
const request = createRequester();

export const spaceCodexApi = {
  status: (signal: AbortSignal) =>
    createRequester({
      // Native GETs have their own deadline. Also cancel when the observing card becomes inactive.
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
        }),
    })<SpaceCodexStatus>(base),
  login: () => request<{ authUrl: string }>(`${base}/login`, { json: {} }),
};
