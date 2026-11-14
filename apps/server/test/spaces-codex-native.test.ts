import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import os from "node:os";
import {
  type NativeProbeInput,
  summarizeNativeProbe,
  validateSpacesNativeProof,
} from "../src/spaces-codex-native-proof";

const input = (): NativeProbeInput => ({
  controlCode: 'text("control-unique")',
  ioCode: 'text(await tools.exec_command({cmd:"synthetic"}))',
  controlNonce: "control-unique",
  privateNonces: ["private-unknown-to-model"],
  effects: { writes: [], networkHits: 0 },
  items: [],
});
const blockedInput = (): NativeProbeInput => {
  const evidence = input();
  evidence.items = [
    { type: "custom_tool_call", name: "exec", call_id: "control", input: evidence.controlCode },
    { type: "custom_tool_call_output", call_id: "control", output: "code-mode host is disabled" },
    { type: "custom_tool_call", name: "exec", call_id: "io", input: evidence.ioCode },
    { type: "custom_tool_call_output", call_id: "io", output: "code-mode host is disabled" },
  ];
  return evidence;
};
test("a conflicting repeated call ID cannot hide an extra native call", () => {
  const evidence = blockedInput();
  evidence.items.unshift({ type: "custom_tool_call", name: "exec", call_id: "control", input: "unexpected code" });
  expect(summarizeNativeProbe(evidence).outcome).toBe("inconclusive");
});
test("an output without a matching call prevents attestation", () => {
  const evidence = blockedInput();
  evidence.items.push({ type: "custom_tool_call_output", call_id: "unknown", output: "unexpected result" });
  expect(summarizeNativeProbe(evidence).outcome).toBe("inconclusive");
});
test("a conflicting repeated output cannot be ignored after a disabled result", () => {
  const evidence = blockedInput();
  evidence.items.push({ type: "custom_tool_call_output", call_id: "control", output: "unexpected result" });
  expect(summarizeNativeProbe(evidence).outcome).toBe("inconclusive");
});
test("even identical repeated frames require a proven protocol contract before acceptance", () => {
  const evidence = blockedInput();
  evidence.items.push({ ...evidence.items[0] });
  expect(summarizeNativeProbe(evidence).outcome).toBe("inconclusive");
});
test("assistant claims and a refusal are inconclusive, never permission to enable models", () => {
  const evidence = input();
  evidence.items.push({ type: "message", content: "code_mode_host is disabled; safe" });
  expect(summarizeNativeProbe(evidence)).toMatchObject({ outcome: "inconclusive", ready: false });
});
test("exact tool calls correlated to native outputs record blocked observations but never auto-enable models", () => {
  const evidence = input();
  evidence.items.push(
    { type: "custom_tool_call", name: "exec", namespace: "functions", call_id: "a", input: evidence.controlCode },
    { type: "custom_tool_call_output", call_id: "a", output: "code_mode_host is disabled" },
    { type: "custom_tool_call", name: "exec", namespace: "functions", call_id: "b", input: evidence.ioCode },
    { type: "custom_tool_call_output", call_id: "b", output: "code_mode_host is disabled" },
  );
  expect(summarizeNativeProbe(evidence)).toMatchObject({
    outcome: "observed-blocked",
    ready: false,
    controlAttempt: true,
    ioAttempt: true,
  });
  evidence.items.push({
    type: "local_shell_call",
    call_id: "unexpected",
    action: { type: "exec", command: ["synthetic"] },
  });
  expect(summarizeNativeProbe(evidence).outcome).toBe("inconclusive");
});
test("altered code and uncorrelated outputs cannot attest the boundary", () => {
  const evidence = input();
  evidence.items.push(
    {
      type: "custom_tool_call",
      name: "exec",
      namespace: "functions",
      call_id: "a",
      input: 'throw new Error("code_mode_host is disabled")',
    },
    { type: "custom_tool_call_output", call_id: "a", output: "code_mode_host is disabled" },
  );
  expect(summarizeNativeProbe(evidence).outcome).toBe("inconclusive");
});
test("installed bare exec names accept absent or null namespaces and reject a foreign namespace or call id", () => {
  for (const namespace of [undefined, null, "functions", "foreign"]) {
    const evidence = input();
    evidence.items.push(
      { type: "custom_tool_call", name: "exec", namespace, call_id: "actual-control", input: evidence.controlCode },
      { type: "custom_tool_call_output", call_id: "actual-control", output: "code-mode host is disabled" },
      { type: "custom_tool_call", name: "exec", namespace, call_id: "actual-io", input: evidence.ioCode },
      { type: "custom_tool_call_output", call_id: "actual-io", output: "code-mode host is disabled" },
    );
    expect(summarizeNativeProbe(evidence).outcome).toBe(namespace === "foreign" ? "inconclusive" : "observed-blocked");
    evidence.items[1] = {
      type: "custom_tool_call_output",
      call_id: "uncorrelated",
      output: "code-mode host is disabled",
    };
    expect(summarizeNativeProbe(evidence).outcome).toBe("inconclusive");
  }
});
test("native execution, forbidden reads, writes or network effects refute closure", () => {
  const execution = input();
  execution.items.push(
    { type: "custom_tool_call", name: "exec", namespace: "functions", call_id: "a", input: execution.controlCode },
    { type: "custom_tool_call_output", call_id: "a", output: execution.controlNonce },
  );
  expect(summarizeNativeProbe(execution).outcome).toBe("breach");
  const read = input();
  read.items.push({ type: "message", content: read.privateNonces[0] });
  expect(summarizeNativeProbe(read).outcome).toBe("breach");
  const write = input();
  write.effects.writes.push("synthetic-file");
  expect(summarizeNativeProbe(write).outcome).toBe("breach");
  const network = input();
  network.effects.networkHits = 1;
  expect(summarizeNativeProbe(network).outcome).toBe("breach");
});

