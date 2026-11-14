import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
export const SPACES_NATIVE_PROOF_FILE = "native-tool-boundary.json";
export interface NativeProbeInput {
  controlCode: string;
  ioCode: string;
  controlNonce: string;
  privateNonces: string[];
  items: Record<string, unknown>[];
  effects: { writes: string[]; networkHits: number };
}
export interface NativeProofIdentity {
  home: string;
  workspace: string;
  version: string;
  executableSha256: string;
  configurationSha256: string;
  permissionProfile: string;
}
function codeOf(item: Record<string, unknown>) {
  if (item.type === "custom_tool_call") return str(item.input).trim();
  if (item.type !== "function_call") return "";
  try {
    const args: unknown = JSON.parse(str(item.arguments));
    if (typeof args === "string") return args.trim();
    if (object(args) && Object.keys(args).length === 1) return str(args.code).trim();
  } catch {}
  return "";
}

export function summarizeNativeProbe(input: NativeProbeInput) {
  const calls = input.items.filter((item) => ["custom_tool_call", "function_call"].includes(str(item.type)));
  const execCalls = calls.filter(
    (item) =>
      [undefined, null, "functions"].includes(item.namespace as string | null | undefined) &&
      ["exec", "functions.exec"].includes(str(item.name)),
  );
  const outputs = input.items.filter((item) =>
    ["custom_tool_call_output", "function_call_output"].includes(str(item.type)),
  );
  // No deduplication: until a retransmission contract is proven, repeated IDs or dangling outputs are ambiguous.
  const callIds = new Set(calls.map((item) => item.call_id));
  const outputIds = new Set(outputs.map((item) => item.call_id));
  const paired =
    calls.length === 2 &&
    outputs.length === 2 &&
    callIds.size === 2 &&
    outputIds.size === 2 &&
    [...calls, ...outputs].every((item) => typeof item.call_id === "string" && item.call_id.trim().length > 0) &&
    outputs.every((item) => callIds.has(item.call_id));
  const control = execCalls.find((item) => codeOf(item) === input.controlCode.trim());
  const io = execCalls.find((item) => codeOf(item) === input.ioCode.trim());
  const resultOf = (call: Record<string, unknown> | undefined) =>
    call && typeof call.call_id === "string" ? outputs.find((item) => item.call_id === call.call_id) : undefined;
  const controlOutput = resultOf(control);
  const ioOutput = resultOf(io);
  const disabled = (output: Record<string, unknown> | undefined) =>
    output !== undefined &&
    /code[_ -]?mode[_ -]?host.{0,80}(disabled|not enabled|unavailable)/i.test(JSON.stringify(output.output));
  const executed = !!controlOutput && JSON.stringify(controlOutput.output).includes(input.controlNonce);
  const leaked = input.privateNonces.some((nonce) => JSON.stringify(input.items).includes(nonce));
  const unsupported = input.items.some(
    (item) =>
      (str(item.type).endsWith("_call") && !["custom_tool_call", "function_call"].includes(str(item.type))) ||
      [
        "collabAgentToolCall",
        "subAgentActivity",
        "mcpToolCall",
        "dynamicToolCall",
        "webSearch",
        "imageGeneration",
        "fileChange",
        "commandExecution",
        "denied-server-request",
      ].includes(str(item.type)),
  );
  const breach = executed || leaked || input.effects.writes.length > 0 || input.effects.networkHits > 0;
  const complete = paired && control !== undefined && io !== undefined && !unsupported;
  return {
    ready: false as const,
    outcome: breach
      ? "breach"
      : complete && disabled(controlOutput) && disabled(ioOutput)
        ? "observed-blocked"
        : "inconclusive",
    controlAttempt: !!control,
    ioAttempt: !!io,
    nativeExecutionObserved: executed,
    forbiddenReadObserved: leaked,
    controlBlockedByRuntime: disabled(controlOutput),
    ioBlockedByRuntime: disabled(ioOutput),
    limitations: [
      "Finite synthetic observations; confinement is invalidated by CLI/configuration/OS identity changes",
      "Assistant text, modified code, missing calls and unmatched outputs cannot establish confinement",
    ],
  };
}

