import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readSpacesWorkProof,
  SPACES_WORK_CHECKS,
  type SpacesWorkProofIdentity,
  spacesWorkProofPath,
  validateSpacesWorkProof,
} from "../src/spaces-work-proof";

const repository = path.resolve(import.meta.dir, "../../..");
const fixture = path.join(repository, ".rheo/probes", `work-proof-unit-${randomUUID()}`);
const home = path.join(fixture, "home");
const workspace = path.join(fixture, "workspace");
for (const directory of [home, workspace]) mkdirSync(directory, { recursive: true });
const identity: SpacesWorkProofIdentity = {
  home,
  workspace,
  version: "0.167.0-alpha.4.1",
  executableSha256: "a".repeat(64),
  configurationSha256: "b".repeat(64),
  permissionProfile: "spaces-work",
  hostId: "c".repeat(64),
};
const proof = () => ({
  ...identity,
  schemaVersion: 2,
  scope: "work-command-exec-filesystem-network",
  platform: process.platform,
  osRelease: os.release(),
  hostname: os.hostname(),
  observedAt: new Date(Date.now() - 1000).toISOString(),
  results: SPACES_WORK_CHECKS.map((id) => ({ id, passed: true, detail: "synthetic unit evidence" })),
  limitations: ["Finite deterministic canaries; no model or image turn is attested"],
});

afterAll(() => {
  if (fixture.startsWith(`${path.join(repository, ".rheo/probes")}${path.sep}`))
    rmSync(fixture, { recursive: true, force: true });
});

describe("Spaces work proof", () => {
  test("accepts only the complete new profile identity and all finite controls", () => {
    expect(validateSpacesWorkProof(proof(), identity)).toBe(true);
    for (const changed of [
      { configurationSha256: "d".repeat(64) },
      { schemaVersion: 1 },
      { executableSha256: "d".repeat(64) },
      { permissionProfile: "spaces-closed" },
      { hostId: "d".repeat(64) },
      { workspace: path.join(workspace, "other") },
      { home: path.join(home, "other") },
      { osRelease: "another Windows release" },
      { hostname: "another host" },
      { scope: "command-exec-filesystem-network" },
      { observedAt: new Date(Date.now() + 60_000).toISOString() },
    ])
      expect(validateSpacesWorkProof({ ...proof(), ...changed }, identity)).toBe(false);
  });

  test("does not accept a ready flag, missing positive writes, duplicates or inconclusive checks", () => {
    expect(validateSpacesWorkProof({ ...identity, ready: true }, identity)).toBe(false);
    for (const id of SPACES_WORK_CHECKS) {
      const missing = proof();
      missing.results = missing.results.filter((result) => result.id !== id);
      expect(validateSpacesWorkProof(missing, identity)).toBe(false);
      expect(
        validateSpacesWorkProof(
          {
            ...proof(),
            results: proof().results.map((result) => (result.id === id ? { ...result, passed: null } : result)),
          },
          identity,
        ),
      ).toBe(false);
    }
    expect(validateSpacesWorkProof({ ...proof(), results: [...proof().results, proof().results[0]] }, identity)).toBe(
      false,
    );
  });

  test("reads only the exact private proof and rejects redirects", async () => {
    const file = spacesWorkProofPath(home, workspace);
    expect(await readSpacesWorkProof(identity)).toBe(false);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(proof()));
    expect(await readSpacesWorkProof(identity)).toBe(true);
    expect(await readSpacesWorkProof({ ...identity, configurationSha256: "e".repeat(64) })).toBe(false);
    unlinkSync(file);
    const other = path.join(home, "other-proof.json");
    writeFileSync(other, JSON.stringify(proof()));
    try {
      symlinkSync(other, file, "file");
    } catch {
      return;
    }
    expect(await readSpacesWorkProof(identity)).toBe(false);
  });
});