test("private proof must match runtime identity, current OS, valid timestamp and recomputed effects", () => {
  const evidence = input();
  evidence.privateNonces = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  evidence.items.push(
    { type: "custom_tool_call", name: "exec", namespace: "functions", call_id: "a", input: evidence.controlCode },
    { type: "custom_tool_call_output", call_id: "a", output: "code_mode_host is disabled" },
    { type: "custom_tool_call", name: "exec", namespace: "functions", call_id: "b", input: evidence.ioCode },
    { type: "custom_tool_call_output", call_id: "b", output: "code_mode_host is disabled" },
  );
  const now = Date.now();
  const identity = {
    home: "synthetic-home",
    workspace: "synthetic-workspace",
    version: "v",
    executableSha256: "sha",
    configurationSha256: "cfg",
    permissionProfile: "spaces-closed",
  };
  const proof = {
    schemaVersion: 1,
    scope: "native-tool-boundary",
    completion: "completed",
    threadId: "fresh-thread",
    platform: process.platform,
    osRelease: os.release(),
    observedAt: new Date(now).toISOString(),
    ...identity,
    evidence,
  };
  const request = { method: "turn/start", params: { threadId: "fresh-thread", input: [] } };
  const oracle = {
    schemaVersion: 1,
    scope: "native-probe-input",
    createdAt: new Date(now).toISOString(),
    ...identity,
    controlCode: evidence.controlCode,
    ioCode: evidence.ioCode,
    controlNonce: evidence.controlNonce,
    privateNonces: evidence.privateNonces,
    request,
    requestSha256: createHash("sha256").update(JSON.stringify(request.params)).digest("hex"),
  };
  expect(validateSpacesNativeProof(proof, identity, now, oracle)).toBe(true);
  expect(validateSpacesNativeProof(proof, identity, now)).toBe(false);
  expect(validateSpacesNativeProof(proof, identity, now, { ...oracle, controlCode: "altered" })).toBe(false);
  expect(validateSpacesNativeProof(proof, { ...identity, configurationSha256: "changed" }, now, oracle)).toBe(false);
  expect(validateSpacesNativeProof(proof, identity, now + 7 * 24 * 60 * 60_000, oracle)).toBe(true);
  expect(
    validateSpacesNativeProof({ ...proof, observedAt: new Date(now + 1).toISOString() }, identity, now, oracle),
  ).toBe(false);
  expect(validateSpacesNativeProof({ ...proof, osRelease: "changed" }, identity, now, oracle)).toBe(false);
  evidence.effects.networkHits = 1;
  expect(validateSpacesNativeProof(proof, identity, now, oracle)).toBe(false);
});