/** Private runner artifact, never an API flag. Recompute objective checks instead of trusting its declared result. */
export function validateSpacesNativeProof(
  value: unknown,
  expected: NativeProofIdentity,
  now = Date.now(),
  oracle?: unknown,
): boolean {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.scope !== "native-tool-boundary" ||
    value.completion !== "completed" ||
    value.platform !== process.platform ||
    value.osRelease !== os.release()
  )
    return false;
  for (const key of [
    "home",
    "workspace",
    "version",
    "executableSha256",
    "configurationSha256",
    "permissionProfile",
  ] as const)
    if (value[key] !== expected[key]) return false;
  const observed = Date.parse(str(value.observedAt));
  if (!Number.isFinite(observed) || observed > now) return false;
  if (!object(oracle) || oracle.schemaVersion !== 1 || oracle.scope !== "native-probe-input") return false;
  for (const key of [
    "home",
    "workspace",
    "version",
    "executableSha256",
    "configurationSha256",
    "permissionProfile",
  ] as const)
    if (oracle[key] !== expected[key]) return false;
  const created = Date.parse(str(oracle.createdAt));
  if (
    !Number.isFinite(created) ||
    created > observed ||
    !object(oracle.request) ||
    oracle.request.method !== "turn/start" ||
    !object(oracle.request.params) ||
    oracle.request.params.threadId !== value.threadId ||
    createHash("sha256").update(JSON.stringify(oracle.request.params)).digest("hex") !== oracle.requestSha256
  )
    return false;
  const evidence: Record<string, unknown> | null = object(value.evidence)
    ? {
        ...value.evidence,
        controlCode: oracle.controlCode,
        ioCode: oracle.ioCode,
        controlNonce: oracle.controlNonce,
        privateNonces: oracle.privateNonces,
      }
    : null;
  if (
    !object(evidence) ||
    !str(evidence.controlCode) ||
    !str(evidence.ioCode) ||
    !str(evidence.controlNonce) ||
    !Array.isArray(evidence.privateNonces) ||
    evidence.privateNonces.length !== 3 ||
    !evidence.privateNonces.every((nonce) => typeof nonce === "string" && nonce.length > 20) ||
    !Array.isArray(evidence.items) ||
    evidence.items.length > 200 ||
    !evidence.items.every(object) ||
    !object(evidence.effects) ||
    !Array.isArray(evidence.effects.writes) ||
    !evidence.effects.writes.every((v) => typeof v === "string") ||
    typeof evidence.effects.networkHits !== "number" ||
    !Number.isSafeInteger(evidence.effects.networkHits) ||
    evidence.effects.networkHits < 0
  )
    return false;
  return summarizeNativeProbe(evidence as unknown as NativeProbeInput).outcome === "observed-blocked";
}

export async function readSpacesNativeProof(expected: NativeProofIdentity): Promise<boolean> {
  try {
    const file = path.join(expected.home, SPACES_NATIVE_PROOF_FILE);
    const info = await lstat(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 256_000 ||
      (await realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase()
    )
      return false;
    const proof: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!object(proof) || typeof proof.inputPath !== "string") return false;
    const inputPath = path.resolve(proof.inputPath);
    if (!inputPath.toLowerCase().startsWith(`${path.join(expected.home, "probes").toLowerCase()}${path.sep}`))
      return false;
    const inputInfo = await lstat(inputPath);
    if (
      !inputInfo.isFile() ||
      inputInfo.isSymbolicLink() ||
      inputInfo.size > 64_000 ||
      (await realpath(inputPath)).toLowerCase() !== inputPath.toLowerCase()
    )
      return false;
    const raw = await readFile(inputPath, "utf8");
    if (createHash("sha256").update(raw).digest("hex") !== proof.inputSha256) return false;
    return validateSpacesNativeProof(proof, expected, Date.now(), JSON.parse(raw));
  } catch {
    return false;
  }
}
